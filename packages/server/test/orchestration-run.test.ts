/**
 * The Orchestration tracer over REST (epic 15, story 15.3): a real server, the
 * real chat and the fake ACP agent as the worker, and the fake manager. A goal
 * becomes a plan, an unapproved step cannot be sent (nothing is created), an
 * approved one reaches a new worker chat whose transcript shows it as the
 * manager's at the user's approval, and the status reads back masked and
 * capped. With the piece off, every route answers `feature_off`; with no
 * manager the answer is plainly "no manager yet".
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryManager } from '@ogden-agents/adapters';
import {
  API_ROUTES,
  ApiErrorBody,
  apiPath,
  MANAGER_LIMITS,
  ORCHESTRATION_NO_MANAGER_MESSAGE,
  ORCHESTRATION_OFF_MESSAGE,
  ORCHESTRATION_STEP_NOT_APPROVED_MESSAGE,
  OrchestrationRunResponse,
  OrchestrationRunsResponse,
  OrchestrationSettingsResponse,
  SessionsResponse,
  WorkspaceResponse,
  type OrchestrationRunView,
} from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { signIn, startTestServer, waitFor, type SignedIn, type TestServer } from './helpers.js';

const repos: string[] = [];
const servers: TestServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const request = (server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) =>
  fetch(`${server.url}${path}`, { method, headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const refusalOf = async (reply: Response) => ({ status: reply.status, ...ApiErrorBody.parse(await reply.json()).error });

async function setUp({ manager = true, on = true }: { manager?: boolean; on?: boolean } = {}) {
  const server = await startTestServer({ ...(manager ? { manager: createMemoryManager() } : {}) });
  servers.push(server);
  const tab = await signIn(server);
  const repo = realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-agents-repo-')));
  repos.push(repo);
  const { workspace } = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json());
  if (on) expect((await request(server, tab, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId: workspace.id }), { orchestrationEnabled: true })).status).toBe(200);
  const wsId = workspace.id;
  const runs = apiPath(API_ROUTES.workspaceOrchestrationRuns, { wsId });
  const at = (runId: string) => apiPath(API_ROUTES.workspaceOrchestrationRun, { wsId, runId });
  const step = (kind: 'approve' | 'dispatch', runId: string, stepId: string) =>
    apiPath(kind === 'approve' ? API_ROUTES.workspaceOrchestrationStepApprove : API_ROUTES.workspaceOrchestrationStepDispatch, { wsId, runId, stepId });
  const sessions = async () => SessionsResponse.parse(await (await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceSessions, { wsId }))).json()).sessions;
  const start = async (goal = 'Add a contact form') => OrchestrationRunResponse.parse(await (await request(server, tab, 'POST', runs, { goal })).json()).run;
  return { server, tab, wsId, runs, at, step, sessions, start };
}

describe('the tracer path', () => {
  it('a goal becomes a plan, an unapproved step is refused, an approved one reaches a worker chat as the manager\'s, and the status reads back', async () => {
    const { server, tab, wsId, runs, at, step, sessions, start } = await setUp();
    const settings = OrchestrationSettingsResponse.parse(await (await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceOrchestration, { wsId }))).json()).settings;
    expect(settings.managerReady).toBe(true);

    const view = await start();
    expect(view.run).toMatchObject({ state: 'awaiting_user', goal: 'Add a contact form', mode: 'approve_each' });
    expect(view.steps).toHaveLength(1);
    const first = view.steps[0]!;
    expect(first).toMatchObject({ stepId: 's1', state: 'proposed', worker: 'claude-code', workerLabel: 'Claude Code' });
    const runId = view.run.id;

    // A direct call to send a step nobody approved is refused, and no chat appears.
    const before = server.core.events.lastSeq();
    expect(await refusalOf(await request(server, tab, 'POST', step('dispatch', runId, 's1')))).toEqual({ status: 409, code: 'step_not_approved', message: ORCHESTRATION_STEP_NOT_APPROVED_MESSAGE });
    expect(await sessions()).toEqual([]);
    expect(server.core.events.lastSeq()).toBe(before);

    // Approve (the user's call), then send.
    const approved = OrchestrationRunResponse.parse(await (await request(server, tab, 'POST', step('approve', runId, 's1'))).json()).run;
    expect(approved.steps[0]).toMatchObject({ state: 'approved', approvedBy: 'user' });
    const sent = OrchestrationRunResponse.parse(await (await request(server, tab, 'POST', step('dispatch', runId, 's1'))).json()).run;
    const sessionId = sent.steps[0]!.sessionId!;
    expect(sent.steps[0]).toMatchObject({ state: 'dispatched' });
    expect((await sessions()).map((session) => [session.id, session.agentId, session.permissionMode ?? 'ask'])).toEqual([[sessionId, 'claude-code', 'ask']]);

    // The worker answers; the status reads back as done with its summary.
    await waitFor(async () => (OrchestrationRunResponse.parse(await (await request(server, tab, 'GET', at(runId))).json()).run.steps[0]!.state === 'done'), 'the step to be done');
    const done: OrchestrationRunView = OrchestrationRunResponse.parse(await (await request(server, tab, 'GET', at(runId))).json()).run;
    expect(done.steps[0]).toMatchObject({ state: 'done', sessionState: 'idle', report: { state: 'idle', summary: 'Hello from the fake agent.', truncated: false } });
    expect(OrchestrationRunsResponse.parse(await (await request(server, tab, 'GET', runs)).json()).runs.map((run) => run.run.id)).toEqual([runId]);

    // The worker chat's transcript holds the instruction as the manager's, and the events of the run.
    const messages = server.core.events.readAfter(0).filter((event) => event.type === 'session.message_completed' && event.streamId === sessionId);
    expect(messages.map((event) => (event.type === 'session.message_completed' ? [event.payload.role, event.payload.origin, event.payload.content] : []))).toEqual([
      ['user', 'manager', 'Work on the goal as Claude Code.'],
      ['agent', undefined, 'Hello from the fake agent.'],
    ]);
    expect(server.core.events.readAfter(0).filter((event) => event.type.startsWith('orchestration.')).map((event) => event.type)).toEqual([
      'orchestration.run_started',
      'orchestration.plan_proposed',
      'orchestration.step_proposed',
      'orchestration.step_approved',
      'orchestration.step_dispatched',
      'orchestration.result_read',
    ]);
  });

  it('a user cannot mark their own chat message as the manager\'s through the chat route', async () => {
    const { server, tab, wsId, start, step } = await setUp();
    const view = await start();
    await request(server, tab, 'POST', step('approve', view.run.id, 's1'));
    const sessionId = OrchestrationRunResponse.parse(await (await request(server, tab, 'POST', step('dispatch', view.run.id, 's1'))).json()).run.steps[0]!.sessionId!;
    await waitFor(() => server.core.entities.getSession(sessionId)?.state === 'idle', 'the worker to be idle');
    const reply = await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId, sesId: sessionId }), { text: 'hello', origin: 'manager' });
    expect(reply.status).toBeLessThan(300);
    await waitFor(() => server.core.entities.getSession(sessionId)?.state === 'idle', 'the second turn to end');
    const users = server.core.events.readAfter(0).filter((event) => event.type === 'session.message_completed' && event.streamId === sessionId && event.payload.role === 'user');
    expect(users.map((event) => (event.type === 'session.message_completed' ? event.payload.origin : 'x'))).toEqual(['manager', undefined]);
  });
});

describe('the refusals', () => {
  it('with the piece off, every orchestration route answers feature_off and nothing is stored', async () => {
    const { server, tab, runs, at, step } = await setUp({ on: false });
    const before = server.core.events.lastSeq();
    const off = { status: 409, code: 'feature_off', message: ORCHESTRATION_OFF_MESSAGE };
    expect(await refusalOf(await request(server, tab, 'POST', runs, { goal: 'Add a form' }))).toEqual(off);
    expect(await refusalOf(await request(server, tab, 'GET', runs))).toEqual(off);
    expect(await refusalOf(await request(server, tab, 'GET', at('orc_01J9Z3K4M5N6P7Q8R9S0T1V2W3')))).toEqual(off);
    expect(await refusalOf(await request(server, tab, 'POST', step('approve', 'orc_01J9Z3K4M5N6P7Q8R9S0T1V2W3', 's1')))).toEqual(off);
    expect(await refusalOf(await request(server, tab, 'POST', step('dispatch', 'orc_01J9Z3K4M5N6P7Q8R9S0T1V2W3', 's1')))).toEqual(off);
    expect(server.core.events.lastSeq()).toBe(before);
  });

  it('with no manager set up the answer is plainly "no manager yet", and nothing is stored', async () => {
    const { server, tab, wsId, runs } = await setUp({ manager: false });
    const settings = OrchestrationSettingsResponse.parse(await (await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceOrchestration, { wsId }))).json()).settings;
    expect(settings.managerReady).toBe(false);
    const before = server.core.events.lastSeq();
    expect(await refusalOf(await request(server, tab, 'POST', runs, { goal: 'Add a form' }))).toEqual({ status: 409, code: 'manager_unavailable', message: ORCHESTRATION_NO_MANAGER_MESSAGE });
    expect(server.core.events.lastSeq()).toBe(before);
  });

  it('refuses a missing, empty, non text or too long goal, an unknown run, and a run of another project', async () => {
    const { server, tab, wsId, runs, at, start } = await setUp();
    for (const body of [{}, { goal: '' }, { goal: '   ' }, { goal: 5 }, { goal: 'x'.repeat(MANAGER_LIMITS.maxGoalChars + 1) }]) {
      expect((await request(server, tab, 'POST', runs, body)).status).toBe(400);
    }
    const huge = await request(server, tab, 'POST', runs, { goal: 'x'.repeat(20_000) });
    expect(huge.status).toBe(413);
    expect((await request(server, tab, 'GET', at('orc_01J9Z3K4M5N6P7Q8R9S0T1V2W3'))).status).toBe(404);
    expect((await request(server, tab, 'GET', at('nope'))).status).toBe(404);
    const view = await start();
    const repo = realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-agents-repo-')));
    repos.push(repo);
    const other = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json()).workspace;
    await request(server, tab, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId: other.id }), { orchestrationEnabled: true });
    expect((await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceOrchestrationRun, { wsId: other.id, runId: view.run.id }))).status).toBe(404);
    expect(wsId).not.toBe(other.id);
  });

  it('is behind the gate like every API route', async () => {
    const { server, runs } = await setUp();
    expect((await fetch(`${server.url}${runs}`)).status).toBe(401);
  });
});
