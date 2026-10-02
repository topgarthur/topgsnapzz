import ThemeToggle from './ThemeToggle.jsx';

export default function BrandBar({ status }) {
  const busy = status.state === 'processing';
  const label = busy ? `${status.phase} ${status.index}/${Math.max(status.total, 1)}` : 'WORKER IDLE';

  return (
    <header className="brandbar">
      <div className="brand">
        <span className="mark" aria-hidden="true">
          <i />
        </span>
        <div>
          <p className="wordmark">TOPGSNAPZZ</p>
          <p className="tagline">9:16 story frame engine</p>
        </div>
      </div>
      <div className="brand-actions">
        <p className="pill" data-testid="worker-pill" data-state={status.state} role="status" aria-live="polite">
          <i />
          {label}
        </p>
        <ThemeToggle />
      </div>
    </header>
  );
}
