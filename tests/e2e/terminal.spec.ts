/// <reference lib="dom" />
/**
 * A chat switched to its agent's own terminal and back in a real browser
 * (story 3.1): the chat's agent is the fake ACP agent, and the terminal runs
 * the fake CLI (`tests/fixtures/fake-claude-cli.mjs`, as
 * `CLAUDE_CODE_EXECUTABLE`) in the server's real terminal, shown with xterm
 * under the unchanged Content-Security-Policy. No test runs the real `claude`.
 * Skipped only where node-pty can't load (never on CI).
 */
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { ROOT } from '../support.js';
import { composer, send, startChat, withChatServer } from './chat-server.js';

/** The web app's appearance key (`APPEARANCE_STORAGE_KEY` in packages/shared). */
const APPEARANCE_KEY = 'ogden-agents.appearance';
const FAKE_CLI = join(ROOT, 'tests', 'fixtures', 'fake-claude-cli.mjs');
const MARKER = 'e2e-terminal-marker-41c7';
/** What zod's check for `eval` (made on every page, and caught) reports under `script-src 'self'`. */
const ZOD_EVAL_PROBE = 'script-src eval';

/** Whether node-pty loads here (the server's terminal needs it; AD-19). */
const ptyLoads = () => import('node-pty').then(
  () => true,
  () => false,
);

/** Collects every CSP violation the page reports, from its first script on. */
async function recordViolations(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __violations: string[] }).__violations = seen;
    document.addEventListener('securitypolicyviolation', (event) => seen.push(`${event.violatedDirective} ${event.blockedURI}`));
  });
  return () => page.evaluate(() => (window as unknown as { __violations?: string[] }).__violations ?? []);
}

const withTerminalChat = (page: Page, developerMode: boolean, body: () => Promise<void>) =>
  withChatServer(
    page,
    async ({ repo }) => {
      await page.evaluate(({ key, on }) => localStorage.setItem(key, JSON.stringify({ theme: 'system', density: 'comfortable', developerMode: on })), {
        key: APPEARANCE_KEY,
        on: developerMode,
      });
      await startChat(page, repo);
      await body();
    },
    { extra: { extraAgentEnv: { CLAUDE_CODE_EXECUTABLE: FAKE_CLI, FAKE_ACP_RESUME: 'resume' } } },
  );

test('in Developer mode a chat switches to its terminal, takes typing there, and switches back; the next message gets a reply', async ({ page }) => {
  test.skip(!process.env.CI && !(await ptyLoads()), 'node-pty cannot load on this computer');
  const violations = await recordViolations(page);
  await withTerminalChat(page, true, async () => {
    await send(page, 'first question');
    await expect(page.getByTestId('message-agent')).toContainText('Hello from the fake agent.');
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');

    await page.getByTestId('switch-to-terminal').click();
    const terminal = page.getByTestId('terminal');
    await expect(terminal).toHaveAttribute('data-status', 'connected');
    await expect(page.getByTestId('transcript')).toBeHidden();
    await expect(terminal.locator('.xterm-rows')).toContainText('fake-claude:--resume,');
    // The composer says why it can't send; the server refuses too.
    await expect(page.getByText("Claude Code's terminal is driving this chat.", { exact: false })).toBeVisible();

    await page.keyboard.type(MARKER);
    await page.keyboard.press('Enter');
    await expect(terminal.locator('.xterm-rows')).toContainText(`echo:${MARKER}`);

    await page.getByTestId('switch-to-chat').click();
    await expect(page.getByTestId('transcript')).toBeVisible();
    await expect(terminal).toHaveCount(0);
    await expect(page.getByTestId('switch-to-terminal')).toBeVisible();

    await send(page, 'and now?');
    await expect(page.getByTestId('message-agent')).toHaveCount(2);
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
    await expect(composer(page)).toHaveValue('');
    // Nothing typed in the terminal reached the transcript.
    await expect(page.getByTestId('transcript')).not.toContainText(MARKER);
    // xterm's script and styles loaded under the unchanged policy. The one report every page of
    // the app makes is zod's feature probe (`Function('')`, caught), which the policy rightly blocks.
    expect((await violations()).filter((violation) => violation !== ZOD_EVAL_PROBE)).toEqual([]);
  });
});

test('without Developer mode there is no terminal switch', async ({ page }) => {
  await withTerminalChat(page, false, async () => {
    await send(page, 'first question');
    await expect(page.getByTestId('message-agent')).toContainText('Hello from the fake agent.');
    await expect(page.getByTestId('switch-to-terminal')).toHaveCount(0);
    await expect(page.getByTestId('switch-to-chat')).toHaveCount(0);
  });
});
