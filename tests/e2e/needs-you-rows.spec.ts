/// <reference lib="dom" />
/**
 * Needs you rows say what and where, and `g y` jumps to the next one (epic
 * 26, story 26.1): two chats in two projects each wait on a permission
 * request. At the sidebar's full width each row shows its whole request, then
 * "project, chat", and its accessible name reads both. From the home page
 * `g y` opens the first chat with its card focused, then the second, then
 * the first again; `]` and `[` move between the rows. Each test runs its own
 * server with the fake agent.
 */
import { basename } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { send, startChat, withChatServer } from './chat-server.js';
import { sidebarOf } from './tab.js';

const needsYouRows = (page: Page) => sidebarOf(page).getByTestId('needs-you').getByTestId('needs-you-item');

/** Whether an element's text is cut: its content is taller or wider than its box. */
const clipped = (locator: Locator) => locator.evaluate((element) => element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1);

test('two waiting chats in two projects: whole requests, where on line two, and g y jumps between their cards, wrapping', async ({ page }) => {
  await withChatServer(page, async ({ server, tempFolder }) => {
    const first = tempFolder('ogden-agents-e2e-clay-');
    const second = tempFolder('ogden-agents-e2e-press-');
    const one = await startChat(page, first);
    await send(page, 'permission npm test');
    await expect(page.getByTestId('permission-card')).toBeVisible();
    const two = await startChat(page, second);
    await send(page, 'permission npm run lint');
    await expect(page.getByTestId('permission-card')).toBeVisible();

    await page.goto(`${server.url}/`);
    await page.setViewportSize({ width: 1440, height: 900 });
    const rows = needsYouRows(page);
    await expect(rows).toHaveCount(2);

    // Oldest first: what, in full words and not clipped, then "project, chat".
    const expected = [
      { row: rows.nth(0), what: 'Claude Code wants to run npm test', where: `${basename(first)}, permission npm test` },
      { row: rows.nth(1), what: 'Claude Code wants to run npm run lint', where: `${basename(second)}, permission npm run lint` },
    ];
    for (const { row, what, where } of expected) {
      await expect(row.getByTestId('needs-you-what')).toHaveText(what);
      expect(await clipped(row.getByTestId('needs-you-what'))).toBe(false);
      await expect(row.getByTestId('needs-you-where')).toHaveText(where);
      // Line two sits under line one.
      const whatBox = (await row.getByTestId('needs-you-what').boundingBox())!;
      const whereBox = (await row.getByTestId('needs-you-where').boundingBox())!;
      expect(whereBox.y).toBeGreaterThanOrEqual(whatBox.y + whatBox.height - 1);
      await expect(row).toHaveAccessibleName(`${what}, in ${where}`);
    }
    // A permission row links to its card.
    await expect(rows.nth(0)).toHaveAttribute('href', new RegExp(`/w/${one.wsId}/s/${one.sesId}#permission-`));

    // g y from the home page: the first chat on its card, then the second, then the first again.
    const card = page.getByTestId('permission-card');
    const goY = async () => {
      await page.keyboard.press('g');
      await page.keyboard.press('y');
    };
    for (const chat of [one, two, one]) {
      await goY();
      await expect(page).toHaveURL(new RegExp(`/w/${chat.wsId}/s/${chat.sesId}#permission-`));
      await expect(card).toBeFocused();
    }
    // The row last opened keeps the signal rail.
    await expect(rows.nth(0)).toHaveAttribute('data-last-opened', 'true');
    await expect(rows.nth(1)).not.toHaveAttribute('data-last-opened');

    // ] and [ inside the group move between the rows.
    await rows.nth(0).focus();
    await page.keyboard.press(']');
    await expect(rows.nth(1)).toBeFocused();
    await page.keyboard.press(']');
    await expect(rows.nth(1)).toBeFocused();
    await page.keyboard.press('[');
    await expect(rows.nth(0)).toBeFocused();
  });
});

test('a link to a card already answered opens its chat plainly', async ({ page }) => {
  await withChatServer(page, async ({ repo }) => {
    const chat = await startChat(page, repo);
    await send(page, 'permission');
    const card = page.getByTestId('permission-card');
    const link = `${chat.url}#permission-${await card.getAttribute('data-request-id')}`;
    await card.getByRole('button', { name: 'Allow once' }).click();
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');

    await page.goto(link);
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
    await expect(page.getByTestId('permission-record')).toContainText('Allowed once: npm test');
    expect(await page.evaluate(() => document.activeElement?.closest('[data-testid="permission-card"]') ?? null)).toBeNull();
  });
});
