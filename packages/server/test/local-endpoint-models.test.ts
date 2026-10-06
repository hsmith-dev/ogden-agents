/**
 * Epic 14 story 14.5 on a real server: the model list with what each server
 * reports and its cautions, the chosen model shown as missing (never swapped)
 * when the server drops it, the chat refused for it in plain words, and the
 * chat's model picker offering the default endpoint's models.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalAgent, createMemoryAgentSetup } from '@ogden-agents/adapters';
import { API_ROUTES, ApiErrorBody, apiPath, ChatAgentsResponse, LocalEndpointModelsResponse, LocalEndpointResponse, ManagerTestResponse, SessionResponse, WorkspaceResponse } from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { startFakeServer, type FakeServer } from '../../../tests/fixtures/fake-openai-server.mjs';
import { removeAfterTest, signIn, startTestServer, tempDataDir, waitFor, type SignedIn, type TestServer } from './helpers.js';

const FAKE_OPENCODE = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-opencode.mjs');
const servers: FakeServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});
const fake = async (options: Parameters<typeof startFakeServer>[0] = {}) => {
  const server = await startFakeServer(options);
  servers.push(server);
  return server;
};
const call = (server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) =>
  fetch(`${server.url}${path}`, { method, headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

async function setUp() {
  const dataDir = tempDataDir();
  const ports = {
    agent: createLocalAgent({ dataDir, server: () => ({ command: process.execPath, args: [FAKE_OPENCODE] }) }),
    setup: createMemoryAgentSetup({ agentId: 'local', displayName: 'Local model', installed: true, auth: 'signed_in' }),
  };
  const server = await startTestServer({ local: ports, dataDir });
  const tab = await signIn(server);
  const add = async (baseUrl: string, extra: Record<string, unknown> = {}) =>
    LocalEndpointResponse.parse(await (await call(server, tab, 'POST', API_ROUTES.localEndpoints, { label: 'x', baseUrl, ...extra })).json()).endpoint;
  const models = async (id: string) => call(server, tab, 'GET', apiPath(API_ROUTES.localEndpointModels, { endpointId: id }));
  return { server, tab, add, models };
}

describe('the model list (epic 14 story 14.5)', () => {
  it('lists the models with size, context and tool support the server reports, and a caution for the small ones', async () => {
    const up = await fake({ models: ['fake-small', 'fake-large'] });
    const { add, models } = await setUp();
    const endpoint = await add(`${up.url}/v1`, { preset: 'ollama' });
    const response = await models(endpoint.id);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const answer = LocalEndpointModelsResponse.parse(await response.json());
    expect(answer).toMatchObject({ state: 'ready', model: null, missing: null, message: 'Ready. 2 models are available.' });
    const small = answer.models.find((model) => model.id === 'fake-small')!;
    expect(small).toMatchObject({ parameterSize: '7B', sizeBytes: 4_000_000_000, contextTokens: 4096, toolCall: false });
    expect(small.cautions).toHaveLength(3);
    expect(answer.models.find((model) => model.id === 'fake-large')!.cautions).toEqual([expect.stringContaining('Small models follow tool instructions')]);
  });

  it('says only what the server reported: a plain server gives ids and no cautions', async () => {
    const up = await fake({ models: ['x'] });
    const { add, models } = await setUp();
    const endpoint = await add(`${up.url}/v1`);
    const answer = LocalEndpointModelsResponse.parse(await (await models(endpoint.id)).json());
    expect(answer.models).toEqual([{ id: 'x', cautions: [] }]);
  });

  it('shows the chosen model as missing when the server no longer lists it, and never picks another', async () => {
    const up = await fake({ models: ['fake-small', 'fake-large'] });
    const { server, tab, add, models } = await setUp();
    const endpoint = await add(`${up.url}/v1`, { model: 'gone-model' });
    expect(LocalEndpointModelsResponse.parse(await (await models(endpoint.id)).json())).toMatchObject({ model: 'gone-model', missing: 'gone-model' });
    // A chosen model that is listed is not missing.
    const chosen = LocalEndpointResponse.parse(await (await call(server, tab, 'PATCH', apiPath(API_ROUTES.localEndpoint, { endpointId: endpoint.id }), { model: 'fake-large' })).json()).endpoint;
    expect(chosen.model).toBe('fake-large');
    expect(LocalEndpointModelsResponse.parse(await (await models(endpoint.id)).json())).toMatchObject({ model: 'fake-large', missing: null });
  });

  it('says not running, in words, with no models, when the server is down', async () => {
    const up = await fake();
    const base = `${up.url}/v1`;
    const { add, models } = await setUp();
    const endpoint = await add(base);
    await up.close();
    servers.splice(servers.indexOf(up), 1);
    expect(LocalEndpointModelsResponse.parse(await (await models(endpoint.id)).json())).toMatchObject({ state: 'not_running', models: [], message: 'Not running. Start the server, then test again.' });
  });

  it('refuses an unconfirmed host before calling anything, and an unknown endpoint with 404', async () => {
    const { server, tab, add, models } = await setUp();
    const endpoint = await add('https://a.example.com/v1', { confirmHost: 'https://a.example.com' });
    await call(server, tab, 'PATCH', apiPath(API_ROUTES.localEndpoint, { endpointId: endpoint.id }), { baseUrl: 'https://b.example.com/v1' });
    const refused = await models(endpoint.id);
    expect(refused.status).toBe(409);
    expect(ApiErrorBody.parse(await refused.json()).error.code).toBe('endpoint_confirmation_required');
    expect((await models('lep_01J9Z3K4M5N6P7Q8R9S0T1V2W3')).status).toBe(404);
  });
});

describe("project default, chat override and a model the server drops (the ticket verify text)", () => {
  it('chooses a model for the project through the picker, overrides it for one chat, then the server drops the chosen model and the card and the chat say so', async () => {
    const list = ['fake-small', 'fake-large', 'fake-mid'];
    const up = await fake({ models: list });
    const ctx = await setUp();
    const { server, tab, add, models } = ctx;
    const endpoint = await add(`${up.url}/v1`, { preset: 'ollama', model: 'fake-large' });
    await models(endpoint.id);
    const repo = removeAfterTest(mkdtempSync(join(tmpdir(), 'ogden-agents-repo-')));
    const wsId = WorkspaceResponse.parse(await (await call(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json()).workspace.id;
    // The project's default model for the Local model, from the picker's list.
    expect((await call(server, tab, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { defaultModels: { local: 'ogden/fake-mid' } })).status).toBe(200);
    const start = async () => SessionResponse.parse(await (await call(server, tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId }), { agentId: 'local' })).json()).session;
    const first = await start();
    expect(first.model).toBe('ogden/fake-mid');
    // A different model for one chat.
    const second = await start();
    const changed = await call(server, tab, 'PUT', apiPath(API_ROUTES.sessionModel, { wsId, sesId: second.id }), { model: 'ogden/fake-small' });
    expect(changed.status).toBe(200);
    expect(SessionResponse.parse(await changed.json()).session.model).toBe('ogden/fake-small');
    // A model the picker doesn't list is refused.
    expect((await call(server, tab, 'PUT', apiPath(API_ROUTES.sessionModel, { wsId, sesId: second.id }), { model: 'ogden/not-there' })).status).toBe(409);
    // The server drops the endpoint's chosen model: the card says so, naming it, and a new chat is refused naming it.
    list.splice(list.indexOf('fake-large'), 1);
    expect(LocalEndpointModelsResponse.parse(await (await models(endpoint.id)).json())).toMatchObject({ model: 'fake-large', missing: 'fake-large' });
    const third = await start();
    await call(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId, sesId: third.id }), { text: 'hello' });
    await waitFor(() => server.core.entities.getSession(third.id)!.state === 'error', 'the refusal', 15_000);
    expect(JSON.stringify(server.core.events.readAfter(0).filter((event) => event.streamId === third.id))).toContain("The model fake-large isn't on the server any more");
    // The picker's list followed the server.
    const agents = ChatAgentsResponse.parse(await (await call(server, tab, 'GET', API_ROUTES.chatAgents)).json()).agents;
    expect(agents.find((agent) => agent.agentId === 'local')?.models?.map((model) => model.id)).toEqual(['ogden/fake-small', 'ogden/fake-mid']);
  });

  it('reads LM Studio\'s kind through the route: context only where the model is loaded', async () => {
    const up = await fake({ models: ['fake-small', 'fake-large'] });
    const { add, models } = await setUp();
    const endpoint = await add(`${up.url}/v1`, { preset: 'lmstudio' });
    const answer = LocalEndpointModelsResponse.parse(await (await models(endpoint.id)).json());
    expect(answer.models.find((model) => model.id === 'fake-small')).toMatchObject({ contextTokens: 4096 });
    expect(answer.models.find((model) => model.id === 'fake-large')).toMatchObject({ contextTokens: 32_768, toolCall: true });
  });

  it('shares one read between presses and never lets a hostile number or name break the list', async () => {
    const odd = await fake({ models: ['ok-model'] });
    const { add, models } = await setUp();
    const endpoint = await add(`${odd.url}/v1`, { preset: 'ollama' });
    const [a, b] = await Promise.all([models(endpoint.id), models(endpoint.id)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    // One read: one list call and one tags call, not two of each.
    expect(odd.log.filter((entry) => entry.path === '/v1/models')).toHaveLength(1);
  });
});

describe('the chat and its model picker', () => {
  async function chatOn(extra: Record<string, unknown> = {}) {
    const up = await fake({ models: ['fake-small', 'fake-large'] });
    const ctx = await setUp();
    const endpoint = await ctx.add(`${up.url}/v1`, extra);
    const repo = removeAfterTest(mkdtempSync(join(tmpdir(), 'ogden-agents-repo-')));
    const wsId = WorkspaceResponse.parse(await (await call(ctx.server, ctx.tab, 'POST', API_ROUTES.workspaces, { path: repo })).json()).workspace.id;
    const session = SessionResponse.parse(await (await call(ctx.server, ctx.tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId }), { agentId: 'local' })).json()).session;
    return { ...ctx, up, endpoint, wsId, session };
  }

  it('starts on the chosen model, and offers the default endpoint\'s models (as the harness lists them) in the picker once they were read', async () => {
    const { server, tab, models, endpoint, wsId, session } = await chatOn({ model: 'fake-large' });
    await models(endpoint.id);
    const agents = ChatAgentsResponse.parse(await (await call(server, tab, 'GET', API_ROUTES.chatAgents)).json()).agents;
    expect(agents.find((agent) => agent.agentId === 'local')?.models).toEqual([
      { id: 'ogden/fake-small', name: 'fake-small' },
      { id: 'ogden/fake-large', name: 'fake-large' },
    ]);
    await call(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId, sesId: session.id }), { text: 'config-report' });
    await waitFor(() => JSON.stringify(server.core.events.readAfter(0)).includes('ogden/fake-large'), 'the config', 15_000);
    expect(JSON.stringify(server.core.events.readAfter(0).filter((event) => event.streamId === session.id))).toContain('\\"model\\":\\"ogden/fake-large\\"');
  });

  it('refuses to start on a chosen model the server no longer has, naming it, and does not use another', async () => {
    const { server, tab, up, wsId, session } = await chatOn({ model: 'gone-model' });
    const before = up.log.filter((entry) => entry.path.endsWith('/chat/completions')).length;
    await call(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId, sesId: session.id }), { text: 'hello' });
    await waitFor(() => server.core.entities.getSession(session.id)!.state === 'error', 'the error', 15_000);
    const text = JSON.stringify(server.core.events.readAfter(0).filter((event) => event.streamId === session.id));
    expect(text).toContain("The model gone-model isn't on the server any more");
    expect(text).toContain("won't switch to a different one");
    expect(up.log.filter((entry) => entry.path.endsWith('/chat/completions')).length).toBe(before);
  });
});

describe('Test as a manager (epic 14 story 14.8)', () => {
  const test = (server: TestServer, tab: SignedIn, id: string, model: string) => call(server, tab, 'POST', apiPath(API_ROUTES.localEndpointManagerTest, { endpointId: id }), { model });

  it('passes against a conforming model, and reports why, in plain words, for a malformed one and a model that is not there', async () => {
    const up = await fake({ models: ['fake-small', 'fake-noformat'] });
    const { server, tab, add } = await setUp();
    const endpoint = await add(`${up.url}/v1`);
    const passed = ManagerTestResponse.parse(await (await test(server, tab, endpoint.id, 'fake-small')).json());
    expect(passed).toMatchObject({ pass: true, mode: 'json_schema' });
    expect(passed.message).toContain('Passed.');
    // A model that refuses any response_format and only ever gives one fixed answer cannot fit the plan shape.
    const stubborn = ManagerTestResponse.parse(await (await test(server, tab, endpoint.id, 'fake-noformat')).json());
    expect(stubborn).toMatchObject({ pass: false, mode: null });
    expect(stubborn.message).toMatch(/ignored the shape|not valid JSON/);
    const missing = ManagerTestResponse.parse(await (await test(server, tab, endpoint.id, 'no-such-model')).json());
    expect(missing).toMatchObject({ pass: false, message: "The server doesn't have that model right now." });
  });

  it('only ever sends the fixed request: no tools, not streamed, temperature 0, and the key as a bearer', async () => {
    const up = await fake({ models: ['fake-small'], requireKey: 'mgr-key' });
    const { server, tab, add } = await setUp();
    const endpoint = await add(`${up.url}/v1`, { key: 'mgr-key' });
    await test(server, tab, endpoint.id, 'fake-small');
    const chat = up.log.filter((entry) => entry.path === '/v1/chat/completions');
    expect(chat).toHaveLength(1);
    expect(chat[0]).toMatchObject({ stream: false, temperature: 0, responseFormat: 'json_schema', authMatches: true });
    expect(chat[0]!.tools ?? []).toEqual([]);
    expect(JSON.stringify(server.core.events.readAfter(0))).not.toContain('mgr-key');
  });

  it('refuses an unconfirmed host with 409 and calls nothing, a bad body with 400, and an unknown endpoint with 404', async () => {
    const { server, tab, add } = await setUp();
    const endpoint = await add('https://a.example.com/v1', { confirmHost: 'https://a.example.com' });
    await call(server, tab, 'PATCH', apiPath(API_ROUTES.localEndpoint, { endpointId: endpoint.id }), { baseUrl: 'https://b.example.com/v1' });
    expect((await test(server, tab, endpoint.id, 'm')).status).toBe(409);
    expect((await call(server, tab, 'POST', apiPath(API_ROUTES.localEndpointManagerTest, { endpointId: endpoint.id }), { nope: 1 })).status).toBe(400);
    expect((await test(server, tab, 'lep_01J9Z3K4M5N6P7Q8R9S0T1V2W3', 'm')).status).toBe(404);
  });
});
