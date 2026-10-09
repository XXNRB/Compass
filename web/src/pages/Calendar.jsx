import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import AppHeader from '../components/AppHeader.jsx';
import Icon from '../components/Icon.jsx';
import { PriorityTag } from '../components/Priority.jsx';
import { AccountTag, EmailFilter, useEmailFilter } from '../components/EmailFilter.jsx';
import { SourceBadge, SourceLegend, TypeBadge, sourceKey } from '../components/EventBadges.jsx';
import WeekView from '../components/WeekView.jsx';
import { formatTimeRange, getEventTiming, isSameDay } from '../lib/eventTime.js';
import { API_BASE } from '../api.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const VIEW_KEY = 'compassCalendarView';

function readView() {
  try {
    return localStorage.getItem(VIEW_KEY) === 'week' ? 'week' : 'month';
  } catch {
    return 'month';
  }
}

function buildMonthGrid(viewDate) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startWeekday = firstDay.getDay();
  const daysInMonth = lastDay.getDate();
  const cells = [];
  const prevMonthLast = new Date(year, month, 0).getDate();
  for (let i = startWeekday - 1; i >= 0; i -= 1) {
    cells.push({ date: new Date(year, month - 1, prevMonthLast - i), isCurrentMonth: false });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ date: new Date(year, month, day), isCurrentMonth: true });
  }
  let nextDay = 1;
  while (cells.length < 42) {
    cells.push({ date: new Date(year, month + 1, nextDay), isCurrentMonth: false });
    nextDay += 1;
  }
  return cells;
}

function startOfWeek(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - date.getDay());
}

// All-day events first, then by start time.
function byStart(a, b) {
  const sa = a.timing.start ?? -1;
  const sb = b.timing.start ?? -1;
  return sa - sb;
}

function timeLabel(event) {
  if (event.timing.start === null) return event.event_time || 'All day';
  return formatTimeRange(event.timing.start, event.timing.end);
}

const SHORT_MONTHS = MONTH_NAMES.map((name) => name.slice(0, 3));

// "Oct 4 – 10, 2026", "Sep 27 – Oct 3, 2026", "Dec 27, 2026 – Jan 2, 2027"
function weekLabel(weekStart) {
  const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6);
  const sameMonth = weekStart.getMonth() === weekEnd.getMonth();
  const sameYear = weekStart.getFullYear() === weekEnd.getFullYear();
  const start = `${SHORT_MONTHS[weekStart.getMonth()]} ${weekStart.getDate()}${sameYear ? '' : `, ${weekStart.getFullYear()}`}`;
  const end = `${sameMonth ? '' : `${SHORT_MONTHS[weekEnd.getMonth()]} `}${weekEnd.getDate()}, ${weekEnd.getFullYear()}`;
  return `${start} – ${end}`;
}

