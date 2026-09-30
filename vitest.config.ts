import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

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
  },
});
