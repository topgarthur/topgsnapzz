import { topgaiAssets } from './generativeFill.js';

const FILL_WIDTH = 768;
const FILL_HEIGHT = 1344;

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function blobToBase64(blob) {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

async function scaleBlob(blob, width, height, type, smooth) {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = smooth;
  if (smooth) ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  return canvas.convertToBlob({ type, quality: 0.86 });
}

async function composite(baseBlob, fluxBlob, maskBlob) {
  const base = await createImageBitmap(baseBlob);
  const flux = await createImageBitmap(fluxBlob);
  const mask = await createImageBitmap(maskBlob);
  const canvas = new OffscreenCanvas(base.width, base.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(flux, 0, 0, base.width, base.height);
  const fluxData = ctx.getImageData(0, 0, base.width, base.height);
  ctx.drawImage(base, 0, 0);
  const kept = ctx.getImageData(0, 0, base.width, base.height);
  const maskCanvas = new OffscreenCanvas(base.width, base.height);
  const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
  maskCtx.drawImage(mask, 0, 0, base.width, base.height);
  const maskData = maskCtx.getImageData(0, 0, base.width, base.height).data;
  for (let i = 0; i < maskData.length; i += 4) {
    if (maskData[i] > 160) {
      kept.data[i] = fluxData.data[i];
      kept.data[i + 1] = fluxData.data[i + 1];
      kept.data[i + 2] = fluxData.data[i + 2];
      kept.data[i + 3] = 255;
    }
  }
  ctx.putImageData(kept, 0, 0);
  base.close?.();
  flux.close?.();
  mask.close?.();
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
}

async function requestFlux(imageBlob, maskBlob) {
  const origin = globalThis.location?.origin || '';
  const image = await blobToBase64(await scaleBlob(imageBlob, FILL_WIDTH, FILL_HEIGHT, 'image/jpeg', true));
  const mask = await blobToBase64(await scaleBlob(maskBlob, FILL_WIDTH, FILL_HEIGHT, 'image/png', false));
  const started = await fetch(`${origin}/api/topgai`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ image, mask }),
  });
  const startBody = await started.json().catch(() => ({}));
  if (!started.ok || !startBody.requestId) {
    const error = new Error(startBody.error || 'Flux Fill is not available.');
    error.code = started.status === 503 ? 'unavailable' : 'flux';
    throw error;
  }
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const status = await fetch(`${origin}/api/topgai?id=${encodeURIComponent(startBody.requestId)}`);
    const body = await status.json().catch(() => ({}));
    if (body.status === 'pending') continue;
    if (body.status === 'done' && body.image) {
      const binary = atob(body.image);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: 'image/jpeg' });
    }
    throw new Error(body.error || 'Flux Fill did not finish.');
  }
  throw new Error('Flux Fill took too long.');
}

export async function fluxFill(bitmap, options) {
  const assets = await topgaiAssets(bitmap, options || {});
  if (assets.skip) return { skip: true };
  const fluxBlob = await requestFlux(assets.imageBlob, assets.maskBlob);
  const blob = await composite(assets.imageBlob, fluxBlob, assets.maskBlob);
  return { blob, engine: 'flux' };
}
