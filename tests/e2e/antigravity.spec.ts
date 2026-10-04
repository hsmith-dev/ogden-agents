/// <reference lib="dom" />
/**
 * Epic 6 entry 5 in a real browser: an Antigravity chat beside a Claude Code
 * chat in one project, Antigravity's server played by the fake agent's
 * Antigravity personality (`tests/fixtures/fake-antigravity.mjs`) and its
 * key a test value in the server's environment. Its card holds a shell
 * command, its mode picker offers Ask and (in Developer mode) Skip all but
 * never Auto, and a slow start shows as starting. No test runs the real
 * Antigravity server or reaches Google.
 */
import { expect, test, type Page } from '@playwright/test';
import { apiPath } from '../../packages/shared/src/api.ts';
import { API_ROUTES, FAKE_GEMINI_KEY, fakeAntigravity, removeDataDir } from '../support.js';
import { setDeveloperMode, startChat, withChatServer } from './chat-server.js';
import { storedToken } from './tab.js';

/** Starts an Antigravity chat in the project `wsId` through the REST API, as the picker does, and opens it. */
async function startAntigravityChat(page: Page, wsId: string): Promise<string> {
  const origin = new URL(page.url()).origin;
  const token = await storedToken(page);
  const response = await fetch(`${origin}${apiPath(API_ROUTES.workspaceSessions, { wsId })}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, origin, 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'chat', agentId: 'antigravity' }),
  });
  if (!response.ok) throw new Error(`starting an Antigravity chat returned ${response.status}: ${await response.text()}`);
  const { session } = (await response.json()) as { session: { id: string } };
  const url = `${origin}/w/${wsId}/s/${session.id}`;
  await page.goto(url);
  await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
  return url;
}

const composer = (page: Page) => page.getByRole('textbox', { name: 'Message Antigravity' });

async function send(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press('Enter');
  await expect(composer(page)).toHaveValue('');
}

const unpinned = !['darwin-arm64', 'linux-x64', 'win32-x64'].includes(`${process.platform}-${process.arch}`);

test.describe('Antigravity chat (epic 6 entry 5)', () => {
  test.skip(unpinned, 'no Antigravity pin for this platform');

  test('beside a Claude Code chat: its card holds a shell command, Auto is unavailable, Skip all runs without a card', async ({ page }) => {
    const antigravity = await fakeAntigravity();
    try {
      await withChatServer(
        page,
        async ({ repo }) => {
          const claude = await startChat(page, repo);
          await startAntigravityChat(page, claude.wsId);

          // A shell command waits for its card, which shows the command; Allow once runs it.
          await send(page, 'permission npm test');
          const card = page.getByTestId('permission-card');
          await expect(card.getByTestId('permission-command')).toHaveText('npm test');
          await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'waiting');
          await card.getByRole('button', { name: 'Allow once' }).click();
          await expect(page.getByTestId('message-agent').last()).toContainText('Ran npm test. chose=allow');
          await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');

          // Its mode picker: Auto unavailable with the reason; Skip all offered in Developer mode.
          await setDeveloperMode(page, true);
          await page.reload();
          await page.getByTestId('permission-mode-picker').click();
          const auto = page.getByTestId('permission-mode-auto');
          await expect(auto).toHaveAttribute('data-disabled', '');
          await expect(auto).toContainText("Antigravity doesn't offer Auto.");
          await page.getByTestId('permission-mode-skip_all').click();
          await page.getByTestId('skip-all-confirm-button').click();
          await expect(page.getByTestId('permission-mode-picker')).toHaveAttribute('data-mode', 'skip_all');
          await send(page, 'permission rm -rf build');
          await expect(page.getByTestId('message-agent').last()).toContainText('Ran rm -rf build.');
          await expect(page.getByTestId('permission-card')).toHaveCount(0);

          // The status sidebar names each chat's agent.
          const rows = page.getByTestId('status-row');
          await expect(rows).toHaveCount(2);
          await expect(rows.filter({ hasText: 'Antigravity' })).toHaveCount(1);
          await expect(rows.filter({ hasText: 'Claude Code' })).toHaveCount(1);
        },
        { extra: { antigravity: { agent: antigravity.agent, setup: antigravity.setup }, extraAgentEnv: { GEMINI_API_KEY: FAKE_GEMINI_KEY } } },
      );
    } finally {
      removeDataDir(antigravity.dataDir);
    }
  });

  test('a slow start shows "Starting Antigravity..." until it answers', async ({ page }) => {
    const antigravity = await fakeAntigravity();
    try {
      await withChatServer(
        page,
        async ({ repo }) => {
          const claude = await startChat(page, repo);
          await startAntigravityChat(page, claude.wsId);
          await send(page, 'hello');
          const starting = page.getByTestId('agent-starting');
          await expect(starting).toContainText('Starting Antigravity...');
          await expect(page.getByTestId('message-agent').last()).toContainText('Hello from the fake agent.', { timeout: 20_000 });
          await expect(starting).toHaveCount(0);
        },
        { extra: { antigravity: { agent: antigravity.agent, setup: antigravity.setup }, extraAgentEnv: { GEMINI_API_KEY: FAKE_GEMINI_KEY, FAKE_ACP_INIT_DELAY_MS: '6000' } } },
      );
    } finally {
      removeDataDir(antigravity.dataDir);
    }
  });
});
