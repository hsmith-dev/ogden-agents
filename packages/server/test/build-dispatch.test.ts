/**
 * Story 5.8 over REST, on a real server with the fake ACP agent, real git on
 * a fixture repo that has a test command, and a ticket store reading the
 * plan files: the verification re-run (a build whose tests fail when re-run
 * ends failed), Stop and Retry, Build all ready, and the build and run-limit
 * settings. No real `claude`, keychain or network.
 */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFixedSandbox } from '@ogden-agents/adapters';
import type { TicketStorePort } from '@ogden-agents/core';
import {
  AllReadyBuildsResponse,
  API_ROUTES,
  ApiErrorBody,
  apiPath,
  BuildResponse,
  ReviewResponse,
  RunLimitSettingsResponse,
  RunResponse,
  WorkspaceBuildSettingsResponse,
  WorkspaceResponse,
  RUN_REASON_STOPPED,
} from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { createFakeBmadRepo, FAKE_BUILD_PLAN, FAKE_BUILD_REPO_FILES, FAKE_BUILD_WAITING_PLAN } from '../../../tests/fixtures/fake-bmad-repo.js';
import { createPlanFileTicketStore } from '../../../tests/fixtures/plan-file-ticket-store.js';
import { removeAfterTest, signIn, startTestServer, waitFor, type SignedIn, type TestServer } from './helpers.js';

function request(server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) {
  return fetch(`${server.url}${path}`, {
    method,
    headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const refusalOf = async (reply: Response) => ({ status: reply.status, ...ApiErrorBody.parse(await reply.json()).error });

const TICKETS = [
  { ref: '1.1', title: 'Build the thing', plan: FAKE_BUILD_PLAN },
  { ref: '1.2', title: 'Build the next thing', plan: FAKE_BUILD_WAITING_PLAN, after: [1] },
];

async function setup(env: Record<string, string> = {}) {
  const repo = createFakeBmadRepo({ git: true, files: FAKE_BUILD_REPO_FILES, prefix: 'ogden-agents-dispatch-repo-' });
  removeAfterTest(repo.path);
  const server = await startTestServer({
    ticketStore: createPlanFileTicketStore(TICKETS) as unknown as TicketStorePort,
    sandbox: createFixedSandbox({ available: true, kind: 'test' }),
    extraAgentEnv: { FAKE_ACP_CHUNK_DELAY_MS: '1', ...env },
  });
  const tab = await signIn(server);
  const wsId = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo.path })).json()).workspace.id;
  expect((await request(server, tab, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['board', 'builds'] })).status).toBe(200);
  expect((await request(server, tab, 'PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }))).status).toBe(200);
  const review = async (ref: string) => ReviewResponse.parse(await (await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceBuild, { wsId, ref }))).json());
  const settled = async (ref: string) => {
    let last: ReviewResponse | undefined;
    await waitFor(async () => (last = await review(ref)).outcome !== 'running', `the run of ${ref} to end`, 20_000);
    return last!;
  };
  const build = (body: unknown) => request(server, tab, 'POST', apiPath(API_ROUTES.workspaceBuilds, { wsId }), body);
  return { repo, server, tab, wsId, review, settled, build };
}

describe('verification re-runs the tests (story 5.8)', () => {
  it('a build whose plan says built but whose tests fail when re-run ends failed with the count, and cannot be approved', async () => {
    const s = await setup({ FAKE_ACP_BUILD_FAIL_TESTS: '1' });
    const { run } = BuildResponse.parse(await (await s.build({ ref: '1.1' })).json());
    const ended = await s.settled('1.1');
    expect(ended).toMatchObject({ outcome: 'failed', reason: '3 tests failed when re-run' });
    expect(ended.run.id).toBe(run.id);
    const event = s.server.core.entities.listSessionEvents(run.sessionId, ['run.verification_completed']).at(-1);
    expect(event?.type === 'run.verification_completed' ? event.payload.verification : undefined).toMatchObject({ outcome: 'failed', testCommand: 'npm test', testOutputTail: expect.stringContaining('3 failed') });
    const approved = await request(s.server, s.tab, 'POST', apiPath(API_ROUTES.workspaceBuildApprove, { wsId: s.wsId, ref: '1.1' }), { revision: ended.headRevision });
    expect(await refusalOf(approved)).toMatchObject({ status: 409, code: 'checks_failed' });
  });

  it('a build whose tests pass when re-run is verified', async () => {
    const s = await setup();
    BuildResponse.parse(await (await s.build({ ref: '1.1' })).json());
    const ended = await s.settled('1.1');
    expect(ended.outcome).toBe('verified');
    const event = s.server.core.entities.listSessionEvents(ended.run.sessionId, ['run.verification_completed']).at(-1);
    expect(event?.type === 'run.verification_completed' ? event.payload.verification.checks.map((check) => check.result) : []).toEqual(['pass', 'pass', 'pass']);
  });
});

