import Icon from './Icon.jsx';

// Where an event came from. Each key has a matching [data-source] color set in
// styles.css (--src-fg / --src-bg / --src-ink).
export const SOURCES = {
  google_calendar: { label: 'Google Calendar', short: 'Calendar' },
  syllabus: { label: 'Syllabus', short: 'Syllabus' },
  gmail: { label: 'Gmail', short: 'Gmail' },
  outlook: { label: 'Outlook', short: 'Outlook' },
  canvas: { label: 'Canvas', short: 'Canvas' },
};

export function sourceKey(event) {
  return SOURCES[event.source] ? event.source : 'other';
}

export function sourceLabel(event, { short = false } = {}) {
  const source = SOURCES[event.source];
  if (!source) return 'Other';
  return short ? source.short : source.label;
}

// scheduling_type values grouped into the five badge kinds. Types not listed
// here (other, social, ...) get no badge rather than a meaningless "Event".
const TYPE_GROUPS = [
  { kind: 'exam', label: 'Exam', icon: 'exam', types: ['exam', 'quiz'] },
  { kind: 'class', label: 'Class', icon: 'book', types: ['class', 'lab', 'office_hours'] },
  { kind: 'deadline', label: 'Deadline', icon: 'flag', types: ['deadline', 'assignment', 'course_registration', 'financial'] },
  { kind: 'internship', label: 'Internship', icon: 'briefcase', types: ['internship', 'job', 'career_event'] },
  { kind: 'meeting', label: 'Meeting', icon: 'users', types: ['meeting_request', 'availability_request', 'health'] },
];

// More specific wording where it's clearer than the group name.
const TYPE_LABELS = {
  quiz: 'Quiz',
  lab: 'Lab',
  office_hours: 'Office hours',
  assignment: 'Assignment',
  job: 'Job',
  career_event: 'Career event',
};

export function eventType(event) {
  const type = event.scheduling_type;
  const group = TYPE_GROUPS.find((g) => g.types.includes(type));
  if (!group) return null;
  return { ...group, label: TYPE_LABELS[type] || group.label };
}

/** Colored label naming the event's source. */
export function SourceBadge({ event, short = false }) {
  return (
    <span className="src-badge" data-source={sourceKey(event)}>
      <span className="src-dot" aria-hidden="true" />
      {sourceLabel(event, { short })}
    </span>
  );
}

/** Small icon + label for the event's kind (exam, class, deadline, ...). */
export function TypeBadge({ event, iconOnly = false }) {
  const type = eventType(event);
  if (!type) return null;
  return (
    <span className="type-badge" data-kind={type.kind} title={type.label}>
      <Icon name={type.icon} />
      {iconOnly ? <span className="sr-only">{type.label}</span> : type.label}
    </span>
  );
}

const STAGES = {
  applied: 'Applied',
  interviewing: 'Interviewing',
  offer: 'Offer',
  rejected: 'Rejected',
};

/** Where a job/internship application stands (events.stage). */
export function StageBadge({ stage }) {
  if (!STAGES[stage]) return null;
  return (
    <span className="stage-badge" data-stage={stage}>
      {STAGES[stage]}
    </span>
  );
}

/** Color key for the calendar header. */
export function SourceLegend() {
  return (
    <ul className="src-legend" aria-label="Event sources">
      {Object.entries(SOURCES).map(([key, source]) => (
        <li key={key} data-source={key}>
          <span className="src-dot" aria-hidden="true" />
          {source.label}
        </li>
      ))}
    </ul>
  );
}
