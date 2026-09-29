import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { API_BASE } from '../api.js';

const HIDDEN_KEY = 'compassHiddenEmails';
// Filter key for events with no mailbox: syllabus, Canvas, calendar imports,
// and emails scanned before events were tagged with their account.
export const OTHER_SOURCES = '__other__';

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

/**
 * Loads the user's connected email accounts and tracks which ones are
 * toggled off. The toggle state is a per-browser preference.
 */
export function useEmailFilter() {
  const [accounts, setAccounts] = useState([]);
  const [hidden, setHidden] = useState(readHidden);

  const fetchAccounts = useCallback(async () => {
    try {
      const userId = localStorage.getItem('compassUserId') || '';
      const { data } = await axios.get(`${API_BASE}/connected-emails?userId=${userId}`, {
        withCredentials: true,
      });
      setAccounts(data.accounts || []);
    } catch {
      // Non-fatal: without accounts the filter bar just doesn't render.
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  function toggle(key) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeHidden(next);
      return next;
    });
  }

  const isVisible = useCallback(
    (event) => !hidden.has(event.email || OTHER_SOURCES),
    [hidden],
  );

  return { accounts, hidden, toggle, isVisible, refreshAccounts: fetchAccounts };
}

const PROVIDER_LABELS = { gmail: 'Gmail', outlook: 'Outlook' };

/**
 * Checkbox bar for showing/hiding events by source account.
 */
export function EmailFilter({ accounts, hidden, onToggle }) {
  if (accounts.length === 0) return null;

  // One checkbox per address, even if it's connected under two providers
  const unique = accounts.filter(
    (account, i) => accounts.findIndex((other) => other.email === account.email) === i,
  );
  const options = [
    ...unique.map((account) => ({
      key: account.email,
      label: account.email,
      hint: PROVIDER_LABELS[account.provider] || account.provider,
    })),
    { key: OTHER_SOURCES, label: 'Other sources', hint: 'Syllabus, Canvas, Calendar' },
  ];

  return (
    <fieldset className="email-filter">
      <legend className="email-filter-label">Show events from</legend>
      <div className="email-filter-options">
        {options.map((option) => (
          <label key={option.key} className="email-filter-option" title={option.hint}>
            <input
              type="checkbox"
              checked={!hidden.has(option.key)}
              onChange={() => onToggle(option.key)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
