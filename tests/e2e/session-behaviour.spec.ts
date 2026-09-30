/// <reference lib="dom" />
/**
 * The session view's behaviour in a real browser (story 2.10), through the
 * real `acp-claude-code` adapter and the fake ACP agent: a multi-file change
 * groups its tool-call rows in Comfortable and lists them in Compact, with
 * the edit expanding to its hunk; a message sent while the agent works is
 * "Queued", then sent; an error offers Try again; and a quiet agent gets the
 * check-in line, with Stop, which leaves what was queued "Not sent" and puts
 * its text back in the composer. Each test runs its own server.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { makeDataDir, removeDataDir, ROOT, startServer, type RunningServer, type StartOptions } from '../support.js';
import { openConnected } from './tab.js';

const FAKE_AGENT = join(ROOT, 'tests', 'fixtures', 'fake-acp-agent.mjs');
/** The web app's appearance key (`APPEARANCE_STORAGE_KEY` in packages/shared). */
const APPEARANCE_KEY = 'ogden-agents.appearance';

async function withChatServer(page: Page, body: (server: RunningServer) => Promise<void>, extra: StartOptions = {}) {
  const dataDir = makeDataDir();
  const repo = mkdtempSync(join(tmpdir(), 'ogden-agents-e2e-repo-'));
  // Slow chunks, so a second message is sent while the first reply is still coming.
  const server = await startServer(dataDir, 0, { claudeAdapterPath: FAKE_AGENT, extraAgentEnv: { FAKE_ACP_CHUNK_DELAY_MS: '400' }, ...extra });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openConnected(page, '/', server.launchUrl);
    await page.getByLabel('Project folder').fill(repo);
    await page.getByRole('button', { name: 'Start a chat' }).click();
    await expect(page).toHaveURL(/\/w\/ws_[0-9A-Z]{26}\/s\/ses_[0-9A-Z]{26}$/);
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
    await body(server);
  } finally {
    await server.close();
    removeDataDir(dataDir);
    removeDataDir(repo);
  }
}

const composer = (page: Page) => page.getByRole('textbox', { name: 'Message Claude Code' });

async function send(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press('Enter');
}

const state = (page: Page) => page.getByTestId('session-state');

test('a multi-file change groups its rows in Comfortable and lists them in Compact; the edit expands to its hunk', async ({ page }) => {
  await withChatServer(page, async () => {
    await send(page, 'tools');
    await expect(page.getByTestId('message-agent')).toContainText('Changed src/a.ts.');
    await expect(state(page)).toHaveAttribute('data-state', 'idle');

    const group = page.getByTestId('tool-call-group');
    await expect(group).toHaveText('Read 3 files, edited 1');
    await expect(group).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('tool-call-row')).toHaveCount(0);
    await group.press('Enter');
    await expect(group).toHaveAttribute('aria-expanded', 'true');
    const rows = page.getByTestId('tool-call-row');
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toContainText('Read');
    await expect(rows.nth(0)).toContainText('src/a.ts');
    await expect(rows.nth(3)).toContainText('Edited');

    const edit = rows.nth(3).getByRole('button');
    await edit.click();
    const hunk = page.getByTestId('tool-call-detail');
    await expect(hunk.locator('[data-mark="removed"]')).toHaveText('- export const a = 1;');
    await expect(hunk.locator('[data-mark="added"]')).toHaveText('+ export const a = 2;');

    // Compact lists every call on its own.
    await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ theme: 'system', density: 'compact', developerMode: true })), APPEARANCE_KEY);
    await page.reload();
    await expect(page.getByTestId('message-agent')).toContainText('Changed src/a.ts.');
    await expect(page.getByTestId('tool-call-group')).toHaveCount(0);
    await expect(page.getByTestId('tool-call-row')).toHaveCount(4);
    await page.evaluate((key) => localStorage.removeItem(key), APPEARANCE_KEY);
  });
});

test('a message sent while the agent works shows Queued, then is sent after the reply', async ({ page }) => {
  await withChatServer(page, async () => {
    await send(page, 'Say hello');
    await expect(state(page)).toHaveAttribute('data-state', 'working');
    await send(page, 'And then this');
    const queued = page.getByTestId('message-queued');
    await expect(queued).toHaveAttribute('data-status', 'queued');
    await expect(queued).toContainText('And then this');
    await expect(queued.getByTestId('message-queue-status')).toHaveText('Queued');
    await expect(composer(page)).toHaveValue('');

    // Sent once the first reply is done: it becomes an ordinary message with its own reply.
    await expect(page.getByTestId('message-user')).toHaveText(['Say hello', 'And then this']);
    await expect(queued).toHaveCount(0);
    await expect(page.getByTestId('message-agent')).toHaveCount(2);
    await expect(state(page)).toHaveAttribute('data-state', 'idle');
    await expect(page.getByTestId('message-agent').nth(1)).toContainText('Hello from the fake agent.');
  });
});

test('an error shows its reason with Try again, which sends the last message again', async ({ page }) => {
  await withChatServer(page, async () => {
    await send(page, 'fail');
    await expect(state(page)).toHaveAttribute('data-state', 'error');
    const notice = page.getByTestId('session-error');
    await expect(notice).toBeVisible();
    await notice.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('message-user')).toHaveText(['fail', 'fail']);
    await expect(state(page)).toHaveAttribute('data-state', 'error');
  });
});

test('a quiet agent gets the check-in line with Stop; Stop ends it, and what was queued is not sent and comes back to the composer', async ({ page }) => {
  await withChatServer(
    page,
    async () => {
      await send(page, 'quiet');
      await expect(state(page)).toHaveAttribute('data-state', 'working');
      await send(page, 'Later, please');
      await expect(page.getByTestId('message-queued')).toHaveAttribute('data-status', 'queued');

      const checkIn = page.getByTestId('check-in');
      await expect(checkIn).toContainText('Claude Code has been quiet for 10 minutes');
      // Still working: no error, no timeout.
      await expect(state(page)).toHaveAttribute('data-state', 'working');
      await expect(page.getByTestId('session-error')).toHaveCount(0);
      // Esc never stops.
      await composer(page).press('Escape');
      await expect(state(page)).toHaveAttribute('data-state', 'working');

      await checkIn.getByRole('button', { name: 'Stop' }).click();
      await expect(state(page)).toHaveAttribute('data-state', 'idle');
      await expect(checkIn).toHaveCount(0);
      await expect(page.getByTestId('message-queued')).toHaveAttribute('data-status', 'not_sent');
      await expect(page.getByTestId('message-queue-status')).toHaveText('Not sent');
      await expect(composer(page)).toHaveValue('Later, please');
      await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0);
    },
    { checkInDelayMs: 1_500 },
  );
});

test('a quiet agent with a tool call running says what it waits on, and keeps waiting', async ({ page }) => {
  await withChatServer(
    page,
    async () => {
      await send(page, 'quiet-tool');
      const checkIn = page.getByTestId('check-in');
      await expect(checkIn).toContainText('Claude Code is waiting on Run npm run build');
      await expect(checkIn.getByRole('button', { name: 'Stop' })).toHaveCount(0);
      await expect(state(page)).toHaveAttribute('data-state', 'working');
      // Stop beside the composer is always there.
      await page.getByTestId('stop').click();
      await expect(state(page)).toHaveAttribute('data-state', 'idle');
    },
    { checkInDelayMs: 1_500 },
  );
});
