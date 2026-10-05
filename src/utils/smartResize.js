export const STORY_WIDTH = 1080;
export const STORY_HEIGHT = 1920;

export const FRAME_SIZES = {
  story: { id: 'story', label: '9:16 snap', width: 1080, height: 1920 },
  tall: { id: 'tall', label: 'Tall phone', width: 1080, height: 2400 },
};

export function frameBox(id) {
  return FRAME_SIZES[id] || FRAME_SIZES.story;
}

export function destBox(options = {}) {
  const picked = options.frameSize ? frameBox(options.frameSize) : null;
  return {
    width: Number(options.width) || picked?.width || STORY_WIDTH,
    height: Number(options.height) || picked?.height || STORY_HEIGHT,
  };
}

export const SNAPCHAT = { id: 'snapchat', name: 'Snapchat', top: 0.1, bottom: 0.22, side: 0.03 };

export const DEVICE_PROFILES = {
  either: { id: 'either', label: 'Either phone', top: 0.1, bottom: 0.22, side: 0.03 },
  iphone: { id: 'iphone', label: 'iPhone 14/15 Pro', top: 0.1, bottom: 0.22, side: 0.03 },
  android: { id: 'android', label: 'Android 20:9', top: 0.08, bottom: 0.15, side: 0.02 },
};

export function deviceProfile(id) {
  return DEVICE_PROFILES[id] || DEVICE_PROFILES.either;
}

export const SAFE_TOP = SNAPCHAT.top;
export const SAFE_BOTTOM = SNAPCHAT.bottom;
export const SAFE_SIDE = SNAPCHAT.side;
export const SAFE_CENTER_Y = (SAFE_TOP + (1 - SAFE_BOTTOM)) / 2;

function safeInsets(safe) {
  const source = safe && Number.isFinite(safe.top) && Number.isFinite(safe.bottom) ? safe : SNAPCHAT;
  return {
    top: source.top,
    bottom: source.bottom,
    side: Number.isFinite(source.side) ? source.side : SNAPCHAT.side,
    centerY: (source.top + (1 - source.bottom)) / 2,
  };
}

const BAND = 0.12;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function computePlacement(
  srcW,
  srcH,
  dstW,
  dstH,
  panX = 0,
  panY = 0,
  deviceGuard = false,
  anchor = null,
  safe = null,
  pinBottom = false,
) {
  const zone = safeInsets(safe);
  const scale = Math.min(dstW / srcW, dstH / srcH);
  const dw = srcW * scale;
  const dh = srcH * scale;
  const slackX = dstW - dw;
  const slackY = dstH - dh;

  let x = slackX / 2;
  let y = pinBottom ? slackY : slackY / 2;
  if (anchor && Number.isFinite(anchor.nx) && Number.isFinite(anchor.ny)) {
    const targetX = dstW * 0.5;
    x += targetX - (x + clamp(anchor.nx, 0, 1) * dw);
    if (!pinBottom) {
      const targetY = (deviceGuard ? zone.centerY : 0.5) * dstH;
      y += targetY - (y + clamp(anchor.ny, 0, 1) * dh);
    }
  } else if (deviceGuard && !pinBottom) {
    const desired = dstH * zone.centerY - dstH / 2;
    const room = Math.max(0, slackY / 2);
    y += clamp(desired, -room, room);
  }

  x += panX * (slackX / 2);
  if (!pinBottom) y += panY * (slackY / 2);
  x = clamp(x, 0, Math.max(0, slackX));
  y = clamp(y, 0, Math.max(0, slackY));
  return { x, y, dw, dh, scale };
}

