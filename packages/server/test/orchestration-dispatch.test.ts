/**
 * Dispatch and read-back across workers (epic 15, story 15.7) on a real server: the real chat, a fake
 * Claude Code (the built-in test agent), a fake Antigravity (subscription sign in), a fake Codex and a fake Grok
 * (API key only), all the fake ACP agent under their own ids, and the fake manager. An approved instruction reaches
 * each kind of worker as the manager's, in the worker's own mode, and reads back masked and capped; every refusal
 * is plain words, creates nothing and leaves every chat as it was. No real agent, model, network or keychain.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClaudeCodeAgent, createMemoryManager } from '@ogden-agents/adapters';
import type { AgentDescriptor, AgentPort } from '@ogden-agents/core';
import {
  API_ROUTES,
  ApiErrorBody,
  apiPath,
  MANAGER_PLAN_VERSION,
  OrchestrationRunResponse,
  SessionResponse,
  SessionsResponse,
  WorkspaceResponse,
  type OrchestrationRunView,
  type SessionId,
  type TeamRoster,
} from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentWiring } from '../src/agent-wiring.js';
import { signIn, startTestServer, testDescriptor, waitFor, type SignedIn, type TestServer } from './helpers.js';

const FAKE_AGENT = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-acp-agent.mjs');

const API_KEY_ONLY: AgentDescriptor['signInMethods'] = [{ id: 'fake-key', kind: 'api_key', label: 'Use an API key', apiKey: { envNames: ['FAKE_AGENT_KEY'], format: 'Starts with fake-' } }];

/** The fake ACP agent as another worker, with its own id and name and the modes it declares. */
function worker(agentId: string, displayName: string, descriptor: Partial<AgentDescriptor> = {}, modes: AgentPort['permissionModes'] = ['ask', 'auto']): AgentWiring {
  const base = createClaudeCodeAgent({ adapterPath: FAKE_AGENT, claudeExecutable: null });
  const named = <T extends { env: Readonly<Record<string, string>> }>(input: T): T => ({ ...input, env: { ...input.env, FAKE_ACP_AGENT_NAME: agentId } });
  const agent: AgentPort = {
    displayName,
    permissionModes: modes,
    skillInvocation: (skill, idea) => base.skillInvocation(skill, idea),
    startSession: (input) => base.startSession(named(input)),
    reopenSession: (input) => base.reopenSession(named(input)),
    listAuthMethods: (input) => base.listAuthMethods(input),
  };
  return { descriptor: testDescriptor(agentId, agent, descriptor), agent, setup: undefined };
}
const WORKERS = [worker('antigravity', 'Antigravity'), worker('codex', 'Codex', { signInMethods: API_KEY_ONLY }), worker('grok', 'Grok', { signInMethods: API_KEY_ONLY })];

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

async function setUp(roster: Partial<TeamRoster>) {
  // The manager's plans are filled in by each test, after the chats it names exist.
  const plans: unknown[] = [];
  const server = await startTestServer({ extraAgents: WORKERS, manager: createMemoryManager({ plans }) });
  servers.push(server);
  const tab = await signIn(server);
  const repo = realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-agents-repo-')));
  folders.push(repo);
  const { workspace } = WorkspaceResponse.parse(await (await call(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json());
  const wsId = workspace.id;
  const settingsPath = apiPath(API_ROUTES.workspaceSettings, { wsId });
  expect((await call(server, tab, 'PATCH', settingsPath, { orchestrationEnabled: true, orchestrationRoster: roster })).status).toBe(200);
  const runs = apiPath(API_ROUTES.workspaceOrchestrationRuns, { wsId });
  const at = (runId: string) => apiPath(API_ROUTES.workspaceOrchestrationRun, { wsId, runId });
  const step = (kind: 'approve' | 'dispatch', runId: string, stepId: string) =>
    apiPath(kind === 'approve' ? API_ROUTES.workspaceOrchestrationStepApprove : API_ROUTES.workspaceOrchestrationStepDispatch, { wsId, runId, stepId });
  const sessions = async () => SessionsResponse.parse(await (await call(server, tab, 'GET', apiPath(API_ROUTES.workspaceSessions, { wsId }))).json()).sessions;
  const start = async () => OrchestrationRunResponse.parse(await (await call(server, tab, 'POST', runs, { goal: 'Do the work' })).json()).run;
  const get = async (runId: string): Promise<OrchestrationRunView> => OrchestrationRunResponse.parse(await (await call(server, tab, 'GET', at(runId))).json()).run;
  const approve = (runId: string, stepId: string) => call(server, tab, 'POST', step('approve', runId, stepId));
  const dispatch = (runId: string, stepId: string) => call(server, tab, 'POST', step('dispatch', runId, stepId));
  const chatWith = async (agentId: string) => SessionResponse.parse(await (await call(server, tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId }), { agentId })).json()).session;
  return { server, tab, wsId, settingsPath, runs, plans, sessions, start, get, approve, dispatch, chatWith };
}

