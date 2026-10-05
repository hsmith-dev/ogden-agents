import { defineConfig, devices } from '@playwright/test';

/**
 * The share-kit screenshot run (`docs/share/`): not part of `pnpm e2e` or CI.
 * `pnpm build` first, then
 *
 *   pnpm exec playwright test --config tests/share-screenshots/playwright.config.ts
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/share-screenshots.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], trace: 'off' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
