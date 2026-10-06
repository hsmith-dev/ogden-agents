/**
 * The loop (epic 15, story 15.9) on a real server: the real chat, core and database, fake Codex and Grok workers (the fake ACP agent under
 * their own ids, API key only) and the fake manager. After a result the manager is asked what comes next; a worker waiting on a permission card
 * pauses the run until the user answers on the worker's own card (Allow goes on, Deny ends the step, stops the run and tells the manager);
 * the manager's question waits for the user's answer; and a run is picked up after a restart (the same data folder, a new server and a new core)
 * without sending an instruction twice. No real agent, model, network or keychain.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClaudeCodeAgent, createMemoryManager } from '@ogden-agents/adapters';
import type { AgentDescriptor, AgentPort, ManagerPort } from '@ogden-agents/core';
import {
  API_ROUTES,
  ApiErrorBody,
  apiPath,
  MANAGER_DECISION_VERSION,
  MANAGER_PLAN_VERSION,
  OrchestrationRunResponse,
  WorkspaceResponse,
  type OrchestrationRunView,
} from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentWiring } from '../src/agent-wiring.js';
import { signIn, startTestServer, tempDataDir, testDescriptor, waitFor, type SignedIn, type TestServer } from './helpers.js';

const FAKE_AGENT = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-acp-agent.mjs');
const API_KEY_ONLY: AgentDescriptor['signInMethods'] = [{ id: 'fake-key', kind: 'api_key', label: 'Use an API key', apiKey: { envNames: ['FAKE_AGENT_KEY'], format: 'Starts with fake-' } }];

function worker(agentId: string, displayName: string): AgentWiring {
  const base = createClaudeCodeAgent({ adapterPath: FAKE_AGENT, claudeExecutable: null });
  const named = <T extends { env: Readonly<Record<string, string>> }>(input: T): T => ({ ...input, env: { ...input.env, FAKE_ACP_AGENT_NAME: agentId } });
  const agent: AgentPort = {
    displayName,
    permissionModes: ['ask', 'auto'],
    skillInvocation: (skill, idea) => base.skillInvocation(skill, idea),
    startSession: (input) => base.startSession(named(input)),
    reopenSession: (input) => base.reopenSession(named(input)),
    listAuthMethods: (input) => base.listAuthMethods(input),
  };
  return { descriptor: testDescriptor(agentId, agent, { signInMethods: API_KEY_ONLY }), agent, setup: undefined };
}
const WORKERS = [worker('codex', 'Codex'), worker('grok', 'Grok')];

const folders: string[] = [];
const servers: TestServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const call = (server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) =>
  fetch(`${server.url}${path}`, { method, headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const refusalOf = async (reply: Response) => ({ status: reply.status, ...ApiErrorBody.parse(await reply.json()).error });
const agentRole = (agentId: string) => ({ kind: 'agent' as const, agentId });

type StepSpec = readonly [worker: string, instruction: string, depends?: string[]];
const planOf = (...steps: StepSpec[]) => ({
  version: MANAGER_PLAN_VERSION,
  goal: 'Do the work',
  steps: steps.map(([agent, instruction, depends], index) => ({ id: `s${index + 1}`, worker: agent, chat: 'new', instruction, mode: 'ask', depends_on: depends ?? [] })),
});
const decision = (action: string, extra: Record<string, unknown> = {}) => ({ version: MANAGER_DECISION_VERSION, action, reason: 'Because.', ...extra });

interface Kit {
  server: TestServer;
  tab: SignedIn;
  wsId: string;
  repo: string;
}

/** Starts a server (on `dataDir` when given, as a restart does) and, on a fresh data folder, opens the project and turns Orchestration on. */
async function open({ dataDir, manager, mode, existing }: { dataDir: string; manager: ManagerPort; mode: 'approve_each' | 'automatic'; existing?: { wsId: string; repo: string } }): Promise<Kit> {
  const server = await startTestServer({ dataDir, extraAgents: WORKERS, manager });
  servers.push(server);
  const tab = await signIn(server);
  if (existing !== undefined) return { server, tab, ...existing };
  const repo = realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-agents-repo-')));
  folders.push(repo);
  const wsId = WorkspaceResponse.parse(await (await call(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json()).workspace.id;
  const settings = apiPath(API_ROUTES.workspaceSettings, { wsId });
  const body = { orchestrationEnabled: true, orchestrationRoster: { worker: agentRole('codex'), reviewer: agentRole('grok') }, ...(mode === 'automatic' ? { orchestrationMode: 'automatic', confirm: true } : {}) };
  expect((await call(server, tab, 'PATCH', settings, body)).status).toBe(200);
  return { server, tab, wsId, repo };
}

const api = (kit: Kit) => {
  const runs = apiPath(API_ROUTES.workspaceOrchestrationRuns, { wsId: kit.wsId });
  const at = (runId: string) => apiPath(API_ROUTES.workspaceOrchestrationRun, { wsId: kit.wsId, runId });
  const parse = async (reply: Response): Promise<OrchestrationRunView> => OrchestrationRunResponse.parse(await reply.json()).run;
  return {
    start: async () => parse(await call(kit.server, kit.tab, 'POST', runs, { goal: 'Do the work' })),
    get: async (runId: string) => parse(await call(kit.server, kit.tab, 'GET', at(runId))),
    approve: (runId: string, stepId: string) => call(kit.server, kit.tab, 'POST', apiPath(API_ROUTES.workspaceOrchestrationStepApprove, { wsId: kit.wsId, runId, stepId })),
    send: async (runId: string, stepId: string) => parse(await call(kit.server, kit.tab, 'POST', apiPath(API_ROUTES.workspaceOrchestrationStepDispatch, { wsId: kit.wsId, runId, stepId }))),
    answer: (runId: string, answer: string) => call(kit.server, kit.tab, 'POST', apiPath(API_ROUTES.workspaceOrchestrationAnswer, { wsId: kit.wsId, runId }), { answer }),
    /** The user's answer on a worker's own card. */
    card: (sessionId: string, requestId: string, decisionOf: 'allow_once' | 'deny') => call(kit.server, kit.tab, 'POST', apiPath(API_ROUTES.sessionPermission, { wsId: kit.wsId, sesId: sessionId, requestId }), { decision: decisionOf }),
    requestOf: (sessionId: string): string => {
      const asked = kit.server.core.events.readAfter(0).find((event) => event.type === 'permission.requested' && event.streamId === sessionId);
      return asked?.type === 'permission.requested' ? asked.payload.requestId : '';
    },
  };
};

const stateOf = (view: OrchestrationRunView, id: string) => view.steps.find((step) => step.stepId === id)!.state;
const sessionOf = (view: OrchestrationRunView, id: string) => view.steps.find((step) => step.stepId === id)!.sessionId!;
const eventsOf = (kit: Kit, type: string) => kit.server.core.events.readAfter(0).filter((event) => event.type === type);

describe('the next decision on a real server', () => {
  it('asks the manager after a step finishes and shows its suggestion; the user still approves the next step, and the run finishes', async () => {
    const memory = createMemoryManager({ plans: [planOf(['codex', 'First thing.'], ['grok', 'Second thing.', ['s1']])] });
    const kit = await open({ dataDir: tempDataDir(), manager: memory, mode: 'approve_each' });
    const { start, get, approve, send } = api(kit);
    const run = await start();
    expect((await approve(run.run.id, 's1')).status).toBe(200);
    await send(run.run.id, 's1');
    await waitFor(async () => (await get(run.run.id)).decision?.action === 'dispatch', 'the manager to suggest the next step', 8000);
    const view = await get(run.run.id);
    expect(view.decision).toMatchObject({ action: 'dispatch', stepId: 's2' });
    expect(stateOf(view, 's2')).toBe('proposed');
    expect(memory.calls.filter((entry) => entry.method === 'decideNext')).toHaveLength(1);
    expect((await approve(run.run.id, 's2')).status).toBe(200);
    await send(run.run.id, 's2');
    await waitFor(async () => (await get(run.run.id)).run.state === 'finished', 'the run to finish', 8000);
  });

  it('takes the manager\'s question: it waits for the user, and the answer reaches the manager as data for the next decision', async () => {
    const memory = createMemoryManager({
      plans: [planOf(['codex', 'First thing.'], ['grok', 'Second thing.'])],
      decisions: [decision('ask_user', { question: 'Which flavour?' }), decision('dispatch', { step_id: 's2' })],
    });
    const kit = await open({ dataDir: tempDataDir(), manager: memory, mode: 'automatic' });
    const { start, get, answer } = api(kit);
    const run = await start();
    await waitFor(async () => (await get(run.run.id)).waiting?.kind === 'question', 'the manager to ask its question', 8000);
    const asking = await get(run.run.id);
    expect(asking.waiting).toEqual({ kind: 'question', question: 'Which flavour?' });
    expect(asking.run.state).toBe('awaiting_user');
    expect(stateOf(asking, 's2')).toBe('proposed');
    expect((await refusalOf(await answer(run.run.id, 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789'))).status).toBe(400);
    expect((await answer(run.run.id, 'Vanilla')).status).toBe(200);
    await waitFor(async () => (await get(run.run.id)).run.state === 'finished', 'the run to go on and finish', 8000);
    expect(eventsOf(kit, 'orchestration.question_answered')).toHaveLength(1);
    expect((await refusalOf(await answer(run.run.id, 'Again'))).code).toBe('run_not_open');
  });

  it('refuses an answer when no question is asked', async () => {
    const memory = createMemoryManager({ plans: [planOf(['codex', 'First thing.'])] });
    const kit = await open({ dataDir: tempDataDir(), manager: memory, mode: 'approve_each' });
    const { start, answer } = api(kit);
    const run = await start();
    expect(await refusalOf(await answer(run.run.id, 'Hello'))).toMatchObject({ status: 409, code: 'no_question' });
  });
});

describe('a worker waiting on a permission card on a real server', () => {
  it('pauses the run until the user answers on the worker\'s own card, and Allow lets it go on', async () => {
    const memory = createMemoryManager({ plans: [planOf(['codex', 'permission'], ['grok', 'Second thing.', ['s1']])] });
    const kit = await open({ dataDir: tempDataDir(), manager: memory, mode: 'approve_each' });
    const { start, get, approve, send, card, requestOf } = api(kit);
    const run = await start();
    await approve(run.run.id, 's1');
    const sent = await send(run.run.id, 's1');
    const session = sessionOf(sent, 's1');
    await waitFor(async () => (await get(run.run.id)).run.state === 'paused', 'the run to pause on the card', 8000);
    const paused = await get(run.run.id);
    expect(paused.waiting).toEqual({ kind: 'permission_card', stepId: 's1', sessionId: session });
    expect(stateOf(paused, 's1')).toBe('dispatched');
    // Nothing answers the card by itself.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect((await get(run.run.id)).run.state).toBe('paused');
    expect(eventsOf(kit, 'permission.resolved')).toHaveLength(0);

    expect((await card(session, requestOf(session), 'allow_once')).status).toBe(204);
    await waitFor(async () => stateOf(await get(run.run.id), 's1') === 'done', 'the step to finish', 8000);
    expect((await get(run.run.id)).run.state).not.toBe('paused');
    expect(eventsOf(kit, 'orchestration.run_resumed')).toHaveLength(1);
  });

  it('ends the step on Deny, stops the run permission_denied and tells the manager', async () => {
    const memory = createMemoryManager({ plans: [planOf(['codex', 'permission'], ['grok', 'Second thing.', ['s1']])], decisions: [decision('stop', { reason: 'Denied, so I stop.' })] });
    const kit = await open({ dataDir: tempDataDir(), manager: memory, mode: 'approve_each' });
    const { start, get, approve, send, card, requestOf } = api(kit);
    const run = await start();
    await approve(run.run.id, 's1');
    const session = sessionOf(await send(run.run.id, 's1'), 's1');
    await waitFor(async () => (await get(run.run.id)).run.state === 'paused', 'the run to pause on the card', 8000);
    expect((await card(session, requestOf(session), 'deny')).status).toBe(204);
    await waitFor(async () => (await get(run.run.id)).run.state === 'stopped', 'the run to stop', 8000);
    const view = await get(run.run.id);
    expect(view.run.stopReason).toBe('permission_denied');
    expect(stateOf(view, 's1')).toBe('failed');
    expect(stateOf(view, 's2')).toBe('proposed');
    await waitFor(async () => (await get(run.run.id)).decision?.told === 'denied', 'the manager to be told', 8000);
    expect((await get(run.run.id)).decision).toMatchObject({ action: 'stop', told: 'denied' });
    expect(memory.calls.filter((entry) => entry.method === 'decideNext')).toHaveLength(1);
    // The grok worker never got its instruction.
    expect(eventsOf(kit, 'orchestration.step_dispatched')).toHaveLength(1);
  });
});

describe('a restart on the same data folder', () => {
  it('picks up a run whose decision was owed and sends the next step exactly once', async () => {
    const dataDir = tempDataDir();
    const plan = planOf(['codex', 'First thing.'], ['grok', 'Second thing.', ['s1']]);
    // The manager never answers its first decision, as when the app stops while it thinks.
    const inner = createMemoryManager({ plans: [plan] });
    const hung: ManagerPort = { proposePlan: (context, signal) => inner.proposePlan(context, signal), decideNext: () => new Promise(() => undefined) };
    const first = await open({ dataDir, manager: hung, mode: 'automatic' });
    const run = await api(first).start();
    await waitFor(async () => (await api(first).get(run.run.id)).steps[0]!.sessionState === 'idle', 'the first worker to finish', 8000);
    // Read once more so the result is settled and the manager is asked (and hangs).
    await api(first).get(run.run.id);
    await waitFor(async () => eventsOf(first, 'orchestration.result_read').length === 1, 'the result to be read', 8000);
    expect(eventsOf(first, 'orchestration.step_dispatched')).toHaveLength(1);
    await first.server.close();

    const memory = createMemoryManager({ plans: [plan] });
    const second = await open({ dataDir, manager: memory, mode: 'automatic', existing: { wsId: first.wsId, repo: first.repo } });
    await waitFor(async () => (await api(second).get(run.run.id)).run.state === 'finished', 'the picked up run to finish', 10000);
    const done = await api(second).get(run.run.id);
    expect(done.steps.map((step) => [step.stepId, step.state, step.approvedBy])).toEqual([['s1', 'done', 'mode'], ['s2', 'done', 'mode']]);
    // Each instruction went exactly once, into its own chat.
    const dispatched = eventsOf(second, 'orchestration.step_dispatched');
    expect(dispatched).toHaveLength(2);
    const sends = second.server.core.events.readAfter(0).filter((event) => event.type === 'session.message_completed' && event.payload.role === 'user' && event.payload.origin === 'manager_auto');
    expect(sends.map((event) => (event.type === 'session.message_completed' ? event.payload.content : ''))).toEqual(['First thing.', 'Second thing.']);
    expect(memory.calls.filter((entry) => entry.method === 'decideNext')).toHaveLength(1);
    expect(memory.calls.filter((entry) => entry.method === 'proposePlan')).toHaveLength(0);
    expect(eventsOf(second, 'orchestration.run_resumed')).toEqual([expect.objectContaining({ payload: expect.objectContaining({ runId: run.run.id, reason: 'restart' }) })]);
  });

  it('does not send a step again when the restart cut its worker off at a card: the run waits for the user', async () => {
    const dataDir = tempDataDir();
    const plan = planOf(['codex', 'permission'], ['grok', 'Second thing.', ['s1']]);
    const first = await open({ dataDir, manager: createMemoryManager({ plans: [plan] }), mode: 'approve_each' });
    const { start, get, approve, send } = api(first);
    const run = await start();
    await approve(run.run.id, 's1');
    await send(run.run.id, 's1');
    await waitFor(async () => (await get(run.run.id)).run.state === 'paused', 'the run to pause on the card', 8000);
    await first.server.close();

    const second = await open({ dataDir, manager: createMemoryManager({ plans: [plan] }), mode: 'approve_each', existing: { wsId: first.wsId, repo: first.repo } });
    await waitFor(async () => (await api(second).get(run.run.id)).waiting?.kind === 'interrupted', 'the run to wait for the user', 8000);
    const view = await api(second).get(run.run.id);
    expect(view.run.state).toBe('awaiting_user');
    expect(stateOf(view, 's1')).toBe('dispatched');
    expect(eventsOf(second, 'orchestration.step_dispatched')).toHaveLength(1);
    expect(second.server.core.events.readAfter(0).filter((event) => event.type === 'session.message_completed' && event.payload.role === 'user')).toHaveLength(1);
    // Stop still ends it.
    const stopped = await call(second.server, second.tab, 'POST', apiPath(API_ROUTES.workspaceOrchestrationStop, { wsId: second.wsId, runId: run.run.id }));
    expect(stopped.status).toBe(200);
  });
});
