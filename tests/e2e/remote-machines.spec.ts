/// <reference lib="dom" />
/**
 * CAP-24, epic 19 story 19.3 in a real browser: Settings, Remote machines.
 * Adding a machine shows it unconfirmed; the blocking host-key card reads
 * the live fingerprint and only confirms on an explicit click; confirming
 * generates and stores a fresh keypair and the machine becomes a one-line
 * record whose public key is shown on request; a changed host key is
 * refused outright, in plain words, never silently re-pinned; Remove
 * deletes the machine and its stored credential. The page makes no
 * request to any server itself. No real SSH network, remote machine or
 * real OS keychain is used: the server is started with the fake
 * `remote-host-memory` port and the in-memory secret store.
 */
import { expect, test, type Page } from '@playwright/test';
import { makeDataDir, removeDataDir, serverModule, startServer } from '../support.js';
import { openConnected } from './tab.js';

const page$ = (page: Page) => page.getByTestId('remote-machines-settings-page');

async function setUp() {
  const dataDir = makeDataDir();
  const { createMemoryRemoteHostPort, createMemorySecretStore } = await serverModule();
  const hosts = createMemoryRemoteHostPort();
  const secrets = createMemorySecretStore();
  const server = await startServer(dataDir, 0, { remoteHost: hosts, secrets });
  return { dataDir, server, hosts, secrets };
}

test('add a machine, confirm its host key, see its public key on request, and remove it', async ({ page }) => {
  test.setTimeout(120_000);
  const { dataDir, server, hosts } = await setUp();
  const foreign: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== new URL(server.url).origin && url.protocol.startsWith('http')) foreign.push(request.url());
  });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openConnected(page, '/settings/remote-machines', server.launchUrl);
    await expect(page$(page).getByTestId('remote-machines-empty')).toBeVisible();

    await page$(page).getByTestId('remote-machine-add-other').click();
    await page$(page).getByLabel('Name', { exact: true }).fill('Build bench');
    await page$(page).getByLabel('Host name or IP address').fill('bench.local');
    await page$(page).getByLabel('Username').fill('ada');
    hosts.setFingerprint('bench.local', 22, 'fp-e2e-live');
    await page$(page).getByTestId('remote-machine-submit').click();

    const card = page$(page).getByTestId('host-key-confirm-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText('fp-e2e-live');
    await expect(card).toContainText('not confirmed yet');
    const confirmButton = card.getByTestId('host-key-confirm-button');
    // No button is focused by default.
    await expect(confirmButton).not.toBeFocused();
    await confirmButton.click();

    const row = page$(page).getByTestId('remote-machine-row');
    await expect(row).toBeVisible();
    await expect(row).toContainText('Build bench');
    await expect(row).toContainText('Confirmed');
    await expect(page$(page).getByTestId('host-key-confirm-card')).toHaveCount(0);

    // The public key is available on request, not shown by default.
    await expect(row.getByText(/ssh-ed25519/)).toHaveCount(0);
    await row.getByTestId('remote-machine-show-key').click();
    await expect(row.getByText(/^ssh-ed25519 /)).toBeVisible();

    await row.getByTestId('remote-machine-remove').click();
    await expect(page$(page).getByTestId('remote-machines-empty')).toBeVisible();

    // The page itself never contacted a server: only Ogden Agents' own.
    expect(foreign).toEqual([]);
  } finally {
    await server.close();
    removeDataDir(dataDir);
  }
});

test('a host key that changed since it was shown is refused outright, in plain words, and pins nothing', async ({ page }) => {
  test.setTimeout(120_000);
  const { dataDir, server, hosts } = await setUp();
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openConnected(page, '/settings/remote-machines', server.launchUrl);
    await page$(page).getByTestId('remote-machine-add-other').click();
    await page$(page).getByLabel('Name', { exact: true }).fill('Office box');
    await page$(page).getByLabel('Host name or IP address').fill('office');
    await page$(page).getByLabel('Username').fill('u');
    hosts.setFingerprint('office', 22, 'fp-shown');
    await page$(page).getByTestId('remote-machine-submit').click();

    const card = page$(page).getByTestId('host-key-confirm-card');
    await expect(card).toContainText('fp-shown');
    // The key changes between showing it and confirming: a man-in-the-middle, or a real reinstall.
    hosts.setFingerprint('office', 22, 'fp-attacker');
    await card.getByTestId('host-key-confirm-button').click();

    await expect(card.getByTestId('host-key-confirm-error')).toBeVisible();
    await expect(page$(page).getByTestId('remote-machine-row')).toHaveCount(0);
    // Still unconfirmed, never silently re-pinned to the new key.
    await expect(card).toBeVisible();
  } finally {
    await server.close();
    removeDataDir(dataDir);
  }
});
