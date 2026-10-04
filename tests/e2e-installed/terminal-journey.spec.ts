/// <reference lib="dom" />
/**
 * Epic 3's journey against the installed package, in Chromium (story 3.10):
 * a background server of its own, started by the installed `ogden` launcher,
 * whose chat runs the fake ACP agent and whose terminal runs the fake
 * `claude` CLI in the server's real terminal (`terminalServer`). No real
 * `claude` runs, and nothing reads the user's own `~/.claude`.
 *
 * Turn on Developer mode, answer a chat, switch it to the terminal, where
 * the chat input is refused by the UI and by the server (the driver lock,
 * AD-6); type a message; reload the tab and reattach to the same terminal;
 * switch back and see the message "from terminal" with its reply; the next
 * message continues the same agent session. Then, on an install without
 * optional dependencies, the toggle says node-pty could not load (AD-19).
 * Each test quits or stops its server.
 */
import { existsSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
// The shared routes' own file (it has no imports), as support.ts reads it.
import { apiPath } from '../../packages/shared/src/api.ts';
import { API_ROUTES, requestQuit } from '../support.js';
import { composer, send, startChat, type StartedChat } from '../e2e/chat-server.js';
import { expectConnected, landConnected, storedToken } from '../e2e/tab.js';
import { terminalServer, waitForExit, type TerminalServer } from './installed.js';

const MARKER = 'e2e-installed-terminal-7d3a';
/** The adapter's own limit on an agent's start (`START_TIMEOUT_MS`, claude-code-agent.ts). */
const AGENT_START_MS = 60_000;
/** What the driver lock check throws when the server took a chat message while the terminal drove. */
const LOCK_GONE = 'the server took a chat message while the terminal drives: the driver lock is gone';

let server: TerminalServer | undefined;

test.afterEach(async ({}, testInfo) => {
  // A failed journey keeps the server's log (its agent starts and terminal steps, with times) in the report.
  const log = server?.serverLog();
  if (testInfo.status !== testInfo.expectedStatus && log !== undefined && existsSync(log)) {
    await testInfo.attach('server.log', { path: log, contentType: 'text/plain' }).catch(() => undefined);
  }
  await server?.remove();
  server = undefined;
});

const terminal = (page: Page) => page.getByTestId('terminal');
const replies = (page: Page) => page.getByTestId('message-agent');
const state = (page: Page) => page.getByTestId('session-state');

/** Turns on Developer mode in Settings > Appearance, as a user does (it is saved in this browser). */
async function turnOnDeveloperMode(page: Page, url: string): Promise<void> {
  await page.goto(`${url}/settings/appearance`);
  const toggle = page.getByTestId('developer-mode');
  await expect(toggle).toHaveAttribute('data-state', 'unchecked');
  await toggle.click();
  await expect(toggle).toHaveAttribute('data-state', 'checked');
}

/** POSTs a chat message to the open session with the tab's own token, as the app's REST client does; returns the status and error code. */
async function postMessage(page: Page, chat: StartedChat, text: string): Promise<{ status: number; code: string | undefined }> {
  const origin = new URL(page.url()).origin;
  const token = await storedToken(page);
  if (token === null) throw new Error('the page has no tab token');
  const response = await fetch(`${origin}${apiPath(API_ROUTES.sessionMessages, { wsId: chat.wsId, sesId: chat.sesId })}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, origin, 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const body = (await response.json().catch(() => ({}))) as { error?: { code?: string } };
  return { status: response.status, code: body.error?.code };
}

test('the epic 3 journey on the installed package: terminal, reload, back, "from terminal", the driver lock', async ({ page }) => {
  test.setTimeout(240_000);
  server = terminalServer('terminal');
  const launched = await server.launch();
  await landConnected(page, launched.launchUrl);
  await expectConnected(page);

  let chat!: StartedChat;
  await test.step('1. Developer mode on; a chat answered', async () => {
    await turnOnDeveloperMode(page, launched.url);
    chat = await startChat(page, server!.project);
    await send(page, 'first question');
    await expect(replies(page)).toContainText(['Hello from the fake agent.']);
    await expect(state(page)).toHaveAttribute('data-state', 'idle');
  });

  let agentSession = '';
  await test.step('2. switch to the terminal: Claude Code resumes the same session', async () => {
    await expect(page.getByTestId('driver-toggle')).toHaveAttribute('data-driver', 'ui');
    await page.getByTestId('switch-to-terminal').click();
    await expect(terminal(page)).toHaveAttribute('data-status', 'connected');
    await expect(page.getByTestId('driver-toggle')).toHaveAttribute('data-driver', 'terminal');
    const rows = terminal(page).locator('.xterm-rows');
    await expect(rows).toContainText(/fake-claude:--resume,[A-Za-z0-9_-]+/);
    // Row by row: the rows' text runs together (`...,<id>ready>`).
    const lines = await rows.locator(':scope > div').allTextContents();
    agentSession = lines.map((line) => /fake-claude:--resume,([A-Za-z0-9_-]+)/.exec(line.trim())?.[1]).find((id) => id !== undefined) ?? '';
    expect(agentSession).not.toBe('');
  });

  await test.step('3. while the terminal drives, the chat input is refused: by the UI, and by the server', async () => {
    await expect(page.getByTestId('read-only-banner')).toContainText('The terminal is driving this session.');
    await expect(page.getByText('The terminal is driving this session', { exact: true })).toBeVisible();
    await expect(page.getByTestId('composer-switch-to-chat')).toBeVisible();
    const refused = await postMessage(page, chat, 'sent while the terminal drives');
    if (refused.status !== 409) throw new Error(`${LOCK_GONE} (status ${refused.status})`);
    expect(refused.code).toBe('driver_is_terminal');
  });

  await test.step('4. type a message in the terminal', async () => {
    await terminal(page).click();
    await page.keyboard.type(MARKER);
    await page.keyboard.press('Enter');
    await expect(terminal(page).locator('.xterm-rows')).toContainText(`echo:${MARKER}`);
  });

  await test.step('5. reload the tab: it reattaches to the same terminal, with its recent output', async () => {
    await page.reload();
    await expect(terminal(page)).toHaveAttribute('data-status', 'connected');
    await expect(page).toHaveURL(/\?driver=terminal$/);
    await expect(terminal(page).locator('.xterm-rows')).toContainText(`echo:${MARKER}`);
    await expect(page.getByTestId('driver-toggle')).toHaveAttribute('data-driver', 'terminal');
  });

  await test.step('6. switch back: the message is in the chat "from terminal", with its reply', async () => {
    await page.getByTestId('banner-switch-to-chat').click();
    await expect(page.getByTestId('transcript')).toBeVisible();
    await expect(terminal(page)).toHaveCount(0);
    await expect(page.getByTestId('driver-toggle')).toHaveAttribute('data-driver', 'ui');
    const fromTerminal = page.getByTestId('message-from-terminal');
    await expect(fromTerminal).toHaveCount(1);
    await expect(fromTerminal.getByTestId('message-user')).toHaveText(MARKER);
    await expect(fromTerminal.getByTestId('message-origin')).toHaveText('from terminal');
    await expect(page.getByTestId('message-user')).toHaveText(['first question', MARKER]);
    await expect(replies(page)).toContainText(['Hello from the fake agent.', `echo:${MARKER}`]);
    await expect(replies(page)).toHaveCount(2);
  });

  await test.step('7. the next chat message continues the same agent session', async () => {
    await send(page, 'context');
    // The chat's agent starts again here (it was released for the terminal) and resumes its session. A
    // Windows runner has taken 40 s to do so under load (CI run 36910454951: the reply came, late); the
    // product allows an agent 60 s to start (START_TIMEOUT_MS), and so does this check.
    await expect(replies(page).last()).toHaveText(new RegExp(`session=${agentSession} via=resumed primed=0$`), { timeout: AGENT_START_MS });
    await expect(state(page)).toHaveAttribute('data-state', 'idle');
    await expect(composer(page)).toHaveValue('');
  });

  await test.step('8. a reload keeps the transcript, the terminal message still marked', async () => {
    await page.reload();
    await expect(page.getByTestId('message-from-terminal').getByTestId('message-user')).toHaveText(MARKER);
    const token = await storedToken(page);
    if (token === null) throw new Error('the page has no tab token');
    expect((await requestQuit(launched.url, token)).status).toBe(202);
    await waitForExit(launched.pid);
  });
});

test('without node-pty (an install without optional dependencies), the app runs and the toggle says why the terminal is off', async ({ page }) => {
  // npx installs the package again, without optional dependencies.
  test.setTimeout(420_000);
  server = terminalServer('terminal-nopty', { omitOptional: true });
  const launched = await server.launch();
  await landConnected(page, launched.launchUrl);
  await expectConnected(page);
  await turnOnDeveloperMode(page, launched.url);
  await startChat(page, server.project);
  await send(page, 'first question');
  await expect(replies(page)).toContainText(['Hello from the fake agent.']);
  await expect(state(page)).toHaveAttribute('data-state', 'idle');

  const segment = page.getByTestId('switch-to-terminal');
  await expect(segment).toHaveAttribute('aria-disabled', 'true');
  await segment.focus();
  await expect(page.getByRole('tooltip')).toContainText("The terminal couldn't start on this computer");
  // Playwright won't click an aria-disabled control on its own: force the click, which must do nothing.
  await segment.click({ force: true });
  await expect(terminal(page)).toHaveCount(0);
  await expect(page.getByTestId('transcript')).toBeVisible();

  const token = await storedToken(page);
  if (token === null) throw new Error('the page has no tab token');
  expect((await requestQuit(launched.url, token)).status).toBe(202);
  await waitForExit(launched.pid);
});
