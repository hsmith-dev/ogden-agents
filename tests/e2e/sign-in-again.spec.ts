/// <reference lib="dom" />
/**
 * Sign in again from a session (story 9.4), in a real browser. The server's
 * Claude Code is the fake ACP agent with FAKE_ACP_REQUIRE_LOGIN: its prompts
 * are refused with ACP's auth-required error (-32000) until the fake login
 * program (`tests/fixtures/fake-claude-login.mjs`) has written its state
 * file, which stands in for Claude Code's credentials. Removing that file
 * mid-chat is the sign-in expiring. The browser's visits to
 * `https://claude.ai/**` go to the fake login's localhost callback, so no
 * real account or sign-in page is ever reached. Each test runs its own server.
 */
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { apiPath } from '../../packages/shared/src/api.ts';
import { API_ROUTES, launchLink, makeDataDir, removeDataDir, serverModule, type StartOptions } from '../support.js';
import { send, startChat, withChatServer, type ChatServer } from './chat-server.js';
import { landConnected } from './tab.js';

/** Sends the browser's visits to the Claude sign-in page straight to the fake login's localhost callback (as agents-settings.spec.ts). */
async function routeSignInPage(context: BrowserContext) {
  await context.route('https://claude.ai/**', (route) => {
    const callback = new URL(route.request().url()).searchParams.get('redirect_uri');
    return callback === null ? route.abort() : route.fulfill({ status: 302, headers: { location: callback } });
  });
}

interface Login {
  /** The fake login's state file: present means signed in. */
  state: string;
  /** The sign-in expires: Claude Code's credentials are gone. */
  expire(): void;
}

/**
 * A chat server whose fake agent needs the fake login (FAKE_ACP_REQUIRE_LOGIN
 * on the fake login's own state file), signed in to start with unless
 * `signedIn` is false. `env` adds to (or replaces) the agent's environment.
 */
async function withLoginServer(
  page: Page,
  {
    env = {},
    extra = {},
    signedIn = true,
  }: { env?: Record<string, string> | ((state: string) => Record<string, string>); extra?: StartOptions; signedIn?: boolean },
  body: (chat: ChatServer, login: Login) => Promise<void>,
) {
  const stateDir = makeDataDir('ogden-agents-e2e-login-');
  const stateFile = join(stateDir, 'state.json');
  if (signedIn) writeFileSync(stateFile, JSON.stringify({ loggedIn: true }));
  try {
    await withChatServer(page, (chat) => body(chat, { state: stateFile, expire: () => rmSync(stateFile, { force: true }) }), {
      extra: {
        ...extra,
        extraAgentEnv: {
          FAKE_ACP_AUTH: 'claude-terminal',
          // A resume keeps the agent's session id, so its reply shows the same session answered.
          FAKE_ACP_RESUME: 'resume',
          FAKE_LOGIN_STATE: stateFile,
          FAKE_ACP_REQUIRE_LOGIN: stateFile,
          ...(typeof env === 'function' ? env(stateFile) : env),
        },
      },
    });
  } finally {
    removeDataDir(stateDir);
  }
}

const state = (page: Page) => page.getByTestId('session-state');
const notice = (page: Page) => page.getByTestId('sign-in-again-notice');
const userMessages = (page: Page) => page.getByTestId('message-user');
const agentMessages = (page: Page) => page.getByTestId('message-agent');

/** Starts a chat in `page`, says hello while signed in, then lets the sign-in expire and sends `context`, which is refused. */
async function chatThatExpired(page: Page, chat: ChatServer, login: Login) {
  const started = await startChat(page, chat.repo);
  await send(page, 'hello');
  await expect(agentMessages(page)).toContainText(['Hello from the fake agent.']);
  login.expire();
  await send(page, 'context');
  await expect(state(page)).toHaveAttribute('data-state', 'error');
  return started;
}

/** How long a "nothing more is sent" check watches (review F3). */
const SETTLE_MS = 1_000;

