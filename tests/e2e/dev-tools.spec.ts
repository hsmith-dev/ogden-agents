/// <reference lib="dom" />
/**
 * Generic developer CLI tools in a real browser (CAP-25, story: generic
 * developer CLI tools detect, install, and sandbox-gate), against a stubbed
 * `DevToolsPort` so nothing real is detected or run: Settings shows the real
 * detected state, Install shows the exact command and runs it for real only
 * on confirmation, a declined confirmation or a failed install leaves it not
 * installed with a plain reason, and a project's unattended-build allowlist
 * is scoped, visible and revocable. Each test runs its own server.
 */
import { expect, test, type Browser } from '@playwright/test';
import type { DevToolDescriptor, DevToolDetection, DevToolRunResult, DevToolsPort } from '@ogden-agents/server';
import { API_ROUTES, makeDataDir, removeDataDir, startServer, type RunningServer } from '../support.js';
import { openConnected, storedToken } from './tab.js';

/** A stub catalog of one tool, driven by hand: never execs to detect, never runs without the server's own confirmed call. */
function stubDevTools(seed: DevToolDescriptor[] = [{ id: 'gcloud', label: 'Google Cloud CLI', source: 'seed', executables: ['gcloud'], installCommand: 'curl -sSL https://sdk.cloud.google.com | bash -s -- --disable-prompts' }]) {
  const installedAt = new Map<string, string>();
  let runs = 0;
  let answer: DevToolRunResult = { ok: true };
  const port: DevToolsPort = {
    seedCatalog: () => seed,
    detect: async (tool): Promise<DevToolDetection> => {
      const path = installedAt.get(tool.id);
      return path === undefined ? { installed: false } : { installed: true, path };
    },
    run: async () => {
      runs++;
      if (answer.ok) installedAt.set('gcloud', '/usr/local/bin/gcloud');
      return answer;
    },
  };
  return { port, runs: () => runs, setAnswer: (next: DevToolRunResult) => (answer = next) };
}

