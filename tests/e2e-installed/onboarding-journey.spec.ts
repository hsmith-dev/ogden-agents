/// <reference lib="dom" />
/**
 * Epic 9's first-run journey against the installed package, in Chromium
 * (story 9.7): a server of its own from the same install, started by the
 * installed `ogden` launcher in background mode, on a fresh data folder with
 * nothing written in advance, its own home folder and project folder.
 *
 * 1. The launch link lands on Welcome.
 * 2. Install on the Claude Code card puts the offline fixture adapter (packed
 *    from `tests/fixtures/fake-adapter`, pinned by integrity) in the data
 *    folder, through the installed server's test install source.
 * 3. Sign in through the fake login: the page's visit to `https://claude.ai/**`
 *    goes to the login's localhost callback. Welcome moves on by itself.
 * 4. Welcome's one question, Simple chats or BMad Method?, with Simple chats
 *    picked and BMad Method available (epic 4 ships Planning and Board; it
 *    was Coming soon before 0.4.0); add the project, say Not now to
 *    the shortcut, land in the empty Chats. Settings → Welcome → Continue
 *    doesn't ask the question again.
 * 5. The first chat: the reply streams in.
 * 6. Sign in again: the login state is removed, so the chat asks to sign in;
 *    after signing in, the chat resends by itself and the agent answers.
 * 7. On a second server: an API key instead (kept in memory, checked by the
 *    test check that accepts), then a chat. Nowhere in the data folder (the
 *    database, the event log, the server log), the home folder or the
 *    launcher's output is the key.
 *
 * No real agent, account, keychain or network: the fake agent, fake login and
 * the in-memory secret store. Each server is quit at the end of its test, and
 * its folders removed.
 */
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { FIRST_PROJECT_QUESTION } from '../../packages/shared/src/bmad.ts';
import { API_ROUTES, requestQuit } from '../support.js';
import { send } from '../e2e/chat-server.js';
import { expectConnected, sidebarOf, storedToken } from '../e2e/tab.js';
import { launch, onboardingServer, waitForExit, type Launched, type OnboardingServer } from './installed.js';

/** An offline install of the fixture: slower on Windows runners. */
const INSTALL_TIMEOUT_MS = 90_000;
/** The adapter's own limit on an agent's start (`START_TIMEOUT_MS`, claude-code-agent.ts). */
const AGENT_START_MS = 60_000;
const SESSION_URL = /\/w\/ws_[0-9A-Z]{26}\/s\/ses_[0-9A-Z]{26}$/;
const WORKSPACE_URL = /\/w\/ws_[0-9A-Z]{26}$/;

const servers: OnboardingServer[] = [];

test.afterAll(async () => {
  for (const server of servers) await server.remove();
});

/** Sends the browser's visits to the Claude sign-in page straight to the fake login's localhost callback (as the dev e2e does). */
async function routeSignInPage(context: BrowserContext) {
  await context.route('https://claude.ai/**', (route) => {
    const callback = new URL(route.request().url()).searchParams.get('redirect_uri');
    return callback === null ? route.abort() : route.fulfill({ status: 302, headers: { location: callback } });
  });
}

const headline = (page: Page) => page.getByTestId('welcome-headline');
const card = (page: Page) => page.getByTestId('agent-card-claude-code');
const state = (page: Page) => page.getByTestId('session-state');
const replies = (page: Page) => page.getByTestId('message-agent');
const userMessages = (page: Page) => page.getByTestId('message-user');
const notice = (page: Page) => page.getByTestId('sign-in-again-notice');

/** Claude Code's setup as the server reports it, read with this tab's token. */
interface ClaudeStatus {
  agentId: string;
  install: string;
  version: string | null;
  auth: string;
  method?: string;
  apiKey?: { saved: boolean; lastFour?: string; unchecked?: boolean };
}

