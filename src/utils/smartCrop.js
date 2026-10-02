function overlaps(a, b, pad = 6) {
  return a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
}

function unite(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
    text: `${a.text} ${b.text}`.trim(),
  };
}

export function mergeBoxes(boxes) {
  const list = boxes.map((box) => ({ ...box }));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        if (!overlaps(list[i], list[j])) continue;
        list[i] = unite(list[i], list[j]);
        list.splice(j, 1);
        changed = true;
        break;
      }
      if (changed) break;
    }
  }
  return list;
}

export function edgeCrop(width, height, boxes) {
  if (!boxes?.length || width < 2 || height < 2) return null;
  let left = 0;
  let top = 0;
  let right = width;
  let bottom = height;
  let used = false;
  const limit = Math.min(width, height) * 0.28;
  for (const box of boxes) {
    const distances = {
      left: box.x,
      right: width - (box.x + box.w),
      top: box.y,
      bottom: height - (box.y + box.h),
    };
    const horizontal = box.w >= box.h;
    let edgeName = null;
    if (horizontal) edgeName = distances.top <= distances.bottom ? 'top' : 'bottom';
    else edgeName = distances.left <= distances.right ? 'left' : 'right';
    if (distances[edgeName] > limit) {
      const nearest = Object.entries(distances).sort((a, b) => a[1] - b[1])[0];
      edgeName = nearest && nearest[1] <= limit ? nearest[0] : null;
    }
    if (!edgeName) continue;
    const pad = 6;
    used = true;
    if (edgeName === 'bottom') bottom = Math.min(bottom, Math.max(1, box.y - pad));
    else if (edgeName === 'top') top = Math.max(top, Math.min(height - 1, box.y + box.h + pad));
    else if (edgeName === 'left') left = Math.max(left, Math.min(width - 1, box.x + box.w + pad));
    else right = Math.min(right, Math.max(1, box.x - pad));
  }
  if (!used) return null;
  const w = right - left;
  const h = bottom - top;
  if (w < width * 0.45 || h < height * 0.45) return null;
  if (w >= width - 1 && h >= height - 1) return null;
  return { x: left, y: top, w, h };
}

export async function cropBitmap(bitmap, rect) {
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(rect.w)), Math.max(1, Math.round(rect.h)));
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, rect.x, rect.y, rect.w, rect.h, 0, 0, canvas.width, canvas.height);
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
}

function boxFrom(entry) {
  if (!entry) return null;
  const text = String(entry.text || '').trim();
  if (!text) return null;
  const confidence = Number(entry.confidence ?? 80);
  if (confidence < 20) return null;
  const bbox = entry.bbox || entry.boundingBox;
  let x;
  let y;
  let w;
  let h;
  if (bbox && bbox.x0 != null) {
    x = bbox.x0;
    y = bbox.y0;
    w = bbox.x1 - bbox.x0;
    h = bbox.y1 - bbox.y0;
  } else if (bbox && bbox.width != null) {
    x = bbox.x;
    y = bbox.y;
    w = bbox.width;
    h = bbox.height;
  } else if (entry.w != null) {
    x = entry.x;
    y = entry.y;
    w = entry.w;
    h = entry.h;
  } else {
    return null;
  }
  if (![x, y, w, h].every(Number.isFinite) || w < 1 || h < 1) return null;
  return { x, y, w, h, text };
}

function collectBoxes(blocks) {
  const lines = [];
  const words = [];
  for (const block of blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        const lineBox = boxFrom(line);
        if (lineBox) lines.push(lineBox);
        for (const word of line.words || []) {
          const wordBox = boxFrom(word);
          if (wordBox) words.push(wordBox);
        }
      }
    }
  }
  return { lines, words };
}

function looksLikeMark(text) {
  const value = text.toLowerCase();
  return value.length >= 8 || /https?:|www\.|\.com|\.net|@/.test(value);
}

function matches(box, needle) {
  const hay = box.text.toLowerCase();
  if (!needle) return looksLikeMark(box.text);
  if (hay.includes(needle)) return true;
  return needle.includes(hay) && hay.length >= 5;
}

