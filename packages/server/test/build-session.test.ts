/**
 * The headless build session's own record and pauses (story 5.4), on a real
 * server with the real `acp-claude-code` adapter playing the fake ACP
 * agent's build mode, real `git` on a fixture repo, a ticket store reading
 * the plan files, and a fixed sandbox (no real sandbox, `claude`, keychain
 * or network):
 *
 * - a run's NDJSON activity and per-run JSON result land in its folder in the
 *   data folder (`<data>/r/<runId>`), the result's status is the plan's, and
 *   the repo gets nothing new;
 * - a halt's result names the skill's condition and the intent-gap patch;
 * - `plan_checkpoint` pauses the run before its prompt is sent, and Retry
 *   resumes it (also after a server restart, in a fresh agent session);
 *   `done_checkpoint` pauses it once the plan is `built`, before the end
 *   checks; a paused run blocks a second Build of its ticket;
 * - Retry of a run not at a checkpoint is 501 (5.8);
 * - the run's agent and a command it left running are gone once the run ends.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAcpBuildRunner, createFixedSandbox } from '@ogden-agents/adapters';
import type { TicketStorePort } from '@ogden-agents/core';
import {
  API_ROUTES,
  ApiErrorBody,
  apiPath,
  BUILD_ACTIVITY_FILE,
  BUILD_RESULT_FILE,
  BuildResponse,
  BuildRunResult,
  blockedSentence,
  ReviewResponse,
  RunResponse,
  runPhase,
  WorkspaceResponse,
  type RunId,
} from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { createFakeBmadRepo, FAKE_BUILD_PLAN, FAKE_BUILD_TICKET_FILES, FAKE_BUILD_WAITING_PLAN, fixtureGit } from '../../../tests/fixtures/fake-bmad-repo.js';
import { createPlanFileTicketStore, type PlanFileTicket } from '../../../tests/fixtures/plan-file-ticket-store.js';
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

function tickets(checkpoints: Pick<PlanFileTicket, 'planCheckpoint' | 'doneCheckpoint'> = {}): PlanFileTicket[] {
  return [
    { ref: '1.1', title: 'Build the thing', plan: FAKE_BUILD_PLAN, ...checkpoints },
    { ref: '1.2', title: 'Build the next thing', plan: FAKE_BUILD_WAITING_PLAN, after: [1] },
  ];
}

/** Every file and folder under `root`, relative, except `.git`. */
function listing(root: string, prefix = ''): string[] {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.name === '.git') return [];
    return entry.isDirectory() ? [path, ...listing(root, path)] : [path];
  });
}

interface Setup {
  server: TestServer;
  tab: SignedIn;
  wsId: string;
  repo: string;
  build(ref: string): Promise<Response>;
  review(ref: string): Promise<ReviewResponse>;
  settled(ref: string): Promise<ReviewResponse>;
  retry(runId: string, body?: unknown): Promise<Response>;
}

async function serve(options: { repo: string; ticketList: PlanFileTicket[]; env?: Record<string, string>; dataDir?: string; wsId?: string }): Promise<Setup> {
  const server = await startTestServer({
    ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
    ticketStore: createPlanFileTicketStore(options.ticketList) as unknown as TicketStorePort,
    sandbox: createFixedSandbox({ available: true, kind: 'test' }),
    extraAgentEnv: { FAKE_ACP_CHUNK_DELAY_MS: '1', ...options.env },
  });
  const tab = await signIn(server);
  let wsId = options.wsId;
  if (wsId === undefined) {
    wsId = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: options.repo })).json()).workspace.id;
    expect((await request(server, tab, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['board', 'builds'] })).status).toBe(200);
    expect((await request(server, tab, 'PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }))).status).toBe(200);
  }
  const id = wsId;
  const review = async (ref: string) => ReviewResponse.parse(await (await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceBuild, { wsId: id, ref }))).json());
  return {
    server,
    tab,
    wsId: id,
    repo: options.repo,
    build: (ref) => request(server, tab, 'POST', apiPath(API_ROUTES.workspaceBuilds, { wsId: id }), { ref }),
    review,
    async settled(ref) {
      let last: ReviewResponse | undefined;
      await waitFor(async () => (last = await review(ref)).outcome !== 'running', `the run of ${ref} to stop`, 15_000);
      return last!;
    },
    retry: (runId, body = {}) => request(server, tab, 'POST', apiPath(API_ROUTES.runRetry, { wsId: id, runId }), body),
  };
}

