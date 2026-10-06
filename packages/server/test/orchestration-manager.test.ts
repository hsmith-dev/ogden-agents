/**
 * The real manager on a real server (epic 15, story 15.4): a project's manager
 * is the model its roster names on one of its endpoints, called through the
 * endpoints' confirmation rule. The fake OpenAI-compatible server plays the
 * model. The project's Orchestrate settings say plainly which state the manager
 * is in; a goal becomes a plan only when it is ready; a bad answer dispatches
 * nothing and leaves a masked record in the event log. No real model, agent or
 * keychain.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  API_ROUTES,
  ApiErrorBody,
  apiPath,
  LocalEndpointResponse,
  MANAGER_PLAN_VERSION,
  MANAGER_STATE_WORDS,
  OrchestrationRunResponse,
  OrchestrationSettingsResponse,
  SessionsResponse,
  WorkspaceResponse,
} from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { startFakeServer, type FakeServer } from '../../../tests/fixtures/fake-openai-server.mjs';
import { signIn, startTestServer, type SignedIn, type TestServer } from './helpers.js';

const repos: string[] = [];
const servers: TestServer[] = [];
const fakes: FakeServer[] = [];
afterEach(async () => {
  await Promise.all([...servers.splice(0).map((server) => server.close()), ...fakes.splice(0).map((server) => server.close())]);
  for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const call = (server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) =>
  fetch(`${server.url}${path}`, { method, headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

const planOf = (worker: string, instruction = 'Write the failing test first.') => ({
  version: MANAGER_PLAN_VERSION,
  goal: 'Add a contact form',
  steps: [{ id: 's1', worker, chat: 'new', instruction, mode: 'ask', depends_on: [] }],
});

async function setUp(cases: Record<string, { replies: readonly string[]; hang?: boolean }> = { good: { replies: [JSON.stringify(planOf('claude-code'))] } }) {
  const model = await startFakeServer({ models: ['m'], managerCases: cases });
  fakes.push(model);
  const server = await startTestServer();
  servers.push(server);
  const tab = await signIn(server);
  const repo = realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-agents-repo-')));
  repos.push(repo);
  const { workspace } = WorkspaceResponse.parse(await (await call(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json());
  const wsId = workspace.id;
  const settingsPath = apiPath(API_ROUTES.workspaceSettings, { wsId });
  expect((await call(server, tab, 'PATCH', settingsPath, { orchestrationEnabled: true })).status).toBe(200);
  const addEndpoint = async (baseUrl = `${model.url}/v1`, extra: Record<string, unknown> = {}) =>
    LocalEndpointResponse.parse(await (await call(server, tab, 'POST', API_ROUTES.localEndpoints, { label: 'Fake server', baseUrl, ...extra })).json()).endpoint;
  const choose = (endpointId: string, name = 'm') => call(server, tab, 'PATCH', settingsPath, { orchestrationRoster: { manager: { kind: 'model', endpointId, model: name } } });
  const state = async () => OrchestrationSettingsResponse.parse(await (await call(server, tab, 'GET', apiPath(API_ROUTES.workspaceOrchestration, { wsId }))).json()).settings;
  const start = (goal: string) => call(server, tab, 'POST', apiPath(API_ROUTES.workspaceOrchestrationRuns, { wsId }), { goal });
  const sessions = async () => SessionsResponse.parse(await (await call(server, tab, 'GET', apiPath(API_ROUTES.workspaceSessions, { wsId }))).json()).sessions;
  return { model, server, tab, wsId, settingsPath, addEndpoint, choose, state, start, sessions };
}

describe('the states of a project\'s manager', () => {
  it('says no manager is chosen until the roster names a model, and a goal is refused with those words and nothing stored', async () => {
    const { server, state, start } = await setUp();
    expect(await state()).toMatchObject({ managerReady: false, manager: { state: 'not_chosen', message: MANAGER_STATE_WORDS.not_chosen } });
    const before = server.core.events.lastSeq();
    const refused = await start('Add a form MANAGER_CASE:good');
    expect(refused.status).toBe(409);
    expect(ApiErrorBody.parse(await refused.json()).error).toMatchObject({ code: 'manager_unavailable', message: MANAGER_STATE_WORDS.not_chosen });
    expect(server.core.events.lastSeq()).toBe(before);
  });

  it('is ready once a model on a server of this computer is chosen, and says where it runs', async () => {
    const { addEndpoint, choose, state } = await setUp();
    const endpoint = await addEndpoint();
    expect((await choose(endpoint.id)).status).toBe(200);
    expect(await state()).toMatchObject({ managerReady: true, manager: { state: 'ready', message: 'The manager is m on this computer, on Fake server.' } });
  });

  it('refuses an agent as the manager, and a model on a server that was never set up, saying why', async () => {
    const { server, tab, settingsPath, state } = await setUp();
    const agent = await call(server, tab, 'PATCH', settingsPath, { orchestrationRoster: { manager: { kind: 'agent', agentId: 'claude-code' } } });
    expect(agent.status).toBe(400);
    expect(ApiErrorBody.parse(await agent.json()).error.message).toBe('The manager must be a model on one of your servers, not an agent.');
    const unknown = await call(server, tab, 'PATCH', settingsPath, { orchestrationRoster: { manager: { kind: 'model', endpointId: 'lep_01J9Z3K4M5N6P7Q8R9S0T1V2W3', model: 'm' } } });
    expect(unknown.status).toBe(400);
    expect(ApiErrorBody.parse(await unknown.json()).error.message).toBe('Choose a model on a server you have set up.');
    expect((await state()).manager?.state).toBe('not_chosen');
  });

  it('turns to server missing when the chosen server is removed, with words that say what to do', async () => {
    const { server, tab, addEndpoint, choose, state } = await setUp();
    const endpoint = await addEndpoint();
    await choose(endpoint.id);
    expect((await call(server, tab, 'DELETE', apiPath(API_ROUTES.localEndpoint, { endpointId: endpoint.id }))).status).toBeLessThan(300);
    expect(await state()).toMatchObject({ managerReady: false, manager: { state: 'endpoint_missing', message: MANAGER_STATE_WORDS.endpoint_missing } });
  });

  it('is not ready on another computer until it is confirmed, and no request reaches that host before', async () => {
    const { model, server, tab, addEndpoint, choose, state, start } = await setUp();
    // A host that is not this computer: added confirmed, then its address changes, which asks again.
    const far = await addEndpoint('https://far.example.invalid/v1', { confirmHost: 'https://far.example.invalid' });
    await choose(far.id);
    expect((await state()).manager?.state).toBe('ready');
    expect((await state()).manager?.message).toContain('on another computer');
    const moved = await call(server, tab, 'PATCH', apiPath(API_ROUTES.localEndpoint, { endpointId: far.id }), { baseUrl: 'https://elsewhere.example.invalid/v1' });
    expect(moved.status).toBe(200);
    expect(await state()).toMatchObject({ managerReady: false, manager: { state: 'host_not_confirmed', message: MANAGER_STATE_WORDS.host_not_confirmed } });
    const refused = await start('Add a form MANAGER_CASE:good');
    expect(ApiErrorBody.parse(await refused.json()).error).toMatchObject({ code: 'manager_unavailable', message: MANAGER_STATE_WORDS.host_not_confirmed });
    expect(model.log.filter((entry) => entry.path.endsWith('/chat/completions'))).toEqual([]);
  });
});

describe('a run with the real manager', () => {
  it('turns a goal into a plan from the chosen model, with the manager\'s masked answer in the event log, and sends nothing on its own', async () => {
    const { model, server, addEndpoint, choose, start, sessions } = await setUp();
    await choose((await addEndpoint()).id);
    const reply = await start('Add a contact form MANAGER_CASE:good');
    expect(reply.status).toBe(201);
    const run = OrchestrationRunResponse.parse(await reply.json()).run;
    expect(run.run.state).toBe('awaiting_user');
    expect(run.steps.map((step) => [step.stepId, step.state, step.worker])).toEqual([['s1', 'proposed', 'claude-code']]);
    expect(await sessions()).toEqual([]);
    const replied = server.core.events.readAfter(0).find((event) => event.type === 'orchestration.manager_replied');
    expect(replied?.payload).toMatchObject({ call: 'plan', outcome: 'accepted', repaired: false });
    expect(model.log.filter((entry) => entry.path.endsWith('/chat/completions')).every((entry) => (entry.tools ?? []).length === 0 && entry.stream === false)).toBe(true);
  });

  it('refuses a plan that names an agent not on the team and one that asks for more than Ask, creating no step and no chat', async () => {
    const { server, addEndpoint, choose, start, sessions } = await setUp({
      rogue: { replies: [JSON.stringify(planOf('rogue-agent'))] },
      skip: { replies: [JSON.stringify({ ...planOf('claude-code'), steps: [{ ...planOf('claude-code').steps[0], mode: 'skip_all' }] })] },
    });
    await choose((await addEndpoint()).id);
    for (const marker of ['rogue', 'skip']) {
      const reply = await start(`Add a form MANAGER_CASE:${marker}`);
      expect(reply.status).toBe(409);
      expect(ApiErrorBody.parse(await reply.json()).error.code).toBe('manager_failed');
    }
    expect(await sessions()).toEqual([]);
    const types = server.core.events.readAfter(0).map((event) => event.type);
    expect(types.filter((type) => type === 'orchestration.step_proposed')).toEqual([]);
    expect(types.filter((type) => type === 'orchestration.manager_replied')).toHaveLength(2);
  });
});
