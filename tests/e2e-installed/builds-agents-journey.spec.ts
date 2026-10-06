/// <reference lib="dom" />
/**
 * Epic 17's journey against the installed package, in Chromium (story 17.11):
 * builds with more than one agent. A server of its own started by the installed
 * `ogden` launcher with Claude Code (the fake agent) and Codex (the fake's Codex
 * personality through the server's Codex hook; its key reaches only its own
 * process), BMad Method from the local fixture, the project's skills committed,
 * and the build's sandbox the test hook's answer. No real agent, account,
 * keychain or network; live checks with the real agents are the user's
 * (RELEASING.md, "Builds with other agents").
 *
 * 1. Workspace settings choose a default build agent (Automatic until chosen).
 * 2. Build opens the picker with both agents: Claude Code builds on its own, Codex
 *    builds with you watching and says why (its own sandbox is not checked yet).
 * 3. Claude Code builds one ticket unattended from the picker; Codex builds the
 *    other with you watching, a card for each write, and both end ready for review
 *    with their own agent named in Runs.
 * 4. Approve merges the Codex build (the plan is done in the merge commit); Reject
 *    removes the Claude Code build's copy.
 * 5. A second server where the agent hits its usage limit: the run ends blocked in
 *    that agent's own words, nothing retries by itself, Retry and Build again with
 *    Codex are offered, and Build again with Codex starts a fresh Codex build.
 * 6. With no sandbox, an unattended build is refused for every agent and the
 *    dialog offers building with you watching.
 *
 * Skipped outside CI when uv or its managed Python 3.12 is missing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { apiPath } from '../../packages/shared/src/api.ts';
import { FAKE_BUILD_PLAN, FAKE_BUILD_REPO_FILES, fixtureGit } from '../fixtures/fake-bmad-repo.js';
import { API_ROUTES, ROOT } from '../support.js';
import { expectConnected, landConnected, storedToken } from '../e2e/tab.js';
import { bmadServer, CLAUDE_ACP_PATH_ENV, uvReady, type BmadServer, type Launched } from './installed.js';

test.skip(!uvReady(), 'needs uv and its managed Python 3.12 on PATH (CI provisions both)');

const servers: BmadServer[] = [];
test.afterAll(async () => {
  for (const server of servers) await server.remove();
});
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

/** A run reaching its end through the fake agent and the end checks; a loaded Windows runner is slow. */
const LIVE = { timeout: 90_000 };
/** 1.1 and 1.2 are ready and independent. The Codex skill is committed where Codex reads skills. */
const FILES: Readonly<Record<string, string>> = {
  ...FAKE_BUILD_REPO_FILES,
  '_bmad-output/initiative-demo/epic-first/epic-first.md': '---\ntype: epic\ntitle: "First"\nparent: initiative-demo\ncovers: []\nafter: []\n---\n\n# First\n',
  '_bmad-output/initiative-demo/epic-first/tickets.toml': '[[entry]]\nid = 1\ntype = "story"\ntitle = "Build the thing"\nafter = []\n\n[[entry]]\nid = 2\ntype = "story"\ntitle = "Build the next thing"\nafter = []\n',
  '.agents/skills/bmad-build-auto/SKILL.md': '# Build\n',
};
const CODEX_REASON = "Codex's own sandbox hasn't been checked on this computer yet, so it builds with you watching.";

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

interface RunRow {
  id: string;
  ticketRef: string;
  outcome: string;
  agent: string | null;
  worktreePath: string | null;
  decision: string | null;
  blockedCode: string | null;
  sandbox: string | null;
}
const runsOf = async (page: Page, wsId: string): Promise<RunRow[]> => ((await (await api(page, 'GET', apiPath(API_ROUTES.workspaceRuns, { wsId }))).json()) as { runs: RunRow[] }).runs;

async function connect(page: Page, launched: Launched) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await landConnected(page, launched.launchUrl);
  await expectConnected(page);
}

