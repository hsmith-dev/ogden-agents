/// <reference lib="dom" />
/**
 * The app shell in a real browser (story 1.6): sidebar forms and overflow at
 * desktop, tablet and phone widths; theme and density switching; the live
 * server status across a dropped connection; and the launch state of a tab
 * without a token. Every test opens its tab through a fresh launch link
 * (`openConnected`), since a tab's token lives only in that tab.
 */
import { expect, test, type Page } from '@playwright/test';
import { makeDataDir, removeDataDir, startServer } from '../support.js';
import { openConnected, sharedUrl as url } from './tab.js';

/** DESIGN.md background tokens as the browser reports them. */
const LIGHT_BG = 'rgb(246, 247, 245)';
const DARK_BG = 'rgb(15, 18, 16)';

async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, 'page scrolls horizontally').toBeLessThanOrEqual(clientWidth);
}

const background = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

/** The sidebar column (md and up), not its sheet copy. */
const sidebarColumn = (page: Page) => page.locator('aside[data-slot="sidebar"]');

for (const path of ['/', '/settings/appearance']) {
  test.describe(`layout of ${path}`, () => {
    test('1440 px: full sidebar beside the workspace area', async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openConnected(page, path);
      const sidebar = sidebarColumn(page);
      await expect(sidebar).toBeVisible();
      expect((await sidebar.boundingBox())!.width).toBe(272);
      await expect(sidebar.getByText('No projects yet')).toBeVisible();
      await expect(sidebar.getByText('Ogden Agents', { exact: true })).toBeVisible();
      await expect(page.getByTestId('sidebar-trigger')).toBeHidden();
      await expect(page.getByTestId('workspace-area')).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });

    test('900 px: the sidebar is a 56 px rail of icons and glyphs', async ({ page }) => {
      await page.setViewportSize({ width: 900, height: 800 });
      await openConnected(page, path);
      const sidebar = sidebarColumn(page);
      await expect(sidebar).toBeVisible();
      expect((await sidebar.boundingBox())!.width).toBe(56);
      await expect(sidebar.getByText('No projects yet')).toBeHidden();
      // Labels stay as accessible names in the rail.
      await expect(sidebar.getByRole('button', { name: 'Add project' })).toBeVisible();
      await expect(sidebar.getByRole('button', { name: 'Settings' })).toBeVisible();
      const addBox = (await sidebar.getByRole('button', { name: 'Add project' }).boundingBox())!;
      expect(addBox.x + addBox.width).toBeLessThanOrEqual(56);
      await expect(page.getByTestId('sidebar-trigger')).toBeHidden();
      await expectNoHorizontalOverflow(page);
    });

    test('390 px: the sidebar opens as a sheet from the header', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openConnected(page, path);
      await expect(sidebarColumn(page)).toBeHidden();
      const trigger = page.getByTestId('sidebar-trigger');
      await expect(trigger).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await trigger.click();
      const sheet = page.getByRole('dialog', { name: 'Projects and sessions' });
      await expect(sheet).toBeVisible();
      await expect(sheet.getByText('No projects yet')).toBeVisible();
      await expect(sheet.getByRole('button', { name: 'Add project' })).toBeVisible();
      await expect(sheet.getByTestId('server-status')).toBeVisible();
      const box = (await sheet.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      await expectNoHorizontalOverflow(page);

      // The column's copy is still mounted: no id appears twice.
      const duplicateIds = await page.evaluate(() => {
        const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
        return ids.filter((id, i) => ids.indexOf(id) !== i);
      });
      expect(duplicateIds).toEqual([]);

      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();

      // Any navigation from the sheet closes it.
      await trigger.click();
      await sheet.getByRole('link', { name: 'Ogden Agents, home' }).click();
      await expect(sheet).toBeHidden();
      await expect(page).toHaveURL(/\/$/);
    });
  });
}

test('900 px: the rail server status is reachable by keyboard and names its state', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await openConnected(page);
  const status = sidebarColumn(page).getByTestId('server-status');
  // The word is visually hidden in the rail but stays in the live status text.
  await expect(status).toHaveText('Running on this computer');
  const glyph = status.locator('[data-slot="state-glyph"]');
  await glyph.focus();
  await expect(glyph).toBeFocused();
  await expect(page.getByRole('tooltip')).toHaveText('Running on this computer');
});

test('an unknown URL shows a not-found page inside the shell', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openConnected(page, '/no/such/page');
  await expect(page.getByTestId('not-found').getByRole('heading', { name: "There's nothing at this address." })).toBeVisible();
  await expect(sidebarColumn(page)).toBeVisible();
  await page.getByRole('link', { name: 'Go to projects' }).click();
  await expect(page.getByRole('heading', { name: 'Add a project to get started.' })).toBeVisible();
});

