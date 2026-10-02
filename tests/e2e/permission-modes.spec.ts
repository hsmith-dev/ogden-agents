/// <reference lib="dom" />
/**
 * Permission modes in a real browser: the chat's mode picker (Ask, Auto, and
 * Skip all only in Developer mode), Skip all's red warning, the red banner
 * that stays in view while the conversation scrolls and at phone width, the
 * way back to Ask, and Developer mode turned off in Settings dropping the chat
 * back to Ask. The agent is the fake ACP agent; no test runs the real `claude`.
 */
import { expect, test, type Page } from '@playwright/test';
import { send, startChat, withChatServer } from './chat-server.js';

const picker = (page: Page) => page.getByTestId('permission-mode-picker');

async function choose(page: Page, mode: 'ask' | 'auto' | 'skip_all') {
  await picker(page).click();
  await page.getByTestId(`permission-mode-${mode}`).click();
}

async function setDeveloperModeInSettings(page: Page, chatUrl: string, on: boolean) {
  await page.goto(new URL('/settings/appearance', chatUrl).toString());
  const toggle = page.getByTestId('developer-mode');
  await expect(toggle).toHaveAttribute('data-state', on ? 'unchecked' : 'checked');
  await toggle.click();
  await expect(toggle).toHaveAttribute('data-state', on ? 'checked' : 'unchecked');
  await page.goto(chatUrl);
  await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
}

test('a chat starts in Ask, switches to Auto, and offers Skip all only in Developer mode behind a red warning; its banner stays in view; Developer mode off puts it back in Ask', async ({ page }) => {
  await withChatServer(page, async ({ repo }) => {
    const chat = await startChat(page, repo);
    await expect(picker(page)).toHaveAttribute('data-mode', 'ask');

    // Ask and Auto, each with what it does; no Skip all without Developer mode.
    await picker(page).click();
    await expect(page.getByTestId('permission-mode-ask')).toContainText('Every request shows a card');
    await expect(page.getByTestId('permission-mode-auto')).toContainText('auto mode approves');
    await expect(page.getByTestId('permission-mode-skip_all')).toHaveCount(0);
    await page.getByTestId('permission-mode-auto').click();
    await expect(picker(page)).toHaveAttribute('data-mode', 'auto');
    await send(page, 'mode');
    await expect(page.getByTestId('message-agent').last()).toContainText('mode=auto');

    // Developer mode on (kept by the server): Skip all is offered, behind its red warning.
    await setDeveloperModeInSettings(page, chat.url, true);
    await expect(picker(page)).toHaveAttribute('data-mode', 'auto');
    await choose(page, 'skip_all');
    const dialog = page.getByTestId('skip-all-confirm');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('without asking you');
    await page.getByTestId('skip-all-cancel').click();
    await expect(dialog).toBeHidden();
    await expect(picker(page)).toHaveAttribute('data-mode', 'auto');
    await expect(page.getByTestId('skip-all-banner')).toHaveCount(0);

    await choose(page, 'skip_all');
    await page.getByTestId('skip-all-confirm-button').click();
    await expect(picker(page)).toHaveAttribute('data-mode', 'skip_all');
    const banner = page.getByTestId('skip-all-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Skip all is on');
    // Claude Code skips its checks: a command runs with no card.
    await send(page, 'permission npm test');
    await expect(page.getByTestId('message-agent').last()).toContainText('Ran npm test.');
    await expect(page.getByTestId('permission-card')).toHaveCount(0);

    // The banner stays in view while the conversation scrolls, at desktop and phone width.
    for (let i = 0; i < 6; i++) {
      await send(page, `message ${i}`);
      await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
    }
    for (const size of [
      { width: 1440, height: 600 },
      { width: 390, height: 640 },
    ]) {
      await page.setViewportSize(size);
      const body = page.locator('[data-slot="page-body"]').first();
      await body.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
      await expect(banner).toBeInViewport();
      await body.evaluate((element) => element.scrollTo({ top: 0 }));
      await expect(banner).toBeInViewport();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    // The banner's way back to Ask.
    await page.getByTestId('skip-all-back-to-ask').click();
    await expect(picker(page)).toHaveAttribute('data-mode', 'ask');
    await expect(banner).toHaveCount(0);

    // Skip all again, then Developer mode off in Settings: the chat is back in Ask, and Skip all is gone from the picker.
    await choose(page, 'skip_all');
    await page.getByTestId('skip-all-confirm-button').click();
    await expect(banner).toBeVisible();
    await setDeveloperModeInSettings(page, chat.url, false);
    await expect(picker(page)).toHaveAttribute('data-mode', 'ask');
    await expect(page.getByTestId('skip-all-banner')).toHaveCount(0);
    await picker(page).click();
    await expect(page.getByTestId('permission-mode-skip_all')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await send(page, 'mode');
    await expect(page.getByTestId('message-agent').last()).toContainText('mode=default');
  });
});
