// SPIKE 16.1 (TEMPORARY): the probes' own Vitest config; the repo's test run never includes apps/.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  resolve: { alias: { '@': fileURLToPath(new URL('../../packages/web/src', import.meta.url)) } },
  test: {
    include: ['apps/terminal-spike/probes/*.probe.mjs'],
    fileParallelism: false,
    testTimeout: 240_000,
    hookTimeout: 120_000,
    env: { OGDEN_AGENTS_TEST_SECRET_STORE: 'memory' },
  },
});
