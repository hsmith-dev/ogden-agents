/// <reference lib="dom" />
/**
 * Epic 11's journey against the installed package, in Chromium (story 11.6):
 * Build all ready, the run view and the Runs tab, a failing re-run reported
 * everywhere and checked again, Needs you and the webhook payloads, an intent
 * gap's saved fix, and nothing at all with Unattended builds off. A server of
 * its own started by the installed `ogden` launcher, with its own data folder,
 * home folder and the fake agent; BMad Method comes from the local fixture
 * through the `OGDEN_AGENTS_TEST_BMAD_SOURCE` hook, and the real `tickets.py`
 * runs through uv offline. The build's sandbox is the test hook's answer, the
 * webhook sender is the recording hook (`OGDEN_AGENTS_TEST_NOTIFIER`): no real
 * agent, account, keychain or network.
 *
 * 1. Builds off: no Runs tab, no `g r`, the Runs page says it is off, and a
 *    run's Check again is refused `feature_off`.
 * 2. Builds on, a webhook added in Settings, Notifications (its address shown
 *    by its domain only).
 * 3. The board: Build this story on the two ready stories, none on the one
 *    that waits; Build all ready starts both in parallel and leaves the waiting
 *    one; the Runs tab lists both; each reaches Needs you (the tab title counts
 *    them) and sends one ready-for-review payload to the webhook.
 * 4. A failing re-run: its failing check and the test output in the run view,
 *    the Runs tab, the card and the review page; Check again after the fix
 *    makes it ready again.
 * 5. Approve: the plan is done in the merge commit and its need is gone.
 * 6. An intent gap (a second server whose agent halts on one): blocked in Needs
 *    you and the webhook, its code behind Show details, and Apply the saved fix
 *    and retry applies the saved patch in the worktree.
 *
 * Live checks with Claude Code (the user's) are the plan's, not this suite's.
 * Skipped outside CI when uv or its managed Python 3.12 is missing.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { apiPath } from '../../packages/shared/src/api.ts';
import { FAKE_BUILD_PLAN, FAKE_BUILD_REPO_FILES, FAKE_TICKET_TREE_FILES, fixtureGit } from '../fixtures/fake-bmad-repo.js';
import { API_ROUTES, ROOT } from '../support.js';
import { expectConnected, landConnected, storedToken } from '../e2e/tab.js';
import { bmadServer, CLAUDE_ACP_PATH_ENV, extraFolder, uvReady, type BmadServer, type Launched } from './installed.js';

test.skip(!uvReady(), 'needs uv and its managed Python 3.12 on PATH (CI provisions both)');

const servers: BmadServer[] = [];

test.afterEach(async ({}, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  for (const server of servers) {
    try {
      const lines = readFileSync(join(server.install.dataDir, 'logs', 'server.log'), 'utf8').split('\n');
      console.log(lines.filter((line) => /"level":"(warn|error)"/.test(line)).join('\n'));
    } catch {
      // No log yet.
    }
  }
});

test.afterAll(async () => {
  for (const server of servers) await server.remove();
});

/** A run reaching its end: the fake agent, the end checks (the project's tests re-run through the sandbox hook) and the refetch. A loaded Windows runner is slow. */
const LIVE = { timeout: 90_000 };
const SECRET_URL = 'https://hooks.example.com/services/T0K3N-SECRET';
const THIRD = '_bmad-output/initiative-demo/epic-first/story-build-a-third-thing-plan.md';
/** 1.1 and 1.2 are ready and independent; 1.3 waits for 1.1. */
const FILES: Readonly<Record<string, string>> = {
  ...FAKE_BUILD_REPO_FILES,
  '_bmad-output/initiative-demo/epic-first/epic-first.md': FAKE_TICKET_TREE_FILES['_bmad-output/initiative-demo/epic-first/epic-first.md']!,
  '_bmad-output/initiative-demo/epic-first/tickets.toml':
    '[[entry]]\nid = 1\ntype = "story"\ntitle = "Build the thing"\nafter = []\n\n[[entry]]\nid = 2\ntype = "story"\ntitle = "Build the next thing"\nafter = []\n\n[[entry]]\nid = 3\ntype = "story"\ntitle = "Build a third thing"\nafter = [1]\n',
  [THIRD]: '---\ntitle: "Build a third thing"\ntype: "feature"\nticket: 3\nstatus: ready-for-dev\n---\n\n# Build a third thing\n',
};

