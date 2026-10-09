import { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { API_BASE } from '../api.js';

const HIDDEN_KEY = 'compassHiddenEmails';
// Filter key for events with no mailbox: syllabus, Canvas, calendar imports,
// and emails scanned before events were tagged with their account.
export const OTHER_SOURCES = '__other__';

// Account colors are deliberately different hues from the source colors
// (blue/green/purple/orange/red) so "which inbox" never reads as "which source".
const ACCOUNT_COLORS = ['#0f9488', '#d1437a', '#5458d1', '#c2850f', '#1d87b8', '#8f6440', '#62758a', '#6b9420'];
const OTHER_COLOR = '#a3a29e';

function readHidden() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]');
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function writeHidden(hidden) {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
  } catch {
    // Non-fatal: the filter just won't be remembered.
  }
}

function hashColor(email) {
  let hash = 0;
  for (const char of email) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return ACCOUNT_COLORS[hash % ACCOUNT_COLORS.length];
}

/**
 * Loads the user's connected email accounts and tracks which ones are
 * toggled off (all shown by default; remembered per browser).
 *
 * Accounts come from connected_emails. Any source_email on the given events
 * that isn't listed there is added too, so the filter still covers every
 * tagged event if the table can't be read or an account was never saved.
 *
 * @param {Array} events - events on the page (used only for that fallback)
 */
export function useEmailFilter(events = []) {
  const [connected, setConnected] = useState([]);
  const [hidden, setHidden] = useState(readHidden);

  const fetchAccounts = useCallback(async () => {
    try {
      const userId = localStorage.getItem('compassUserId') || '';
      const { data } = await axios.get(`${API_BASE}/connected-emails?userId=${userId}`, {
        withCredentials: true,
      });
      setConnected(data.accounts || []);
    } catch {
      // Non-fatal: fall back to the addresses found on events.
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const accounts = useMemo(() => {
    const byEmail = new Map();
    // connected_emails order (oldest first) is the same on every page, so it
    // gives each account the same color on the dashboard and the calendar.
    connected.forEach((account, index) => {
      if (!account.email || byEmail.has(account.email)) return;
      byEmail.set(account.email, {
        email: account.email,
        provider: account.provider,
        color: ACCOUNT_COLORS[index % ACCOUNT_COLORS.length],
      });
    });
    events.forEach((event) => {
      const email = event.source_email;
      if (!email || byEmail.has(email)) return;
      byEmail.set(email, {
        email,
        provider: event.source === 'outlook' ? 'outlook' : 'gmail',
        color: hashColor(email),
      });
    });
    return [...byEmail.values()];
  }, [connected, events]);

  const colorFor = useCallback(
    (email) => accounts.find((account) => account.email === email)?.color || OTHER_COLOR,
    [accounts],
  );

  function toggle(key) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeHidden(next);
      return next;
    });
  }

  function showAll() {
    const next = new Set();
    writeHidden(next);
    setHidden(next);
  }

  const isVisible = useCallback(
    (event) => !hidden.has(event.source_email || OTHER_SOURCES),
    [hidden],
  );

  return {
    accounts,
    connectedAccounts: connected,
    hidden,
    toggle,
    showAll,
    isVisible,
    colorFor,
    refreshAccounts: fetchAccounts,
  };
}

const PROVIDER_LABELS = { gmail: 'Gmail', outlook: 'Outlook' };

/**
 * Filter bar: one checkbox per connected account, each with its color dot,
 * plus "Other sources" for events that didn't come from a mailbox.
 *
 * @param {{ filter: ReturnType<typeof useEmailFilter> }} props
 */
export function EmailFilter({ filter }) {
  const { accounts, hidden, toggle, showAll } = filter;
  if (accounts.length === 0) return null;

  const options = [
    ...accounts.map((account) => ({
      key: account.email,
      label: account.email,
      hint: PROVIDER_LABELS[account.provider] || account.provider,
      color: account.color,
    })),
    { key: OTHER_SOURCES, label: 'Other sources', hint: 'Syllabus, Canvas, Google Calendar', color: OTHER_COLOR },
  ];
  const hiddenCount = options.filter((option) => hidden.has(option.key)).length;

  return (
    <fieldset className="email-filter">
      <legend className="email-filter-label">Accounts</legend>
      <div className="email-filter-options">
        {options.map((option) => {
          const checked = !hidden.has(option.key);
          return (
            <label
              key={option.key}
              className={`email-filter-option${checked ? '' : ' is-off'}`}
              title={`${option.label} (${option.hint})`}
            >
              <input type="checkbox" checked={checked} onChange={() => toggle(option.key)} />
              <span className="account-dot" style={{ background: option.color }} aria-hidden="true" />
              <span className="email-filter-text">{option.label}</span>
            </label>
          );
        })}
        {hiddenCount > 0 && (
          <button type="button" className="email-filter-reset" onClick={showAll}>
            Show all
          </button>
        )}
      </div>
    </fieldset>
  );
}

/** The account an event came from, as a colored dot + address. */
export function AccountTag({ email, color }) {
  if (!email) return null;
  return (
    <span className="account-tag" title={`From ${email}`}>
      <span className="account-dot" style={{ background: color }} aria-hidden="true" />
      <span className="account-tag-text">{email}</span>
    </span>
  );
}
