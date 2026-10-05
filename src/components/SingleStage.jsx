function formatBytes(size) {
  if (!size) return '';
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

export default function SingleStage({
  quality,
  onQuality,
  mode,
  onMode,
  deviceGuard,
  onDeviceGuard,
  showSafeZone,
  onShowSafeZone,
  autoFrame,
  onAutoFrame,
  simulator,
  onSimulator,
  caption,
  onCaption,
  frameSize,
  onFrameSize,
  onCompare,
  compareBusy,
  dragActive,
  onFiles,
  onRender,
  onDownload,
  onReset,
  canRender,
  canDownload,
  byteSize,
  error,
}) {
  return (
    <section className="panel" aria-label="Frame controls">
      <header className="panel-head">
        <h1>Frame</h1>
        <p>The whole photo stays in the 1080×1920 snap. Leftover space is filled from the photo, so there are no black bars.</p>
      </header>

      <label className={`dropzone ${dragActive ? 'is-hot' : ''}`}>
        <input
          data-testid="file-input"
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          onChange={(event) => {
            const { files } = event.target;
            if (files?.length) onFiles(files);
            event.target.value = '';
          }}
        />
        <strong>Choose photos</strong>
        <span>Tap to pick JPEG, PNG, WebP, or iPhone HEIC. You can also drop files here.</span>
      </label>
      <p className="privacy">Photos never leave this device.</p>

      <div className="field">
        <div className="field-label">
          <span>Fill</span>
        </div>
        <div className="segment" role="group" aria-label="Fill mode">
          <button type="button" aria-pressed={mode === 'blend'} data-testid="mode-blend" onClick={() => onMode('blend')}>
            Blend
          </button>
          <button
            type="button"
            aria-pressed={mode === 'stretch'}
            data-testid="mode-stretch"
            onClick={() => onMode('stretch')}
          >
            Stretch
          </button>
          <button
            type="button"
            aria-pressed={mode === 'generate'}
            data-testid="mode-generate"
            onClick={() => onMode('generate')}
          >
            Generate
          </button>
        </div>
        <p className="hint">
          {mode === 'topgai'
            ? 'topgai keeps the original photo sharp. Flux Fill paints the empty space and can complete a cut-off head or object. The face already in the photo stays as it is.'
            : mode === 'generate'
            ? 'An on-device ONNX network spreads the photo’s color into the empty frame, then real patches from the picture rebuild the texture. Nothing is uploaded.'
            : mode === 'stretch'
              ? 'Keeps the center subject at its real proportions and stretches only the outer bands.'
              : 'Mirrors the outer pixels, then softens them into the empty space so the 9:16 frame is filled.'}
        </p>
      </div>

      <div className="toggle-row">
        <div>
          <strong>Device Guard</strong>
          <p>Keeps the subject clear of Snapchat’s chat bar on both iPhone and Android.</p>
        </div>
        <button
          type="button"
          className="switch-btn"
          role="switch"
          aria-checked={deviceGuard}
          aria-label="Toggle device guard"
          data-testid="guard-toggle"
          onClick={() => onDeviceGuard(!deviceGuard)}
        >
          <i />
        </button>
      </div>

      <div className="toggle-row">
        <div>
          <strong>Auto-frame</strong>
          <p>MediaPipe finds a face or object. Otherwise the highest-contrast region is locked into the safe area.</p>
        </div>
        <button
          type="button"
          className="switch-btn"
          role="switch"
          aria-checked={autoFrame}
          aria-label="Toggle subject auto-frame"
          data-testid="autoframe-toggle"
          onClick={() => onAutoFrame(!autoFrame)}
        >
          <i />
        </button>
      </div>

      <div className="toggle-row">
        <div>
          <strong>Snapchat preview</strong>
          <p>Shows this frame inside a Snapchat chat, with the top bar and reply field.</p>
        </div>
        <button
          type="button"
          className="switch-btn"
          role="switch"
          aria-checked={simulator}
          aria-label="Toggle Snapchat preview"
          data-testid="chat-toggle"
          onClick={() => onSimulator(!simulator)}
        >
          <i />
        </button>
      </div>

      <div className="toggle-row">
        <div>
          <strong>Safe zone guide</strong>
          <p>Marks Snapchat’s top bar, side edges, and bottom chat field.</p>
        </div>
        <button
          type="button"
          className="switch-btn"
          role="switch"
          aria-checked={showSafeZone}
          aria-label="Toggle safe zone guide"
          data-testid="safe-toggle"
          onClick={() => onShowSafeZone(!showSafeZone)}
        >
          <i />
        </button>
      </div>

      <div className="field">
        <div className="field-label">
          <span>Export size</span>
        </div>
        <div className="segment" role="group" aria-label="Export size">
          <button type="button" aria-pressed={frameSize === 'story'} data-testid="size-story" onClick={() => onFrameSize('story')}>
            9:16 snap
          </button>
          <button type="button" aria-pressed={frameSize === 'tall'} data-testid="size-tall" onClick={() => onFrameSize('tall')}>
            Tall phone
          </button>
        </div>
        <p className="hint">
          {frameSize === 'tall'
            ? '1080×2400, closer to a modern tall screen. Either phone still keeps the subject above the chat bar.'
            : '1080×1920, the classic snap frame.'}
        </p>
      </div>

      <label className="field">
        <div className="field-label">
          <span>Caption</span>
        </div>
        <input
          data-testid="caption-input"
          type="text"
          maxLength={80}
          value={caption}
          placeholder="Text saved inside the safe area"
          aria-label="Caption burned into the snap"
          onChange={(event) => onCaption(event.target.value)}
        />
        <p className="hint">This text is written into the JPEG, above the chat bar. It is not part of the on-screen guide.</p>
      </label>

      <div className="field">
        <div className="field-label">
          <span>JPEG quality</span>
          <strong>{quality.toFixed(2)}</strong>
        </div>
        <input
          data-testid="quality"
          type="range"
          min="0.7"
          max="1"
          step="0.01"
          value={quality}
          aria-valuemin={0.7}
          aria-valuemax={1}
          aria-valuenow={quality}
          aria-label="JPEG quality"
          onChange={(event) => onQuality(Number(event.target.value))}
        />
        <div className="range-ends">
          <span>0.70</span>
          <span>1.00</span>
        </div>
      </div>

      {error ? (
        <p className="error" data-testid="frame-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="actions">
        <button type="button" className="btn" data-testid="compare-fills" disabled={!canRender || compareBusy} onClick={onCompare}>
          {compareBusy ? 'Comparing…' : 'Compare blur and topgai'}
        </button>
        <button type="button" className="btn primary" disabled={!canRender} onClick={onRender}>
          Render frame
        </button>
        <button type="button" className="btn" disabled={!canRender} onClick={onReset}>
          Reset pan
        </button>
        <button
          type="button"
          className="btn"
          data-testid="download-jpg"
          disabled={!canDownload}
          onClick={onDownload}
        >
          Download JPG{byteSize ? ` · ${formatBytes(byteSize)}` : ''}
        </button>
      </div>
    </section>
  );
}
