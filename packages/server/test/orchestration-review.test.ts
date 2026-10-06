/**
 * The plan review over REST (epic 15, story 15.6): a real server, the real chat,
 * the fake ACP agent as the worker and a scripted fake manager with a three step
 * plan (s1 and s2 need nothing, s3 needs s2). Editing an approved step needs a
 * fresh approval, a skipped step never sends and its dependents wait, a reorder
 * that breaks a prerequisite is refused, Stop ends the run, and approval is the
 * user's alone: no body names an approver, and the gate refuses a call without
 * the tab's token.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryManager } from '@ogden-agents/adapters';
import { validatePlanFor, type ManagerPort } from '@ogden-agents/core';
import {
  API_ROUTES,
  ApiErrorBody,
  apiPath,
  MANAGER_PLAN_VERSION,
  ORCHESTRATION_OFF_MESSAGE,
  OrchestrationRunResponse,
  SessionResponse,
  SessionsResponse,
  WorkspaceResponse,
  type OrchestrationRunView,
} from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { signIn, startTestServer, waitFor, type TestServer } from './helpers.js';

const repos: string[] = [];
const servers: TestServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const PLAN3 = {
  version: MANAGER_PLAN_VERSION,
  goal: 'Add a contact form',
  steps: [
    { id: 's1', worker: 'claude-code', chat: 'new', instruction: 'Write the failing test first.', mode: 'ask', depends_on: [] },
    { id: 's2', worker: 'claude-code', chat: 'new', instruction: 'Add the form fields.', mode: 'ask', depends_on: [] },
    { id: 's3', worker: 'claude-code', chat: 'new', instruction: 'Wire the form to the page.', mode: 'ask', depends_on: ['s2'] },
  ],
};

async function setUp({ on = true, manager = createMemoryManager({ plans: [PLAN3] }) as ManagerPort }: { on?: boolean; manager?: ManagerPort } = {}) {
  const server = await startTestServer({ manager });
  servers.push(server);
  const tab = await signIn(server);
  const repo = realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-agents-repo-')));
  repos.push(repo);
  const { workspace } = WorkspaceResponse.parse(await (await post(server, tab, API_ROUTES.workspaces, { path: repo })).json());
  const wsId = workspace.id;
  if (on) expect((await request(server, tab, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { orchestrationEnabled: true })).status).toBe(200);
  const route = (key: 'workspaceOrchestrationStepApprove' | 'workspaceOrchestrationStepDispatch' | 'workspaceOrchestrationStepEdit' | 'workspaceOrchestrationStepSkip', runId: string, stepId: string) =>
    apiPath(API_ROUTES[key], { wsId, runId, stepId });
  const runRoute = (key: 'workspaceOrchestrationReorder' | 'workspaceOrchestrationStop' | 'workspaceOrchestrationRun', runId: string) => apiPath(API_ROUTES[key], { wsId, runId });
  const view = async (reply: Response): Promise<OrchestrationRunView> => OrchestrationRunResponse.parse(await reply.json()).run;
  const sessions = async () => SessionsResponse.parse(await (await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceSessions, { wsId }))).json()).sessions;
  const start = async () => view(await post(server, tab, apiPath(API_ROUTES.workspaceOrchestrationRuns, { wsId }), { goal: 'Add a contact form' }));
  return { server, tab, wsId, route, runRoute, view, sessions, start };
}
type Tab = Awaited<ReturnType<typeof signIn>>;
const request = (server: TestServer, tab: Tab, method: string, path: string, body?: unknown) =>
  fetch(`${server.url}${path}`, { method, headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const post = (server: TestServer, tab: Tab, path: string, body?: unknown) => request(server, tab, 'POST', path, body);
const refusalOf = async (reply: Response) => ({ status: reply.status, ...ApiErrorBody.parse(await reply.json()).error });

describe('the plan review over REST', () => {
  it('an edit of an approved step needs a fresh approval, and a direct send is refused until then', async () => {
    const { server, tab, route, view, sessions, start } = await setUp();
    const { run } = await start();
    await post(server, tab, route('workspaceOrchestrationStepApprove', run.id, 's1'));
    const edited = await view(await post(server, tab, route('workspaceOrchestrationStepEdit', run.id, 's1'), { instruction: 'Write two failing tests first.' }));
    expect(edited.steps[0]).toMatchObject({ stepId: 's1', state: 'proposed', approvedBy: null, instruction: 'Write two failing tests first.' });
    expect((await refusalOf(await post(server, tab, route('workspaceOrchestrationStepDispatch', run.id, 's1')))).code).toBe('step_not_approved');
    expect(await sessions()).toEqual([]);
    await post(server, tab, route('workspaceOrchestrationStepApprove', run.id, 's1'));
    const sent = await view(await post(server, tab, route('workspaceOrchestrationStepDispatch', run.id, 's1')));
    expect(sent.steps[0]).toMatchObject({ state: 'dispatched' });
    const types = server.core.events.readAfter(0).filter((event) => event.type.startsWith('orchestration.')).map((event) => event.type);
    expect(types.filter((type) => type === 'orchestration.step_approved')).toHaveLength(2);
    expect(types).toContain('orchestration.step_edited');
    // The worker was sent the edited text.
    const sentText = server.core.events.readAfter(0).filter((event) => event.type === 'session.message_completed' && event.payload.role === 'user');
    expect(sentText.map((event) => (event.type === 'session.message_completed' ? event.payload.content : ''))).toEqual(['Write two failing tests first.']);
  });

  it('refuses an edit with bad text or a secret in plain words, and an edit of a step that was sent', async () => {
    const { server, tab, route, start } = await setUp();
    const { run } = await start();
    const edit = route('workspaceOrchestrationStepEdit', run.id, 's1');
    for (const body of [{ instruction: '' }, { instruction: 'bad\u0000text' }, { instruction: 'x'.repeat(4001) }, {}, { instruction: 5 }]) {
      const refused = await refusalOf(await post(server, tab, edit, body));
      expect(refused).toMatchObject({ status: 400, code: 'invalid_request' });
      expect(refused.message).toBe('That text is empty, too long, or has characters that are not allowed.');
    }
    expect(await refusalOf(await post(server, tab, edit, { instruction: 'Log in with sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789' }))).toMatchObject({ status: 400, message: 'That text looks like it holds a key or a secret. Take it out and try again.' });
    expect((await request(server, tab, 'POST', edit, undefined)).status).toBe(400);
    expect((await post(server, tab, edit, { instruction: 'y'.repeat(50_000) })).status).toBe(413);
    await post(server, tab, route('workspaceOrchestrationStepApprove', run.id, 's1'));
    await post(server, tab, route('workspaceOrchestrationStepDispatch', run.id, 's1'));
    expect(await refusalOf(await post(server, tab, edit, { instruction: 'Too late.' }))).toMatchObject({ status: 409, code: 'step_not_changeable' });
  });

  it('a skipped step never sends, and the steps that need it wait', async () => {
    const { server, tab, route, view, sessions, start } = await setUp();
    const { run } = await start();
    const skipped = await view(await post(server, tab, route('workspaceOrchestrationStepSkip', run.id, 's2')));
    expect(skipped.steps.map((step) => [step.stepId, step.state])).toEqual([['s1', 'proposed'], ['s2', 'skipped'], ['s3', 'proposed']]);
    expect((await refusalOf(await post(server, tab, route('workspaceOrchestrationStepDispatch', run.id, 's2')))).code).toBe('step_not_approved');
    expect((await refusalOf(await post(server, tab, route('workspaceOrchestrationStepApprove', run.id, 's2')))).code).toBe('step_not_proposed');
    expect((await refusalOf(await post(server, tab, route('workspaceOrchestrationStepApprove', run.id, 's3')))).code).toBe('step_not_proposed');
    expect((await refusalOf(await post(server, tab, route('workspaceOrchestrationStepDispatch', run.id, 's3')))).code).toBe('step_not_approved');
    expect(await refusalOf(await post(server, tab, route('workspaceOrchestrationStepSkip', run.id, 's2')))).toMatchObject({ status: 409, code: 'step_not_changeable' });
    expect(await sessions()).toEqual([]);
  });

  it('refuses an order that breaks a prerequisite, and accepts one that does not', async () => {
    const { server, tab, runRoute, view, start } = await setUp();
    const { run } = await start();
    const reorder = runRoute('workspaceOrchestrationReorder', run.id);
    expect(await refusalOf(await post(server, tab, reorder, { order: ['s3', 's1', 's2'] }))).toEqual({ status: 409, code: 'bad_order', message: 'Step s3 needs step s2 first, so it cannot come before it.' });
    expect(await refusalOf(await post(server, tab, reorder, { order: ['s1', 's2'] }))).toMatchObject({ status: 409, code: 'bad_order' });
    expect((await refusalOf(await post(server, tab, reorder, {}))).code).toBe('bad_order');
    expect((await view(await request(server, tab, 'GET', runRoute('workspaceOrchestrationRun', run.id)))).steps.map((step) => step.stepId)).toEqual(['s1', 's2', 's3']);
    const moved = await view(await post(server, tab, reorder, { order: ['s2', 's3', 's1'] }));
    expect(moved.steps.map((step) => step.stepId)).toEqual(['s2', 's3', 's1']);
  });

  it('Stop ends the run: nothing more can be approved or sent', async () => {
    const { server, tab, route, runRoute, view, sessions, start } = await setUp();
    const { run } = await start();
    await post(server, tab, route('workspaceOrchestrationStepApprove', run.id, 's1'));
    const stopped = await view(await post(server, tab, runRoute('workspaceOrchestrationStop', run.id)));
    expect(stopped.run).toMatchObject({ state: 'stopped', stopReason: 'user' });
    expect((await refusalOf(await post(server, tab, route('workspaceOrchestrationStepDispatch', run.id, 's1')))).code).toBe('step_not_approved');
    expect((await refusalOf(await post(server, tab, route('workspaceOrchestrationStepApprove', run.id, 's2')))).code).toBe('step_not_proposed');
    expect(await refusalOf(await post(server, tab, runRoute('workspaceOrchestrationStop', run.id)))).toMatchObject({ status: 409, code: 'run_not_open' });
    expect(await sessions()).toEqual([]);
  });

  it('Stop cancels a worker turn in flight', async () => {
    const { server, tab, route, runRoute, view, start } = await setUp();
    const { run } = await start();
    await post(server, tab, route('workspaceOrchestrationStepApprove', run.id, 's1'));
    const sent = await view(await post(server, tab, route('workspaceOrchestrationStepDispatch', run.id, 's1')));
    const sessionId = sent.steps[0]!.sessionId!;
    const stopped = await view(await post(server, tab, runRoute('workspaceOrchestrationStop', run.id)));
    expect(stopped.run.state).toBe('stopped');
    await waitFor(() => server.core.entities.getSession(sessionId)?.state === 'idle', 'the worker chat to be idle');
    expect((await view(await request(server, tab, 'GET', runRoute('workspaceOrchestrationRun', run.id)))).run.state).toBe('stopped');
  });

  it('approval is the user\'s alone: the gate refuses a call without the tab\'s token, and no body names an approver', async () => {
    const { server, tab, route, view, start } = await setUp();
    const { run } = await start();
    const approve = route('workspaceOrchestrationStepApprove', run.id, 's1');
    const before = server.core.events.lastSeq();
    // No token: refused before anything is read or changed.
    for (const path of [approve, route('workspaceOrchestrationStepEdit', run.id, 's1'), route('workspaceOrchestrationStepSkip', run.id, 's1'), route('workspaceOrchestrationStepDispatch', run.id, 's1')]) {
      expect((await fetch(`${server.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ instruction: 'x', by: 'mode' }) })).status).toBe(401);
    }
    expect(server.core.events.lastSeq()).toBe(before);
    // With the token, a body claiming another approver changes nothing about who approved.
    const approved = await view(await post(server, tab, approve, { by: 'mode', approvedBy: 'manager' }));
    expect(approved.steps[0]).toMatchObject({ state: 'approved', approvedBy: 'user' });
    const events = server.core.events.readAfter(before).filter((event) => event.type === 'orchestration.step_approved');
    expect(events.map((event) => (event.type === 'orchestration.step_approved' ? event.payload.by : ''))).toEqual(['user']);
  });

  it('with the piece off every review route answers feature_off', async () => {
    const { server, tab, route, runRoute } = await setUp({ on: false });
    const id = 'orc_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
    const off = { status: 409, code: 'feature_off', message: ORCHESTRATION_OFF_MESSAGE };
    expect(await refusalOf(await post(server, tab, route('workspaceOrchestrationStepEdit', id, 's1'), { instruction: 'x' }))).toEqual(off);
    expect(await refusalOf(await post(server, tab, route('workspaceOrchestrationStepSkip', id, 's1')))).toEqual(off);
    expect(await refusalOf(await post(server, tab, runRoute('workspaceOrchestrationReorder', id), { order: ['s1'] }))).toEqual(off);
    expect(await refusalOf(await post(server, tab, runRoute('workspaceOrchestrationStop', id)))).toEqual(off);
  });
});

describe('while the manager is thinking', () => {
  it('the run reads as planning, Stop works, and the workers\' chats are never held', async () => {
    let release!: () => void;
    const slow: ManagerPort = {
      async proposePlan(context, signal) {
        await new Promise<void>((resolve) => {
          release = resolve;
          signal?.addEventListener('abort', () => resolve());
        });
        return validatePlanFor(context, PLAN3);
      },
      async decideNext() {
        return { ok: false, kind: 'unavailable', reason: 'not used here' };
      },
    };
    const { server, tab, wsId, runRoute, view } = await setUp({ manager: slow });
    const starting = post(server, tab, apiPath(API_ROUTES.workspaceOrchestrationRuns, { wsId }), { goal: 'Add a contact form' });
    await waitFor(async () => (await (await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceOrchestrationRuns, { wsId }))).json() as { runs: unknown[] }).runs.length === 1, 'the run to be listed');
    const listed = (await (await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceOrchestrationRuns, { wsId }))).json()) as { runs: Array<{ run: { id: string; state: string } }> };
    expect(listed.runs[0]!.run.state).toBe('planning');
    // Meanwhile a chat starts, takes a message and answers: nothing waits for the manager.
    const made = await post(server, tab, apiPath(API_ROUTES.workspaceSessions, { wsId }), {});
    expect(made.status).toBeLessThan(300);
    const { session } = SessionResponse.parse(await made.json());
    expect((await post(server, tab, apiPath(API_ROUTES.sessionMessages, { wsId, sesId: session.id }), { text: 'hello' })).status).toBe(202);
    await waitFor(() => server.core.entities.getSession(session.id)?.state === 'idle', 'the chat to answer');
    // Stop abandons the manager's call; the run keeps no step.
    const stopped = await view(await post(server, tab, runRoute('workspaceOrchestrationStop', listed.runs[0]!.run.id)));
    expect(stopped.run.state).toBe('stopped');
    release();
    const final = await starting;
    expect(final.status).toBe(201);
    expect((await view(final)).steps).toEqual([]);
  });
});
