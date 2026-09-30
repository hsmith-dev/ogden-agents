/// <reference lib="dom" />
/**
 * The live status sidebar in a real browser (story 2.11): two projects at
 * once, one chat working and one waiting on a permission request. A tab
 * opened fresh from the launcher shows both groups with their states,
 * "Needs you" names the request and its project, and the tab title counts
 * it. Answering the request clears Needs you and the title. Each test runs
 * its own server with the fake agent.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { makeDataDir, removeDataDir, ROOT, startServer } from '../support.js';
import { landConnected, launchLink, openConnected, sidebarOf } from './tab.js';

const FAKE_AGENT = join(ROOT, 'tests', 'fixtures', 'fake-acp-agent.mjs');

/** The live announcer's polite batch (live-announcer.tsx). */
const POLITE_INTERVAL_MS = 5000;

async function startChat(page: Page, origin: string, repo: string, message: string) {
  await page.goto(`${origin}/`);
  await page.getByLabel('Project folder').fill(repo);
  await page.getByRole('button', { name: 'Start a chat' }).click();
  await expect(page).toHaveURL(/\/w\/ws_[0-9A-Z]{26}\/s\/ses_[0-9A-Z]{26}$/);
  await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
  const composer = page.getByRole('textbox', { name: 'Message Claude Code' });
  await composer.fill(message);
  await composer.press('Enter');
}

/** The workspace group named by the repo's folder, in the sidebar column. */
const groupOf = (page: Page, repo: string) => sidebarOf(page).getByRole('group', { name: basename(repo) });

test('two busy projects: both groups show their states, Needs you names the request, and the title counts it', async ({ page, context }) => {
  const dataDir = makeDataDir();
  const working = mkdtempSync(join(tmpdir(), 'ogden-agents-e2e-working-'));
  const asking = mkdtempSync(join(tmpdir(), 'ogden-agents-e2e-asking-'));
  const server = await startServer(dataDir, 0, { claudeAdapterPath: FAKE_AGENT });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openConnected(page, '/', server.launchUrl);

    await startChat(page, server.url, asking, 'permission');
    await expect(page.getByTestId('permission-card')).toBeVisible();
    // The open session announces its own card; the shell stays silent about it, even once Needs you shows it.
    await expect(sidebarOf(page).getByTestId('needs-you-item')).toBeVisible();
    await expect(page.getByTestId('needs-you-announcement')).toHaveText('');
    // `hold` keeps working until the server closes.
    await startChat(page, server.url, working, 'hold');
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'working');

    // Reopen from the launcher: a new tab replays the backlog.
    await page.close();
    const tab = await context.newPage();
    await tab.setViewportSize({ width: 1440, height: 900 });
    // The tab's own clock, so the 5 s polite batch is stepped, not waited for.
    await tab.clock.install();
    await landConnected(tab, await launchLink(server.url, dataDir));

    await expect(groupOf(tab, working).getByTestId('status-row')).toHaveAttribute('data-session-state', 'working');
    await expect(groupOf(tab, working).getByTestId('status-row')).toHaveAccessibleName('Chat, Claude Code, working');
    await expect(groupOf(tab, asking).getByTestId('status-row')).toHaveAttribute('data-session-state', 'waiting');
    const needsYou = sidebarOf(tab).getByTestId('needs-you');
    await expect(needsYou.getByTestId('needs-you-item')).toHaveText(`Waiting for you${basename(asking)}: Claude Code wants to run npm test`);
    await expect(tab).toHaveTitle('(1) Ogden Agents');
    await expect(needsYou.getByTestId('needs-you-item')).toHaveAttribute('href', /\/w\/ws_[0-9A-Z]{26}\/s\/ses_[0-9A-Z]{26}$/);

    // Answer the request from another tab. This tab (on the home page) sees the chat go working, then
    // idle: its first announcements after the backlog. The backlog itself was never announced.
    const other = await context.newPage();
    await openConnected(other, new URL(await needsYou.getByTestId('needs-you-item').evaluate((a) => (a as HTMLAnchorElement).href)).pathname, await launchLink(server.url, dataDir));
    await other.getByTestId('permission-card').getByRole('button', { name: 'Allow once' }).click();
    await expect(other.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
    await other.close();

    await expect(groupOf(tab, asking).getByTestId('status-row')).toHaveAttribute('data-session-state', 'idle');
    await expect(sidebarOf(tab).getByTestId('needs-you')).toHaveCount(0);
    await expect(tab).toHaveTitle('Ogden Agents');
    await tab.clock.runFor(POLITE_INTERVAL_MS);
    await expect(tab.getByTestId('sidebar-announcement')).toHaveText(`${basename(asking)}: Chat is idle`);
    // Neither the working chat from the backlog nor the request that was already waiting was said.
    await expect(tab.getByTestId('needs-you-announcement')).toHaveText('');
  } finally {
    await server.close();
    removeDataDir(dataDir);
    removeDataDir(working);
    removeDataDir(asking);
  }
});

