import { Link, useLocation } from 'react-router-dom';
import AppHeader from '../components/AppHeader.jsx';

function NotFound() {
  const { pathname } = useLocation();

  return (
    <div className="page">
      <AppHeader userEmail={localStorage.getItem('compassUserEmail') || 'Not signed in'} />
      <main className="container main">
        <div className="empty-state">
          <strong>Page not found</strong>
          <p>
            There is nothing at <code>{pathname}</code>. Email scanning is run from the
            dashboard.
          </p>
          <p style={{ marginTop: 16 }}>
            <Link to="/dashboard" className="btn btn-primary">Go to dashboard</Link>
          </p>
        </div>
      </main>
    </div>
  );
}

export default NotFound;
