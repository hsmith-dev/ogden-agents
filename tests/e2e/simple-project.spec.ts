/// <reference lib="dom" />
/**
 * A simple project stays a plain multi-chat workspace (story 10.6): with
 * every BMad piece off, the header's project tabs show Chats alone on the
 * chats page and on each chat, at desktop and phone widths; Developer mode's
 * Chat | Terminal toggle works as in epic 3; and Settings > Tools says uv is
 * only for BMad Method features. The terminal runs the fake CLI; skipped
 * only where node-pty can't load (never on CI).
 */
import { expect, test, type Page } from '@playwright/test';
import { ptyLoads, send, withTerminalChat } from './chat-server.js';

/** The header's project tabs: no BMad piece's tab, so Chats, marked as the current page, and (these tests run in Developer mode) Terminals (epic 16). */
async function expectChatsTabOnly(page: Page) {
  const nav = page.getByRole('navigation', { name: 'Project sections' });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole('link')).toHaveText(['Chats', 'Terminals']);
  const chats = nav.getByRole('link', { name: 'Chats' });
  await expect(chats).toHaveAttribute('aria-current', 'page');
}

/** Nothing scrolls sideways. */
async function expectNoSidewaysScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

test('a simple project shows only Chats in its header on both pages, two chats work, and the terminal toggle switches and back', async ({ page }) => {
  test.skip(!process.env.CI && !(await ptyLoads()), 'node-pty cannot load on this computer');
  await withTerminalChat(page, true, async ({ wsId }) => {
    // The first chat's page.
    await expectChatsTabOnly(page);
    await send(page, 'first question');
    await expect(page.getByTestId('message-agent')).toContainText('Hello from the fake agent.');
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');

    // The chats page, through its tab.
    await page.getByRole('navigation', { name: 'Project sections' }).getByRole('link', { name: 'Chats' }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${wsId}$`));
    await expect(page.getByTestId('chat-list')).toBeVisible();
    await expectChatsTabOnly(page);

    // A second chat.
    await page.getByTestId('new-chat').click();
    await expect(page).toHaveURL(new RegExp(`/w/${wsId}/s/`));
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
    await expectChatsTabOnly(page);
    await send(page, 'second question');
    await expect(page.getByTestId('message-agent')).toContainText('Hello from the fake agent.');
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');

    // Developer mode's toggle: to the terminal and back, as in epic 3.
    const toggle = page.getByTestId('driver-toggle');
    await expect(toggle).toHaveAttribute('data-driver', 'ui');
    await page.getByTestId('switch-to-terminal').click();
    await expect(page.getByTestId('terminal')).toHaveAttribute('data-status', 'connected');
    await expect(toggle).toHaveAttribute('data-driver', 'terminal');
    await expectChatsTabOnly(page);
    await page.getByTestId('switch-to-chat').click();
    await expect(toggle).toHaveAttribute('data-driver', 'ui');
    await expect(page.getByTestId('terminal')).toHaveCount(0);
    await expect(page.getByTestId('transcript')).toBeVisible();

    // At phone width the header still fits, tabs and toggle included.
    await page.setViewportSize({ width: 375, height: 740 });
    await expectChatsTabOnly(page);
    await expect(toggle).toBeVisible();
    await expectNoSidewaysScroll(page);
    await page.goto(new URL(`/w/${wsId}`, page.url()).href);
    await expect(page.getByTestId('chat-list')).toBeVisible();
    await expectChatsTabOnly(page);
    await expect(page.getByTestId('new-chat')).toBeVisible();
    await expectNoSidewaysScroll(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    // Settings > Tools: uv is only for BMad Method features, and the page has no project tabs.
    await page.goto(new URL('/settings/tools', page.url()).href);
    await expect(page.getByTestId('workspace-area')).toContainText(
      "Needed only for BMad Method features, which a project turns on in its settings; chats don't use it.",
    );
    await expect(page.getByRole('navigation', { name: 'Project sections' })).toHaveCount(0);
  });
});
