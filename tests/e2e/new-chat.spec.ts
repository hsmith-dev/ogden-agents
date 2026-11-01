/// <reference lib="dom" />
/**
 * New chat in one step (epic 26, story 26.2): from inside an existing chat,
 * `g n`, the header's New chat and the Chats list's New chat each open the
 * project's new-chat draft (`/w/:wsId/new`) with the composer focused, and
 * leaving it unsent makes no chat (its text is kept as the draft). The first
 * message makes exactly one chat, which opens and shows it; a failed first
 * send keeps that chat for the retry. The desktop app's File > New Chat
 * (Cmd/Ctrl+N) reaches the page as `NEW_CHAT_EVENT` (the desktop smoke
 * checks the shell evaluates it); here it is dispatched the same way.
 * Outside a project both open the command palette on "New chat in..." (26.3). Each
 * test runs its own server with the fake agent.
 */
import { expect, test, type Page } from '@playwright/test';
import { composer, send, startChat, withChatServer } from './chat-server.js';
import { blur } from './tab.js';

/** `NEW_CHAT_EVENT` (packages/web/src/chat/new-chat.ts; its unit test pins this value and the shell's script to it). */
const NEW_CHAT_EVENT = 'ogden-agents:new-chat';

/** `g`, then `n`. */
async function goNew(page: Page) {
  await page.keyboard.press('g');
  await page.keyboard.press('n');
}

/** Opens the project's Chats list and waits until it shows exactly `count` chats. */
async function expectChats(page: Page, wsId: string, count: number) {
  await page.goto(new URL(`/w/${wsId}`, page.url()).href);
  await expect(page.getByTestId('chat-list')).toBeVisible();
  await expect(page.getByTestId('chat-row')).toHaveCount(count);
}

test('g n, the header button and the Chats list open the draft with the composer focused; unsent, it makes no chat', async ({ page }) => {
  await withChatServer(page, async ({ repo }) => {
    const chat = await startChat(page, repo);
    const draft = new RegExp(`/w/${chat.wsId}/new$`);

    // g n in a chat.
    await blur(page);
    await goNew(page);
    await expect(page).toHaveURL(draft);
    await expect(page.getByRole('heading', { name: 'New chat', level: 1 })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Project sections' }).getByRole('link', { name: 'Chats' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('new-chat-hint')).toHaveText('Ask Claude Code about this project.');
    await expect(composer(page)).toBeFocused();

    // g n on the draft, with the cursor elsewhere: back in the composer.
    await blur(page);
    await expect(composer(page)).not.toBeFocused();
    await goNew(page);
    await expect(page).toHaveURL(draft);
    await expect(composer(page)).toBeFocused();

    // Typed, then left unsent: no chat, and the text is kept.
    await composer(page).fill('an idea for later');
    await expectChats(page, chat.wsId, 1);

    // The header's New chat in a chat.
    await page.goto(chat.url);
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
    await page.getByTestId('header-new-chat').click();
    await expect(page).toHaveURL(draft);
    await expect(composer(page)).toBeFocused();
    await expect(composer(page)).toHaveValue('an idea for later');

    // The Chats list's New chat.
    await expectChats(page, chat.wsId, 1);
    await page.getByTestId('new-chat').click();
    await expect(page).toHaveURL(draft);
    await expect(composer(page)).toBeFocused();
    await expectChats(page, chat.wsId, 1);
  });
});

test('the draft first message makes exactly one chat, which opens and shows it', async ({ page }) => {
  await withChatServer(page, async ({ repo }) => {
    const chat = await startChat(page, repo);
    await page.getByTestId('header-new-chat').click();
    await expect(page).toHaveURL(new RegExp(`/w/${chat.wsId}/new$`));
    // The URL changes before the draft's code has loaded: until it shows, the composer on screen is the old chat's.
    await expect(page.getByTestId('new-chat-page')).toBeVisible();
    await send(page, 'hello');
    await expect(page).toHaveURL(new RegExp(`/w/${chat.wsId}/s/ses_[0-9A-Z]{26}$`));
    expect(page.url()).not.toBe(chat.url);
    await expect(page.getByTestId('message-user')).toHaveText('hello');
    await expect(page.getByTestId('message-agent')).toContainText('Hello from the fake agent.');
    await expectChats(page, chat.wsId, 2);
  });
});

test('a failed first send says why, and the retry goes to the chat it made', async ({ page }) => {
  await withChatServer(page, async ({ repo }) => {
    const chat = await startChat(page, repo);
    await page.goto(new URL(`/w/${chat.wsId}/new`, chat.url).href);
    // The first message POST fails once.
    let failed = false;
    await page.route('**/api/v1/workspaces/*/sessions/*/messages', async (route) => {
      if (failed || route.request().method() !== 'POST') return route.fallback();
      failed = true;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'unavailable', message: 'Not this time.' } }) });
    });
    await composer(page).fill('hello');
    await composer(page).press('Enter');
    await expect(page.getByTestId('composer-error')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/w/${chat.wsId}/new$`));
    await composer(page).press('Enter');
    await expect(page).toHaveURL(new RegExp(`/w/${chat.wsId}/s/ses_`));
    await expect(page.getByTestId('message-user')).toHaveText('hello');
    await expectChats(page, chat.wsId, 2);
  });
});

test('the desktop New Chat event opens the draft inside a project; outside one, it and g n open the palette on "New chat in..."', async ({ page }) => {
  await withChatServer(page, async ({ repo }) => {
    const chat = await startChat(page, repo);
    // What the shell evaluates for File > New Chat (Cmd/Ctrl+N).
    await page.evaluate((name) => window.dispatchEvent(new Event(name)), NEW_CHAT_EVENT);
    await expect(page).toHaveURL(new RegExp(`/w/${chat.wsId}/new$`));
    await expect(composer(page)).toBeFocused();

    const home = new URL('/', chat.url).href;
    await page.goto(home);
    await expect(page.getByTestId('workspace-area')).toBeVisible();
    const palette = page.getByTestId('command-palette');
    // The event outside a project: the page stays, and the palette lists the projects (26.3).
    await page.evaluate((name) => window.dispatchEvent(new Event(name)), NEW_CHAT_EVENT);
    await expect(palette).toHaveAttribute('data-mode', 'new-chat-in');
    await expect(page).toHaveURL(home);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(palette).toHaveCount(0);
    // g n outside a project: the same.
    await blur(page);
    await goNew(page);
    await expect(palette).toHaveAttribute('data-mode', 'new-chat-in');
    await expect(page).toHaveURL(home);
  });
});