async function claudeStatus(page: Page, url: string): Promise<ClaudeStatus> {
  const token = await storedToken(page);
  if (token === null) throw new Error('the page has no tab token');
  const response = await fetch(`${url}${API_ROUTES.agents}`, { headers: { authorization: `Bearer ${token}`, origin: url } });
  if (!response.ok) throw new Error(`GET agents returned ${response.status}`);
  const { agents } = (await response.json()) as { agents: ClaudeStatus[] };
  const claude = agents.find((agent) => agent.agentId === 'claude-code');
  if (claude === undefined) throw new Error('the server reports no Claude Code');
  return claude;
}

/** Launches the server and lands its launch link on Welcome, connected. */
async function landOnWelcome(page: Page, server: OnboardingServer): Promise<Launched> {
  const launched = await launch(server.install);
  expect(launched.output).toContain('Starting Ogden Agents in the background...');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(launched.launchUrl);
  await expect(page).toHaveURL(`${launched.url}/welcome`);
  await expect.poll(() => storedToken(page)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  await expectConnected(page);
  await expect(headline(page)).toHaveText('Pick the agent that will do the work.');
  return launched;
}

/** Install on the card: the fixture adapter goes into the data folder, and the card reaches Installed, needs sign-in. */
async function installClaudeCode(page: Page, launched: Launched, server: OnboardingServer) {
  await expect(card(page)).toHaveAttribute('data-install', 'not_installed');
  await expect(card(page).getByTestId('agent-state')).toContainText('Not installed');
  await card(page).getByRole('button', { name: 'Install' }).click();
  await expect(card(page).getByTestId('agent-state')).toContainText('Installed, needs sign-in', { timeout: INSTALL_TIMEOUT_MS });
  await expect(card(page)).toHaveAttribute('data-install', 'installed');
  expect(await claudeStatus(page, launched.url)).toMatchObject({ install: 'installed', version: server.fixtureVersion, auth: 'needs_sign_in' });
  // Into the data folder, and nowhere else.
  expect(readdirSync(join(server.install.dataDir, 'agents', 'claude-code')).some((name) => name.startsWith(`adapter-${server.fixtureVersion}`))).toBe(true);
}

/** Adds the project from Welcome through the folder browser, says Not now to the shortcut, and lands in its empty Chats. */
async function addProjectAndFinish(page: Page, server: OnboardingServer) {
  await expect(headline(page)).toHaveText('Add a project to get started.');
  // The first project's one question (10.4): Simple chats preselected; epic 4 ships Planning and Board (epic 10 retro
  // A3), so BMad Method can be picked and isn't Coming soon. The journey keeps Simple chats.
  const question = page.getByTestId('first-project-question');
  await expect(question).toContainText(FIRST_PROJECT_QUESTION);
  await expect(question.getByRole('radio', { name: 'Simple chats' })).toHaveAttribute('aria-checked', 'true');
  await expect(question.getByRole('radio', { name: 'BMad Method' })).toBeEnabled();
  await expect(page.getByTestId('first-project-bmad-coming-soon')).toHaveCount(0);
  await page.getByTestId('welcome-page').getByRole('button', { name: 'Add project' }).click();
  const dialog = page.getByTestId('add-project-dialog');
  await dialog.getByTestId('folder-quick-picks').getByRole('button', { name: 'Documents' }).click();
  await dialog.getByTestId('folder-list').getByRole('button', { name: server.projectName }).click();
  await expect(dialog.getByTestId('folder-path')).toHaveText(new RegExp(`${server.projectName}$`));
  await dialog.getByRole('button', { name: 'Open this folder' }).click();

  // The shortcut step: Not now writes nothing (the shortcut would go under the server's own home folder).
  await expect(headline(page)).toHaveText(/^Open Ogden Agents from .+ next time\.$/);
  await page.getByTestId('welcome-shortcut').getByRole('button', { name: 'Not now' }).click();

  await expect(page).toHaveURL(WORKSPACE_URL);
  await expect(page.getByRole('heading', { name: 'Chats', level: 1 })).toBeVisible();
  await expect(page.getByTestId('workspace-name')).toHaveText(server.projectName);
  await expect(page.getByTestId('chats-empty')).toContainText('No conversations yet.');
  // Welcome asked its one first-project question (10.4); Simple chats was kept.
  expect(JSON.parse(readFileSync(join(server.install.dataDir, 'onboarding.json'), 'utf8'))).toEqual({ welcomeCompleted: true, firstProjectChoice: 'simple_chats' });
}

/** Quits the server as the UI does, and waits for its process to exit. */
async function quit(page: Page, launched: Launched) {
  const token = await storedToken(page);
  if (token === null) throw new Error('the page has no tab token');
  expect((await requestQuit(launched.url, token)).status).toBe(202);
  await waitForExit(launched.pid);
}

/** Every file under `dir`, with its bytes. */
function filesUnder(dir: string): Array<{ path: string; bytes: Buffer }> {
  const out: Array<{ path: string; bytes: Buffer }> = [];
  for (const name of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
    const path = join(dir, name);
    if (statSync(path).isFile()) out.push({ path, bytes: readFileSync(path) });
  }
  return out;
}

test('a first run on the installed package: Welcome, Install, sign in, a project, the first chat, then sign in again', async ({ page, context }) => {
  // An install, two sign-ins and a chat on a server of its own.
  test.setTimeout(300_000);
  await routeSignInPage(context);
  const server = onboardingServer('onboarding', 'subscription');
  servers.push(server);

  let launched!: Launched;
  await test.step('1. the launch link lands on Welcome', async () => {
    launched = await landOnWelcome(page, server);
  });

  await test.step('2. Install on the Claude Code card', async () => {
    await installClaudeCode(page, launched, server);
  });

  await test.step('3. sign in with the account: Welcome moves on by itself', async () => {
    await card(page).getByRole('button', { name: 'Sign in with your account' }).click();
    // The agent opens its own tab for a user; here the page's link stands in for it.
    const opened = context.waitForEvent('page');
    await card(page).getByTestId('agent-sign-in-link').click();
    const tab = await opened;
    await expect(tab.getByText('Login successful.')).toBeVisible();
    await expect(headline(page)).toHaveText('Add a project to get started.');
    await tab.close();
    expect(existsSync(server.loginState)).toBe(true);
    expect(await claudeStatus(page, launched.url)).toMatchObject({ install: 'installed', auth: 'signed_in', method: 'subscription' });
  });

  await test.step('4. add the project, Not now to the shortcut, the empty Chats', async () => {
    await addProjectAndFinish(page, server);
  });

  await test.step('4b. Settings → Welcome → Continue: the question is not asked again', async () => {
    const workspace = page.url();
    await sidebarOf(page).getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('menuitem', { name: 'Welcome' }).click();
    await expect(page).toHaveURL(`${launched.url}/welcome`);
    await expect(headline(page)).toHaveText('Pick the agent that will do the work.');
    // Opened from Settings it doesn't move on by itself: Continue, once the agent shows signed in.
    await expect(card(page).getByTestId('agent-state')).toContainText('Installed, signed in');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(headline(page)).toHaveText('Add a project to get started.');
    await expect(page.getByTestId('welcome-page').getByRole('button', { name: 'Add project' })).toBeVisible();
    await expect(page.getByTestId('first-project-question')).toHaveCount(0);
    // Back to the project's empty Chats for the first chat.
    await page.goto(workspace);
    await expect(page.getByTestId('chats-empty')).toContainText('No conversations yet.');
  });

  await test.step('5. the first chat: the reply streams in', async () => {
    await send(page, 'hello');
    await expect(page).toHaveURL(SESSION_URL);
    await expect(replies(page)).toContainText(['Hello from the fake agent.']);
    await expect(state(page)).toHaveAttribute('data-state', 'idle');
  });

  await test.step('6. the sign-in expires: Sign in from the chat, and it answers again', async () => {
    rmSync(server.loginState, { force: true });
    await send(page, 'context');
    await expect(state(page)).toHaveAttribute('data-state', 'error');
    await expect(page.getByTestId('session-error')).toHaveAttribute('data-error-code', 'auth_required');
    await expect(page.getByTestId('session-error')).toContainText('Claude Code needs you to sign in again.');
    await expect(notice(page)).toHaveAttribute('data-auth', 'needs_sign_in');

    await notice(page).getByRole('button', { name: 'Sign in' }).click();
    const opened = context.waitForEvent('page');
    await notice(page).getByRole('link', { name: 'Open the sign-in page' }).click();
    const tab = await opened;
    await expect(tab.getByText('Login successful.')).toBeVisible();
    await tab.close();

    // Signed in again: the chat resends its last message by itself, once, and the agent's own session answers.
    // Noticing the sign-in, resending and starting a fresh agent takes several seconds on Windows runners, and
    // a stalled runner has taken over 30 s (run 36916617905, attempt 3): wait as long as the adapter lets an
    // agent start (START_TIMEOUT_MS, 60 s), as the terminal journey does.
    await expect(replies(page).last()).toHaveText(/via=resumed primed=0$/, { timeout: AGENT_START_MS });
    await expect(state(page)).toHaveAttribute('data-state', 'idle');
    await expect(userMessages(page)).toHaveText(['hello', 'context', 'context']);
    await expect(page.getByTestId('session-error')).toHaveCount(0);
  });

  await test.step('quit the server', async () => {
    await quit(page, launched);
  });
});

test('a first run with an API key on the installed package: the chat uses it, and it is written nowhere', async ({ page }) => {
  test.setTimeout(240_000);
  const key = 'sk-ant-api03-E2E_INSTALLED_TEST_ONLY_not_real_0123456789-abcdWXYZ';
  const server = onboardingServer('onboarding-key', 'apiKey');
  servers.push(server);

  const launched = await landOnWelcome(page, server);
  await installClaudeCode(page, launched, server);

  await test.step('7. an API key instead: Welcome moves on by itself, and a chat uses the key', async () => {
    await card(page).getByRole('button', { name: 'Use an API key instead' }).click();
    const field = card(page).getByLabel('API key');
    await field.fill(key);
    await field.press('Enter');
    // Saved (the test check accepts it, so it is not marked unchecked): ready, so Welcome moves on by itself.
    await expect(headline(page)).toHaveText('Add a project to get started.');
    const status = await claudeStatus(page, launched.url);
    expect(status).toMatchObject({ install: 'installed', auth: 'signed_in', apiKey: { saved: true, lastFour: 'WXYZ' } });
    expect(status.apiKey?.unchecked).not.toBe(true);

    await addProjectAndFinish(page, server);
    await send(page, 'hello');
    await expect(page).toHaveURL(SESSION_URL);
    // The fake agent answers only with ANTHROPIC_API_KEY set, and names its last 4: this key reached it.
    await expect(replies(page)).toHaveText([/key received …WXYZ$/]);
    await expect(state(page)).toHaveAttribute('data-state', 'idle');
  });

  await test.step('quit, then search for the key', async () => {
    await quit(page, launched);
    const files = filesUnder(server.install.dataDir);
    const paths = files.map(({ path }) => path);
    // The database (with the event log) and the server's log are there to search.
    expect(paths).toContain(join(server.install.dataDir, 'ogden-agents.db'));
    const log = join(server.install.dataDir, 'logs', 'server.log');
    expect(paths).toContain(log);
    expect(readFileSync(log, 'utf8')).toContain('agent API key saved');
    for (const { path, bytes } of [...files, ...filesUnder(server.home)]) {
      expect(bytes.includes(Buffer.from(key)), `the key is in ${path}`).toBe(false);
      expect(bytes.includes(Buffer.from('E2E_INSTALLED_TEST_ONLY_not_real')), `part of the key is in ${path}`).toBe(false);
    }
    expect(launched.output).not.toContain('E2E_INSTALLED_TEST_ONLY_not_real');
  });
});
