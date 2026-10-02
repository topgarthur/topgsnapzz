import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
mkdirSync(path.join(root, 'public', 'models'), { recursive: true });
mkdirSync(path.join(root, 'public', 'ort'), { recursive: true });
mkdirSync(path.join(root, 'public', 'mediapipe', 'wasm'), { recursive: true });

const ortDir = path.join(root, 'node_modules', 'onnxruntime-web', 'dist');
if (existsSync(ortDir)) {
  for (const name of ['ort-wasm.wasm', 'ort-wasm-simd.wasm']) {
    const source = path.join(ortDir, name);
    if (existsSync(source)) cpSync(source, path.join(root, 'public', 'ort', name));
  }
}

const mediapipeWasm = path.join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
if (existsSync(mediapipeWasm)) {
  cpSync(mediapipeWasm, path.join(root, 'public', 'mediapipe', 'wasm'), { recursive: true });
}

const models = [
  [
    'blaze_face_short_range.tflite',
    'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
  ],
  [
    'efficientdet_lite0.tflite',
    'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite',
  ],
];

for (const [name, url] of models) {
  const destination = path.join(root, 'public', 'models', name);
  if (existsSync(destination)) continue;
  const response = await fetch(url);
  if (!response.ok) {
    console.warn(`Skipped ${name}: ${response.status}`);
    continue;
  }
  writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
  console.log(`downloaded ${name}`);
}

const onnxPath = path.join(root, 'public', 'models', 'outpaint_prior.onnx');
if (!existsSync(onnxPath)) {
  const python = process.platform === 'win32' ? 'py' : 'python3';
  const result = spawnSync(python, ['scripts/build-outpaint-model.py'], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) {
    console.warn('ONNX prior was not generated. Generative fill will use patch synthesis only.');
  }
}

const lamaPath = path.join(root, 'public', 'models', 'lama_fp32.onnx');
if (!existsSync(lamaPath)) {
  try {
    const response = await fetch('https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx');
    if (!response.ok) throw new Error(String(response.status));
    writeFileSync(lamaPath, Buffer.from(await response.arrayBuffer()));
    console.log('downloaded lama_fp32.onnx');
  } catch (error) {
    console.warn(`LaMa model was not downloaded (${error.message}). topgai will use the patch fill until it is present.`);
  }
}

const tessDir = path.join(root, 'public', 'tess');
mkdirSync(tessDir, { recursive: true });
const coreDir = path.join(root, 'node_modules', 'tesseract.js-core');
const workerSrc = path.join(root, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js');
if (existsSync(workerSrc)) cpSync(workerSrc, path.join(tessDir, 'worker.min.js'));
for (const name of ['tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm']) {
  const source = path.join(coreDir, name);
  if (existsSync(source)) cpSync(source, path.join(tessDir, name));
}
const langPath = path.join(tessDir, 'eng.traineddata.gz');
if (!existsSync(langPath)) {
  try {
    const response = await fetch('https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0/eng.traineddata.gz');
    if (!response.ok) throw new Error(String(response.status));
    writeFileSync(langPath, Buffer.from(await response.arrayBuffer()));
    console.log('downloaded eng.traineddata.gz');
  } catch (error) {
    console.warn(`English OCR data was not downloaded (${error.message}). Word crop will wait until it is present.`);
  }
}
