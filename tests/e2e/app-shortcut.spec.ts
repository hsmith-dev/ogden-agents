/**
 * The app shortcut in a real browser (story 2.4): the first-run offer, Add
 * from it, then Remove in Settings. The server here has no launcher entry,
 * so it runs the in-memory `shortcut-memory` stub: nothing is written on
 * this computer. Its own server, so the shared one's offer is left as is.
 */
import { expect, test } from '@playwright/test';
import { makeDataDir, removeDataDir, startServer, type RunningServer } from '../support.js';
import { landConnected, launchLink } from './tab.js';

let server: RunningServer;
let dataDir: string;

test.beforeAll(async () => {
  dataDir = makeDataDir();
  server = await startServer(dataDir);
});

test.afterAll(async () => {
  await server.close();
  removeDataDir(dataDir);
});

test('the first-run offer adds the shortcut, never shows again, and Settings removes it', async ({ page }) => {
  await landConnected(page, server.launchUrl);
  const offer = page.getByTestId('app-shortcut-offer');
  await expect(offer).toContainText('Open Ogden Agents from your apps menu next time.');
  await offer.getByRole('button', { name: 'Add shortcut' }).click();
  await expect(offer).toHaveCount(0);

  await page.goto(`${server.url}/settings/appearance`);
  const remove = page.getByRole('button', { name: 'Remove' });
  await expect(remove).toBeVisible();
  await expect(page.getByText('App shortcut', { exact: true })).toBeVisible();
  await remove.click();
  await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeVisible();
  if (process.platform === 'darwin') await expect(page.getByText(/drag Ogden Agents from Applications to the Dock/)).toBeVisible();

  // Answered for good: a new tab gets no offer, even with the shortcut removed.
  await landConnected(page, await launchLink(server.url, dataDir));
  await expect(page.locator('aside[data-slot="sidebar"]')).toBeVisible();
  await expect(page.getByTestId('app-shortcut-offer')).toHaveCount(0);
});

test('Not now hides the offer', async ({ page }) => {
  const otherDir = makeDataDir();
  const other = await startServer(otherDir);
  try {
    await landConnected(page, other.launchUrl);
    const offer = page.getByTestId('app-shortcut-offer');
    await offer.getByRole('button', { name: 'Not now' }).click();
    await expect(offer).toHaveCount(0);
    await page.reload();
    await expect(page.locator('aside[data-slot="sidebar"]')).toBeVisible();
    await expect(page.getByTestId('app-shortcut-offer')).toHaveCount(0);
  } finally {
    await other.close();
    removeDataDir(otherDir);
  }
});
