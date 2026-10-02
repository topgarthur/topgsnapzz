import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import BatchPanel from './components/BatchPanel.jsx';
import BrandBar from './components/BrandBar.jsx';
import ChatSimulator from './components/ChatSimulator.jsx';
import PreviewFrame from './components/PreviewFrame.jsx';
import SingleStage from './components/SingleStage.jsx';
import CropStudio from './components/CropStudio.jsx';
import MemoryRemix from './components/MemoryRemix.jsx';
import { useImageProcessor } from './hooks/useImageProcessor.js';
import { isHeicFile, prepareImage } from './utils/exifHandler.js';
import { deviceProfile, frameBox } from './utils/smartResize.js';
import { buildZip, zipEntryName } from './utils/zipBuilder.js';

const MAX_BATCH = 5;

function frameSignature(settings, pan, anchor, item) {
  const focus =
    settings.autoFrame && anchor
      ? `${anchor.source}:${Number(anchor.nx).toFixed(2)}:${Number(anchor.ny).toFixed(2)}`
      : 'center';
  const caption = String(item?.caption || '').replaceAll('|', ' ').slice(0, 80);
  return [
    item?.frameMode || settings.mode,
    Number(settings.quality).toFixed(2),
    settings.deviceGuard ? 'guard' : 'open',
    settings.frameSize || 'story',
    settings.deviceProfile || 'either',
    focus,
    Number(pan.x).toFixed(3),
    Number(pan.y).toFixed(3),
    caption,
  ].join('|');
}

