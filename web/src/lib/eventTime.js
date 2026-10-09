// Turns an event row's loosely formatted date/time fields into a local day
// plus start/end minutes, so month pills, week blocks and the day timeline all
// agree on when something happens.
//
// Sources store time differently:
// - Google Calendar: start_time / end_time as ISO timestamps (exact)
// - Syllabus / Gmail: raw_date ("2026-09-02", "June 4, 2026") plus a free-text
//   event_time ("1:00-2:20 PM", "6:30 PM - 8:30 PM", "11:59 PM")

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];

const MINUTES_PER_DAY = 24 * 60;

export function parseEventDate(rawDate) {
  if (!rawDate || typeof rawDate !== 'string') return null;
  const trimmed = rawDate.trim();
  if (!trimmed) return null;

  // Only parse if it contains a specific day number
  // Reject vague dates like "Summer 2026", "Fall 2025", etc.
  if (!/\d{1,2}/.test(trimmed) || !/\d{4}/.test(trimmed)) return null;

  const isoMatch = trimmed.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    // Construct in local time directly — Date.parse() on a date-only ISO
    // string treats it as UTC midnight, which rolls back a day in any
    // timezone behind UTC once local getters (getDate/getDay) are used.
    const isoParsed = new Date(Number(y), Number(m) - 1, Number(d));
    if (!Number.isNaN(isoParsed.getTime())) return isoParsed;
  }

  const slashMatch = trimmed.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (slashMatch) {
    const [, m, d, y] = slashMatch;
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    const slashParsed = new Date(year, Number(m) - 1, Number(d));
    if (!Number.isNaN(slashParsed.getTime())) return slashParsed;
  }

  // Handle "Month Day, Year" format e.g. "June 4, 2026"
  const writtenMatch = trimmed.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (writtenMatch) {
    const monthIndex = MONTHS.indexOf(writtenMatch[1].toLowerCase());
    if (monthIndex !== -1) {
      const written = new Date(Number(writtenMatch[3]), monthIndex, Number(writtenMatch[2]));
      if (!Number.isNaN(written.getTime())) return written;
    }
  }
  return null;
}

// Hour/minute/period → minutes after midnight. period may be undefined (24h clock).
function toMinutes(hour, minute, period) {
  let h = Number(hour);
  const m = Number(minute || 0);
  if (Number.isNaN(h) || Number.isNaN(m) || m > 59) return null;
  if (period) {
    if (h < 1 || h > 12) return null;
    const pm = period.toLowerCase().startsWith('p');
    if (pm && h < 12) h += 12;
    if (!pm && h === 12) h = 0;
  } else if (h > 23) {
    return null;
  }
  return h * 60 + m;
}

const CLOCK = String.raw`(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?`;
const RANGE_RE = new RegExp(`${CLOCK}\\s*(?:-|–|—|to)\\s*${CLOCK}`, 'i');
const SINGLE_RE = new RegExp(CLOCK, 'gi');

/**
 * Parses a free-text time into { start, end } minutes (end may be null).
 * Handles "1:00-2:20 PM" (period shared by both ends), "6:30 PM - 8:30 PM",
 * "11:59 PM", "14:00", and "noon". Bare numbers like "3" are ignored — too
 * ambiguous to place on a grid.
 */
export function parseTimeText(text) {
  if (!text || typeof text !== 'string') return null;
  const value = text.trim().toLowerCase();
  if (!value) return null;
  if (/\bnoon\b/.test(value)) return { start: 12 * 60, end: null };
  if (/\bmidnight\b/.test(value)) return { start: MINUTES_PER_DAY - 1, end: null };

  const range = value.match(RANGE_RE);
  if (range) {
    const [, h1, m1, p1, h2, m2, p2] = range;
    if ((m1 || p1) || (m2 || p2)) {
      const endPeriod = p2 || p1;
      let start = toMinutes(h1, m1, p1 || endPeriod);
      const end = toMinutes(h2, m2, endPeriod);
      // "11:00-1:00 PM": inheriting PM would put the start after the end,
      // so the start is actually in the morning.
      if (start !== null && end !== null && !p1 && start > end) start -= 12 * 60;
      if (start !== null && start >= 0) {
        return { start, end: end !== null && end > start ? end : null };
      }
    }
  }

  for (const match of value.matchAll(SINGLE_RE)) {
    const [, h, m, p] = match;
    if (!m && !p) continue;
    const start = toMinutes(h, m, p);
    if (start !== null) return { start, end: null };
  }
  return null;
}

function minutesOfDay(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Resolves an event row to { date, start, end } in the viewer's local time.
 * date is the local day (or null if unscheduled); start/end are minutes after
 * midnight, null when the event has no time (all-day).
 */
export function getEventTiming(event) {
  if (event.start_time && String(event.start_time).includes('T')) {
    const startDate = new Date(event.start_time);
    if (!Number.isNaN(startDate.getTime())) {
      let end = null;
      const endDate = event.end_time ? new Date(event.end_time) : null;
      if (endDate && !Number.isNaN(endDate.getTime()) && endDate > startDate) {
        // Overnight events are clipped to the day they start on.
        end = isSameDay(startDate, endDate) ? minutesOfDay(endDate) : MINUTES_PER_DAY;
      }
      return { date: startOfDay(startDate), start: minutesOfDay(startDate), end };
    }
  }

  const date = parseEventDate(event.raw_date);
  if (!date) return { date: null, start: null, end: null };
  const time = parseTimeText(event.event_time);
  return { date, start: time?.start ?? null, end: time?.end ?? null };
}

export function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
  );
}

export function formatMinutes(minutes, { withPeriod = true } = {}) {
  const clamped = Math.min(Math.max(minutes, 0), MINUTES_PER_DAY - 1);
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  const hour12 = h % 12 || 12;
  const label = `${hour12}:${String(m).padStart(2, '0')}`;
  return withPeriod ? `${label} ${h >= 12 ? 'PM' : 'AM'}` : label;
}

/** "10:00 – 11:20 AM", "11:00 AM – 1:00 PM", or "11:59 PM". */
export function formatTimeRange(start, end) {
  if (start === null || start === undefined) return '';
  if (end === null || end === undefined) return formatMinutes(start);
  const samePeriod = (start >= 720) === (end >= 720);
  return `${formatMinutes(start, { withPeriod: !samePeriod })} – ${formatMinutes(end)}`;
}

export { MINUTES_PER_DAY };
