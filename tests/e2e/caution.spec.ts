/// <reference lib="dom" />
/**
 * The caution level in a real browser (story 2.8): at the default every
 * request waits for a card; at Ask for commands a read inside the project
 * runs without one while a command still waits; and an Always allow rule
 * listed on the Workspace settings page can be removed there, after which
 * the next such command asks again. Each test runs its own server.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { makeDataDir, removeDataDir, ROOT, startServer, type RunningServer } from '../support.js';
import { openConnected } from './tab.js';

const FAKE_AGENT = join(ROOT, 'tests', 'fixtures', 'fake-acp-agent.mjs');

async function withChatServer(page: Page, body: (server: RunningServer, chatUrl: string) => Promise<void>) {
  const dataDir = makeDataDir();
  const repo = mkdtempSync(join(tmpdir(), 'ogden-agents-e2e-repo-'));
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'a.ts'), 'a');
  const server = await startServer(dataDir, 0, { claudeAdapterPath: FAKE_AGENT });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openConnected(page, '/', server.launchUrl);
    await page.getByLabel('Project folder').fill(repo);
    await page.getByRole('button', { name: 'Start a chat' }).click();
    await expect(page).toHaveURL(/\/w\/ws_[0-9A-Z]{26}\/s\/ses_[0-9A-Z]{26}$/);
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
    await body(server, page.url());
  } finally {
    await server.close();
    removeDataDir(dataDir);
    removeDataDir(repo);
  }
}

async function send(page: Page, text: string) {
  const composer = page.getByRole('textbox', { name: 'Message Claude Code' });
  await composer.fill(text);
  await composer.press('Enter');
}

const replies = (page: Page) => page.getByTestId('message-agent');
const card = (page: Page) => page.getByTestId('permission-card');
const idle = (page: Page) => expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
const settingsUrl = (chatUrl: string) => chatUrl.replace(/\/s\/ses_[0-9A-Z]{26}$/, '/settings');

test('Ask for commands lets a read inside the project run without a card; a command still waits', async ({ page }) => {
  await withChatServer(page, async (_server, chatUrl) => {
    await send(page, 'permission-kind read src/a.ts');
    await expect(card(page)).toBeVisible();
    await expect(card(page)).toContainText('Ask every time');
    await card(page).getByRole('button', { name: 'Deny' }).click();
    await expect(replies(page)).toContainText('Denied read src/a.ts.');
    await idle(page);

    await page.goto(settingsUrl(chatUrl));
    const level = page.getByRole('radiogroup', { name: 'Caution level' });
    await expect(level.getByRole('radio', { name: 'Ask every time' })).toBeChecked();
    await level.getByRole('radio', { name: 'Ask for commands' }).click();
    await expect(page.getByTestId('caution-status')).toHaveText('Saved: Ask for commands.');
    await page.reload();
    await expect(page.getByRole('radio', { name: 'Ask for commands' })).toBeChecked();

    await page.goto(chatUrl);
    await idle(page);
    await send(page, 'permission-kind read src/a.ts');
    await expect(replies(page).nth(1)).toContainText('Did read src/a.ts.');
    await expect(card(page)).toHaveCount(0);
    await expect(page.getByTestId('permission-record').nth(1)).toContainText('Allowed by the caution level: read src/a.ts');
    await idle(page);

    // Outside the project, and a command, still ask.
    await send(page, 'permission-kind read ../outside.txt');
    await expect(card(page)).toBeVisible();
    await expect(card(page)).toContainText('Ask for commands');
    await card(page).getByRole('button', { name: 'Deny' }).click();
    await idle(page);
    await send(page, 'permission npm test');
    await expect(card(page)).toBeVisible();
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'waiting');
  });
});

test('an Always allow rule is listed on the settings page; Remove it and the next such command asks', async ({ page }) => {
  await withChatServer(page, async (_server, chatUrl) => {
    await page.goto(settingsUrl(chatUrl));
    await expect(page.getByTestId('rules-empty')).toHaveText('No rules yet.');

    await page.goto(chatUrl);
    await idle(page);
    await send(page, 'permission npm test');
    await expect(card(page)).toBeVisible();
    await card(page).getByRole('button', { name: 'Always allow' }).click();
    await expect(replies(page)).toContainText('Ran npm test.');
    await idle(page);

    await page.goto(settingsUrl(chatUrl));
    const row = page.getByTestId('rule-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('npm test in ogden-agents-e2e-repo-');
    await row.getByRole('button', { name: /^Remove npm test in / }).click();
    await expect(page.getByTestId('rules-empty')).toHaveText('No rules yet.');

    await page.goto(chatUrl);
    await idle(page);
    await send(page, 'permission npm test');
    await expect(card(page)).toBeVisible();
  });
});

test('at Ask only for risky actions an edit in the project runs, but an edit to .claude/ always shows a card saying why', async ({ page }) => {
  await withChatServer(page, async (_server, chatUrl) => {
    await page.goto(settingsUrl(chatUrl));
    await page.getByRole('radio', { name: 'Ask only for risky actions' }).click();
    await expect(page.getByTestId('caution-status')).toHaveText('Saved: Ask only for risky actions.');

    await page.goto(chatUrl);
    await idle(page);
    await send(page, 'permission-kind edit src/a.ts');
    await expect(replies(page)).toContainText('Did edit src/a.ts.');
    await expect(card(page)).toHaveCount(0);
    await idle(page);

    await send(page, 'permission-kind edit .claude/settings.local.json');
    await expect(card(page)).toBeVisible();
    await expect(card(page).getByTestId('permission-protected')).toHaveText(
      'It touches a file that controls how Claude Code or git runs, so Ogden Agents always asks.',
    );
    await card(page).getByRole('button', { name: 'Deny' }).click();
    await expect(replies(page).nth(1)).toContainText('Denied edit .claude/settings.local.json.');
  });
});
