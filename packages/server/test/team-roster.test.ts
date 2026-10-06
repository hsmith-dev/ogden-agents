/**
 * The team roster on a real server (epic 15, story 15.5): each project's roles as the screen shows them, every
 * assignment checked by the server (a direct API call that breaks a rule is refused and writes nothing), the
 * install-wide default for new projects, and the manager addressing only the rostered workers. Agents are the fake
 * ones, the model is the fake OpenAI-compatible server. No real agent, model or keychain.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClaudeCodeAgent, createMemoryAgentSetup } from '@ogden-agents/adapters';
import type { AgentDescriptor, AgentPort } from '@ogden-agents/core';
import {
  API_ROUTES,
  ApiErrorBody,
  apiPath,
  LocalEndpointResponse,
  MANAGER_PLAN_VERSION,
  MANAGER_STATE_WORDS,
  OrchestrationSettingsResponse,
  NewProjectDefaultsResponse,
  TeamRosterViewResponse,
  WorkspaceResponse,
  WorkspaceSettingsResponse,
  type TeamRoster,
} from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { startFakeServer, type FakeServer } from '../../../tests/fixtures/fake-openai-server.mjs';
import type { AgentWiring } from '../src/agent-wiring.js';
import { signIn, startTestServer, testDescriptor, type SignedIn, type TestServer } from './helpers.js';

const FAKE_AGENT = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-acp-agent.mjs');

/** The fake ACP agent as another agent, with its own id and descriptor changes. */
function otherAgent(agentId: string, displayName: string, options: { setup?: AgentWiring['setup']; descriptor?: Partial<AgentDescriptor> } = {}): AgentWiring {
  const base = createClaudeCodeAgent({ adapterPath: FAKE_AGENT, claudeExecutable: null });
  const named = <T extends { env: Readonly<Record<string, string>> }>(input: T): T => ({ ...input, env: { ...input.env, FAKE_ACP_AGENT_NAME: agentId } });
  const agent: AgentPort = {
    displayName,
    permissionModes: ['ask'],
    skillInvocation: (skill, idea) => base.skillInvocation(skill, idea),
    startSession: (input) => base.startSession(named(input)),
    reopenSession: (input) => base.reopenSession(named(input)),
    listAuthMethods: (input) => base.listAuthMethods(input),
  };
  return { descriptor: testDescriptor(agentId, agent, options.descriptor), agent, setup: options.setup };
}