test('a request in another project is announced once, and the rail shows it as a counted button', async ({ page, context }) => {
  const dataDir = makeDataDir();
  const asking = mkdtempSync(join(tmpdir(), 'ogden-agents-e2e-asking-'));
  const other = mkdtempSync(join(tmpdir(), 'ogden-agents-e2e-other-'));
  const server = await startServer(dataDir, 0, { claudeAdapterPath: FAKE_AGENT });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openConnected(page, '/', server.launchUrl);
    await startChat(page, server.url, other, 'hello');
    const otherChat = page.url();
    await startChat(page, server.url, asking, 'hello');
    await expect(page.getByTestId('message-agent')).toContainText('Hello from the fake agent.');
    const askingChat = page.url();

    // Watch from the other chat while a second tab asks from the asking one: the request is in a session not on screen.
    await page.goto(otherChat);
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
    const second = await context.newPage();
    await openConnected(second, new URL(askingChat).pathname, await launchLink(server.url, dataDir));
    const composer = second.getByRole('textbox', { name: 'Message Claude Code' });
    await composer.fill('permission');
    await composer.press('Enter');
    await expect(second.getByTestId('permission-card')).toBeVisible();
    await second.close();

    await expect(page.getByTestId('needs-you-announcement')).toHaveText('Claude Code is waiting for you: run npm test');
    await expect(sidebarOf(page).getByTestId('needs-you-item')).toHaveText(`Waiting for you${basename(asking)}: Claude Code wants to run npm test`);
    // Nothing takes focus: not the sidebar, not Needs you.
    expect(await page.evaluate(() => document.activeElement?.closest('[data-slot="sidebar"]') ?? null)).toBeNull();

    // The rail (768 to 1023 px): a counted Needs you button and glyph rows, each with an accessible name.
    await page.setViewportSize({ width: 900, height: 800 });
    const rail = sidebarOf(page).getByTestId('needs-you-rail');
    await expect(rail).toBeVisible();
    await expect(rail).toHaveAccessibleName('Needs you, 1');
    await expect(groupOf(page, asking).getByRole('link', { name: 'Chat, Claude Code, waiting for you' })).toBeVisible();
    await rail.click();
    await expect(page).toHaveURL(askingChat);
    await expect(page.getByTestId('permission-card')).toBeVisible();
  } finally {
    await server.close();
    removeDataDir(dataDir);
    removeDataDir(asking);
    removeDataDir(other);
  }
});

test('below md, a row in the sheet opens its session and closes the sheet', async ({ page }) => {
  const dataDir = makeDataDir();
  const repo = mkdtempSync(join(tmpdir(), 'ogden-agents-e2e-sheet-'));
  const server = await startServer(dataDir, 0, { claudeAdapterPath: FAKE_AGENT });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openConnected(page, '/', server.launchUrl);
    await startChat(page, server.url, repo, 'hello');
    const chat = page.url();
    await page.goto(`${server.url}/`);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId('sidebar-trigger').click();
    const sheet = page.getByRole('dialog', { name: 'Projects and sessions' });
    await sheet.getByRole('group', { name: basename(repo) }).getByTestId('status-row').click();
    await expect(page).toHaveURL(chat);
    await expect(sheet).toBeHidden();
  } finally {
    await server.close();
    removeDataDir(dataDir);
    removeDataDir(repo);
  }
});