export function layoutStretch(srcW, srcH, dstW, dstH, panX = 0, panY = 0, deviceGuard = false, anchor = null, safe = null) {
  const zone = safeInsets(safe);
  const srcAspect = srcW / srcH;
  const dstAspect = dstW / dstH;
  if (Math.abs(srcAspect - dstAspect) < 0.012) {
    return {
      axis: 'none',
      bands: [
        {
          sx: 0,
          sy: 0,
          sw: srcW,
          sh: srcH,
          dx: 0,
          dy: 0,
          dw: dstW,
          dh: dstH,
          factor: 1,
          edge: 'none',
        },
      ],
      seams: [],
    };
  }

  if (srcAspect > dstAspect) {
    const sx = 0;
    const visibleW = srcW;
    const scale = dstW / visibleW;
    const centerSrc = srcH * (1 - 2 * BAND);
    const centerDst = centerSrc * scale;
    let centerY = (dstH - centerDst) / 2;
    if (deviceGuard) {
      const desired = dstH * zone.centerY - dstH / 2;
      const room = Math.max(0, (dstH - centerDst) / 2);
      centerY += clamp(desired, -room, room);
    }
    centerY += panY * dstH * 0.08;
    if (anchor && Number.isFinite(anchor.ny)) {
      const targetY = (deviceGuard ? zone.centerY : 0.5) * dstH;
      const currentY = centerY + clamp(anchor.ny, 0, 1) * centerDst;
      centerY += clamp(targetY - currentY, -dstH * 0.22, dstH * 0.22);
    }
    centerY = clamp(centerY, dstH * 0.02, Math.max(dstH * 0.02, dstH - centerDst - dstH * 0.02));
    const topSrc = srcH * BAND;
    const botSrc = srcH * BAND;
    const topH = centerY;
    const botY = centerY + centerDst;
    const botH = dstH - botY;
    return {
      axis: 'vertical',
      bands: [
        {
          sx,
          sy: 0,
          sw: visibleW,
          sh: topSrc,
          dx: 0,
          dy: 0,
          dw: dstW,
          dh: topH,
          factor: topH / (topSrc * scale),
          edge: 'top',
        },
        {
          sx,
          sy: topSrc,
          sw: visibleW,
          sh: centerSrc,
          dx: 0,
          dy: centerY,
          dw: dstW,
          dh: centerDst,
          factor: 1,
          edge: 'none',
        },
        {
          sx,
          sy: srcH - botSrc,
          sw: visibleW,
          sh: botSrc,
          dx: 0,
          dy: botY,
          dw: dstW,
          dh: botH,
          factor: botH / (botSrc * scale),
          edge: 'bottom',
        },
      ],
      seams: [
        { axis: 'horizontal', at: centerY },
        { axis: 'horizontal', at: botY },
      ],
    };
  }

  const sy = 0;
  const visibleH = srcH;
  const scale = dstH / visibleH;
  const centerSrc = srcW * (1 - 2 * BAND);
  const centerDst = centerSrc * scale;
  let centerX = (dstW - centerDst) / 2 + panX * dstW * 0.08;
  if (anchor && Number.isFinite(anchor.nx)) {
    const currentX = centerX + clamp(anchor.nx, 0, 1) * centerDst;
    centerX += clamp(dstW * 0.5 - currentX, -dstW * 0.22, dstW * 0.22);
  }
  centerX = clamp(centerX, dstW * 0.02, Math.max(dstW * 0.02, dstW - centerDst - dstW * 0.02));
  const sideSrc = srcW * BAND;
  const leftW = centerX;
  const rightX = centerX + centerDst;
  const rightW = dstW - rightX;
  return {
    axis: 'horizontal',
    bands: [
      {
        sx: 0,
        sy,
        sw: sideSrc,
        sh: visibleH,
        dx: 0,
        dy: 0,
        dw: leftW,
        dh: dstH,
        factor: leftW / (sideSrc * scale),
        edge: 'left',
      },
      {
        sx: sideSrc,
        sy,
        sw: centerSrc,
        sh: visibleH,
        dx: centerX,
        dy: 0,
        dw: centerDst,
        dh: dstH,
        factor: 1,
        edge: 'none',
      },
      {
        sx: srcW - sideSrc,
        sy,
        sw: sideSrc,
        sh: visibleH,
        dx: rightX,
        dy: 0,
        dw: rightW,
        dh: dstH,
        factor: rightW / (sideSrc * scale),
        edge: 'right',
      },
    ],
    seams: [
      { axis: 'vertical', at: centerX },
      { axis: 'vertical', at: rightX },
    ],
  };
}