test('Appearance fields name and describe their controls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openConnected(page, '/settings/appearance');
  await expect(page.getByRole('radiogroup', { name: 'Theme' })).toHaveAccessibleDescription(/follows your computer/);
  await expect(page.getByRole('radiogroup', { name: 'Density' })).toHaveAccessibleDescription(/fits more on the screen/);
  await expect(page.getByRole('switch', { name: 'Developer mode' })).toHaveAccessibleDescription(/Compact density/);
  // The switch's hit area meets the Comfortable target floor.
  const box = (await page.getByTestId('developer-mode').boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(32);
  expect(box.width).toBeGreaterThanOrEqual(32);
});

test('first load: the empty sidebar and the empty workspace area, in plain language', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openConnected(page);
  await expect(page.getByRole('heading', { name: 'Add a project to get started.' })).toBeVisible();
  await expect(page.getByTestId('workspace-empty').getByRole('button', { name: 'Add project' })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('button', { name: 'Start a new project folder' })).toBeVisible();
  await expect(page.getByTestId('needs-you')).toHaveCount(0);
  await expect(page.getByTestId('server-status').filter({ visible: true })).toContainText('Running on this computer');
  // No skill names in the default (non-developer) view.
  await expect(page.locator('body')).not.toContainText(/bmad-/i);
  // Self-hosted fonts: Geist is loaded from the app's own assets.
  const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(family).toContain('Geist');
  expect(await page.evaluate(() => document.fonts.check('15px "Geist Variable"'))).toBe(true);
});

test('Settings in the sidebar footer opens Appearance', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openConnected(page);
  await sidebarColumn(page).getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('menuitem', { name: 'Appearance' }).click();
  await expect(page).toHaveURL(/\/settings\/appearance$/);
  await expect(page.getByRole('heading', { name: 'Appearance', level: 1 })).toBeVisible();
});

test('first load carries only the shell and home; a settings page loads its own chunk on navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const scripts: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'script') scripts.push(new URL(request.url()).pathname);
  });
  await openConnected(page);
  await expect(page.getByRole('heading', { name: 'Add a project to get started.' })).toBeVisible();
  const lazyPage = /\/assets\/(appearance|tools)-page-[^/]+\.js$/;
  expect(scripts.some((path) => path.startsWith('/assets/'))).toBe(true);
  expect(scripts.filter((path) => lazyPage.test(path))).toEqual([]);

  await sidebarColumn(page).getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('menuitem', { name: 'Appearance' }).click();
  await expect(page.getByRole('heading', { name: 'Appearance', level: 1 })).toBeVisible();
  expect(scripts.some((path) => /\/assets\/appearance-page-[^/]+\.js$/.test(path))).toBe(true);
});

test('theme: follows the system, the override applies at once and persists across reloads', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await openConnected(page, '/settings/appearance');
  expect(await background(page)).toBe(DARK_BG);

  await page.getByTestId('theme').getByRole('radio', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await background(page)).toBe(LIGHT_BG);

  await page.reload();
  // Applied before first paint by the inline script, then kept by React.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await background(page)).toBe(LIGHT_BG);
  await expect(page.getByTestId('theme').getByRole('radio', { name: 'Light' })).toHaveAttribute('data-state', 'on');

  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByTestId('theme').getByRole('radio', { name: 'Dark' }).click();
  expect(await background(page)).toBe(DARK_BG);

  await page.getByTestId('theme').getByRole('radio', { name: 'System' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/);
  expect(await background(page)).toBe(LIGHT_BG);
});