describe('Stop, Retry and Build all ready (story 5.8)', () => {
  it('Stop stops a running build and its command, Retry runs it again in its worktree, and it ends verified', async () => {
    const pids = join(removeAfterTest(mkdtempSync(join(tmpdir(), 'ogden-agents-pids-'))), 'pids.txt');
    const s = await setup({ FAKE_ACP_BUILD_CHILD: pids, FAKE_ACP_BUILD_DELAY_MS: '400' });
    const { run } = BuildResponse.parse(await (await s.build({ ref: '1.1' })).json());
    await waitFor(async () => existsSync(pids) && readFileSync(pids, 'utf8').trim().split(' ').length === 2, 'the agent to start its command', 15_000);
    const [agentPid, childPid] = readFileSync(pids, 'utf8').trim().split(' ').map(Number) as [number, number];
    const stopped = RunResponse.parse(await (await request(s.server, s.tab, 'POST', apiPath(API_ROUTES.runStop, { wsId: s.wsId, runId: run.id }))).json()).run;
    expect(stopped).toMatchObject({ outcome: 'stopped', reason: RUN_REASON_STOPPED });
    await waitFor(async () => !alive(agentPid) && !alive(childPid), 'the agent and its command to be gone', 10_000);
    expect(await refusalOf(await request(s.server, s.tab, 'POST', apiPath(API_ROUTES.runStop, { wsId: s.wsId, runId: run.id })))).toMatchObject({ status: 409, code: 'run_not_active' });

    const retried = RunResponse.parse(await (await request(s.server, s.tab, 'POST', apiPath(API_ROUTES.runRetry, { wsId: s.wsId, runId: run.id }), {})).json()).run;
    expect(retried).toMatchObject({ id: run.id, outcome: 'running', worktreePath: run.worktreePath });
    expect((await s.settled('1.1')).outcome).toBe('verified');
  });

  it('Build all ready starts the ready ticket (202 with the runs and the queue), never the one waiting for it', async () => {
    const s = await setup();
    const reply = await s.build({ all: true });
    expect(reply.status).toBe(202);
    const all = AllReadyBuildsResponse.parse(await reply.json());
    expect(all.runs.map((run) => run.ticketRef)).toEqual(['1.1']);
    expect(all.queue).toEqual([]);
    expect((await s.settled('1.1')).outcome).toBe('verified');
    // 1.2 waits for 1.1 to be merged: a build is the agent's own word until then, so nothing more starts.
    expect((await refusalOf(await request(s.server, s.tab, 'GET', apiPath(API_ROUTES.workspaceBuild, { wsId: s.wsId, ref: '1.2' })))).status).toBe(404);
    expect(await refusalOf(await s.build({ all: true, ref: '1.1' }))).toMatchObject({ status: 400 });
  }, 40_000);
});

describe('settings (story 5.8)', () => {
  it("the project's build settings and the install's run limits are read and changed within their bounds", async () => {
    const s = await setup();
    const url = apiPath(API_ROUTES.workspaceBuildSettings, { wsId: s.wsId });
    expect(WorkspaceBuildSettingsResponse.parse(await (await request(s.server, s.tab, 'GET', url)).json()).settings).toEqual({ maxConcurrentRuns: 2, testCommand: null });
    expect(WorkspaceBuildSettingsResponse.parse(await (await request(s.server, s.tab, 'PATCH', url, { maxConcurrentRuns: 3, testCommand: 'make check' })).json()).settings).toEqual({ maxConcurrentRuns: 3, testCommand: 'make check' });
    for (const bad of [{ maxConcurrentRuns: 0 }, { maxConcurrentRuns: 11 }, {}, { testCommand: 'a\nb' }, { other: 1 }]) {
      expect((await request(s.server, s.tab, 'PATCH', url, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect(RunLimitSettingsResponse.parse(await (await request(s.server, s.tab, 'GET', API_ROUTES.runLimits)).json()).settings).toEqual({ maxConcurrentRunsPerInstall: 3, maxRunMinutes: 45 });
    expect(RunLimitSettingsResponse.parse(await (await request(s.server, s.tab, 'PATCH', API_ROUTES.runLimits, { maxRunMinutes: 90 })).json()).settings).toEqual({ maxConcurrentRunsPerInstall: 3, maxRunMinutes: 90 });
    for (const bad of [{ maxRunMinutes: 4 }, { maxConcurrentRunsPerInstall: 21 }, {}, 'text']) {
      expect((await request(s.server, s.tab, 'PATCH', API_ROUTES.runLimits, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    // With builds off for the project, its settings are behind the piece's guard; the install's limits are not.
    expect((await request(s.server, s.tab, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId: s.wsId }), { bmadPieces: [] })).status).toBe(200);
    expect((await refusalOf(await request(s.server, s.tab, 'GET', url))).code).toBe('feature_off');
    expect((await request(s.server, s.tab, 'GET', API_ROUTES.runLimits)).status).toBe(200);
  });
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
