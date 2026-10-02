function asView(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function readOrientation(view, start, length) {
  if (length < 16) return 1;
  if (view.getUint32(start) !== 0x45786966) return 1;
  const tiff = start + 6;
  const endian = view.getUint16(tiff);
  const le = endian === 0x4949;
  if (!le && endian !== 0x4d4d) return 1;
  const u16 = (offset) => view.getUint16(offset, le);
  const u32 = (offset) => view.getUint32(offset, le);
  if (u16(tiff + 2) !== 0x002a) return 1;
  let ifd = tiff + u32(tiff + 4);
  const end = start + length;
  if (ifd + 2 > end || ifd + 2 > view.byteLength) return 1;
  const count = u16(ifd);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > view.byteLength) break;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

export function readJpegMeta(bytes) {
  try {
    const view = asView(bytes);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) {
      return { orientation: 1, width: 0, height: 0 };
    }
    let offset = 2;
    let orientation = 1;
    let width = 0;
    let height = 0;
    while (offset + 4 < view.byteLength) {
      if (view.getUint8(offset) !== 0xff) break;
      const marker = view.getUint8(offset + 1);
      if (marker === 0xda || marker === 0xd9) break;
      const size = view.getUint16(offset + 2);
      if (size < 2 || offset + 2 + size > view.byteLength) break;
      if (marker === 0xe1) {
        orientation = readOrientation(view, offset + 4, size - 2) || orientation;
      } else if (marker >= 0xc0 && marker <= 0xc3 && size >= 7) {
        height = view.getUint16(offset + 5);
        width = view.getUint16(offset + 7);
      }
      offset += 2 + size;
    }
    return { orientation, width, height };
  } catch {
    return { orientation: 1, width: 0, height: 0 };
  }
}

export function readPngSize(bytes) {
  if (!bytes || bytes.length < 24) return null;
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
    return null;
  }
  const view = asView(bytes);
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
  };
}

export function isHeicFile(file) {
  return /hei[cf]/i.test(file.type || '') || /\.hei[cf]$/i.test(file.name || '');
}

export function displaySize(width, height, orientation) {
  if (!width || !height) return { width: 0, height: 0 };
  if (orientation >= 5 && orientation <= 8) return { width: height, height: width };
  return { width, height };
}

export async function prepareImage(file) {
  if (isHeicFile(file)) {
    const heicModule = await import('heic2any');
    const heic2any = heicModule.default?.default || heicModule.default;
    const converted = await heic2any({
      blob: file,
      toType: 'image/jpeg',
      quality: 0.92,
    });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const meta = readJpegMeta(bytes);
    const oriented = displaySize(meta.width, meta.height, meta.orientation || 1);
    return {
      bytes,
      mime: 'image/jpeg',
      orientation: meta.orientation || 1,
      rawWidth: meta.width || 0,
      rawHeight: meta.height || 0,
      width: oriented.width,
      height: oriented.height,
      previewBlob: new Blob([bytes], { type: 'image/jpeg' }),
    };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let mime = file.type || 'application/octet-stream';
  let orientation = 1;
  let rawWidth = 0;
  let rawHeight = 0;

  if (bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const meta = readJpegMeta(bytes);
    orientation = meta.orientation || 1;
    rawWidth = meta.width || 0;
    rawHeight = meta.height || 0;
    mime = 'image/jpeg';
  } else {
    const png = readPngSize(bytes);
    if (png) {
      rawWidth = png.width;
      rawHeight = png.height;
      mime = 'image/png';
    } else if ((file.type || '').includes('webp') || /\.webp$/i.test(file.name || '')) {
      mime = 'image/webp';
    }
  }

  const oriented = displaySize(rawWidth, rawHeight, orientation);
  return {
    bytes,
    mime,
    orientation,
    rawWidth,
    rawHeight,
    width: oriented.width,
    height: oriented.height,
    previewBlob: new Blob([bytes], { type: mime }),
  };
}
