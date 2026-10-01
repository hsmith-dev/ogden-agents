/// <reference lib="dom" />
/**
 * A chat switched to its agent's own terminal and back in a real browser
 * (story 3.1): the chat's agent is the fake ACP agent, and the terminal runs
 * the fake CLI (`tests/fixtures/fake-claude-cli.mjs`, as
 * `CLAUDE_CODE_EXECUTABLE`) in the server's real terminal, shown with xterm
 * under the unchanged Content-Security-Policy. No test runs the real `claude`.
 * Skipped only where node-pty can't load (never on CI). Story 3.6: the
 * Chat | Terminal toggle, `Ctrl+.`, the read-only banner and peek, focus, the
 * URL mirroring the driver, and the toggle's disabled reasons.
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

/** The session's GET with its `terminal` replaced (story 3.7 fills it in for real). */
const stubTerminal = (page: Page, terminal: unknown) =>
  page.route('**/api/v1/workspaces/*/sessions/*', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    const json = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...json, terminal } });
  });

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

    // Opening the chat with `?driver=terminal` never switches it by itself; the URL follows the driver.
    await page.goto(`${page.url()}?driver=terminal`);
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
    await expect(page).not.toHaveURL(/driver=terminal/);
    await expect(page.getByTestId('terminal')).toHaveCount(0);

    const toggle = page.getByTestId('driver-toggle');
    await expect(toggle).toHaveAttribute('data-driver', 'ui');
    await page.getByTestId('switch-to-terminal').click();
    const terminal = page.getByTestId('terminal');
    await expect(terminal).toHaveAttribute('data-status', 'connected');
    await expect(toggle).toHaveAttribute('data-driver', 'terminal');
    await expect(page.getByTestId('switch-to-terminal')).toHaveAttribute('data-state', 'on');
    await expect(page.getByTestId('transcript')).toBeHidden();
    await expect(page).toHaveURL(/\?driver=terminal$/);
    await expect(terminal.locator('.xterm-rows')).toContainText('fake-claude:--resume,');
    // Focus went into the terminal.
    await expect(terminal.locator('textarea')).toBeFocused();
    // The read-only banner, and the composer says why it can't send (the server refuses too).
    await expect(page.getByTestId('read-only-banner')).toContainText('The terminal is driving this session.');
    await expect(page.getByText('The terminal is driving this session', { exact: true })).toBeVisible();
    await expect(page.getByTestId('composer-switch-to-chat')).toBeVisible();

    // At xl the read-only conversation opens beside the terminal, closed by default.
    const peek = page.getByTestId('peek-toggle');
    await expect(peek).toHaveAttribute('aria-expanded', 'false');
    await peek.click();
    await expect(page.getByTestId('transcript')).toBeVisible();
    await expect(terminal).toBeVisible();
    // Read-only: nothing in it takes focus or a press (review F2).
    const readOnly = page.locator('[aria-label="Conversation (read-only)"]');
    await expect(readOnly).toHaveAttribute('inert', '');
    await expect(readOnly).toHaveAttribute('role', 'region');
    await peek.click();
    await expect(page.getByTestId('transcript')).toBeHidden();

    // Below xl the same conversation opens as a sheet over the terminal (user decision 2026-10-01, review F6).
    await page.setViewportSize({ width: 900, height: 720 });
    await expect(peek).toBeVisible();
    await peek.click();
    await expect(page.getByTestId('transcript')).toBeVisible();
    await expect(readOnly).toHaveAttribute('inert', '');
    const sheet = await page.locator('[data-slot="page-body"]').boundingBox();
    const panel = await page.getByTestId('terminal-panel').boundingBox();
    expect(sheet !== null && panel !== null && sheet.x < panel.x + panel.width && sheet.x + sheet.width > panel.x).toBe(true);
    await peek.click();
    await expect(page.getByTestId('transcript')).toBeHidden();
    await page.setViewportSize({ width: 1280, height: 720 });

    await terminal.click();
    await page.keyboard.type(MARKER);
    await page.keyboard.press('Enter');
    await expect(terminal.locator('.xterm-rows')).toContainText(`echo:${MARKER}`);

    // A reload while the terminal drives reattaches to it.
    await page.reload();
    await expect(page.getByTestId('terminal')).toHaveAttribute('data-status', 'connected');
    await expect(page).toHaveURL(/\?driver=terminal$/);

    // Ctrl+. with focus inside xterm goes back to the chat; the terminal never sees it.
    await page.getByTestId('terminal').click();
    await expect(page.getByTestId('terminal').locator('textarea')).toBeFocused();
    await page.keyboard.press('Control+Period');
    await expect(page.getByTestId('transcript')).toBeVisible();
    await expect(page.getByTestId('terminal')).toHaveCount(0);
    await expect(page.getByTestId('read-only-banner')).toHaveCount(0);
    await expect(toggle).toHaveAttribute('data-driver', 'ui');
    await expect(page).not.toHaveURL(/driver=terminal/);
    await expect(composer(page)).toBeFocused();

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

