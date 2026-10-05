/// <reference lib="dom" />
/**
 * The live run view and the Runs tab in a real browser (story 11.1): a
 * blocked run's sentence with its code behind Show details and Retry, an
 * intent gap's Apply the saved fix and retry (the fixture's patch applied in
 * the worktree), the Runs tab and `g r` with every run and its outcome, and
 * neither the tab, `g r` nor the page with Unattended builds off.
 *
 * Real `git`; a ticket store that reads and writes the plan files (no uv); a
 * fixed sandbox answer (the test sandbox kind only); no real `claude`,
 * keychain or network.
 */
import { existsSync, readFileSync } from 'node:fs';
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

test('a blocked run shows its sentence, its code behind Show details and Retry, and the Runs tab lists it', async ({ page }) => {
  test.setTimeout(120_000);
  const store = createPlanFileTicketStore(TICKETS);
  const bmadSource = (await serverModule()).createMemoryBmadSource({ ready: true });
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const { call, wsId } = await prepare(page, repo);
      const started = (await (await call('POST', apiPath(API_ROUTES.workspaceBuilds, { wsId }), { ref: '1.1' })).json()) as Started;
      await page.goto(`${server.url}/w/${wsId}/s/${started.session.id}`);
      await expect(page.getByTestId('build-run-outcome')).toHaveText('Blocked', { timeout: 60_000 });
      await expect(page.getByTestId('build-run-agent')).toHaveText('Claude Code');
      await expect(page.getByTestId('build-run-sandbox')).toBeVisible();
      await expect(page.getByTestId('build-run-reason')).toHaveText('The build stopped. Show details says why.');
      await expect(page.getByTestId('build-run-apply-fix')).toHaveCount(0);
      await expect(page.getByTestId('build-run-code')).toHaveCount(0);
      await page.getByTestId('build-run-details-toggle').click();
      await expect(page.getByTestId('build-run-code')).toHaveText('other');
      await expect(page.getByTestId('build-run-raw-reason')).toContainText('The fake agent was told to block.');

      // The Runs tab (`g r`) lists the run with its outcome and opens the run view.
      await page.getByTestId('workspace-tab-runs').click();
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/runs$`));
      const row = page.locator('[data-testid="run-row"][data-ref="1.1"]');
      await expect(row).toHaveAttribute('data-phase', 'needs_you');
      await expect(row.getByTestId('run-row-phase')).toHaveText('Blocked');
      await expect(row.getByTestId('run-row-reason')).toContainText('The build stopped');
      await page.goto(`${server.url}/w/${wsId}`);
      await expect(page.getByTestId('workspace-tab-runs')).toBeVisible();
      await page.keyboard.press('g');
      await page.keyboard.press('r');
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/runs$`));
      await row.getByTestId('run-row-open').click();
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/s/${started.session.id}$`));

      // Retry starts the same run's agent again.
      await page.getByTestId('build-run-retry').click();
      await expect.poll(async () => ((await (await call('GET', apiPath(API_ROUTES.workspaceRuns, { wsId }))).json()) as { runs: unknown[] }).runs.length).toBe(1);
    },
    { files: FILES, extra: { ticketStore: store as never, bmadSource, sandbox: fixedSandbox({ available: true, kind: 'test' }), extraAgentEnv: { FAKE_ACP_BUILD_OUTCOME: 'blocked' } } },
  );
});

test('an intent gap offers Apply the saved fix and retry, which applies the patch in the worktree', async ({ page }) => {
  test.setTimeout(120_000);
  const store = createPlanFileTicketStore(TICKETS);
  const bmadSource = (await serverModule()).createMemoryBmadSource({ ready: true });
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const { call, wsId } = await prepare(page, repo);
      const started = (await (await call('POST', apiPath(API_ROUTES.workspaceBuilds, { wsId }), { ref: '1.1' })).json()) as Started;
      await page.goto(`${server.url}/w/${wsId}/s/${started.session.id}`);
      await expect(page.getByTestId('build-run-outcome')).toHaveText('Blocked', { timeout: 60_000 });
      await expect(page.getByTestId('build-run-reason')).toContainText('A fix was saved');
      const fix = join(started.run.worktreePath, 'src', 'fix-1.1.txt');
      expect(existsSync(fix)).toBe(false);
      await page.getByTestId('build-run-apply-fix').click();
      await expect.poll(() => existsSync(fix), { timeout: 30_000 }).toBe(true);
      expect(readFileSync(fix, 'utf8')).toContain('Fixed 1.1 by the saved patch.');
      // The same run goes on (the fake agent halts again, as its switch says: only the patch is asserted).
      const runs = (await (await call('GET', apiPath(API_ROUTES.workspaceRuns, { wsId }))).json()) as { runs: Array<{ id: string }> };
      expect(runs.runs).toHaveLength(1);
      expect(runs.runs[0]!.id).toBe(started.run.id);
    },
    { files: FILES, extra: { ticketStore: store as never, bmadSource, sandbox: fixedSandbox({ available: true, kind: 'test' }), extraAgentEnv: { FAKE_ACP_BUILD_HALT: 'intent gap: what should it say?' } } },
  );
});

test('with Unattended builds off there is no Runs tab, no g r and the Runs page says so', async ({ page }) => {
  const store = createPlanFileTicketStore(TICKETS);
  const bmadSource = (await serverModule()).createMemoryBmadSource({ ready: true });
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const { wsId } = await prepare(page, repo, ['board']);
      await page.goto(`${server.url}/w/${wsId}/board`);
      await expect(page.getByTestId('workspace-tab-board')).toBeVisible();
      await expect(page.getByTestId('workspace-tab-runs')).toHaveCount(0);
      await page.keyboard.press('g');
      await page.keyboard.press('r');
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/board$`));
      await page.goto(`${server.url}/w/${wsId}/runs`);
      await expect(page.getByTestId('plan-feature-off')).toBeVisible();
      await expect(page.getByTestId('runs-list')).toHaveCount(0);
    },
    { files: FILES, extra: { ticketStore: store as never, bmadSource, sandbox: fixedSandbox({ available: true, kind: 'test' }) } },
  );
});
