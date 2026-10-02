import { useEffect, useRef, useState } from 'react';
import { clamp, computePlacement, deviceProfile, frameBox } from '../utils/smartResize.js';
import SafeZoneOverlay from './SafeZoneOverlay.jsx';

export default function PreviewFrame({
  item,
  showSafeZone,
  deviceGuard,
  deviceProfileId,
  autoFrame,
  onPan,
  onPanCommit,
  onNaturalSize,
  frameSize,
  compare,
  onUseCompare,
}) {
  const frameRef = useRef(null);
  const dragRef = useRef(null);
  const rafRef = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const output = frameBox(frameSize);

  useEffect(() => {
    const node = frameRef.current;
    if (!node) return undefined;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      setBox({ w: rect.width, h: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const placement =
    item?.width && item?.height && box.w > 0
      ? computePlacement(
          item.width,
          item.height,
          box.w,
          box.h,
          item.pan.x,
          item.pan.y,
          deviceGuard,
          autoFrame ? item.anchor : null,
          deviceProfile(deviceProfileId),
        )
      : null;
  const showExact = Boolean(item?.resultUrl) && !dragging;
  const busy = item?.status === 'queued' || item?.status === 'processing' || item?.status === 'reading';

  const movePan = (next) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => onPan(next));
  };

  const onPointerDown = (event) => {
    if (!item || event.button > 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      panX: item.pan.x,
      panY: item.pan.y,
    };
    setDragging(true);
  };

  const onPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    const rect = event.currentTarget.getBoundingClientRect();
    movePan({
      x: clamp(drag.panX + ((event.clientX - drag.x) / rect.width) * 1.6, -1, 1),
      y: clamp(drag.panY + ((event.clientY - drag.y) / rect.height) * 1.6, -1, 1),
    });
  };

  const finishDrag = (event) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onPanCommit();
  };

  const nudge = (event) => {
    if (!item) return;
    const step = event.shiftKey ? 0.08 : 0.03;
    const deltas = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();
    onPan({
      x: clamp(item.pan.x + delta[0], -1, 1),
      y: clamp(item.pan.y + delta[1], -1, 1),
    });
  };

  return (
    <section className="stage" aria-label="Preview">
      <div className="frame-shell">
        <div className="brackets" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
        <div
          ref={frameRef}
          className={`frame ${dragging ? 'is-dragging' : ''} ${item ? '' : 'is-empty'}`}
          data-testid="frame"
          role="application"
          tabIndex={item ? 0 : -1}
          aria-label="Story frame. Drag to reposition the photo, then release to render."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          onDoubleClick={() => {
            onPan({ x: 0, y: 0 });
            onPanCommit();
          }}
          onKeyDown={nudge}
          onKeyUp={(event) => {
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) onPanCommit();
          }}
        >
          {item?.previewUrl && !showExact ? (
            <>
              <img className="live-bg" src={item.previewUrl} alt="" draggable="false" />
              {placement ? (
                <img
                  className="live-fg"
                  src={item.previewUrl}
                  alt=""
                  draggable="false"
                  style={{
                    left: `${placement.x}px`,
                    top: `${placement.y}px`,
                    width: `${placement.dw}px`,
                    height: `${placement.dh}px`,
                  }}
                />
              ) : (
                <img
                  className="live-fallback"
                  src={item.previewUrl}
                  alt=""
                  draggable="false"
                  onLoad={(event) => {
                    if (!item.width || !item.height) {
                      onNaturalSize(item.id, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
                    }
                  }}
                />
              )}
            </>
          ) : null}

          {showExact ? (
            <img
              className="result"
              data-testid="preview-result"
              data-render-key={item.signature}
              data-engine={item.engine || ''}
              src={item.resultUrl}
              alt="Framed 9:16 preview"
              draggable="false"
            />
          ) : null}

          {!item ? <p className="frame-empty">Drop a photo to fill a 9:16 frame.</p> : null}
          {showSafeZone && item ? <SafeZoneOverlay profileId={deviceProfileId} /> : null}
          {busy && item?.frameMode === 'topgai' ? (
            <div className="frame-progress" data-testid="topgai-progress" role="status">
              <i />
              <strong>topgai is filling the gaps</strong>
              <span>Your face and body stay as they are. The first fill can take a minute.</span>
            </div>
          ) : null}
          {busy && item?.frameMode !== 'topgai' ? <p className="frame-chip">Framing off-thread</p> : null}
        </div>
      </div>
      <p className="frame-caption">
        <span>
          {output.width} × {output.height}
        </span>
        <span>{output.label}</span>
        {item?.engine === 'lama' || item?.engine === 'onnx' || item?.engine === 'patch' || item?.engine === 'original' ? (
          <span data-testid="fill-engine">
            {item.engine === 'lama'
              ? 'LaMa fill'
              : item.engine === 'onnx'
                ? 'ONNX fill'
                : item.engine === 'patch'
                  ? 'Patch fill'
                  : 'Original'}
          </span>
        ) : null}
        <span data-testid="subject-lock">
          {autoFrame && item?.anchor ? `Locked: ${item.anchor.label}` : 'Center weight'}
        </span>
        <span>{dragging ? 'Release to render' : 'Drag to reframe'}</span>
        {item?.resultUrl ? (
          <button type="button" className="text-btn" data-testid="view-sent" onClick={() => setViewing(true)}>
            View sent
          </button>
        ) : null}
      </p>
      {compare?.blendUrl || compare?.topgaiUrl || compare?.busy || compare?.error ? (
        <div className="compare" data-testid="compare-strip">
          <p>Smart Blur keeps a soft copy behind the photo. topgai keeps the original sharp and fills only the gaps.</p>
          <div className="compare-row">
            <figure>
              {compare.blendUrl ? <img src={compare.blendUrl} alt="Smart Blur result" /> : <span>{compare.busy ? 'Fitting…' : 'Unavailable'}</span>}
              <figcaption>Smart Blur</figcaption>
              <button type="button" disabled={!compare.blendUrl} onClick={() => onUseCompare('blend')}>
                Use blur
              </button>
            </figure>
            <figure>
              {compare.topgaiUrl ? <img src={compare.topgaiUrl} alt="topgai result" /> : <span>{compare.busy ? 'Fitting…' : 'Unavailable'}</span>}
              <figcaption>topgai{compare.topgaiEngine === 'lama' ? ' · LaMa' : ''}</figcaption>
              <button type="button" data-testid="use-topgai" disabled={!compare.topgaiUrl} onClick={() => onUseCompare('topgai')}>
                Use topgai
              </button>
            </figure>
          </div>
          {compare.error ? <p className="error">{compare.error}</p> : null}
        </div>
      ) : null}
      {viewing && item?.resultUrl ? (
        <div className="sent-view" data-testid="sent-view" role="dialog" aria-label="Sent snap">
          <button type="button" className="sent-close" onClick={() => setViewing(false)}>
            Close
          </button>
          <div className="sent-frame" style={{ aspectRatio: `${output.width} / ${output.height}` }}>
            <img src={item.resultUrl} alt="Snap as sent" />
            <SafeZoneOverlay profileId={deviceProfileId} />
          </div>
          <p>This is the file. The dashed guide is only on this screen.</p>
        </div>
      ) : null}
    </section>
  );
}
