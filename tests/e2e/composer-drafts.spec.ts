/// <reference lib="dom" />
/**
 * The composer keeps unsent text per chat (backlog story 6), in a real
 * browser with the fake agent: leaving a chat and coming back, and a reload,
 * show the draft again; a sent message clears it for good.
 */
import { expect, test } from '@playwright/test';
import { composer, startChat, withChatServer } from './chat-server.js';

test('a chat keeps its unsent text across leaving, coming back and reloading, and forgets it once sent', async ({ page }) => {
  await withChatServer(page, async ({ repo }) => {
    const chat = await startChat(page, repo);
    await composer(page).fill('Say hello in five words');

    // Another page of the app, then back.
    await page.goto(`${new URL(chat.url).origin}/w/${chat.wsId}/settings`);
    await expect(composer(page)).toHaveCount(0);
    await page.goBack();
    await expect(composer(page)).toHaveValue('Say hello in five words');

    await page.reload();
    await expect(composer(page)).toHaveValue('Say hello in five words');
    // Opened with the kept text focused, the cursor is after it.
    await expect(composer(page)).toBeFocused();
    expect(await composer(page).evaluate((field: HTMLTextAreaElement) => field.selectionStart === field.value.length)).toBe(true);

    await composer(page).press('Enter');
    await expect(page.getByTestId('message-user')).toHaveText('Say hello in five words');
    await expect(composer(page)).toHaveValue('');
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
    await page.reload();
    await expect(page.getByTestId('message-user')).toHaveText('Say hello in five words');
    await expect(composer(page)).toHaveValue('');
  });
});

test('moving between two chats inside the app shows each its own draft, and no request or log line carries a draft', async ({ page }) => {
  await withChatServer(page, async ({ repo }) => {
    const leaks: string[] = [];
    const secret = 'sk-draft-not-for-the-server';
    page.on('request', (request) => {
      if (`${request.url()} ${request.postData() ?? ''}`.includes(secret)) leaks.push(request.url());
    });
    page.on('console', (message) => {
      if (message.text().includes(secret)) leaks.push(`console: ${message.text()}`);
    });

    const a = await startChat(page, repo);
    await composer(page).fill(`chat a ${secret}`);
    const b = await startChat(page, repo);
    await expect(composer(page)).toHaveValue('');
    await composer(page).fill('chat b');

    // The sidebar's link to chat A: a move inside the app, the page stays mounted.
    await page.locator(`a[href="/w/${a.wsId}/s/${a.sesId}"]`).first().click();
    await expect(page).toHaveURL(a.url);
    await expect(composer(page)).toHaveValue(`chat a ${secret}`);
    // The cursor is after the kept text, so typing carries on from it.
    await composer(page).focus();
    expect(await composer(page).evaluate((field: HTMLTextAreaElement) => field.selectionStart === field.value.length)).toBe(true);
    await page.locator(`a[href="/w/${b.wsId}/s/${b.sesId}"]`).first().click();
    await expect(page).toHaveURL(b.url);
    await expect(composer(page)).toHaveValue('chat b');

    expect(leaks).toEqual([]);
  });
});