const planOf = (...steps: ReadonlyArray<readonly [worker: string, chat: string, depends?: string[]]>) => ({
  version: MANAGER_PLAN_VERSION,
  goal: 'Do the work',
  steps: steps.map(([agent, chat, depends], index) => ({ id: `s${index + 1}`, worker: agent, chat, instruction: `Instruction ${index + 1} for ${agent}.`, mode: 'ask', depends_on: depends ?? [] })),
});

const finished = (server: TestServer, sessionId: SessionId) => server.core.entities.getSession(sessionId)?.state === 'idle';
const messagesOf = (server: TestServer, sessionId: string) =>
  server.core.events
    .readAfter(0)
    .filter((event) => event.type === 'session.message_completed' && event.streamId === sessionId)
    .map((event) => (event.type === 'session.message_completed' ? [event.payload.role, event.payload.origin, event.payload.content] : []));

describe('dispatch reaches every kind of worker', () => {
  for (const [first, second] of [
    ['claude-code', 'antigravity'],
    ['codex', 'grok'],
  ] as const) {
    it(`sends an approved instruction to ${first} and then ${second} in a new chat each, as the manager's, in their own mode, and reads it back`, async () => {
      const { server, plans, start, approve, dispatch, get, sessions } = await setUp({ worker: agentRole(first), reviewer: agentRole(second) });
      plans.push(planOf([first, 'new'], [second, 'new', ['s1']]));
      const view = await start();
      expect(view.steps.map((entry) => [entry.worker, entry.workerLabel])).toHaveLength(2);
      const ids: SessionId[] = [];
      for (const id of ['s1', 's2']) {
        expect((await approve(view.run.id, id)).status).toBe(200);
        const sent = OrchestrationRunResponse.parse(await (await dispatch(view.run.id, id)).json()).run;
        const sessionId = sent.steps.find((entry) => entry.stepId === id)!.sessionId!;
        ids.push(sessionId);
        await waitFor(() => finished(server, sessionId), `${id}'s worker to finish`);
        // The step settles on a read, which the next approval needs.
        await waitFor(async () => (await get(view.run.id)).steps.find((entry) => entry.stepId === id)!.state === 'done', `${id} to be done`);
      }
      const done = await get(view.run.id);
      expect(done.steps.map((entry) => [entry.worker, entry.state, entry.report?.state, entry.report?.summary])).toEqual([
        [first, 'done', 'idle', 'Hello from the fake agent.'],
        [second, 'done', 'idle', 'Hello from the fake agent.'],
      ]);
      // The transcript says who sent each instruction, and each chat is its worker's own, in its own default mode.
      expect(messagesOf(server, ids[0]!)[0]).toEqual(['user', 'manager', `Instruction 1 for ${first}.`]);
      expect(messagesOf(server, ids[1]!)[0]).toEqual(['user', 'manager', `Instruction 2 for ${second}.`]);
      expect((await sessions()).map((session) => [session.agentId, session.permissionMode ?? 'ask'])).toEqual([[first, 'ask'], [second, 'ask']]);
      expect(server.core.events.readAfter(0).some((event) => event.type === 'session.permission_mode_changed')).toBe(false);
    });
  }

  it('continues the worker\'s own idle chat the step names, in the mode it is in, and makes no new chat', async () => {
    const { server, tab, wsId, plans, start, approve, dispatch, get, sessions, chatWith } = await setUp({ worker: agentRole('codex'), reviewer: agentRole('grok') });
    const own = await chatWith('codex');
    expect((await call(server, tab, 'PUT', apiPath(API_ROUTES.sessionPermissionMode, { wsId, sesId: own.id }), { mode: 'auto' })).status).toBeLessThan(300);
    plans.push(planOf(['codex', own.id]));
    const view = await start();
    expect(view.steps[0]!.chat).toBe(own.id);
    await approve(view.run.id, 's1');
    const sent = OrchestrationRunResponse.parse(await (await dispatch(view.run.id, 's1')).json()).run;
    expect(sent.steps[0]).toMatchObject({ state: 'dispatched', sessionId: own.id });
    await waitFor(() => finished(server, own.id), 'the chat to finish');
    expect((await get(view.run.id)).steps[0]).toMatchObject({ state: 'done', report: { summary: 'Hello from the fake agent.' } });
    expect((await sessions()).map((session) => [session.id, session.permissionMode])).toEqual([[own.id, 'auto']]);
    expect(messagesOf(server, own.id)[0]).toEqual(['user', 'manager', 'Instruction 1 for codex.']);
  });
});

