import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';

const API_BASE = 'http://localhost:3000/api';

const PRIORITY_COLORS = {
  5: '#ef4444',
  4: '#f97316',
  3: '#eab308',
  2: '#3b82f6',
  1: '#9ca3af',
};

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

function priorityColor(priority) {
  const level = Math.min(5, Math.max(1, Number(priority) || 1));
  return PRIORITY_COLORS[level] || PRIORITY_COLORS[1];
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

function renderPriorityStars(priority) {
  const count = Math.min(5, Math.max(1, Number(priority) || 1));
  return '★'.repeat(count);
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
    events.forEach((event) => {
      const parsed = parseEventDate(event.raw_date);
      if (parsed) {
        withDates.push({ ...event, parsedDate: parsed });
      } else {
        withoutDates.push(event);
      }
    });
    console.log('Scheduled:', withDates.length, 'Unscheduled:', withoutDates.length);
    return { scheduled: withDates, unscheduled: withoutDates };
  }, [events]);

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
      <header style={{
        padding: '1.25rem 0',
        borderBottom: '1px solid var(--border)',
        background: 'rgba(13, 19, 36, 0.8)',
        backdropFilter: 'blur(12px)',
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}
      >
        <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <Link to="/" style={{ fontSize: '1.35rem', fontWeight: 700, background: 'var(--gradient-hero)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Compass
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <Link to="/dashboard" style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Dashboard</Link>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{userEmail}</span>
          </div>
        </div>
      </header>

      <main style={{ width: '100%', padding: '2rem clamp(1rem, 2.5vw, 2rem) 3rem' }}>
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}
        >
          <h1 style={{ fontSize: '1.8rem', fontWeight: 700 }}>Calendar</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button type="button" className="btn btn-ghost" onClick={goToPreviousMonth} aria-label="Previous month">←</button>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 600, minWidth: '220px', textAlign: 'center' }}>
              {MONTH_NAMES[viewDate.getMonth()]}
              {' '}
              {viewDate.getFullYear()}
            </h2>
            <button type="button" className="btn btn-ghost" onClick={goToNextMonth} aria-label="Next month">→</button>
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {loading ? (
          <div className="loading-block">
            <div className="spinner" />
            <p>Loading events…</p>
          </div>
        ) : (
          <>
            <section style={{
              display: 'grid',
              gridTemplateColumns: selectedDate ? 'minmax(0, 1fr) minmax(320px, 360px)' : 'minmax(0, 1fr)',
              gap: '1.5rem',
              alignItems: 'start',
            }}
            >
              <div style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                overflow: 'hidden',
              }}
              >
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                  borderBottom: '1px solid var(--border)',
                }}
                >
                  {WEEKDAYS.map((day) => (
                    <div key={day} style={{
                      textAlign: 'center',
                      fontSize: '0.77rem',
                      fontWeight: 700,
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      padding: '0.85rem 0.4rem',
                    }}
                    >
                      {day}
                    </div>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
                  {monthGrid.map((cell) => {
                    const dayEvents = scheduled.filter((event) => isSameDay(event.parsedDate, cell.date));
                    const isToday = isSameDay(cell.date, today);
                    const isSelected = selectedDate && isSameDay(cell.date, selectedDate);
                    return (
                      <button
                        key={cell.date.toISOString()}
                        type="button"
                        onClick={() => setSelectedDate(new Date(cell.date))}
                        style={{
                          minHeight: '120px',
                          textAlign: 'left',
                          padding: '0.55rem',
                          background: isSelected ? 'rgba(99, 102, 241, 0.17)' : 'var(--bg-surface)',
                          color: 'var(--text)',
                          border: '1px solid var(--border)',
                          borderTop: 0,
                          borderLeft: 0,
                          opacity: cell.isCurrentMonth ? 1 : 0.48,
                          outline: 'none',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.5rem',
                        }}
                      >
                        <span style={{
                          width: '1.95rem',
                          height: '1.95rem',
                          borderRadius: '50%',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.83rem',
                          fontWeight: 700,
                          color: isToday || isSelected ? '#fff' : 'var(--text-muted)',
                          background: isToday || isSelected ? 'var(--accent)' : 'transparent',
                        }}
                        >
                          {cell.date.getDate()}
                        </span>
                        <div style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.35rem',
                          width: '100%',
                          overflow: 'hidden',
                        }}
                        >
                          {dayEvents.slice(0, 4).map((event) => (
                            <div
                              key={event.id}
                              title={event.title}
                              style={{
                                borderLeft: `3px solid ${priorityColor(event.priority)}`,
                                background: 'rgba(255, 255, 255, 0.06)',
                                borderRadius: '6px',
                                fontSize: '0.72rem',
                                lineHeight: 1.3,
                                padding: '0.22rem 0.4rem',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                width: '100%',
                                maxWidth: '100%',
                              }}
                            >
                              {event.title}
                            </div>
                          ))}
                          {dayEvents.length > 4 ? (
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                              +
                              {dayEvents.length - 4}
                              {' '}
                              more
                            </span>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {selectedDate ? (
                <aside style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-lg)',
                  padding: '1rem',
                  position: 'sticky',
                  top: '5.6rem',
                  maxHeight: 'calc(100vh - 7rem)',
                  overflow: 'auto',
                }}
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '0.9rem',
                  }}
                  >
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                      {formatFullDate(selectedDate)}
                    </h3>
                    <button type="button" className="btn btn-ghost" onClick={() => setSelectedDate(null)} style={{ padding: '0.45rem 0.8rem' }}>
                      Close
                    </button>
                  </div>

                  <div style={{ display: 'grid', gap: '0.7rem', marginBottom: '1rem' }}>
                    {selectedDayEvents.length === 0 ? (
                      <div style={{
                        border: '1px dashed var(--border)',
                        borderRadius: '10px',
                        padding: '0.9rem',
                        color: 'var(--text-muted)',
                        fontSize: '0.9rem',
                      }}
                      >
                        No events for this day.
                      </div>
                    ) : (
                      selectedDayEvents.map((event) => (
                        <article
                          key={event.id}
                          style={{
                            border: `1px solid ${priorityColor(event.priority)}55`,
                            borderLeft: `4px solid ${priorityColor(event.priority)}`,
                            borderRadius: '10px',
                            padding: '0.7rem 0.8rem',
                            background: 'rgba(15, 23, 42, 0.5)',
                          }}
                        >
                          <h4 style={{ fontSize: '0.95rem', marginBottom: '0.2rem', fontWeight: 600 }}>{event.title}</h4>
                          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            Time: {getEventTimeLabel(event) || 'Not set'}
                          </p>
                          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Location: {getEventLocation(event)}</p>
                          {event.status === 'approved' && formatDepartureTime(event.departure_time) && (
                            <p style={{ fontSize: '0.8rem', color: 'var(--accent-soft)' }}>
                              Depart by {formatDepartureTime(event.departure_time)}
                            </p>
                          )}
                          <p style={{ fontSize: '0.84rem', color: priorityColor(event.priority), marginTop: '0.3rem' }}>
                            {renderPriorityStars(event.priority)}
                          </p>
                        </article>
                      ))
                    )}
                  </div>

                  <div style={{
                    borderTop: '1px solid var(--border)',
                    paddingTop: '0.9rem',
                  }}
                  >
                    <h4 style={{ fontSize: '0.87rem', color: 'var(--text-muted)', marginBottom: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                      Daily Timeline
                    </h4>
                    <div style={{ display: 'grid', gap: '0.45rem' }}>
                      {DAY_HOURS.map((hour) => {
                        const hourlyEvents = selectedDayEventsByHour.get(hour) || [];
                        return (
                          <div key={hour} style={{
                            display: 'grid',
                            gridTemplateColumns: '72px minmax(0, 1fr)',
                            gap: '0.5rem',
                            alignItems: 'start',
                          }}
                          >
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', paddingTop: '0.25rem' }}>
                              {formatHourLabel(hour)}
                            </span>
                            <div style={{
                              border: '1px solid var(--border)',
                              borderRadius: '8px',
                              minHeight: '2.15rem',
                              padding: '0.25rem',
                              background: 'rgba(255, 255, 255, 0.02)',
                              display: 'grid',
                              gap: '0.3rem',
                            }}
                            >
                              {hourlyEvents.map((event) => (
                                <div
                                  key={`${event.id}-hour-${hour}`}
                                  style={{
                                    borderLeft: `3px solid ${priorityColor(event.priority)}`,
                                    background: 'rgba(255, 255, 255, 0.05)',
                                    borderRadius: '6px',
                                    padding: '0.22rem 0.35rem',
                                    fontSize: '0.72rem',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                  }}
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
                </aside>
              ) : null}
            </section>

            <section style={{
              marginTop: '1.5rem',
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '1rem',
            }}
            >
              <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.9rem' }}>Unscheduled Events</h3>
              {unscheduled.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No unscheduled events.</p>
              ) : (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                  gap: '0.8rem',
                }}
                >
                  {unscheduled.map((event) => (
                    <article
                      key={event.id}
                      style={{
                        borderLeft: `4px solid ${priorityColor(event.priority)}`,
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--border)',
                        borderRadius: '10px',
                        padding: '0.75rem',
                      }}
                    >
                      <p style={{ fontSize: '0.88rem', fontWeight: 600, marginBottom: '0.25rem' }}>{event.title}</p>
                      {event.raw_date ? (
                        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{event.raw_date}</p>
                      ) : null}
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