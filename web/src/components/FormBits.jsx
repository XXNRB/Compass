import Icon from './Icon.jsx';

// Small form/feedback pieces shared by the dashboard cards.

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

export function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Notice({ tone, children, inline = false }) {
  return (
    <div className={`notice notice--${tone}${inline ? ' notice--inline' : ''}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={tone === 'error' ? 'alert' : 'check'} />
      <span>{children}</span>
    </div>
  );
}