function rotateCanvas(source, turns) {
  const w = source.width;
  const h = source.height;
  if (!turns) return source;
  const canvas = new OffscreenCanvas(turns % 2 ? h : w, turns % 2 ? w : h);
  const ctx = canvas.getContext('2d');
  if (turns === 1) {
    ctx.translate(h, 0);
    ctx.rotate(Math.PI / 2);
  } else if (turns === 2) {
    ctx.translate(w, h);
    ctx.rotate(Math.PI);
  } else {
    ctx.translate(0, w);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.drawImage(source, 0, 0);
  return canvas;
}

function unrotatePoint(x, y, turns, width, height) {
  if (turns === 1) return [y, height - x];
  if (turns === 2) return [width - x, height - y];
  if (turns === 3) return [width - y, x];
  return [x, y];
}

function unrotateBox(box, turns, width, height) {
  const corners = [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x, box.y + box.h],
    [box.x + box.w, box.y + box.h],
  ].map(([x, y]) => unrotatePoint(x, y, turns, width, height));
  const xs = corners.map((point) => point[0]);
  const ys = corners.map((point) => point[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { ...box, x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

let workerPromise = null;

function ocrWorker() {
  if (!workerPromise) {
    workerPromise = import('tesseract.js')
      .then(({ createWorker }) =>
        createWorker('eng', 1, {
          workerPath: '/tess/worker.min.js',
          corePath: '/tess/tesseract-core-simd-lstm.wasm.js',
          langPath: '/tess',
          workerBlobURL: false,
        }),
      )
      .catch((error) => {
        workerPromise = null;
        throw error;
      });
  }
  return workerPromise;
}

async function readTurn(worker, small, turns, scale) {
  const canvas = rotateCanvas(small, turns);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
  const { data } = await worker.recognize(blob, {}, { blocks: true });
  const collected = collectBoxes(data.blocks);
  const map = (box) => {
    const upright = unrotateBox(box, turns, small.width, small.height);
    return {
      ...upright,
      x: upright.x / scale,
      y: upright.y / scale,
      w: upright.w / scale,
      h: upright.h / scale,
    };
  };
  return { lines: collected.lines.map(map), words: collected.words.map(map) };
}

function pickHits(collected, needle) {
  const lines = collected.lines.filter((box) => matches(box, needle));
  const words = collected.words.filter((box) => matches(box, needle));
  return mergeBoxes(lines.length ? lines : words);
}

export async function findTextBoxes(file, query, width, height) {
  const worker = await ocrWorker();
  const bitmap = await createImageBitmap(file);
  try {
    const maxEdge = 720;
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    const small = new OffscreenCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
    small.getContext('2d').drawImage(bitmap, 0, 0, small.width, small.height);
    const needle = String(query || '').trim().toLowerCase();
    const turns = needle ? [0, 1, 3, 2] : [0, 1, 3];
    let found = [];
    for (const turn of turns) {
      const collected = await readTurn(worker, small, turn, scale);
      found = mergeBoxes([...found, ...pickHits(collected, needle)]);
      if (needle && found.length) break;
    }
    return found;
  } finally {
    bitmap.close?.();
  }
}

export async function coverRects(bitmap, rects) {
  const width = bitmap.width;
  const height = bitmap.height;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  for (const rect of rects) {
    const x = Math.max(0, Math.floor(rect.x - 3));
    const y = Math.max(0, Math.floor(rect.y - 3));
    const w = Math.min(width - x, Math.ceil(rect.w + 6));
    const h = Math.min(height - y, Math.ceil(rect.h + 6));
    if (w < 1 || h < 1) continue;
    const pad = Math.max(6, Math.round(Math.min(w, h)));
    const patches = [];
    if (y >= 2) patches.push([x, Math.max(0, y - pad), w, Math.min(pad, y)]);
    if (y + h < height - 1) patches.push([x, y + h, w, Math.min(pad, height - (y + h))]);
    if (x >= 2) patches.push([Math.max(0, x - pad), y, Math.min(pad, x), h]);
    if (x + w < width - 1) patches.push([x + w, y, Math.min(pad, width - (x + w)), h]);
    patches.forEach((patch, index) => {
      ctx.globalAlpha = index === 0 ? 1 : 0.5;
      ctx.drawImage(canvas, patch[0], patch[1], Math.max(1, patch[2]), Math.max(1, patch[3]), x, y, w, h);
    });
    ctx.globalAlpha = 1;
  }
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
}
