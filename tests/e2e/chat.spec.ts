/// <reference lib="dom" />
/**
 * The tracer bullet in a real browser (story 2.2): a chat started in a
 * project, a message sent from the session view at
 * `/w/:wsId/s/:sesId`, and the reply streaming in while the session goes
 * working, then idle. The server's agent is the real `acp-claude-code`
 * adapter talking ACP to the fake agent (`tests/fixtures/fake-acp-agent.mjs`),
 * so this is the same path a live Claude Code chat takes. Each test runs its
 * own server.
 */
import { expect, test, type Page } from '@playwright/test';
import { startChat, withChatServer } from './chat-server.js';

/** A server with a chat open in its project, titled Chat. Slow chunks, so the browser sees the reply stream in and the session at work. */
const withChat = (page: Page, body: () => Promise<void>) =>
  withChatServer(
    page,
    async ({ repo }) => {
      await startChat(page, repo);
      await expect(page.getByRole('heading', { name: 'Chat', level: 1 })).toBeVisible();
      await body();
    },
    { chunkDelayMs: 400 },
  );

test('a message sent from the session view streams its reply while the session goes working, then idle', async ({ page }) => {
  await withChat(page, async () => {
    const composer = page.getByRole('textbox', { name: 'Message Claude Code' });
    await expect(composer).toBeFocused();
    await composer.fill('Say hello in five words');
    await composer.press('Enter');

    await expect(page.getByTestId('message-user')).toHaveText('Say hello in five words');
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'working');
    await expect(page.getByTestId('session-state')).toContainText('Working');
    // Mid-reply: the first chunks are on the page and the message is still streaming.
    const reply = page.getByTestId('message-agent');
    await expect(reply).toHaveAttribute('data-streaming', 'true');
    await expect(reply).toContainText('Hello');
    // While it works, a message can still be sent (it waits its turn), and Stop is there (story 2.10).
    await expect(page.getByTestId('composer-hint')).toHaveText('Claude Code is working. A message you send now waits its turn.');
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();

    await expect(reply).toContainText('Hello from the fake agent.');
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
    await expect(reply).toHaveAttribute('data-streaming', 'false');
    await expect(page.getByTestId('transcript')).toHaveAttribute('aria-busy', 'false');
    await expect(composer).toHaveValue('');

    // A reload replays the same conversation from the event log.
    await page.reload();
    await expect(page.getByTestId('message-agent')).toHaveText(/Hello from the fake agent\./);
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
  });
});

test('an agent that crashes mid-reply leaves the session in error with a plain message; the next message resumes the chat', async ({ page }) => {
  await withChat(page, async () => {
    const composer = page.getByRole('textbox', { name: 'Message Claude Code' });
    await composer.fill('crash');
    await composer.press('Enter');
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'error');
    await expect(page.getByTestId('session-error')).toContainText('Claude Code stopped unexpectedly.');
    await expect(page.getByTestId('message-agent')).toContainText('About to');

    // Story 2.7: the chat reopens, and the break shows just before the message that reopened it.
    await composer.fill('Still there?');
    await composer.press('Enter');
    await expect(page.getByTestId('message-agent').last()).toContainText('Hello from the fake agent.');
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
    const marker = page.getByRole('separator', { name: 'Resumed from history' });
    await expect(marker).toHaveText('Resumed from history');
    await expect(page.locator('[data-testid="resumed-marker"] + [data-testid="message-user"]')).toHaveText('Still there?');
  });
});

test("an agent's Markdown reply renders formatted while it streams and after a reload; unsafe parts stay text", async ({ page }) => {
  await withChat(page, async () => {
    const composer = page.getByRole('textbox', { name: 'Message Claude Code' });
    await composer.fill('markdown');
    await composer.press('Enter');
    const reply = page.getByTestId('message-agent');
    // Mid-reply, the open fence already shows as code.
    await expect(reply.locator('pre code')).toHaveText('const answer = 42;');
    await expect(reply).toHaveAttribute('data-streaming', 'true');

    const check = async () => {
      await expect(reply.getByRole('heading', { name: 'Summary' })).toBeVisible();
      await expect(reply.locator('strong')).toHaveText('bold');
      await expect(reply.getByRole('checkbox')).toHaveCount(2);
      await expect(reply.locator('pre code')).toHaveText('const answer = 42;\nconsole.log("<b>" + answer);');
      await expect(reply.getByRole('cell', { name: 'apples' })).toBeVisible();
      await expect(reply.locator('script, img')).toHaveCount(0);
      await expect(reply).toContainText('<script>window.hacked = true</script>');
      const docs = reply.getByRole('link', { name: 'docs link' });
      await expect(docs).toHaveAttribute('href', 'https://example.com/docs');
      await expect(docs).toHaveAttribute('target', '_blank');
      await expect(docs).toHaveAttribute('rel', 'noopener noreferrer');
      await expect(reply.getByRole('link', { name: 'bad link' })).toHaveCount(0);
      await expect(reply.getByRole('link', { name: 'Image: chart' })).toHaveAttribute('href', 'https://example.com/chart.png');
      // The full address shows on keyboard focus.
      await docs.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      const address = page.locator(`[id="${await docs.getAttribute('aria-describedby')}"]`);
      await expect(address).toBeVisible();
      await expect(address).toHaveText('https://example.com/docs');
      await expect(docs).toHaveAccessibleName('docs link');
      await expect(docs).toHaveAccessibleDescription('https://example.com/docs');
    };
    await expect(reply).toHaveAttribute('data-streaming', 'false');
    await check();
    expect(await page.evaluate(() => (window as { hacked?: boolean }).hacked)).toBeUndefined();

    // The code block's Copy is reached by keyboard and copies the code exactly.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const copy = reply.getByRole('button', { name: 'Copy ts code' });
    await copy.focus();
    await page.keyboard.press('Enter');
    await expect(copy).toHaveText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('const answer = 42;\nconsole.log("<b>" + answer);');
    // A long line scrolls inside the block, never widening the chat.
    const pre = reply.locator('pre');
    await expect(pre).toHaveCSS('overflow-x', 'auto');

    await page.reload();
    await check();
  });
});
