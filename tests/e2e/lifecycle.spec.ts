/// <reference lib="dom" />
/**
 * The server lifecycle in a real browser (story 1.7): Quit Ogden Agents in the
 * sidebar footer confirms once, stops the server and shows the stopped state
 * in every open tab, and a server
 * version that differs from the page's build shows the reload banner (AD-20).
 * Each test runs its own server, so the shared one keeps serving.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { makeDataDir, removeDataDir, startServer } from './server.js';
import { openConnected } from './tab.js';

test('Quit in the sidebar footer confirms once, then every open tab shows the stopped state and the files are gone', async ({ browser }) => {
  const dataDir = makeDataDir();
  const server = await startServer(dataDir);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const page = await context.newPage();
    await openConnected(page, '/', server.launchUrl);
    // A second tab of the same browser, with its own token.
    const other = await context.newPage();
    await openConnected(other, '/', server.issueLaunchUrl());
    for (const tab of [page, other]) {
      await expect(tab.locator('aside[data-slot="sidebar"]').getByTestId('server-status')).toHaveAttribute('data-status', 'connected');
    }

    const sidebar = page.locator('aside[data-slot="sidebar"]');
    await sidebar.getByRole('button', { name: 'Quit Ogden Agents' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Quit Ogden Agents?' });
    await expect(confirm).toContainText('Ogden Agents stops on this computer until you run npx ogden-agents again.');

    // Cancel changes nothing.
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toBeHidden();
    await expect(sidebar.getByTestId('server-status')).toHaveAttribute('data-status', 'connected');

    await sidebar.getByRole('button', { name: 'Quit Ogden Agents' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Quit', exact: true }).click();

    for (const tab of [page, other]) {
      const stopped = tab.getByTestId('server-stopped');
      await expect(stopped.getByRole('heading', { name: 'Ogden Agents has stopped.' })).toBeVisible();
      await expect(stopped).toContainText('Run npx ogden-agents to start it again.');
      await expect(tab.locator('aside[data-slot="sidebar"]')).toHaveCount(0);
    }

    expect(await server.stopped).toBe('quit');
    expect(existsSync(join(dataDir, 'server.json'))).toBe(false);
    expect(existsSync(join(dataDir, 'launcher.token'))).toBe(false);

    // Both stay stopped: no reconnecting line reappears.
    await page.waitForTimeout(2500);
    for (const tab of [page, other]) await expect(tab.getByTestId('server-stopped')).toBeVisible();
  } finally {
    await context.close();
    await server.close();
    removeDataDir(dataDir);
  }
});

test('Quit names running agents in its consequence, and a failed quit is shown in the dialog', async ({ browser }) => {
  const dataDir = makeDataDir();
  const server = await startServer(dataDir);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const workspace = server.core.entities.ensureWorkspace(dataDir);
    server.core.entities.createSession({ workspaceId: workspace.id, kind: 'chat', state: 'working' });

    const page = await context.newPage();
    await openConnected(page, '/', server.launchUrl);
    const sidebar = page.locator('aside[data-slot="sidebar"]');
    await expect(sidebar.getByTestId('server-status')).toHaveAttribute('data-status', 'connected');
    await sidebar.getByRole('button', { name: 'Quit Ogden Agents' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Quit Ogden Agents?' });
    await expect(confirm).toContainText('1 agent is still working and will stop');

    // The server refuses (say, it is having trouble): the dialog says so and stays open.
    await page.route('**/api/v1/server/quit', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Something went wrong.' } }) }),
    );
    await confirm.getByRole('button', { name: 'Quit', exact: true }).click();
    await expect(confirm.getByRole('alert')).toHaveText('Something went wrong.');
    await expect(sidebar.getByTestId('server-status')).toHaveAttribute('data-status', 'connected');

    // Trying again for real sends the confirmation's force, so busy agents don't block it.
    await page.unroute('**/api/v1/server/quit');
    await confirm.getByRole('button', { name: 'Quit', exact: true }).click();
    await expect(page.getByTestId('server-stopped')).toBeVisible();
    expect(await server.stopped).toBe('quit');
  } finally {
    await context.close();
    await server.close();
    removeDataDir(dataDir);
  }
});

test('a server of another version shows a non-blocking reload banner', async ({ browser }) => {
  const dataDir = makeDataDir();
  const server = await startServer(dataDir);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const page = await context.newPage();
    await openConnected(page, '/', server.launchUrl);
    await expect(page.getByTestId('server-status').filter({ visible: true })).toHaveAttribute('data-status', 'connected');
    // Same version as the build: no banner.
    await expect(page.getByTestId('version-banner')).toHaveCount(0);

    // The server now reports another version (as after an update).
    server.core.events.append({ type: 'server.started', workspaceId: null, streamId: 'server', payload: { version: '999.0.0' } });
    const banner = page.getByTestId('version-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Ogden Agents was updated.');
    // Non-blocking: the rest of the page still works.
    await expect(page.getByTestId('workspace-empty')).toBeVisible();

    const reloaded = page.waitForEvent('load');
    await banner.getByRole('button', { name: 'Reload' }).click();
    await reloaded;
  } finally {
    await context.close();
    await server.close();
    removeDataDir(dataDir);
  }
});
