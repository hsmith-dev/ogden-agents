/// <reference lib="dom" />
/**
 * Epic 14 story 14.11, the whole Local model journey in a real browser: add a
 * server from a preset in Settings, Test connection, start a Local model chat
 * from the agent picker, get a reply, hold a command for its card (Allow once,
 * then Deny), see Auto and Skip all unavailable with the reason, and leave no
 * request on any server but the test's own fake one on this computer. The
 * harness is the fake agent's OpenCode personality and the model server is
 * the fake OpenAI-compatible one. No real model, harness, key or network.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { startFakeServer } from '../fixtures/fake-openai-server.mjs';
import { apiPath } from '../../packages/shared/src/api.ts';
import { API_ROUTES, fakeAgentSetup, makeDataDir, removeDataDir, ROOT, serverModule, startServer } from '../support.js';
import { openConnected, storedToken } from './tab.js';

const FAKE_OPENCODE = join(ROOT, 'tests', 'fixtures', 'fake-opencode.mjs');

test('add a server, test it, chat, allow and deny a command, and Auto and Skip all stay unavailable', async ({ page }) => {
  test.setTimeout(120_000);
  const fake = await startFakeServer({ models: ['fake-small', 'fake-large'] });
  const dataDir = makeDataDir();
  const repo = mkdtempSync(join(tmpdir(), 'ogden-agents-e2e-local-repo-'));
  const { createLocalAgent } = await serverModule();
  const setup = await fakeAgentSetup({ agentId: 'local', displayName: 'Local model', installed: true, auth: 'signed_in' });
  const server = await startServer(dataDir, 0, {
    local: {
      agent: createLocalAgent({ dataDir, server: () => ({ command: process.execPath, args: [FAKE_OPENCODE] }) }),
      setup: { ...setup, status: async () => ({ ...(await setup.status()), noAccount: true }) },
    },
    endpointPresets: [{ id: 'up', label: 'Server Up', baseUrl: `http://localhost:${fake.port}/v1`, downloadUrl: 'https://example.com/up' }],
  });
  const foreign: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== new URL(server.url).origin && url.protocol.startsWith('http')) foreign.push(request.url());
  });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openConnected(page, '/settings/agents', server.launchUrl);
    const card = page.getByTestId('agent-card-local');

    // Add the preset and test it.
    await card.getByTestId('endpoint-detect').click();
    await card.getByRole('button', { name: 'Use it' }).click();
    await card.getByTestId('endpoint-add-submit').click();
    await card.getByTestId('endpoint-test').click();
    await expect(card.getByTestId('endpoint-test-result')).toHaveText('Ready. 2 models are available.');

    // A chat on the Local model, started the way the app does.
    const origin = new URL(page.url()).origin;
    const token = await storedToken(page);
    const post = async (path: string, body: unknown) => {
      const response = await fetch(`${origin}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(`POST ${path} returned ${response.status}: ${await response.text()}`);
      return (await response.json()) as Record<string, { id: string }>;
    };
    const wsId = (await post(API_ROUTES.workspaces, { path: repo })).workspace!.id;
    const sesId = (await post(apiPath(API_ROUTES.workspaceSessions, { wsId }), { agentId: 'local' })).session!.id;
    await page.goto(`${origin}/w/${wsId}/s/${sesId}`);
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
    const box = page.getByRole('textbox', { name: 'Message Local model' });

    await box.fill('hello');
    await box.press('Enter');
    await expect(page.getByTestId('message-agent').last()).toContainText('Hello from the fake model.');
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');

    // A command waits for its card: Allow once runs it, Deny does not.
    await box.fill('please run echo hi');
    await box.press('Enter');
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'waiting');
    await expect(page.getByTestId('permission-command')).toContainText('echo hi');
    await page.getByRole('button', { name: 'Allow once' }).click();
    await expect(page.getByTestId('message-agent').last()).toContainText('ran(once): echo hi');
    await box.fill('please run echo hi');
    await box.press('Enter');
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'waiting');
    await page.getByRole('button', { name: 'Deny' }).click();
    await expect(page.getByTestId('message-agent').last()).toContainText('rejected permission');

    // Auto is never offered, with the reason; Skip all is not offered at all.
    await page.getByTestId('permission-mode-picker').click();
    await expect(page.getByTestId('permission-mode-auto')).toHaveAttribute('data-disabled', '');
    await expect(page.getByTestId('permission-mode-auto')).toContainText('every command and file change asks first');
    await expect(page.getByTestId('permission-mode-skip_all')).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Only the fake server on this computer was ever reached, by Ogden and by the harness.
    expect(foreign).toEqual([]);
    expect(fake.log.every((entry) => entry.host?.startsWith('localhost:') === true || entry.host?.startsWith('127.0.0.1:') === true)).toBe(true);
  } finally {
    await server.close();
    await fake.close();
    removeDataDir(dataDir);
    removeDataDir(repo);
  }
});
