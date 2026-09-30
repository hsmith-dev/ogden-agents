/// <reference lib="dom" />
/**
 * Permission cards in a real browser (story 2.6): the fake agent asks to run
 * a command through the real `acp-claude-code` adapter, and nothing runs
 * until the user answers the card. Deny records its reason on the record
 * line; Always allow lets the same command prefix run without a card until
 * it is undone from the record line. Each test runs its own server.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { makeDataDir, removeDataDir, ROOT, startServer, type RunningServer } from '../support.js';
import { openConnected } from './tab.js';

const FAKE_AGENT = join(ROOT, 'tests', 'fixtures', 'fake-acp-agent.mjs');

async function withChatServer(page: Page, body: (server: RunningServer) => Promise<void>) {
  const dataDir = makeDataDir();
  const repo = mkdtempSync(join(tmpdir(), 'ogden-agents-e2e-repo-'));
  const server = await startServer(dataDir, 0, { claudeAdapterPath: FAKE_AGENT });
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

async function send(page: Page, text: string) {
  const composer = page.getByRole('textbox', { name: 'Message Claude Code' });
  await composer.fill(text);
  await composer.press('Enter');
}

const replies = (page: Page) => page.getByTestId('message-agent');
const card = (page: Page) => page.getByTestId('permission-card');

test('nothing runs until Allow once; the card collapses to its record and focus returns to the composer', async ({ page }) => {
  await withChatServer(page, async () => {
    await send(page, 'permission');
    await expect(card(page)).toBeVisible();
    await expect(card(page)).toContainText('Claude Code wants to run a command');
    await expect(card(page).getByTestId('permission-command')).toHaveText('npm test');
    await expect(card(page).getByTestId('permission-scope')).toContainText('npm test in ogden-agents-e2e-repo-');
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'waiting');
    await expect(page.getByTestId('permission-announcement')).toHaveText('Claude Code is waiting for you: run npm test');
    // The card never takes focus, and no button is focused by default.
    await expect(page.getByRole('textbox', { name: 'Message Claude Code' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Send' })).toHaveAttribute('aria-disabled', 'true');

    // No one answers: nothing runs, and the session keeps waiting.
    await page.waitForTimeout(1500);
    await expect(replies(page)).toHaveCount(0);
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'waiting');

    // `1` answers only while the card has focus: typed in the composer, it is just text.
    await page.getByRole('textbox', { name: 'Message Claude Code' }).press('1');
    await expect(replies(page)).toHaveCount(0);
    await card(page).focus();
    await page.keyboard.press('1');

    await expect(replies(page)).toContainText('Ran npm test.');
    await expect(card(page)).toHaveCount(0);
    await expect(page.getByTestId('permission-record')).toContainText('Allowed once: npm test');
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
    await expect(page.getByRole('textbox', { name: 'Message Claude Code' })).toBeFocused();
  });
});

test('Deny records its reason on the record line, and the agent reports Denied', async ({ page }) => {
  await withChatServer(page, async () => {
    await send(page, 'permission');
    await expect(card(page)).toBeVisible();
    await card(page).getByLabel('Reason for Deny (optional)').fill('Run only the unit tests');
    // Typing a reason never answers the card, even with a number in it.
    await card(page).getByLabel('Reason for Deny (optional)').press('3');
    await expect(card(page)).toBeVisible();
    await card(page).getByLabel('Reason for Deny (optional)').fill('Run only the unit tests');
    await card(page).getByRole('button', { name: 'Deny' }).click();

    await expect(replies(page)).toContainText('Denied npm test.');
    const record = page.getByTestId('permission-record');
    await expect(record).toContainText('Denied: npm test');
    await expect(record.getByTestId('permission-reason')).toHaveText('Your reason: Run only the unit tests');

    // The record is read back from the event log after a reload.
    await page.reload();
    await expect(page.getByTestId('permission-reason')).toHaveText('Your reason: Run only the unit tests');
  });
});

test('Always allow lets the same prefix run without a card, until it is undone from the record line', async ({ page }) => {
  await withChatServer(page, async () => {
    await send(page, 'permission npm install stripe');
    await expect(card(page)).toBeVisible();
    await expect(card(page).getByTestId('permission-scope')).toContainText('npm install in ');
    await card(page).getByRole('button', { name: 'Always allow' }).click();
    await expect(replies(page)).toContainText('Ran npm install stripe.');
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');

    await send(page, 'permission npm install lodash');
    await expect(replies(page).nth(1)).toContainText('Ran npm install lodash.');
    await expect(card(page)).toHaveCount(0);
    const records = page.getByTestId('permission-record');
    await expect(records.nth(1)).toContainText('Allowed by your Always allow rule: npm install lodash');

    // A compound command is never covered by the rule.
    await send(page, 'permission npm install x && rm -rf build');
    await expect(card(page)).toBeVisible();
    await card(page).getByRole('button', { name: 'Deny' }).click();
    await expect(replies(page).nth(2)).toContainText('Denied npm install x && rm -rf build.');

    // Undo from the first record line.
    await records.first().getByTestId('permission-record-text').click();
    await page.getByTestId('permission-undo').getByRole('button', { name: 'Undo Always allow' }).click();
    await expect(records.first().getByTestId('permission-rule-undone')).toBeVisible();

    await send(page, 'permission npm install lodash');
    await expect(card(page)).toBeVisible();
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'waiting');
    await card(page).getByRole('button', { name: 'Allow once' }).click();
    await expect(replies(page).nth(3)).toContainText('Ran npm install lodash.');
  });
});

test('a command led by an interpreter or wrapper offers only Allow once and Deny, with the reason', async ({ page }) => {
  await withChatServer(page, async () => {
    await send(page, 'permission bash -c ls');
    await expect(card(page)).toBeVisible();
    await expect(card(page).getByRole('button', { name: 'Allow once' })).toBeVisible();
    await expect(card(page).getByRole('button', { name: 'Deny' })).toBeVisible();
    await expect(card(page).getByRole('button', { name: 'Always allow' })).toHaveCount(0);
    await expect(card(page).getByTestId('permission-scope')).toHaveText("Always allow isn't offered for bash, because it can run anything.");
    // `2` does nothing here.
    await card(page).focus();
    await page.keyboard.press('2');
    await expect(card(page)).toBeVisible();
    await card(page).getByRole('button', { name: 'Deny' }).click();
    await expect(replies(page)).toContainText('Denied bash -c ls.');
  });
});
