import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { SourceBadge, TypeBadge, sourceKey } from './EventBadges.jsx';
import { MINUTES_PER_DAY, formatTimeRange, isSameDay } from '../lib/eventTime.js';

const HOUR_PX = 64;
const PX_PER_MIN = HOUR_PX / 60;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
// Events with no end time: deadlines are a point in time, so they get a short
// marker; everything else is assumed to last an hour.
const DEADLINE_KINDS = new Set(['deadline', 'assignment', 'course_registration', 'financial']);
const MIN_BLOCK_MIN = 24;

function hourLabel(hour) {
  if (hour === 0) return '';
  const suffix = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 || 12} ${suffix}`;
}

function displayEnd(event) {
  if (event.timing.end !== null) return event.timing.end;
  const assumed = DEADLINE_KINDS.has(event.scheduling_type) ? 30 : 60;
  return event.timing.start + assumed;
}

/**
 * Side-by-side columns for overlapping events, like Google Calendar: each
 * cluster of mutually overlapping events splits the day column evenly.
 */
function layoutDay(dayEvents) {
  const sorted = dayEvents
    .map((event) => {
      const end = Math.min(displayEnd(event), MINUTES_PER_DAY);
      // Keep very late events fully visible by ending them at midnight.
      const visualEnd = Math.max(end, event.timing.start + MIN_BLOCK_MIN);
      const shift = Math.max(0, visualEnd - MINUTES_PER_DAY);
      return { event, top: event.timing.start - shift, bottom: visualEnd - shift };
    })
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom);

  const placed = [];
  let cluster = [];
  let clusterEnd = -1;
  let columns = [];

  function closeCluster() {
    cluster.forEach((item) => { item.cols = columns.length; });
    placed.push(...cluster);
    cluster = [];
    columns = [];
  }

  for (const item of sorted) {
    if (item.top >= clusterEnd && cluster.length) closeCluster();
    let col = columns.findIndex((end) => end <= item.top);
    if (col === -1) {
      col = columns.length;
      columns.push(item.bottom);
    } else {
      columns[col] = item.bottom;
    }
    item.col = col;
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.bottom);
  }
  if (cluster.length) closeCluster();
  return placed;
}

function nowMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function EventBlock({ item, onSelect }) {
  const { event } = item;
  const height = (item.bottom - item.top) * PX_PER_MIN;
  const time = formatTimeRange(event.timing.start, event.timing.end);
  const compact = height < 44;
  const roomy = height >= 60;

  const details = [event.title, time, event.location].filter(Boolean).join('\n');

  return (
    <button
      type="button"
      className={`week-event${compact ? ' week-event--compact' : ''}`}
      data-source={sourceKey(event)}
      style={{
        top: item.top * PX_PER_MIN,
        height: height - 2,
        left: `calc(${(item.col / item.cols) * 100}% + 2px)`,
        width: `calc(${100 / item.cols}% - 4px)`,
      }}
      title={details}
      onClick={() => onSelect(event)}
    >
      {compact ? (
        <span className="week-event-line">
          <span className="week-event-title">{event.title}</span>
          <span className="week-event-time">{time}</span>
        </span>
      ) : (
        <>
          <span className="week-event-head">
            <TypeBadge event={event} iconOnly />
            <span className="week-event-title">{event.title}</span>
          </span>
          <span className="week-event-time">{time}</span>
          {roomy && event.location && (
            <span className="week-event-meta">
              <Icon name="pin" />
              <span>{event.location}</span>
            </span>
          )}
          {height >= 84 && <SourceBadge event={event} short />}
        </>
      )}
    </button>
  );
}

/**
 * Seven-day grid with hourly slots. Timed events are positioned by start and
 * duration; events with a date but no time sit in the all-day row.
 *
 * @param {{ weekStart: Date, events: Array, selectedDate: Date|null, onSelectDay: (d: Date) => void }} props
 *   events must carry `timing` from getEventTiming().
 */
function WeekView({ weekStart, events, selectedDate, onSelectDay }) {
  const scrollRef = useRef(null);
  const [now, setNow] = useState(nowMinutes);
  const today = new Date();

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Date(
      weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i,
    )),
    [weekStart],
  );

  const byDay = useMemo(() => days.map((day) => {
    const dayEvents = events.filter((event) => isSameDay(event.timing.date, day));
    return {
      day,
      allDay: dayEvents.filter((event) => event.timing.start === null),
      timed: layoutDay(dayEvents.filter((event) => event.timing.start !== null)),
    };
  }), [days, events]);

  // Open the week scrolled to its first event (or 8 AM), not midnight.
  useEffect(() => {
    const starts = byDay.flatMap((d) => d.timed.map((item) => item.top));
    const first = starts.length ? Math.min(...starts) : 8 * 60;
    const target = Math.max(0, Math.min(first, 8 * 60) - 30);
    if (scrollRef.current) scrollRef.current.scrollTop = target * PX_PER_MIN;
  }, [weekStart]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = setInterval(() => setNow(nowMinutes()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  const hasAllDay = byDay.some((d) => d.allDay.length > 0);

  return (
    <div className="week" ref={scrollRef}>
      <div className="week-inner">
        <div className="week-sticky">
          <div className="week-head">
            <div className="week-gutter" />
            {days.map((day) => {
              const isToday = isSameDay(day, today);
              const isSelected = selectedDate && isSameDay(day, selectedDate);
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  className={`week-dayhead${isToday ? ' is-today' : ''}${isSelected ? ' is-selected' : ''}`}
                  onClick={() => onSelectDay(day)}
                  aria-pressed={!!isSelected}
                >
                  <span className="week-dayname">
                    {day.toLocaleDateString(undefined, { weekday: 'short' })}
                  </span>
                  <span className="week-daynum">{day.getDate()}</span>
                </button>
              );
            })}
          </div>

          {hasAllDay && (
            <div className="week-allday">
              <div className="week-gutter week-gutter-label">All day</div>
              {byDay.map(({ day, allDay }) => (
                <div key={day.toISOString()} className="week-allday-cell">
                  {allDay.map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      className="cal-pill"
                      data-source={sourceKey(event)}
                      title={event.title}
                      onClick={() => onSelectDay(day)}
                    >
                      {event.title}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="week-body" style={{ height: 24 * HOUR_PX }}>
          <div className="week-gutter week-hours">
            {HOURS.map((hour) => (
              <span key={hour} className="week-hour" style={{ top: hour * HOUR_PX }}>
                {hourLabel(hour)}
              </span>
            ))}
          </div>
          {byDay.map(({ day, timed }) => (
            <div
              key={day.toISOString()}
              className={`week-col${isSameDay(day, today) ? ' is-today' : ''}`}
              style={{ backgroundSize: `100% ${HOUR_PX}px` }}
            >
              {timed.map((item) => (
                <EventBlock key={item.event.id} item={item} onSelect={() => onSelectDay(day)} />
              ))}
              {isSameDay(day, today) && (
                <div className="week-now" style={{ top: now * PX_PER_MIN }} aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default WeekView;
