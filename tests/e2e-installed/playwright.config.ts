import { defineConfig, devices } from '@playwright/test';

/**
 * The end-to-end suite against the installed package (story 1.12): the global
 * setup installs the packed tarball with npx in an empty folder and starts it
 * through the installed `ogden` launcher in background mode, on a temp data
 * folder, with the fake agent. The gate checks (and the proof that they fail
 * without the gate) run first; epic 1's journey runs last, since it ends with
 * Quit. Epic 9's first run (story 9.7) installs Claude Code from an offline
 * fixture through the installed server's test hooks. Epic 3's terminal
 * journey (story 3.10) runs the fake `claude` CLI in the server's real
 * terminal on every OS, through another test hook. Epic 10's BMad journey
 * (story 10.9) runs with no BMad hook (every piece Coming soon, as a user
 * sees it), then with test-registered pieces and the guarded probe route.
 * Epic 6's agents journey (entry 10) runs Claude Code and Antigravity (both
 * the fake) side by side, Antigravity's fixture install, and the agent trust
 * gate, through more test hooks.
 * Every server a spec starts is stopped with its whole process tree.
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
  // Windows runners are slow: starting agents, reopening sessions and redirects
  // after an install routinely take longer than the 5 s default there.
  expect: { timeout: process.platform === 'win32' ? 15_000 : 5_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: '../../playwright-report/e2e-installed' }]] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  // In order: the gate checks and their proof; the hold proof, epic 2's
  // chat journey (story 2.13), epic 9's first-run journey (story 9.7),
  // epic 3's terminal journey (story 3.10, with its install without
  // optional dependencies), epic 10's BMad journey (story 10.9), epic 4's
  // planning journey and the permission modes journey (story 4.13), and the
  // 0.2.0 upgrade (story 10.7), and epic 6's agents journey (entry 10), each
  // on a server of its own from the same install; then epic 1's journey on the first server, last since it quits it.
  projects: [
    { name: 'gate', testMatch: /(^|[\\/])(gate|bypass)\.spec\.ts$/ },
    { name: 'hold-proof', testMatch: /(^|[\\/])hold-proof\.spec\.ts$/, dependencies: ['gate'] },
    { name: 'chat', testMatch: /(^|[\\/])chat-journey\.spec\.ts$/, dependencies: ['hold-proof'] },
    { name: 'onboarding', testMatch: /(^|[\\/])onboarding-journey\.spec\.ts$/, dependencies: ['chat'] },
    { name: 'terminal', testMatch: /(^|[\\/])terminal-journey\.spec\.ts$/, dependencies: ['onboarding'] },
    { name: 'bmad', testMatch: /(^|[\\/])bmad-journey\.spec\.ts$/, dependencies: ['terminal'] },
    { name: 'planning', testMatch: /(^|[\\/])planning-journey\.spec\.ts$/, dependencies: ['bmad'] },
    { name: 'modes', testMatch: /(^|[\\/])permission-modes-journey\.spec\.ts$/, dependencies: ['planning'] },
    // Epic 7's retrospectives journey (the look-back, the lessons and Save the lessons), on a server of its own.
    { name: 'retrospectives', testMatch: /(^|[\\/])retrospectives-journey\.spec\.ts$/, dependencies: ['modes'] },
    { name: 'upgrade', testMatch: /(^|[\\/])upgrade-journey\.spec\.ts$/, dependencies: ['retrospectives'] },
    { name: 'agents', testMatch: /(^|[\\/])agents-journey\.spec\.ts$/, dependencies: ['upgrade'] },
    // Epic 12's Codex journey (Codex beside Claude Code, API key only).
    { name: 'codex', testMatch: /(^|[\\/])codex-journey\.spec\.ts$/, dependencies: ['agents'] },
    // Epic 12's Grok journey (Grok beside Claude Code, an xAI API access token only, trusted project).
    { name: 'grok', testMatch: /(^|[\\/])grok-journey\.spec\.ts$/, dependencies: ['codex'] },
    // Epic 11's builds journey (story 11.6): Build all ready, the run view, a failing re-run, Needs you and the webhook, an intent gap.
    { name: 'builds', testMatch: /(^|[\\/])builds-journey\.spec\.ts$/, dependencies: ['grok'] },
    { name: 'journey', testMatch: /(^|[\\/])journey\.spec\.ts$/, dependencies: ['builds'] },
  ],
});
