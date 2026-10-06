/// <reference lib="dom" />
/**
 * The board's Build actions in a real browser (story 11.3): Build this story
 * on a ready card and in the detail sheet, none on a card that waits, Build
 * all ready starting the two independent ready stories in parallel and
 * leaving the waiting one, the runs list in the detail sheet, the Build
 * dialog when the sandbox is missing, and no Build action with builds off.
 *
 * Real `git`; a ticket store that reads and writes the plan files (no uv); a
 * fixed sandbox answer (the test sandbox kind only); no real `claude`,
 * keychain or network.
 */
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { apiPath } from '../../packages/shared/src/api.ts';
import { FAKE_BMAD_FILES, FAKE_BUILD_PLAN, FAKE_BUILD_REPO_FILES, FAKE_BUILD_WAITING_PLAN, fixtureGit } from '../fixtures/fake-bmad-repo.ts';
import { fixedSandbox } from '../fixtures/fixed-sandbox.ts';
import { createPlanFileTicketStore } from '../fixtures/plan-file-ticket-store.ts';
import { API_ROUTES, serverModule } from '../support.js';
import { withChatServer } from './chat-server.js';
import { storedToken } from './tab.js';

const THIRD_PLAN = '_bmad-output/initiative-demo/epic-first/story-build-a-third-thing-plan.md';
const TICKETS = [
  { ref: '1.1', title: 'Build the thing', plan: FAKE_BUILD_PLAN },
  { ref: '1.2', title: 'Build the next thing', plan: FAKE_BUILD_WAITING_PLAN },
  { ref: '1.3', title: 'Build a third thing', plan: THIRD_PLAN, after: [1] },
];
const FILES = {
  [THIRD_PLAN]: '---\ntitle: "Build a third thing"\ntype: "feature"\nticket: 3\nstatus: ready-for-dev\n---\n\n# Build a third thing\n', ...FAKE_BMAD_FILES, '_bmad/config.toml': '[core]\noutput_folder = "{project-root}/_bmad-output"\n', ...FAKE_BUILD_REPO_FILES };

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

test('Build all ready builds the two independent ready stories in parallel and leaves the waiting one; the sheet lists the runs', async ({ page }) => {
  test.setTimeout(120_000);
  const store = createPlanFileTicketStore(TICKETS);
  const bmadSource = (await serverModule()).createMemoryBmadSource({ ready: true });
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const { call, wsId } = await prepare(page, repo);
      await page.goto(`${server.url}/w/${wsId}/board`);
      const card = (ref: string) => page.locator(`[data-testid="ticket-card"][data-ref="${ref}"]`);
      await expect(card('1.1')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Build this story 1.1' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Build this story 1.2' })).toBeVisible();
      // The waiting story keeps "Waits for" and has no Build.
      await expect(card('1.3')).toContainText('Waits for');
      await expect(page.getByRole('button', { name: 'Build this story 1.3' })).toHaveCount(0);

      // Its sheet has no Build while it waits.
      await page.goto(`${server.url}/w/${wsId}/board/1.3`);
      await expect(page.getByTestId('ticket-sheet')).toBeVisible();
      await expect(page.getByTestId('ticket-sheet-build-start')).toHaveCount(0);
      await page.goto(`${server.url}/w/${wsId}/board`);
      await page.getByTestId('board-build-all').click();
      await expect(page.getByTestId('board-build-all-started')).toContainText('Started 2 builds.');
      await expect.poll(async () => ((await (await call('GET', apiPath(API_ROUTES.workspaceRuns, { wsId }))).json()) as { runs: Array<{ outcome: string }> }).runs.filter((run) => run.outcome === 'verified').length, { timeout: 90_000 }).toBe(2);
      const runs = (await (await call('GET', apiPath(API_ROUTES.workspaceRuns, { wsId }))).json()) as { runs: Array<{ ticketRef: string }> };
      expect(runs.runs.map((run) => run.ticketRef).sort()).toEqual(['1.1', '1.2']);

      // The follow link opens the Runs tab with both runs.
      await page.getByTestId('board-build-all-follow').click();
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/runs$`));
      await expect(page.getByTestId('run-row')).toHaveCount(2);

      // The detail sheet of a built story lists its run with links; the waiting story's sheet has no Build.
      await page.goto(`${server.url}/w/${wsId}/board/1.1`);
      await expect(page.getByTestId('ticket-sheet-runs')).toBeVisible();
      await expect(page.getByTestId('ticket-sheet-build-open')).toBeVisible();
      await expect(page.getByTestId('ticket-sheet-build-review')).toBeVisible();
      await expect(page.getByTestId('ticket-sheet-build-start')).toHaveCount(0);
      // Build all ready never dispatched the waiting story (its prerequisite is built, not merged).
      expect(((await (await call('GET', apiPath(API_ROUTES.workspaceRuns, { wsId }))).json()) as { runs: unknown[] }).runs).toHaveLength(2);
    },
    { files: FILES, extra: { ticketStore: store as never, bmadSource, sandbox: fixedSandbox({ available: true, kind: 'test' }) } },
  );
});

test('Build this story in the detail sheet starts a build and opens its session', async ({ page }) => {
  test.setTimeout(90_000);
  const store = createPlanFileTicketStore(TICKETS);
  const bmadSource = (await serverModule()).createMemoryBmadSource({ ready: true });
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const { wsId } = await prepare(page, repo);
      await page.goto(`${server.url}/w/${wsId}/board/1.2`);
      await page.getByTestId('ticket-sheet-build-start').click();
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/s/ses_[0-9A-Z]+$`));
      await expect(page.getByTestId('build-run-ref')).toHaveText('1.2');
    },
    { files: FILES, extra: { ticketStore: store as never, bmadSource, sandbox: fixedSandbox({ available: true, kind: 'test' }) } },
  );
});

test('a refused build from the sheet opens the Build dialog, and with builds off there is no Build action', async ({ page }) => {
  const store = createPlanFileTicketStore(TICKETS);
  const bmadSource = (await serverModule()).createMemoryBmadSource({ ready: true });
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const { call, wsId } = await prepare(page, repo);
      await page.goto(`${server.url}/w/${wsId}/board/1.1`);
      await page.getByTestId('ticket-sheet-build-start').click();
      await expect(page.getByTestId('build-dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      expect((await call('PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['board'] })).status).toBe(200);
      await page.goto(`${server.url}/w/${wsId}/board`);
      await expect(page.getByTestId('ticket-card').first()).toBeVisible();
      await expect(page.getByTestId('board-build-all')).toHaveCount(0);
      await expect(page.getByTestId('ticket-build')).toHaveCount(0);
      await page.goto(`${server.url}/w/${wsId}/board/1.1`);
      await expect(page.getByTestId('ticket-sheet')).toBeVisible();
      await expect(page.getByTestId('ticket-sheet-build')).toHaveCount(0);
    },
    { files: FILES, extra: { ticketStore: store as never, bmadSource, sandbox: fixedSandbox({ available: false, reason: 'The test sandbox is unavailable.', choices: ['attended', 'install_docker', 'other_agent'] }) } },
  );
});
