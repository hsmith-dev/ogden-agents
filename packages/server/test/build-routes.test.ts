/**
 * Unattended builds over REST (story 5.2, epic 5's tracer), on a real server
 * with the real `acp-claude-code` adapter playing the fake ACP agent's build
 * mode, real `git` (`vcs-git`) on a fixture repo, a ticket store that reads
 * and writes the plan files themselves, and a fixed sandbox (no real
 * sandbox, `claude`, keychain or network):
 *
 * - with Unattended builds off, `POST …/builds` answers 409 `feature_off`
 *   and no worktree, branch or session exists;
 * - an unmet prerequisite, no sandbox, an uncommitted plan and a ticket not
 *   ready are refused with their codes, writing nothing;
 * - Build: the worktree is under the data folder (none in the repo), on
 *   `ogden/<run8>/1.1-build-the-thing`; the build session's write inside it is
 *   allowed and the one outside refused; the run ends `verified`; Approve is
 *   refused on a dirty checkout, not for changes under `_bmad-output/`, then
 *   leaves one merge commit with the change and the plan `done`, no hook
 *   (repo's or agent-written) ever ran, the worktree gone and the branch kept;
 * - a conflicting merge is aborted (the checkout unchanged) and blocks the
 *   run (`merge_conflict`); Reject removes the worktree, keeps the branch,
 *   stops the run and leaves the ticket untouched.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createFixedSandbox } from '@ogden-agents/adapters';
import type { TicketStorePort } from '@ogden-agents/core';
import { API_ROUTES, ApiErrorBody, apiPath, BuildResponse, FEATURE_OFF_MESSAGE, MERGE_CONFLICT_MESSAGE, ReviewResponse, RUN_REASON_NO_NETWORK, SessionRunResponse, WorkspaceResponse } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { createFakeBmadRepo, FAKE_BUILD_PLAN, FAKE_BUILD_TICKET_FILES, FAKE_BUILD_WAITING_PLAN, fixtureGit } from '../../../tests/fixtures/fake-bmad-repo.js';
import { createPlanFileTicketStore } from '../../../tests/fixtures/plan-file-ticket-store.js';
import { removeAfterTest, signIn, startTestServer, waitFor, type SignedIn, type TestServer } from './helpers.js';

function request(server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) {
  return fetch(`${server.url}${path}`, {
    method,
    headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function refusalOf(reply: Response) {
  return { status: reply.status, ...ApiErrorBody.parse(await reply.json()).error };
}

const TICKETS = [
  { ref: '1.1', title: 'Build the thing', plan: FAKE_BUILD_PLAN },
  { ref: '1.2', title: 'Build the next thing', plan: FAKE_BUILD_WAITING_PLAN, after: [1] },
];

/** A fixture repo (git, `main`, everything committed) whose config says husky's hooks folder, as a husky project's does. */
function buildRepo() {
  const repo = createFakeBmadRepo({ git: true, files: FAKE_BUILD_TICKET_FILES, prefix: 'ogden-agents-build-repo-' });
  removeAfterTest(repo.path);
  fixtureGit(repo.path, 'config', 'core.hooksPath', '.husky');
  return repo;
}

async function setup(options: { builds?: boolean; sandbox?: boolean } = {}) {
  const repo = buildRepo();
  const markers = removeAfterTest(mkdtempSync(join(tmpdir(), 'ogden-agents-hook-markers-')));
  const store = createPlanFileTicketStore(TICKETS);
  const server = await startTestServer({
    ticketStore: store as unknown as TicketStorePort,
    sandbox: createFixedSandbox(options.sandbox === false ? { available: false, reason: 'none here' } : { available: true, kind: 'test' }),
    extraAgentEnv: { FAKE_ACP_BUILD_HOOKS: markers, FAKE_ACP_CHUNK_DELAY_MS: '1' },
  });
  const tab = await signIn(server);
  const created = await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo.path });
  const workspace = WorkspaceResponse.parse(await created.json()).workspace;
  const wsId = workspace.id;
  if (options.builds !== false) {
    expect((await request(server, tab, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['board', 'builds'] })).status).toBe(200);
    expect((await request(server, tab, 'PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }))).status).toBe(200);
  }
  const build = (ref: string) => request(server, tab, 'POST', apiPath(API_ROUTES.workspaceBuilds, { wsId }), { ref });
  const review = async (ref: string) => ReviewResponse.parse(await (await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceBuild, { wsId, ref }))).json());
  const settled = async (ref: string) => {
    let last: ReviewResponse | undefined;
    await waitFor(async () => (last = await review(ref)).outcome !== 'running', `the run of ${ref} to end`, 15_000);
    return last!;
  };
  return { repo, markers, store, server, tab, wsId, build, review, settled };
}