test('in Developer mode the Terminal segment is disabled with the server reason when unavailable, and Ctrl+. switches from the chat', async ({ page }) => {
  test.skip(!process.env.CI && !(await ptyLoads()), 'node-pty cannot load on this computer');
  await withTerminalChat(page, true, async () => {
    await send(page, 'first question');
    await expect(page.getByTestId('message-agent')).toContainText('Hello from the fake agent.');
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');

    // Unavailable: the reason is the server's `terminal.reason`, verbatim, in a tooltip that opens on focus.
    const reason = "The terminal couldn't start on this computer: node-pty failed to load.";
    await stubTerminal(page, { available: false, code: 'pty_unavailable', reason });
    await page.reload();
    const segment = page.getByTestId('switch-to-terminal');
    await expect(segment).toHaveAttribute('aria-disabled', 'true');
    await segment.focus();
    await expect(page.getByRole('tooltip')).toContainText(reason);
    // Playwright won't click an aria-disabled control on its own: force the click, which must do nothing.
    await segment.click({ force: true });
    await page.keyboard.press('Control+Period');
    await expect(page.getByTestId('session-action-error')).toHaveText(reason);
    await expect(page.getByTestId('terminal')).toHaveCount(0);
    await expect(page).not.toHaveURL(/driver=terminal/);

    // Available again: Ctrl+. from the chat switches, and focus goes into the terminal.
    await page.unrouteAll({ behavior: 'wait' });
    await page.reload();
    await expect(segment).not.toHaveAttribute('aria-disabled');
    await composer(page).focus();
    await page.keyboard.press('Control+Period');
    await expect(page.getByTestId('terminal')).toHaveAttribute('data-status', 'connected');
    await expect(page.getByTestId('terminal').locator('textarea')).toBeFocused();
    await page.getByTestId('banner-switch-to-chat').click();
    await expect(page.getByTestId('transcript')).toBeVisible();
    await expect(composer(page)).toBeFocused();
  });
});

test('without Developer mode there is no terminal switch, and Ctrl+. does nothing', async ({ page }) => {
  await withTerminalChat(page, false, async () => {
    await send(page, 'first question');
    await expect(page.getByTestId('message-agent')).toContainText('Hello from the fake agent.');
    await expect(page.getByTestId('driver-toggle')).toHaveCount(0);
    await expect(page.getByTestId('switch-to-terminal')).toHaveCount(0);
    await expect(page.getByTestId('switch-to-chat')).toHaveCount(0);
    await composer(page).focus();
    await page.keyboard.press('Control+Period');
    await expect(page.getByTestId('driver-switching')).toHaveCount(0);
    await expect(page.getByTestId('terminal')).toHaveCount(0);
    await expect(page).not.toHaveURL(/driver=terminal/);
  });
});
