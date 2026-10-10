import { useSyncExternalStore } from 'react';
import { Link, NavLink } from 'react-router-dom';
import Icon from './Icon.jsx';
import { getScanStatus, subscribeScanStatus } from '../lib/scanStatus.js';

function ScanIndicator() {
  const { status, message } = useSyncExternalStore(subscribeScanStatus, getScanStatus);
  if (status === 'idle') return null;

  return (
    <span className={`scan-indicator scan-indicator--${status}`} role="status" aria-live="polite">
      {status === 'running' ? <span className="spinner spinner--sm" aria-hidden="true" /> : <Icon name="check" />}
      {message}
    </span>
  );
}

function AppHeader({ userEmail, wide = false }) {
  const signedIn = userEmail && userEmail !== 'Not signed in';

  return (
    <header className="app-header">
      <div className={`container${wide ? ' container--wide' : ''}`}>
        <Link to="/" className="brand">
          <Icon name="compass" />
          Compass
        </Link>

        <nav className="app-nav" aria-label="Primary">
          <NavLink to="/dashboard">Dashboard</NavLink>
          <NavLink to="/calendar">Calendar</NavLink>
        </nav>

        <div className="header-right">
          <ScanIndicator />
          <div className="user-chip">
            {signedIn && <span className="avatar">{userEmail.charAt(0)}</span>}
            <span>{userEmail}</span>
          </div>
        </div>
      </div>
    </header>
  );
}

export default AppHeader;
