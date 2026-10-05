import { useEffect, useState } from 'react';
import { phoneBrowser } from '../utils/phoneBrowser.js';
import { computePlacement, deviceProfile, fitsStory, frameBox } from '../utils/smartResize.js';

const SEND_SECTIONS = [
  {
    id: 'stories',
    title: 'Stories',
    people: [
      { id: 'my-story', name: 'My Story', hint: 'Your story' },
      { id: 'private-story', name: 'Private Story', hint: 'Close friends' },
    ],
  },
  {
    id: 'best',
    title: 'Best Friends',
    people: [
      { id: 'alex', name: 'Alex', hint: 'Best friend' },
      { id: 'jordan', name: 'Jordan', hint: 'Best friend' },
      { id: 'sam', name: 'Sam', hint: 'Best friend' },
    ],
  },
  {
    id: 'recents',
    title: 'Recents',
    people: [
      { id: 'casey', name: 'Casey', hint: 'Recent' },
      { id: 'riley', name: 'Riley', hint: 'Recent' },
      { id: 'morgan', name: 'Morgan', hint: 'Recent' },
    ],
  },
];

function ProfileChoices({ profileId, onProfile }) {
  return (
    <div className="segment memory-profiles" role="group" aria-label="Target device">
      <button
        type="button"
        data-testid="memory-profile-either"
        aria-pressed={profileId === 'either'}
        onClick={() => onProfile('either')}
      >
        Either phone
      </button>
      <button
        type="button"
        data-testid="memory-profile-iphone"
        aria-pressed={profileId === 'iphone'}
        onClick={() => onProfile('iphone')}
      >
        iPhone 14/15 Pro
      </button>
      <button
        type="button"
        data-testid="memory-profile-android"
        aria-pressed={profileId === 'android'}
        onClick={() => onProfile('android')}
      >
        Android 20:9
      </button>
    </div>
  );
}

function StatusIcons() {
  return (
    <div className="memory-status" data-testid="memory-status" aria-hidden="true">
      <span>9:41</span>
      <span className="memory-status-icons">
        <svg viewBox="0 0 16 12" width="14" height="11">
          <path d="M1 9.5h1.4v-2.2H1V9.5zm3.2 0h1.4V5.2H4.2V9.5zm3.2 0h1.4V3H7.4v6.5zM10.6 9.5H12V1h-1.4v8.5z" fill="currentColor" />
        </svg>
        <svg viewBox="0 0 16 12" width="14" height="11">
          <path d="M8 9.2a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zM3.2 6.4a6.8 6.8 0 0 1 9.6 0l-1.1 1.1a5.1 5.1 0 0 0-7.4 0L3.2 6.4zM.6 3.8a10.4 10.4 0 0 1 14.8 0L14.3 4.9a8.7 8.7 0 0 0-12.6 0L.6 3.8z" fill="currentColor" />
        </svg>
        <svg viewBox="0 0 22 12" width="20" height="11">
          <rect x="0.6" y="1" width="17" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <rect x="2.2" y="2.6" width="11" height="6.8" rx="1" fill="currentColor" />
          <path d="M19 4.2v3.6c.8-.3 1.4-1 1.4-1.8S19.8 4.5 19 4.2z" fill="currentColor" />
        </svg>
      </span>
    </div>
  );
}