/** The repo's branches. */
const branches = (repo: string) => fixtureGit(repo, 'branch', '--format=%(refname:short)').trim().split('\n').sort();

describe('Unattended builds over REST (story 5.2)', () => {
  it('with Unattended builds off, POST builds is 409 feature_off: no worktree, branch or session', async () => {
    const { server, build, repo, wsId, tab } = await setup({ builds: false });
    expect(await refusalOf(await build('1.1'))).toEqual({ status: 409, code: 'feature_off', message: FEATURE_OFF_MESSAGE });
    expect(existsSync(join(server.dataDir, 'w'))).toBe(false);
    expect(branches(repo.path)).toEqual(['main']);
    expect(server.core.entities.listSessions(wsId)).toEqual([]);
    // Every builds route is behind the guard.
    expect((await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceBuild, { wsId, ref: '1.1' }))).status).toBe(409);
  });

  it('refuses an unmet prerequisite, no sandbox, an uncommitted plan and a ticket not ready, writing nothing', async () => {
    const { server, build, repo, wsId } = await setup();
    expect((await refusalOf(await build('1.2'))).code).toBe('prerequisite_unmet');
    writeFileSync(join(repo.path, ...FAKE_BUILD_PLAN.split('/')), readFileSync(join(repo.path, ...FAKE_BUILD_PLAN.split('/')), 'utf8') + '\nA note.\n');
    expect((await refusalOf(await build('1.1'))).code).toBe('plan_uncommitted');
    fixtureGit(repo.path, 'checkout', '--', FAKE_BUILD_PLAN);
    // Another uncommitted change doesn't block dispatch.
    writeFileSync(join(repo.path, 'scratch.txt'), 'mine\n');
    fixtureGit(repo.path, 'commit', '--quiet', '--no-verify', '--allow-empty', '-m', 'nothing');
    const markDraft = readFileSync(join(repo.path, ...FAKE_BUILD_PLAN.split('/')), 'utf8').replace('status: ready-for-dev', 'status: draft');
    writeFileSync(join(repo.path, ...FAKE_BUILD_PLAN.split('/')), markDraft);
    fixtureGit(repo.path, 'commit', '--quiet', '--no-verify', '-am', 'draft');
    expect((await refusalOf(await build('1.1'))).code).toBe('not_ready');
    expect(existsSync(join(server.dataDir, 'w')) ? readdirSync(join(server.dataDir, 'w')) : []).toEqual([]);
    expect(branches(repo.path)).toEqual(['main']);
    expect(server.core.entities.listSessions(wsId)).toEqual([]);

    const closed = await setup({ sandbox: false });
    expect((await refusalOf(await closed.build('1.1'))).code).toBe('sandbox_unavailable');
    expect(branches(closed.repo.path)).toEqual(['main']);
  });

  it('builds in a worktree under the data folder, ends verified, and Approve merges once with the plan done and no hook run', async () => {
    const { server, tab, wsId, build, review, settled, repo, markers, store } = await setup();
    const started = await build('1.1');
    expect(started.status).toBe(201);
    const { run, session } = BuildResponse.parse(await started.json());
    expect(session.kind).toBe('build');
    expect(run.branch).toMatch(/^ogden\/[a-z2-7]{8}\/1\.1-build-the-thing$/);
    expect(run.sandbox).toBe('test');
    const worktree = run.worktreePath!;
    const data = realpathSync.native(server.dataDir);
    expect(relative(join(data, 'w'), worktree)).toMatch(/^[a-z2-7]{8}$/);
    expect(relative(realpathSync.native(repo.path), worktree).startsWith('..')).toBe(true);
    expect(SessionRunResponse.parse(await (await request(server, tab, 'GET', apiPath(API_ROUTES.sessionRun, { wsId, sesId: session.id }))).json()).run.id).toBe(run.id);
    // A build session is read-only: no message, mode or driver from the API.
    expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId, sesId: session.id }), { text: 'hello' })).status).toBe(409);
    expect((await refusalOf(await build('1.1'))).code).toBe('run_active');

    const ended = await settled('1.1');
    expect(ended.outcome).toBe('verified');
    expect(ended.files).toEqual(expect.arrayContaining([FAKE_BUILD_PLAN, 'src/built-1.1.txt']));
    expect(ended.diff).toContain('Built 1.1 by the fake agent.');
    expect(ended.merged).toBe(false);
    // The write inside the worktree was allowed; the one outside it refused.
    expect(existsSync(join(worktree, 'src', 'built-1.1.txt'))).toBe(true);
    expect(existsSync(join(data, 'w', 'escape-1.1.txt'))).toBe(false);
    const transcript = server.core.events.readAfter(0).filter((event) => event.streamId === session.id);
    expect(transcript.some((event) => event.type === 'session.tool_call_updated' && event.payload.toolCallId === 'call-build-escape' && event.payload.status === 'failed')).toBe(true);

    // Dirty outside _bmad-output: refused, nothing merged.
    const head = fixtureGit(repo.path, 'rev-parse', 'HEAD').trim();
    writeFileSync(join(repo.path, 'notes.txt'), 'mine\n');
    expect((await refusalOf(await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceBuildApprove, { wsId, ref: '1.1' }), { revision: (await review('1.1')).headRevision }))).code).toBe('checkout_dirty');
    expect(fixtureGit(repo.path, 'rev-parse', 'HEAD').trim()).toBe(head);
    // Uncommitted changes under _bmad-output never block it.
    fixtureGit(repo.path, 'clean', '-fq', '--', 'notes.txt');
    writeFileSync(join(repo.path, '_bmad-output', 'scratch.md'), '# Mine\n');

    const approved = await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceBuildApprove, { wsId, ref: '1.1' }), { revision: (await review('1.1')).headRevision });
    expect(approved.status).toBe(200);
    expect(ReviewResponse.parse(await approved.json()).merged).toBe(true);
    // One merge commit on the checked-out branch, with the change and the plan done.
    expect(fixtureGit(repo.path, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main');
    expect(fixtureGit(repo.path, 'rev-list', '--parents', '-n', '1', 'HEAD').trim().split(' ')).toHaveLength(3);
    expect(fixtureGit(repo.path, 'rev-parse', 'HEAD^1').trim()).toBe(head);
    expect(readFileSync(join(repo.path, 'src', 'built-1.1.txt'), 'utf8')).toContain('Built 1.1');
    expect(fixtureGit(repo.path, 'show', `HEAD:${FAKE_BUILD_PLAN}`)).toMatch(/^status: done$/m);
    expect(fixtureGit(repo.path, 'status', '--porcelain').trim()).toBe('?? _bmad-output/scratch.md');
    expect(store.marks).toEqual([{ repoPath: server.core.entities.getWorkspace(wsId)!.realPath, ref: '1.1', status: 'done', approve: true }]);
    // No hook ran: neither the repo's (husky's folder) nor the ones the agent wrote into its branch.
    expect(existsSync(join(repo.path, '.husky', 'post-merge'))).toBe(true);
    expect(readdirSync(markers)).toEqual([]);
    // The worktree is gone, the branch kept; a second Approve is refused.
    expect(existsSync(worktree)).toBe(false);
    expect(branches(repo.path)).toEqual(['main', run.branch]);
    expect((await review('1.1')).merged).toBe(true);
    expect((await refusalOf(await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceBuildApprove, { wsId, ref: '1.1' }), { revision: (await review('1.1')).headRevision }))).code).toBe('checks_failed');
  });

  it('a conflicting merge is aborted with the checkout unchanged and blocks the run; Reject keeps the branch and the ticket', async () => {
    const { tab, server, wsId, build, settled, review, repo, store } = await setup();
    const { run } = BuildResponse.parse(await (await build('1.1')).json());
    expect((await settled('1.1')).outcome).toBe('verified');
    // The checkout added the same file meanwhile, with other contents.
    const conflicting = join(repo.path, 'src', 'built-1.1.txt');
    mkdirSync(join(repo.path, 'src'), { recursive: true });
    writeFileSync(conflicting, 'Something else entirely.\n');
    fixtureGit(repo.path, 'add', '-A');
    fixtureGit(repo.path, 'commit', '--quiet', '--no-verify', '-m', 'Meanwhile');
    const head = fixtureGit(repo.path, 'rev-parse', 'HEAD').trim();

    const refused = await refusalOf(await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceBuildApprove, { wsId, ref: '1.1' }), { revision: (await review('1.1')).headRevision }));
    expect(refused).toEqual({ status: 409, code: 'merge_conflict', message: MERGE_CONFLICT_MESSAGE });
    expect(fixtureGit(repo.path, 'rev-parse', 'HEAD').trim()).toBe(head);
    expect(fixtureGit(repo.path, 'status', '--porcelain').trim()).toBe('');
    expect(readFileSync(conflicting, 'utf8')).toBe('Something else entirely.\n');
    expect(server.core.entities.getRun(run.id)).toMatchObject({ outcome: 'blocked', reason: MERGE_CONFLICT_MESSAGE });
    expect(store.marks).toEqual([]);

    const rejected = await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceBuildReject, { wsId, ref: '1.1' }));
    expect(rejected.status).toBe(200);
    expect(ReviewResponse.parse(await rejected.json()).outcome).toBe('stopped');
    expect(existsSync(run.worktreePath!)).toBe(false);
    expect(branches(repo.path)).toEqual(['main', run.branch]);
    expect(store.marks).toEqual([]);
    expect(readFileSync(join(repo.path, ...FAKE_BUILD_PLAN.split('/')), 'utf8')).toMatch(/^status: ready-for-dev$/m);
  });

  it('a run whose plan ends blocked is blocked with the plan reason, and cannot be approved', async () => {
    const repo = buildRepo();
    const server = await startTestServer({
      ticketStore: createPlanFileTicketStore(TICKETS) as unknown as TicketStorePort,
      sandbox: createFixedSandbox({ available: true, kind: 'test' }),
      extraAgentEnv: { FAKE_ACP_BUILD_OUTCOME: 'blocked', FAKE_ACP_CHUNK_DELAY_MS: '1' },
    });
    const tab = await signIn(server);
    const wsId = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo.path })).json()).workspace.id;
    await request(server, tab, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['board', 'builds'] });
    await request(server, tab, 'PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }));
    expect((await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceBuilds, { wsId }), { ref: '1.1' })).status).toBe(201);
    let review: ReviewResponse | undefined;
    await waitFor(async () => (review = ReviewResponse.parse(await (await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceBuild, { wsId, ref: '1.1' }))).json())).outcome !== 'running', 'the run to end', 15_000);
    expect(review).toMatchObject({ outcome: 'blocked', reason: `The fake agent was told to block. ${RUN_REASON_NO_NETWORK}` });
    expect((await refusalOf(await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceBuildApprove, { wsId, ref: '1.1' }), { revision: review!.headRevision }))).code).toBe('checks_failed');
  });

  it('a run left running by a stopped server is blocked as interrupted at the next start, its worktree kept', async () => {
    const { server, build } = await setup();
    const dataDir = server.dataDir;
    const { run } = BuildResponse.parse(await (await build('1.1')).json());
    // As a crash leaves it: the row still running when the server starts again.
    await server.close();
    const { openCore } = await import('@ogden-agents/core');
    const core = openCore(dataDir);
    core.entities.setRunOutcome(run.id, 'running');
    core.close();
    const again = await startTestServer({ dataDir, sandbox: createFixedSandbox({ available: true, kind: 'test' }) });
    expect(again.core.entities.getRun(run.id)).toMatchObject({ outcome: 'blocked', reason: 'interrupted' });
    expect(existsSync(run.worktreePath!)).toBe(true);
  });
});
