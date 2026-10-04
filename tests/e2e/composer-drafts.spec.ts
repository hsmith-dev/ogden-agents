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

    await composer(page).press('Enter');
    await expect(page.getByTestId('message-user')).toHaveText('Say hello in five words');
    await expect(composer(page)).toHaveValue('');
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
    await page.reload();
    await expect(page.getByTestId('message-user')).toHaveText('Say hello in five words');
    await expect(composer(page)).toHaveValue('');
  });
});
