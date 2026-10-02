import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import puppeteer from 'puppeteer-core';
import { crc32 } from '../src/utils/zipBuilder.js';

const root = process.cwd();
const tmp = new URL('../scripts/.tmp/', import.meta.url);
mkdirSync(tmp, { recursive: true });
const pngPath = fileURLToPath(new URL('./landscape.png', tmp));
const desktopShot = fileURLToPath(new URL('./desktop.png', tmp));
const mobileShot = fileURLToPath(new URL('./mobile.png', tmp));

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, body, crc]);
}

function makePng(width, height, pixel) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y, width, height);
      const offset = row + 1 + x * 3;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync(
  pngPath,
  makePng(640, 360, (x, y, width, height) => {
    const dx = x - width / 2;
    const dy = y - height * 0.78;
    if (dx * dx + dy * dy < 58 * 58) return [220, 24, 36];
    return [186, 198, 206];
  }),
);

function findBrowser() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Preview server did not start'));
    }, 20000);
    const onData = (chunk) => {
      const text = String(chunk);
      if (!settled && text.includes('Local:')) {
        settled = true;
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Preview server exited ${code}`));
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const browserPath = findBrowser();
if (!browserPath) throw new Error('Edge or Chrome was not found');

const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const server = spawn(process.execPath, [viteBin, 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
});

try {
  await waitForServer(server);
  const browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: true,
    args: ['--disable-gpu'],
  });
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(message.text());
    });
    await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });
    await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="worker-pill"]');
    const input = await page.$('[data-testid="file-input"]');
    await input.uploadFile(pngPath);
    await page.waitForFunction(() => {
      const img = document.querySelector('[data-testid="preview-result"]');
      const pill = document.querySelector('[data-testid="worker-pill"]');
      const lock = document.querySelector('[data-testid="subject-lock"]');
      return (
        img &&
        img.complete &&
        img.naturalWidth === 1080 &&
        img.naturalHeight === 1920 &&
        pill?.dataset.state === 'idle' &&
        (img.dataset.renderKey || '').startsWith('blend|') &&
        (lock?.textContent || '').includes('Locked')
      );
    }, { timeout: 40000 });

    const sample = await page.evaluate(() => {
      const img = document.querySelector('[data-testid="preview-result"]');
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const pixel = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
      const strongRows = [];
      for (let y = 0; y < 1920; y += 4) {
        let score = 0;
        for (let x = 460; x < 620; x += 12) {
          const point = ctx.getImageData(x, y, 1, 1).data;
          if (point[0] > 200 && point[1] < 70 && point[2] < 80) score += 1;
        }
        if (score >= 6) strongRows.push(y);
      }
      const firstCluster = [];
      for (const y of strongRows) {
        if (!firstCluster.length || y - firstCluster[firstCluster.length - 1] < 40) firstCluster.push(y);
        else break;
      }
      return {
        corners: [pixel(6, 6), pixel(1072, 6), pixel(6, 1912), pixel(1072, 1912)],
        redMid: firstCluster.length ? firstCluster[Math.floor(firstCluster.length / 2)] : -1,
        redCount: firstCluster.length,
        lock: document.querySelector('[data-testid="subject-lock"]').textContent,
        key: document.querySelector('[data-testid="preview-result"]').dataset.renderKey,
        snapchat: Boolean(document.querySelector('[data-testid="phone-snapchat"]')),
        otherApps: Boolean(document.querySelector('[data-testid="phone-instagram"], [data-testid="phone-whatsapp"]')),
        safe: Boolean(document.querySelector('[data-testid="safe-overlay"]')),
      };
    });

    console.log(JSON.stringify(sample));
    const frame = await page.$('[data-testid="frame"]');
    await frame.screenshot({ path: desktopShot });
    for (const corner of sample.corners) {
      assert(corner[0] + corner[1] + corner[2] > 40, `black bar at ${corner.join(',')}`);
    }
    assert(sample.redCount > 4, `red subject missing (${sample.redCount})`);
    assert(sample.redMid > 700 && sample.redMid < 1040, `subject y ${sample.redMid} is outside the safe band`);
    assert(sample.snapchat, 'Snapchat preview is missing');
    assert(!sample.otherApps, 'A non-Snapchat preview is still on the page');
    assert(sample.safe, 'safe zone overlay missing');

    await page.click('[data-testid="theme-toggle"]');
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(255, 255, 255)');

    await page.click('[data-testid="safe-toggle"]');
    await page.waitForFunction(() => !document.querySelector('[data-testid="safe-overlay"]'));
    await page.click('[data-testid="safe-toggle"]');

    await page.$eval('[data-testid="chat-simulator"]', (node) => node.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: desktopShot });

    await page.$eval('[data-testid="mode-generate"]', (button) => button.click());
    await page.waitForFunction(
      () => document.querySelector('[data-testid="mode-generate"]')?.getAttribute('aria-pressed') === 'true',
    );
    try {
    await page.waitForFunction(() => {
      const img = document.querySelector('[data-testid="preview-result"]');
      const pill = document.querySelector('[data-testid="worker-pill"]');
      return (
        img &&
        img.complete &&
        img.naturalWidth === 1080 &&
        img.naturalHeight === 1920 &&
        pill?.dataset.state === 'idle' &&
        (img.dataset.renderKey || '').startsWith('generate|')
      );
    }, { timeout: 60000 });
    } catch (error) {
      const debug = await page.evaluate(() => ({
        pill: document.querySelector('[data-testid="worker-pill"]')?.textContent,
        state: document.querySelector('[data-testid="worker-pill"]')?.dataset.state,
        key: document.querySelector('[data-testid="preview-result"]')?.dataset.renderKey,
        frameError: document.querySelector('[data-testid="frame-error"]')?.textContent || '',
      }));
      console.log(JSON.stringify(debug));
      console.log(pageErrors.slice(0, 12).join('\n'));
      throw error;
    }
    const generated = await page.evaluate(() => {
      const img = document.querySelector('[data-testid="preview-result"]');
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const corner = [...ctx.getImageData(8, 8, 1, 1).data];
      return {
        corner,
        key: img.dataset.renderKey,
        engine: document.querySelector('[data-testid="fill-engine"]')?.textContent || '',
      };
    });
    console.log(JSON.stringify(generated));
    assert(generated.corner[0] + generated.corner[1] + generated.corner[2] > 40, 'generate mode left a black corner');
    assert(generated.engine === 'ONNX fill', `expected the ONNX prior, got ${generated.engine || 'nothing'}`);

    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    );
    assert(overflow, 'mobile layout overflows horizontally');
    await page.screenshot({ path: mobileShot });

    if (pageErrors.length) {
      console.log(pageErrors.slice(0, 8).join('\n'));
    }
    console.log(`browsercheck ok lock=${sample.lock} subjectY=${sample.redMid} generate=${generated.key}`);
  } finally {
    await browser.close();
  }
} finally {
  server.kill();
}
