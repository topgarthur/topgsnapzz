function anchorDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function saveFile(blob, filename) {
  const type = blob.type || (filename.endsWith('.zip') ? 'application/zip' : 'image/jpeg');
  const file = new File([blob], filename, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }
  anchorDownload(blob, filename);
}
