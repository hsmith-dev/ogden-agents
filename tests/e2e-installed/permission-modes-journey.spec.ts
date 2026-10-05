/// <reference lib="dom" />
/**
 * The per-chat permission modes against the installed package, in Chromium
 * (story 4.13, for the permission modes story merged into 0.4.0), on a server
 * of its own started by the installed `ogden` launcher, with its own data
 * folder, home folder and the fake agent:
 *
 * 1. A chat starts in Ask; the picker offers Ask and Auto, and no Skip all
 *    while Developer mode is off.
 * 2. Auto: an edit of an ordinary file runs with no card, and an edit of a
 *    protected path (`.git/config`, and since story 4.13 BMad Method's
 *    `_bmad/scripts/config_utils.py`) still asks with a card (the server
 *    starts Auto sessions with ask rules for the protected paths).
 * 3. Developer mode on in Settings (kept by the server): Skip all is offered,
 *    behind its red warning; on, the red banner shows and a command runs with
 *    no card.
 * 4. Developer mode off: the chat is back in Ask, the banner gone, and Skip
 *    all is no longer offered.
 *
 * No real agent, account, keychain or network. The server is quit at the
 * end, and its folders removed.
 */
import { expect, test, type Page } from '@playwright/test';
import { requestQuit } from '../support.js';
import { composer, send, startChat } from '../e2e/chat-server.js';
import { expectConnected, landConnected, storedToken } from '../e2e/tab.js';
import { bmadServer, waitForExit, type BmadServer, type Launched } from './installed.js';

const servers: BmadServer[] = [];

test.afterAll(async () => {
  for (const server of servers) await server.remove();
});

const picker = (page: Page) => page.getByTestId('permission-mode-picker');
const replies = (page: Page) => page.getByTestId('message-agent');
const card = (page: Page) => page.getByTestId('permission-card');

async function choose(page: Page, mode: 'ask' | 'auto' | 'skip_all') {
  await picker(page).click();
  await page.getByTestId(`permission-mode-${mode}`).click();
}

/** Sends `text` and waits for the agent's reply to it. */
async function say(page: Page, text: string) {
  const before = await replies(page).count();
  // `send`'s own wait, with room for the restart a mode change into or out of Auto makes at the next message
  // (the agent starts again; on a Windows runner that alone has taken over 15 s).
  await composer(page).fill(text);
  await composer(page).press('Enter');
  await expect(composer(page)).toHaveValue('', { timeout: 60_000 });
  await expect(replies(page)).toHaveCount(before + 1, { timeout: 60_000 });
}

/** Turns Developer mode on or off in Settings → Appearance, then returns to the chat. */
async function developerMode(page: Page, chatUrl: string, on: boolean) {
  const shown = await replies(page).count();
  await page.goto(new URL('/settings/appearance', chatUrl).toString());
  const toggle = page.getByTestId('developer-mode');
  await expect(toggle).toHaveAttribute('data-state', on ? 'unchecked' : 'checked');
  await toggle.click();
  await expect(toggle).toHaveAttribute('data-state', on ? 'checked' : 'unchecked');
  await page.goto(chatUrl);
  await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
  // The conversation is back in full before the next message counts its replies (slow runners load it late).
  await expect(replies(page)).toHaveCount(shown);
}

/** Quits the server as the UI does, and waits for its process to exit. */
async function quit(page: Page, launched: Launched) {
  const token = await storedToken(page);
  if (token === null) throw new Error('the page has no tab token');
  // The last reply can show before its turn ends; a quit while a chat is busy is refused (409 sessions_busy),
  // so wait for the chat to go idle first (seen on a Windows runner).
  await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle', { timeout: 30_000 });
  expect((await requestQuit(launched.url, token)).status).toBe(202);
  await waitForExit(launched.pid);
}

test('Ask, Auto with protected paths still asking, and Skip all only in Developer mode with its banner, on the installed package', async ({ page }) => {
  test.setTimeout(180_000);
  const server = bmadServer('journey-modes');
  servers.push(server);
  const repo = server.addRepo({ bmad: false, prefix: 'modes-repo-' });

  const launched = await server.launch();
  await page.setViewportSize({ width: 1440, height: 900 });
  await landConnected(page, launched.launchUrl);
  await expectConnected(page);
  const chat = await startChat(page, repo.path);

  await test.step('a chat starts in Ask; no Skip all without Developer mode', async () => {
    await expect(picker(page)).toHaveAttribute('data-mode', 'ask');
    await picker(page).click();
    await expect(page.getByTestId('permission-mode-ask')).toBeVisible();
    await expect(page.getByTestId('permission-mode-auto')).toBeVisible();
    await expect(page.getByTestId('permission-mode-skip_all')).toHaveCount(0);
    await page.keyboard.press('Escape');
  });

  await test.step('Auto: an ordinary edit runs with no card; a protected path still asks', async () => {
    await choose(page, 'auto');
    await expect(picker(page)).toHaveAttribute('data-mode', 'auto');
    await say(page, 'mode');
    await expect(replies(page).last()).toContainText('mode=auto');
    await say(page, 'permission-edit src/app.ts');
    await expect(replies(page).last()).toContainText('Edited src/app.ts.');
    await expect(card(page)).toHaveCount(0);

    await send(page, 'permission-edit .git/config');
    await expect(card(page)).toBeVisible();
    await card(page).getByRole('button', { name: 'Deny' }).click();
    await expect(replies(page).last()).toContainText('Denied .git/config.');
    // BMad Method's own scripts are protected too (story 4.13, user decision 2026-10-04): the Board runs them.
    await send(page, 'permission-edit _bmad/scripts/config_utils.py');
    await expect(card(page)).toBeVisible();
    await card(page).getByRole('button', { name: 'Deny' }).click();
    await expect(replies(page).last()).toContainText('Denied _bmad/scripts/config_utils.py.');
  });

  await test.step('Developer mode on: Skip all behind its warning, then the red banner, and a command runs with no card', async () => {
    await developerMode(page, chat.url, true);
    await choose(page, 'skip_all');
    const dialog = page.getByTestId('skip-all-confirm');
    await expect(dialog).toBeVisible();
    await page.getByTestId('skip-all-confirm-button').click();
    await expect(picker(page)).toHaveAttribute('data-mode', 'skip_all');
    const banner = page.getByTestId('skip-all-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Skip all is on');
    await say(page, 'permission npm test');
    await expect(replies(page).last()).toContainText('Ran npm test.');
    await expect(card(page)).toHaveCount(0);
  });

  await test.step('Developer mode off: back in Ask, no banner, and no Skip all offered', async () => {
    await developerMode(page, chat.url, false);
    await expect(picker(page)).toHaveAttribute('data-mode', 'ask');
    await expect(page.getByTestId('skip-all-banner')).toHaveCount(0);
    await picker(page).click();
    await expect(page.getByTestId('permission-mode-skip_all')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await say(page, 'mode');
    await expect(replies(page).last()).toContainText('mode=default');
  });

  await quit(page, launched);
});
