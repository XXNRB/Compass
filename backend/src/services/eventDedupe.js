// ============================================================================
// Compass - Event de-duplication
// The same real-world event (an exam, say) reaches the events table under
// different titles: the syllabus says "Midterm Exam", the LLM says
// "CSE 3302 Midterm Exam", and the Google Calendar sync brings back
// "Exam - CSE 3302". Titles can't be compared reliably, so two events are
// treated as the same one when they fall on the same day, have the same type
// and start at (nearly) the same time.
// ============================================================================

// Only these types are collapsed. Anything else ("other", "assignment",
// "lab", ...) legitimately repeats on one day, so matching on date + type
// would delete real events.
const DEDUPE_TYPES = new Set(['exam', 'quiz']);

// Two timed events this close together count as the same slot.
const TIME_TOLERANCE_MINUTES = 30;

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];


function pad(n) {
  return String(n).padStart(2, '0');
}


function toDateKey(year, month, day) {
  const d = new Date(year, month - 1, day);
  // Rejects overflow such as February 31.
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}


// Free-text date -> "YYYY-MM-DD", or null when it isn't one specific day
// (e.g. "Fall 2026", "Week 5"). Unparseable dates are never treated as equal.
function parseDateKey(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const text = raw.trim();

  let m = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return toDateKey(Number(m[1]), Number(m[2]), Number(m[3]));

  m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return toDateKey(year, Number(m[1]), Number(m[2]));
  }

  m = text.match(/([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/);
  if (m) {
    const month = MONTHS.findIndex((name) => name.startsWith(m[1].toLowerCase().slice(0, 3))) + 1;
    if (month > 0) return toDateKey(Number(m[3]), month, Number(m[2]));
  }

  return null;
}


// Free-text time -> minutes after midnight for the START time, or null.
// Handles "2:30 PM", "14:30", "9 AM", and ranges like "2:30-4:00 PM" where
// only the end carries the AM/PM marker.
function parseStartMinutes(raw) {
  if (!raw || typeof raw !== 'string') return null;

  const parts = raw.trim().split(/\s*(?:-|–|—|to)\s*/i);
  const parse = (chunk) => {
    const m = chunk.match(/(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m?\.?/i)
      || chunk.match(/(\d{1,2}):(\d{2})()/);
    if (!m) return null;
    return { hour: Number(m[1]), minute: Number(m[2] || 0), meridiem: (m[3] || '').toLowerCase() };
  };

  const start = parse(parts[0]);
  if (!start || start.hour > 23 || start.minute > 59) return null;

  let { meridiem } = start;
  if (!meridiem && parts[1]) {
    // "2:30-4:00 PM": the start inherits the end's marker unless that would
    // put the start after the end.
    const end = parse(parts[1]);
    if (end?.meridiem) {
      meridiem = end.meridiem;
      const startAt = ((start.hour % 12) + (meridiem === 'p' ? 12 : 0)) * 60 + start.minute;
      const endAt = ((end.hour % 12) + (end.meridiem === 'p' ? 12 : 0)) * 60 + end.minute;
      if (startAt > endAt) meridiem = meridiem === 'p' ? 'a' : 'p';
    }
  }

  let hour = start.hour;
  if (meridiem === 'p' && hour < 12) hour += 12;
  if (meridiem === 'a' && hour === 12) hour = 0;
  return hour * 60 + start.minute;
}


// "CSE 3302", "cse3302", "MATH-101" -> "CSE3302". Null when there is none.
function extractCourseCode(title) {
  if (!title) return null;
  const m = String(title).toUpperCase().match(/\b([A-Z]{2,5})[\s-]?(\d{3,4}[A-Z]?)\b/);
  return m ? `${m[1]}${m[2]}` : null;
}


// Compares one event to another, whichever shape each arrives in. Accepts DB
// rows (raw_date, event_time, scheduling_type) and syllabus/LLM output
// (eventDate, eventTime, schedulingType).
function normalize(event) {
  return {
    type: (event.scheduling_type ?? event.schedulingType ?? '').toLowerCase(),
    dateKey: parseDateKey(event.raw_date ?? event.eventDate),
    minutes: parseStartMinutes(event.event_time ?? event.eventTime),
    course: extractCourseCode(event.title ?? event.eventTitle),
  };
}


function areDuplicates(a, b) {
  const x = normalize(a);
  const y = normalize(b);

  if (!DEDUPE_TYPES.has(x.type) || x.type !== y.type) return false;
  if (!x.dateKey || x.dateKey !== y.dateKey) return false;

  // Different course codes mean different exams, even at the same time.
  if (x.course && y.course && x.course !== y.course) return false;

  // Missing times are treated as "unknown", so a timed row and an untimed
  // one for the same day are still the same event.
  if (x.minutes !== null && y.minutes !== null
    && Math.abs(x.minutes - y.minutes) > TIME_TOLERANCE_MINUTES) return false;

  return true;
}


// Higher = more worth keeping: has a location, then longer title, then has a
// time, then longer description; approved beats pending; older wins ties.
function detailScore(event) {
  return [
    event.location ? 1 : 0,
    (event.title || '').length,
    event.event_time ? 1 : 0,
    (event.description || '').length,
    event.status === 'approved' ? 1 : 0,
    -new Date(event.created_at || 0).getTime(),
  ];
}


function compareDetail(a, b) {
  const x = detailScore(a);
  const y = detailScore(b);
  for (let i = 0; i < x.length; i += 1) {
    if (x[i] !== y[i]) return y[i] - x[i];
  }
  return 0;
}


// Returns [{ keep, remove: [...] }] for every set of duplicate rows.
// Rows are visited most-detailed first and each is compared to a group's
// keeper only (never to other members), so a vague row with no time or course
// code can't bridge two different exams into one group.
function findDuplicateGroups(rows) {
  const candidates = rows
    .filter((row) => {
      const { type, dateKey } = normalize(row);
      return DEDUPE_TYPES.has(type) && dateKey;
    })
    .sort(compareDetail);

  const groups = [];
  for (const row of candidates) {
    const group = groups.find((g) => areDuplicates(g.keep, row));
    if (group) {
      group.remove.push(row);
    } else {
      groups.push({ keep: row, remove: [] });
    }
  }

  return groups.filter((g) => g.remove.length > 0);
}


// Insert-time guard: returns the user's existing row that `candidate` would
// duplicate, or null. Accepts DB-shaped or LLM-shaped candidates. Fails open:
// if the lookup errors, the caller inserts rather than silently dropping an
// event the user may need.
async function findExistingDuplicate(supabase, userId, candidate) {
  const { type, dateKey } = normalize(candidate);
  if (!DEDUPE_TYPES.has(type) || !dateKey) return null;

  const { data, error } = await supabase
    .from('events')
    .select('id, title, raw_date, event_time, scheduling_type, location, description, status, created_at')
    .eq('user_id', userId)
    .eq('scheduling_type', type);

  if (error) {
    console.error('Duplicate lookup error:', error.message);
    return null;
  }

  return (data || []).find((row) => areDuplicates(row, candidate)) || null;
}


// Finds (and, unless dryRun, deletes) one user's duplicate events. Always
// scoped to userId, and returns what was kept and removed per group.
async function deduplicateUserEvents(supabase, userId, { dryRun = false } = {}) {
  const PAGE = 1000;
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) throw new Error(`Failed to load events: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) break;
  }

  const groups = findDuplicateGroups(rows);
  const ids = groups.flatMap((g) => g.remove.map((r) => r.id));

  if (!dryRun) {
    for (let i = 0; i < ids.length; i += 100) {
      const { error } = await supabase
        .from('events')
        .delete()
        .eq('user_id', userId)
        .in('id', ids.slice(i, i + 100));

      if (error) throw new Error(`Failed to delete duplicates: ${error.message}`);
    }
  }

  const brief = (r) => ({ id: r.id, title: r.title, date: r.raw_date, time: r.event_time });
  return {
    dryRun,
    scanned: rows.length,
    removed: ids.length,
    groups: groups.map((g) => ({ kept: brief(g.keep), removed: g.remove.map(brief) })),
  };
}


module.exports = {
  DEDUPE_TYPES,
  findExistingDuplicate,
  deduplicateUserEvents,
  TIME_TOLERANCE_MINUTES,
  parseDateKey,
  parseStartMinutes,
  extractCourseCode,
  areDuplicates,
  findDuplicateGroups,
};