describe('the refusals leave every chat as it was and say why', () => {
  it('refuses a worker taken off the team after the plan, with plain words, and creates nothing', async () => {
    const { server, tab, settingsPath, plans, start, approve, dispatch, get, sessions } = await setUp({ worker: agentRole('codex'), reviewer: agentRole('grok') });
    plans.push(planOf(['codex', 'new']));
    const view = await start();
    await approve(view.run.id, 's1');
    // The user changes the team: Codex is no longer the worker or the reviewer.
    expect((await call(server, tab, 'PATCH', settingsPath, { orchestrationRoster: { worker: agentRole('grok'), reviewer: agentRole('antigravity') } })).status).toBe(200);
    const before = server.core.events.lastSeq();
    const refused = await refusalOf(await dispatch(view.run.id, 's1'));
    expect(refused).toMatchObject({ status: 409, code: 'dispatch_refused', details: { reason: 'worker_not_on_team' } });
    expect(refused.message).toBe("Codex is not on this project's team any more, so the instruction was not sent. Choose a worker in the project settings under Orchestration.");
    expect(await sessions()).toEqual([]);
    expect(server.core.events.lastSeq()).toBe(before);
    expect((await get(view.run.id)).steps[0]!.state).toBe('approved');
  });

  it('refuses a chat that is busy or driven by the terminal without sending anything, and sends once the chat is free', async () => {
    const { server, plans, start, approve, dispatch, get, sessions, chatWith } = await setUp({ worker: agentRole('codex'), reviewer: agentRole('grok') });
    const own = await chatWith('codex');
    plans.push(planOf(['codex', own.id]));
    const view = await start();
    await approve(view.run.id, 's1');
    const shape = async () => (await sessions()).map((session) => [session.id, session.agentId, session.state, session.driver, session.permissionMode ?? 'ask']);
    const seq = server.core.events.lastSeq();
    const before = await shape();

    server.core.entities.setSessionState(own.id, 'working');
    expect(await refusalOf(await dispatch(view.run.id, 's1'))).toMatchObject({ status: 409, code: 'dispatch_refused', details: { reason: 'chat_busy' }, message: expect.stringContaining('busy or finished') });
    server.core.entities.setSessionState(own.id, 'idle');
    server.core.entities.setSessionDriver(own.id, 'terminal', 'user');
    expect(await refusalOf(await dispatch(view.run.id, 's1'))).toMatchObject({ status: 409, code: 'dispatch_refused', details: { reason: 'driver_is_terminal' }, message: expect.stringContaining('terminal is driving') });
    server.core.entities.setSessionDriver(own.id, 'ui', 'user');

    expect(await shape()).toEqual(before);
    expect(messagesOf(server, own.id)).toEqual([]);
    expect((await get(view.run.id)).steps[0]!.state).toBe('approved');
    expect(server.core.events.readAfter(seq).some((event) => event.type === 'session.message_completed' || event.type === 'orchestration.step_dispatched')).toBe(false);

    // Free again: the same approved step goes.
    expect((await dispatch(view.run.id, 's1')).status).toBe(200);
    await waitFor(() => finished(server, own.id), 'the chat to finish');
    expect(messagesOf(server, own.id)[0]).toEqual(['user', 'manager', 'Instruction 1 for codex.']);
  });

  it('never offers the manager another worker\'s chat: a plan that names one is refused and no step or chat appears', async () => {
    const { server, tab, plans, runs, sessions, chatWith } = await setUp({ worker: agentRole('codex'), reviewer: agentRole('grok') });
    const grokChat = await chatWith('grok');
    plans.push(planOf(['codex', grokChat.id]));
    const refused = await refusalOf(await call(server, tab, 'POST', runs, { goal: 'Do the work' }));
    expect(refused).toMatchObject({ status: 409, code: 'manager_failed' });
    expect((await sessions()).map((session) => session.id)).toEqual([grokChat.id]);
  });
});
