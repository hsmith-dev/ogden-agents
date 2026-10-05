/// <reference lib="dom" />
/**
 * Default permission mode in a real browser: Workspace settings' "New chats
 * start in" sets Auto, then (in Developer mode, after its red warning) Skip
 * all; a chat created then starts in it with its red banner in view at
 * desktop and phone width and the note saying why; turning Developer mode off
 * sets the default back to Ask with a notice. The agent is the fake ACP agent.
 */
import { expect, test, type Page } from '@playwright/test';
import { send, setDeveloperMode, startChat, withChatServer } from './chat-server.js';

async function openSettings(page: Page, wsId: string) {
  await page.goto(new URL(`/w/${wsId}/settings`, page.url()).toString());
  await expect(page.getByTestId('default-mode')).toBeVisible();
}

test("new chats start in the project's default; Skip all only after Developer mode and its warning, with the red banner; Developer mode off sets it back to Ask", async ({ page }) => {
  await withChatServer(page, async ({ repo }) => {
    const first = await startChat(page, repo);
    await openSettings(page, first.wsId);
    await expect(page.getByTestId('default-mode-ask')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('default-mode-skip_all')).toHaveCount(0);

    // Auto: a new chat's agent runs in Auto before its first prompt, and the chat says why.
    await page.getByTestId('default-mode-auto').click();
    await expect(page.getByTestId('default-mode-status')).toHaveText('Saved: new chats start in Auto.');
    const auto = await startChat(page, repo);
    await expect(page.getByTestId('permission-mode-picker')).toHaveAttribute('data-mode', 'auto');
    await expect(page.getByTestId('start-mode-note')).toContainText("started in Auto, this project's default");
    await send(page, 'mode');
    await expect(page.getByTestId('message-agent').last()).toContainText('mode=auto');

    // Skip all: only in Developer mode, behind its red warning.
    await setDeveloperMode(page, true);
    await openSettings(page, auto.wsId);
    await page.getByTestId('default-mode-skip_all').click();
    await expect(page.getByTestId('default-mode-skip-all-confirm')).toContainText('without asking you');
    await page.getByTestId('default-mode-skip-all-cancel').click();
    await expect(page.getByTestId('default-mode-auto')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('default-mode-skip_all').click();
    await page.getByTestId('default-mode-skip-all-confirm-button').click();
    await expect(page.getByTestId('default-mode-status')).toHaveText('Saved: new chats start in Skip all.');

    await startChat(page, repo);
    await expect(page.getByTestId('permission-mode-picker')).toHaveAttribute('data-mode', 'skip_all');
    const banner = page.getByTestId('skip-all-banner');
    await expect(banner).toBeVisible();
    for (const size of [
      { width: 1440, height: 600 },
      { width: 390, height: 640 },
    ]) {
      await page.setViewportSize(size);
      await expect(banner).toBeInViewport();
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    // Developer mode off: the default is Ask again, and the settings say why.
    await setDeveloperMode(page, false);
    await openSettings(page, auto.wsId);
    await expect(page.getByTestId('default-mode-ask')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('default-mode-notice')).toContainText('Developer mode was turned off');
    await startChat(page, repo);
    await expect(page.getByTestId('permission-mode-picker')).toHaveAttribute('data-mode', 'ask');
    await expect(page.getByTestId('skip-all-banner')).toHaveCount(0);
  });
});
