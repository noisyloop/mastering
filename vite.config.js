import { defineConfig } from 'vite';
import { resolve } from 'path';

const rootDir = __dirname;

// Strict CSP for the static build. Everything is same-origin; audio is decoded
// locally and handed to <audio>/fetch/workers as blob: URLs. 'unsafe-inline'
// for styles only — WaveSurfer's shadow DOM and a few style attributes need it.
// frame-ancestors can't be set via <meta>; set it as a header on your host.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self' blob:",
  "worker-src 'self' blob:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function cspPlugin() {
  return {
    name: 'inject-csp',
    apply: 'build', // dev server needs inline HMR client + websocket
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8">',
        `<meta charset="UTF-8">\n  <meta http-equiv="Content-Security-Policy" content="${CSP}">`
      );
    },
  };
}

export default defineConfig({
  // web/ is the single source of truth for the app
  root: 'web',

  // Relative asset paths so the build works from any static host path
  base: './',

  plugins: [cspPlugin()],

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