export default function MemoryRemix({
  item,
  profileId,
  onProfile,
  smartBlur,
  onSmartBlur,
  deviceGuard,
  autoFrame,
  frameSize,
  caption,
  onCaption,
  onDownload,
  onFavorite,
  onTopgai,
}) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState('memories');
  const [view, setView] = useState('menu');
  const [tool, setTool] = useState('');
  const [storyOn, setStoryOn] = useState(false);
  const [sentTo, setSentTo] = useState('');
  const profile = deviceProfile(profileId);
  const imageUrl = item?.previewUrl || item?.resultUrl || '';
  const placement =
    item?.width && item?.height
      ? computePlacement(
          item.width,
          item.height,
          1080,
          1920,
          item.pan?.x || 0,
          item.pan?.y || 0,
          deviceGuard,
          autoFrame ? item.anchor : null,
          profile,
        )
      : null;

  useEffect(() => {
    if (!item?.id) {
      setOpen(false);
      return undefined;
    }
    setView('menu');
    setTool('');
    setStoryOn(false);
    setSentTo('');
    return undefined;
  }, [item?.id]);

  if (!item) return null;

  const output = frameBox(frameSize);
  const fitted = Boolean(item?.resultUrl) && (item?.signature || '').startsWith('topgai|');
  const alreadyFits = fitsStory(item?.width, item?.height, output.width, output.height);

  const showPanel = (next) => {
    setPanel(next);
    setOpen(true);
    setView('menu');
    if (next === 'topgai') onTopgai();
  };

  const remix = () => {
    onSmartBlur(true);
    setTool('');
    setView('menu');
    setPanel('memories');
  };

  return (
    <div className={`memory-root ${open ? 'is-open' : ''}`} data-testid="memory-root">
      <button type="button" className="memory-scrim" aria-label="Close memories" disabled={!open} onClick={() => setOpen(false)} />
      <div className="memory-peeks">
        <button
          type="button"
          className="memory-peek"
          data-testid="memory-peek"
          aria-expanded={open && panel === 'memories'}
          onClick={() => showPanel('memories')}
        >
          Memories
        </button>
        <button
          type="button"
          className="memory-peek"
          data-testid="topgai-peek"
          aria-expanded={open && panel === 'topgai'}
          onClick={() => showPanel('topgai')}
        >
          topgai
        </button>
      </div>
      <section
        className="memory-sheet"
        data-testid="memory-sheet"
        role="dialog"
        aria-label="Snapchat Memory and Remix"
        aria-hidden={!open}
        inert={!open}
      >
        <button type="button" className="memory-handle" aria-label="Collapse memories" onClick={() => setOpen(false)} />
        <header className="memory-head">
          {view === 'send' ? (
            <button type="button" className="memory-back" onClick={() => setView('menu')}>
              Back
            </button>
          ) : (
            <span />
          )}
          <h2>{view === 'send' ? 'Send To' : panel === 'topgai' ? 'topgai' : 'Memories'}</h2>
          <span />
        </header>
        {view !== 'send' ? (
          <div className="memory-tabs" role="tablist" aria-label="Feature">
            <button type="button" role="tab" data-testid="memory-tab" aria-selected={panel === 'memories'} onClick={() => showPanel('memories')}>
              Memories
            </button>
            <button type="button" role="tab" data-testid="topgai-tab" aria-selected={panel === 'topgai'} onClick={() => showPanel('topgai')}>
              topgai
            </button>
          </div>
        ) : null}

        <div className="memory-view">
          {view !== 'send' && panel !== 'topgai' ? (
          <div className="memory-menu" data-testid="memory-menu">
            <div className="memory-card" data-testid="memory-preview">
              <div className="memory-stage">
                {smartBlur && imageUrl ? (
                  <>
                    <img className="memory-blur" src={imageUrl} alt="" />
                    <img
                      className={`memory-sharp ${placement ? '' : 'is-fallback'}`}
                      src={imageUrl}
                      alt="Uncropped snap"
                      style={
                        placement
                          ? {
                              left: `${(placement.x / 1080) * 100}%`,
                              top: `${(placement.y / 1920) * 100}%`,
                              width: `${(placement.dw / 1080) * 100}%`,
                              height: `${(placement.dh / 1920) * 100}%`,
                            }
                          : undefined
                      }
                    />
                  </>
                ) : item.resultUrl ? (
                  <img className="memory-result" src={item.resultUrl} alt="Framed snap" />
                ) : imageUrl ? (
                  <img className="memory-sharp is-fallback" src={imageUrl} alt="Snap" />
                ) : null}
                <div
                  className="memory-pad"
                  data-testid="memory-pad"
                  style={{
                    top: `${profile.top * 100}%`,
                    bottom: `${profile.bottom * 100}%`,
                    left: `${profile.side * 100}%`,
                    right: `${profile.side * 100}%`,
                  }}
                />
                <StatusIcons />
                <div className="memory-tools" data-testid="memory-tools">
                  {[
                    ['text', 'Text'],
                    ['draw', 'Draw'],
                    ['sticker', 'Sticker'],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className={tool === id ? 'is-on' : ''}
                      aria-pressed={tool === id}
                      onClick={() => setTool(tool === id ? '' : id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="memory-bar">
                  <button type="button" data-testid="memory-save" onClick={onDownload} disabled={!item.resultUrl}>
                    Save
                  </button>
                  <button
                    type="button"
                    data-testid="memory-story"
                    aria-pressed={storyOn}
                    onClick={() => setStoryOn((value) => !value)}
                  >
                    Story
                  </button>
                  <button type="button" data-testid="memory-sendto" onClick={() => setView('send')}>
                    Send To
                  </button>
                </div>
              </div>
            </div>
              {tool ? (
                <label className="field">
                  <div className="field-label">
                    <span>Caption</span>
                  </div>
                  <input
                    data-testid="memory-caption"
                    type="text"
                    maxLength={80}
                    value={caption}
                    placeholder="Text saved inside the safe area"
                    aria-label="Caption burned into the snap"
                    onChange={(event) => onCaption(event.target.value)}
                  />
                </label>
              ) : null}
            <p className="memory-note" data-testid="memory-note">
              {tool
                ? 'The caption is written into the JPEG, above the chat bar.'
                : storyOn
                  ? 'Marked for your story on this device.'
                  : smartBlur
                    ? `${profile.label} safe area. The sharp photo stays whole on a blurred copy of itself.`
                    : `${profile.label} uses the rendered frame. Turn Smart Blur on to fill the gaps from the photo.`}
            </p>
            <p className="memory-note">Either phone keeps the subject clear of both the iPhone and Android chat bars.</p>

            <div className="memory-field">
              <div className="toggle-row">
                <div>
                  <strong>Smart Blur</strong>
                  <p>A blurred copy fills the 9:16 frame. The original stays crisp and uncropped.</p>
                </div>
                <button
                  type="button"
                  className="switch-btn"
                  role="switch"
                  aria-checked={smartBlur}
                  data-testid="memory-blur-toggle"
                  onClick={() => onSmartBlur(!smartBlur)}
                >
                  <i />
                </button>
              </div>
              <ProfileChoices profileId={profileId} onProfile={onProfile} />
            </div>

            <ul className="memory-actions">
              <li>
                <button type="button" data-testid="memory-action-remix" onClick={remix}>
                  <strong>Remix Snap</strong>
                  <span>Fit the whole photo, no black bars</span>
                </button>
              </li>
              <li>
                <button type="button" data-testid="memory-action-edit" onClick={() => setTool('text')}>
                  <strong>Edit Snap</strong>
                  <span>Text, draw, and stickers on the preview</span>
                </button>
              </li>
              <li>
                <button type="button" data-testid="memory-action-favorite" aria-pressed={Boolean(item.favorite)} onClick={onFavorite}>
                  <strong>{item.favorite ? 'Favorited' : 'Favorite'}</strong>
                  <span>{item.favorite ? 'Saved in this session' : 'Keep this memory marked'}</span>
                </button>
              </li>
              <li>
                <button type="button" data-testid="memory-action-send" onClick={() => setView('send')}>
                  <strong>Send to...</strong>
                  <span>{sentTo ? `Last pick: ${sentTo}` : 'Stories, best friends, recents'}</span>
                </button>
              </li>
            </ul>
          </div>
          ) : view === 'send' ? (
          <div className="memory-send" data-testid="memory-send">
            <p className="memory-note">
              Simulated chat list. Export padding follows {profile.label}, so the chat overlay stays off the subject.
            </p>
            {SEND_SECTIONS.map((section) => (
              <section key={section.id} aria-label={section.title}>
                <h3>{section.title}</h3>
                <ul>
                  {section.people.map((person) => (
                    <li key={person.id}>
                      <button
                        type="button"
                        data-testid={`memory-recipient-${person.id}`}
                        aria-pressed={sentTo === person.name}
                        onClick={() => setSentTo(person.name)}
                      >
                        <i aria-hidden="true">{person.name.slice(0, 1)}</i>
                        <span>
                          <strong>{person.name}</strong>
                          <small>{person.hint}</small>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {sentTo ? (
              <p className="memory-sent" data-testid="memory-sent">
                Ready for {sentTo} on {profile.label}. Nothing is uploaded.
              </p>
            ) : null}
          </div>
          ) : (
          <div className="topgai" data-testid="topgai-panel">
            <div className="memory-card">
              <div className="memory-stage">
                {fitted && item.status !== 'queued' && item.status !== 'processing' ? (
                  <img className="memory-result" data-testid="topgai-result" src={item.resultUrl} alt="topgai frame, 1080 by 1920" />
                ) : imageUrl ? (
                  <img className="memory-sharp is-fallback topgai-wait" src={imageUrl} alt="Original photo" />
                ) : null}
                {item.status === 'queued' || item.status === 'processing' ? (
                  <div className="topgai-progress" data-testid="topgai-sheet-progress" role="status">
                    <i />
                    <strong>topgai is filling the gaps</strong>
                    <span>
                      {phoneBrowser()
                        ? 'This phone uses the lighter fill so the page stays open. Your face and body stay as they are.'
                        : 'Your face and body stay as they are. The first fill can take a minute.'}
                    </span>
                  </div>
                ) : null}
                <div
                  className="memory-pad"
                  data-testid="memory-pad"
                  style={{
                    top: `${profile.top * 100}%`,
                    bottom: `${profile.bottom * 100}%`,
                    left: `${profile.side * 100}%`,
                    right: `${profile.side * 100}%`,
                  }}
                />
                <StatusIcons />
                <div className="memory-bar">
                  <button type="button" data-testid="topgai-save" onClick={onDownload} disabled={!fitted}>
                    Save
                  </button>
                  <button type="button" onClick={() => showPanel('topgai')}>
                    Fit
                  </button>
                  <button type="button" onClick={() => setView('send')}>
                    Send To
                  </button>
                </div>
              </div>
            </div>
            <p className="memory-note" data-testid="topgai-note">
              {item.status === 'queued' || item.status === 'processing'
                ? 'topgai is filling only the empty space around the photo. The face and body stay the original pixels.'
                : fitted && item.engine === 'original'
                ? `topgai finished. The photo already filled ${output.width}×${output.height}, so the original pixels stayed.`
                : fitted && item.engine === 'lama'
                  ? 'topgai finished. The gaps are filled and the face and body stayed the original pixels.'
                  : fitted
                    ? 'topgai finished. The frame is ready and the face and body stayed the original pixels.'
                    : alreadyFits
                      ? `This photo already matches the frame. topgai will scale it to ${output.width}×${output.height} without filling anything in.`
                      : 'This photo does not cover the frame. topgai keeps it whole and generates only the gaps.'}
            </p>
            <p className="memory-note">
              Either phone is the default when you do not know what they use. It keeps the subject clear of both chat bars.
            </p>
            <ProfileChoices profileId={profileId} onProfile={onProfile} />
          </div>
          )}
        </div>
      </section>
    </div>
  );
}
