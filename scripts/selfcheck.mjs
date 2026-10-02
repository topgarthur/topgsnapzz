import { inflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { crc32, buildZip } from '../src/utils/zipBuilder.js';
import { displaySize, readJpegMeta, readPngSize } from '../src/utils/exifHandler.js';
import {
  DEVICE_PROFILES,
  SAFE_BOTTOM,
  SAFE_CENTER_Y,
  SAFE_SIDE,
  SAFE_TOP,
  SNAPCHAT,
  STORY_HEIGHT,
  STORY_WIDTH,
  computePlacement,
  fitsStory,
  layoutStretch,
  paintSubject,
} from '../src/utils/smartResize.js';
import { salienceAnchor } from '../src/utils/subjectAnchor.js';
import { edgeCrop, mergeBoxes } from '../src/utils/smartCrop.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const crc = crc32(new TextEncoder().encode('123456789'));
assert(crc === 0xcbf43926, `crc32 mismatch ${crc.toString(16)}`);

const zipBlob = await buildZip(
  [{ name: 'topgsnapzz_01_photo.jpg', data: new TextEncoder().encode('frame-bytes') }],
  new Date('2026-09-30T12:00:00Z'),
);
const zip = new Uint8Array(await zipBlob.arrayBuffer());
assert(zip[0] === 0x50 && zip[1] === 0x4b, 'zip local header');
const eocd = zip.length - 22;
assert(zip[eocd] === 0x50 && zip[eocd + 1] === 0x4b && zip[eocd + 2] === 0x05 && zip[eocd + 3] === 0x06, 'zip eocd');
const view = new DataView(zip.buffer);
const method = view.getUint16(8, true);
const compressedSize = view.getUint32(18, true);
const payload = zip.slice(30 + 'topgsnapzz_01_photo.jpg'.length, 30 + 'topgsnapzz_01_photo.jpg'.length + compressedSize);
const text = new TextDecoder().decode(method === 8 ? inflateRawSync(payload) : payload);
assert(text === 'frame-bytes', 'zip payload');

const exif = buildOrientationJpeg(6, 640, 480);
const meta = readJpegMeta(exif);
assert(meta.orientation === 6 && meta.width === 640 && meta.height === 480, 'jpeg meta');
const oriented = displaySize(meta.width, meta.height, meta.orientation);
assert(oriented.width === 480 && oriented.height === 640, 'display size swap');

const png = new Uint8Array(24);
png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
const pngView = new DataView(png.buffer);
pngView.setUint32(16, 800);
pngView.setUint32(20, 600);
const pngSize = readPngSize(png);
assert(pngSize.width === 800 && pngSize.height === 600, 'png size');

assert(SAFE_TOP === SNAPCHAT.top && SAFE_BOTTOM === SNAPCHAT.bottom && SAFE_SIDE === SNAPCHAT.side, 'safe zone is snapchat');
assert(Math.abs(SAFE_CENTER_Y - (SAFE_TOP + (1 - SAFE_BOTTOM)) / 2) < 1e-6, 'safe center');

const plain = computePlacement(1600, 900, STORY_WIDTH, STORY_HEIGHT, 0, 0, true, null);
assert(plain.x >= -0.5 && plain.y >= -0.5, 'default placement stays inside');
assert(plain.x + plain.dw <= STORY_WIDTH + 0.5 && plain.y + plain.dh <= STORY_HEIGHT + 0.5, 'default placement has no crop');

const shoved = computePlacement(1600, 900, STORY_WIDTH, STORY_HEIGHT, 1, 1, true, { nx: 0.1, ny: 0.9 });
assert(shoved.x >= -0.5 && shoved.y >= -0.5, 'pan keeps the photo inside');
assert(shoved.x + shoved.dw <= STORY_WIDTH + 0.5 && shoved.y + shoved.dh <= STORY_HEIGHT + 0.5, 'pan does not crop the photo');

const androidZone = (DEVICE_PROFILES.android.top + (1 - DEVICE_PROFILES.android.bottom)) / 2;
const androidLocked = computePlacement(1600, 900, STORY_WIDTH, STORY_HEIGHT, 0, 0, true, { nx: 0.5, ny: 0.86 }, DEVICE_PROFILES.android);
const androidFocus = androidLocked.y + 0.86 * androidLocked.dh;
assert(Math.abs(androidFocus - STORY_HEIGHT * androidZone) < 80, 'android profile moves the subject into its own safe center');
assert(androidLocked.y >= -0.5 && androidLocked.y + androidLocked.dh <= STORY_HEIGHT + 0.5, 'android profile keeps the full photo');
assert(
  DEVICE_PROFILES.either.top === Math.max(DEVICE_PROFILES.iphone.top, DEVICE_PROFILES.android.top) &&
    DEVICE_PROFILES.either.bottom === Math.max(DEVICE_PROFILES.iphone.bottom, DEVICE_PROFILES.android.bottom) &&
    DEVICE_PROFILES.either.side === Math.max(DEVICE_PROFILES.iphone.side, DEVICE_PROFILES.android.side),
  'either phone uses the stricter chat bar',
);
assert(fitsStory(1080, 1920), 'a 9:16 photo already fits');
assert(!fitsStory(960, 540), 'a wide photo needs topgai fill');

const lowSubject = computePlacement(1600, 900, STORY_WIDTH, STORY_HEIGHT, 0, 0, true, { nx: 0.5, ny: 0.86 });
const plainFocus = plain.y + 0.86 * plain.dh;
const lockedFocus = lowSubject.y + 0.86 * lowSubject.dh;
assert(lockedFocus < plainFocus - 40, 'subject anchor moves a low subject upward');
assert(Math.abs(lockedFocus - STORY_HEIGHT * SAFE_CENTER_Y) < 80, 'subject lands near the shared safe center');

const stretch = layoutStretch(1600, 900, STORY_WIDTH, STORY_HEIGHT, 1, 1, true, null);
const covered = stretch.bands.reduce((sum, band) => sum + band.dh, 0);
assert(Math.abs(covered - STORY_HEIGHT) < 0.6, 'stretch bands cover the frame');
const sourceCovered = stretch.bands.reduce((sum, band) => sum + band.sh, 0);
assert(Math.abs(sourceCovered - 900) < 0.6, 'stretch keeps the full source');

const width = 40;
const height = 30;
const pixels = new Uint8ClampedArray(width * height * 4);
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const i = (y * width + x) * 4;
    const inBlob = (x - 20) ** 2 + (y - 24) ** 2 < 16;
    pixels[i] = inBlob ? 220 : 180;
    pixels[i + 1] = inBlob ? 20 : 190;
    pixels[i + 2] = inBlob ? 40 : 200;
    pixels[i + 3] = 255;
  }
}
const anchor = salienceAnchor(pixels, width, height);
assert(anchor.ny > 0.6, `salience should lock onto the low subject, got ${anchor.ny}`);

