import { defineConfig, devices } from '@playwright/test';

/**
 * Layout checks in a real browser (architecture Conventions: jsdom doesn't
 * evaluate media queries). `pnpm e2e` builds first; the global setup starts
 * the built server on a temp data folder and signs in through its launch link.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // A retry still gives a real failure a second chance, but a test that only
  // passes on retry fails the run (story 2.13): flakes are fixed, not hidden.
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
