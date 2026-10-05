/// <reference lib="dom" />
/**
 * Epic 14 story 14.4 in a real browser: the Local model's card in Settings,
 * Agents. It needs no account, Detect looks only at the presets' ports and
 * only when pressed (here the test's own fake server and a closed port, never
 * the real 1234 or 11434), a preset or Detect result fills the form, a server
 * on this computer needs no confirmation, another host shows where messages
 * go and waits for the confirmation, plain http warns, a key is sent once and
 * never shown again, and the page makes no request to any server itself. No
 * real model server, key, keychain or network is used.
 */
import { expect, test, type Page } from '@playwright/test';
import { startFakeServer, type FakeServer } from '../fixtures/fake-openai-server.mjs';
import { fakeAgentSetup, makeDataDir, removeDataDir, startServer } from '../support.js';
import { openConnected } from './tab.js';

const card = (page: Page) => page.getByTestId('agent-card-local');
const KEY = 'sk-e2e-dummy-key-5521aa';

async function closedPort(): Promise<number> {
  const server = await startFakeServer();
  const { port } = server;
  await server.close();
  return port;
}

async function setUp(fake: FakeServer, down: number) {
  const dataDir = makeDataDir();
  const setup = await fakeAgentSetup({ agentId: 'local', displayName: 'Local model', installed: true, auth: 'signed_in' });
  const server = await startServer(dataDir, 0, {
    local: { setup: { ...setup, status: async () => ({ ...(await setup.status()), noAccount: true }) } },
    endpointPresets: [
      { id: 'up', label: 'Server Up', baseUrl: `http://localhost:${fake.port}/v1`, downloadUrl: 'https://example.com/up' },
      { id: 'down', label: 'Server Down', baseUrl: `http://localhost:${down}/v1`, downloadUrl: 'https://example.com/down' },
    ],
  });
  return { dataDir, server };
}

test('the Local model card: no account, Detect, a preset, Test connection, a key, and another host with its confirmation', async ({ page }) => {
  test.setTimeout(120_000);
  const fake = await startFakeServer({ models: ['m1', 'm2'] });
  const down = await closedPort();
  const { dataDir, server } = await setUp(fake, down);
  // The page must only ever talk to Ogden Agents' own server.
  const foreign: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== new URL(server.url).origin && url.protocol.startsWith('http')) foreign.push(request.url());
  });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openConnected(page, '/settings/agents', server.launchUrl);
    await expect(card(page).getByTestId('agent-state')).toContainText('Installed, no account needed');
    await expect(card(page).getByRole('button', { name: /Sign in/ })).toHaveCount(0);
    await expect(card(page).getByTestId('endpoint-none')).toBeVisible();
    // Nothing was probed by loading the page.
    expect(fake.log).toEqual([]);

    // Detect: nothing listening on the down port, the fake on the up port.
    await card(page).getByTestId('endpoint-detect').click();
    await expect(card(page).getByTestId('endpoint-detect-found')).toContainText('Found Server Up on this computer, with 2 models.');
    expect(fake.log.map((entry) => entry.path)).toEqual(['/v1/models']);
    await card(page).getByRole('button', { name: 'Use it' }).click();
    await expect(card(page).getByTestId('endpoint-privacy')).toHaveText('This server runs on this computer. Nothing leaves it except to this server.');
    await card(page).getByTestId('endpoint-add-submit').click();
    await expect(card(page).getByTestId('endpoint-label')).toHaveText('Server Up');
    await card(page).getByTestId('endpoint-test').click();
    await expect(card(page).getByTestId('endpoint-test-result')).toHaveText('Ready. 2 models are available.');

    // A server that is not running: its test says so, and Detect with only that one shows the download pages.
    await card(page).getByTestId('endpoint-add-other').click();
    await card(page).getByLabel('Name').fill('Stopped one');
    await card(page).getByLabel('Server address').fill(`http://127.0.0.1:${down}/v1`);
    await card(page).getByLabel(/^Key/).fill(KEY);
    await card(page).getByTestId('endpoint-add-submit').click();
    const stopped = card(page).locator('[data-testid^="endpoint-lep_"]').filter({ hasText: 'Stopped one' });
    await expect(stopped).toBeVisible();
    await stopped.getByTestId('endpoint-test').click();
    await expect(stopped.getByTestId('endpoint-test-result')).toHaveText('Not running. Start the server, then test again.');
    // The key was sent once and is never shown again.
    await expect(stopped.getByTestId('endpoint-key-saved')).toHaveText("Key saved in this computer's keychain.");
    await stopped.getByRole('button', { name: 'Remove key' }).click();
    await expect(stopped.getByRole('button', { name: 'Add a key' })).toBeVisible();

    // Another host: where messages go, the http warning, and no Add until confirmed. Nothing is called.
    await card(page).getByTestId('endpoint-add-other').click();
    await card(page).getByLabel('Name').fill('Office gateway');
    await card(page).getByLabel('Server address').fill('http://192.168.1.20:8000/v1');
    await expect(card(page).getByTestId('endpoint-confirm')).toContainText('http://192.168.1.20:8000');
    await expect(card(page).getByTestId('endpoint-confirm')).toContainText('plain http');
    // Not added until confirmed.
    await expect(card(page).getByTestId('endpoint-add-submit')).toHaveAttribute('aria-disabled', 'true');
    await expect(card(page).locator('[data-testid^="endpoint-lep_"]').filter({ hasText: 'Office gateway' })).toHaveCount(0);
    await card(page).getByRole('checkbox').click();
    await card(page).getByTestId('endpoint-add-submit').click();
    const gateway = card(page).locator('[data-testid^="endpoint-lep_"]').filter({ hasText: 'Office gateway' });
    await expect(gateway).toBeVisible();
    await expect(gateway.getByTestId('endpoint-privacy')).toContainText('plain http');
    await expect(gateway.getByTestId('endpoint-needs-confirmation')).toHaveCount(0);

    // The page itself never contacted a server: only Ogden Agents' own.
    expect(foreign).toEqual([]);
    // And only the probes the buttons asked for reached the fake server.
    expect(fake.log.map((entry) => entry.path)).toEqual(['/v1/models', '/v1/models']);
  } finally {
    await server.close();
    await fake.close();
    removeDataDir(dataDir);
  }
});