function coverDraw(ctx, bitmap, width, height, panX, panY) {
  const scale = Math.max(width / bitmap.width, height / bitmap.height);
  const dw = bitmap.width * scale;
  const dh = bitmap.height * scale;
  const x = (width - dw) / 2 + panX * Math.max(0, dw - width) * 0.5;
  const y = (height - dh) / 2 + panY * Math.max(0, dh - height) * 0.5;
  ctx.drawImage(bitmap, x, y, dw, dh);
}

function makeAmbient(bitmap, panX, panY) {
  const mid = new OffscreenCanvas(48, 86);
  const midCtx = mid.getContext('2d');
  coverDraw(midCtx, bitmap, 48, 86, panX, panY);
  const tiny = new OffscreenCanvas(16, 28);
  tiny.getContext('2d').drawImage(mid, 0, 0, 16, 28);
  return tiny;
}

function edgeEnergy(bitmap) {
  const sample = new OffscreenCanvas(24, 24);
  const ctx = sample.getContext('2d', { willReadFrequently: true });
  const w = bitmap.width;
  const h = bitmap.height;
  const sw = Math.max(1, Math.round(w * 0.08));
  const sh = Math.max(1, Math.round(h * 0.08));
  ctx.drawImage(bitmap, 0, 0, w, sh, 0, 0, 24, 6);
  ctx.drawImage(bitmap, 0, h - sh, w, sh, 0, 18, 24, 6);
  ctx.drawImage(bitmap, 0, 0, sw, h, 0, 6, 6, 12);
  ctx.drawImage(bitmap, w - sw, 0, sw, h, 18, 6, 6, 12);
  const data = ctx.getImageData(0, 0, 24, 24).data;
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 16) {
    const luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    sum += luma;
    sumSq += luma * luma;
    count += 1;
  }
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

function blurMix(energy) {
  return 0.62 + Math.min(1, energy / 1600) * 0.28;
}

function paintMirror(ctx, bitmap, placement, feather, width, height) {
  const { x, y, dw, dh } = placement;
  const stripX = Math.max(1, bitmap.width * 0.16);
  const stripY = Math.max(1, bitmap.height * 0.16);

  if (y > 1) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, y + feather);
    ctx.clip();
    ctx.translate(x, y);
    ctx.scale(1, -1);
    ctx.drawImage(bitmap, 0, 0, bitmap.width, stripY, 0, 0, dw, Math.max(y, 1));
    ctx.restore();
  }
  if (y + dh < height - 1) {
    const gap = height - (y + dh);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y + dh - feather, width, gap + feather);
    ctx.clip();
    ctx.translate(x, y + dh);
    ctx.scale(1, -1);
    ctx.drawImage(bitmap, 0, bitmap.height - stripY, bitmap.width, stripY, 0, -gap, dw, gap);
    ctx.restore();
  }
  if (x > 1) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, x + feather, height);
    ctx.clip();
    ctx.translate(x, y);
    ctx.scale(-1, 1);
    ctx.drawImage(bitmap, 0, 0, stripX, bitmap.height, 0, 0, Math.max(x, 1), dh);
    ctx.restore();
  }
  if (x + dw < width - 1) {
    const gap = width - (x + dw);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + dw - feather, 0, gap + feather, height);
    ctx.clip();
    ctx.translate(x + dw, y);
    ctx.scale(-1, 1);
    ctx.drawImage(bitmap, bitmap.width - stripX, 0, stripX, bitmap.height, -gap, 0, gap, dh);
    ctx.restore();
  }
}

export function paintSubject(ctx, bitmap, placement, solid = false) {
  if (solid) {
    ctx.drawImage(bitmap, placement.x, placement.y, placement.dw, placement.dh);
    return;
  }
  paintSharp(ctx, bitmap, placement, ctx.canvas.width, ctx.canvas.height);
}

