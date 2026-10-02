import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const isolatedHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [react()],
  server: { headers: isolatedHeaders },
  preview: { headers: isolatedHeaders },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    include: ['heic2any', 'tesseract.js'],
    exclude: ['onnxruntime-web', '@mediapipe/tasks-vision'],
  },
});
