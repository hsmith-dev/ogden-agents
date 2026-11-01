/// <reference lib="dom" />
/**
 * Tool rows say the call's real state, and each chat has a detail level
 * (epic 26 story 4), in a real browser with the fake agent: a call held by
 * its permission card reads "Waiting for you: npm test", then "Running npm
 * test" after Allow once; the header menu switches a chat to Verbose ("Show
 * every step"), which lists every call with the edit's hunk open, survives a
 * reload, and "Show less detail" groups again; switching keeps the message in
 * view where it was. Each test runs its own server, with one agent and
 * Developer mode off (so the default is Normal and the menu has no handoff).
 */
import { expect, test, type Page } from '@playwright/test';
import { send, startChat, withChatServer } from './chat-server.js';

const state = (page: Page) => page.getByTestId('session-state');

async function chooseDetail(page: Page, words: string) {
  await page.getByTestId('session-menu').click();
  const item = page.getByTestId('session-menu-detail');
  await expect(item).toHaveText(words);
  await item.click();
}

test('a tool row waits for the card in words, then runs once allowed', async ({ page }) => {
  await withChatServer(page, async ({ repo }) => {
    await startChat(page, repo);
    await send(page, 'permission-hold');
    await expect(page.getByTestId('permission-card')).toBeVisible();

    const row = page.getByTestId('tool-call-row').last();
    await expect(row).toHaveAttribute('data-held', 'waiting');
    await expect(row).toContainText('Waiting for you:');
    await expect(row).toContainText('npm test');
    await expect(row).not.toContainText('Running');
    await expect(row.locator('[data-slot="state-glyph"]')).toHaveAttribute('data-state', 'waiting');

    await page.getByTestId('permission-card').getByRole('button', { name: 'Allow once' }).click();
    await expect(row).toHaveAttribute('data-status', 'in_progress');
    await expect(row).not.toHaveAttribute('data-held');
    await expect(row).toContainText('Running');
    await expect(row).toContainText('npm test');
    await expect(row.locator('[data-slot="state-glyph"]')).toHaveAttribute('data-state', 'working');
  });
});

test('Show every step lists every call with the hunk open, survives a reload, and Show less detail groups again', async ({ page }) => {
  await withChatServer(page, async ({ repo }) => {
    await startChat(page, repo);
    await send(page, 'tools');
    await expect(page.getByTestId('message-agent')).toContainText('Changed src/a.ts.');
    await expect(state(page)).toHaveAttribute('data-state', 'idle');
    await expect(page.getByTestId('tool-call-group')).toHaveText('Read 3 files, edited 1');

    // One agent: the menu offers the detail item and no handoff.
    await page.getByTestId('session-menu').click();
    await expect(page.getByTestId('session-menu-detail')).toHaveText('Show every step');
    await expect(page.getByTestId('session-menu-continue')).toHaveCount(0);
    await page.getByTestId('session-menu-detail').click();

    await expect(page.getByTestId('tool-call-group')).toHaveCount(0);
    await expect(page.getByTestId('tool-call-row')).toHaveCount(4);
    const hunk = page.getByTestId('tool-call-detail');
    await expect(hunk.locator('[data-mark="removed"]')).toHaveText('- export const a = 1;');
    await expect(hunk.locator('[data-mark="added"]')).toHaveText('+ export const a = 2;');

    await page.reload();
    await expect(page.getByTestId('message-agent')).toContainText('Changed src/a.ts.');
    await expect(page.getByTestId('tool-call-row')).toHaveCount(4);
    await expect(page.getByTestId('tool-call-detail')).toBeVisible();

    await chooseDetail(page, 'Show less detail');
    await expect(page.getByTestId('tool-call-group')).toHaveText('Read 3 files, edited 1');
    await expect(page.getByTestId('tool-call-row')).toHaveCount(0);
  });
});

test('switching the detail level keeps the message in view where it was', async ({ page }) => {
  await withChatServer(page, async ({ repo }) => {
    await startChat(page, repo);
    await send(page, 'tools');
    await expect(state(page)).toHaveAttribute('data-state', 'idle');
    for (let i = 0; i < 10; i++) {
      // A second tool call (an edit, its diff opens in Verbose) just above the message, in view: it grows on the switch, the message stays.
      if (i === 6) {
        await send(page, 'tool');
        await expect(state(page)).toHaveAttribute('data-state', 'idle');
      }
      await send(page, `hello ${i}`);
      await expect(state(page)).toHaveAttribute('data-state', 'idle');
    }
    const message = page.getByTestId('message-user').filter({ hasText: 'hello 7' });
    // Put the message mid-view, with the first tool calls above the top of the view and the second in view
    // above the message. Chromium's own scroll
    // anchoring is turned off, so the page's keeping is what is proved (Safari has none).
    await message.evaluate((element) => {
      const scroller = element.closest<HTMLElement>('[data-slot="page-body"]')!;
      scroller.style.overflowAnchor = 'none';
      const box = scroller.getBoundingClientRect();
      scroller.scrollTop += element.getBoundingClientRect().top - box.top - box.height / 2;
    });
    const topOf = () => message.evaluate((element) => element.getBoundingClientRect().top);
    const before = await topOf();

    const secondRun = page.getByTestId('tool-calls').nth(1);
    const inView = await secondRun.evaluate((element) => {
      const box = element.closest<HTMLElement>('[data-slot="page-body"]')!.getBoundingClientRect();
      return element.getBoundingClientRect().top >= box.top;
    });
    expect(inView).toBe(true);

    await chooseDetail(page, 'Show every step');
    await expect(page.getByTestId('tool-call-row')).toHaveCount(5);
    await expect(secondRun.getByTestId('tool-call-detail')).toBeVisible();
    expect(Math.abs((await topOf()) - before)).toBeLessThan(4);

    await chooseDetail(page, 'Show less detail');
    await expect(page.getByTestId('tool-call-group')).toHaveCount(1);
    await expect(page.getByTestId('tool-call-detail')).toHaveCount(0);
    expect(Math.abs((await topOf()) - before)).toBeLessThan(4);
  });
});
