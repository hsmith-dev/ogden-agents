import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
// The shared constants' own files: Node loads this config, and the shared
// package's index uses `.js` specifiers that only a bundler maps to `.ts`.
import { APPEARANCE_STORAGE_KEY } from '../shared/src/appearance.ts';
import { LAUNCH_CODE_FRAGMENT_PARAM, TAB_EXCHANGE_PATH, TAB_TOKEN_STORAGE_KEY } from '../shared/src/tab-token.ts';
import { defineConfig, type Plugin } from 'vite';
import pkg from './package.json' with { type: 'json' };

/** The published path of the boot script that index.html loads. */
const BOOT_PATH = '/boot.js';

/** `boot/boot.js` with the shared constants filled in. */
export function bootScript(): string {
  const source = readFileSync(fileURLToPath(new URL('./boot/boot.js', import.meta.url)), 'utf8');
  const values: Record<string, string> = {
    __APPEARANCE_STORAGE_KEY__: APPEARANCE_STORAGE_KEY,
    __TAB_TOKEN_STORAGE_KEY__: TAB_TOKEN_STORAGE_KEY,
    __LAUNCH_CODE_FRAGMENT_PARAM__: LAUNCH_CODE_FRAGMENT_PARAM,
    __TAB_EXCHANGE_PATH__: TAB_EXCHANGE_PATH,
  };
  let script = source;
  for (const [name, value] of Object.entries(values)) script = script.replaceAll(name, JSON.stringify(value));
  const left = /__[A-Z_]+__/.exec(script);
  if (left !== null) throw new Error(`boot/boot.js: ${left[0]} has no value`);
  return script;
}

/**
 * Publishes the boot script as a same-origin file (`/boot.js`), not an inline
 * script, so the Content-Security-Policy can forbid inline script (AD-15).
 */
function bootFile(): Plugin {
  return {
    name: 'ogden-agents:boot-script',
    configureServer(server) {
      server.middlewares.use(BOOT_PATH, (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.end(bootScript());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: BOOT_PATH.slice(1), source: bootScript() });
    },
  };
}

export default defineConfig({
  plugins: [bootFile(), react(), tailwindcss()],
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
