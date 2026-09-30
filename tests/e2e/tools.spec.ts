/// <reference lib="dom" />
/**
 * Settings > Tools in a real browser (story 1.8), against a stubbed
 * toolchain so nothing is downloaded: the uv status, a one-click install with
 * progress streamed through the event log, a plain failure with Try again,
 * and a uv already on the computer. Each test runs its own server.
 */
import { expect, test, type Browser } from '@playwright/test';
import type { DetectedToolStatus, ToolchainPort, ToolProgress } from '@ogden-agents/server';
import { makeDataDir, removeDataDir, serverModule, startServer, type RunningServer } from './server.js';
import { openConnected } from './tab.js';

/** A stub port whose install waits for the test to let it finish. */
function stubToolchain(initial: DetectedToolStatus, outcome: 'ok' | 'hash_mismatch', ToolchainError: typeof import('@ogden-agents/server').ToolchainError) {
  let detected = initial;
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let installs = 0;
  const port: ToolchainPort = {
    uvVersion: '0.12.21',
    status: async () => detected,
    installUv: async (onProgress: (progress: ToolProgress) => void) => {
      installs++;
      onProgress({ bytes: 0, total: 17_000_000 });
      onProgress({ bytes: 8_500_000, total: 17_000_000 });
      await released;
      onProgress({ bytes: 17_000_000, total: 17_000_000 });
      if (outcome === 'hash_mismatch') {
        throw new ToolchainError('hash_mismatch', "The download didn't match the expected file, so nothing was installed. Try again.", {
          details: { target: 'x86_64-unknown-linux-gnu', expected: 'a'.repeat(64), actual: 'b'.repeat(64) },
        });
      }
      detected = { state: 'ready', version: '0.12.21', source: 'private' };
      return { version: '0.12.21' };
    },
  };
  return { port, release, installs: () => installs };
}

async function withServer(
  browser: Browser,
  toolchain: ToolchainPort,
  body: (page: import('@playwright/test').Page, server: RunningServer) => Promise<void>,
  width = 1440,
) {
  const dataDir = makeDataDir();
  const server = await startServer(dataDir, 0, { toolchain });
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  try {
    const page = await context.newPage();
    await openConnected(page, '/', server.launchUrl);
    await body(page, server);
  } finally {
    await context.close();
    await server.close();
    removeDataDir(dataDir);
  }
}

test('Install in Settings > Tools downloads with progress and ends ready, with no terminal', async ({ browser }) => {
  const { ToolchainError } = await serverModule();
  const stub = stubToolchain({ state: 'missing' }, 'ok', ToolchainError);
  await withServer(browser, stub.port, async (page) => {
    // Reached from the sidebar's Settings menu.
    const sidebar = page.locator('aside[data-slot="sidebar"]');
    await sidebar.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('menuitem', { name: 'Tools' }).click();
    await expect(page).toHaveURL(/\/settings\/tools$/);
    await expect(page.getByRole('heading', { name: 'Tools', level: 1 })).toBeVisible();

    const status = page.getByTestId('uv-status');
    await expect(status).toHaveAttribute('data-state', 'missing');
    await expect(status).toContainText('Not installed');
    // Nothing downloads until the user asks.
    expect(stub.installs()).toBe(0);

    await status.getByRole('button', { name: 'Install uv' }).click();
    await expect(status).toHaveAttribute('data-state', 'installing');
    await expect(status.getByRole('progressbar', { name: 'Downloading uv' })).toBeVisible();
    await expect(status).toContainText('Downloaded 8.5 of 17.0 MB');
    await expect(status.getByRole('button', { name: 'Installing...' })).toBeVisible();
    expect(stub.installs()).toBe(1);

    stub.release();
    await expect(status).toHaveAttribute('data-state', 'ready');
    await expect(status).toContainText('Ready: uv 0.12.21, installed by Ogden Agents');
    await expect(status.getByRole('button')).toHaveCount(0);
    // No terminal instructions anywhere on the page.
    await expect(page.getByTestId('workspace-area')).not.toContainText(/terminal|npx|curl/i);
  });
});

test('a download that does not match its pinned hash shows a plain failure and Try again', async ({ browser }) => {
  const { ToolchainError } = await serverModule();
  const stub = stubToolchain({ state: 'missing' }, 'hash_mismatch', ToolchainError);
  await withServer(browser, stub.port, async (page) => {
    await page.goto(new URL('/settings/tools', page.url()).href);
    const status = page.getByTestId('uv-status');
    await status.getByRole('button', { name: 'Install uv' }).click();
    await expect(status).toHaveAttribute('data-state', 'installing');
    stub.release();

    await expect(status).toHaveAttribute('data-state', 'failed');
    await expect(page.getByTestId('uv-failed')).toContainText("The download didn't match the expected file, so nothing was installed.");
    await expect(status.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});

test('a uv already on this computer shows ready and offers no install; a too-old one explains why', async ({ browser }) => {
  const { ToolchainError } = await serverModule();
  const system = stubToolchain({ state: 'ready', version: '0.12.19', source: 'system' }, 'ok', ToolchainError);
  await withServer(browser, system.port, async (page) => {
    await page.goto(new URL('/settings/tools', page.url()).href);
    const status = page.getByTestId('uv-status');
    await expect(status).toContainText('Ready: uv 0.12.19, found on this computer');
    await expect(status.getByRole('button')).toHaveCount(0);
  });

  const old = stubToolchain({ state: 'missing', reason: 'Your uv is older than 0.12 (this computer has 0.4.0).' }, 'ok', ToolchainError);
  await withServer(
    browser,
    old.port,
    async (page) => {
      await page.goto(new URL('/settings/tools', page.url()).href);
      const status = page.getByTestId('uv-status');
      await expect(status).toContainText('Your uv is older than 0.12');
      await expect(status.getByRole('button', { name: 'Install uv' })).toBeVisible();
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    },
    390,
  );
});

test('an install request without a matching Origin is refused by the gate', async ({ browser }) => {
  const { ToolchainError } = await serverModule();
  const stub = stubToolchain({ state: 'missing' }, 'ok', ToolchainError);
  await withServer(browser, stub.port, async (page, server) => {
    // The tab's own token, but another site's Origin: refused (403).
    const token = await page.evaluate(() => sessionStorage.getItem('ogden-agents.tab-token'));
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const install = `${server.url}/api/v1/toolchain/uv/install`;
    const foreign = await page.request.post(install, { headers: { authorization: `Bearer ${token}`, origin: 'http://evil.example' } });
    expect(foreign.status()).toBe(403);
    // What a cross-site form or another local server could send: no token at all (401).
    expect((await page.request.post(install, { headers: { origin: server.url } })).status()).toBe(401);
    expect(stub.installs()).toBe(0);
  });
});
