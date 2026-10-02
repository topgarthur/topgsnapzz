import { orientBitmap } from '../utils/orientBitmap.js';

const MAX_EDGE = 2048;

function releaseBitmap(bitmap) {
  if (bitmap && typeof bitmap.close === 'function') bitmap.close();
  const trigger = globalThis.gc;
  if (typeof trigger === 'function') trigger();
}

async function decodeBitmap(buffer, mime, rawWidth, rawHeight) {
  const blob = new Blob([buffer], { type: mime || 'image/jpeg' });
  const base = {
    imageOrientation: 'none',
    premultiplyAlpha: 'default',
    colorSpaceConversion: 'default',
    resizeQuality: 'high',
  };

  if (rawWidth > 0 && rawHeight > 0 && Math.max(rawWidth, rawHeight) > MAX_EDGE) {
    const scale = MAX_EDGE / Math.max(rawWidth, rawHeight);
    try {
      return await createImageBitmap(blob, {
        ...base,
        resizeWidth: Math.max(1, Math.round(rawWidth * scale)),
        resizeHeight: Math.max(1, Math.round(rawHeight * scale)),
      });
    } catch {
      // Some decoders reject resize options. Fall through to a probe decode.
    }
  }

  const probe = await createImageBitmap(blob, base);
  const longEdge = Math.max(probe.width, probe.height);
  if (longEdge <= MAX_EDGE) return probe;
  try {
    const scale = MAX_EDGE / longEdge;
    const resized = await createImageBitmap(probe, {
      resizeWidth: Math.max(1, Math.round(probe.width * scale)),
      resizeHeight: Math.max(1, Math.round(probe.height * scale)),
      resizeQuality: 'high',
    });
    releaseBitmap(probe);
    return resized;
  } catch (error) {
    releaseBitmap(probe);
    throw error;
  }
}

self.onmessage = async (event) => {
  const { id, buffer, mime, orientation, rawWidth, rawHeight } = event.data;
  let bitmap = null;
  try {
    bitmap = await decodeBitmap(buffer, mime, rawWidth || 0, rawHeight || 0);
    bitmap = orientBitmap(bitmap, orientation || 1);
    self.postMessage({ id, bitmap }, [bitmap]);
  } catch (error) {
    releaseBitmap(bitmap);
    self.postMessage({
      id,
      error: error?.message || 'Could not decode this image.',
    });
  }
};
