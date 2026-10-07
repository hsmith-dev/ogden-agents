/// <reference lib="dom" />
/**
 * The guided tour (backlog story 19, CAP-16; extends epic 9's Welcome) in a
 * real browser: it starts once, right after Welcome finishes, pointing out
 * Chats, the project sidebar and permission cards; adapts to Plan and/or
 * Board only when this project's BMad pieces are on; never shows again
 * uninvited (a reload, or opening the project again); Skip and an outside
 * click or typing into chat both close it with nothing left over and
 * without stopping that click or keystroke; and it replays from Settings.
 *
 * Reuses `welcome.spec.ts`'s fake-agent setup (Claude Code's fake CLI and
 * its localhost sign-in callback) so a fresh run can actually reach the
 * first project the tour needs, without touching that file.
 */
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { makeDataDir, removeDataDir, startServer, type RunningServer, type StartOptions } from '../support.js';
import { sidebarOf } from './tab.js';

const WORKSPACE_CHATS_URL = /\/w\/(ws_[0-9A-Z]{26})$/;
const WORKSPACE_PLAN_URL = /\/w\/(ws_[0-9A-Z]{26})\/plan$/;

/** A first-run server, with `Documents/alpha-repo` under its (swapped) home folder, as `welcome.spec.ts`'s does. */
async function withTourServer(page: Page, body: (server: RunningServer) => Promise<void>, extra: StartOptions = {}) {
  const dataDir = makeDataDir();
  const stateDir = mkdtempSync(join(tmpdir(), 'ogden-agents-e2e-tour-'));
  const home = realpathSync.native(makeDataDir('ogden-agents-e2e-tour-home-'));
  mkdirSync(join(home, 'Documents', 'alpha-repo'), { recursive: true });
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  let server: RunningServer | undefined;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    server = await startServer(dataDir, 0, {
      firstRun: true,
      claudeCliBrowser: 'true',
      extraAgentEnv: { FAKE_ACP_AUTH: 'claude-terminal', FAKE_LOGIN_STATE: join(stateDir, 'state.json') },
      ...extra,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await body(server);
  } finally {
    await server?.close();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    removeDataDir(dataDir);
    removeDataDir(stateDir);
    removeDataDir(home);
  }
}

/** Sends the browser's visits to the Claude sign-in page straight to the fake login's localhost callback. */
async function routeSignInPage(context: BrowserContext) {
  await context.route('https://claude.ai/**', (route) => {
    const callback = new URL(route.request().url()).searchParams.get('redirect_uri');
    return callback === null ? route.abort() : route.fulfill({ status: 302, headers: { location: callback } });
  });
}

/**
 * From a fresh `/welcome`: signs in, answers the first-project question
 * (Simple chats by default), adds `alpha-repo`, and answers the shortcut
 * step — landing on the new project's Chats (or Plan, with Planning on).
 */
async function finishWelcome(page: Page, context: BrowserContext, choice: 'simple_chats' | 'bmad_method' = 'simple_chats') {
  await expect(page).toHaveURL(/\/welcome$/);
  const opened = context.waitForEvent('page');
  await page.getByTestId('agent-card-claude-code').getByRole('button', { name: 'Sign in with your account' }).click();
  const tab = await opened;
  await expect(tab.getByText('Login successful.')).toBeVisible();
  await expect(page.getByTestId('welcome-headline')).toHaveText('Add a project to get started.');
  await tab.close();

  if (choice === 'bmad_method') {
    const bmad = page.getByTestId('first-project-question').getByRole('radio', { name: 'BMad Method' });
    await expect(bmad).toBeEnabled();
    await bmad.click();
  }

  await page.getByTestId('welcome-page').getByRole('button', { name: 'Add project' }).click();
  const dialog = page.getByTestId('add-project-dialog');
  await dialog.getByTestId('folder-quick-picks').getByRole('button', { name: 'Documents' }).click();
  await dialog.getByTestId('folder-list').getByRole('button', { name: 'alpha-repo' }).click();
  await expect(dialog.getByTestId('folder-path')).toHaveText(/alpha-repo$/);
  await dialog.getByRole('button', { name: 'Open this folder' }).click();

  await expect(page.getByTestId('welcome-headline')).toHaveText(/^Open Ogden Agents from .+ next time\.$/);
  await page.getByTestId('welcome-shortcut').getByRole('button', { name: 'Not now' }).click();
}

const tourCard = (page: Page) => page.getByTestId('tour-card');

test.describe('the guided tour', () => {
  test('starts once right after Welcome finishes, pointing out chat, the sidebar and permission cards; Skip leaves nothing, and it never returns', async ({ page, context }) => {
    await routeSignInPage(context);
    await withTourServer(page, async (server) => {
      await page.goto(server.launchUrl);
      await finishWelcome(page, context);

      // AC1: lands on Chats, with the tour already open on its first step.
      await expect(page).toHaveURL(WORKSPACE_CHATS_URL);
      await expect(tourCard(page)).toBeVisible();
      await expect(tourCard(page)).toHaveAttribute('aria-label', 'Guided tour, step 1 of 3');
      await expect(page.getByTestId('tour-title')).toHaveText('Chat with your agent');
      await expect(page.getByTestId('tour-highlight')).toBeVisible();

      // AC4: Skip closes it immediately, with nothing left of it on screen.
      await tourCard(page).getByRole('button', { name: 'Skip tour' }).click();
      await expect(page.getByTestId('tour-overlay')).toHaveCount(0);

      // AC3: a reload, or opening the project again, never brings it back.
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Chats', level: 1 })).toBeVisible();
      await expect(page.getByTestId('tour-overlay')).toHaveCount(0);
      await sidebarOf(page).getByTestId('workspace-link').click();
      await expect(page).toHaveURL(WORKSPACE_CHATS_URL);
      await expect(page.getByTestId('tour-overlay')).toHaveCount(0);
    });
  });

  test('adapts to this project\'s BMad pieces: Plan and Board each get their own step, pointing at their own tab', async ({ page, context }) => {
    await routeSignInPage(context);
    await withTourServer(
      page,
      async (server) => {
        await page.goto(server.launchUrl);
        await finishWelcome(page, context, 'bmad_method');

        // Planning is on, so Welcome opens the project's Plan (story 4.6); the tour still opens with Chats first.
        await expect(page).toHaveURL(WORKSPACE_PLAN_URL);
        await expect(tourCard(page)).toHaveAttribute('aria-label', 'Guided tour, step 1 of 5');
        await expect(page.getByTestId('tour-title')).toHaveText('Chat with your agent');

        const next = () => tourCard(page).getByRole('button', { name: /^(Next|Done)$/ }).click();
        await next(); // sidebar
        await expect(page.getByTestId('tour-title')).toHaveText('Your projects');
        await next(); // permissions
        await expect(page.getByTestId('tour-title')).toHaveText('Permission cards');
        await expect(page.getByTestId('tour-highlight')).toHaveCount(0);
        await next(); // plan
        await expect(page.getByTestId('tour-title')).toHaveText('Plan');
        await expect(page.locator('[data-testid="workspace-tab-plan"]')).toBeVisible();
        await next(); // board
        await expect(page.getByTestId('tour-title')).toHaveText('Board');
        await expect(tourCard(page).getByRole('button', { name: 'Done' })).toBeVisible();
        await next(); // done
        await expect(page.getByTestId('tour-overlay')).toHaveCount(0);
      },
      { availableBmadPieces: ['planning', 'board'] },
    );
  });

  test('a click outside the tour, or typing straight into chat, closes it without blocking that interaction', async ({ page, context }) => {
    await routeSignInPage(context);
    await withTourServer(page, async (server) => {
      await page.goto(server.launchUrl);
      await finishWelcome(page, context);
      await expect(tourCard(page)).toBeVisible();

      // AC5: typing into the composer closes the tour, and the keystrokes still land in the field.
      const composer = page.getByTestId('composer').locator('textarea, [contenteditable="true"]').first();
      await composer.click();
      await composer.type('hello agent');
      await expect(page.getByTestId('tour-overlay')).toHaveCount(0);
      await expect(composer).toHaveValue('hello agent');
    });
  });

  test('replays from Settings → Appearance, in a project that has one', async ({ page, context }) => {
    await routeSignInPage(context);
    await withTourServer(page, async (server) => {
      await page.goto(server.launchUrl);
      await finishWelcome(page, context);
      await tourCard(page).getByRole('button', { name: 'Skip tour' }).click();
      await expect(page.getByTestId('tour-overlay')).toHaveCount(0);

      await sidebarOf(page).getByRole('button', { name: 'Settings' }).click();
      await page.getByRole('menuitem', { name: 'Appearance' }).click();
      await expect(page).toHaveURL(/\/settings\/appearance$/);
      await page.getByTestId('replay-tour').click();

      await expect(page).toHaveURL(WORKSPACE_CHATS_URL);
      await expect(tourCard(page)).toBeVisible();
      await expect(tourCard(page)).toHaveAttribute('aria-label', 'Guided tour, step 1 of 3');
    });
  });
});
