// ============================================================================
// Schedulo - Syllabus scanner
// Extracts scheduling events from syllabus PDF text via Claude, and optionally
// inserts high-priority items into the user's Google Calendar.
// ============================================================================

const { google } = require('googleapis');

const SYLLABUS_SYSTEM_PROMPT = `You are an academic scheduling assistant. You will receive the text of a course syllabus, extracted from a PDF. Text extraction flattens tables: a schedule row like "Week 3 | Tue Sep 16 | Recursion | Quiz 2 due 11:59 PM" may arrive as consecutive lines, and cells can run together without spaces. Reassemble rows from that context, and read every schedule entry plus any policy or grading sections that mention dates.

Look specifically for:
1. Quizzes - every quiz with its date AND time if one is given (in class, online, "due by 11:59 PM", open/close windows).
2. Midterm exams - each midterm with date, time, and room. Watch for "Exam 1", "Midterm 2", "Test", "Prelim".
3. Final exam - date, time, and room. It is often in a separate "Final Exam" or "Important dates" line rather than the weekly table.
4. Projects and papers - every due date (proposals, drafts, checkpoints, final submissions, presentations), with the due time if given.
5. Class schedule patterns - the regular meeting days, times, and location (e.g. "TuTh 10:00-11:20 AM, Ridgley 0016"), plus labs, studios, sections, and office hours.

Rules:
- Dates: return YYYY-MM-DD. Infer the year from the semester/term named in the syllabus. Resolve weekday or week-number references (e.g. "Thursday of Week 5") using the semester start date or the dates in the schedule table. If a date truly can't be pinned to a day, return it as written.
- Times: keep ranges as ranges ("10:00-11:20 AM"). Use null when no time is stated; never invent a time.
- Class meetings: if the schedule table lists dated class sessions, return each dated session as a "class" item (title it with the course and topic). If the syllabus only states a weekly pattern, return ONE "class" item: the first class date if known, the meeting time, the location, and the pattern (days of the week) in reasoning.
- Do not return holidays, breaks, or "no class" days as events.
- One item per event; don't duplicate the same quiz or exam because it appears in two places.
- Keep reasoning to one short phrase.

Return ONLY a valid JSON array (no prose, no markdown) where each item has:
- eventTitle (string, include the course code when known, e.g. "CSE 3302 Midterm Exam 1")
- eventDate (string, YYYY-MM-DD when possible)
- eventTime (string or null)
- location (string or null)
- priority (number 1-5: final/midterm exams=5, quizzes and project/paper deadlines=4, assignments=3, class sessions and readings=2, other=1)
- schedulingType (one of: exam, quiz, assignment, class, office_hours, deadline, other)
- addToGoogleCalendar (boolean: true for exams, quizzes, assignments, project/paper deadlines; false for class sessions, readings, office hours, other)
- reasoning (string)

Return [] if the syllabus contains no dates.`;

// Long semester schedules produce a lot of JSON; 4096 tokens used to cut the
// array off mid-item, which failed to parse and silently returned no events.
const SYLLABUS_MAX_TOKENS = 8000;

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
 * Recovers the complete items from a JSON array that was cut off mid-item
 * (response hit max_tokens). Returns null if nothing usable is left.
 *
 * @param {string} text
 * @returns {Array<object>|null}
 */
function salvageTruncatedArray(text) {
  const start = text.indexOf('[');
  const lastClose = text.lastIndexOf('}');
  if (start === -1 || lastClose <= start) return null;
  try {
    const items = JSON.parse(`${text.slice(start, lastClose + 1)}]`);
    return Array.isArray(items) && items.length ? items : null;
  } catch {
    return null;
  }
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
 * @returns {Promise<Array<object>>} Extracted events ([] when the syllabus has no dates)
 * @throws when the Claude call fails or its response can't be parsed, so the
 *   route can report an error instead of "0 events found"
 */
async function extractEventsFromSyllabus(pdfText, courseInfo) {
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
    max_tokens: SYLLABUS_MAX_TOKENS,
    system: SYLLABUS_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  });

  const textBlock = response.content?.find((block) => block.type === 'text');
  if (!textBlock?.text) {
    throw new Error(`Claude returned no text (stop_reason: ${response.stop_reason})`);
  }

  let parsed;
  if (response.stop_reason === 'max_tokens') {
    // Keep every complete item rather than losing the whole syllabus.
    parsed = salvageTruncatedArray(textBlock.text);
    if (!parsed) throw new Error('Syllabus response was cut off before any complete event');
    console.warn(`Syllabus response hit max_tokens; kept ${parsed.length} complete events`);
  } else {
    parsed = parseClaudeJson(textBlock.text);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Syllabus extraction did not return a JSON array');
  }

  console.log(
    'Syllabus events extracted:',
    parsed.length,
    courseInfo?.courseCode || courseInfo?.courseName || '',
  );
  return parsed;
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
