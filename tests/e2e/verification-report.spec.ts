/// <reference lib="dom" />
/**
 * Verification reporting in a real browser (story 11.2): a run whose tests
 * fail when re-run shows its failing check and the test output in the run
 * view, the Runs tab, the board card, the detail sheet and the review page;
 * Check again after the fix turns it ready for review; and a project's own
 * test command, saved in Workspace settings, is the one the re-run uses.
 *
 * Real `git`; a ticket store that reads and writes the plan files (no uv); a
 * fixed sandbox answer (the test sandbox kind only); no real `claude`,
 * keychain or network.
 */
import { rmSync } from 'node:fs';
import { join } from 'node:path';
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

async function prepare(page: import('@playwright/test').Page, repo: string, pieces: string[] = ['board', 'builds']) {
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
  expect((await call('PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: pieces })).status).toBe(200);
  expect((await call('PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }))).status).toBe(200);
  return { call, wsId };
}

type Started = { run: { id: string; worktreePath: string }; session: { id: string } };

test('a run whose tests fail shows the failing check and the output everywhere, and Check again after the fix makes it ready', async ({ page }) => {
  test.setTimeout(120_000);
  const store = createPlanFileTicketStore(TICKETS);
  const bmadSource = (await serverModule()).createMemoryBmadSource({ ready: true });
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const { call, wsId } = await prepare(page, repo);
      const started = (await (await call('POST', apiPath(API_ROUTES.workspaceBuilds, { wsId }), { ref: '1.1' })).json()) as Started;
      await page.goto(`${server.url}/w/${wsId}/s/${started.session.id}`);
      await expect(page.getByTestId('build-run-outcome')).toHaveText('Failed', { timeout: 60_000 });
      const checks = page.getByTestId('build-run-checks');
      await expect(checks.locator('[data-check="tests_pass"]')).toHaveAttribute('data-result', 'fail');
      await expect(checks.locator('[data-check="tests_pass"]')).toContainText('3 tests failed when re-run');
      await checks.getByTestId('verification-details-toggle').click();
      await expect(checks.getByTestId('verification-test-output')).toContainText('Tests: 3 failed, 2 passed, 5 total');
      await expect(checks.getByTestId('verification-test-command')).toBeVisible();

      // The Runs tab, the board card and the detail sheet name the failing check.
      await page.getByTestId('workspace-tab-runs').click();
      await expect(page.locator('[data-testid="run-row"][data-ref="1.1"] [data-testid="run-row-reason"]')).toContainText('3 tests failed when re-run');
      await page.goto(`${server.url}/w/${wsId}/board`);
      await expect(page.locator('[data-testid="ticket-card"][data-ref="1.1"]').getByTestId('ticket-build-failure')).toContainText('Build failed: 3 tests failed when re-run');
      await page.locator('[data-testid="ticket-card"][data-ref="1.1"]').click();
      await expect(page.getByTestId('ticket-sheet-build-reason')).toContainText('3 tests failed when re-run');

      // The review page shows the same detail and cannot approve; Check again after the fix turns it ready.
      await page.goto(`${server.url}/w/${wsId}/review/1.1`);
      await expect(page.getByTestId('review-approve')).toHaveCount(0);
      await expect(page.locator('[data-testid="review-check"][data-check="tests_pass"]')).toContainText('3 tests failed when re-run');
      rmSync(join(started.run.worktreePath, '.fake-tests-fail'));
      await page.getByTestId('check-again').click();
      await expect(page.getByTestId('review-outcome')).toHaveText('Ready for review', { timeout: 60_000 });
      await expect(page.getByTestId('review-approve')).toBeEnabled();
      await expect(page.locator('[data-testid="review-check"][data-check="tests_pass"]')).toHaveAttribute('data-result', 'pass');
    },
    { files: FILES, extra: { ticketStore: store as never, bmadSource, sandbox: fixedSandbox({ available: true, kind: 'test' }), extraAgentEnv: { FAKE_ACP_BUILD_FAIL_TESTS: '1' } } },
  );
});

test("a project's own test command is the one Check again uses", async ({ page }) => {
  test.setTimeout(120_000);
  const store = createPlanFileTicketStore(TICKETS);
  const bmadSource = (await serverModule()).createMemoryBmadSource({ ready: true });
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const { call, wsId } = await prepare(page, repo);
      const started = (await (await call('POST', apiPath(API_ROUTES.workspaceBuilds, { wsId }), { ref: '1.1' })).json()) as Started;
      await page.goto(`${server.url}/w/${wsId}/review/1.1`);
      await expect(page.getByTestId('review-outcome')).toHaveText('Failed', { timeout: 60_000 });
      await page.goto(`${server.url}/w/${wsId}/settings`);
      await page.getByTestId('test-command').fill('node --version');
      await page.getByTestId('test-command-save').click();
      await expect(page.getByTestId('test-command-saved')).toBeVisible();
      await page.goto(`${server.url}/w/${wsId}/review/1.1`);
      await page.getByTestId('check-again').click();
      await expect(page.getByTestId('review-outcome')).toHaveText('Ready for review', { timeout: 60_000 });
      await page.getByTestId('verification-details-toggle').click();
      await expect(page.getByTestId('verification-test-command')).toHaveText('node --version');
      void started;
    },
    { files: FILES, extra: { ticketStore: store as never, bmadSource, sandbox: fixedSandbox({ available: true, kind: 'test' }), extraAgentEnv: { FAKE_ACP_BUILD_FAIL_TESTS: '1' } } },
  );
});

test('with Unattended builds off Check again answers feature_off', async ({ page }) => {
  const store = createPlanFileTicketStore(TICKETS);
  const bmadSource = (await serverModule()).createMemoryBmadSource({ ready: true });
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const { call, wsId } = await prepare(page, repo, ['board']);
      void server;
      const response = await call('POST', apiPath(API_ROUTES.runCheckAgain, { wsId, runId: 'run_01J9Z3K4M5N6P7Q8R9S0T1V2W3' }));
      expect(response.status).toBe(409);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe('feature_off');
    },
    { files: FILES, extra: { ticketStore: store as never, bmadSource, sandbox: fixedSandbox({ available: true, kind: 'test' }) } },
  );
});
