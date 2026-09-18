import { Link, NavLink } from 'react-router-dom';
import Icon from './Icon.jsx';

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

        <div className="user-chip">
          {signedIn && <span className="avatar">{userEmail.charAt(0)}</span>}
          <span>{userEmail}</span>
        </div>
      </div>
    </header>
  );
}

export default AppHeader;
