/// <reference lib="dom" />
/**
 * The first-run Welcome in a real browser (story 9.5; EXPERIENCE.md Key Flow
 * 1): a fresh data folder's launch link lands on Welcome; signing in moves
 * it on by itself; a first project; the app shortcut offered once; then the
 * project's empty Chats. Finishing or skipping is kept in the data folder
 * (a skip is checked across a restart), and Settings → Welcome brings it back.
 *
 * Claude Code is the fake ACP agent, whose `--cli` runs the fake login
 * program; the browser's visits to `https://claude.ai/**` go to that
 * program's localhost callback, so no real account is reached. The server
 * has no launcher entry, so the app shortcut is the in-memory stub: nothing
 * is written on this computer. The home folder is a temp folder, so the
 * folder browser starts somewhere known. Each test runs its own server.
 * Story 10.4 adds the first project's one question, Simple chats or BMad
 * Method, which sets that project's pieces only.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { API_ROUTES, launchLink, makeDataDir, removeDataDir, startServer, type RunningServer, type StartOptions } from '../support.js';
import { sidebarOf, storedToken } from './tab.js';

const WORKSPACE_URL = /\/w\/(ws_[0-9A-Z]{26})$/;

interface WelcomeServer {
  server: RunningServer;
  dataDir: string;
  /** Starts the server again on the same data folder (a restart), without marking Welcome done. */
  restart(): Promise<RunningServer>;
}

/**
 * A first-run server (nothing pre-written in its data folder) whose home
 * folder holds `Documents/alpha-repo`. HOME (USERPROFILE on Windows) is
 * swapped for the test and put back after; the server closes before any
 * folder is removed.
 */