async function withServer(browser: Browser, devToolsPort: DevToolsPort, body: (page: import('@playwright/test').Page, server: RunningServer) => Promise<void>) {
  const dataDir = makeDataDir();
  const server = await startServer(dataDir, 0, { devToolsPort });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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

test('Settings > Developer tools shows real detected state, and Install shows the exact command and runs it only on confirmation, with no terminal', async ({ browser }) => {
  const stub = stubDevTools();
  await withServer(browser, stub.port, async (page) => {
    const sidebar = page.locator('aside[data-slot="sidebar"]');
    await sidebar.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('menuitem', { name: 'Developer tools' }).click();
    await expect(page).toHaveURL(/\/settings\/dev-tools$/);
    await expect(page.getByRole('heading', { name: 'Developer tools', level: 1 })).toBeVisible();

    const row = page.getByTestId('dev-tool-gcloud');
    await expect(row).toContainText('Google Cloud CLI: not installed');
    expect(stub.runs()).toBe(0);

    // Clicking Install shows the exact command, not yet running anything.
    await row.getByTestId('install-gcloud').click();
    const card = page.getByTestId('install-tool-card');
    await expect(card.getByTestId('install-tool-command')).toHaveText('curl -sSL https://sdk.cloud.google.com | bash -s -- --disable-prompts');
    expect(stub.runs()).toBe(0);

    // Cancel: nothing ran.
    await card.getByTestId('install-tool-cancel').click();
    await expect(card).toHaveCount(0);
    expect(stub.runs()).toBe(0);
    await expect(row).toContainText('Google Cloud CLI: not installed');

    // Confirm: runs for real, once, and the tool is then installed.
    await row.getByTestId('install-gcloud').click();
    await page.getByTestId('install-tool-confirm').click();
    await expect(row).toContainText('Google Cloud CLI: installed');
    expect(stub.runs()).toBe(1);
    await expect(row.getByTestId('install-gcloud')).toHaveCount(0);

    // No terminal instructions anywhere on the page, even though the command itself is shown.
    await expect(page.getByTestId('workspace-area')).not.toContainText(/open a terminal|paste (this|it) into (a|your) terminal|run this yourself|\bnpx\b/i);
  });
});

test('a failed real install leaves the tool not installed with a plain reason, and nothing retries by itself', async ({ browser }) => {
  const stub = stubDevTools();
  stub.setAnswer({ ok: false, reason: 'brew: command not found' });
  await withServer(browser, stub.port, async (page) => {
    await page.goto(new URL('/settings/dev-tools', page.url()).href);
    const row = page.getByTestId('dev-tool-gcloud');
    await row.getByTestId('install-gcloud').click();
    await page.getByTestId('install-tool-confirm').click();
    await expect(row).toContainText('Google Cloud CLI: not installed');
    await expect(page.getByTestId('dev-tool-error-gcloud')).toHaveText('brew: command not found');
    expect(stub.runs()).toBe(1);
    // Reloading shows the same real state: nothing retried behind the scenes.
    await page.reload();
    await expect(page.getByTestId('dev-tool-gcloud')).toContainText('Google Cloud CLI: not installed');
    expect(stub.runs()).toBe(1);
  });
});

test("a project's unattended-build allowlist is off by default, visible, scoped, and revocable", async ({ browser }) => {
  const stub = stubDevTools();
  // Already installed on this machine, so chat can already use it; the allowlist still starts off.
  stub.setAnswer({ ok: true });
  await withServer(browser, stub.port, async (page, server) => {
    const origin = new URL(page.url()).origin;
    const token = await storedToken(page);
    const call = (method: string, path: string, body?: unknown) =>
      fetch(`${origin}${path}`, { method, headers: { authorization: `Bearer ${token!}`, origin, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    // Install it for real first (through the catalog route), so it shows installed.
    expect((await call('POST', `${API_ROUTES.devTools}/gcloud/install`, { confirm: true })).status).toBe(200);
    const repo = makeDataDir('ogden-agents-e2e-dev-tools-repo-');
    const wsId = ((await (await call('POST', API_ROUTES.workspaces, { path: repo })).json()) as { workspace: { id: string } }).workspace.id;
    expect((await call('PATCH', `/api/v1/workspaces/${wsId}/settings`, { bmadPieces: ['board', 'builds'] })).status).toBe(200);

    await page.goto(`${server.url}/w/${wsId}/settings`);
    const checkbox = page.getByTestId('dev-tools-allow-gcloud');
    await expect(checkbox).toBeVisible();
    await expect(checkbox).not.toBeChecked();

    await checkbox.click();
    await expect(checkbox).toBeChecked();
    await page.reload();
    await expect(page.getByTestId('dev-tools-allow-gcloud')).toBeChecked();

    // A second, unrelated project never sees this project's allowance (scoped).
    const otherRepo = makeDataDir('ogden-agents-e2e-dev-tools-repo-other-');
    const otherWsId = ((await (await call('POST', API_ROUTES.workspaces, { path: otherRepo })).json()) as { workspace: { id: string } }).workspace.id;
    await call('PATCH', `/api/v1/workspaces/${otherWsId}/settings`, { bmadPieces: ['board', 'builds'] });
    await page.goto(`${server.url}/w/${otherWsId}/settings`);
    await expect(page.getByTestId('dev-tools-allow-gcloud')).not.toBeChecked();

    // Revoke on the first project: off again, visibly.
    await page.goto(`${server.url}/w/${wsId}/settings`);
    await page.getByTestId('dev-tools-allow-gcloud').click();
    await expect(page.getByTestId('dev-tools-allow-gcloud')).not.toBeChecked();
    await page.reload();
    await expect(page.getByTestId('dev-tools-allow-gcloud')).not.toBeChecked();
  });
});

test('an install or allowlist request without a matching Origin is refused by the gate', async ({ browser }) => {
  const stub = stubDevTools();
  await withServer(browser, stub.port, async (page) => {
    const token = await storedToken(page);
    const install = `${new URL(page.url()).origin}${API_ROUTES.devTools}/gcloud/install`;
    const foreign = await page.request.post(install, { headers: { authorization: `Bearer ${token!}`, origin: 'http://evil.example' }, data: { confirm: true } });
    expect(foreign.status()).toBe(403);
    expect((await page.request.post(install, { headers: { origin: new URL(page.url()).origin }, data: { confirm: true } })).status()).toBe(401);
    expect(stub.runs()).toBe(0);
  });
});