async function setup(options: { ticketList?: PlanFileTicket[]; env?: Record<string, string> } = {}): Promise<Setup> {
  const repo = createFakeBmadRepo({ git: true, files: FAKE_BUILD_TICKET_FILES, prefix: 'ogden-agents-session-repo-' });
  removeAfterTest(repo.path);
  return serve({ repo: repo.path, ticketList: options.ticketList ?? tickets(), env: options.env });
}

/** The run's folder in the server's data folder. */
const runFolder = (server: TestServer, runId: string) => join(realpathSync.native(server.dataDir), 'r', runId);

async function resultOf(server: TestServer, runId: string, ref: string) {
  const read = await createAcpBuildRunner().readResult(runFolder(server, runId), { runId: runId as RunId, ticketRef: ref });
  expect(read, 'the per-run result').toBeDefined();
  return read!;
}

/** Whether process `pid` is still alive. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

describe('the headless build session (story 5.4)', () => {
  it("writes the run's NDJSON activity and per-run result in its folder in the data folder, and nothing new in the repo", async () => {
    const pids = join(removeAfterTest(mkdtempSync(join(tmpdir(), 'ogden-agents-pids-'))), 'pids.txt');
    const s = await setup({ env: { FAKE_ACP_BUILD_CHILD: pids } });
    const before = listing(s.repo).sort();
    const { run, session } = BuildResponse.parse(await (await s.build('1.1')).json());
    const ended = await s.settled('1.1');
    expect(ended.outcome).toBe('verified');
    const folder = runFolder(s.server, run.id);
    await waitFor(async () => existsSync(join(folder, BUILD_RESULT_FILE)), 'the result file', 10_000);

    const result = await resultOf(s.server, run.id, '1.1');
    expect(result).toMatchObject({ version: 1, runId: run.id, ticketRef: '1.1', status: 'built', baseRevision: run.baseRevision, blockedCondition: null, intentGapPatch: null, networkFailure: false });
    expect(result.commit).toBe(fixtureGit(s.repo, 'rev-parse', run.branch!).trim());
    expect(BuildRunResult.parse(JSON.parse(readFileSync(join(folder, BUILD_RESULT_FILE), 'utf8')))).toEqual(result);

    await waitFor(async () => readFileSync(join(folder, BUILD_ACTIVITY_FILE), 'utf8').includes('run.outcome_changed'), 'the outcome in the activity', 10_000);
    const lines = readFileSync(join(folder, BUILD_ACTIVITY_FILE), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { seq: number; type: string; payload: Record<string, unknown> });
    expect(lines.map((line) => line.seq)).toEqual([...lines.map((line) => line.seq)].sort((a, b) => a - b));
    const types = lines.map((line) => line.type);
    expect(types).toEqual(expect.arrayContaining(['session.tool_call', 'session.tool_call_updated', 'session.message_completed', 'run.outcome_changed']));
    expect(types).not.toContain('session.message_delta');
    expect(lines.every((line) => line.payload.sessionId === undefined || line.payload.sessionId === session.id)).toBe(true);

    // Nothing new in the repo: no worktree, no run folder, no file (git adds only the run's branch).
    expect(listing(s.repo).sort()).toEqual(before);
    expect(fixtureGit(s.repo, 'status', '--porcelain', '--ignored').trim()).toBe('');

    // The run's agent and the command it left running are gone once the run ended (its process tree stopped).
    const [agentPid, childPid] = readFileSync(pids, 'utf8').trim().split(' ').map(Number) as [number, number];
    await waitFor(async () => !alive(agentPid) && !alive(childPid), 'the agent and its child to be gone', 10_000);
  });

  it("a halt's result names the skill's condition, the run's reason and the intent-gap patch", async () => {
    const s = await setup({ env: { FAKE_ACP_BUILD_HALT: 'intent gap: what should the thing say?' } });
    const { run } = BuildResponse.parse(await (await s.build('1.1')).json());
    expect((await s.settled('1.1')).run.blockedCode).toBe('intent_gap');
    await waitFor(async () => existsSync(join(runFolder(s.server, run.id), BUILD_RESULT_FILE)), 'the result file', 10_000);
    const result = await resultOf(s.server, run.id, '1.1');
    expect(result).toMatchObject({ status: 'blocked', blockedCondition: 'intent gap: what should the thing say?', intentGapPatch: FAKE_BUILD_PLAN.replace(/\.md$/, '.patch') });
    expect(result.blockedReason).toContain('intent gap: what should the thing say?');
  });

  it('plan_checkpoint pauses before the prompt is sent, blocks a second Build, and Retry resumes it to the end', async () => {
    const s = await setup({ ticketList: tickets({ planCheckpoint: true }) });
    const started = await s.build('1.1');
    expect(started.status).toBe(201);
    const { run, session } = BuildResponse.parse(await started.json());
    expect(run).toMatchObject({ outcome: 'blocked', blockedCode: 'checkpoint_plan', reason: blockedSentence('checkpoint_plan') });
    expect(runPhase(run)).toBe('checkpoint');
    // Nothing was sent: no agent message, no build file.
    expect(s.server.core.events.readAfter(0).some((event) => event.streamId === session.id && event.type === 'session.message_completed')).toBe(false);
    expect(existsSync(join(run.worktreePath!, 'src', 'built-1.1.txt'))).toBe(false);
    await waitFor(async () => existsSync(join(runFolder(s.server, run.id), BUILD_RESULT_FILE)), 'the result file', 10_000);
    expect((await resultOf(s.server, run.id, '1.1')).status).toBe('ready-for-dev');
    expect((await refusalOf(await s.build('1.1'))).code).toBe('run_active');

    const resumed = await s.retry(run.id, { mode: 'resume' });
    expect(resumed.status).toBe(200);
    expect(RunResponse.parse(await resumed.json()).run.outcome).toBe('running');
    const ended = await s.settled('1.1');
    expect(ended.outcome).toBe('verified');
    await waitFor(async () => (await resultOf(s.server, run.id, '1.1')).status === 'built', 'the final result', 10_000);
    // Resuming a finished run: Retry is 5.8's (501); resume itself says it isn't at a checkpoint.
    expect((await refusalOf(await s.retry(run.id))).status).toBe(501);
    expect((await refusalOf(await s.retry('not-a-run'))).status).toBe(400);
  });

  it('a run paused at plan_checkpoint resumes after a server restart, in a fresh agent session', async () => {
    const repo = createFakeBmadRepo({ git: true, files: FAKE_BUILD_TICKET_FILES, prefix: 'ogden-agents-session-repo-' });
    removeAfterTest(repo.path);
    const first = await serve({ repo: repo.path, ticketList: tickets({ planCheckpoint: true }) });
    const { run } = BuildResponse.parse(await (await first.build('1.1')).json());
    expect(run.blockedCode).toBe('checkpoint_plan');
    const dataDir = first.server.dataDir;
    await first.server.close();

    const again = await serve({ repo: repo.path, ticketList: tickets({ planCheckpoint: true }), dataDir, wsId: first.wsId });
    // Still paused (not interrupted): the restart settles only running runs.
    expect(again.server.core.entities.getRun(run.id)).toMatchObject({ outcome: 'blocked', blockedCode: 'checkpoint_plan' });
    expect((await again.retry(run.id)).status).toBe(200);
    expect((await again.settled('1.1')).outcome).toBe('verified');
    expect(existsSync(join(run.worktreePath!, 'src', 'built-1.1.txt'))).toBe(true);
  });

  it('done_checkpoint pauses once the plan is built, before the end checks; Retry runs them', async () => {
    const s = await setup({ ticketList: tickets({ doneCheckpoint: true }) });
    const { run } = BuildResponse.parse(await (await s.build('1.1')).json());
    const paused = await s.settled('1.1');
    expect(paused.run).toMatchObject({ outcome: 'blocked', blockedCode: 'checkpoint_done', reason: blockedSentence('checkpoint_done') });
    await waitFor(async () => existsSync(join(runFolder(s.server, run.id), BUILD_RESULT_FILE)), 'the result file', 10_000);
    expect((await resultOf(s.server, run.id, '1.1')).status).toBe('built');
    const resumed = await s.retry(run.id);
    expect(resumed.status).toBe(200);
    expect(RunResponse.parse(await resumed.json()).run.outcome).toBe('verified');
  });
});
