import { STORY_HEIGHT, STORY_WIDTH, clamp, computePlacement, destBox, paintSubject, stampCaption } from './smartResize.js';

const PRIOR_SIZE = 64;

function clampInt(value, min, max) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function edgeColor(bitmap) {
  const sample = new OffscreenCanvas(1, 1);
  const ctx = sample.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, bitmap.width, Math.max(1, bitmap.height * 0.04), 0, 0, 1, 1);
  const pixel = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`;
}

function jsPrior(bitmap, placement) {
  const canvas = new OffscreenCanvas(STORY_WIDTH, STORY_HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = edgeColor(bitmap);
  ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT);
  ctx.drawImage(bitmap, placement.x, placement.y, placement.dw, placement.dh);
  const tiny = new OffscreenCanvas(28, 48);
  tiny.getContext('2d').drawImage(canvas, 0, 0, 28, 48);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(tiny, 0, 0, STORY_WIDTH, STORY_HEIGHT);
  return canvas;
}

export async function buildOnnxPrior(bitmap, placement, session, ort) {
  const small = new OffscreenCanvas(PRIOR_SIZE, PRIOR_SIZE);
  const sctx = small.getContext('2d', { willReadFrequently: true });
  const scaleX = PRIOR_SIZE / STORY_WIDTH;
  const scaleY = PRIOR_SIZE / STORY_HEIGHT;
  sctx.fillStyle = edgeColor(bitmap);
  sctx.fillRect(0, 0, PRIOR_SIZE, PRIOR_SIZE);
  sctx.drawImage(
    bitmap,
    placement.x * scaleX,
    placement.y * scaleY,
    Math.max(1, placement.dw * scaleX),
    Math.max(1, placement.dh * scaleY),
  );
  const pixels = sctx.getImageData(0, 0, PRIOR_SIZE, PRIOR_SIZE).data;
  const area = PRIOR_SIZE * PRIOR_SIZE;
  const original = new Float32Array(3 * area);
  const mask = new Float32Array(area);
  for (let i = 0; i < area; i += 1) {
    const offset = i * 4;
    original[i] = pixels[offset] / 255;
    original[area + i] = pixels[offset + 1] / 255;
    original[area * 2 + i] = pixels[offset + 2] / 255;
    const placed =
      pixels[offset] !== pixels[0] ||
      pixels[offset + 1] !== pixels[1] ||
      pixels[offset + 2] !== pixels[2];
    mask[i] = placed ? 0 : 1;
  }

  const knownLeft = clampInt(placement.x * scaleX, 0, PRIOR_SIZE - 1);
  const knownTop = clampInt(placement.y * scaleY, 0, PRIOR_SIZE - 1);
  const knownRight = clampInt((placement.x + placement.dw) * scaleX, 0, PRIOR_SIZE);
  const knownBottom = clampInt((placement.y + placement.dh) * scaleY, 0, PRIOR_SIZE);
  mask.fill(1);
  for (let y = knownTop; y < knownBottom; y += 1) {
    for (let x = knownLeft; x < knownRight; x += 1) mask[y * PRIOR_SIZE + x] = 0;
  }

  let context = original.slice();
  for (let step = 0; step < 18; step += 1) {
    const result = await session.run({
      context: new ort.Tensor('float32', context, [1, 3, PRIOR_SIZE, PRIOR_SIZE]),
      mask: new ort.Tensor('float32', mask.slice(), [1, 1, PRIOR_SIZE, PRIOR_SIZE]),
    });
    const data = result.output.data;
    const next = new Float32Array(data.length);
    next.set(data);
    for (let i = 0; i < area; i += 1) {
      if (mask[i] === 0) {
        next[i] = original[i];
        next[area + i] = original[area + i];
        next[area * 2 + i] = original[area * 2 + i];
      }
    }
    context = next;
  }

  const painted = sctx.createImageData(PRIOR_SIZE, PRIOR_SIZE);
  for (let i = 0; i < area; i += 1) {
    const offset = i * 4;
    painted.data[offset] = Math.round(clamp(context[i], 0, 1) * 255);
    painted.data[offset + 1] = Math.round(clamp(context[area + i], 0, 1) * 255);
    painted.data[offset + 2] = Math.round(clamp(context[area * 2 + i], 0, 1) * 255);
    painted.data[offset + 3] = 255;
  }
  sctx.putImageData(painted, 0, 0);
  return small;
}

function paintExtension(ctx, photo, prior, placement) {
  const width = STORY_WIDTH;
  const height = STORY_HEIGHT;
  const base = prior.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height);
  const source = photo.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height);
  const output = new ImageData(new Uint8ClampedArray(base.data), width, height);
  const left = Math.round(placement.x);
  const top = Math.round(placement.y);
  const right = Math.round(placement.x + placement.dw);
  const bottom = Math.round(placement.y + placement.dh);
  const visLeft = clampInt(left, 0, width);
  const visTop = clampInt(top, 0, height);
  const visRight = clampInt(right, 0, width);
  const visBottom = clampInt(bottom, 0, height);
  const sampleLeft = clampInt(Math.max(left, 0), 0, width - 1);
  const sampleTop = clampInt(Math.max(top, 0), 0, height - 1);
  const sampleRight = clampInt(Math.min(right, width) - 1, 0, width - 1);
  const sampleBottom = clampInt(Math.min(bottom, height) - 1, 0, height - 1);
  const span = 32;

  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      if (px >= visLeft && px < visRight && py >= visTop && py < visBottom) continue;
      const dx = px < left ? left - px : px >= right ? px - (right - 1) : 0;
      const dy = py < top ? top - py : py >= bottom ? py - (bottom - 1) : 0;
      let sx;
      let sy;
      let dist;
      if (dy >= dx) {
        dist = Math.max(1, dy);
        const jitter = Math.round(Math.sin(dist * 0.41 + px * 0.02) * Math.min(20, dist * 0.08));
        sx = clampInt(px + jitter, sampleLeft, sampleRight);
        const along = dist % span;
        sy = py < top ? Math.min(sampleBottom, sampleTop + along) : Math.max(sampleTop, sampleBottom - along);
      } else {
        dist = Math.max(1, dx);
        const jitter = Math.round(Math.sin(dist * 0.37 + py * 0.02) * Math.min(20, dist * 0.08));
        sy = clampInt(py + jitter, sampleTop, sampleBottom);
        const along = dist % span;
        sx = px < left ? Math.min(sampleRight, sampleLeft + along) : Math.max(sampleLeft, sampleRight - along);
      }
      const src = (sy * width + sx) * 4;
      const dst = (py * width + px) * 4;
      const priorWeight = Math.min(0.74, dist / 240);
      const keep = 1 - priorWeight;
      output.data[dst] = source.data[src] * keep + base.data[dst] * priorWeight;
      output.data[dst + 1] = source.data[src + 1] * keep + base.data[dst + 1] * priorWeight;
      output.data[dst + 2] = source.data[src + 2] * keep + base.data[dst + 2] * priorWeight;
      output.data[dst + 3] = 255;
    }
  }
  ctx.putImageData(output, 0, 0);
}

export async function lamaFill(bitmap, options, session, ort) {
  const { width, height } = destBox(options);
  const placement = computePlacement(
    bitmap.width,
    bitmap.height,
    width,
    height,
    options.panX || 0,
    options.panY || 0,
    Boolean(options.deviceGuard),
    options.anchor || null,
    options.safe || null,
    true,
  );
  const size = 512;
  const sample = new OffscreenCanvas(size, size);
  const sctx = sample.getContext('2d', { willReadFrequently: true });
  sctx.fillStyle = '#000';
  sctx.fillRect(0, 0, size, size);
  const sx = (placement.x / width) * size;
  const sy = (placement.y / height) * size;
  const sw = Math.max(1, (placement.dw / width) * size);
  const sh = Math.max(1, (placement.dh / height) * size);
  sctx.drawImage(bitmap, sx, sy, sw, sh);
  const pixels = sctx.getImageData(0, 0, size, size).data;
  const area = size * size;
  const image = new Float32Array(3 * area);
  const mask = new Float32Array(area);
  const left = clampInt(sx, 0, size);
  const top = clampInt(sy, 0, size);
  const right = clampInt(sx + sw, 0, size);
  const bottom = clampInt(sy + sh, 0, size);
  const bleed = 6;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      const offset = i * 4;
      const keep = x >= left + bleed && x < right - bleed && y >= top + bleed && y < bottom - bleed;
      mask[i] = keep ? 0 : 1;
      image[i] = keep ? pixels[offset] / 255 : 0;
      image[area + i] = keep ? pixels[offset + 1] / 255 : 0;
      image[area * 2 + i] = keep ? pixels[offset + 2] / 255 : 0;
    }
  }
  const imageTensor = new ort.Tensor('float32', image, [1, 3, size, size]);
  const maskTensor = new ort.Tensor('float32', mask, [1, 1, size, size]);
  const feeds = {};
  for (const name of session.inputNames) {
    feeds[name] = name.toLowerCase().includes('mask') ? maskTensor : imageTensor;
  }
  const result = await session.run(feeds);
  const outputName = session.outputNames[0];
  const data = result[outputName].data;
  let peak = 0;
  for (let i = 0; i < Math.min(data.length, 4000); i += 17) peak = Math.max(peak, data[i]);
  const scale = peak <= 1.5 ? 255 : 1;
  const painted = new OffscreenCanvas(size, size);
  const pctx = painted.getContext('2d');
  const frame = pctx.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      const o = i * 4;
      frame.data[o] = Math.max(0, Math.min(255, data[i] * scale));
      frame.data[o + 1] = Math.max(0, Math.min(255, data[area + i] * scale));
      frame.data[o + 2] = Math.max(0, Math.min(255, data[area * 2 + i] * scale));
      frame.data[o + 3] = 255;
    }
  }
  pctx.putImageData(frame, 0, 0);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(painted, 0, 0, width, height);
  paintSubject(ctx, bitmap, placement, true);
  stampCaption(ctx, options.caption, width, height, options.safe);
  const quality = clamp(Number(options.quality) || 0.92, 0.7, 1);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  return { blob, engine: 'lama' };
}

export async function generativeFill(bitmap, options, runPrior) {
  const { width, height } = destBox(options);
  const placement = computePlacement(
    bitmap.width,
    bitmap.height,
    width,
    height,
    options.panX || 0,
    options.panY || 0,
    Boolean(options.deviceGuard),
    options.anchor || null,
    options.safe || null,
  );
  let engine = 'patch';
  let prior = null;
  if (runPrior) {
    try {
      prior = await runPrior(bitmap, placement);
      if (prior) engine = 'onnx';
    } catch {
      prior = null;
    }
  }
  if (!prior) prior = jsPrior(bitmap, placement);

  const fullPrior = new OffscreenCanvas(width, height);
  const priorCtx = fullPrior.getContext('2d');
  priorCtx.imageSmoothingEnabled = true;
  priorCtx.imageSmoothingQuality = 'high';
  priorCtx.drawImage(prior, 0, 0, width, height);

  const photo = new OffscreenCanvas(width, height);
  photo.getContext('2d').drawImage(bitmap, placement.x, placement.y, placement.dw, placement.dh);

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  paintExtension(ctx, photo, fullPrior, placement);
  paintSubject(ctx, bitmap, placement, true);
  stampCaption(ctx, options.caption, width, height, options.safe);
  const quality = clamp(Number(options.quality) || 0.92, 0.7, 1);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  return { blob, engine };
}

function reflectInto(dist, band) {
  const full = Math.max(1, band);
  const span = dist > full * 2 ? Math.max(6, Math.round(full * 0.4)) : full;
  const period = span * 2;
  const phase = (dist - 1) % period;
  return phase < span ? phase : period - 1 - phase;
}

function extendSharp(image, width, height, placement) {
  const data = image.data;
  const left = clampInt(Math.floor(placement.x), 0, width - 1);
  const top = clampInt(Math.floor(placement.y), 0, height - 1);
  const right = clampInt(Math.ceil(placement.x + placement.dw), left + 1, width);
  const bottom = clampInt(Math.ceil(placement.y + placement.dh), top + 1, height);
  const bandY = Math.max(8, Math.min(28, bottom - top));
  const bandX = Math.max(8, Math.min(28, right - left));
  const paint = (x, y, sx, sy) => {
    const source = (sy * width + sx) * 4;
    const dest = (y * width + x) * 4;
    data[dest] = data[source];
    data[dest + 1] = data[source + 1];
    data[dest + 2] = data[source + 2];
    data[dest + 3] = 255;
  };

  for (let dist = 1, y = top - 1; y >= 0; dist += 1, y -= 1) {
    const sy = Math.min(bottom - 1, top + reflectInto(dist, bandY));
    const jitter = dist < 3 ? 0 : Math.round(Math.sin(dist * 0.47) * Math.min(6, dist * 0.05));
    for (let x = left; x < right; x += 1) paint(x, y, clampInt(x + jitter, left, right - 1), sy);
  }
  for (let dist = 1, y = bottom; y < height; dist += 1, y += 1) {
    const sy = Math.max(top, bottom - 1 - reflectInto(dist, bandY));
    const jitter = dist < 3 ? 0 : Math.round(Math.sin(dist * 0.41) * Math.min(6, dist * 0.05));
    for (let x = left; x < right; x += 1) paint(x, y, clampInt(x + jitter, left, right - 1), sy);
  }
  for (let dist = 1, x = left - 1; x >= 0; dist += 1, x -= 1) {
    const sx = Math.min(right - 1, left + reflectInto(dist, bandX));
    for (let y = 0; y < height; y += 1) paint(x, y, sx, y);
  }
  for (let dist = 1, x = right; x < width; dist += 1, x += 1) {
    const sx = Math.max(left, right - 1 - reflectInto(dist, bandX));
    for (let y = 0; y < height; y += 1) paint(x, y, sx, y);
  }
}

export async function sharpFill(bitmap, options) {
  const { width, height } = destBox(options);
  const placement = computePlacement(
    bitmap.width,
    bitmap.height,
    width,
    height,
    options.panX || 0,
    options.panY || 0,
    Boolean(options.deviceGuard),
    options.anchor || null,
    options.safe || null,
    true,
  );
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, placement.x, placement.y, placement.dw, placement.dh);
  const image = ctx.getImageData(0, 0, width, height);
  extendSharp(image, width, height, placement);
  ctx.putImageData(image, 0, 0);
  paintSubject(ctx, bitmap, placement, true);
  stampCaption(ctx, options.caption, width, height, options.safe);
  const quality = clamp(Number(options.quality) || 0.92, 0.7, 1);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  return { blob, engine: 'sharp' };
}

async function lamaPatch(sourceCanvas, maskCanvas, session, ort) {
  const size = 512;
  const pixels = sourceCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, size, size).data;
  const maskPixels = maskCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, size, size).data;
  const area = size * size;
  const image = new Float32Array(3 * area);
  const mask = new Float32Array(area);
  for (let i = 0; i < area; i += 1) {
    const erase = maskPixels[i * 4] > 127;
    mask[i] = erase ? 1 : 0;
    const offset = i * 4;
    image[i] = erase ? 0 : pixels[offset] / 255;
    image[area + i] = erase ? 0 : pixels[offset + 1] / 255;
    image[area * 2 + i] = erase ? 0 : pixels[offset + 2] / 255;
  }
  const imageTensor = new ort.Tensor('float32', image, [1, 3, size, size]);
  const maskTensor = new ort.Tensor('float32', mask, [1, 1, size, size]);
  const feeds = {};
  for (const name of session.inputNames) {
    feeds[name] = name.toLowerCase().includes('mask') ? maskTensor : imageTensor;
  }
  const result = await session.run(feeds);
  const data = result[session.outputNames[0]].data;
  let peak = 0;
  for (let i = 0; i < Math.min(data.length, 4000); i += 17) peak = Math.max(peak, data[i]);
  const scale = peak <= 1.5 ? 255 : 1;
  const painted = new OffscreenCanvas(size, size);
  const ctx = painted.getContext('2d');
  const frame = ctx.createImageData(size, size);
  for (let i = 0; i < area; i += 1) {
    const offset = i * 4;
    frame.data[offset] = Math.max(0, Math.min(255, data[i] * scale));
    frame.data[offset + 1] = Math.max(0, Math.min(255, data[area + i] * scale));
    frame.data[offset + 2] = Math.max(0, Math.min(255, data[area * 2 + i] * scale));
    frame.data[offset + 3] = 255;
  }
  ctx.putImageData(frame, 0, 0);
  return painted;
}

export async function inpaintRects(bitmap, rects, session, ort) {
  const width = bitmap.width;
  const height = bitmap.height;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  for (const rect of rects) {
    const pad = Math.max(8, Math.round(Math.max(rect.w, rect.h) * 0.6));
    const x0 = clampInt(rect.x - pad, 0, width - 2);
    const y0 = clampInt(rect.y - pad, 0, height - 2);
    const x1 = clampInt(rect.x + rect.w + pad, x0 + 2, width);
    const y1 = clampInt(rect.y + rect.h + pad, y0 + 2, height);
    const side = Math.max(x1 - x0, y1 - y0, 32);
    const roi = Math.min(side, width, height);
    const sx = clampInt(x0 + (x1 - x0) / 2 - roi / 2, 0, Math.max(0, width - roi));
    const sy = clampInt(y0 + (y1 - y0) / 2 - roi / 2, 0, Math.max(0, height - roi));
    const sample = new OffscreenCanvas(512, 512);
    const sctx = sample.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(canvas, sx, sy, roi, roi, 0, 0, 512, 512);
    const mask = new OffscreenCanvas(512, 512);
    const mctx = mask.getContext('2d');
    mctx.fillStyle = '#fff';
    const mx = ((rect.x - 2 - sx) / roi) * 512;
    const my = ((rect.y - 2 - sy) / roi) * 512;
    const mw = ((rect.w + 4) / roi) * 512;
    const mh = ((rect.h + 4) / roi) * 512;
    mctx.fillRect(mx, my, mw, mh);
    const patched = await lamaPatch(sample, mask, session, ort);
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x - 1, rect.y - 1, rect.w + 2, rect.h + 2);
    ctx.clip();
    ctx.drawImage(patched, sx, sy, roi, roi);
    ctx.restore();
  }
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
}
