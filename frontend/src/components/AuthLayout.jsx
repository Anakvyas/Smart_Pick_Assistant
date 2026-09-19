import BackgroundDecor from './BackgroundDecor';

function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <main className="auth-shell">
      <BackgroundDecor />
      <section className="auth-card">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7 12 3l9 4-9 4-9-4Z" />
              <path d="M3 7v10l9 4 9-4V7" />
              <path d="M12 11v10" />
            </svg>
          </div>
          <h1>Smart Picker</h1>
          <p>{subtitle}</p>
        </div>

        <div className="auth-content">
          <h2>{title}</h2>
          {children}
        </div>

        {footer ? <div className="auth-footer">{footer}</div> : null}
      </section>
    </main>
  );
}

export default AuthLayout;
