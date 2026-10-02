import { deviceProfile } from '../utils/smartResize.js';

export default function SafeZoneOverlay({ profileId }) {
  const zone = deviceProfile(profileId);
  const top = `${zone.top * 100}%`;
  const bottom = `${zone.bottom * 100}%`;
  const side = `${zone.side * 100}%`;

  return (
    <div className="safe" data-testid="safe-overlay" aria-hidden="true">
      <div className="safe-top" style={{ height: top }}>
        <span>SNAP</span>
      </div>
      <div className="safe-side left" style={{ top, bottom, width: side }} />
      <div className="safe-side right" style={{ top, bottom, width: side }} />
      <div className="safe-bottom" style={{ height: bottom }}>
        <span>CHAT</span>
      </div>
      <div className="safe-frame" style={{ top, bottom, left: side, right: side }}>
        <span>SAFE</span>
      </div>
    </div>
  );
}
