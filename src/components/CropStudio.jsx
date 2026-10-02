import { useRef, useState } from 'react';
import { saveFile } from '../utils/saveFile.js';
import { coverRects, cropBitmap, edgeCrop, findTextBoxes } from '../utils/smartCrop.js';

const MAX_CROP = 10;
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

function clampCrop(next, minW, minH) {
  const w = Math.min(1, Math.max(minW, next.w));
  const h = Math.min(1, Math.max(minH, next.h));
  return {
    x: Math.min(1 - w, Math.max(0, next.x)),
    y: Math.min(1 - h, Math.max(0, next.y)),
    w,
    h,
  };
}

function loadBitmap(file) {
  return createImageBitmap(file);
}

export default function CropStudio({ onSend }) {
  const [items, setItems] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [mode, setMode] = useState('manual');
  const [query, setQuery] = useState('');
  const [crop, setCrop] = useState({ x: 0, y: 0, w: 1, h: 1 });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const dragRef = useRef(null);
  const stageRef = useRef(null);
  const recentDrop = useRef('');
  const active = items.find((item) => item.id === activeId) || null;

  const addFiles = async (fileList) => {
    const incoming = [...fileList].filter((file) => (file.type || '').startsWith('image/') || /^image\//.test(file.type || ''));
    const signature = incoming.map((file) => `${file.name}:${file.size}:${file.lastModified}`).join('|');
    if (!signature || signature === recentDrop.current) return;
    recentDrop.current = signature;
    setTimeout(() => {
      if (recentDrop.current === signature) recentDrop.current = '';
    }, 700);
    const room = Math.max(0, MAX_CROP - items.length);
    const files = incoming.slice(0, room);
    if (!files.length) {
      setNote(`Crop holds ${MAX_CROP} photos.`);
      return;
    }
    const next = [];
    for (const file of files) {
      const url = URL.createObjectURL(file);
      next.push({
        id: crypto.randomUUID(),
        name: file.name || 'photo',
        file,
        url,
        resultUrl: '',
        resultBlob: null,
        status: 'ready',
      });
    }
    setItems((current) => [...current, ...next]);
    setActiveId((current) => current || next[0].id);
    setNote(incoming.length > room ? `Only ${room} more photo${room === 1 ? '' : 's'} fit. Crop holds ${MAX_CROP}.` : '');
  };

  const applyOne = async (item) => {
    const bitmap = await loadBitmap(item.file);
    try {
      if (mode === 'manual') {
        const rect = {
          x: crop.x * bitmap.width,
          y: crop.y * bitmap.height,
          w: crop.w * bitmap.width,
          h: crop.h * bitmap.height,
        };
        const blob = await cropBitmap(bitmap, rect);
        return { blob, note: 'Manual crop.' };
      }
      const boxes = await findTextBoxes(item.file, query, bitmap.width, bitmap.height);
      if (!boxes.length) {
        throw new Error(query ? `Could not find “${query}”.` : 'Could not find a watermark. Type the word to target.');
      }
      if (mode === 'autocrop') {
        const rect = edgeCrop(bitmap.width, bitmap.height, boxes);
        if (rect) {
          const blob = await cropBitmap(bitmap, rect);
          return { blob, note: 'Cut only the strip that held the text.' };
        }
      }
      const blob = await coverRects(bitmap, boxes);
      return { blob, note: 'Watermark filled. The photo keeps its size.' };
    } finally {
      bitmap.close?.();
    }
  };

  const apply = async (onlyId) => {
    const targets = items.filter((item) => (onlyId ? item.id === onlyId : true));
    if (!targets.length) return;
    setBusy(true);
    setNote(mode === 'manual' ? 'Cropping…' : 'Scanning the photo…');
    try {
      for (const item of targets) {
        setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, status: 'working' } : entry)));
        try {
          const result = await applyOne(item);
          if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
          const resultUrl = URL.createObjectURL(result.blob);
          setItems((current) =>
            current.map((entry) =>
              entry.id === item.id ? { ...entry, status: 'done', resultUrl, resultBlob: result.blob } : entry,
            ),
          );
          setNote(result.note);
        } catch (error) {
          setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, status: 'error' } : entry)));
          setNote(error?.message || 'Crop failed.');
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const download = (item) => {
    const blob = item?.resultBlob;
    if (!blob) return;
    saveFile(blob, `cropped_${item.name.replace(/\.[^.]+$/, '')}.jpg`);
  };

  const send = async (item) => {
    if (!item?.resultBlob) return;
    const file = new File([item.resultBlob], `cropped_${item.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' });
    const added = await onSend([file]);
    setNote(added ? 'Sent to the reframer. It will come out as a 1080×1920 snap.' : 'The reframer already holds 5 photos.');
  };

  const pointInStage = (event) => {
    const bounds = stageRef.current?.getBoundingClientRect();
    if (!bounds) return null;
    return {
      px: (event.clientX - bounds.left) / bounds.width,
      py: (event.clientY - bounds.top) / bounds.height,
      bounds,
    };
  };

  const onPointerDown = (event) => {
    if (mode !== 'manual') return;
    if (event.target?.closest?.('[data-crop-grid]')) return;
    const point = pointInStage(event);
    if (!point) return;
    event.preventDefault();
    const { px, py, bounds } = point;
    const handle = event.target?.dataset?.handle || '';
    const inside = px >= crop.x && px <= crop.x + crop.w && py >= crop.y && py <= crop.y + crop.h;
    dragRef.current = {
      px,
      py,
      crop: { ...crop },
      minW: 8 / bounds.width,
      minH: 8 / bounds.height,
      handle,
      move: !handle && inside,
      draw: !handle && !inside,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    const point = pointInStage(event);
    if (!point) return;
    const dx = point.px - drag.px;
    const dy = point.py - drag.py;
    const start = drag.crop;
    if (drag.draw) {
      setCrop(
        clampCrop(
          {
            x: Math.min(drag.px, point.px),
            y: Math.min(drag.py, point.py),
            w: Math.abs(point.px - drag.px),
            h: Math.abs(point.py - drag.py),
          },
          drag.minW,
          drag.minH,
        ),
      );
      return;
    }
    if (drag.move && start.w > 0.97 && start.h > 0.97 && (Math.abs(dx) > 0.012 || Math.abs(dy) > 0.012)) {
      drag.move = false;
      drag.draw = true;
    }
    if (drag.move) {
      setCrop(clampCrop({ ...start, x: start.x + dx, y: start.y + dy }, drag.minW, drag.minH));
      return;
    }
    if (drag.draw) {
      setCrop(
        clampCrop(
          {
            x: Math.min(drag.px, point.px),
            y: Math.min(drag.py, point.py),
            w: Math.abs(point.px - drag.px),
            h: Math.abs(point.py - drag.py),
          },
          drag.minW,
          drag.minH,
        ),
      );
      return;
    }
    const flags = {
      nw: { left: true, top: true },
      n: { top: true },
      ne: { right: true, top: true },
      e: { right: true },
      se: { right: true, bottom: true },
      s: { bottom: true },
      sw: { left: true, bottom: true },
      w: { left: true },
    }[drag.handle] || {};
    let x = start.x;
    let y = start.y;
    let w = start.w;
    let h = start.h;
    if (flags.left) {
      x = Math.min(start.x + start.w - drag.minW, Math.max(0, start.x + dx));
      w = start.w + (start.x - x);
    }
    if (flags.right) w = Math.min(1 - start.x, Math.max(drag.minW, start.w + dx));
    if (flags.top) {
      y = Math.min(start.y + start.h - drag.minH, Math.max(0, start.y + dy));
      h = start.h + (start.y - y);
    }
    if (flags.bottom) h = Math.min(1 - start.y, Math.max(drag.minH, start.h + dy));
    setCrop(clampCrop({ x, y, w, h }, drag.minW, drag.minH));
  };

  return (
    <section
      className="crop-studio panel"
      data-testid="crop-studio"
      data-crop-drop
      aria-label="Crop"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.target?.closest?.('.dropzone')) return;
        if (event.dataTransfer.files?.length) addFiles(event.dataTransfer.files);
      }}
    >
      <header className="panel-head">
        <h2>smarttopg crop</h2>
        <p>Separate from the snap reframer. Manual crop, a tight cut around a word, or a watermark lift. Up to {MAX_CROP} photos.</p>
      </header>
      <label className={`dropzone ${items.length >= MAX_CROP ? 'is-full' : ''}`} data-crop-drop>
        <input
          data-testid="crop-input"
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          onChange={(event) => {
            if (event.target.files?.length) addFiles(event.target.files);
            event.target.value = '';
          }}
        />
        <strong>Choose photos to crop</strong>
        <span>{items.length}/{MAX_CROP} in this batch. These do not enter the reframer until you send them.</span>
      </label>
      <div className="segment crop-modes" role="group" aria-label="Crop mode">
        <button type="button" aria-pressed={mode === 'manual'} data-testid="crop-manual" onClick={() => setMode('manual')}>
          Manual crop
        </button>
        <button type="button" aria-pressed={mode === 'autocrop'} data-testid="crop-auto" onClick={() => setMode('autocrop')}>
          Auto crop word
        </button>
        <button type="button" aria-pressed={mode === 'watermark'} data-testid="crop-watermark" onClick={() => setMode('watermark')}>
          Remove watermark
        </button>
      </div>
      {mode !== 'manual' ? (
        <label className="field">
          <div className="field-label">
            <span>{mode === 'watermark' ? 'Watermark text' : 'Word to cut'}</span>
          </div>
          <input
            data-testid="crop-query"
            type="text"
            value={query}
            placeholder="onlyfans.com/kayleygunnervip"
            aria-label="Text to find"
            onChange={(event) => setQuery(event.target.value)}
          />
          <p className="hint">
            {mode === 'watermark'
              ? 'Looks over the whole photo, including text turned on its side, and fills that spot. The photo keeps its size.'
              : 'Looks over the whole photo. A mark along the top, bottom, or either side is cut as a thin strip.'}
          </p>
        </label>
      ) : (
        <p className="hint">Drag on the photo to draw a crop. Drag inside the box to move it, and drag any handle to resize it, including a thin strip on the side.</p>
      )}
      {active ? (
        <div className="crop-stage" data-testid="crop-stage">
          <div
            className="crop-frame"
            ref={stageRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => {
              dragRef.current = null;
            }}
            onDragStart={(event) => event.preventDefault()}
          >
            <img src={mode === 'manual' ? active.url : active.resultUrl || active.url} alt="" draggable="false" />
            {mode === 'manual' ? (
              <div
                className="crop-box"
                style={{
                  left: `${crop.x * 100}%`,
                  top: `${crop.y * 100}%`,
                  width: `${crop.w * 100}%`,
                  height: `${crop.h * 100}%`,
                }}
              >
                <span className="crop-thirds" />
                {HANDLES.map((name) => (
                  <b key={name} className={`crop-handle is-${name}`} data-handle={name} />
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="crop-grid" data-testid="crop-grid" data-crop-grid>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.id === activeId ? 'is-active' : ''}
            onClick={() => setActiveId(item.id)}
          >
            <img src={item.resultUrl || item.url} alt="" draggable="false" />
            <span>{item.status === 'working' ? 'Working' : item.status === 'error' ? 'Failed' : item.name}</span>
          </button>
        ))}
      </div>
      {note ? <p className="hint" data-testid="crop-note">{note}</p> : null}
      <div className="actions">
        <button type="button" className="btn primary" data-testid="crop-apply" disabled={!active || busy} onClick={() => apply(active.id)}>
          Apply
        </button>
        <button type="button" className="btn" data-testid="crop-apply-all" disabled={!items.length || busy} onClick={() => apply(null)}>
          Apply to batch
        </button>
        <button type="button" className="btn" data-testid="crop-download" disabled={!active?.resultBlob} onClick={() => download(active)}>
          Download
        </button>
        <button type="button" className="btn" data-testid="crop-send" disabled={!active?.resultBlob} onClick={() => send(active)}>
          Send to reframer
        </button>
      </div>
    </section>
  );
}
