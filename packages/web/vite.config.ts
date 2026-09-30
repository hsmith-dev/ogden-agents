import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
// The shared constant's own file: Node loads this config, and the shared
// package's index uses `.js` specifiers that only a bundler maps to `.ts`.
import { APPEARANCE_STORAGE_KEY } from '../shared/src/appearance.ts';
import { defineConfig, type Plugin } from 'vite';
import pkg from './package.json' with { type: 'json' };

/** Puts the one appearance storage key into index.html's pre-paint script. */
function appearanceKey(): Plugin {
  return {
    name: 'ogden-agents:appearance-key',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replaceAll('__APPEARANCE_STORAGE_KEY__', JSON.stringify(APPEARANCE_STORAGE_KEY)),
    },
  };
}

export default defineConfig({
  plugins: [appearanceKey(), react(), tailwindcss()],
  // The version this UI was built as, compared with the server's `server.started`
  // version for the reload banner (AD-20). tests/packaging.test.ts keeps the
  // root, server and web versions equal.
  define: { __OGDEN_AGENTS_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // One local bundle served from 127.0.0.1; there is no network cost to split for.
    chunkSizeWarningLimit: 1000,
  },
});
