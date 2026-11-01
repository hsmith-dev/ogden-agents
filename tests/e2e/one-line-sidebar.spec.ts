/// <reference lib="dom" />
/**
 * One-line sidebar rows and a shortcut banner that shows once (epic 26,
 * 26.5), in a real browser. Twenty fixture chats in one project at
 * 1440x900 in Compact density: every row is one line at row height and at
 * least sixteen are fully in view. The banner shows on the first load (that
 * marks the offer answered), is gone after a reload, and comes back from
 * Help's tip. Axe checks the sidebar and the banner; a 390px screenshot of
 * the drawer is attached. Its own server, so the shared one's offer is left
 * as is; the in-memory shortcut stub writes nothing on this computer.
 */
import AxeBuilder from '@axe-core/playwright';
import { basename } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { API_ROUTES, makeDataDir, removeDataDir, startServer, type RunningServer } from '../support.js';
import { expectConnected, expectNoHorizontalOverflow, landConnected, openFromHelp, sidebarOf } from './tab.js';

/** Where the page keeps this browser's appearance (appearance.ts). */
const APPEARANCE_KEY = 'ogden-agents.appearance';
const CHATS = 20;

let server: RunningServer;
let dataDir: string;
let projectDir: string;

test.beforeAll(async () => {
  dataDir = makeDataDir();
  projectDir = makeDataDir('ogden-agents-e2e-one-line-');
  server = await startServer(dataDir);
  const workspace = server.core.entities.ensureWorkspace(projectDir);
  for (let n = 1; n <= CHATS; n++) server.core.entities.createSession({ workspaceId: workspace.id, kind: 'chat', state: 'idle', title: `Chat number ${n}` });
});

test.afterAll(async () => {
  await server.close();
  removeDataDir(dataDir);
  removeDataDir(projectDir);
});

const offerOf = (page: Page) => page.getByTestId('app-shortcut-offer');
const shortcutStatus = (page: Page) => page.waitForResponse((response) => response.url().endsWith(API_ROUTES.appShortcut) && response.request().method() === 'GET');

test('the banner shows once: seeing it answers it, a reload has none, Help brings it back; axe finds nothing', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const seen = page.waitForResponse((response) => response.url().endsWith(API_ROUTES.appShortcutOffer) && response.request().method() === 'DELETE');
  await landConnected(page, server.launchUrl);
  await expect(offerOf(page)).toContainText('Open Ogden Agents from your apps menu next time.');
  expect((await seen).status()).toBe(204);
  // It stays for this load.
  await page.waitForTimeout(500);
  await expect(offerOf(page)).toBeVisible();

  const axe = await new AxeBuilder({ page }).include('aside[data-slot="sidebar"]').include('[data-testid="app-shortcut-offer"]').analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([]);

  // The next load: no banner.
  const status = shortcutStatus(page);
  await page.reload();
  await status;
  await expectConnected(page);
  await expect(offerOf(page)).toHaveCount(0);

  // Help's tip shows it again; Not now closes it.
  await openFromHelp(page, 'Add the app shortcut');
  await expect(offerOf(page)).toBeVisible();
  await offerOf(page).getByRole('button', { name: 'Not now' }).click();
  await expect(offerOf(page)).toHaveCount(0);
});

test('twenty chats at 1440x900 in Compact: every row is one line at row height, sixteen or more fully in view', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await landConnected(page, server.issueLaunchUrl());
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ theme: 'system', density: 'compact', developerMode: false })), APPEARANCE_KEY);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  const group = sidebarOf(page).getByRole('group', { name: basename(projectDir) });
  const rows = group.getByTestId('status-row');
  await expect(rows).toHaveCount(CHATS);

  // Each row: glyph, the name, the agent's mark; its words are its accessible name.
  const first = rows.first();
  await expect(first).toHaveAccessibleName(/^Chat number \d+, Idle, Claude Code, (just now|\d+ min ago)$/);
  await expect(first.locator('[data-slot="agent-mark"]')).toHaveAttribute('data-letter', 'CC');
  await expect(first.locator('time')).toHaveCount(0);

  const rowHeight = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row-height')));
  expect(rowHeight).toBe(30);
  const content = (await sidebarOf(page).locator('[data-slot="sidebar-content"]').boundingBox())!;
  const boxes = await rows.evaluateAll((all) => all.map((row) => row.getBoundingClientRect().toJSON() as { top: number; bottom: number; height: number }));
  for (const box of boxes) expect(box.height).toBe(rowHeight);
  // One line: the name never wraps (its line box is a single line of label type).
  const nameLines = await rows.evaluateAll((all) =>
    all.map((row) => {
      const name = row.querySelector('bdi')!.parentElement!;
      return Math.round(name.getBoundingClientRect().height / parseFloat(getComputedStyle(name).lineHeight));
    }),
  );
  expect(new Set(nameLines)).toEqual(new Set([1]));
  const inView = boxes.filter((box) => box.top >= content.y && box.bottom <= content.y + content.height).length;
  expect(inView, `${inView} rows fully in view`).toBeGreaterThanOrEqual(16);

  // The tooltip says the same words as the name.
  await first.hover();
  await expect(page.getByRole('tooltip')).toHaveText(/^Chat number \d+, Idle, Claude Code, /);

  const axe = await new AxeBuilder({ page }).include('aside[data-slot="sidebar"]').analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([]);
  await page.evaluate((key) => localStorage.removeItem(key), APPEARANCE_KEY);
});

test('at 390px the drawer has one-line rows and Help in its footer, nothing clipped', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await landConnected(page, server.issueLaunchUrl());
  await page.getByTestId('sidebar-trigger').click();
  const sheet = page.getByRole('dialog', { name: 'Projects and sessions' });
  await expect(sheet.getByTestId('help-menu')).toBeVisible();
  const rows = sheet.getByRole('group', { name: basename(projectDir) }).getByTestId('status-row');
  await expect(rows).toHaveCount(CHATS);
  const height = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row-height')));
  for (const box of await rows.evaluateAll((all) => all.map((row) => row.getBoundingClientRect().height))) expect(box).toBe(height);
  // The mark sits inside the row, never clipped by its edge.
  const clipped = await rows.evaluateAll((all) =>
    all.filter((row) => {
      const mark = row.querySelector('[data-slot="agent-mark"]')!.getBoundingClientRect();
      const box = row.getBoundingClientRect();
      return mark.right > box.right || mark.left < box.left || mark.width === 0;
    }).length,
  );
  expect(clipped).toBe(0);
  await expectNoHorizontalOverflow(page);
  await testInfo.attach('drawer-390', { body: await page.screenshot({ path: 'test-results/one-line-sidebar-390.png' }), contentType: 'image/png' });

  // Help opens over the drawer; Welcome is there, and Keyboard shortcuts lists them.
  await sheet.getByTestId('help-menu').click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Welcome' })).toBeVisible();
  await testInfo.attach('help-390', { body: await page.screenshot({ path: 'test-results/one-line-sidebar-help-390.png' }), contentType: 'image/png' });
  await menu.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click();
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog.getByText('Rename the chat')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
