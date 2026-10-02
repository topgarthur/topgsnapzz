import { useTheme } from '../hooks/useTheme.js';

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const light = theme === 'light';

  return (
    <div className="theme-switch">
      <span className={!light ? 'is-active' : ''}>DARK</span>
      <button
        type="button"
        className="switch-btn"
        role="switch"
        aria-checked={light}
        aria-label={light ? 'Switch to dark theme' : 'Switch to red and white theme'}
        data-testid="theme-toggle"
        onClick={toggle}
      >
        <i />
      </button>
      <span className={light ? 'is-active' : ''}>RED / WHITE</span>
    </div>
  );
}
