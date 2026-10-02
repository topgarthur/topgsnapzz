const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosStamp(date = new Date()) {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day =
    ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: day };
}

async function deflateRaw(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  if (compressed.length >= bytes.length) return null;
  return compressed;
}

function concat(parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export async function buildZip(files, date = new Date()) {
  const encoder = new TextEncoder();
  const stamp = dosStamp(date);
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const raw = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
    const checksum = crc32(raw);
    const compressed = await deflateRaw(raw);
    const method = compressed ? 8 : 0;
    const payload = compressed || raw;

    const local = new Uint8Array(30 + name.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, method, true);
    view.setUint16(10, stamp.time, true);
    view.setUint16(12, stamp.date, true);
    view.setUint32(14, checksum, true);
    view.setUint32(18, payload.length, true);
    view.setUint32(22, raw.length, true);
    view.setUint16(26, name.length, true);
    view.setUint16(28, 0, true);
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const cview = new DataView(central.buffer);
    cview.setUint32(0, 0x02014b50, true);
    cview.setUint16(4, 20, true);
    cview.setUint16(6, 20, true);
    cview.setUint16(8, 0x0800, true);
    cview.setUint16(10, method, true);
    cview.setUint16(12, stamp.time, true);
    cview.setUint16(14, stamp.date, true);
    cview.setUint32(16, checksum, true);
    cview.setUint32(20, payload.length, true);
    cview.setUint32(24, raw.length, true);
    cview.setUint16(28, name.length, true);
    cview.setUint16(30, 0, true);
    cview.setUint16(32, 0, true);
    cview.setUint16(34, 0, true);
    cview.setUint16(36, 0, true);
    cview.setUint32(38, 0, true);
    cview.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local, payload);
    centrals.push(central);
    offset += local.length + payload.length;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const eview = new DataView(end.buffer);
  eview.setUint32(0, 0x06054b50, true);
  eview.setUint16(4, 0, true);
  eview.setUint16(6, 0, true);
  eview.setUint16(8, files.length, true);
  eview.setUint16(10, files.length, true);
  eview.setUint32(12, centralSize, true);
  eview.setUint32(16, offset, true);
  eview.setUint16(20, 0, true);

  return new Blob([concat(locals), concat(centrals), end], { type: 'application/zip' });
}

export function zipEntryName(name, index) {
  const base = String(name || 'photo')
    .replace(/\.[^.]+$/, '')
    .replace(/[^\w\-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return `topgsnapzz_${String(index + 1).padStart(2, '0')}_${base || 'photo'}.jpg`;
}