test('density: Developer mode sets compact tokens; rows and body type shrink; the layout is unchanged', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openConnected(page, '/settings/appearance');
  const sidebar = sidebarColumn(page);
  const settingsRow = sidebar.getByRole('button', { name: 'Settings' });
  const bodySize = () => page.evaluate(() => getComputedStyle(document.documentElement).fontSize);

  expect((await settingsRow.boundingBox())!.height).toBe(40);
  expect(await bodySize()).toBe('15px');

  await page.getByTestId('developer-mode').click();
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  await expect(page.getByTestId('density').getByRole('radio', { name: 'Compact' })).toHaveAttribute('data-state', 'on');
  expect((await settingsRow.boundingBox())!.height).toBe(30);
  expect(await bodySize()).toBe('13px');
  // Same shell, same order: only the tokens changed.
  await expect(sidebar).toBeVisible();
  expect((await sidebar.boundingBox())!.width).toBe(232);
  await expect(page.getByTestId('workspace-area')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');

  await page.getByTestId('developer-mode').click();
  await expect(page.locator('html')).not.toHaveAttribute('data-density', /.*/);
  expect((await settingsRow.boundingBox())!.height).toBe(40);

  // Density can also be set on its own.
  await page.getByTestId('density').getByRole('radio', { name: 'Compact' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  await expect(page.getByTestId('developer-mode')).toHaveAttribute('data-state', 'unchecked');
  await page.getByTestId('density').getByRole('radio', { name: 'Comfortable' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-density', /.*/);
});

test('server status: a dropped socket shows reconnecting, then reconnects and catches up with no event repeated', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const subscribes: number[] = [];
  const received: number[] = [];
  const sockets: Array<{ close(): Promise<void> }> = [];
  let refuse = false;
  // Stands between the page and the server, so the test can drop the connection.
  await page.routeWebSocket(/\/ws$/, (ws) => {
    if (refuse) {
      void ws.close({ code: 1006 });
      return;
    }
    const server = ws.connectToServer();
    sockets.push({ close: () => ws.close() });
    ws.onMessage((payload) => {
      const message = JSON.parse(String(payload)) as { type: string; afterSeq?: number };
      if (message.type === 'subscribe') subscribes.push(message.afterSeq!);
      server.send(payload);
    });
    server.onMessage((payload) => {
      const message = JSON.parse(String(payload)) as { seq?: number };
      if (message.seq !== undefined) received.push(message.seq);
      ws.send(payload);
    });
  });

  await openConnected(page);
  const status = page.getByTestId('server-status').filter({ visible: true });
  await expect(status).toHaveAttribute('data-status', 'connected');
  await expect.poll(() => received.length).toBeGreaterThan(0);
  const before = received.length;

  refuse = true;
  await sockets.at(-1)!.close();
  await expect(status).toHaveAttribute('data-status', 'reconnecting', { timeout: 10_000 });
  await expect(status).toContainText('Reconnecting...');

  refuse = false;
  await expect(status).toHaveAttribute('data-status', 'connected', { timeout: 10_000 });
  await expect.poll(() => subscribes.length).toBeGreaterThanOrEqual(2);
  expect(subscribes[0]).toBe(0);
  // The reconnect subscribed after the last event it had, so nothing came twice.
  expect(subscribes.at(-1)).toBe(received[before - 1]);
  expect(new Set(received).size).toBe(received.length);
});

test('restart: a tab of the old server shows reconnecting while it is gone, then the launch state; a new launch link connects', async ({ browser }) => {
  const dataDir = makeDataDir();
  let server = await startServer(dataDir);
  const port = server.port;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const page = await context.newPage();
    await openConnected(page, '/', server.launchUrl);
    const status = page.getByTestId('server-status').filter({ visible: true });
    await expect(status).toHaveAttribute('data-status', 'connected');

    await server.close();
    await expect(status).toHaveAttribute('data-status', 'reconnecting', { timeout: 10_000 });

    // Same port and data folder, but tokens live in the server's memory only.
    server = await startServer(dataDir, port);
    const launch = page.getByTestId('open-ogden-agents');
    await expect(launch.getByRole('heading', { name: 'Open Ogden Agents' })).toBeVisible({ timeout: 10_000 });
    expect(await page.evaluate(() => sessionStorage.length)).toBe(0);

    await openConnected(page, '/', server.launchUrl);
    await expect(page.getByTestId('server-status').filter({ visible: true })).toHaveAttribute('data-status', 'connected');
  } finally {
    await context.close();
    await server.close();
    removeDataDir(dataDir);
  }
});

test.describe('a tab without a token', () => {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`a plain URL loads the app and shows "Open Ogden Agents", styled with the tokens (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      const sockets: string[] = [];
      page.on('websocket', (ws) => sockets.push(ws.url()));
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 800 });
        for (const path of ['/', '/settings/appearance']) {
          const response = await page.goto(url() + path);
          expect(response!.status()).toBe(200);
          const launch = page.getByTestId('open-ogden-agents');
          await expect(launch.getByRole('heading', { name: 'Open Ogden Agents' })).toBeVisible();
          await expect(launch).toContainText("This tab isn't connected. Run npx ogden-agents in a terminal.");
          await expect(launch.getByRole('button', { name: 'Copy command' })).toBeVisible();
          await expect(page.locator('aside[data-slot="sidebar"]')).toHaveCount(0);
          // The bookmark's path is kept.
          await expect(page).toHaveURL(url() + path);
          expect(await background(page)).toBe(colorScheme === 'dark' ? DARK_BG : LIGHT_BG);
          await expectNoHorizontalOverflow(page);
        }
      }
      // It never tries to connect without a token.
      expect(sockets).toEqual([]);
    });
  }

  test('Copy says so when the clipboard refuses', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) } });
    });
    await page.goto(url());
    await page.getByRole('button', { name: 'Copy command' }).click();
    await expect(page.getByRole('status').filter({ hasText: "Couldn't copy" })).toHaveText("Couldn't copy. Type the command in a terminal.");
  });
});
