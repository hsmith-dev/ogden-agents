/**
 * Unattended builds through the real `tickets.py` (the verified pinned copy,
 * real uv, offline; story 11.6): a build of a ready story reads and marks its
 * plan in its own worktree, two independent stories build in parallel with
 * Build all ready and leave the one that waits, a failing re-run is reported
 * and Check again after the fix makes it ready, and Approve marks the plan
 * done in the merge commit. Skipped without uv and its managed Python 3.12
 * (CI provisions both). The fake agent, a fixed sandbox answer, real git; no
 * real `claude`, keychain or network.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFixedSandbox, createUpstreamBmadSource } from '@ogden-agents/adapters';
import { AllReadyBuildsResponse, API_ROUTES, apiPath, BuildResponse, ReviewResponse, RunsResponse, WorkspaceResponse } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { createFakeBmadRepo, FAKE_BUILD_PLAN, FAKE_TICKET_TREE_FILES, FAKE_BUILD_REPO_FILES, fixtureGit } from '../../../tests/fixtures/fake-bmad-repo.js';
import { fixtureUpstream, realUvMissing, removeAfterTest, signIn, startTestServer, tempDataDir, TEST_UV_PYTHON_ENV, waitFor, type SignedIn, type TestServer } from './helpers.js';

const THIRD = '_bmad-output/initiative-demo/epic-first/story-build-a-third-thing-plan.md';
/** 1.1 and 1.2 are independent and ready; 1.3 waits for 1.1 (the fixture's own entry 2 waits for 1: it is made independent here). */
const FILES = {
  ...FAKE_BUILD_REPO_FILES,
  '_bmad-output/initiative-demo/epic-first/epic-first.md': FAKE_TICKET_TREE_FILES['_bmad-output/initiative-demo/epic-first/epic-first.md']!,
  '_bmad-output/initiative-demo/epic-first/tickets.toml':
    '[[entry]]\nid = 1\ntype = "story"\ntitle = "Build the thing"\nafter = []\n\n[[entry]]\nid = 2\ntype = "story"\ntitle = "Build the next thing"\nafter = []\n\n[[entry]]\nid = 3\ntype = "story"\ntitle = "Build a third thing"\nafter = [1]\n',
  [THIRD]: '---\ntitle: "Build a third thing"\ntype: "feature"\nticket: 3\nstatus: ready-for-dev\n---\n\n# Build a third thing\n',
};

function request(server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) {
  return fetch(`${server.url}${path}`, {
    method,
    headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe.skipIf(realUvMissing())('builds through the real tickets.py (story 11.6)', () => {
  it('builds in parallel, reports a failing re-run, checks again, and approves with the plan done in the merge commit', async () => {
    const uvCache = mkdtempSync(join(tmpdir(), 'ogden-agents-uv-cache-'));
    removeAfterTest(uvCache);
    const dataDir = tempDataDir();
    const upstream = fixtureUpstream();
    const server = await startTestServer({
      dataDir,
      bmadSource: createUpstreamBmadSource({ dataDir, lock: upstream.lock, fetch: upstream.fetch }),
      extraUvEnv: { UV_CACHE_DIR: uvCache, ...TEST_UV_PYTHON_ENV },
      sandbox: createFixedSandbox({ available: true, kind: 'test' }),
      extraAgentEnv: { FAKE_ACP_CHUNK_DELAY_MS: '1' },
    });
    const tab = await signIn(server);
    const repo = createFakeBmadRepo({ git: true, files: FILES, prefix: 'ogden-agents-real-uv-build-' });
    removeAfterTest(repo.path);
    const wsId = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo.path })).json()).workspace.id;
    expect((await request(server, tab, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['board', 'builds'] })).status).toBe(200);
    expect((await request(server, tab, 'PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }))).status).toBe(200);
    expect((await request(server, tab, 'POST', API_ROUTES.bmadSource)).status).toBe(200);

    // Build all ready: the two independent stories, not the one that waits.
    const reply = await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceBuilds, { wsId }), { all: true });
    const text = await reply.text();
    expect(reply.status, text).toBe(202);
    const started = AllReadyBuildsResponse.parse(JSON.parse(text));
    expect(started.runs.map((run) => run.ticketRef).sort()).toEqual(['1.1', '1.2']);
    const review = async (ref: string) => ReviewResponse.parse(await (await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceBuild, { wsId, ref }))).json());
    await waitFor(async () => (await review('1.1')).outcome === 'verified' && (await review('1.2')).outcome === 'verified', 'both runs ready for review', 90_000);
    const runs = RunsResponse.parse(await (await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceRuns, { wsId }))).json());
    expect(runs.runs.map((run) => run.ticketRef).sort()).toEqual(['1.1', '1.2']);

    // A failing re-run is reported with its count and output; Check again after the fix makes it ready.
    const first = runs.runs.find((run) => run.ticketRef === '1.1')!;
    writeFileSync(join(first.worktreePath!, '.fake-tests-fail'), 'fail\n');
    expect((await request(server, tab, 'POST', apiPath(API_ROUTES.runCheckAgain, { wsId, runId: first.id }))).status).toBe(200);
    await waitFor(async () => (await review('1.1')).outcome === 'failed', 'the failing check', 60_000);
    const failed = await review('1.1');
    expect(failed.reason).toBe('3 tests failed when re-run');
    expect(failed.verification?.testOutputTail).toContain('3 failed');
    rmSync(join(first.worktreePath!, '.fake-tests-fail'));
    expect((await request(server, tab, 'POST', apiPath(API_ROUTES.runCheckAgain, { wsId, runId: first.id }))).status).toBe(200);
    await waitFor(async () => (await review('1.1')).outcome === 'verified', 'ready again', 60_000);

    // Approve: one merge commit with the change and the plan done.
    const approved = await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceBuildApprove, { wsId, ref: '1.1' }), { revision: (await review('1.1')).headRevision });
    expect(approved.status, await approved.clone().text()).toBe(200);
    expect(fixtureGit(repo.path, 'show', `HEAD:${FAKE_BUILD_PLAN}`)).toMatch(/^status: done$/m);
    expect(fixtureGit(repo.path, 'show', 'HEAD:src/built-1.1.txt')).toContain('Built 1.1');

    // The waiting story is buildable now that its prerequisite is done.
    const third = BuildResponse.parse(await (await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceBuilds, { wsId }), { ref: '1.3' })).json());
    expect(third.run.ticketRef).toBe('1.3');
  }, 240_000);
});
