import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { HOOK_TIMEOUT_MS, TEST_TIMEOUT_MS } from './tests/fixtures/test-timeouts.ts';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  // The build-time version constant (packages/server/src/version.ts), as the
  // server's tsdown build and the UI's Vite build define it.
  define: { __OGDEN_AGENTS_VERSION__: JSON.stringify(version) },
  resolve: {
    // packages/web's `@/` alias, for its component tests.
    alias: { '@': fileURLToPath(new URL('./packages/web/src', import.meta.url)) },
  },
  test: {
    include: ['tests/**/*.test.ts', 'packages/*/test/**/*.test.{ts,tsx}'],
    // A server a test starts without its own secret store keeps API keys in
    // memory, and so do the processes it spawns: no test touches the real
    // OS keychain (story 9.2).
    env: { OGDEN_AGENTS_TEST_SECRET_STORE: 'memory' },
    // The time limits are in tests/fixtures/test-timeouts.ts: longer on CI and Windows, 5 s locally (story 2.13).
    testTimeout: TEST_TIMEOUT_MS,
    hookTimeout: HOOK_TIMEOUT_MS,
    // No maxWorkers override: two Windows CI workers instead of the default three measured slower (PR 222: 879 and 952 s against 735 and 677 s) with no fewer slow files.
  },
});
