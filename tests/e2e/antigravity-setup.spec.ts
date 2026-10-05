/// <reference lib="dom" />
/**
 * Epic 6 entry 7 in a real browser: Settings: Agents installs Antigravity
 * from a local fixture archive (served on 127.0.0.1 under its own pin),
 * signs in with Google through the fake agent's Antigravity personality
 * (the browser's visit to `https://accounts.google.com/**` is routed to a
 * stand-in page that approves it), signs out, and uninstalls; the chat
 * picker follows. A computer with no pinned archive is told so. No test
 * reaches Google, runs the real server or touches the keychain.
 */
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { zip } from '../../packages/adapters/test/archives.ts';
import { FAKE_ANTIGRAVITY, makeDataDir, removeDataDir, serverModule, startServer } from '../support.js';
import { openConnected } from './tab.js';

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

async function serveArchive(archive: Buffer): Promise<{ url: string; server: Server }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-length': archive.length, etag: '"fixture"' });
    res.end(archive);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/agy.zip`, server };
}

/** Antigravity's real setup and chat ports on `dataDir`, its archive a local fixture, its server the fake. */
async function fixtureAntigravity(dataDir: string, platform?: string) {
  const { createAntigravityAgent, createAntigravitySetup, antigravityPlatform, pinnedAntigravityServer, agentHomeDir } = await serverModule();
  const files = { 'agy_acp_server.par': randomBytes(40_000), localharness_external: randomBytes(500) };
  const archive = zip(Object.entries(files).map(([name, data]) => ({ name, data })));
  const served = await serveArchive(archive);
  const pins = {
    registry: 'antigravity-acp',
    version: '1.3.0',
    archives: {
      [antigravityPlatform()]: {
        url: served.url,
        sha256: sha256(archive),
        size: archive.length,
        binary: 'agy_acp_server.par',
        args: [],
        files: Object.fromEntries(Object.entries(files).map(([name, data]) => [name, { size: data.length, sha256: sha256(data) }])),
      },
    },
  };
  const fake = { command: process.execPath, args: [FAKE_ANTIGRAVITY] };
  const home = agentHomeDir(dataDir, 'antigravity');
  return {
    home,
    served,
    ports: {
      agent: createAntigravityAgent({ dataDir, server: () => (pinnedAntigravityServer(dataDir, antigravityPlatform(), pins) === undefined ? undefined : fake) }),
      setup: createAntigravitySetup({
        dataDir,
        pins,
        homeDir: home,
        ...(platform === undefined ? {} : { platform: platform as ReturnType<typeof antigravityPlatform> }),
        env: () => ({ PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '' }),
        serverCommand: () => fake,
        apiKey: { verify: async () => 'ok' },
      }),
    },
  };
}

async function withAntigravity(page: Page, body: (home: string) => Promise<void>, platform?: string) {
  const dataDir = makeDataDir();
  const fixture = await fixtureAntigravity(dataDir, platform);
  const server = await startServer(dataDir, 0, { antigravity: fixture.ports });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openConnected(page, '/settings/agents', server.launchUrl);
    await body(fixture.home);
  } finally {
    await server.close();
    fixture.served.server.close();
    removeDataDir(dataDir);
  }
}

const card = (page: Page) => page.getByTestId('agent-card-antigravity');

test('Install, Sign in with Google, Sign out and Uninstall from Settings: Agents', async ({ page, context }) => {
  test.setTimeout(120_000);
  await withAntigravity(page, async (home) => {
    // The stand-in Google page: visiting it is the user approving.
    await context.route('https://accounts.google.com/**', (route) => {
      writeFileSync(join(home, 'fake-google-consent'), '');
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Google</title><p>Signed in. You can close this tab.</p>' });
    });

    await expect(card(page).getByTestId('agent-state')).toContainText('Not installed');
    await expect(card(page).getByTestId('agent-install-note')).toContainText('~/.gemini/antigravity/bin');
    await card(page).getByRole('button', { name: 'Install' }).click();
    await expect(card(page).getByTestId('agent-state')).toContainText('Installed, needs sign-in', { timeout: 60_000 });
    await expect(card(page).getByTestId('agent-version')).toHaveText('Version 1.3.0');
    await expect(card(page).getByTestId('agent-sign-in-note')).toContainText('browser on this computer');

    await card(page).getByRole('button', { name: 'Sign in with your account' }).click();
    await expect(card(page)).toContainText('Finish signing in in the tab that just opened.');
    await expect(card(page).getByLabel('Paste the code')).toHaveCount(0);
    if (process.platform === 'win32') {
      // Windows: Antigravity opens the browser itself; the card offers the link.
      await expect(card(page).getByRole('link', { name: 'Open the sign-in page' })).toHaveAttribute('href', /^https:\/\/accounts\.google\.com\//);
      writeFileSync(join(home, 'fake-google-consent'), '');
    }
    await expect(card(page).getByTestId('agent-state')).toContainText('Installed, signed in', { timeout: 30_000 });

    await card(page).getByRole('button', { name: 'Sign out' }).click();
    await expect(card(page).getByTestId('agent-state')).toContainText('Installed, needs sign-in', { timeout: 30_000 });

    await card(page).getByRole('button', { name: 'Uninstall' }).click();
    await card(page).getByRole('group', { name: 'Uninstall Antigravity?' }).getByRole('button', { name: 'Uninstall' }).click();
    await expect(card(page).getByTestId('agent-state')).toContainText('Not installed');
    await expect(card(page).getByRole('button', { name: 'Install' })).toBeVisible();
  });
});

test('a computer with no pinned archive is told so, with no Install', async ({ page }) => {
  await withAntigravity(
    page,
    async () => {
      await expect(card(page).getByTestId('agent-unavailable')).toContainText("Antigravity isn't available on this computer.");
      await expect(card(page).getByRole('button', { name: 'Install' })).toHaveCount(0);
    },
    process.arch === 'arm64' && process.platform === 'linux' ? 'darwin-x64' : 'linux-arm64',
  );
});
