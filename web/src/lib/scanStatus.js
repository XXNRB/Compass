// Background "scan new emails" state, shared by every page so the header
// indicator survives navigation between Dashboard and Calendar (it's a
// module-level store, so it lives as long as the tab does).
import axios from 'axios';
import { API_BASE } from '../api.js';

const LAST_SCAN_KEY = 'compassLastAutoScan';
// Pages refetch their events when this fires.
export const EVENTS_CHANGED = 'compass:events-changed';

let state = { status: 'idle', message: '' };
const listeners = new Set();

function setState(next) {
  state = next;
  listeners.forEach((listener) => listener());
}

export function subscribeScanStatus(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getScanStatus() {
  return state;
}

function readLastScan() {
  try {
    const value = Number(localStorage.getItem(LAST_SCAN_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeLastScan(epochSeconds) {
  try {
    localStorage.setItem(LAST_SCAN_KEY, String(epochSeconds));
  } catch {
    // Non-fatal: the next login just rescans the full day.
  }
}

let inFlight = null;

/**
 * Scans the primary Gmail account's last 24 hours in the background. Only
 * emails newer than the previous auto-scan are analyzed, so logging in twice
 * in a day doesn't re-run Claude on the same messages. Never throws.
 */
export function runAutoScan() {
  if (inFlight) return inFlight;

  const startedAt = Math.floor(Date.now() / 1000);
  const after = readLastScan();
  setState({ status: 'running', message: 'Scanning new emails...' });

  inFlight = axios
    .get(`${API_BASE}/emails/scan`, {
      params: { window: '1d', ...(after ? { after } : {}) },
      withCredentials: true,
    })
    .then(({ data }) => {
      writeLastScan(startedAt);
      const changed = (data.saved || 0) + (data.updated || 0);
      setState({
        status: 'done',
        message: changed
          ? `${changed} new update${changed !== 1 ? 's' : ''} from email`
          : 'No new scheduling emails',
      });
      if (changed) window.dispatchEvent(new Event(EVENTS_CHANGED));
    })
    .catch(() => {
      // Quietly give up: the manual Scan button is still there.
      setState({ status: 'error', message: 'Auto-scan unavailable' });
    })
    .finally(() => {
      inFlight = null;
      setTimeout(() => {
        if (state.status !== 'running') setState({ status: 'idle', message: '' });
      }, 6000);
    });

  return inFlight;
}