/** A project with the build fixture, Board and Unattended builds on, the scripts trusted and BMad Method downloaded. */
async function buildProject(page: Page, repoPath: string): Promise<string> {
  const response = await api(page, 'POST', API_ROUTES.workspaces, { path: repoPath });
  const wsId = ((await response.json()) as { workspace: { id: string } }).workspace.id;
  expect((await api(page, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['board', 'builds'] })).status).toBe(200);
  expect((await api(page, 'PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }))).status).toBe(200);
  expect((await api(page, 'POST', API_ROUTES.bmadSource)).status).toBe(200);
  return wsId;
}

function start(name: string, env: Record<string, string> = {}) {
  const server = bmadServer(name, { bmadSource: true, codex: true, env: { OGDEN_AGENTS_TEST_SANDBOX: 'available', ...env } });
  servers.push(server);
  return server;
}

test('Build asks which agent, Claude Code builds on its own, Codex with you watching, and both are reviewed', async ({ page }) => {
  test.setTimeout(420_000);
  const server = start('journey-builds-agents');
  const repo = server.addRepo({ git: true, files: FILES, prefix: 'agents-build-repo-' });
  const launched = await server.launch();
  await connect(page, launched);
  const url = launched.url;
  const wsId = await buildProject(page, repo.path);

  await test.step('Workspace settings choose the default build agent (Automatic until chosen)', async () => {
    await page.goto(`${url}/w/${wsId}/settings`);
    await expect(page.getByTestId('default-build-agent')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId('default-build-agent-automatic')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#default-build-agent-claude-code-description')).toContainText('Builds on its own');
    await expect(page.locator('#default-build-agent-codex-description')).toContainText(CODEX_REASON);
    await page.getByTestId('default-build-agent-claude-code').click();
    await expect(page.getByTestId('default-build-agent-saved')).toBeVisible();
    await page.getByTestId('default-build-agent-automatic').click();
    await expect(page.getByTestId('default-build-agent-automatic')).toHaveAttribute('aria-checked', 'true');
  });

  await test.step('Build opens the picker with both agents and starts nothing', async () => {
    await page.goto(`${url}/w/${wsId}/board`);
    await expect(page.getByRole('button', { name: 'Build this story 1.1' })).toBeVisible({ timeout: 45_000 });
    await page.getByRole('button', { name: 'Build this story 1.1' }).click();
    const dialog = page.getByTestId('build-dialog');
    await expect(dialog).toContainText('Build 1.1 with which agent?');
    await expect(page.locator('#build-agent-claude-code-description')).toContainText('Builds on its own');
    await expect(page.locator('#build-agent-codex-description')).toContainText(CODEX_REASON);
    expect(await runsOf(page, wsId)).toEqual([]);
    // Claude Code is the default and builds on its own: Build starts it unattended.
    await page.getByTestId('build-dialog-start').click();
    await expect(page).toHaveURL(new RegExp(`/w/${wsId}/s/ses_`));
    await expect(page.getByTestId('build-run-outcome')).toHaveText('Ready for review', LIVE);
    await expect(page.getByTestId('build-run-agent')).toHaveText('Claude Code');
  });

  await test.step('Codex builds the other story with you watching, a card for each write', async () => {
    await page.goto(`${url}/w/${wsId}/board`);
    await page.getByRole('button', { name: 'Build this story 1.2' }).click();
    await page.getByTestId('build-agent-codex').click();
    await expect(page.getByTestId('build-dialog-summary')).toHaveText(CODEX_REASON);
    await page.getByRole('button', { name: 'Build with me watching' }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${wsId}/s/ses_`));
    const card = page.getByTestId('permission-card');
    await expect(card).toBeVisible(LIVE);
    await card.getByRole('button', { name: 'Allow once' }).click();
    await expect(page.getByTestId('permission-record')).toHaveCount(1);
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Deny' }).click();
    await expect(page.getByTestId('build-run-outcome')).toHaveText('Ready for review', LIVE);
    await expect(page.getByTestId('build-run-agent')).toHaveText('Codex');
  });

  await test.step('Both runs name their own agent, and no key is in a run, an event or the log', async () => {
    const runs = await runsOf(page, wsId);
    expect(runs.map((run) => [run.ticketRef, run.agent]).sort()).toEqual([['1.1', 'claude-code'], ['1.2', 'codex']]);
    const log = readFileSync(join(server.install.dataDir, 'logs', 'server.log'), 'utf8');
    expect(log).not.toContain('sk-proj-');
  });

  await test.step('Approve merges the Codex build with its plan done; Reject removes the Claude Code build\'s copy', async () => {
    await page.goto(`${url}/w/${wsId}/review/1.2`);
    await expect(page.getByTestId('review-approve')).toBeEnabled(LIVE);
    await page.getByTestId('review-approve').click();
    await expect(page.getByTestId('review-merged')).toBeVisible(LIVE);
    expect(fixtureGit(repo.path, 'show', `HEAD:${FAKE_BUILD_PLAN.replace('story-build-the-thing', 'story-build-the-next-thing')}`)).toMatch(/status: done/);
    const first = (await runsOf(page, wsId)).find((run) => run.ticketRef === '1.1')!;
    await page.goto(`${url}/w/${wsId}/review/1.1`);
    await page.getByTestId('review-reject').click();
    await page.getByTestId('review-reject-confirm').click();
    await expect.poll(async () => (await runsOf(page, wsId)).find((run) => run.id === first.id)?.decision, LIVE).toBe('rejected');
  });
});

test('a usage limit ends the run blocked in the agent\'s own words, and Build again with Codex starts a fresh Codex build with you watching', async ({ page }) => {
  test.setTimeout(300_000);
  const server = start('journey-builds-limit', { [CLAUDE_ACP_PATH_ENV]: join(ROOT, 'tests', 'fixtures', 'fake-acp-agent-installed-limit.mjs') });
  const repo = server.addRepo({ git: true, files: FILES, prefix: 'agents-limit-repo-' });
  const launched = await server.launch();
  await connect(page, launched);
  const url = launched.url;
  const wsId = await buildProject(page, repo.path);
  await page.goto(`${url}/w/${wsId}/board`);
  await expect(page.getByRole('button', { name: 'Build this story 1.1' })).toBeVisible({ timeout: 45_000 });
  await page.getByRole('button', { name: 'Build this story 1.1' }).click();
  await page.getByTestId('build-dialog-start').click();
  await expect(page).toHaveURL(new RegExp(`/w/${wsId}/s/ses_`));
  await expect(page.getByTestId('build-run-outcome')).toHaveText('Blocked', LIVE);
  await expect(page.getByTestId('build-run-reason')).toContainText('Claude Code has reached its usage limit.');
  await expect(page.getByTestId('build-run-reason')).toContainText('build it again with another agent');
  await expect(page.getByTestId('build-run-retry')).toBeVisible();
  await expect(page.getByTestId('build-run-again-codex')).toHaveText('Build again with Codex, with me watching');
  // Nothing retried by itself: still the one run, still blocked.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 1500)));
  expect((await runsOf(page, wsId)).map((run) => [run.agent, run.outcome])).toEqual([['claude-code', 'blocked']]);
  await page.getByTestId('build-run-again-codex').click();
  await expect.poll(async () => (await runsOf(page, wsId)).map((run) => run.agent).sort(), LIVE).toEqual(['claude-code', 'codex']);
  // Codex builds with you watching, though the first run was unattended.
  expect((await runsOf(page, wsId)).find((run) => run.agent === 'codex')!.sandbox).toBe('attended');
});

test('with no sandbox an unattended build is refused for every agent, and the dialog offers building with you watching', async ({ page }) => {
  test.setTimeout(240_000);
  const server = start('journey-builds-nosandbox', { OGDEN_AGENTS_TEST_SANDBOX: 'unavailable' });
  const repo = server.addRepo({ git: true, files: FILES, prefix: 'agents-nosandbox-repo-' });
  const launched = await server.launch();
  await connect(page, launched);
  const url = launched.url;
  const wsId = await buildProject(page, repo.path);
  await page.goto(`${url}/w/${wsId}/board`);
  await expect(page.getByRole('button', { name: 'Build this story 1.1' })).toBeVisible({ timeout: 45_000 });
  await page.getByRole('button', { name: 'Build this story 1.1' }).click();
  const dialog = page.getByTestId('build-dialog');
  await expect(dialog).toBeVisible();
  // Every agent says it builds with you watching; none can start on its own, and nothing was written.
  await expect(page.locator('#build-agent-claude-code-description')).toContainText('Builds with you watching');
  await expect(page.locator('#build-agent-codex-description')).toContainText('Builds with you watching');
  await expect(page.getByRole('button', { name: 'Build with me watching' })).toBeVisible();
  await expect(page.getByTestId('build-dialog-start')).toHaveCount(0);
  expect(await runsOf(page, wsId)).toEqual([]);
  const refused = await api(page, 'POST', apiPath(API_ROUTES.workspaceBuilds, { wsId }), { ref: '1.1', agent: 'codex' });
  expect(refused.status).toBe(409);
  expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('sandbox_unavailable');
});