test('Detect with nothing running says so and links the official download pages', async ({ page }) => {
  const fake = await startFakeServer();
  const upPort = fake.port;
  await fake.close();
  const down = await closedPort();
  const dataDir = makeDataDir();
  const setup = await fakeAgentSetup({ agentId: 'local', displayName: 'Local model', installed: true, auth: 'signed_in' });
  const server = await startServer(dataDir, 0, {
    local: { setup: { ...setup, status: async () => ({ ...(await setup.status()), noAccount: true }) } },
    endpointPresets: [
      { id: 'up', label: 'Server Up', baseUrl: `http://localhost:${upPort}/v1`, downloadUrl: 'https://example.com/up' },
      { id: 'down', label: 'Server Down', baseUrl: `http://localhost:${down}/v1`, downloadUrl: 'https://example.com/down' },
    ],
  });
  try {
    await page.setViewportSize({ width: 390, height: 800 });
    await openConnected(page, '/settings/agents', server.launchUrl);
    await card(page).getByTestId('endpoint-detect').click();
    await expect(card(page).getByTestId('endpoint-detect-none')).toContainText('No server found on this computer.');
    await expect(card(page).getByTestId('endpoint-download-up')).toHaveAttribute('href', 'https://example.com/up');
    await expect(card(page).getByTestId('endpoint-download-down')).toHaveText('Get Server Down');
    // No sideways scroll at phone width.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await server.close();
    removeDataDir(dataDir);
  }
});

test('Show models lists what the server reports with its cautions, and Use for new chats chooses one', async ({ page }) => {
  const fake = await startFakeServer({ models: ['fake-small', 'fake-large'] });
  const dataDir = makeDataDir();
  const setup = await fakeAgentSetup({ agentId: 'local', displayName: 'Local model', installed: true, auth: 'signed_in' });
  const server = await startServer(dataDir, 0, {
    local: { setup: { ...setup, status: async () => ({ ...(await setup.status()), noAccount: true }) } },
    // The preset id is what makes the server read the sizes and context from the native API.
    endpointPresets: [{ id: 'ollama', label: 'Preset One', baseUrl: `http://localhost:${fake.port}/v1`, downloadUrl: 'https://example.com/one' }],
  });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openConnected(page, '/settings/agents', server.launchUrl);
    await card(page).getByTestId('endpoint-preset-ollama').click();
    await card(page).getByTestId('endpoint-add-submit').click();
    await expect(card(page).getByTestId('endpoint-label')).toHaveText('Preset One');
    await card(page).getByTestId('endpoint-show-models').click();
    const small = card(page).getByTestId('endpoint-model-fake-small');
    await expect(small).toContainText('fake-small (7B, 4 GB, 4k context)');
    await expect(small.getByTestId('endpoint-model-caution')).toHaveCount(3);
    const large = card(page).getByTestId('endpoint-model-fake-large');
    await expect(large).toContainText('32k context');
    await large.getByRole('button', { name: 'Use fake-large for new chats' }).click();
    await expect(card(page).getByTestId('endpoint-chosen-model')).toHaveText('New chats start on fake-large.');
    await expect(large).toContainText('Used for new chats');
  } finally {
    await server.close();
    await fake.close();
    removeDataDir(dataDir);
  }
});
