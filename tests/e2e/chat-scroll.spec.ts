/// <reference lib="dom" />
/**
 * The conversation ends at its last item (backlog 10, bug): scrolling past
 * the end of a chat never scrolls the page itself into empty space. A running
 * tool call's hidden "In progress" label is absolutely positioned; laid out
 * against the page instead of the conversation's scroll box it stretched the
 * document, and the wheel chained to it, around a permission card and after
 * it was answered. Each test runs its own server with the fake agent.
 */
import { expect, test, type Page } from '@playwright/test';
import { send, startChat, withChatServer } from './chat-server.js';
import { launchLink, openConnected } from './tab.js';

/** The page's own scroll, the document's extra height, and the conversation's blank space below its content. */
const overflow = (page: Page) =>
  page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('[data-slot="page-body"]');
    const content = scroller?.firstElementChild as HTMLElement | null | undefined;
    if (scroller === null || content === null || content === undefined) return { windowScroll: -1, documentExtra: -1, blankBelow: -1 };
    return {
      windowScroll: Math.round(window.scrollY),
      documentExtra: document.documentElement.scrollHeight - window.innerHeight,
      blankBelow: scroller.scrollHeight - Math.max(content.offsetHeight, scroller.clientHeight),
    };
  });

/** Scrolls well past the end of the conversation, as a reader would with the wheel, then checks nothing else moved. */
async function expectEndsAtLastItem(page: Page) {
  const box = await page.getByTestId('transcript').boundingBox();
  if (box === null) throw new Error('the conversation is not on the page');
  const viewport = page.viewportSize()!;
  await page.mouse.move(box.x + box.width / 2, Math.min(box.y + box.height / 2, viewport.height / 2));
  await page.mouse.wheel(0, 4000);
  await page.mouse.wheel(0, 4000);
  await expect.poll(() => overflow(page)).toEqual({ windowScroll: 0, documentExtra: 0, blankBelow: 0 });
  // The last thing in the conversation sits right above the composer, not above empty space.
  const gap = await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('[data-slot="page-body"]')!;
    // The transcript's last child is its empty end marker (stick to bottom); the item is the last one before it that
    // takes space (a screen-reader-only live region, like the waiting messages' announcement, is skipped).
    let last = document.querySelector<HTMLElement>('[data-testid="transcript"]')!.lastElementChild!.previousElementSibling as HTMLElement;
    while (last.previousElementSibling !== null && (last.classList.contains('sr-only') || last.getBoundingClientRect().height === 0)) last = last.previousElementSibling as HTMLElement;
    return Math.round(scroller.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom);
  });
  expect(gap).toBeLessThan(64);
}

/** A chat long enough to scroll. */
async function fillChat(page: Page, count: number) {
  for (let i = 0; i < count; i++) {
    await send(page, `hello ${i}`);
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
  }
}

test('around a permission card, with its tool running, scrolling past the end never scrolls the page', async ({ page }) => {
  await withChatServer(page, async ({ repo }) => {
    await startChat(page, repo);
    await page.setViewportSize({ width: 1440, height: 700 });
    await fillChat(page, 6);

    // Waiting: the tool call shows "In progress" above the card.
    await send(page, 'permission');
    await expect(page.getByTestId('permission-card')).toBeVisible();
    await expectEndsAtLastItem(page);

    // Answered: the card collapses to its record line.
    await page.getByTestId('permission-card').getByRole('button', { name: 'Allow once' }).click();
    await expect(page.getByTestId('permission-record')).toContainText('Allowed once: npm test');
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
    await expectEndsAtLastItem(page);

    // Answered, and the approved tool keeps running (as a real agent's long command does): the user's report.
    await send(page, 'permission-hold');
    await expect(page.getByTestId('permission-card')).toBeVisible();
    await page.getByTestId('permission-card').getByRole('button', { name: 'Allow once' }).click();
    await expect(page.getByTestId('permission-card')).toHaveCount(0);
    await expect(page.getByTestId('tool-call-row').last()).toHaveAttribute('data-status', 'in_progress');
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'working');
    await expectEndsAtLastItem(page);
  });
});

test('a card answered in another tab, on a phone, leaves no empty space to scroll into', async ({ page, browser }) => {
  await withChatServer(page, async ({ server, dataDir, repo }) => {
    const chat = await startChat(page, repo);
    await page.setViewportSize({ width: 390, height: 844 });
    await fillChat(page, 6);
    await send(page, 'permission-hold');
    await expect(page.getByTestId('permission-card')).toBeVisible();
    await expectEndsAtLastItem(page);

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const other = await context.newPage();
      await openConnected(other, `/w/${chat.wsId}/s/${chat.sesId}`, await launchLink(server.url, dataDir));
      await other.getByTestId('permission-card').getByRole('button', { name: 'Allow once' }).click();
      // This tab follows: the card collapses to its record while the approved tool keeps running.
      await expect(page.getByTestId('permission-record')).toContainText('Allowed once: npm test');
      await expect(page.getByTestId('tool-call-row').last()).toHaveAttribute('data-status', 'in_progress');
      await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'working');
      await expectEndsAtLastItem(page);
    } finally {
      await context.close();
    }
  });
});
