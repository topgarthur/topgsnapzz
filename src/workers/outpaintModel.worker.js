import { buildOnnxPrior, generativeFill, inpaintRects, lamaFill, sharpFill } from '../utils/generativeFill.js';
import { composeStory, fitsStory, paintFullFrame } from '../utils/smartResize.js';

function releaseBitmap(bitmap) {
  if (bitmap && typeof bitmap.close === 'function') bitmap.close();
  const trigger = globalThis.gc;
  if (typeof trigger === 'function') trigger();
}

function phoneBrowser() {
  const ua = self.navigator?.userAgent || '';
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && (self.navigator?.maxTouchPoints || 0) > 1;
}

async function fillLight(bitmap, options) {
  let runPrior = null;
  try {
    const { ort, session } = await loadSession();
    runPrior = (source, placement) => buildOnnxPrior(source, placement, session, ort);
  } catch {
    runPrior = null;
  }
  return generativeFill(bitmap, options || {}, runPrior);
}

let sessionPromise = null;
let lamaPromise = null;

async function loadSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort = await import('onnxruntime-web');
      ort.env.wasm.numThreads = 1;
      const session = await ort.InferenceSession.create(`${self.location.origin}/models/outpaint_prior.onnx`, {
        executionProviders: ['wasm'],
      });
      return { ort, session };
    })().catch((error) => {
      sessionPromise = null;
      throw error;
    });
  }
  return sessionPromise;
}

async function loadLama() {
  if (!lamaPromise) {
    lamaPromise = (async () => {
      const ort = await import('onnxruntime-web');
      ort.env.wasm.numThreads = 1;
      const session = await ort.InferenceSession.create(`${self.location.origin}/models/lama_fp32.onnx`, {
        executionProviders: ['wasm'],
      });
      return { ort, session };
    })().catch((error) => {
      lamaPromise = null;
      throw error;
    });
  }
  return lamaPromise;
}

self.onmessage = async (event) => {
  const { id, bitmap, options, kind, rects } = event.data;
  try {
    if (kind === 'inpaint') {
      const { ort, session } = await loadLama();
      const blob = await inpaintRects(bitmap, rects || [], session, ort);
      const buffer = await blob.arrayBuffer();
      releaseBitmap(bitmap);
      self.postMessage({ id, buffer, engine: 'lama' }, [buffer]);
      return;
    }
    const mode = options?.mode;
    let blob;
    let engine = mode === 'stretch' ? 'stretch' : 'blend';
    const box = {
      width: Number(options?.width) || 1080,
      height: Number(options?.height) || 1920,
    };
    if (mode === 'topgai' && fitsStory(bitmap.width, bitmap.height, box.width, box.height)) {
      blob = await paintFullFrame(bitmap, options || {});
      engine = 'original';
    } else if (mode === 'topgai') {
      const light = Boolean(options?.skipLama) || phoneBrowser();
      if (light) {
        const filled = await sharpFill(bitmap, options || {});
        blob = filled.blob;
        engine = filled.engine;
      } else {
        try {
          const { ort, session } = await loadLama();
          const filled = await lamaFill(bitmap, options || {}, session, ort);
          blob = filled.blob;
          engine = filled.engine;
        } catch {
          const filled = await sharpFill(bitmap, options || {});
          blob = filled.blob;
          engine = filled.engine;
        }
      }
    } else if (mode === 'generate') {
      const filled = await fillLight(bitmap, options || {});
      blob = filled.blob;
      engine = filled.engine;
    } else {
      blob = await composeStory(bitmap, options || {});
    }
    const buffer = await blob.arrayBuffer();
    releaseBitmap(bitmap);
    self.postMessage({ id, buffer, engine }, [buffer]);
  } catch (error) {
    releaseBitmap(bitmap);
    self.postMessage({
      id,
      error: error?.message || 'Content-aware framing failed.',
    });
  }
};
