// ============================================================================
// Compass - Google Calendar sync routes
// Imports events from the user's Google Calendar into Supabase.
// ============================================================================

const express = require('express');
const { google } = require('googleapis');
const { supabase } = require('../config/supabase');
const { findExistingDuplicate } = require('../services/eventDedupe');

const router = express.Router();

function createOAuth2Client(tokens) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
  oauth2Client.setCredentials(tokens);
  return oauth2Client;
}

function parseGoogleEventTiming(start) {
  if (!start) {
    return { rawDate: null, eventTime: null, startTime: null };
  }

  if (start.date) {
    return { rawDate: start.date, eventTime: null, startTime: null };
  }

  if (start.dateTime) {
    const parsed = new Date(start.dateTime);
    if (Number.isNaN(parsed.getTime())) {
      return { rawDate: null, eventTime: null, startTime: null };
    }

    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    const hours = parsed.getHours();
    const minutes = String(parsed.getMinutes()).padStart(2, '0');
    const suffix = hours >= 12 ? 'PM' : 'AM';
    const hour12 = hours % 12 || 12;

    return {
      rawDate: `${year}-${month}-${day}`,
      eventTime: `${hour12}:${minutes} ${suffix}`,
      startTime: start.dateTime,
    };
  }

  return { rawDate: null, eventTime: null, startTime: null };
}

function detectSchedulingType(title) {
  const t = title.toLowerCase();
  if (t.includes('exam') || t.includes('final') || t.includes('midterm')) return 'exam';
  if (t.includes('quiz')) return 'quiz';
  if (t.includes('assignment') || t.includes('homework') || t.includes('due') || t.includes('hw')) return 'assignment';
  if (t.includes('lab')) return 'lab';
  if (t.includes('office hours')) return 'office_hours';
  if (t.includes('lecture') || t.includes('class')) return 'class';
  return 'other';
}

function detectPriority(title) {
  const t = title.toLowerCase();
  if (t.includes('exam') || t.includes('final') || t.includes('midterm')) return 5;
  if (t.includes('quiz') || t.includes('assignment') || t.includes('due') || t.includes('homework')) return 4;
  if (t.includes('lab')) return 3;
  return 3;
}

router.get('/calendar/sync/google', async (req, res) => {
  const userId = req.session.userId || req.query.userId;
  const googleTokens = req.session.googleTokens;

  if (!userId || !googleTokens) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const oauth2Client = createOAuth2Client(googleTokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const timeMin = new Date();
    timeMin.setHours(0, 0, 0, 0);

    const timeMax = new Date(timeMin);
    timeMax.setMonth(timeMax.getMonth() + 6);

    const { data } = await calendar.events.list({
      calendarId: 'primary',
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 2500,
    });

    const googleEvents = data.items || [];
    let imported = 0;

    for (const googleEvent of googleEvents) {
      if (googleEvent.status === 'cancelled') continue;
      const googleEventId = googleEvent.id;
      if (!googleEventId) continue;
      // Timed events only; all-day events have end.date, which the calendar
      // shows in the all-day row anyway.
      const endTime = googleEvent.end?.dateTime || null;

      const { data: existing, error: lookupError } = await supabase
        .from('events')
        .select('id, end_time')
        .eq('user_id', userId)
        .eq('source_id', googleEventId)
        .maybeSingle();

      if (lookupError) {
        console.error('Supabase calendar lookup error:', lookupError.message);
        continue;
      }

      if (existing) {
        // Backfill durations for events imported before end_time was saved.
        if (endTime && !existing.end_time) {
          const { error: backfillError } = await supabase
            .from('events')
            .update({ end_time: endTime })
            .eq('id', existing.id);
          if (backfillError) console.error('Supabase calendar end_time backfill error:', backfillError.message);
        }
        continue;
      }

      const { rawDate, eventTime, startTime } = parseGoogleEventTiming(googleEvent.start);
      const title = googleEvent.summary || 'Untitled event';
      const schedulingType = detectSchedulingType(googleEvent.summary || '');

      // Exams we pushed to Google Calendar come back with a new Google id and a
      // reworded title, so the source_id check above can't catch them.
      const similar = await findExistingDuplicate(supabase, userId, {
        title,
        raw_date: rawDate,
        event_time: eventTime,
        scheduling_type: schedulingType,
      });
      if (similar) continue;

      const { error: insertError } = await supabase.from('events').insert({
        user_id: userId,
        title,
        description: googleEvent.description || null,
        raw_date: rawDate,
        event_time: eventTime,
        start_time: startTime,
        end_time: endTime,
        location: googleEvent.location || null,
        source: 'google_calendar',
        source_id: googleEventId,
        scheduling_type: schedulingType,
        priority: detectPriority(googleEvent.summary || ''),
        status: 'approved',
      });

      if (insertError) {
        console.error('Supabase calendar insert error:', insertError.message);
        continue;
      }

      imported += 1;
    }

    res.json({ success: true, imported, total: googleEvents.length });
  } catch (error) {
    console.error('Google Calendar sync error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to sync Google Calendar events' });
  }
});

module.exports = router;