function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function salienceAnchor(data, width, height) {
  let meanR = 0;
  let meanG = 0;
  let meanB = 0;
  let samples = 0;
  for (let i = 0; i < data.length; i += 16) {
    meanR += data[i];
    meanG += data[i + 1];
    meanB += data[i + 2];
    samples += 1;
  }
  meanR /= samples || 1;
  meanG /= samples || 1;
  meanB /= samples || 1;

  const winW = Math.max(3, Math.round(width * 0.22));
  const winH = Math.max(3, Math.round(height * 0.22));
  const stepX = Math.max(1, Math.round(winW / 3));
  const stepY = Math.max(1, Math.round(winH / 3));
  let best = { score: -Infinity, nx: 0.5, ny: 0.5, label: 'subject' };

  for (let gy = 0; gy + winH <= height; gy += stepY) {
    for (let gx = 0; gx + winW <= width; gx += stepX) {
      let score = 0;
      let count = 0;
      let skin = 0;
      for (let y = gy; y < gy + winH; y += 2) {
        const row = y * width;
        for (let x = gx; x < gx + winW; x += 2) {
          const i = (row + x) * 4;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const saturation = max === 0 ? 0 : (max - min) / max;
          const rarity = Math.hypot(r - meanR, g - meanG, b - meanB) / 441;
          const isSkin = r > 95 && g > 40 && b > 20 && r > g && r > b && r - Math.min(g, b) > 15;
          if (isSkin) skin += 1;
          score += rarity * 0.7 + saturation * 0.3 + (isSkin ? 0.5 : 0);
          count += 1;
        }
      }
      const nx = (gx + winW / 2) / width;
      const ny = (gy + winH / 2) / height;
      const average = score / count + 0.03 * (1 - Math.hypot((nx - 0.5) * 1.15, ny - 0.5));
      if (average > best.score) {
        best = {
          score: average,
          nx,
          ny,
          label: skin / count > 0.34 ? 'person' : 'subject',
        };
      }
    }
  }

  const clipped = [];
  if (best.ny - 0.11 <= 0.02) clipped.push('top');
  if (best.ny + 0.11 >= 0.98) clipped.push('bottom');
  return {
    nx: clamp(best.nx, 0.08, 0.92),
    ny: clamp(best.ny, 0.08, 0.92),
    nw: 0.34,
    nh: 0.34,
    label: best.label,
    source: 'saliency',
    clipped,
  };
}
