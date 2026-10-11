import { useEffect, useState } from 'react';
import axios from 'axios';
import { API_BASE } from '../api.js';
import { Field, Notice, Spinner } from './FormBits.jsx';

const userIdParam = () => localStorage.getItem('compassUserId') || '';

function errorMessage(err, fallback) {
  return err.response?.data?.error || err.response?.data?.message || fallback;
}

function formatSavedAt(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Step-by-step for copying the canvas_session cookie from DevTools. */
function CookieInstructions() {
  return (
    <ol className="steps">
      <li>Open your school&apos;s Canvas in this browser and log in.</li>
      <li>
        Open DevTools: <kbd>F12</kbd> or <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd> on Windows,{' '}
        <kbd>Cmd</kbd>+<kbd>Option</kbd>+<kbd>I</kbd> on Mac.
      </li>
      <li>
        Go to <strong>Application</strong> &gt; <strong>Cookies</strong> and select your Canvas address
        (in Firefox: <strong>Storage</strong> &gt; <strong>Cookies</strong>).
      </li>
      <li>
        Find <code>canvas_session</code> and copy its <strong>Value</strong>.
      </li>
      <li>Paste it below with your Canvas address.</li>
    </ol>
  );
}

/**
 * Canvas connection card. Two ways in:
 * - browser session: the user pastes their canvas_session cookie (stored
 *   encrypted, expires with the Canvas session), or
 * - API token: the original personal-access-token flow.
 *
 * @param {{ onSynced: () => void }} props - called after a sync imports events
 */
function CanvasCard({ onSynced }) {
  const [session, setSession] = useState({ connected: false, canvasUrl: null, savedAt: null });
  const [tokenConnection, setTokenConnection] = useState({ connected: false, canvasUrl: null });
  const [panel, setPanel] = useState(null); // null | 'cookie' | 'token'
  const [canvasUrl, setCanvasUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState(null);
  const [syncError, setSyncError] = useState(null);

  async function loadStatus() {
    const [sessionRes, tokenRes] = await Promise.allSettled([
      axios.get(`${API_BASE}/canvas/session`, { withCredentials: true }),
      axios.get(`${API_BASE}/canvas/status?userId=${userIdParam()}`, { withCredentials: true }),
    ]);
    if (sessionRes.status === 'fulfilled') setSession(sessionRes.value.data);
    if (tokenRes.status === 'fulfilled') setTokenConnection(tokenRes.value.data);
  }

  useEffect(() => {
    loadStatus();
  }, []);

  function openPanel(next) {
    setPanel(next);
    setSecret('');
    setConnectError(null);
    setCanvasUrl(session.canvasUrl || tokenConnection.canvasUrl || canvasUrl);
  }

  async function handleConnect(event) {
    event.preventDefault();
    setConnecting(true);
    setConnectError(null);
    try {
      if (panel === 'cookie') {
        const { data } = await axios.post(
          `${API_BASE}/canvas/session`,
          { canvasUrl, sessionCookie: secret },
          { withCredentials: true },
        );
        setSession({ connected: true, canvasUrl: data.canvasUrl, savedAt: new Date().toISOString() });
      } else {
        const { data } = await axios.post(
          `${API_BASE}/canvas/connect`,
          { canvasUrl, canvasToken: secret, userId: userIdParam() },
          { withCredentials: true },
        );
        setTokenConnection({ connected: true, canvasUrl: data.canvasUrl });
      }
      setSecret('');
      setPanel(null);
    } catch (err) {
      setConnectError(errorMessage(err, 'Could not connect to Canvas.'));
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    try {
      await axios.delete(`${API_BASE}/canvas/session`, { withCredentials: true });
      setSession({ connected: false, canvasUrl: session.canvasUrl, savedAt: null });
      setSyncMessage(null);
    } catch (err) {
      setSyncError(errorMessage(err, 'Failed to disconnect Canvas.'));
    }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncError(null);
    setSyncMessage(null);
    try {
      const { data } = session.connected
        ? await axios.post(`${API_BASE}/canvas/session/sync`, {}, { withCredentials: true })
        : await axios.post(`${API_BASE}/canvas/sync`, { userId: userIdParam() }, { withCredentials: true });
      setSyncMessage(
        `Found ${data.assignmentsFound} assignment${data.assignmentsFound !== 1 ? 's' : ''} across ${data.coursesFound} course${data.coursesFound !== 1 ? 's' : ''}, ${data.imported} new`,
      );
      if (data.imported) onSynced?.();
    } catch (err) {
      setSyncError(errorMessage(err, 'Failed to sync Canvas assignments.'));
      // Expired or unreadable cookie: the server already dropped it.
      if (err.response?.data?.needsConnect) {
        setSession((prev) => ({ ...prev, connected: false, savedAt: null }));
        openPanel('cookie');
      }
    } finally {
      setSyncing(false);
    }
  }

  const connected = session.connected || tokenConnection.connected;
  const connectedUrl = session.connected ? session.canvasUrl : tokenConnection.canvasUrl;
  const savedAt = formatSavedAt(session.savedAt);

  return (
    <section className="card">
      <h2 className="card-title">Canvas</h2>
      <p className="card-desc">
        Pull assignment due dates from your school&apos;s Canvas automatically.
      </p>

      {connected && !panel && (
        <div>
          <p className="connected-row">
            <span className="status-dot" aria-hidden="true" />
            <span>
              Connected to <strong>{connectedUrl}</strong>
              {session.connected
                ? ` via browser session${savedAt ? ` (saved ${savedAt})` : ''}`
                : ' with an API token'}
            </span>
          </p>
          <div className="form-actions">
            <button type="button" className="btn btn-primary" onClick={handleSync} disabled={syncing}>
              {syncing && <Spinner />}
              {syncing ? 'Syncing' : 'Sync assignments'}
            </button>
            {session.connected ? (
              <button type="button" className="btn btn-ghost" onClick={handleDisconnect}>
                Disconnect
              </button>
            ) : (
              <button type="button" className="btn btn-outline" onClick={() => openPanel('cookie')}>
                Use browser session
              </button>
            )}
          </div>
        </div>
      )}

      {!connected && !panel && (
        <div className="form-actions">
          <button type="button" className="btn btn-outline" onClick={() => openPanel('cookie')}>
            Connect Canvas
          </button>
        </div>
      )}

      {panel && (
        <form onSubmit={handleConnect} className="form">
          {panel === 'cookie' && <CookieInstructions />}

          <Field label="School Canvas URL">
            <input
              type="text"
              className="input"
              value={canvasUrl}
              onChange={(e) => setCanvasUrl(e.target.value)}
              placeholder="yourschool.instructure.com"
              autoComplete="off"
            />
          </Field>

          <Field
            label={panel === 'cookie' ? 'canvas_session cookie value' : 'API token'}
            hint={panel === 'cookie'
              ? 'Stored encrypted and used only to read your assignments. It stops working when your Canvas session ends; reconnect then. Compass never sees your password.'
              : null}
          >
            <input
              type="password"
              className="input"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={panel === 'cookie' ? 'Paste the Value column' : 'Paste your personal access token'}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={connecting || !canvasUrl || !secret}>
              {connecting && <Spinner />}
              {connecting ? 'Connecting' : 'Connect'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setPanel(null)}>
              Cancel
            </button>
          </div>

          <button
            type="button"
            className="link-button"
            onClick={() => openPanel(panel === 'cookie' ? 'token' : 'cookie')}
          >
            {panel === 'cookie' ? 'Use an API token instead' : 'Use your browser session instead'}
          </button>
        </form>
      )}

      {connectError && <Notice tone="error" inline>{connectError}</Notice>}
      {syncError && <Notice tone="error" inline>{syncError}</Notice>}
      {syncMessage && !syncing && <Notice tone="success" inline>{syncMessage}</Notice>}
    </section>
  );
}

export default CanvasCard;