function reducer(state, action) {
  switch (action.type) {
    case 'add':
      return {
        items: [...state.items, action.item],
        activeId: action.activate ? action.item.id : state.activeId || action.item.id,
      };
    case 'patch':
      return {
        ...state,
        items: state.items.map((item) => (item.id === action.id ? { ...item, ...action.patch } : item)),
      };
    case 'select':
      return { ...state, activeId: action.id };
    case 'remove': {
      const items = state.items.filter((item) => item.id !== action.id);
      return {
        items,
        activeId: state.activeId === action.id ? items[0]?.id || null : state.activeId,
      };
    }
    default:
      return state;
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export default function App() {
  const { enqueue, status } = useImageProcessor();
  const [state, dispatch] = useReducer(reducer, { items: [], activeId: null });
  const [quality, setQuality] = useState(0.92);
  const [mode, setMode] = useState('blend');
  const [deviceGuard, setDeviceGuard] = useState(true);
  const [showSafeZone, setShowSafeZone] = useState(true);
  const [autoFrame, setAutoFrame] = useState(true);
  const [simulator, setSimulator] = useState(true);
  const [deviceProfileId, setDeviceProfileId] = useState('either');
  const [frameSize, setFrameSize] = useState('story');
  const [smartBlur, setSmartBlur] = useState(true);
  const [compare, setCompare] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const library = useRef(new Map());
  const genRef = useRef({});
  const panRef = useRef({});
  const settingsRef = useRef({ quality, mode, deviceGuard, autoFrame, deviceProfile: deviceProfileId, frameSize });
  const itemsRef = useRef(state.items);
  const activeCaption = state.items.find((item) => item.id === state.activeId)?.caption || '';
  const activeFrameMode = state.items.find((item) => item.id === state.activeId)?.frameMode || mode;
  settingsRef.current = { quality, mode, deviceGuard, autoFrame, deviceProfile: deviceProfileId, frameSize };
  itemsRef.current = state.items;

  const requestRender = useCallback(
    (id, priority = false) => {
      const gen = (genRef.current[id] || 0) + 1;
      genRef.current[id] = gen;
      dispatch({ type: 'patch', id, patch: { status: 'queued', error: '' } });
      enqueue(async () => {
        if (genRef.current[id] !== gen) return null;
        const asset = library.current.get(id);
        if (!asset) return null;
        const settings = settingsRef.current;
        const pan = panRef.current[id] || { x: 0, y: 0 };
        const current = itemsRef.current.find((entry) => entry.id === id);
        const box = frameBox(settings.frameSize);
        dispatch({ type: 'patch', id, patch: { status: 'processing', error: '' } });
        return {
          bytes: asset.bytes,
          mime: asset.mime,
          orientation: asset.orientation,
          rawWidth: asset.rawWidth,
          rawHeight: asset.rawHeight,
          autoFrame: settings.autoFrame,
          anchor: settings.autoFrame ? asset.detected || null : null,
          settings,
          pan,
          options: {
            quality: settings.quality,
            mode: current?.frameMode || settings.mode,
            deviceGuard: settings.deviceGuard,
            panX: pan.x,
            panY: pan.y,
            safe: deviceProfile(settings.deviceProfile),
            width: box.width,
            height: box.height,
            frameSize: settings.frameSize,
            caption: current?.caption || '',
          },
        };
      }, priority)
        .then((result) => {
          if (!result?.blob) return;
          if (genRef.current[id] !== gen) return;
          const asset = library.current.get(id);
          if (!asset) return;
          if (asset.resultUrl) URL.revokeObjectURL(asset.resultUrl);
          const resultUrl = URL.createObjectURL(result.blob);
          asset.resultBlob = result.blob;
          asset.resultUrl = resultUrl;
          if (result.anchor) asset.detected = result.anchor;
          const pan = panRef.current[id] || { x: 0, y: 0 };
          const current = itemsRef.current.find((entry) => entry.id === id);
          const signature = frameSignature(
            settingsRef.current,
            pan,
            settingsRef.current.autoFrame ? asset.detected : null,
            current,
          );
          dispatch({
            type: 'patch',
            id,
            patch: {
              status: 'done',
              resultUrl,
              byteSize: result.blob.size,
              error: '',
              signature,
              anchor: settingsRef.current.autoFrame ? asset.detected : null,
              engine: result.engine || '',
            },
          });
        })
        .catch((error) => {
          if (!error || error.message === 'cancelled') return;
          if (genRef.current[id] !== gen) return;
          dispatch({
            type: 'patch',
            id,
            patch: { status: 'error', error: error.message || 'Framing failed.' },
          });
        });
    },
    [enqueue],
  );

  const addFiles = useCallback(
    async (fileList) => {
      const incoming = [...fileList].filter(
        (file) =>
          (file.type || '').startsWith('image/') ||
          isHeicFile(file) ||
          /\.(jpe?g|png|webp|gif|hei[cf])$/i.test(file.name || ''),
      );
      const room = Math.max(0, MAX_BATCH - itemsRef.current.length);
      const files = incoming.slice(0, room);
      if (!files.length) return 0;
      let first = true;
      for (const file of files) {
        const id = crypto.randomUUID();
        panRef.current[id] = { x: 0, y: 0 };
        dispatch({
          type: 'add',
          activate: first,
          item: {
            id,
            name: file.name || 'photo',
            previewUrl: '',
            width: 0,
            height: 0,
            pan: { x: 0, y: 0 },
            status: 'reading',
            error: '',
            resultUrl: '',
            byteSize: 0,
            signature: '',
            anchor: null,
            engine: '',
            favorite: false,
            frameMode: settingsRef.current.mode,
            caption: '',
          },
        });
        first = false;
        try {
          const prepared = await prepareImage(file);
          const previewUrl = URL.createObjectURL(prepared.previewBlob);
          library.current.set(id, {
            bytes: prepared.bytes,
            mime: prepared.mime,
            orientation: prepared.orientation,
            rawWidth: prepared.rawWidth,
            rawHeight: prepared.rawHeight,
            detected: null,
            resultBlob: null,
            resultUrl: '',
          });
          dispatch({
            type: 'patch',
            id,
            patch: {
              previewUrl,
              width: prepared.width,
              height: prepared.height,
              status: 'queued',
            },
          });
          requestRender(id, false);
        } catch (error) {
          dispatch({
            type: 'patch',
            id,
            patch: {
              status: 'error',
              error: error?.message || 'Could not read this photo.',
            },
          });
        }
      }
      return files.length;
    },
    [requestRender],
  );

  useEffect(() => {
    let depth = 0;
    const hasFiles = (event) => Array.from(event.dataTransfer?.types || []).includes('Files');
    const onDragOver = (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
    };
    const onEnter = (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setDragActive(true);
    };
    const onLeave = () => {
      depth -= 1;
      if (depth <= 0) {
        depth = 0;
        setDragActive(false);
      }
    };
    const onDrop = (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragActive(false);
      if (event.target?.closest?.('[data-crop-drop]')) return;
      if (event.dataTransfer.files?.length) addFiles(event.dataTransfer.files);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [addFiles]);

  useEffect(() => {
    const activeId = state.activeId;
    if (!activeId) return undefined;
    const item = itemsRef.current.find((entry) => entry.id === activeId);
    if (!item || item.status === 'reading' || !library.current.has(activeId)) return undefined;
    const pan = panRef.current[activeId] || item.pan || { x: 0, y: 0 };
    const asset = library.current.get(activeId);
    const next = frameSignature(
      settingsRef.current,
      pan,
      settingsRef.current.autoFrame ? asset?.detected : null,
      item,
    );
    if (item.signature !== next) requestRender(activeId, true);
    return undefined;
  }, [quality, mode, deviceGuard, deviceProfileId, frameSize, autoFrame, state.activeId, activeCaption, activeFrameMode, requestRender]);

  useEffect(
    () => () => {
      for (const item of itemsRef.current) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
      }
    },
    [],
  );

  const active = state.items.find((item) => item.id === state.activeId) || null;

  const updatePan = (pan) => {
    if (!active) return;
    panRef.current[active.id] = pan;
    dispatch({ type: 'patch', id: active.id, patch: { pan } });
  };

  const removeItem = (id) => {
    const item = state.items.find((entry) => entry.id === id);
    const asset = library.current.get(id);
    if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
    if (asset?.resultUrl) URL.revokeObjectURL(asset.resultUrl);
    library.current.delete(id);
    delete panRef.current[id];
    delete genRef.current[id];
    dispatch({ type: 'remove', id });
  };

  const downloadActive = () => {
    const asset = active ? library.current.get(active.id) : null;
    if (!asset?.resultBlob) return;
    downloadBlob(asset.resultBlob, zipEntryName(active.name, 0));
  };

  const downloadZip = async () => {
    const files = [];
    state.items.forEach((item, index) => {
      const asset = library.current.get(item.id);
      if (!asset?.resultBlob) return;
      files.push({ name: zipEntryName(item.name, index), blob: asset.resultBlob });
    });
    if (!files.length) return;
    const entries = [];
    for (const file of files) {
      entries.push({ name: file.name, data: new Uint8Array(await file.blob.arrayBuffer()) });
    }
    const zip = await buildZip(entries);
    downloadBlob(zip, 'topgsnapzz_batch.zip');
  };

  const applyMode = (next) => {
    setMode(next);
    if (next !== 'blend') setSmartBlur(false);
    if (!state.activeId) return;
    const current = state.items.find((item) => item.id === state.activeId);
    const asset = library.current.get(state.activeId);
    const pan = panRef.current[state.activeId] || current?.pan || { x: 0, y: 0 };
    const nextSignature = frameSignature(
      { ...settingsRef.current, mode: next },
      pan,
      settingsRef.current.autoFrame ? asset?.detected : null,
      { ...current, frameMode: next },
    );
    const patch = { frameMode: next };
    if (next === 'topgai' && current?.signature !== nextSignature) {
      patch.status = 'queued';
      patch.error = '';
    }
    dispatch({ type: 'patch', id: state.activeId, patch });
  };

  const renderSide = (frameMode) => {
    const id = state.activeId;
    return enqueue(async () => {
      const asset = library.current.get(id);
      if (!asset) return null;
      const settings = settingsRef.current;
      const current = itemsRef.current.find((entry) => entry.id === id);
      const pan = panRef.current[id] || { x: 0, y: 0 };
      const box = frameBox(settings.frameSize);
      return {
        bytes: asset.bytes,
        mime: asset.mime,
        orientation: asset.orientation,
        rawWidth: asset.rawWidth,
        rawHeight: asset.rawHeight,
        autoFrame: settings.autoFrame,
        anchor: settings.autoFrame ? asset.detected || null : null,
        options: {
          quality: settings.quality,
          mode: frameMode,
          deviceGuard: settings.deviceGuard,
          panX: pan.x,
          panY: pan.y,
          safe: deviceProfile(settings.deviceProfile),
          width: box.width,
          height: box.height,
          caption: current?.caption || '',
        },
      };
    }, true);
  };

  const runCompare = async () => {
    if (!active) return;
    setCompare((current) => {
      if (current?.blendUrl) URL.revokeObjectURL(current.blendUrl);
      if (current?.topgaiUrl) URL.revokeObjectURL(current.topgaiUrl);
      return { busy: true, blendUrl: '', topgaiUrl: '' };
    });
    try {
      const [blend, topgai] = await Promise.all([renderSide('blend'), renderSide('topgai')]);
      setCompare({
        busy: false,
        blendUrl: blend?.blob ? URL.createObjectURL(blend.blob) : '',
        topgaiUrl: topgai?.blob ? URL.createObjectURL(topgai.blob) : '',
        blendEngine: blend?.engine || '',
        topgaiEngine: topgai?.engine || '',
      });
    } catch (error) {
      setCompare({ busy: false, blendUrl: '', topgaiUrl: '', error: error?.message || 'Compare failed.' });
    }
  };

  return (
    <div className="app">
      <BrandBar status={status} />
      <main className="workspace">
        <div className="col-controls">
          <SingleStage
            quality={quality}
            onQuality={setQuality}
            mode={active?.frameMode || mode}
            onMode={applyMode}
            frameSize={frameSize}
            onFrameSize={setFrameSize}
            caption={active?.caption || ''}
            onCaption={(value) => {
              if (!active) return;
              dispatch({ type: 'patch', id: active.id, patch: { caption: value.slice(0, 80) } });
            }}
            onCompare={runCompare}
            compareBusy={Boolean(compare?.busy)}
            deviceGuard={deviceGuard}
            onDeviceGuard={setDeviceGuard}
            showSafeZone={showSafeZone}
            onShowSafeZone={setShowSafeZone}
            autoFrame={autoFrame}
            onAutoFrame={setAutoFrame}
            simulator={simulator}
            onSimulator={setSimulator}
            dragActive={dragActive}
            onFiles={addFiles}
            onRender={() => active && requestRender(active.id, true)}
            onDownload={downloadActive}
            onReset={() => {
              updatePan({ x: 0, y: 0 });
              if (active) requestRender(active.id, true);
            }}
            canRender={Boolean(active && active.status !== 'reading')}
            canDownload={Boolean(active?.resultUrl)}
            byteSize={active?.byteSize || 0}
            error={active?.error || ''}
          />
          <BatchPanel
            items={state.items}
            activeId={state.activeId}
            busy={status.state === 'processing'}
            onSelect={(id) => {
              dispatch({ type: 'select', id });
              const next = state.items.find((item) => item.id === id);
              if (next?.frameMode) setMode(next.frameMode);
            }}
            onRemove={removeItem}
            onRenderAll={() => state.items.forEach((item) => requestRender(item.id, false))}
            onDownloadZip={downloadZip}
          />
        </div>
        <div className="col-preview">
          <PreviewFrame
            item={active}
            showSafeZone={showSafeZone}
            deviceGuard={deviceGuard}
            deviceProfileId={deviceProfileId}
            autoFrame={autoFrame}
            onPan={updatePan}
            onPanCommit={() => active && requestRender(active.id, true)}
            onNaturalSize={(id, width, height) => dispatch({ type: 'patch', id, patch: { width, height } })}
            frameSize={frameSize}
            compare={compare}
            onUseCompare={applyMode}
          />
          {simulator ? (
            <ChatSimulator
              imageUrl={active?.resultUrl || active?.previewUrl || ''}
              deviceGuard={deviceGuard}
              profileId={deviceProfileId}
            />
          ) : null}
        </div>
      </main>
      <div className="crop-wrap">
        <CropStudio onSend={addFiles} />
      </div>
      <MemoryRemix
        item={active}
        profileId={deviceProfileId}
        onProfile={setDeviceProfileId}
        smartBlur={smartBlur && mode === 'blend'}
        onSmartBlur={(next) => {
          setSmartBlur(next);
          if (next) applyMode('blend');
        }}
        deviceGuard={deviceGuard}
        autoFrame={autoFrame}
        frameSize={frameSize}
        caption={active?.caption || ''}
        onCaption={(value) => {
          if (!active) return;
          dispatch({ type: 'patch', id: active.id, patch: { caption: value.slice(0, 80) } });
        }}
        onDownload={downloadActive}
        onFavorite={() => {
          if (!active) return;
          dispatch({ type: 'patch', id: active.id, patch: { favorite: !active.favorite } });
        }}
        onTopgai={() => applyMode('topgai')}
      />
    </div>
  );
}