async function withWelcomeServer(page: Page, body: (welcome: WelcomeServer & { home: string }) => Promise<void>, extra: StartOptions = {}) {
  const dataDir = makeDataDir();
  const stateDir = mkdtempSync(join(tmpdir(), 'ogden-agents-e2e-login-'));
  const home = realpathSync.native(makeDataDir('ogden-agents-e2e-home-'));
  mkdirSync(join(home, 'Documents', 'alpha-repo'), { recursive: true });
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  const options: StartOptions & { firstRun: true } = {
    firstRun: true,
    claudeCliBrowser: 'true',
    extraAgentEnv: { FAKE_ACP_AUTH: 'claude-terminal', FAKE_LOGIN_STATE: join(stateDir, 'state.json') },
    ...extra,
  };
  let server: RunningServer | undefined;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    server = await startServer(dataDir, 0, options);
    await page.setViewportSize({ width: 1440, height: 900 });
    const restart = async () => {
      await server?.close();
      server = await startServer(dataDir, 0, options);
      return server;
    };
    await body({ server, dataDir, restart, home });
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

/** Opens a launch link and expects it to land on `path` with this tab's token. */
async function land(page: Page, launch: string, path: string) {
  await page.goto(launch);
  await expect(page).toHaveURL(`${new URL(launch).origin}${path}`);
  await expect.poll(() => storedToken(page)).toMatch(/^[A-Za-z0-9_-]{43}$/);
}

const headline = (page: Page) => page.getByTestId('welcome-headline');
const card = (page: Page) => page.getByTestId('agent-card-claude-code');
const offerNotice = (page: Page) => page.getByTestId('app-shortcut-offer');

/** From the agent step: signs in (which moves the step on by itself), then adds `alpha-repo` as the first project. */
async function signInAndAddProject(page: Page, context: BrowserContext, beforeAdding?: () => Promise<void>) {
  const opened = context.waitForEvent('page');
  await card(page).getByRole('button', { name: 'Sign in with your account' }).click();
  const tab = await opened;
  await expect(tab.getByText('Login successful.')).toBeVisible();
  await expect(headline(page)).toHaveText('Add a project to get started.');
  await expect(headline(page)).toBeFocused();
  await tab.close();

  // The first project's one question (10.4): asked on a first run, Simple chats preselected.
  const question = page.getByTestId('first-project-question');
  await expect(question).toContainText('Simple chats or BMad Method?');
  await expect(question.getByRole('radio', { name: 'Simple chats' })).toHaveAttribute('aria-checked', 'true');
  await beforeAdding?.();

  await page.getByTestId('welcome-page').getByRole('button', { name: 'Add project' }).click();
  const dialog = page.getByTestId('add-project-dialog');
  await dialog.getByTestId('folder-quick-picks').getByRole('button', { name: 'Documents' }).click();
  await dialog.getByTestId('folder-list').getByRole('button', { name: 'alpha-repo' }).click();
  await expect(dialog.getByTestId('folder-path')).toHaveText(/alpha-repo$/);
  await dialog.getByRole('button', { name: 'Open this folder' }).click();
}

async function openWelcomeFromSettings(page: Page) {
  await sidebarOf(page).getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('menuitem', { name: 'Welcome' }).click();
  await expect(page).toHaveURL(/\/welcome$/);
}

test('a first run: Welcome, sign in, a project, the shortcut once, then Chats', async ({ page, context }) => {
  await routeSignInPage(context);
  await withWelcomeServer(page, async ({ server, dataDir, home }) => {
    await land(page, server.launchUrl, '/welcome');
    await expect(page.getByRole('heading', { name: 'Welcome', level: 1 })).toBeVisible();
    await expect(headline(page)).toHaveText('Pick the agent that will do the work.');
    await expect(headline(page)).toBeFocused();
    await expect(card(page)).toHaveAttribute('data-selected', '');
    await expect(card(page).getByTestId('agent-state')).toContainText('Installed, needs sign-in');
    await expect(page.getByRole('button', { name: 'Continue' })).toHaveCount(0);
    // Welcome makes the shortcut offer itself; the shell's notice stays hidden here.
    await expect(offerNotice(page)).toHaveCount(0);

    await signInAndAddProject(page, context);

    // The shortcut step, offered once (the in-memory shortcut).
    await expect(headline(page)).toHaveText(/^Open Ogden Agents from .+ next time\.$/);
    await expect(page).toHaveURL(/\/welcome$/);
    await expect(offerNotice(page)).toHaveCount(0);
    await page.getByTestId('welcome-shortcut').getByRole('button', { name: 'Add shortcut' }).click();

    await expect(page).toHaveURL(WORKSPACE_URL);
    await expect(page.getByRole('heading', { name: 'Chats', level: 1 })).toBeVisible();
    await expect(page.getByTestId('workspace-name')).toHaveText('alpha-repo');
    await expect(page.getByTestId('chats-empty')).toContainText('No conversations yet.');
    await expect(offerNotice(page)).toHaveCount(0);

    // Done: kept in the data folder, readable only by the user.
    const file = join(dataDir, 'onboarding.json');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ welcomeCompleted: true, firstProjectChoice: 'simple_chats' });
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    // Simple chats: every piece off, and nothing written in the project's folder (10.4).
    const [project] = server.core.entities.listWorkspaces();
    expect(server.core.bmad.pieces(project!.id)).toEqual([]);
    expect(readdirSync(join(home, 'Documents', 'alpha-repo'))).toEqual([]);

    await page.goto(`${server.url}/`);
    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
    await expect(page).toHaveURL(`${server.url}/`);

    // Settings → Welcome opens it again with the agent as it is now: no moving on by itself.
    await openWelcomeFromSettings(page);
    await expect(headline(page)).toHaveText('Pick the agent that will do the work.');
    await expect(card(page).getByTestId('agent-state')).toContainText('Installed, signed in');
    await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
    await expect(headline(page)).toHaveText('Pick the agent that will do the work.');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(headline(page)).toHaveText('Add a project to get started.');
    // Answered once, and a project exists: the question isn't asked again (10.4).
    await expect(page.getByTestId('welcome-page').getByRole('button', { name: 'Add project' })).toBeVisible();
    await expect(page.getByTestId('first-project-question')).toHaveCount(0);
  });
});

test('Skip for now marks Welcome done for good, across a restart; Settings → Welcome brings it back', async ({ page }) => {
  await withWelcomeServer(page, async ({ server, dataDir, restart }) => {
    await land(page, server.launchUrl, '/welcome');
    await expect(headline(page)).toHaveText('Pick the agent that will do the work.');
    await page.getByRole('button', { name: 'Skip for now' }).click();

    await expect(page).toHaveURL(`${server.url}/`);
    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
    expect(JSON.parse(readFileSync(join(dataDir, 'onboarding.json'), 'utf8'))).toEqual({ welcomeCompleted: true });
    // Welcome never showed the shortcut step, so the shell makes the offer.
    await expect(offerNotice(page)).toBeVisible();

    await page.reload();
    await expect(page.getByTestId('workspace-empty')).toBeVisible();
    await expect(page).toHaveURL(`${server.url}/`);

    // A restart on the same data folder, which has no project, lands on Projects: only the kept answer says Welcome is done.
    const again = await restart();
    await land(page, await launchLink(again.url, dataDir), '/');
    await expect(page.getByTestId('workspace-empty')).toBeVisible();
    await expect(page).toHaveURL(`${again.url}/`);

    await openWelcomeFromSettings(page);
    await expect(headline(page)).toHaveText('Pick the agent that will do the work.');
    await expect(card(page).getByTestId('agent-state')).toContainText('Installed, needs sign-in');
    await expect(offerNotice(page)).toHaveCount(0);
  });
});

