import { defineConfig, devices } from '@playwright/test';

/**
 * The end-to-end suite against the installed package (story 1.12): the global
 * setup installs the packed tarball with npx in an empty folder and starts it
 * through the installed `ogden` launcher in background mode, on a temp data
 * folder, with the fake agent. The gate checks (and the proof that they fail
 * without the gate) run first; epic 1's journey runs last, since it ends with
 * Quit.
 *
 *   pnpm run pack && pnpm e2e:installed
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  globalSetup: './global-setup.ts',
  outputDir: '../../test-results/e2e-installed',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // One server for the whole run, and the journey quits it: a retry can't start over.
  retries: 0,
  timeout: 120_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: '../../playwright-report/e2e-installed' }]] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  // In order: the gate checks and their proof; the hold proof and epic 2's
  // chat journey (story 2.13), each on a server of its own from the same
  // install; then epic 1's journey on the first server, last since it quits it.
  projects: [
    { name: 'gate', testMatch: /(^|[\\/])(gate|bypass)\.spec\.ts$/ },
    { name: 'hold-proof', testMatch: /(^|[\\/])hold-proof\.spec\.ts$/, dependencies: ['gate'] },
    { name: 'chat', testMatch: /(^|[\\/])chat-journey\.spec\.ts$/, dependencies: ['hold-proof'] },
    { name: 'journey', testMatch: /(^|[\\/])journey\.spec\.ts$/, dependencies: ['chat'] },
  ],
});
