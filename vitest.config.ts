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
    // Experiment (main run 37458461174: Windows files took up to 69 s with the default 3 workers on 4 vCPUs, each file spawning git, node and PTYs): two workers on the Windows runner, so the spawns starve each other less. Locally and elsewhere Vitest's default.
    ...(process.env.CI && process.platform === 'win32' ? { maxWorkers: 2 } : {}),
  },
});
