// ============================================================================
// Schedulo - Syllabus scanner
// Extracts scheduling events from syllabus PDF text via Claude, and optionally
// inserts high-priority items into the user's Google Calendar.
// ============================================================================

const { google } = require('googleapis');

const SYLLABUS_SYSTEM_PROMPT = `You are an academic scheduling assistant. Extract ALL dates and events from this syllabus. Return ONLY a valid JSON array where each item has: eventTitle (string), eventDate (string in format YYYY-MM-DD if possible, otherwise as written), eventTime (string or null), location (string or null), priority (number 1-5: exams=5, quizzes=4, assignments=3, readings=2, other=1), schedulingType (one of: exam, quiz, assignment, class, office_hours, deadline, other), addToGoogleCalendar (boolean: true for exams quiz assignments deadlines, false for readings and other low priority items), reasoning (string). Return empty array if no dates found.`;

/**
 * Builds an OAuth2 client from stored Google tokens.
 *
 * @param {object} tokens - Google OAuth token payload
 * @returns {import('googleapis').Auth.OAuth2Client}
 */
function createOAuth2Client(tokens) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
  oauth2Client.setCredentials(tokens);
  return oauth2Client;
}

/**
 * Parses JSON from Claude's text response (handles optional markdown fences).
 *
 * @param {string} text
 * @returns {unknown}
 */
function parseClaudeJson(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(jsonText);
}

/**
 * Tries to normalize a date string into YYYY-MM-DD for Google Calendar.
 * Returns null when the value cannot be interpreted as a calendar date.
 *
 * @param {string|null|undefined} eventDate
 * @returns {string|null}
 */
function toCalendarDate(eventDate) {
  if (!eventDate || typeof eventDate !== 'string') return null;

  const trimmed = eventDate.trim();
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;

  const date = new Date(parsed);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parses a human-readable time string into { hours, minutes } in 24-hour form.
 * Supports values like "2:30 PM", "14:00", or "9am".
 *
 * @param {string|null|undefined} eventTime
 * @returns {{ hours: number, minutes: number }|null}
 */
function parseEventTime(eventTime) {
  if (!eventTime || typeof eventTime !== 'string') return null;

  const match = eventTime.trim().match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  const period = match[3]?.toUpperCase();

  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  if (hours > 23 || minutes > 59) return null;

  if (period === 'PM' && hours < 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;

  return { hours, minutes };
}

/**
 * Builds Google Calendar start/end payloads.
 * - No time  → all-day event using `date`
 * - With time → timed event using `dateTime` for a 1-hour window
 *
 * @param {string} calendarDate - YYYY-MM-DD
 * @param {string|null|undefined} eventTime
 * @returns {{ start: object, end: object }}
 */
function buildStartEnd(calendarDate, eventTime) {
  const timeParts = parseEventTime(eventTime);

  // All-day event when no usable time is present
  if (!timeParts) {
    // Google all-day end date is exclusive, so add one day
    const endDate = new Date(`${calendarDate}T00:00:00`);
    endDate.setDate(endDate.getDate() + 1);
    const endYear = endDate.getFullYear();
    const endMonth = String(endDate.getMonth() + 1).padStart(2, '0');
    const endDay = String(endDate.getDate()).padStart(2, '0');

    return {
      start: { date: calendarDate },
      end: { date: `${endYear}-${endMonth}-${endDay}` },
    };
  }

  // Timed event: 1-hour duration from the parsed start time
  const start = new Date(`${calendarDate}T00:00:00`);
  start.setHours(timeParts.hours, timeParts.minutes, 0, 0);

  const end = new Date(start.getTime() + 60 * 60 * 1000);

  return {
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
  };
}

/**
 * Sends syllabus PDF text to Claude and returns extracted scheduling events.
 *
 * @param {string} pdfText - Raw text extracted from a syllabus PDF
 * @param {{ courseName?: string, courseCode?: string }|null|undefined} courseInfo
 * @returns {Promise<Array<object>>} Extracted events, or [] on failure / no dates
 */
async function extractEventsFromSyllabus(pdfText, courseInfo) {
  try {
    if (!pdfText || typeof pdfText !== 'string' || !pdfText.trim()) {
      return [];
    }

    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    // Optional course context helps Claude label events clearly
    const courseBits = [];
    if (courseInfo?.courseCode) courseBits.push(`Course code: ${courseInfo.courseCode}`);
    if (courseInfo?.courseName) courseBits.push(`Course name: ${courseInfo.courseName}`);

    const userContent = [
      ...(courseBits.length ? [courseBits.join('\n'), ''] : []),
      'Syllabus text:',
      pdfText,
    ].join('\n');

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: SYLLABUS_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    });

    const textBlock = response.content?.find((block) => block.type === 'text');
    if (!textBlock?.text) {
      return [];
    }

    const parsed = parseClaudeJson(textBlock.text);
    if (!Array.isArray(parsed)) {
      console.error('Syllabus extraction did not return a JSON array');
      return [];
    }

    console.log(
      'Syllabus events extracted:',
      parsed.length,
      courseInfo?.courseCode || courseInfo?.courseName || '',
    );
    return parsed;
  } catch (error) {
    console.error('Syllabus event extraction failed:', error.message);
    return [];
  }
}

/**
 * Inserts a single extracted syllabus event into the user's primary Google Calendar.
 *
 * @param {object} tokens - Google OAuth tokens
 * @param {{
 *   eventTitle: string,
 *   eventDate: string,
 *   eventTime?: string|null,
 *   location?: string|null,
 *   reasoning?: string|null,
 * }} event
 * @returns {Promise<object|null>} Created calendar event, or null on failure
 */
async function addEventToGoogleCalendar(tokens, event) {
  try {
    if (!tokens || !event?.eventTitle || !event?.eventDate) {
      return null;
    }

    const calendarDate = toCalendarDate(event.eventDate);
    if (!calendarDate) {
      console.error('Cannot create calendar event without a parseable date:', event.eventDate);
      return null;
    }

    const oauth2Client = createOAuth2Client(tokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const { start, end } = buildStartEnd(calendarDate, event.eventTime);

    const resource = {
      summary: event.eventTitle,
      location: event.location || undefined,
      description: event.reasoning || undefined,
      start,
      end,
    };

    const { data: created } = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: resource,
    });

    console.log('Google Calendar event created:', created.id, event.eventTitle);
    return created;
  } catch (error) {
    console.error('Google Calendar insert failed:', error.message);
    return null;
  }
}

module.exports = {
  extractEventsFromSyllabus,
  addEventToGoogleCalendar,
};
