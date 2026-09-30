/// <reference lib="dom" />
/**
 * The tracer bullet in a real browser (story 2.2): a chat started in a folder
 * from the home page, a message sent from the session view at
 * `/w/:wsId/s/:sesId`, and the reply streaming in while the session goes
 * working, then idle. The server's agent is the real `acp-claude-code`
 * adapter talking ACP to the fake agent (`tests/fixtures/fake-acp-agent.mjs`),
 * so this is the same path a live Claude Code chat takes. Each test runs its
 * own server.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { makeDataDir, removeDataDir, ROOT, startServer, type RunningServer } from '../support.js';
import { openConnected } from './tab.js';

const FAKE_AGENT = join(ROOT, 'tests', 'fixtures', 'fake-acp-agent.mjs');

async function withChatServer(page: Page, body: (server: RunningServer, repo: string) => Promise<void>) {
  const dataDir = makeDataDir();
  const repo = mkdtempSync(join(tmpdir(), 'ogden-agents-e2e-repo-'));
  // Slow chunks, so the browser sees the reply stream in and the session at work.
  const server = await startServer(dataDir, 0, { claudeAdapterPath: FAKE_AGENT, extraAgentEnv: { FAKE_ACP_CHUNK_DELAY_MS: '400' } });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openConnected(page, '/', server.launchUrl);
    await body(server, repo);
  } finally {
    await server.close();
    removeDataDir(dataDir);
    removeDataDir(repo);
  }
}

async function startChat(page: Page, repo: string) {
  await page.getByLabel('Project folder').fill(repo);
  await page.getByRole('button', { name: 'Start a chat' }).click();
  await expect(page).toHaveURL(/\/w\/ws_[0-9A-Z]{26}\/s\/ses_[0-9A-Z]{26}$/);
  await expect(page.getByRole('heading', { name: 'Chat', level: 1 })).toBeVisible();
  await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
}

test('a message sent from the session view streams its reply while the session goes working, then idle', async ({ page }) => {
  await withChatServer(page, async (_server, repo) => {
    await startChat(page, repo);
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
  await withChatServer(page, async (_server, repo) => {
    await startChat(page, repo);
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

test('a folder that does not exist is refused in plain words, on the home page', async ({ page }) => {
  await withChatServer(page, async (_server, repo) => {
    await page.getByLabel('Project folder').fill(join(repo, 'missing'));
    await page.getByRole('button', { name: 'Start a chat' }).click();
    await expect(page.getByTestId('start-chat-error')).toHaveText('There is no folder at that path on this computer.');
    await expect(page).toHaveURL(/\/$/);
  });
});
