import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import AppHeader from '../components/AppHeader.jsx';
import Icon from '../components/Icon.jsx';
import { PriorityTag, clampPriority } from '../components/Priority.jsx';
import { EmailFilter, useEmailFilter } from '../components/EmailFilter.jsx';
import { API_BASE } from '../api.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DAY_HOURS = Array.from({ length: 16 }, (_, i) => i + 7);

function parseEventDate(rawDate) {
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
    const months = ['january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december'];
    const monthIndex = months.indexOf(writtenMatch[1].toLowerCase());
    if (monthIndex !== -1) {
      const written = new Date(
        Number(writtenMatch[3]),
        monthIndex,
        Number(writtenMatch[2]),
      );
      if (!Number.isNaN(written.getTime())) return written;
    }
  }
  return null;
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
  );
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


function getEventTimeLabel(event) {
    return event.event_time || event.time || '';
  }

function getEventLocation(event) {
  return event.location || event.venue || event.place || 'No location';
}

function parseEventHour(event) {
  const value = getEventTimeLabel(event) || event.raw_date || '';
  if (!value) return null;
  const timeMatch = value.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!timeMatch) return null;

  let hour = Number(timeMatch[1]);
  const period = timeMatch[3]?.toUpperCase();

  if (period === 'PM' && hour < 12) hour += 12;
  if (period === 'AM' && hour === 12) hour = 0;
  if (Number.isNaN(hour) || hour < 7 || hour > 22) return null;

  return hour;
}

function formatHourLabel(hour24) {
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:00 ${suffix}`;
}

function formatDepartureTime(isoString) {
  if (!isoString) return null;
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return null;
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  return `${hour12}:${minutes} ${suffix}`;
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
  const [viewDate, setViewDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const emailFilter = useEmailFilter();
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
        console.log('Events loaded:', data.events?.length, data.events);
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

  const { scheduled, unscheduled } = useMemo(() => {
    const withDates = [];
    const withoutDates = [];
    events.filter(isVisible).forEach((event) => {
      const parsed = parseEventDate(event.raw_date);
      if (parsed) {
        withDates.push({ ...event, parsedDate: parsed });
      } else {
        withoutDates.push(event);
      }
    });
    console.log('Scheduled:', withDates.length, 'Unscheduled:', withoutDates.length);
    return { scheduled: withDates, unscheduled: withoutDates };
  }, [events, isVisible]);

  const monthGrid = useMemo(() => buildMonthGrid(viewDate), [viewDate]);
  const today = new Date();
  const activeDate = selectedDate || today;

  const selectedDayEvents = useMemo(
    () => scheduled.filter((event) => isSameDay(event.parsedDate, activeDate)),
    [activeDate, scheduled],
  );

  const selectedDayEventsByHour = useMemo(() => {
    const grouped = new Map();
    DAY_HOURS.forEach((hour) => grouped.set(hour, []));
    selectedDayEvents.forEach((event) => {
      const eventHour = parseEventHour(event);
      if (eventHour !== null && grouped.has(eventHour)) {
        grouped.get(eventHour).push(event);
      }
    });
    return grouped;
  }, [selectedDayEvents]);

  function goToPreviousMonth() {
    setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  }

  function goToNextMonth() {
    setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  }


  return (
    <div className="page">
      <AppHeader userEmail={userEmail} wide />

      <main className="container container--wide main">
        <div className="page-head">
          <h1 className="page-title">Calendar</h1>
          <div className="cal-toolbar">
            <button type="button" className="btn btn-ghost btn-icon" onClick={goToPreviousMonth} aria-label="Previous month">
              <Icon name="chevron-left" />
            </button>
            <h2 className="cal-month">
              {MONTH_NAMES[viewDate.getMonth()]}
              {' '}
              {viewDate.getFullYear()}
            </h2>
            <button type="button" className="btn btn-ghost btn-icon" onClick={goToNextMonth} aria-label="Next month">
              <Icon name="chevron-right" />
            </button>
          </div>
        </div>

        <EmailFilter
          accounts={emailFilter.accounts}
          hidden={emailFilter.hidden}
          onToggle={emailFilter.toggle}
        />

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
              <div className="cal-board">
                <div className="cal-weekdays">
                  {WEEKDAYS.map((day) => (
                    <div key={day} className="cal-weekday">{day}</div>
                  ))}
                </div>
                <div className="cal-grid">
                  {monthGrid.map((cell) => {
                    const dayEvents = scheduled.filter((event) => isSameDay(event.parsedDate, cell.date));
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
                              data-level={clampPriority(event.priority)}
                              title={event.title}
                            >
                              {event.title}
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
                            data-level={clampPriority(event.priority)}
                          >
                            <h4 className="day-event-title">{event.title}</h4>
                            <p className="fact">
                              <Icon name="clock" />
                              {getEventTimeLabel(event) || 'Time not set'}
                            </p>
                            <p className="fact">
                              <Icon name="pin" />
                              {getEventLocation(event)}
                            </p>
                            {event.status === 'approved' && formatDepartureTime(event.departure_time) && (
                              <p className="fact">
                                <Icon name="navigation" />
                                Depart by {formatDepartureTime(event.departure_time)}
                              </p>
                            )}
                            <PriorityTag priority={event.priority} />
                          </article>
                        ))
                      )}
                    </div>

                    <div>
                      <h4 className="section-label">Timeline</h4>
                      <div className="timeline">
                        {DAY_HOURS.map((hour) => {
                          const hourlyEvents = selectedDayEventsByHour.get(hour) || [];
                          return (
                            <div key={hour} className="timeline-row">
                              <span className="timeline-hour">{formatHourLabel(hour)}</span>
                              <div className="timeline-slot">
                                {hourlyEvents.map((event) => (
                                  <div
                                    key={`${event.id}-hour-${hour}`}
                                    className="cal-pill"
                                    data-level={clampPriority(event.priority)}
                                    title={event.title}
                                  >
                                    {event.title}
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
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
                      data-level={clampPriority(event.priority)}
                    >
                      <p>{event.title}</p>
                      {event.raw_date ? <p>{event.raw_date}</p> : null}
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