export function stampCaption(ctx, text, width, height, safe) {
  const caption = String(text || '').trim();
  if (!caption) return;
  const bottom = Number.isFinite(safe?.bottom) ? safe.bottom : SNAPCHAT.bottom;
  const side = Number.isFinite(safe?.side) ? safe.side : SNAPCHAT.side;
  const maxWidth = width * (1 - side * 2 - 0.06);
  const y = height * (1 - bottom) - height * 0.035;
  ctx.save();
  ctx.font = `700 ${Math.round(width * 0.046)}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineWidth = Math.max(4, Math.round(width * 0.008));
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.fillStyle = '#ffffff';
  ctx.strokeText(caption, width / 2, y, maxWidth);
  ctx.fillText(caption, width / 2, y, maxWidth);
  ctx.restore();
}

function paintSharp(ctx, bitmap, placement, width, height) {
  const { x, y, dw, dh } = placement;
  const fadeTop = y > 1;
  const fadeBottom = y + dh < height - 1;
  const fadeLeft = x > 1;
  const fadeRight = x + dw < width - 1;
  if (!fadeTop && !fadeBottom && !fadeLeft && !fadeRight) {
    ctx.drawImage(bitmap, x, y, dw, dh);
    return;
  }

  const gaps = [
    fadeTop ? y : 0,
    fadeBottom ? height - (y + dh) : 0,
    fadeLeft ? x : 0,
    fadeRight ? width - (x + dw) : 0,
  ];
  const feather = Math.round(clamp(Math.max(...gaps) * 0.28, 18, 72));
  const canvas = new OffscreenCanvas(Math.max(1, Math.ceil(dw)), Math.max(1, Math.ceil(dh)));
  const octx = canvas.getContext('2d');
  octx.drawImage(bitmap, 0, 0, dw, dh);
  octx.globalCompositeOperation = 'destination-in';

  const fade = (edge) => {
    let gradient;
    if (edge === 'top') gradient = octx.createLinearGradient(0, 0, 0, feather);
    if (edge === 'bottom') gradient = octx.createLinearGradient(0, dh, 0, dh - feather);
    if (edge === 'left') gradient = octx.createLinearGradient(0, 0, feather, 0);
    if (edge === 'right') gradient = octx.createLinearGradient(dw, 0, dw - feather, 0);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,1)');
    octx.fillStyle = gradient;
    octx.fillRect(0, 0, dw, dh);
  };
  if (fadeTop) fade('top');
  if (fadeBottom) fade('bottom');
  if (fadeLeft) fade('left');
  if (fadeRight) fade('right');
  ctx.drawImage(canvas, x, y);
}

function seamlessBlend(ctx, bitmap, width, height, options) {
  const placement = computePlacement(
    bitmap.width,
    bitmap.height,
    width,
    height,
    options.panX,
    options.panY,
    options.deviceGuard,
    options.anchor,
    options.safe,
  );
  const ambient = makeAmbient(bitmap, options.panX || 0, options.panY || 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(ambient, -2, -2, width + 4, height + 4);
  const feather = 36;
  paintMirror(ctx, bitmap, placement, feather, width, height);

  try {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.rect(placement.x, placement.y, placement.dw, placement.dh);
    ctx.clip('evenodd');
    ctx.globalAlpha = blurMix(edgeEnergy(bitmap));
    ctx.drawImage(ambient, -2, -2, width + 4, height + 4);
    ctx.restore();
  } catch {
    // Mirrored edges and the sharp subject still fill the frame.
  }

  paintSharp(ctx, bitmap, placement, width, height);
}

function roundBands(bands, width, height, axis) {
  const rects = bands.map((band) => ({
    ...band,
    dx: Math.round(band.dx),
    dy: Math.round(band.dy),
    dw: Math.max(1, Math.round(band.dw)),
    dh: Math.max(1, Math.round(band.dh)),
  }));
  if (axis === 'horizontal' && rects.length) {
    const last = rects[rects.length - 1];
    last.dw = Math.max(1, width - last.dx);
  }
  if (axis !== 'horizontal' && rects.length) {
    const last = rects[rects.length - 1];
    last.dh = Math.max(1, height - last.dy);
  }
  for (let i = 0; i < rects.length - 1; i += 1) {
    if (axis === 'horizontal') rects[i].dw += 1;
    else rects[i].dh += 1;
  }
  return rects;
}

function softenSeam(ctx, width, height, seam) {
  const span = 16;
  if (seam.axis === 'horizontal') {
    const y = clamp(Math.round(seam.at - span / 2), 0, height - span);
    const strip = new OffscreenCanvas(width, span);
    strip.getContext('2d').drawImage(ctx.canvas, 0, y, width, span, 0, 0, width, span);
    const tiny = new OffscreenCanvas(Math.max(8, Math.round(width / 24)), 4);
    tiny.getContext('2d').drawImage(strip, 0, 0, tiny.width, tiny.height);
    ctx.drawImage(tiny, 0, y, width, span);
    return;
  }
  const x = clamp(Math.round(seam.at - span / 2), 0, width - span);
  const strip = new OffscreenCanvas(span, height);
  strip.getContext('2d').drawImage(ctx.canvas, x, 0, span, height, 0, 0, span, height);
  const tiny = new OffscreenCanvas(4, Math.max(8, Math.round(height / 24)));
  tiny.getContext('2d').drawImage(strip, 0, 0, tiny.width, tiny.height);
  ctx.drawImage(tiny, x, 0, span, height);
}

function softenOuterBand(ctx, band) {
  if (!band.edge || band.edge === 'none' || !(band.factor > 2.2)) return;
  const tiny = new OffscreenCanvas(28, 28);
  tiny.getContext('2d').drawImage(ctx.canvas, band.dx, band.dy, band.dw, band.dh, 0, 0, 28, 28);
  ctx.save();
  ctx.beginPath();
  if (band.edge === 'top') ctx.rect(band.dx, band.dy, band.dw, band.dh * 0.62);
  if (band.edge === 'bottom') ctx.rect(band.dx, band.dy + band.dh * 0.38, band.dw, band.dh * 0.62);
  if (band.edge === 'left') ctx.rect(band.dx, band.dy, band.dw * 0.62, band.dh);
  if (band.edge === 'right') ctx.rect(band.dx + band.dw * 0.38, band.dy, band.dw * 0.62, band.dh);
  ctx.clip();
  ctx.drawImage(tiny, band.dx, band.dy, band.dw, band.dh);
  ctx.restore();
}

function smartStretch(ctx, bitmap, width, height, options) {
  const layout = layoutStretch(
    bitmap.width,
    bitmap.height,
    width,
    height,
    options.panX,
    options.panY,
    options.deviceGuard,
    options.anchor,
    options.safe,
  );
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const bands = roundBands(layout.bands, width, height, layout.axis);
  for (const band of bands) {
    if (band.sw < 1 || band.sh < 1 || band.dw < 1 || band.dh < 1) continue;
    ctx.drawImage(bitmap, band.sx, band.sy, band.sw, band.sh, band.dx, band.dy, band.dw, band.dh);
  }
  for (const band of bands) softenOuterBand(ctx, band);
  for (const seam of layout.seams) softenSeam(ctx, width, height, seam);
}

export function fitsStory(srcW, srcH, dstW = STORY_WIDTH, dstH = STORY_HEIGHT) {
  if (!srcW || !srcH || !dstW || !dstH) return false;
  return Math.abs(srcW / srcH - dstW / dstH) < 0.012;
}

export async function paintFullFrame(bitmap, options = {}) {
  const { width, height } = destBox(options);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const placement = computePlacement(
    bitmap.width,
    bitmap.height,
    width,
    height,
    options.panX || 0,
    options.panY || 0,
    options.deviceGuard,
    options.anchor,
    options.safe,
  );
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, placement.x, placement.y, placement.dw, placement.dh);
  stampCaption(ctx, options.caption, width, height, options.safe);
  const quality = clamp(Number(options.quality) || 0.92, 0.7, 1);
  return canvas.convertToBlob({ type: 'image/jpeg', quality });
}

export async function composeStory(bitmap, options = {}) {
  if (!bitmap || bitmap.width < 2 || bitmap.height < 2) {
    throw new Error('Image is too small to frame.');
  }
  const { width, height } = destBox(options);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const mode = options.mode === 'stretch' ? 'stretch' : 'blend';
  if (mode === 'stretch') smartStretch(ctx, bitmap, width, height, options);
  else seamlessBlend(ctx, bitmap, width, height, options);
  stampCaption(ctx, options.caption, width, height, options.safe);
  const quality = clamp(Number(options.quality) || 0.92, 0.7, 1);
  return canvas.convertToBlob({ type: 'image/jpeg', quality });
}
