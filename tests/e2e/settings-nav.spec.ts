/// <reference lib="dom" />
/**
 * Settings with grouped navigation (epic 26, E26-R7): a left nav in seven
 * groups stays on every settings page, so Agents to Appearance is one click;
 * every old route keeps its page; below md the nav is a select under the
 * page header. Runs on the shared server, Developer mode off.
 */
import { expect, test, type Page } from '@playwright/test';
import { NEW_PROJECTS_SETTINGS_LABEL } from '../../packages/shared/src/bmad.ts';
import { startChat, withChatServer } from './chat-server.js';
import { expectNoHorizontalOverflow, openConnected, settingsLinkOf, settingsNavOf } from './tab.js';

const navLink = (page: Page, name: string) => settingsNavOf(page).getByRole('link', { name, exact: true });
const current = (page: Page) => settingsNavOf(page).locator('a[aria-current="page"]');

test.describe('settings nav at 1440 px', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('Agents to Appearance is one click, and the nav stays with Appearance current', async ({ page }) => {
    await openConnected(page, '/settings/agents');
    await expect(page.getByRole('heading', { name: 'Agents', level: 1 })).toBeVisible();
    await expect(navLink(page, 'Agents')).toHaveAttribute('aria-current', 'page');
    await expect(settingsNavOf(page).getByRole('link')).toHaveText(['Agents', 'Projects', 'Appearance', 'Notifications', 'Remote machines', 'Advanced']);

    await navLink(page, 'Appearance').click();
    await expect(page).toHaveURL(/\/settings\/appearance$/);
    await expect(page.getByRole('heading', { name: 'Appearance', level: 1 })).toBeVisible();
    await expect(navLink(page, 'Appearance')).toHaveAttribute('aria-current', 'page');
    await expect(navLink(page, 'Agents')).not.toHaveAttribute('aria-current', 'page');
    await expect(settingsLinkOf(page)).toHaveAttribute('data-active', 'true');
  });

  // Each old route, its page's heading, and the nav link marked current.
  const routes: Array<{ path: string; heading: string; current: string }> = [
    { path: '/settings', heading: 'Appearance', current: 'Appearance' },
    { path: '/settings/appearance', heading: 'Appearance', current: 'Appearance' },
    { path: '/settings/agents', heading: 'Agents', current: 'Agents' },
    { path: '/settings/agents/new', heading: 'Agents', current: 'Agents' },
    { path: '/settings/new-projects', heading: NEW_PROJECTS_SETTINGS_LABEL, current: NEW_PROJECTS_SETTINGS_LABEL },
    { path: '/settings/builds', heading: 'Builds', current: 'Builds' },
    { path: '/settings/notifications', heading: 'Notifications', current: 'Notifications' },
    { path: '/settings/terminals', heading: 'Terminals', current: 'Terminals' },
    { path: '/settings/remote-machines', heading: 'Remote machines', current: 'Remote machines' },
    { path: '/settings/tools', heading: 'Tools', current: 'Tools' },
    { path: '/settings/dev-tools', heading: 'Developer tools', current: 'Developer tools' },
    { path: '/settings/mcp', heading: 'Shared tools and skills', current: 'MCP servers' },
    { path: '/settings/about', heading: 'About', current: 'About' },
  ];
  for (const route of routes) {
    test(`${route.path} opens its page inside the nav, ${route.current} current`, async ({ page }) => {
      await openConnected(page, route.path);
      await expect(page.getByRole('heading', { name: route.heading, level: 1 })).toBeVisible();
      await expect(settingsNavOf(page)).toBeVisible();
      await expect(navLink(page, route.current)).toHaveAttribute('aria-current', 'page');
    });
  }

  test('a sub-page: Advanced is selected, its pages show, MCP servers current', async ({ page }) => {
    await openConnected(page, '/settings/mcp');
    // The current group's row is selected text, not a second link to one of its pages.
    await expect(settingsNavOf(page).locator('[data-selected="true"]')).toHaveText('Advanced');
    await expect(navLink(page, 'Advanced')).toHaveCount(0);
    for (const name of ['Tools', 'Developer tools', 'MCP servers', 'About', 'Welcome']) await expect(navLink(page, name)).toBeVisible();
    await expect(current(page)).toHaveText(['MCP servers']);
    // Another group's pages are folded away.
    await expect(navLink(page, 'Builds')).toHaveCount(0);
  });

  test('Terminals shows in simple mode only while its page is open', async ({ page }) => {
    await openConnected(page, '/settings/appearance');
    await expect(navLink(page, 'Appearance')).toBeVisible();
    await expect(navLink(page, 'Terminals')).toHaveCount(0);
    await page.goto(new URL('/settings/terminals', page.url()).href);
    await expect(navLink(page, 'Terminals')).toHaveAttribute('aria-current', 'page');
  });

  test("a group's first page is the only current item: /settings/tools marks Tools, not Advanced too", async ({ page }) => {
    await openConnected(page, '/settings/tools');
    await expect(page.getByRole('heading', { name: 'Tools', level: 1 })).toBeVisible();
    await expect(current(page)).toHaveCount(1);
    await expect(current(page)).toHaveText('Tools');
  });

  test('↓ and ↑ move focus between nav links and stop at the ends', async ({ page }) => {
    await openConnected(page, '/settings/agents');
    await navLink(page, 'Agents').focus();
    await page.keyboard.press('ArrowUp');
    await expect(navLink(page, 'Agents')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(navLink(page, 'Projects')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(navLink(page, 'Agents')).toBeFocused();
    await navLink(page, 'Advanced').focus();
    await page.keyboard.press('ArrowDown');
    await expect(navLink(page, 'Advanced')).toBeFocused();
    // Arrows only move focus: the page is unchanged.
    await expect(page).toHaveURL(/\/settings\/agents$/);
  });
});

test("a project's workspace settings page is not wrapped in the settings nav", async ({ page }) => {
  await withChatServer(page, async ({ repo }) => {
    const chat = await startChat(page, repo);
    await page.goto(`${new URL(chat.url).origin}/w/${chat.wsId}/settings`);
    await expect(page.getByRole('heading', { name: 'Workspace settings', level: 1 })).toBeVisible();
    await expect(settingsNavOf(page)).toHaveCount(0);
    await expect(page.getByLabel('Settings page')).toHaveCount(0);
  });
});

test('390 px: no left column; the select under the header shows the page and navigates, with no overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openConnected(page, '/settings/agents');
  await expect(page.getByRole('heading', { name: 'Agents', level: 1 })).toBeVisible();
  await expect(settingsNavOf(page)).toBeHidden();
  const select = page.getByLabel('Settings page');
  await expect(select).toBeVisible();
  await expect(select).toHaveValue('/settings/agents');

  // Header, then the select, then the page body.
  const header = (await page.locator('[data-slot="page-header"]').boundingBox())!;
  const row = (await page.locator('[data-slot="settings-select-row"]').boundingBox())!;
  const body = (await page.locator('[data-slot="page-body"]').boundingBox())!;
  expect(row.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
  expect(body.y).toBeGreaterThanOrEqual(row.y + row.height - 1);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: 'test-results/settings-nav-390.png', fullPage: false });

  await select.selectOption({ label: 'Appearance' });
  await expect(page).toHaveURL(/\/settings\/appearance$/);
  await expect(page.getByRole('heading', { name: 'Appearance', level: 1 })).toBeVisible();
  await expect(select).toHaveValue('/settings/appearance');
  await expectNoHorizontalOverflow(page);
});
