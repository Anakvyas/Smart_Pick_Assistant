import { useAuth } from '../context/AuthContext';

function getInitials(name) {
  if (!name) return 'P';
  const parts = name.trim().split(/\s+/);
  const initials = parts.slice(0, 2).map((part) => part[0]?.toUpperCase());
  return initials.join('') || 'P';
}

function DashboardPage() {
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    window.location.href = '/login';
  };

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div className="brand-lockup">
          <div className="brand-lockup-mark" aria-hidden="true">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7 12 3l9 4-9 4-9-4Z" />
              <path d="M3 7v10l9 4 9-4V7" />
              <path d="M12 11v10" />
            </svg>
          </div>
          <p className="eyebrow">Smart Picker</p>
        </div>
        <button type="button" className="logout-button" onClick={handleLogout}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="M16 17l5-5-5-5M21 12H9" />
          </svg>
          Logout
        </button>
      </header>

      <section className="dashboard-content">
        <div className="welcome-row">
          <div className="welcome-avatar" aria-hidden="true">{getInitials(user?.name)}</div>
          <div>
            <h1>Welcome, {user?.name?.split(' ')[0] || 'Picker'}</h1>
            <p className="role-tag">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 12l5 5L20 6" />
              </svg>
              {user?.role || 'PICKER'}
            </p>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2>Assigned Orders</h2>
            <span className="panel-count">1 active</span>
          </div>
          <p className="empty-state">Your assigned orders will appear here.</p>

          <div className="demo-order-card">
            <div className="demo-header">
              <span className="demo-badge">
                <span className="badge-dot" aria-hidden="true" />
                Preview
              </span>
              <span className="demo-label">Demo data</span>
            </div>
            <div className="order-body">
              <h3>ORD-1001</h3>
              <p className="order-meta-line">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 3" />
                </svg>
                Assigned: 9:15 AM
              </p>
              <p className="order-meta-line">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 7l9-4 9 4-9 4-9-4Z" />
                  <path d="M3 7v10l9 4 9-4V7" />
                </svg>
                3 products · 4 units
              </p>

              <div className="order-progress-row">
                <div className="order-progress-track">
                  <div className="order-progress-fill" style={{ width: '25%' }} />
                </div>
                <span className="order-progress-label">1 of 4 picked</span>
              </div>
            </div>
            <button type="button" className="secondary-button">Start Picking</button>
          </div>
        </div>
      </section>
    </main>
  );
}

export default DashboardPage;
