/**
 * Orchestration mode, Stop and per-run limits (epic 15, story 15.8) on a real server: the real chat, fake Codex and Grok workers (the
 * fake ACP agent under their own ids, API key only) and the fake manager. The mode is the project's and switching to automatic is
 * confirmed once per project; the install's default mode and limits are checked, kept and never copied into a project; an automatic
 * run sends its steps itself within its limits; Stop works with the piece off; and the activity log lists every instruction sent or
 * refused. No real agent, model, network or keychain.
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
  AUTOMATIC_NEEDS_CONFIRMATION,
  MANAGER_PLAN_VERSION,
  OrchestrationActivityResponse,
  OrchestrationDefaultsResponse,
  OrchestrationRunResponse,
  OrchestrationSettingsResponse,
  WorkspaceResponse,
  WorkspaceSettingsResponse,
  type OrchestrationRunView,
} from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentWiring } from '../src/agent-wiring.js';
import { signIn, startTestServer, testDescriptor, waitFor, type SignedIn, type TestServer } from './helpers.js';

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

const planOf = (...steps: ReadonlyArray<readonly [worker: string, depends?: string[]]>) => ({
  version: MANAGER_PLAN_VERSION,
  goal: 'Do the work',
  steps: steps.map(([agent, depends], index) => ({ id: `s${index + 1}`, worker: agent, chat: 'new', instruction: `Instruction ${index + 1} for ${agent}.`, mode: 'ask', depends_on: depends ?? [] })),
});

async function setUp({ automatic = false, on = true }: { automatic?: boolean; on?: boolean } = {}) {
  const plans: unknown[] = [];
  const server = await startTestServer({ extraAgents: WORKERS, manager: createMemoryManager({ plans }) });
  servers.push(server);
  const tab = await signIn(server);
  const addProject = async () => {
    const repo = realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-agents-repo-')));
    folders.push(repo);
    return WorkspaceResponse.parse(await (await call(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json()).workspace;
  };
  const workspace = await addProject();
  const wsId = workspace.id;
  const settingsPath = apiPath(API_ROUTES.workspaceSettings, { wsId });
  const patch = (body: unknown) => call(server, tab, 'PATCH', settingsPath, body);
  expect((await patch({ orchestrationEnabled: on, orchestrationRoster: { worker: agentRole('codex'), reviewer: agentRole('grok') }, ...(automatic ? { orchestrationMode: 'automatic', confirm: true } : {}) })).status).toBe(200);
  const runs = apiPath(API_ROUTES.workspaceOrchestrationRuns, { wsId });
  const at = (runId: string) => apiPath(API_ROUTES.workspaceOrchestrationRun, { wsId, runId });
  const start = async () => OrchestrationRunResponse.parse(await (await call(server, tab, 'POST', runs, { goal: 'Do the work' })).json()).run;
  const get = async (runId: string): Promise<OrchestrationRunView> => OrchestrationRunResponse.parse(await (await call(server, tab, 'GET', at(runId))).json()).run;
  const activity = async () => OrchestrationActivityResponse.parse(await (await call(server, tab, 'GET', apiPath(API_ROUTES.workspaceOrchestrationActivity, { wsId }))).json()).entries;
  const stop = (runId: string) => call(server, tab, 'POST', apiPath(API_ROUTES.workspaceOrchestrationStop, { wsId, runId }));
  const settings = async () => WorkspaceSettingsResponse.parse(await (await call(server, tab, 'GET', settingsPath)).json()).settings;
  const defaults = () => call(server, tab, 'GET', API_ROUTES.orchestrationDefaults);
  const setDefaults = (body: unknown) => call(server, tab, 'PUT', API_ROUTES.orchestrationDefaults, body);
  return { server, tab, wsId, plans, addProject, patch, settingsPath, runs, start, get, activity, stop, settings, defaults, setDefaults };
}

describe('the mode of a project', () => {
  it('is Approve each instruction, switches to automatic only with the confirmation, asks once per project and records it', async () => {
    const { server, tab, wsId, addProject, patch, settings } = await setUp();
    expect((await settings()).orchestrationMode).toBeUndefined();
    const before = server.core.events.lastSeq();
    expect(await refusalOf(await patch({ orchestrationMode: 'automatic' }))).toEqual({ status: 400, code: 'confirmation_required', message: AUTOMATIC_NEEDS_CONFIRMATION });
    expect(server.core.events.lastSeq()).toBe(before);

    const on = WorkspaceSettingsResponse.parse(await (await patch({ orchestrationMode: 'automatic', confirm: true })).json()).settings;
    expect(on).toMatchObject({ orchestrationMode: 'automatic', orchestrationAutomaticConfirmed: true });
    const recorded = server.core.events.readAfter(before).filter((event) => event.type === 'workspace.settings_changed');
    expect(recorded).toEqual([expect.objectContaining({ workspaceId: wsId, payload: expect.objectContaining({ orchestrationAutomaticConfirmed: true, orchestrationMode: 'automatic' }) })]);

    // Back, and on again: not asked again.
    expect((await patch({ orchestrationMode: 'approve_each' })).status).toBe(200);
    expect(await settings()).toMatchObject({ orchestrationAutomaticConfirmed: true });
    expect((await settings()).orchestrationMode).toBeUndefined();
    expect((await patch({ orchestrationMode: 'automatic' })).status).toBe(200);
    // Another project asks for itself.
    const other = await addProject();
    expect((await call(server, tab, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId: other.id }), { orchestrationMode: 'automatic' })).status).toBe(400);
  });

  it('refuses a dispatch the user did not approve in the default mode, through the API', async () => {
    const { plans, start, wsId, tab, server } = await setUp();
    plans.push(planOf(['codex']));
    const view = await start();
    const refused = await call(server, tab, 'POST', apiPath(API_ROUTES.workspaceOrchestrationStepDispatch, { wsId, runId: view.run.id, stepId: 's1' }));
    expect(await refusalOf(refused)).toMatchObject({ status: 409, code: 'step_not_approved' });
  });
});

describe('the install\'s default mode and limits', () => {
  it('reads as Approve each instruction with 20 instructions, depth 3 and 30 minutes, and keeps a change within its bounds', async () => {
    const { server, defaults, setDefaults } = await setUp();
    expect(OrchestrationDefaultsResponse.parse(await (await defaults()).json()).defaults).toEqual({ mode: 'approve_each', limits: { maxInstructions: 20, maxDepth: 3, maxMinutes: 30 } });
    const before = server.core.events.lastSeq();
    expect(await refusalOf(await setDefaults({ mode: 'automatic' }))).toEqual({ status: 400, code: 'confirmation_required', message: AUTOMATIC_NEEDS_CONFIRMATION });
    expect((await refusalOf(await setDefaults({ limits: { maxInstructions: 0 } }))).status).toBe(400);
    expect((await refusalOf(await setDefaults({ limits: { maxDepth: 9 } }))).status).toBe(400);
    expect((await refusalOf(await setDefaults({ limits: { maxMinutes: 1000 } }))).status).toBe(400);
    expect((await refusalOf(await setDefaults({}))).status).toBe(400);
    expect(server.core.events.lastSeq()).toBe(before);

    const saved = OrchestrationDefaultsResponse.parse(await (await setDefaults({ mode: 'automatic', confirm: true, limits: { maxInstructions: 4, maxDepth: 2, maxMinutes: 10 } })).json()).defaults;
    expect(saved).toEqual({ mode: 'automatic', limits: { maxInstructions: 4, maxDepth: 2, maxMinutes: 10 } });
    expect(server.core.events.readAfter(before).map((event) => event.type)).toEqual(['settings.orchestration_defaults_changed']);
    expect(OrchestrationDefaultsResponse.parse(await (await defaults()).json()).defaults).toEqual(saved);
  });

  it('never makes a project automatic: a project added after the default was set starts on Approve each instruction and asks for itself', async () => {
    const { server, tab, addProject, setDefaults } = await setUp();
    expect((await setDefaults({ mode: 'automatic', confirm: true })).status).toBe(200);
    const added = await addProject();
    const path = apiPath(API_ROUTES.workspaceSettings, { wsId: added.id });
    expect(WorkspaceSettingsResponse.parse(await (await call(server, tab, 'GET', path)).json()).settings.orchestrationMode).toBeUndefined();
    expect((await call(server, tab, 'PATCH', path, { orchestrationMode: 'automatic' })).status).toBe(400);
  });

  it('shows the limits in force in a project\'s orchestration settings, and gives a new run those limits', async () => {
    const { server, tab, wsId, plans, setDefaults, start } = await setUp();
    expect((await setDefaults({ limits: { maxInstructions: 7, maxDepth: 2, maxMinutes: 12 } })).status).toBe(200);
    const read = OrchestrationSettingsResponse.parse(await (await call(server, tab, 'GET', apiPath(API_ROUTES.workspaceOrchestration, { wsId }))).json()).settings;
    expect(read.limits).toEqual({ maxInstructions: 7, maxDepth: 2, maxMinutes: 12 });
    plans.push(planOf(['codex']));
    expect((await start()).run.limits).toEqual({ maxInstructions: 7, maxDepth: 2, maxMinutes: 12 });
  });
});

describe('an automatic run on a real server', () => {
  it('sends each step itself, marked as sent automatically, finishes, and lists each instruction in the activity log', async () => {
    const { server, plans, start, get, activity } = await setUp({ automatic: true });
    plans.push(planOf(['codex'], ['grok', ['s1']]));
    const view = await start();
    expect(view.run.mode).toBe('automatic');
    expect(view.steps[0]).toMatchObject({ state: 'dispatched', approvedBy: 'mode' });
    // The worker finishes by itself; the next step goes without anyone pressing anything.
    await waitFor(async () => (await get(view.run.id)).run.state === 'finished', 'the run to finish', 8000);
    const done = await get(view.run.id);
    expect(done.steps.map((step) => [step.worker, step.state, step.approvedBy])).toEqual([['codex', 'done', 'mode'], ['grok', 'done', 'mode']]);
    for (const step of done.steps) {
      const origins = server.core.events
        .readAfter(0)
        .filter((event) => event.type === 'session.message_completed' && event.streamId === step.sessionId && event.payload.role === 'user')
        .map((event) => (event.type === 'session.message_completed' ? event.payload.origin : ''));
      expect(origins).toEqual(['manager_auto']);
    }
    const entries = await activity();
    expect(entries.map((entry) => [entry.stepId, entry.workerLabel, entry.kind, entry.approvedBy, entry.result, entry.chat])).toEqual([
      ['s2', 'Grok', 'sent', 'mode', 'finished', 'new'],
      ['s1', 'Codex', 'sent', 'mode', 'finished', 'new'],
    ]);
    expect(entries[0]!.sessionId).toBe(done.steps[1]!.sessionId);
  });

  it('stops at the instruction limit set in the install\'s defaults, with its reason', async () => {
    const { plans, start, get, setDefaults } = await setUp({ automatic: true });
    expect((await setDefaults({ limits: { maxInstructions: 1 } })).status).toBe(200);
    plans.push(planOf(['codex'], ['grok']));
    const view = await start();
    await waitFor(async () => (await get(view.run.id)).run.state === 'stopped', 'the run to stop at its limit', 8000);
    const stopped = await get(view.run.id);
    expect(stopped.run).toMatchObject({ stopReason: 'instruction_limit', limits: { maxInstructions: 1 } });
    expect(stopped.steps.map((step) => step.state)).toEqual(['done', 'proposed']);
  });

  it('records a refused dispatch in the activity log, in either mode', async () => {
    const { tab, server, wsId, plans, start, patch, activity } = await setUp();
    plans.push(planOf(['codex']));
    const view = await start();
    const approve = await call(server, tab, 'POST', apiPath(API_ROUTES.workspaceOrchestrationStepApprove, { wsId, runId: view.run.id, stepId: 's1' }));
    expect(approve.status).toBe(200);
    // The user takes Codex off the team; the instruction is refused and the refusal is kept.
    expect((await patch({ orchestrationRoster: { worker: agentRole('grok'), reviewer: agentRole('grok') } })).status).toBe(200);
    const refused = await call(server, tab, 'POST', apiPath(API_ROUTES.workspaceOrchestrationStepDispatch, { wsId, runId: view.run.id, stepId: 's1' }));
    expect(await refusalOf(refused)).toMatchObject({ status: 409, code: 'dispatch_refused' });
    const [entry] = await activity();
    expect(entry).toMatchObject({ stepId: 's1', kind: 'refused', result: 'refused', sessionId: null, approvedBy: null });
    expect(entry!.note).toMatch(/not on this project's team any more/);
    expect(server.core.events.readAfter(0).filter((event) => event.type === 'orchestration.dispatch_refused')).toHaveLength(1);
  });
});

describe('Stop never depends on the piece being on', () => {
  it('stops a run with the piece switched off, while every other orchestration call is still refused as off', async () => {
    const { server, tab, wsId, plans, start, patch, stop, runs } = await setUp();
    plans.push(planOf(['codex']));
    const view = await start();
    expect((await patch({ orchestrationEnabled: false })).status).toBe(200);
    expect((await refusalOf(await call(server, tab, 'GET', runs))).code).toBe('feature_off');
    expect((await refusalOf(await call(server, tab, 'GET', apiPath(API_ROUTES.workspaceOrchestrationActivity, { wsId })))).code).toBe('feature_off');
    const stopped = await stop(view.run.id);
    expect(stopped.status).toBe(200);
    expect(OrchestrationRunResponse.parse(await stopped.json()).run.run).toMatchObject({ state: 'stopped', stopReason: 'user' });
    // A second Stop is a run that already ended, not a refusal for the piece.
    expect(await refusalOf(await stop(view.run.id))).toMatchObject({ status: 409, code: 'run_not_open' });
    // An unknown run or project is not found; the gate still applies.
    expect((await stop('orc_01J9Z3K4M5N6P7Q8R9S0T1V2W3')).status).toBe(404);
    expect((await fetch(`${server.url}${apiPath(API_ROUTES.workspaceOrchestrationStop, { wsId, runId: view.run.id })}`, { method: 'POST' })).status).toBe(401);
  });
});