test("a failed answer to the shortcut offer from Welcome is sent again, and the shell doesn't offer it meanwhile or after (9.5 F4)", async ({ page, context }) => {
  await routeSignInPage(context);
  // The first two answers fail; the second retry is held until the test lets it reach the server.
  const answers: number[] = [];
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route(`**${API_ROUTES.appShortcutOffer}`, async (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    if (answers.length >= 2) {
      answers.push(204);
      await released;
      return route.fallback();
    }
    answers.push(500);
    return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal_error', message: 'Something went wrong.' } }) });
  });
  await withWelcomeServer(page, async ({ server }) => {
    await land(page, server.launchUrl, '/welcome');
    await signInAndAddProject(page, context);
    await expect(headline(page)).toHaveText(/^Open Ogden Agents from .+ next time\.$/);
    await expect.poll(() => answers).toEqual([500]);
    // Quiet: no new words for a failed answer.
    await expect(page.getByTestId('welcome-shortcut').getByRole('alert')).toHaveCount(0);
    await page.getByTestId('welcome-shortcut').getByRole('button', { name: 'Not now' }).click();

    await expect(page).toHaveURL(WORKSPACE_URL);
    await expect(page.getByRole('heading', { name: 'Chats', level: 1 })).toBeVisible();
    // While the answer is still being sent, a status read (the server still offers it) doesn't bring the offer back.
    await expect.poll(() => answers, { timeout: 15_000 }).toEqual([500, 500, 204]);
    const read = page.waitForResponse((response) => new URL(response.url()).pathname === API_ROUTES.appShortcut && response.request().method() === 'GET');
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    expect(((await (await read).json()) as { offerPending: boolean }).offerPending).toBe(true);
    // Rendered with that answer, and still hidden.
    await expect(page.getByTestId('chats-empty')).toBeVisible();
    await expect(offerNotice(page)).toHaveCount(0);

    const answered = page.waitForResponse((response) => new URL(response.url()).pathname === API_ROUTES.appShortcut && response.request().method() === 'GET');
    release();
    expect(((await (await answered).json()) as { offerPending: boolean }).offerPending).toBe(false);
    await expect(offerNotice(page)).toHaveCount(0);
    // The server has the answer: a reload doesn't offer it either.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Chats', level: 1 })).toBeVisible();
    await expect(page.getByTestId('chats-empty')).toBeVisible();
    await expect(offerNotice(page)).toHaveCount(0);
  });
});

test("BMad Method in Welcome starts the first project with Planning and Board; the app-wide default stays Simple (10.4)", async ({ page, context }) => {
  await routeSignInPage(context);
  await withWelcomeServer(
    page,
    async ({ server, dataDir, home }) => {
      await land(page, server.launchUrl, '/welcome');
      await signInAndAddProject(page, context, async () => {
        const bmad = page.getByTestId('first-project-question').getByRole('radio', { name: 'BMad Method' });
        await expect(bmad).toBeEnabled();
        await bmad.click();
        await expect(bmad).toHaveAttribute('aria-checked', 'true');
      });
      await expect(headline(page)).toHaveText(/^Open Ogden Agents from .+ next time\.$/);
      await page.getByTestId('welcome-shortcut').getByRole('button', { name: 'Not now' }).click();
      await expect(page).toHaveURL(WORKSPACE_URL);

      const [project] = server.core.entities.listWorkspaces();
      expect(server.core.bmad.pieces(project!.id)).toEqual(['planning', 'board']);
      expect(readdirSync(join(home, 'Documents', 'alpha-repo'))).toEqual([]);
      expect(JSON.parse(readFileSync(join(dataDir, 'onboarding.json'), 'utf8'))).toEqual({ welcomeCompleted: true, firstProjectChoice: 'bmad_method' });
      // Welcome never changes the default.
      expect(existsSync(join(dataDir, 'preferences.json'))).toBe(false);
    },
    { availableBmadPieces: ['planning', 'board'] },
  );
});
