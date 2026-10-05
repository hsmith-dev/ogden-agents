/// <reference lib="dom" />
/**
 * Send now or wait in a real browser (2026-10-04): the real `acp-claude-code`
 * adapter talking ACP to the fake agent, which offers the steering extension
 * as claude-agent-acp 0.84 does. While the agent works, `Enter` waits (the
 * default) and `Cmd/Ctrl+Enter` sends right away into the running turn; the
 * waiting messages are a list the user changes; and Send right away, chosen
 * in Settings, Agents, becomes what `Enter` does.
 */
import { expect, test, type Page } from '@playwright/test';
import { startChat, withChatServer } from './chat-server.js';

const composer = (page: Page) => page.getByRole('textbox', { name: 'Message Claude Code' });
const state = (page: Page) => page.getByTestId('session-state');

/** Starts a turn that holds until something ends it ("hold"). */
async function hold(page: Page) {
  await composer(page).fill('hold');
  await composer(page).press('Enter');
  await expect(state(page)).toHaveAttribute('data-state', 'working');
  await expect(page.getByTestId('message-agent').first()).toContainText('Holding');
}

test('Enter waits by default; Cmd or Ctrl+Enter sends right away into the running turn', async ({ page }) => {
  await withChatServer(page, async ({ repo }) => {
    await startChat(page, repo);
    await hold(page);
    await expect(page.getByTestId('composer-hint')).toContainText('waits its turn');

    await composer(page).fill('use the other file');
    await composer(page).press('ControlOrMeta+Enter');
    await expect(page.getByTestId('message-sent-now')).toContainText('use the other file');
    await expect(page.getByTestId('message-delivery')).toHaveText('Sent while the agent was working');
    await expect(page.getByTestId('message-agent').last()).toHaveText(/Steered: use the other file\./);
    await expect(state(page)).toHaveAttribute('data-state', 'idle');
    await expect(page.getByTestId('turn-interrupted')).toHaveCount(0);
    await expect(composer(page)).toHaveValue('');
  });
});

test('the waiting messages can be moved, removed and sent right away from the list', async ({ page }) => {
  await withChatServer(page, async ({ repo }) => {
    await startChat(page, repo);
    await hold(page);
    for (const text of ['first waiting', 'second waiting']) {
      await composer(page).fill(text);
      await composer(page).press('Enter');
    }
    const list = page.getByRole('list', { name: 'Messages waiting to be sent' });
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await list.getByRole('listitem').nth(1).getByRole('button', { name: 'Move up' }).click();
    await expect(list.getByRole('listitem').first()).toContainText('second waiting');
    await list.getByRole('listitem').nth(1).getByRole('button', { name: 'Remove' }).click();
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await list.getByRole('listitem').first().getByRole('button', { name: 'Send now' }).click();
    await expect(page.getByTestId('message-sent-now')).toContainText('second waiting');
    await expect(state(page)).toHaveAttribute('data-state', 'idle');
    // The removed one was never sent, and nothing reads "Not sent".
    await expect(page.getByTestId('transcript')).not.toContainText('first waiting');
  });
});

test('Send right away chosen in Settings, Agents makes Enter send now, and Cmd or Ctrl+Enter wait', async ({ page }) => {
  await withChatServer(page, async ({ repo }) => {
    const { url } = await startChat(page, repo);
    await page.goto(new URL('/settings/agents', page.url()).href);
    const section = page.getByTestId('while-working-section');
    await expect(section.getByRole('radio', { name: 'Wait until it finishes' })).toBeChecked();
    await section.getByRole('radio', { name: 'Send right away' }).click();
    await expect(page.getByTestId('while-working-status')).toHaveText('Saved: Send right away.');

    await page.goto(url);
    await hold(page);
    await expect(page.getByTestId('composer-hint')).toContainText('goes right away');
    await composer(page).fill('after you are done');
    await composer(page).press('ControlOrMeta+Enter');
    await expect(page.getByTestId('message-queued')).toContainText('after you are done');
    await composer(page).fill('right now');
    await composer(page).press('Enter');
    await expect(page.getByTestId('message-sent-now')).toContainText('right now');
    // The injected message ended the hold; the waiting one went after it.
    await expect(state(page)).toHaveAttribute('data-state', 'idle', { timeout: 15_000 });
    await expect(page.getByTestId('message-user').last()).toHaveText('after you are done');
  });
});
