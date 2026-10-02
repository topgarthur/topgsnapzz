function formatBytes(size) {
  if (!size) return '—';
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

export default function BatchPanel({ items, activeId, busy, onSelect, onRemove, onRenderAll, onDownloadZip }) {
  const ready = items.filter((item) => item.status === 'done').length;

  return (
    <section className="panel batch" aria-label="Batch queue">
      <header className="panel-head batch-head">
        <div>
          <h2>Batch</h2>
          <p>
            {items.length ? `${items.length} of 5 photos · ${ready} ready` : 'Up to 5 photos. Queue is empty.'}
          </p>
        </div>
        <div className="batch-actions">
          <button type="button" className="btn small" disabled={!items.length || busy} onClick={onRenderAll}>
            Render all
          </button>
          <button
            type="button"
            className="btn small primary"
            data-testid="download-zip"
            disabled={!ready}
            onClick={onDownloadZip}
          >
            Download ZIP
          </button>
        </div>
      </header>

      {items.length === 0 ? (
        <p className="empty-copy">Rendered frames are packed into one ZIP, in the browser.</p>
      ) : (
        <ul className="queue">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={`queue-item ${item.id === activeId ? 'is-active' : ''}`}
                onClick={() => onSelect(item.id)}
              >
                {item.previewUrl ? (
                  <img src={item.previewUrl} alt="" />
                ) : (
                  <span className="thumb-fallback" />
                )}
                <span className="queue-meta">
                  <strong>{item.name}</strong>
                  <em data-status={item.status}>
                    {item.status === 'done'
                      ? formatBytes(item.byteSize)
                      : item.status === 'error'
                        ? 'Failed'
                        : item.status === 'reading'
                          ? 'Reading'
                          : item.status === 'processing'
                            ? 'Framing'
                            : 'Queued'}
                  </em>
                </span>
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remove ${item.name}`}
                onClick={() => onRemove(item.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