/** A request to the server with the tab's own token, as the page makes it. */
async function api(page: Page, method: string, path: string, body?: unknown): Promise<Response> {
  const origin = new URL(page.url()).origin;
  const token = await storedToken(page);
  if (token === null) throw new Error('the page has no tab token; connect it first');
  return fetch(`${origin}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function addProject(page: Page, path: string): Promise<string> {
  const response = await api(page, 'POST', API_ROUTES.workspaces, { path });
  if (!response.ok) throw new Error(`POST workspaces returned ${response.status}: ${await response.text()}`);
  return ((await response.json()) as { workspace: { id: string } }).workspace.id;
}

interface RunRow {
  id: string;
  ticketRef: string;
  outcome: string;
  worktreePath: string | null;
  sessionId: string;
}
async function runsOf(page: Page, wsId: string): Promise<RunRow[]> {
  return ((await (await api(page, 'GET', apiPath(API_ROUTES.workspaceRuns, { wsId }))).json()) as { runs: RunRow[] }).runs;
}

/** What the recording notifier hook wrote: one JSON line per send. */
function sentOf(file: string): Array<{ url: string; payload: { event: string; text: string; ticket: { ref: string } | null } }> {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as never);
}

/** Starts the server with the recording notifier's file named in its environment. */
function withNotifier(name: string, agent?: string) {
  // In the OS temp folder (the hook refuses any other), its own folder so the teardown removes it.
  const dataDirFile = join(extraFolder(`${name}-hook`), 'webhooks.ndjson');
  const server = bmadServer(name, { bmadSource: true, env: { OGDEN_AGENTS_TEST_SANDBOX: 'available', OGDEN_AGENTS_TEST_NOTIFIER: dataDirFile, ...(agent === undefined ? {} : { [CLAUDE_ACP_PATH_ENV]: agent }) } });
  servers.push(server);
  return { server, sent: dataDirFile };
}

async function connect(page: Page, launched: Launched) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await landConnected(page, launched.launchUrl);
  await expectConnected(page);
}

/** A project with the build fixture, a git history, Board and Unattended builds on, the scripts trusted and BMad Method downloaded. */
async function buildProject(page: Page, repoPath: string, pieces: string[]): Promise<string> {
  const wsId = await addProject(page, repoPath);
  expect((await api(page, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: pieces })).status).toBe(200);
  expect((await api(page, 'PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }))).status).toBe(200);
  expect((await api(page, 'POST', API_ROUTES.bmadSource)).status).toBe(200);
  return wsId;
}

test('Build all ready, the run view, a failing re-run, Needs you and the webhook, on the installed package', async ({ page }) => {
  test.setTimeout(480_000);
  const { server, sent } = withNotifier('journey-builds');
  const repo = server.addRepo({ git: true, files: FILES, prefix: 'build-repo-' });
  const launched = await server.launch();
  await connect(page, launched);
  const url = launched.url;
  const card = (ref: string) => page.locator(`[data-testid="ticket-card"][data-ref="${ref}"]`);

  const wsId = await addProject(page, repo.path);
  await test.step('Builds off: no Runs tab, no g r, the Runs page says so, Check again is refused', async () => {
    expect((await api(page, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['board'] })).status).toBe(200);
    expect((await api(page, 'PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }))).status).toBe(200);
    await page.goto(`${url}/w/${wsId}/board`);
    await expect(page.getByTestId('workspace-tab-board')).toBeVisible();
    await expect(page.getByTestId('workspace-tab-runs')).toHaveCount(0);
    await page.keyboard.press('g');
    await page.keyboard.press('r');
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
    await expect(page).toHaveURL(new RegExp(`/w/${wsId}/board$`));
    await page.goto(`${url}/w/${wsId}/runs`);
    await expect(page.getByTestId('plan-feature-off')).toBeVisible();
    const refused = await api(page, 'POST', apiPath(API_ROUTES.runCheckAgain, { wsId, runId: 'run_01J9Z3K4M5N6P7Q8R9S0T1V2W3' }));
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('feature_off');
  });

  await test.step('Builds on, and a webhook added in Settings, Notifications', async () => {
    expect((await api(page, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['board', 'builds'] })).status).toBe(200);
    expect((await api(page, 'POST', API_ROUTES.bmadSource)).status).toBe(200);
    await page.goto(`${url}/settings/notifications`);
    await page.getByTestId('webhook-url').fill(SECRET_URL);
    await page.getByTestId('webhook-add').click();
    await expect(page.getByTestId('webhook-host')).toHaveText('Sends to example.com');
    expect(await page.content()).not.toMatch(/T0K3N|hooks\.example/);
  });

  await test.step('The board: Build this story on the ready stories, none on the one that waits; Build all ready starts both', async () => {
    await page.goto(`${url}/w/${wsId}/board`);
    await expect(card('1.1')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole('button', { name: 'Build this story 1.1' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Build this story 1.2' })).toBeVisible();
    await expect(card('1.3')).toContainText('Waits for');
    await expect(page.getByRole('button', { name: 'Build this story 1.3' })).toHaveCount(0);
    await page.getByTestId('board-build-all').click();
    await expect(page.getByTestId('board-build-all-started')).toContainText('Started 2 builds.');
    await page.getByTestId('board-build-all-follow').click();
    await expect(page).toHaveURL(new RegExp(`/w/${wsId}/runs$`));
    await expect(page.getByTestId('run-row')).toHaveCount(2);
    await expect(page.locator('[data-testid="run-row"][data-phase="built"]')).toHaveCount(2, LIVE);
    // The waiting story was not dispatched.
    expect((await runsOf(page, wsId)).map((run) => run.ticketRef).sort()).toEqual(['1.1', '1.2']);
  });

  await test.step('Both are in Needs you, the tab title counts them, and each sent one payload', async () => {
    await expect(page.getByTestId('needs-you-item').filter({ hasText: 'is ready for review' })).toHaveCount(2);
    await expect(page).toHaveTitle('(2) Ogden Agents');
    await expect.poll(() => sentOf(sent).filter((entry) => entry.payload.event === 'ready_for_review').length, LIVE).toBe(2);
    expect(sentOf(sent).map((entry) => entry.payload.ticket?.ref).sort()).toEqual(['1.1', '1.2']);
    expect(readFileSync(join(server.install.dataDir, 'logs', 'server.log'), 'utf8')).not.toMatch(/T0K3N|hooks\.example/);
  });

  const first = (await runsOf(page, wsId)).find((run) => run.ticketRef === '1.1')!;
  await test.step('A failing re-run shows its failing check and output in the run view, the Runs tab, the card and the review', async () => {
    writeFileSync(join(first.worktreePath!, '.fake-tests-fail'), 'fail\n');
    await page.goto(`${url}/w/${wsId}/s/${first.sessionId}`);
    await expect(page.getByTestId('build-run-outcome')).toHaveText('Ready for review');
    await page.getByTestId('check-again').click();
    await expect(page.getByTestId('build-run-outcome')).toHaveText('Failed', LIVE);
    const checks = page.getByTestId('build-run-checks');
    await expect(checks.locator('[data-check="tests_pass"]')).toContainText('3 tests failed when re-run');
    await checks.getByTestId('verification-details-toggle').click();
    await expect(checks.getByTestId('verification-test-output')).toContainText('Tests: 3 failed, 2 passed, 5 total');
    await page.getByTestId('workspace-tab-runs').click();
    await expect(page.locator('[data-testid="run-row"][data-ref="1.1"] [data-testid="run-row-reason"]')).toContainText('3 tests failed when re-run');
    await page.goto(`${url}/w/${wsId}/board`);
    await expect(card('1.1').getByTestId('ticket-build-failure')).toContainText('Build failed: 3 tests failed when re-run');
    await page.goto(`${url}/w/${wsId}/review/1.1`);
    await expect(page.getByTestId('review-approve')).toHaveCount(0);
    await expect(page.locator('[data-testid="review-check"][data-check="tests_pass"]')).toContainText('3 tests failed when re-run');
  });

  await test.step('Check again after the fix makes it ready, and Approve writes the plan done in the merge commit', async () => {
    rmSync(join(first.worktreePath!, '.fake-tests-fail'));
    await page.getByTestId('check-again').click();
    await expect(page.getByTestId('review-outcome')).toHaveText('Ready for review', LIVE);
    await expect(page.getByTestId('review-approve')).toBeEnabled();
    await page.getByTestId('review-approve').click();
    await expect(page.getByTestId('review-merged')).toBeVisible(LIVE);
    expect(fixtureGit(repo.path, 'show', `HEAD:${FAKE_BUILD_PLAN}`)).toMatch(/^status: done$/m);
    expect(fixtureGit(repo.path, 'rev-list', '--parents', '-n', '1', 'HEAD').trim().split(' ')).toHaveLength(3);
    await expect(page.getByTestId('needs-you-item').filter({ hasText: 'Build 1.1' })).toHaveCount(0);
  });
});

test('an intent gap blocks the run (Needs you and the webhook) and Apply the saved fix and retry applies the saved patch, on the installed package', async ({ page }) => {
  test.setTimeout(300_000);
  const { server, sent } = withNotifier('journey-builds-gap', join(ROOT, 'tests', 'fixtures', 'fake-acp-agent-installed-gap.mjs'));
  const repo = server.addRepo({ git: true, files: FILES, prefix: 'gap-repo-' });
  const launched = await server.launch();
  await connect(page, launched);
  const url = launched.url;
  const wsId = await buildProject(page, repo.path, ['board', 'builds']);
  expect((await api(page, 'POST', API_ROUTES.notificationWebhooks, { url: SECRET_URL, events: ['blocked'] })).status).toBe(201);

  await page.goto(`${url}/w/${wsId}/board`);
  await expect(page.getByRole('button', { name: 'Build this story 1.1' })).toBeVisible({ timeout: 45_000 });
  await page.getByRole('button', { name: 'Build this story 1.1' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${wsId}/s/ses_`));
  await expect(page.getByTestId('build-run-outcome')).toHaveText('Blocked', LIVE);
  await expect(page.getByTestId('build-run-reason')).toContainText('A fix was saved');
  await page.getByTestId('build-run-details-toggle').click();
  await expect(page.getByTestId('build-run-code')).toHaveText('intent_gap');
  await expect(page.getByTestId('needs-you-item').filter({ hasText: 'Build 1.1 is blocked' })).toBeVisible();
  await expect.poll(() => sentOf(sent).filter((entry) => entry.payload.event === 'blocked').length, LIVE).toBe(1);

  const run = (await runsOf(page, wsId))[0]!;
  const fix = join(run.worktreePath!, 'src', 'fix-1.1.txt');
  expect(existsSync(fix)).toBe(false);
  await page.getByTestId('build-run-apply-fix').click();
  await expect.poll(() => existsSync(fix), LIVE).toBe(true);
  expect(readFileSync(fix, 'utf8')).toContain('Fixed 1.1 by the saved patch.');
  expect((await runsOf(page, wsId)).filter((each) => each.ticketRef === '1.1')).toHaveLength(1);
});