const folders: string[] = [];
const servers: TestServer[] = [];
const fakes: FakeServer[] = [];
afterEach(async () => {
  await Promise.all([...servers.splice(0).map((server) => server.close()), ...fakes.splice(0).map((server) => server.close())]);
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const call = (server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) =>
  fetch(`${server.url}${path}`, { method, headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

const none: TeamRoster = { manager: null, planner: null, worker: null, reviewer: null };

async function setUp(extraAgents: AgentWiring[], cases: Record<string, { replies: readonly string[] }> = {}, serverOptions: Parameters<typeof startTestServer>[0] = {}) {
  const model = await startFakeServer({ models: ['m'], managerCases: cases });
  fakes.push(model);
  const server = await startTestServer({ extraAgents, ...serverOptions });
  servers.push(server);
  const tab = await signIn(server);
  const repo = realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-agents-repo-')));
  folders.push(repo);
  const { workspace } = WorkspaceResponse.parse(await (await call(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json());
  const wsId = workspace.id;
  const settingsPath = apiPath(API_ROUTES.workspaceSettings, { wsId });
  expect((await call(server, tab, 'PATCH', settingsPath, { orchestrationEnabled: true })).status).toBe(200);
  const view = async () => TeamRosterViewResponse.parse(await (await call(server, tab, 'GET', apiPath(API_ROUTES.workspaceTeamRoster, { wsId }))).json());
  const save = (roster: Partial<TeamRoster>, extra: Record<string, unknown> = {}) => call(server, tab, 'PATCH', settingsPath, { orchestrationRoster: roster, ...extra });
  const stored = async () => WorkspaceSettingsResponse.parse(await (await call(server, tab, 'GET', settingsPath)).json()).settings.orchestrationRoster;
  const addEndpoint = async () => LocalEndpointResponse.parse(await (await call(server, tab, 'POST', API_ROUTES.localEndpoints, { label: 'Fake server', baseUrl: `${model.url}/v1`, model: 'm' })).json()).endpoint;
  return { model, server, tab, wsId, settingsPath, view, save, stored, addEndpoint };
}

const holder = (response: TeamRosterViewResponse, role: string) => response.roster.roles.find((entry) => entry.role === role)!;

describe('the project\'s roster as the screen shows it', () => {
  it('resolves a fresh project to the defaults: the project\'s default agent works, a different ready agent reviews, nobody manages without a server', async () => {
    const { view } = await setUp([otherAgent('second', 'Second Agent')]);
    const found = await view();
    expect(found.stored).toEqual(none);
    expect(found.roster.roles.map((role) => [role.role, role.label, role.source])).toEqual([['manager', null, 'none'], ['planner', null, 'none'], ['worker', 'Claude Code', 'default'], ['reviewer', 'Second Agent', 'default']]);
    expect(found.roster.workers).toEqual([{ agentId: 'claude-code', label: 'Claude Code', ready: true, role: 'worker' }, { agentId: 'second', label: 'Second Agent', ready: true, role: 'reviewer' }]);
    // The subscription agent says it takes only instructions the user approves one by one.
    expect(holder(found, 'worker')).toMatchObject({ note: 'Claude Code signs in with your account, so for now it only takes instructions you approve one by one.' });
    expect(found.roster.mode).toBe('approve_each');
  });

  it('with a server and its model the manager and planner default to that model, and a model that failed its test is never the default', async () => {
    const { view, addEndpoint, server } = await setUp([]);
    const endpoint = await addEndpoint();
    const found = await view();
    expect(holder(found, 'manager')).toMatchObject({ source: 'default', effective: { kind: 'model', endpointId: endpoint.id, model: 'm' }, label: 'm on this computer, on Fake server' });
    expect(holder(found, 'planner')).toMatchObject({ source: 'default', effective: { model: 'm' } });
    // A model nobody tested says so; a model that passed says that.
    expect(holder(found, 'manager').note).toContain('has not been tested as a manager');
    expect(server.url).toBeTruthy();
  });

  it('is behind the Orchestration guard: 409 feature_off while the piece is off', async () => {
    const { server, tab, wsId, settingsPath } = await setUp([]);
    expect((await call(server, tab, 'PATCH', settingsPath, { orchestrationEnabled: false })).status).toBe(200);
    const off = await call(server, tab, 'GET', apiPath(API_ROUTES.workspaceTeamRoster, { wsId }));
    expect(off.status).toBe(409);
    expect(ApiErrorBody.parse(await off.json()).error.code).toBe('feature_off');
  });
});

describe('every assignment is checked by the server', () => {
  it('saves roles that can be taken, one holder with several roles, and clears one back to the default, with one settings event each', async () => {
    const { save, view, stored, server, wsId } = await setUp([otherAgent('second', 'Second Agent')]);
    const before = server.core.events.lastSeq();
    expect((await save({ worker: { kind: 'agent', agentId: 'second' }, reviewer: { kind: 'agent', agentId: 'second' }, planner: { kind: 'agent', agentId: 'claude-code' } })).status).toBe(200);
    expect(await stored()).toMatchObject({ worker: { agentId: 'second' }, reviewer: { agentId: 'second' }, planner: { agentId: 'claude-code' } });
    const found = await view();
    expect(found.roster.workers).toEqual([{ agentId: 'second', label: 'Second Agent', ready: true, role: 'worker' }]);
    expect((await save({ ...none, worker: { kind: 'agent', agentId: 'second' } })).status).toBe(200);
    expect(holder(await view(), 'reviewer')).toMatchObject({ source: 'default', label: 'Claude Code' });
    const events = server.core.events.readAfter(before).filter((event) => event.type === 'workspace.settings_changed' && event.workspaceId === wsId);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ payload: { orchestrationRoster: { reviewer: { agentId: 'second' } }, previousOrchestrationRoster: none } });
  });

  it('refuses an agent as the manager and a model as a worker, saying why, and writes nothing', async () => {
    const { save, stored, server, addEndpoint } = await setUp([]);
    const endpoint = await addEndpoint();
    const before = server.core.events.lastSeq();
    const agent = await save({ manager: { kind: 'agent', agentId: 'claude-code' } });
    expect(agent.status).toBe(400);
    expect(ApiErrorBody.parse(await agent.json()).error.message).toBe('The manager must be a model on one of your servers, not an agent.');
    const model = await save({ worker: { kind: 'model', endpointId: endpoint.id, model: 'm' } });
    expect(model.status).toBe(400);
    expect(ApiErrorBody.parse(await model.json()).error.message).toBe('A worker must be an agent. A model on its own cannot run commands or edit files.');
    expect(await stored()).toBeUndefined();
    expect(server.core.events.lastSeq()).toBe(before);
  });

  it('refuses an agent that is not ready, with the reason the agent list gives', async () => {
    const setup = createMemoryAgentSetup({ agentId: 'second', displayName: 'Second Agent', installed: false });
    const { save, stored } = await setUp([otherAgent('second', 'Second Agent', { setup })]);
    const refused = await save({ worker: { kind: 'agent', agentId: 'second' } });
    expect(refused.status).toBe(400);
    expect(ApiErrorBody.parse(await refused.json()).error.message).toBe("Second Agent is not ready. Second Agent isn't installed. Install it in Settings → Agents.");
    expect(await stored()).toBeUndefined();
  });

  it('never makes an agent whose terms allow only a person a worker or a reviewer, however it is asked, but lets it plan', async () => {
    const { save, stored, view } = await setUp([otherAgent('terminal-helper', 'Terminal Helper', { descriptor: { interactiveOnly: 'Its terms allow only a person at the keyboard.' } })]);
    for (const role of ['worker', 'reviewer'] as const) {
      const refused = await save({ [role]: { kind: 'agent', agentId: 'terminal-helper' } });
      expect(refused.status, role).toBe(400);
      expect(ApiErrorBody.parse(await refused.json()).error.message).toBe('Terminal Helper is never given instructions by a manager. Its terms allow only a person at the keyboard.');
    }
    expect(await stored()).toBeUndefined();
    expect((await save({ planner: { kind: 'agent', agentId: 'terminal-helper' } })).status).toBe(200);
    // The default reviewer skips it too.
    expect(holder(await view(), 'reviewer')).toMatchObject({ source: 'none' });
    const option = holder(await view(), 'worker').options.find((entry) => entry.label === 'Terminal Helper');
    expect(option).toMatchObject({ available: false, reason: 'Terminal Helper is never given instructions by a manager. Its terms allow only a person at the keyboard.' });
  });

  it('refuses an unknown agent and a model on a server that does not exist', async () => {
    const { save } = await setUp([]);
    const unknown = await save({ worker: { kind: 'agent', agentId: 'nobody' } });
    expect(unknown.status).toBe(400);
    expect(ApiErrorBody.parse(await unknown.json()).error.code).toBe('agent_unknown');
    const gone = await save({ reviewer: { kind: 'model', endpointId: 'lep_01J9Z3K4M5N6P7Q8R9S0T1V2W3', model: 'm' } });
    expect(gone.status).toBe(400);
    expect(ApiErrorBody.parse(await gone.json()).error.message).toBe('Choose a model on a server you have set up.');
  });

  it('refuses a subscription agent as a worker in a project that dispatches automatically, and allows it in Approve each instruction', async () => {
    const { save, settingsPath, server, tab, stored } = await setUp([]);
    expect((await save({ worker: { kind: 'agent', agentId: 'claude-code' } })).status).toBe(200);
    // The same assignment saved together with the mode: refused with the mode named.
    const refused = await save({ reviewer: { kind: 'agent', agentId: 'claude-code' } }, { orchestrationMode: 'automatic', confirm: true });
    expect(refused.status).toBe(400);
    expect(ApiErrorBody.parse(await refused.json()).error.message).toContain('it only takes instructions you approve one by one');
    expect((await stored())?.reviewer ?? null).toBeNull();
    expect((await call(server, tab, 'PATCH', settingsPath, { orchestrationMode: 'automatic', confirm: true })).status).toBe(200);
    const stillRefused = await save({ planner: null, reviewer: { kind: 'agent', agentId: 'claude-code' } });
    expect(stillRefused.status).toBe(400);
    expect(ApiErrorBody.parse(await stillRefused.json()).error.message).toContain('This project dispatches automatically.');
  });

  it('leaves a role as it was unchecked: a holder that is no longer ready never blocks another change', async () => {
    const setup = createMemoryAgentSetup({ agentId: 'second', displayName: 'Second Agent', installed: true, auth: 'signed_in' });
    const { save, server, wsId, stored } = await setUp([otherAgent('second', 'Second Agent', { setup })]);
    expect((await save({ worker: { kind: 'agent', agentId: 'second' } })).status).toBe(200);
    // Nothing here signs the agent out, so store a worker the install lost by saving it straight through core.
    server.core.permissions.updateSettings(wsId as never, { orchestrationRoster: { worker: { kind: 'agent', agentId: 'second' } } });
    expect((await save({ worker: { kind: 'agent', agentId: 'second' }, planner: { kind: 'agent', agentId: 'claude-code' } })).status).toBe(200);
    expect(await stored()).toMatchObject({ planner: { agentId: 'claude-code' } });
  });
});

describe('Test as a manager is remembered and gates the manager and planner roles', () => {
  /** A model port where model "bad" answers in the wrong shape and every other model answers well. */
  const port: NonNullable<Parameters<typeof startTestServer>[0]>['localModelPort'] = {
    probe: async () => ({ ok: true, models: ['bad', 'good'] }),
    listModels: async () => ({ ok: true, models: [] }),
    structuredComplete: async (_target, request) => (request.model === 'bad' ? { ok: false, kind: 'bad_answer', reason: 'x', detail: 'off_shape' } : { ok: true, value: {}, mode: 'json_schema' }),
  };
  const testModel = async (server: TestServer, tab: SignedIn, endpointId: string, model: string) => {
    const answered = await call(server, tab, 'POST', apiPath(API_ROUTES.localEndpointManagerTest, { endpointId }), { model });
    expect(answered.status).toBe(200);
    return (await answered.json()) as { pass: boolean; message: string };
  };
  const roleOf = (found: TeamRosterViewResponse, role: string, label: string) => holder(found, role).options.find((option) => option.label === label)!;

  it('refuses a model that failed its test for the manager and planner, with the test\'s words, and still allows it as a reviewer', async () => {
    const { save, view, addEndpoint, server, tab, stored } = await setUp([], {}, { localModelPort: port });
    const endpoint = await addEndpoint();
    expect(await testModel(server, tab, endpoint.id, 'bad')).toMatchObject({ pass: false, message: 'The model answered with JSON, but ignored the shape it was asked for, even when asked again.' });
    const reason = 'bad did not pass Test as a manager. The model answered with JSON, but ignored the shape it was asked for, even when asked again.';
    for (const role of ['manager', 'planner'] as const) {
      const refused = await save({ [role]: { kind: 'model', endpointId: endpoint.id, model: 'bad' } });
      expect(refused.status, role).toBe(400);
      expect(ApiErrorBody.parse(await refused.json()).error.message).toBe(reason);
    }
    expect(await stored()).toBeUndefined();
    const found = await view();
    expect(roleOf(found, 'manager', 'bad')).toMatchObject({ available: false, reason });
    expect(roleOf(found, 'reviewer', 'bad')).toMatchObject({ available: true });
    expect((await save({ reviewer: { kind: 'model', endpointId: endpoint.id, model: 'bad' } })).status).toBe(200);
  });

  it('a model that passed is the default manager before the server\'s own model, and says it passed; a model nobody tested is allowed and says so', async () => {
    const { save, view, addEndpoint, server, tab } = await setUp([], {}, { localModelPort: port });
    const endpoint = await addEndpoint();
    expect(holder(await view(), 'manager')).toMatchObject({ source: 'default', effective: { model: 'm' }, note: expect.stringContaining('has not been tested as a manager') });
    expect(await testModel(server, tab, endpoint.id, 'good')).toMatchObject({ pass: true });
    expect(holder(await view(), 'manager')).toMatchObject({ source: 'default', effective: { model: 'good' }, note: 'It passed Test as a manager.' });
    expect((await save({ manager: { kind: 'model', endpointId: endpoint.id, model: 'untested' } })).status).toBe(200);
    expect(holder(await view(), 'manager')).toMatchObject({ source: 'chosen', effective: { model: 'untested' } });
  });

  it('a chosen manager that then fails its test is no longer used: the project says so, and a goal is refused with those words', async () => {
    const { save, addEndpoint, server, tab, wsId } = await setUp([], {}, { localModelPort: port });
    const endpoint = await addEndpoint();
    expect((await save({ manager: { kind: 'model', endpointId: endpoint.id, model: 'bad' } })).status).toBe(200);
    const state = async () => OrchestrationSettingsResponse.parse(await (await call(server, tab, 'GET', apiPath(API_ROUTES.workspaceOrchestration, { wsId }))).json()).settings;
    expect((await state()).manager?.state).toBe('ready');
    await testModel(server, tab, endpoint.id, 'bad');
    expect(await state()).toMatchObject({ managerReady: false, manager: { state: 'test_failed', message: MANAGER_STATE_WORDS.test_failed } });
    const before = server.core.events.lastSeq();
    const refused = await call(server, tab, 'POST', apiPath(API_ROUTES.workspaceOrchestrationRuns, { wsId }), { goal: 'Add a form' });
    expect(refused.status).toBe(409);
    expect(ApiErrorBody.parse(await refused.json()).error).toMatchObject({ code: 'manager_unavailable', message: MANAGER_STATE_WORDS.test_failed });
    expect(server.core.events.lastSeq()).toBe(before);
  });

  it('does not count a server that was down as a failed test', async () => {
    const down: typeof port = { probe: async () => ({ ok: false, kind: 'unreachable', reason: 'The server is not answering.' }), listModels: async () => ({ ok: true, models: [] }), structuredComplete: async () => ({ ok: false, kind: 'unreachable', reason: 'The server is not answering.' }) };
    const { save, addEndpoint, server, tab } = await setUp([], {}, { localModelPort: down });
    const endpoint = await addEndpoint();
    expect(await testModel(server, tab, endpoint.id, 'm')).toMatchObject({ pass: false });
    expect((await save({ manager: { kind: 'model', endpointId: endpoint.id, model: 'm' } })).status).toBe(200);
  });
});

describe('the roster for new projects', () => {
  it('reads as all defaults, saves under the same checks, appends one event, and a project added later starts with it', async () => {
    const { server, tab } = await setUp([otherAgent('second', 'Second Agent')]);
    const read = async () => TeamRosterViewResponse.parse(await (await call(server, tab, 'GET', API_ROUTES.teamRosterDefault)).json());
    expect((await read()).stored).toEqual(none);
    const before = server.core.events.lastSeq();
    const saved = await call(server, tab, 'PUT', API_ROUTES.teamRosterDefault, { roster: { worker: { kind: 'agent', agentId: 'second' } } });
    expect(saved.status).toBe(200);
    expect(TeamRosterViewResponse.parse(await saved.json()).stored.worker).toEqual({ kind: 'agent', agentId: 'second' });
    expect(server.core.events.readAfter(before).map((event) => event.type)).toEqual(['settings.team_roster_default_changed']);
    expect(NewProjectDefaultsResponse.parse(await (await call(server, tab, 'GET', API_ROUTES.newProjectDefaults)).json()).defaults.orchestrationRoster?.worker).toEqual({ kind: 'agent', agentId: 'second' });
    const repo = realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-agents-repo-')));
    folders.push(repo);
    const { workspace } = WorkspaceResponse.parse(await (await call(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json());
    const settings = WorkspaceSettingsResponse.parse(await (await call(server, tab, 'GET', apiPath(API_ROUTES.workspaceSettings, { wsId: workspace.id }))).json()).settings;
    expect(settings.orchestrationRoster?.worker).toEqual({ kind: 'agent', agentId: 'second' });
  });

  it('refuses a default that breaks a rule, an unknown agent, and a body that is not a roster, and writes nothing', async () => {
    const { server, tab } = await setUp([]);
    const put = (body: unknown) => call(server, tab, 'PUT', API_ROUTES.teamRosterDefault, body);
    const agentManager = await put({ roster: { manager: { kind: 'agent', agentId: 'claude-code' } } });
    expect(agentManager.status).toBe(400);
    expect(ApiErrorBody.parse(await agentManager.json()).error.message).toBe('The manager must be a model on one of your servers, not an agent.');
    expect((await put({ roster: { worker: { kind: 'agent', agentId: 'nobody' } } })).status).toBe(400);
    expect((await put({ roster: { worker: 'claude-code' } })).status).toBe(400);
    expect((await put({ roster: none, extra: 1 })).status).toBe(400);
    expect(TeamRosterViewResponse.parse(await (await call(server, tab, 'GET', API_ROUTES.teamRosterDefault)).json()).stored).toEqual(none);
    expect(server.core.events.readAfter(0).some((event) => event.type === 'settings.team_roster_default_changed')).toBe(false);
  });

  it('needs the tab\'s token and origin like every settings route', async () => {
    const { server } = await setUp([]);
    expect((await fetch(`${server.url}${API_ROUTES.teamRosterDefault}`)).status).toBe(401);
    expect((await fetch(`${server.url}${API_ROUTES.teamRosterDefault}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ roster: none }) })).status).toBe(401);
  });
});

describe('the manager addresses only the rostered workers', () => {
  const planFor = (worker: string) => JSON.stringify({ version: MANAGER_PLAN_VERSION, goal: 'Add a contact form', steps: [{ id: 's1', worker, chat: 'new', instruction: 'Write the failing test first.', mode: 'ask', depends_on: [] }] });

  it('refuses a plan that names an agent outside the roster, and accepts one that names the reviewer', async () => {
    const { save, addEndpoint, server, tab, wsId } = await setUp([otherAgent('second', 'Second Agent'), otherAgent('third', 'Third Agent')], {
      outside: { replies: [planFor('third'), planFor('third')] },
      reviewer: { replies: [planFor('second')] },
    });
    const endpoint = await addEndpoint();
    expect((await save({ manager: { kind: 'model', endpointId: endpoint.id, model: 'm' }, worker: { kind: 'agent', agentId: 'claude-code' }, reviewer: { kind: 'agent', agentId: 'second' } })).status).toBe(200);
    const start = (goal: string) => call(server, tab, 'POST', apiPath(API_ROUTES.workspaceOrchestrationRuns, { wsId }), { goal });
    const before = server.core.events.lastSeq();
    const outside = await start('Add a form MANAGER_CASE:outside');
    expect(outside.status).toBe(409);
    expect(ApiErrorBody.parse(await outside.json()).error.code).toBe('manager_failed');
    expect(server.core.events.readAfter(before).some((event) => event.type === 'orchestration.step_dispatched')).toBe(false);
    const inside = await start('Add a form MANAGER_CASE:reviewer');
    expect(inside.status).toBe(201);
  });
});
