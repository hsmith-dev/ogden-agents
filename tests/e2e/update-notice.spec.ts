/**
 * The "newer version" notice in a real browser (story 13.7, E13-R7), against a
 * fake registry: nothing here reaches npm. The banner shows once the server
 * has asked, Dismiss keeps it hidden across a reload, Settings, About shows
 * the version and Check now, and the switch is kept by the server.
 */
import { expect, test } from '@playwright/test';
import { makeDataDir, removeDataDir, startServer, type RunningServer } from '../support.js';
import { openConnected } from './tab.js';

/** A registry with one newer stable version than whatever this build is. */
function newerRegistry(version: string) {
  const requests: string[] = [];
  return {
    requests,
    fetch: async (url: string) => {
      requests.push(url);
      return Response.json({ latest: version, next: version });
    },
  };
}

test('the banner names the newer version, Dismiss keeps it hidden after a reload, and About checks again', async ({ page }) => {
  const dataDir = makeDataDir();
  const registry = newerRegistry('99.0.0');
  let server: RunningServer | undefined;
  try {
    server = await startServer(dataDir, 0, { updates: { fetch: registry.fetch } });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openConnected(page, '/', server.launchUrl);
    const banner = page.getByTestId('update-banner');
    await expect(banner).toContainText('Ogden 99.0.0 is available.');
    await expect(banner).toContainText('npx ogden-agents@latest');
    await expect(page.getByTestId('update-status')).toHaveAttribute('role', 'status');
    expect(registry.requests).toEqual(['https://registry.npmjs.org/-/package/ogden-agents/dist-tags']);

    await banner.getByRole('button', { name: 'Dismiss the notice about Ogden 99.0.0' }).click();
    await expect(banner).toHaveCount(0);
    await page.reload();
    await expect(page.locator('aside[data-slot="sidebar"]')).toBeVisible();
    await expect(page.getByTestId('update-banner')).toHaveCount(0);

    await page.goto(`${server.url}/settings/about`);
    await expect(page.getByTestId('about-version')).toBeVisible();
    await expect(page.getByTestId('about-channel')).not.toBeEmpty();
    await expect(page.getByTestId('about-available')).toContainText('Ogden 99.0.0 is available.');
    await page.getByTestId('check-now').click();
    await expect(page.getByTestId('check-result')).toHaveText('Ogden 99.0.0 is available.');
    expect(registry.requests).toHaveLength(2);
    await expect(page.getByTestId('about-last-checked')).not.toHaveText('Not yet');
  } finally {
    await server?.close();
    removeDataDir(dataDir);
  }
});

test('the switch is saved by the server, and a restart with it off asks npm for nothing', async ({ page }) => {
  const dataDir = makeDataDir();
  const first = newerRegistry('99.0.0');
  let server: RunningServer | undefined;
  try {
    server = await startServer(dataDir, 0, { updates: { fetch: first.fetch } });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openConnected(page, '/settings/about', server.launchUrl);
    const toggle = page.getByRole('switch', { name: 'Check for new versions when Ogden starts' });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await server.close();

    const second = newerRegistry('99.0.0');
    server = await startServer(dataDir, 0, { updates: { fetch: second.fetch } });
    await openConnected(page, '/settings/about', server.launchUrl);
    await expect(page.getByRole('switch', { name: 'Check for new versions when Ogden starts' })).not.toBeChecked();
    await expect(page.getByTestId('update-banner')).toHaveCount(0);
    expect(second.requests).toEqual([]);
  } finally {
    await server?.close();
    removeDataDir(dataDir);
  }
});
