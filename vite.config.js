import { loadEnv } from 'vite';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import topgaiHandler from './api/topgai.js';

const isolatedHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

function topgaiDevApi() {
  return {
    name: 'topgai-dev-api',
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), '');
      if (env.FAL_KEY && !process.env.FAL_KEY) process.env.FAL_KEY = env.FAL_KEY;
      server.middlewares.use('/api/topgai', (req, res) => topgaiHandler(req, res));
    },
  };
}

export default defineConfig({
  plugins: [react(), topgaiDevApi()],
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
