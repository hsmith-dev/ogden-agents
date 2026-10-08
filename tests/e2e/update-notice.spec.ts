/**
 * The "newer version" notice in a real browser (story 13.7, E13-R7), against a
 * fake registry: nothing here reaches npm. The banner shows once the server
 * has asked, Dismiss keeps it hidden across a reload, Settings, About shows
 * the version and Check now, and the switch is kept by the server.
 */
import { expect, test } from '@playwright/test';
import { makeDataDir, removeDataDir, startServer, type RunningServer } from '../support.js';
import { openConnected } from './tab.js';
import { readFileSync } from 'node:fs';

const VERSION = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version;
/**
 * A version newer than any real release will be for a very long time. Versions are date-based now
 * (`YYYY.M.D-N`; RELEASING.md), so a classic "high version" sentinel like `99.0.0` sorts as
 * *older* than any 2026-or-later date version (99 < 2026) — a far-future year keeps this fixture
 * correct regardless of when the build's own version is bumped.
 */
const NEWER_VERSION = '9999.1.1';

/** Npm's registry with one newer stable version than whatever this build is; GitHub Releases (also asked, story 13.14) has no release. */
function newerRegistry(version: string) {
  const requests: string[] = [];
  return {
    requests,
    fetch: async (url: string) => {
      requests.push(url);
      return url.startsWith('https://registry.npmjs.org/') ? Response.json({ latest: version, next: version }) : new Response('missing', { status: 404 });
    },
  };
}

test('the banner names the newer version, Dismiss keeps it hidden after a reload, and About checks again', async ({ page }) => {
  const dataDir = makeDataDir();
  const registry = newerRegistry(NEWER_VERSION);
  let server: RunningServer | undefined;
  try {
    server = await startServer(dataDir, 0, { updates: { fetch: registry.fetch } });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openConnected(page, '/', server.launchUrl);
    const banner = page.getByTestId('update-banner');
    await expect(banner).toContainText(`Ogden ${NEWER_VERSION} is available.`);
    await expect(banner).toContainText('npx ogden-agents@latest');
    await expect(page.getByTestId('update-status')).toHaveAttribute('role', 'status');
    const githubUrl = VERSION.includes('-') ? 'https://api.github.com/repos/hsmith-dev/ogden-agents/releases?per_page=5' : 'https://api.github.com/repos/hsmith-dev/ogden-agents/releases/latest';
    expect(registry.requests.sort()).toEqual([githubUrl, 'https://registry.npmjs.org/-/package/ogden-agents/dist-tags']);

    await banner.getByRole('button', { name: `Dismiss the notice about Ogden ${NEWER_VERSION}` }).click();
    await expect(banner).toHaveCount(0);
    await page.reload();
    await expect(page.locator('aside[data-slot="sidebar"]')).toBeVisible();
    await expect(page.getByTestId('update-banner')).toHaveCount(0);

    await page.goto(`${server.url}/settings/about`);
    await expect(page.getByTestId('about-version')).toBeVisible();
    await expect(page.getByTestId('about-channel')).not.toBeEmpty();
    await expect(page.getByTestId('about-available')).toContainText(`Ogden ${NEWER_VERSION} is available.`);
    await page.getByTestId('check-now').click();
    await expect(page.getByTestId('check-result')).toHaveText(`Ogden ${NEWER_VERSION} is available.`);
    expect(registry.requests).toHaveLength(4);
    await expect(page.getByTestId('about-sources')).toHaveText('GitHub Releases and npm');
    await expect(page.getByTestId('about-last-checked')).not.toHaveText('Not yet');
  } finally {
    await server?.close();
    removeDataDir(dataDir);
  }
});

test('the switch is saved by the server, and a restart with it off asks npm for nothing', async ({ page }) => {
  const dataDir = makeDataDir();
  const first = newerRegistry(NEWER_VERSION);
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

    const second = newerRegistry(NEWER_VERSION);
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
