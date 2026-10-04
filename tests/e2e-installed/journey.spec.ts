/// <reference lib="dom" />
/**
 * Epic 1's journey against the installed package, in Chromium (story 1.12):
 * launch through the installed `ogden` launcher, land connected through its
 * launch link, see the shell, change theme and density, open Settings > Tools
 * (status only, no download), open a New tab, see the launch state in a
 * bookmark-style tab, then Quit with confirmation: every connected tab shows
 * stopped and the server process is gone. It runs after the gate checks,
 * since it ends the server.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { withTimeout } from '../../scripts/installed-package.mjs';
import { API_ROUTES, isAlive } from '../support.js';
import { DARK_BG, expectConnected as connected, landConnected, sidebarOf, storedToken } from '../e2e/tab.js';
import { installed, LAUNCHER_ARGS } from './installed.js';

test('the epic 1 journey on the installed package', async ({ page, context }) => {
  const { install, url, pid, dataDir, startOutput } = installed();
  const uvInstalls: string[] = [];
  context.on('request', (request) => {
    if (new URL(request.url()).pathname === API_ROUTES.uvInstall) uvInstalls.push(request.url());
  });

  let launchUrl = '';
  await test.step('1. launch through the installed launcher', async () => {
    // The global setup's run started the background server and exited.
    expect(startOutput).toContain('Starting Ogden Agents in the background...');
    expect(isAlive(pid)).toBe(true);
    // Running it again, as a user would, finds that server and prints a fresh one-time link.
    // It runs the installed bin by its path: a second npx run could reinstall
    // over the package the server is running from (and its native addon).
    const run = install.runInstalledLauncher(LAUNCHER_ARGS);
    try {
      const printed = await withTimeout(run.urls(), 60_000, 'the launcher to print its URLs');
      await withTimeout(run.exited, 15_000, 'the launcher to exit');
      expect(run.child.exitCode, run.output()).toBe(0);
      expect(run.output()).toContain('Ogden Agents is already running');
      expect(printed.url).toBe(url);
      launchUrl = printed.launchUrl;
    } finally {
      await run.stop();
    }
    expect(install.readPortFile()?.pid).toBe(pid);
  });

  await test.step('2. land connected through the launch link: a fresh install goes through Welcome (story 9.5)', async () => {
    // The boot script strips #c= and exchanges the code for this tab's token; a first run goes on to Welcome.
    await page.goto(launchUrl);
    await expect(page).toHaveURL(`${url}/welcome`);
    await expect.poll(() => storedToken(page)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await connected(page);
    await expect(page.getByTestId('welcome-headline')).toHaveText('Pick the agent that will do the work.');
    await page.getByRole('button', { name: 'Skip for now' }).click();
    await expect(page).toHaveURL(`${url}/`);
    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
  });

  await test.step('3. see the shell', async () => {
    const sidebar = sidebarOf(page);
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByText('Ogden Agents', { exact: true })).toBeVisible();
    await expect(sidebar.getByTestId('server-status')).toContainText('Running on this computer');
    await expect(page.getByTestId('workspace-area')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Add a project to get started.' })).toBeVisible();
  });

  await test.step('4. change theme and density', async () => {
    await sidebarOf(page).getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('menuitem', { name: 'Appearance' }).click();
    await expect(page).toHaveURL(/\/settings\/appearance$/);
    await expect(page.getByRole('heading', { name: 'Appearance', level: 1 })).toBeVisible();

    await page.getByTestId('theme').getByRole('radio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(DARK_BG);

    await page.getByTestId('density').getByRole('radio', { name: 'Compact' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');

    // Both survive a reload, and the tab stays connected.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
    await connected(page);
  });

  await test.step('5. open Settings > Tools: the status is shown, nothing is downloaded', async () => {
    await sidebarOf(page).getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('menuitem', { name: 'Tools' }).click();
    await expect(page).toHaveURL(/\/settings\/tools$/);
    await expect(page.getByRole('heading', { name: 'Tools', level: 1 })).toBeVisible();
    const status = page.getByTestId('uv-status');
    await expect(status).toBeVisible();
    // Whatever this runner has: a uv found, none, or none for this platform. Never installing.
    await expect(status).toHaveAttribute('data-state', /^(ready|missing|failed)$/);
    expect(uvInstalls).toEqual([]);
  });

  let second!: Page;
  await test.step('6. open a New tab', async () => {
    const first = await storedToken(page);
    const opened = context.waitForEvent('page');
    await sidebarOf(page).getByRole('button', { name: 'New tab' }).click();
    second = await opened;
    await expect(second).toHaveURL(`${url}/`);
    await connected(second);
    const token = await storedToken(second);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token).not.toBe(first);
    await connected(page);
  });

  await test.step('7. a bookmark-style tab shows the launch state', async () => {
    const bookmark = await context.newPage();
    await bookmark.goto(`${url}/settings/appearance`);
    const launch = bookmark.getByTestId('open-ogden-agents');
    await expect(launch.getByRole('heading', { name: 'Open Ogden Agents' })).toBeVisible();
    await expect(sidebarOf(bookmark)).toHaveCount(0);
    expect(await storedToken(bookmark)).toBeNull();
    // The bookmark's path is kept.
    await expect(bookmark).toHaveURL(`${url}/settings/appearance`);
    await bookmark.close();
  });

  await test.step('8. Quit with confirmation: every tab shows stopped, and no server process is left', async () => {
    const sidebar = sidebarOf(page);
    await sidebar.getByRole('button', { name: 'Quit Ogden Agents' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Quit Ogden Agents?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Quit', exact: true }).click();

    for (const tab of [page, second]) {
      const stopped = tab.getByTestId('server-stopped');
      await expect(stopped.getByRole('heading', { name: 'Ogden Agents has stopped.' })).toBeVisible();
      await expect(sidebarOf(tab)).toHaveCount(0);
    }

    await expect.poll(() => isAlive(pid), { timeout: 15_000 }).toBe(false);
    expect(existsSync(join(dataDir, 'server.json'))).toBe(false);
    expect(existsSync(join(dataDir, 'launcher.token'))).toBe(false);
  });
});
