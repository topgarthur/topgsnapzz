import { deviceProfile } from '../utils/smartResize.js';

export default function ChatSimulator({ imageUrl, deviceGuard, profileId }) {
  const zone = deviceProfile(profileId);
  return (
    <section className="simulator" data-testid="chat-simulator" aria-label="Snapchat chat preview">
      <header className="simulator-head">
        <h2>Snapchat preview</h2>
        <p>
          {deviceGuard
            ? 'The dashed box sits clear of Snapchat’s top bar and chat field. Device Guard keeps the subject inside it.'
            : 'Snapchat’s top bar and chat field cover the frame. Turn Device Guard on to keep the subject clear.'}
        </p>
      </header>
      <div className="phones">
        <article className="phone phone-snapchat" data-testid="phone-snapchat">
          <div className="phone-screen">
            {imageUrl ? <img src={imageUrl} alt="" /> : <div className="phone-empty" />}
            <div className="chrome top" style={{ height: `${zone.top * 100}%` }}>
              <i className="avatar" />
              <span>friend</span>
            </div>
            <div
              className="chrome side left"
              style={{ top: `${zone.top * 100}%`, bottom: `${zone.bottom * 100}%`, width: `${zone.side * 100}%` }}
            />
            <div
              className="chrome side right"
              style={{ top: `${zone.top * 100}%`, bottom: `${zone.bottom * 100}%`, width: `${zone.side * 100}%` }}
            />
            <div className="chrome bottom" style={{ height: `${zone.bottom * 100}%` }}>
              <span className="reply">Send a chat</span>
            </div>
            {deviceGuard ? (
              <div
                className="guard-box"
                style={{
                  top: `${zone.top * 100}%`,
                  bottom: `${zone.bottom * 100}%`,
                  left: `${zone.side * 100}%`,
                  right: `${zone.side * 100}%`,
                }}
              />
            ) : null}
          </div>
          <p>Snapchat</p>
        </article>
      </div>
    </section>
  );
}