/**
 * Checks that `page` still shows exactly `texts` as the user's messages, and
 * the session is still `sessionState`, all through a settle window: a resend
 * that came late (or looped) would add a message within it (review F3).
 */
async function staysSent(page: Page, texts: string[], sessionState: string) {
  await expect(userMessages(page)).toHaveText(texts);
  const until = Date.now() + SETTLE_MS;
  while (Date.now() < until) {
    expect(await userMessages(page).allTextContents()).toEqual(texts);
    expect(await state(page).getAttribute('data-state')).toBe(sessionState);
    await page.waitForTimeout(100);
  }
}

/**
 * Starts recording the session state's values in the page (each change once,
 * in order), so a test can wait for a turn that starts after this call. The
 * resend's user message lands before its turn starts (core appends it, then
 * sets `working`), so the state alone can't tell the resend's `error` from
 * the one before it.
 */
async function recordStates(page: Page) {
  await page.evaluate(() => {
    const read = () => document.querySelector('[data-testid="session-state"]')?.getAttribute('data-state') ?? '';
    const seen = [read()];
    (window as unknown as { __sessionStates: string[] }).__sessionStates = seen;
    new MutationObserver(() => {
      const now = read();
      if (seen.at(-1) !== now) seen.push(now);
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-state'] });
  });
}

/** Waits until the states recorded since {@link recordStates} show a turn that started (`working`) and then failed (`error`). */
async function turnFailedSinceRecording(page: Page) {
  await expect
    .poll(async () => {
      const seen = await page.evaluate(() => (window as unknown as { __sessionStates: string[] }).__sessionStates);
      const working = seen.indexOf('working');
      return working !== -1 && seen.indexOf('error', working + 1) !== -1;
    })
    .toBe(true);
}

/** Clicks the notice's Sign in; the page opens the sign-in tab, routed to the fake login, which finishes it. */
async function signInThroughTab(page: Page, context: BrowserContext) {
  // The agents query has answered, so the notice knows the page opens the tab.
  await expect(notice(page)).toHaveAttribute('data-auth', 'needs_sign_in');
  const opened = context.waitForEvent('page');
  await notice(page).getByRole('button', { name: 'Sign in' }).click();
  const tab = await opened;
  await expect(tab.getByText('Login successful.')).toBeVisible();
  return tab;
}

test('an expired sign-in: Sign in from the notice, and the same chat answers from its earlier session, by itself, once', async ({ page, context }) => {
  await routeSignInPage(context);
  // The CLI's own browser opening is suppressed: the page opens the sign-in tab itself.
  await withLoginServer(page, { extra: { claudeCliBrowser: 'true' } }, async (chat, login) => {
    const started = await chatThatExpired(page, chat, login);
    await expect(notice(page)).toHaveAttribute('data-sign-in', 'needs_sign_in');
    await expect(page.getByTestId('session-error')).toHaveAttribute('data-error-code', 'auth_required');
    await expect(page.getByTestId('session-error')).toContainText('Claude Code needs you to sign in again.');
    await expect(page.getByTestId('try-again')).toBeVisible();

    const tab = await signInThroughTab(page, context);
    expect(existsSync(login.state)).toBe(true);

    // Signed in: this chat resends its last message by itself, and the agent's own session answers.
    await expect(agentMessages(page).last()).toHaveText(/session=fake-session-1 via=resumed primed=0$/);
    await expect(state(page)).toHaveAttribute('data-state', 'idle');
    await expect(userMessages(page)).toHaveText(['hello', 'context', 'context']);
    await expect(page.getByText('Resumed from history')).toBeVisible();
    // The same chat: no new one was made.
    expect(page.url()).toBe(started.url);
    await expect(page.getByTestId('session-error')).toHaveCount(0);
    // Exactly once.
    await staysSent(page, ['hello', 'context', 'context'], 'idle');
    await tab.close();
  });
});

test('signed in but still refused: the one resend fails and nothing loops', async ({ page, context }) => {
  await routeSignInPage(context);
  // The agent reads a state file the login never writes: it refuses every prompt, signed in or not.
  await withLoginServer(page, { extra: { claudeCliBrowser: 'true' }, env: (login) => ({ FAKE_ACP_REQUIRE_LOGIN: `${login}.never` }) }, async (chat, login) => {
    // The chat starts signed in (a new chat needs it, 6.3), then the sign-in expires.
    await startChat(page, chat.repo);
    login.expire();
    await send(page, 'context');
    await expect(state(page)).toHaveAttribute('data-state', 'error');
    await recordStates(page);
    const tab = await signInThroughTab(page, context);
    await expect(userMessages(page)).toHaveText(['context', 'context']);
    // The resend's own turn: it started, then failed (not the earlier error, still shown when its message lands).
    await turnFailedSinceRecording(page);
    await expect(state(page)).toHaveAttribute('data-state', 'error');
    await expect(page.getByTestId('session-error')).toHaveAttribute('data-error-code', 'auth_required');
    // A new error: its notice starts unarmed and offers Sign in and Try again again.
    await expect(notice(page)).toHaveAttribute('data-sign-in', 'needs_sign_in');
    await expect(page.getByTestId('try-again')).toBeVisible();
    // Nothing more is sent by itself, with the notice settled on the signed-in agent.
    await expect(notice(page)).toHaveAttribute('data-auth', 'signed_in');
    await staysSent(page, ['context', 'context'], 'error');
    await tab.close();
  });
});

test('with two chats in error, only the one that signed in resends; the other says Signed in and waits for Try again; a chat left mid-sign-in never resends', async ({ page, context }) => {
  // The CLI opens its own tab: the notice offers a link and takes the pasted code.
  await withLoginServer(page, { env: { FAKE_LOGIN_MODE: 'code', FAKE_LOGIN_CODE: 'e2e-code-94' } }, async (chat, login) => {
    // Chat B in a second tab, connected with its own launch link.
    const other = await context.newPage();
    await other.setViewportSize({ width: 1440, height: 900 });
    await landConnected(other, await launchLink(chat.server.url, chat.dataDir));
    const b = await startChat(other, chat.repo);
    await send(other, 'hello');
    await expect(agentMessages(other)).toContainText(['Hello from the fake agent.']);

    await chatThatExpired(page, chat, login);
    await send(other, 'context');
    await expect(state(other)).toHaveAttribute('data-state', 'error');
    await expect(notice(other)).toHaveAttribute('data-sign-in', 'needs_sign_in');

    await expect(notice(page)).toHaveAttribute('data-auth', 'needs_sign_in');
    await notice(page).getByRole('button', { name: 'Sign in' }).click();
    await expect(notice(page)).toHaveAttribute('data-sign-in', 'signing_in');
    await expect(notice(page).getByRole('link', { name: 'Open the sign-in page' })).toHaveAttribute('href', /^https:\/\/claude\.ai\/oauth\/authorize\?/);
    await expect(page.getByTestId('try-again')).toHaveAttribute('aria-disabled', 'true');
    await notice(page).getByLabel('Paste the code').fill('e2e-code-94');
    await notice(page).getByRole('button', { name: 'Send' }).click();

    await expect(agentMessages(page).last()).toHaveText(/session=fake-session-\d+ via=resumed primed=0$/);
    await expect(userMessages(page)).toHaveText(['hello', 'context', 'context']);

    // Chat B updated from the agents query and waits for the user.
    await expect(notice(other)).toHaveAttribute('data-sign-in', 'signed_in');
    await expect(other.getByTestId('session-error')).toContainText('Signed in. Try again to continue.');
    await expect(userMessages(other)).toHaveText(['hello', 'context']);
    await other.getByTestId('try-again').click();
    await expect(agentMessages(other).last()).toHaveText(/session=fake-session-\d+ via=resumed primed=0$/);
    await expect(userMessages(other)).toHaveText(['hello', 'context', 'context']);
    // Chat A resent once only.
    await staysSent(page, ['hello', 'context', 'context'], 'idle');

    // Chat B again: expired, Sign in started here, then the user leaves and finishes in Settings: Agents.
    login.expire();
    await send(other, 'context');
    await expect(state(other)).toHaveAttribute('data-state', 'error');
    await expect(notice(other)).toHaveAttribute('data-auth', 'needs_sign_in');
    await notice(other).getByRole('button', { name: 'Sign in' }).click();
    await expect(notice(other)).toHaveAttribute('data-sign-in', 'signing_in');
    await other.goto(new URL('/settings/agents', b.url).href);
    const card = other.getByTestId('agent-card-claude-code');
    await card.getByLabel('Paste the code').fill('e2e-code-94');
    await card.getByRole('button', { name: 'Send' }).click();
    await expect(card.getByTestId('agent-state')).toContainText('Installed, signed in');
    await other.goto(b.url);
    await expect(state(other)).toHaveAttribute('data-state', 'error');
    await expect(other.getByTestId('try-again')).toBeVisible();
    await expect(notice(other)).toHaveAttribute('data-auth', 'signed_in');
    await staysSent(other, ['hello', 'context', 'context', 'context'], 'error');
    // Try again still works from there.
    await other.getByTestId('try-again').click();
    await expect(userMessages(other)).toHaveText(['hello', 'context', 'context', 'context', 'context']);
    await expect(state(other)).toHaveAttribute('data-state', 'idle');
    await other.close();
  });
});

test('a Sign in whose start request failed never resends, even when a sign-in then finishes in another tab (review F1)', async ({ page, context }) => {
  await withLoginServer(page, { env: { FAKE_LOGIN_MODE: 'code', FAKE_LOGIN_CODE: 'e2e-code-94' } }, async (chat, login) => {
    const started = await chatThatExpired(page, chat, login);
    // This tab's start request never reaches the server.
    await page.route(`**${apiPath(API_ROUTES.agentSignIn, { agentId: 'claude-code' })}`, (route) => route.abort());
    await expect(notice(page)).toHaveAttribute('data-auth', 'needs_sign_in');
    await notice(page).getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByTestId('agent-request-error')).toBeVisible();

    // Signed in from Settings: Agents in another tab.
    const other = await context.newPage();
    await other.setViewportSize({ width: 1440, height: 900 });
    await landConnected(other, await launchLink(chat.server.url, chat.dataDir));
    await other.goto(new URL('/settings/agents', started.url).href);
    const card = other.getByTestId('agent-card-claude-code');
    await card.getByRole('button', { name: 'Sign in with your account' }).click();
    await card.getByLabel('Paste the code').fill('e2e-code-94');
    await card.getByRole('button', { name: 'Send' }).click();
    await expect(card.getByTestId('agent-state')).toContainText('Installed, signed in');

    // The chat says so and waits for Try again.
    await expect(notice(page)).toHaveAttribute('data-sign-in', 'signed_in');
    await staysSent(page, ['hello', 'context'], 'error');
    await other.close();
  });
});

test('a refused API key links to Settings: Agents and offers no Sign in', async ({ page }) => {
  const { createMemorySecretStore } = await serverModule();
  // Signed out of the subscription (no state file), so the saved key is in use; the agent refuses it.
  const secrets = createMemorySecretStore({ 'agent-api-key/claude-code': 'sk-ant-api03-E2E_TEST_ONLY_not_real_0123456789-abcdWXYZ' });
  await withLoginServer(page, { signedIn: false, extra: { secrets } }, async (chat) => {
    await startChat(page, chat.repo);
    await send(page, 'hello');
    await expect(state(page)).toHaveAttribute('data-state', 'error');
    await expect(notice(page)).toHaveAttribute('data-sign-in', 'api_key');
    await expect(page.getByTestId('session-error')).toContainText('Claude Code refused your API key.');
    await expect(notice(page).getByRole('button', { name: 'Sign in' })).toHaveCount(0);
    await expect(page.getByTestId('try-again')).toBeVisible();
    await page.getByTestId('agent-settings-link').click();
    await expect(page).toHaveURL(/\/settings\/agents$/);
    await expect(page.getByTestId('agent-api-key-saved')).toHaveText('API key saved …WXYZ');
  });
});
