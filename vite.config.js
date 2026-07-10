import { defineConfig } from 'vite';
import { resolve } from 'path';

const rootDir = __dirname;

export default defineConfig({
  // web/ is the single source of truth for the app
  root: 'web',

  // Relative asset paths so the build works from any static host path
  base: './',

  build: {
    outDir: resolve(rootDir, 'dist'),
    emptyOutDir: true
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  }
});
