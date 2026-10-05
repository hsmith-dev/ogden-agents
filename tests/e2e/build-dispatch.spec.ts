/// <reference lib="dom" />
/**
 * Stop, Retry and the limits in a real browser (story 5.8): a slow build is
 * stopped from its session's header (Stopped, then Retry), runs again in the
 * same worktree and ends Ready for review after Ogden Agents re-ran the
 * project's tests; a build whose tests fail when re-run ends Failed with the
 * count and has no Approve; Settings, Builds saves the install's limits.
 *
 * Real `git`; a ticket store that reads and writes the plan files (no uv);
 * a fixed sandbox answer that runs the fixture's test command with no
 * sandbox (the test sandbox kind only); no real `claude`, keychain or network.
 */
import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { apiPath } from '../../packages/shared/src/api.ts';
import { FAKE_BMAD_FILES, FAKE_BUILD_PLAN, FAKE_BUILD_REPO_FILES, FAKE_BUILD_WAITING_PLAN, fixtureGit } from '../fixtures/fake-bmad-repo.ts';
import { fixedSandbox } from '../fixtures/fixed-sandbox.ts';
import { createPlanFileTicketStore } from '../fixtures/plan-file-ticket-store.ts';
import { API_ROUTES, serverModule } from '../support.js';
import { withChatServer } from './chat-server.js';
import { storedToken } from './tab.js';

const TICKETS = [
  { ref: '1.1', title: 'Build the thing', plan: FAKE_BUILD_PLAN },
  { ref: '1.2', title: 'Build the next thing', plan: FAKE_BUILD_WAITING_PLAN, after: [1] },
];
const FILES = { ...FAKE_BMAD_FILES, '_bmad/config.toml': '[core]\noutput_folder = "{project-root}/_bmad-output"\n', ...FAKE_BUILD_REPO_FILES };

async function prepare(page: import('@playwright/test').Page, repo: string) {
  fixtureGit(repo, 'init', '-q', '--initial-branch=main');
  fixtureGit(repo, 'config', 'core.autocrlf', 'false');
  fixtureGit(repo, 'config', 'user.name', 'Fixture');
  fixtureGit(repo, 'config', 'user.email', 'fixture@example.com');
  fixtureGit(repo, 'add', '-A');
  fixtureGit(repo, 'commit', '-q', '--no-verify', '-m', 'The fixture');
  const origin = new URL(page.url()).origin;
  const token = await storedToken(page);
  const call = (method: string, path: string, body?: unknown) =>
    fetch(`${origin}${path}`, {
      method,
      headers: { authorization: `Bearer ${token!}`, origin, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const wsId = ((await (await call('POST', API_ROUTES.workspaces, { path: repo })).json()) as { workspace: { id: string } }).workspace.id;
  expect((await call('PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['board', 'builds'] })).status).toBe(200);
  expect((await call('PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }))).status).toBe(200);
  return { call, wsId };
}

test('a build is stopped from its header, retried in the same worktree, and ends Ready for review after the tests were re-run', async ({ page }) => {
  test.setTimeout(120_000);
  const store = createPlanFileTicketStore(TICKETS);
  const bmadSource = (await serverModule()).createMemoryBmadSource({ ready: true });
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const { call, wsId } = await prepare(page, repo);
      const started = (await (await call('POST', apiPath(API_ROUTES.workspaceBuilds, { wsId }), { ref: '1.1' })).json()) as { run: { id: string; worktreePath: string }; session: { id: string } };
      await page.goto(`${server.url}/w/${wsId}/s/${started.session.id}`);
      await expect(page.getByTestId('build-run-outcome')).toHaveText('Building');
      await page.getByTestId('build-run-stop').click();
      await expect(page.getByTestId('build-run-outcome')).toHaveText('Stopped');
      await expect(page.getByTestId('build-run-stop')).toHaveCount(0);
      expect(existsSync(started.run.worktreePath)).toBe(true);
      await page.getByTestId('build-run-retry').click();
      await expect(page.getByTestId('build-run-outcome')).toHaveText('Ready for review', { timeout: 60_000 });
      await expect(page.getByTestId('build-run-retry')).toHaveCount(0);
      // The same run and worktree.
      const runs = (await (await call('GET', apiPath(API_ROUTES.workspaceRuns, { wsId }))).json()) as { runs: Array<{ id: string; worktreePath: string }> };
      expect(runs.runs).toHaveLength(1);
      expect(runs.runs[0]).toMatchObject({ id: started.run.id, worktreePath: started.run.worktreePath });
    },
    { files: FILES, extra: { ticketStore: store as never, bmadSource, sandbox: fixedSandbox({ available: true, kind: 'test' }), extraAgentEnv: { FAKE_ACP_BUILD_DELAY_MS: '4000' } } },
  );
});

test('a build whose tests fail when re-run ends Failed with the count and cannot be approved', async ({ page }) => {
  test.setTimeout(90_000);
  const store = createPlanFileTicketStore(TICKETS);
  const bmadSource = (await serverModule()).createMemoryBmadSource({ ready: true });
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const { call, wsId } = await prepare(page, repo);
      expect((await call('POST', apiPath(API_ROUTES.workspaceBuilds, { wsId }), { ref: '1.1' })).status).toBe(201);
      await page.goto(`${server.url}/w/${wsId}/review/1.1`);
      await expect(page.getByTestId('review-outcome')).toHaveText('Failed', { timeout: 60_000 });
      await expect(page.getByTestId('review-reason')).toContainText('3 tests failed when re-run');
      await expect(page.getByTestId('review-approve')).toHaveCount(0);
    },
    { files: FILES, extra: { ticketStore: store as never, bmadSource, sandbox: fixedSandbox({ available: true, kind: 'test' }), extraAgentEnv: { FAKE_ACP_BUILD_FAIL_TESTS: '1' } } },
  );
});

test('Settings, Builds saves how many builds run at once and the time limit', async ({ page }) => {
  await withChatServer(page, async ({ server }) => {
    await page.goto(`${server.url}/settings/builds`);
    const install = page.getByTestId('run-limit-install');
    await expect(install).toHaveValue('3');
    await expect(page.getByTestId('run-limit-minutes')).toHaveValue('45');
    await install.fill('25');
    await expect(page.getByTestId('run-limit-install-save')).toBeDisabled();
    await install.fill('5');
    await page.getByTestId('run-limit-install-save').click();
    await expect(page.getByTestId('run-limit-install-saved')).toBeVisible();
    await page.getByTestId('run-limit-minutes').fill('90');
    await page.getByTestId('run-limit-minutes-save').click();
    await expect(page.getByTestId('run-limit-minutes-saved')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('run-limit-install')).toHaveValue('5');
    await expect(page.getByTestId('run-limit-minutes')).toHaveValue('90');
  });
});
