import path from 'node:path';
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

const here = import.meta.dirname;
const repoRoot = path.resolve(here, '../..');

// `npm run dev` uses https with a self-signed certificate: the microphone and the Share
// button only work on https, even on local Wi-Fi. `npm run dev:http` turns it off.
const useHttps = process.env.NUKKAD_HTTP !== '1';

// Port of the Nukkad server in development (set by tools/dev.mjs).
const serverPort = Number(process.env.NUKKAD_SERVER_PORT) || 8787;

export default defineConfig({
  envDir: repoRoot,
  plugins: useHttps ? [react(), wasm(), basicSsl()] : [react(), wasm()],
  // The physics engine ships a .wasm file; pre-bundling would break its import.
  optimizeDeps: { exclude: ['@dimforge/rapier3d'] },
  server: {
    host: true, // reachable from a phone on the same Wi-Fi
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': `http://127.0.0.1:${serverPort}`,
      '/ws': { target: `ws://127.0.0.1:${serverPort}`, ws: true },
    },
  },
  build: {
    target: 'es2022',
    rolldownOptions: {
      input: { main: path.resolve(here, 'index.html'), debug: path.resolve(here, 'debug.html') },
    },
  },
  worker: { format: 'es' },
});