function formatDepartureTime(isoString) {
  if (!isoString) return null;
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatFullDate(date) {
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function Calendar() {
  const [userEmail, setUserEmail] = useState('');
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [view, setView] = useState(readView);
  // One date drives both views: month view shows its month, week view its week.
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const emailFilter = useEmailFilter(events);
  const { isVisible } = emailFilter;

  useEffect(() => {
    setUserEmail(localStorage.getItem('compassUserEmail') || 'Not signed in');

    async function fetchEvents() {
      try {
        // Use userId from localStorage as fallback when session is unavailable
        const userId = localStorage.getItem('compassUserId');
        const url = userId
          ? `${API_BASE}/events?userId=${userId}`
          : `${API_BASE}/events`;

        const { data } = await axios.get(url, { withCredentials: true });
        setEvents(data.events || []);
      } catch (err) {
        const message = err.response?.data?.error
          || err.response?.data?.message
          || 'Failed to load events.';
        setError(message);
        setEvents([]);
      } finally {
        setLoading(false);
      }
    }

    fetchEvents();
  }, []);

  function changeView(next) {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Non-fatal: the view just won't be remembered.
    }
  }

  const { scheduled, unscheduled } = useMemo(() => {
    const withDates = [];
    const withoutDates = [];
    events.filter(isVisible).forEach((event) => {
      const timing = getEventTiming(event);
      if (timing.date) {
        withDates.push({ ...event, timing });
      } else {
        withoutDates.push(event);
      }
    });
    withDates.sort(byStart);
    return { scheduled: withDates, unscheduled: withoutDates };
  }, [events, isVisible]);

  const monthStart = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
  const weekStart = useMemo(() => startOfWeek(anchorDate), [anchorDate]);
  const monthGrid = useMemo(
    () => buildMonthGrid(new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1)),
    [anchorDate],
  );
  const today = new Date();

  const selectedDayEvents = useMemo(
    () => (selectedDate
      ? scheduled.filter((event) => isSameDay(event.timing.date, selectedDate))
      : []),
    [selectedDate, scheduled],
  );

  function step(direction) {
    setAnchorDate((prev) => (view === 'week'
      ? new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 7 * direction)
      : new Date(prev.getFullYear(), prev.getMonth() + direction, 1)));
  }

  const periodLabel = view === 'week'
    ? weekLabel(weekStart)
    : `${MONTH_NAMES[monthStart.getMonth()]} ${monthStart.getFullYear()}`;

  return (
    <div className="page">
      <AppHeader userEmail={userEmail} wide />

      <main className="container container--wide main">
        <div className="page-head cal-head">
          <div className="cal-head-left">
            <h1 className="page-title">Calendar</h1>
            <h2 className="cal-period">{periodLabel}</h2>
          </div>
          <div className="cal-toolbar">
            <button type="button" className="btn btn-outline" onClick={() => setAnchorDate(new Date())}>
              Today
            </button>
            <div className="cal-nav">
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => step(-1)}
                aria-label={view === 'week' ? 'Previous week' : 'Previous month'}
              >
                <Icon name="chevron-left" />
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => step(1)}
                aria-label={view === 'week' ? 'Next week' : 'Next month'}
              >
                <Icon name="chevron-right" />
              </button>
            </div>
            <div className="segmented" role="group" aria-label="Calendar view">
              {['month', 'week'].map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`segmented-option${view === option ? ' is-active' : ''}`}
                  aria-pressed={view === option}
                  onClick={() => changeView(option)}
                >
                  {option === 'month' ? 'Month' : 'Week'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <EmailFilter filter={emailFilter} />
        <SourceLegend />

        {error && (
          <div className="notice notice--error" role="alert">
            <Icon name="alert" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="loading-block">
            <span className="spinner" aria-hidden="true" />
            <span>Loading events</span>
          </div>
        ) : (
          <>
            <section className={`cal-layout${selectedDate ? ' cal-layout--open' : ''}`}>
              {view === 'week' ? (
                <WeekView
                  weekStart={weekStart}
                  events={scheduled}
                  selectedDate={selectedDate}
                  onSelectDay={(day) => setSelectedDate(new Date(day))}
                />
              ) : (
                <div className="cal-board">
                  <div className="cal-weekdays">
                    {WEEKDAYS.map((day) => (
                      <div key={day} className="cal-weekday">{day}</div>
                    ))}
                  </div>
                  <div className="cal-grid">
                    {monthGrid.map((cell) => {
                      const dayEvents = scheduled.filter((event) => isSameDay(event.timing.date, cell.date));
                      const isToday = isSameDay(cell.date, today);
                      const isSelected = selectedDate && isSameDay(cell.date, selectedDate);
                      const classes = [
                        'cal-cell',
                        !cell.isCurrentMonth && 'cal-cell--muted',
                        isToday && 'cal-cell--today',
                        isSelected && 'cal-cell--selected',
                      ].filter(Boolean).join(' ');

                      return (
                        <button
                          key={cell.date.toISOString()}
                          type="button"
                          className={classes}
                          onClick={() => setSelectedDate(new Date(cell.date))}
                          aria-label={`${formatFullDate(cell.date)}, ${dayEvents.length} event${dayEvents.length !== 1 ? 's' : ''}`}
                          aria-pressed={!!isSelected}
                        >
                          <span className="cal-daynum">{cell.date.getDate()}</span>
                          <div className="cal-events">
                            {dayEvents.slice(0, 4).map((event) => (
                              <div
                                key={event.id}
                                className="cal-pill"
                                data-source={sourceKey(event)}
                                title={`${event.title} · ${timeLabel(event)}`}
                              >
                                {event.timing.start !== null && (
                                  <span className="cal-pill-time">{formatTimeRange(event.timing.start, null)}</span>
                                )}
                                <span className="cal-pill-title">{event.title}</span>
                              </div>
                            ))}
                            {dayEvents.length > 4 ? (
                              <span className="cal-more">
                                +{dayEvents.length - 4} more
                              </span>
                            ) : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {selectedDate ? (
                <aside className="day-panel" aria-label="Day details">
                  <div className="day-panel-head">
                    <div>
                      <p className="day-panel-weekday">
                        {selectedDate.toLocaleDateString(undefined, { weekday: 'long' })}
                      </p>
                      <h3 className="day-panel-date">
                        {selectedDate.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                      </h3>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon"
                      onClick={() => setSelectedDate(null)}
                      aria-label="Close day details"
                    >
                      <Icon name="x" />
                    </button>
                  </div>

                  <div className="day-panel-body">
                    <div className="day-events">
                      {selectedDayEvents.length === 0 ? (
                        <div className="day-empty">No events for this day.</div>
                      ) : (
                        selectedDayEvents.map((event) => (
                          <article
                            key={event.id}
                            className="day-event"
                            data-source={sourceKey(event)}
                          >
                            <h4 className="day-event-title">{event.title}</h4>
                            <p className="fact">
                              <Icon name="clock" />
                              {timeLabel(event)}
                            </p>
                            {event.location && (
                              <p className="fact">
                                <Icon name="pin" />
                                {event.location}
                              </p>
                            )}
                            {event.status === 'approved' && formatDepartureTime(event.departure_time) && (
                              <p className="fact">
                                <Icon name="navigation" />
                                Depart by {formatDepartureTime(event.departure_time)}
                              </p>
                            )}
                            <div className="day-event-badges">
                              <SourceBadge event={event} />
                              <TypeBadge event={event} />
                              <PriorityTag priority={event.priority} />
                            </div>
                            <AccountTag
                              email={event.source_email}
                              color={emailFilter.colorFor(event.source_email)}
                            />
                          </article>
                        ))
                      )}
                    </div>
                  </div>
                </aside>
              ) : null}
            </section>

            <section className="unscheduled">
              <h3 className="section-label">
                Unscheduled
                <span className="count">{unscheduled.length}</span>
              </h3>
              {unscheduled.length === 0 ? (
                <p className="page-subtitle">No unscheduled events.</p>
              ) : (
                <div className="unscheduled-grid">
                  {unscheduled.map((event) => (
                    <article
                      key={event.id}
                      className="unscheduled-item"
                      data-source={sourceKey(event)}
                    >
                      <p>{event.title}</p>
                      {event.raw_date ? <p>{event.raw_date}</p> : null}
                      <div className="day-event-badges">
                        <SourceBadge event={event} />
                        <TypeBadge event={event} />
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

export default Calendar;
