import { orientBitmap } from '../utils/orientBitmap.js';
import { salienceAnchor } from '../utils/subjectAnchor.js';

const DETECT_EDGE = 480;
let visionApi = null;
let visionFailed = false;

function releaseBitmap(bitmap) {
  if (bitmap && typeof bitmap.close === 'function') bitmap.close();
}

function boxAnchor(box, width, height, label, source) {
  if (!box || width < 2 || height < 2) return null;
  const nx = (box.originX + box.width / 2) / width;
  const ny = (box.originY + box.height / 2) / height;
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null;
  const top = box.originY / height;
  const bottom = (box.originY + box.height) / height;
  const left = box.originX / width;
  const right = (box.originX + box.width) / width;
  const clipped = [];
  if (top <= 0.08) clipped.push('top');
  if (bottom >= 0.98) clipped.push('bottom');
  if (left <= 0.02) clipped.push('left');
  if (right >= 0.98) clipped.push('right');
  return {
    nx: Math.min(0.92, Math.max(0.08, nx)),
    ny: Math.min(0.92, Math.max(0.08, ny)),
    nw: Math.min(1, Math.max(0.05, box.width / width)),
    nh: Math.min(1, Math.max(0.05, box.height / height)),
    label,
    source,
    clipped,
  };
}

function largestDetection(list) {
  if (!list?.length) return null;
  return [...list].sort((a, b) => {
    const areaA = (a.boundingBox?.width || 0) * (a.boundingBox?.height || 0);
    const areaB = (b.boundingBox?.width || 0) * (b.boundingBox?.height || 0);
    return areaB - areaA;
  })[0];
}

async function initVision() {
  if (visionFailed) return null;
  if (visionApi) return visionApi;
  if (!globalThis.window) globalThis.window = globalThis;
  const vision = await import('@mediapipe/tasks-vision');
  const base = `${self.location.origin}/mediapipe/wasm`;
  const fileset = await vision.FilesetResolver.forVisionTasks(base);
  const faceDetector = await vision.FaceDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: `${self.location.origin}/models/blaze_face_short_range.tflite` },
    runningMode: 'IMAGE',
    minDetectionConfidence: 0.5,
  });
  const objectDetector = await vision.ObjectDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: `${self.location.origin}/models/efficientdet_lite0.tflite` },
    runningMode: 'IMAGE',
    scoreThreshold: 0.45,
    maxResults: 5,
  });
  visionApi = { faceDetector, objectDetector };
  return visionApi;
}

async function mediaPipeAnchor(bitmap) {
  try {
    const api = await initVision();
    if (!api) return null;
    const faces = api.faceDetector.detect(bitmap);
    const face = largestDetection(faces?.detections);
    if (face?.boundingBox) {
      return boxAnchor(face.boundingBox, bitmap.width, bitmap.height, 'face', 'mediapipe-face');
    }
    const objects = api.objectDetector.detect(bitmap);
    const list = objects?.detections || [];
    const person = list.find((item) => /person/i.test(item.categories?.[0]?.categoryName || ''));
    const chosen = person || largestDetection(list);
    if (chosen?.boundingBox) {
      const name = chosen.categories?.[0]?.categoryName || 'object';
      return boxAnchor(chosen.boundingBox, bitmap.width, bitmap.height, name, 'mediapipe-object');
    }
  } catch {
    visionFailed = true;
    visionApi = null;
  }
  return null;
}

function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

function salienceFromBitmap(bitmap) {
  const scale = Math.min(1, 160 / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(8, Math.round(bitmap.width * scale));
  const height = Math.max(8, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, width, height);
  const image = ctx.getImageData(0, 0, width, height);
  return salienceAnchor(image.data, width, height);
}

async function decodeSmall(buffer, mime, rawWidth, rawHeight) {
  const blob = new Blob([buffer], { type: mime || 'image/jpeg' });
  const edge = Math.max(rawWidth || 0, rawHeight || 0);
  if (edge > DETECT_EDGE) {
    const scale = DETECT_EDGE / edge;
    try {
      return await createImageBitmap(blob, {
        imageOrientation: 'none',
        resizeWidth: Math.max(1, Math.round(rawWidth * scale)),
        resizeHeight: Math.max(1, Math.round(rawHeight * scale)),
        resizeQuality: 'low',
      });
    } catch {
      // Retry without a resize hint.
    }
  }
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'none' });
  const longEdge = Math.max(bitmap.width, bitmap.height);
  if (longEdge <= DETECT_EDGE) return bitmap;
  const scale = DETECT_EDGE / longEdge;
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(bitmap.width * scale)),
    Math.max(1, Math.round(bitmap.height * scale)),
  );
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const small = canvas.transferToImageBitmap();
  releaseBitmap(bitmap);
  return small;
}

self.onmessage = async (event) => {
  const { id, buffer, mime, orientation, rawWidth, rawHeight } = event.data;
  let bitmap = null;
  try {
    bitmap = await decodeSmall(buffer, mime, rawWidth || 0, rawHeight || 0);
    bitmap = orientBitmap(bitmap, orientation || 1);
    const fallback = salienceFromBitmap(bitmap);
    const detected = await withTimeout(mediaPipeAnchor(bitmap), 8000);
    releaseBitmap(bitmap);
    bitmap = null;
    self.postMessage({ id, anchor: detected || fallback });
  } catch (error) {
    releaseBitmap(bitmap);
    self.postMessage({ id, error: error?.message || 'Subject detection failed.' });
  }
};
