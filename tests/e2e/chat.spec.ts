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
    await expect(page.getByTestId('composer-hint')).toContainText('Claude Code is working. While it works, your message waits its turn. To send it right away, press');
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
