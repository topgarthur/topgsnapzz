import { STORY_HEIGHT, STORY_WIDTH, clamp, computePlacement, destBox, fitsStory, paintSubject, stampCaption } from './smartResize.js';

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

function openRoom(placement, anchor, height) {
  const clipped = anchor?.clipped || [];
  if (!clipped.includes('top')) return placement;
  const room = Math.round(height * (clipped.length ? 0.14 : 0));
  if (placement.y >= room) return placement;
  const dh = height - room;
  const scale = dh / Math.max(1, placement.dh);
  const dw = placement.dw * scale;
  return {
    ...placement,
    x: placement.x + (placement.dw - dw) / 2,
    y: room,
    dw,
    dh,
    scale: placement.scale * scale,
  };
}

function inferBitmap(bitmap) {
  const width = 90;
  const band = 8;
  const canvas = new OffscreenCanvas(width, band);
  const sample = canvas.getContext('2d', { willReadFrequently: true });
  sample.drawImage(bitmap, 0, 0, bitmap.width, Math.max(2, bitmap.height * 0.035), 0, 0, width, band);
  const image = sample.getImageData(0, 0, width, band).data;
  const average = (x0, x1) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    for (let y = 0; y < band; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const offset = (y * width + x) * 4;
        r += image[offset];
        g += image[offset + 1];
        b += image[offset + 2];
        count += 1;
      }
    }
    return [r / count, g / count, b / count];
  };
  const side = average(0, 16);
  const other = average(width - 16, width);
  const center = average(32, 58);
  const sideMean = [(side[0] + other[0]) / 2, (side[1] + other[1]) / 2, (side[2] + other[2]) / 2];
  const distance = Math.hypot(center[0] - sideMean[0], center[1] - sideMean[1], center[2] - sideMean[2]);
  if (distance < 48) return null;
  return { nx: 0.5, ny: 0.16, nw: 0.42, nh: 0.3, label: 'person', clipped: ['top'] };
}

function paintBackdrop(ctx, width, height, placement) {
  const left = Math.round(placement.x);
  const top = Math.round(placement.y);
  const right = Math.round(placement.x + placement.dw);
  const bottom = Math.round(placement.y + placement.dh);
  const photoW = Math.max(1, right - left);
  const photoH = Math.max(1, bottom - top);
  const margin = Math.max(10, Math.round(photoW * 0.18));
  const band = Math.max(12, Math.min(56, Math.round(photoH * 0.1)));
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const paintStrip = (sx, sy, sw, sh, dx, dy, dw, dh) => {
    const tiny = new OffscreenCanvas(18, 12);
    tiny.getContext('2d').drawImage(ctx.canvas, sx, sy, Math.max(1, sw), Math.max(1, sh), 0, 0, 18, 12);
    ctx.drawImage(tiny, dx, dy, Math.max(1, dw), Math.max(1, dh));
  };

  if (top > 1) {
    const tiny = new OffscreenCanvas(24, 16);
    const sample = tiny.getContext('2d');
    sample.drawImage(ctx.canvas, left, top, margin, band, 0, 0, 12, 16);
    sample.drawImage(ctx.canvas, right - margin, top, margin, band, 12, 0, 12, 16);
    ctx.drawImage(tiny, left, 0, photoW, top);
  }
  if (bottom < height - 1) {
    paintStrip(left, bottom - band, margin, band, left, bottom, Math.round(photoW / 2), height - bottom);
    paintStrip(right - margin, bottom - band, margin, band, left + Math.round(photoW / 2), bottom, photoW - Math.round(photoW / 2), height - bottom);
  }
  if (left > 1) paintStrip(left, top, Math.min(margin, photoW), photoH, 0, top, left, photoH);
  if (right < width - 1) paintStrip(right - Math.min(margin, photoW), top, Math.min(margin, photoW), photoH, right, top, width - right, photoH);
}

function frameTopgai(bitmap, options) {
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
  const anchor = options.anchor?.clipped?.includes('top') ? options.anchor : inferBitmap(bitmap);
  const placed = openRoom(placement, anchor, height);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, placed.x, placed.y, placed.dw, placed.dh);
  paintBackdrop(ctx, width, height, placed);
  paintSubject(ctx, bitmap, placed, true);
  stampCaption(ctx, options.caption, width, height, options.safe);
  return { canvas, width, height, placed, anchor };
}

function buildTopgaiMask(width, height, placed, anchor) {
  const mask = new OffscreenCanvas(width, height);
  const ctx = mask.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000000';
  ctx.fillRect(placed.x, placed.y, placed.dw, placed.dh);
  if (anchor?.clipped?.includes('top')) {
    const subW = Math.max(32, (anchor.nw || 0.42) * placed.dw);
    const subH = Math.max(32, (anchor.nh || 0.3) * placed.dh);
    const cx = placed.x + (anchor.nx || 0.5) * placed.dw;
    const band = Math.max(16, Math.min(subH * 0.22, placed.dh * 0.16));
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(cx, placed.y, subW * 0.48, band, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  return mask;
}

export async function sharpFill(bitmap, options) {
  const framed = frameTopgai(bitmap, options);
  const quality = clamp(Number(options.quality) || 0.92, 0.7, 1);
  const blob = await framed.canvas.convertToBlob({ type: 'image/jpeg', quality });
  return { blob, engine: 'sharp' };
}

export async function topgaiAssets(bitmap, options) {
  const { width, height } = destBox(options);
  const detected = options.anchor?.clipped?.includes('top') ? options.anchor : inferBitmap(bitmap);
  if (fitsStory(bitmap.width, bitmap.height, width, height) && !detected?.clipped?.includes('top')) {
    return { skip: true };
  }
  const framed = frameTopgai(bitmap, options);
  const mask = buildTopgaiMask(framed.width, framed.height, framed.placed, framed.anchor);
  const quality = clamp(Number(options.quality) || 0.92, 0.7, 1);
  const [imageBlob, maskBlob] = await Promise.all([
    framed.canvas.convertToBlob({ type: 'image/jpeg', quality }),
    mask.convertToBlob({ type: 'image/png' }),
  ]);
  return { skip: false, width: framed.width, height: framed.height, imageBlob, maskBlob };
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