const strip = edgeCrop(1000, 1400, [{ x: 40, y: 1320, w: 700, h: 40, text: 'mark' }]);
assert(strip && strip.y === 0 && strip.h < 1320 && strip.h > 1200, 'auto crop removes only the bottom text strip');
const side = edgeCrop(1000, 1400, [{ x: 920, y: 200, w: 36, h: 500, text: 'side' }]);
assert(side && side.x === 0 && side.w < 920 && side.w > 800, 'a sideways mark cuts only the side strip');
assert(edgeCrop(1000, 1400, [{ x: 400, y: 600, w: 80, h: 30, text: 'mid' }]) === null, 'center text is left for watermark removal');
assert(mergeBoxes([{ x: 10, y: 10, w: 20, h: 10, text: 'a' }, { x: 28, y: 10, w: 20, h: 10, text: 'b' }]).length === 1, 'nearby text boxes merge');

if (typeof OffscreenCanvas === 'function') {
  const solidCanvas = new OffscreenCanvas(100, 200);
  const solidCtx = solidCanvas.getContext('2d');
  solidCtx.fillStyle = '#0000ff';
  solidCtx.fillRect(0, 0, 100, 200);
  const subject = new OffscreenCanvas(80, 40);
  const subjectCtx = subject.getContext('2d');
  subjectCtx.fillStyle = '#ff0000';
  subjectCtx.fillRect(0, 0, 80, 40);
  paintSubject(solidCtx, subject, { x: 10, y: 80, dw: 80, dh: 40 }, true);
  const subjectPixel = solidCtx.getImageData(50, 100, 1, 1).data;
  const gapPixel = solidCtx.getImageData(50, 10, 1, 1).data;
  assert(subjectPixel[0] > 200 && subjectPixel[2] < 30, 'topgai keeps the original subject pixels');
  assert(gapPixel[2] > 200 && gapPixel[0] < 30, 'topgai leaves the gap outside the subject');
}

const onnx = readFileSync(new URL('../public/models/outpaint_prior.onnx', import.meta.url));
assert(onnx.byteLength > 200, 'onnx prior model is present');

console.log('selfcheck ok');

function buildOrientationJpeg(orientation, width, height) {
  const tiff = [
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00,
    0x01, (orientation >> 8) & 255, orientation & 255, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ];
  const exifHeader = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
  const app1Length = exifHeader.length + 2;
  const sof = [0x00, 0x11, 0x08, (height >> 8) & 255, height & 255, (width >> 8) & 255, width & 255, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00];
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xe1, (app1Length >> 8) & 255, app1Length & 255, ...exifHeader, 0xff, 0xc0, ...sof, 0xff,
    0xda, 0x00, 0x02,
  ]);
}
