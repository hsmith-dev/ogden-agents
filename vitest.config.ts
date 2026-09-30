import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // packages/web's `@/` alias, for its component tests.
    alias: { '@': fileURLToPath(new URL('./packages/web/src', import.meta.url)) },
  },
  test: {
    include: ['tests/**/*.test.ts', 'packages/*/test/**/*.test.{ts,tsx}'],
  },
});
