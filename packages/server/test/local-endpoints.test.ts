/**
 * The Local model's endpoint routes end to end (epic 14 story 14.3): a real
 * server with the in-memory keychain. Loopback needs no confirmation or key;
 * another host is refused until its confirmation is recorded and asks again
 * when the host changes; a key goes to the keychain and comes back nowhere
 * (not in an answer, the event log, the log or the database); a chat reaches
 * only a confirmed endpoint, with its key, and nothing here reaches a real
 * server or keychain.
 */
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalAgent, createMemoryAgentSetup, createMemorySecretStore } from '@ogden-agents/adapters';
import { API_ROUTES, ApiErrorBody, apiPath, LocalEndpointResponse, LocalEndpointsResponse, SessionResponse, WorkspaceResponse, type LocalEndpointId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { startFakeServer } from '../../../tests/fixtures/fake-openai-server.mjs';
import { removeAfterTest, signIn, startTestServer, tempDataDir, waitFor, type SignedIn, type TestServer } from './helpers.js';

const FAKE_OPENCODE = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-opencode.mjs');
const KEY = 'sk-route-dummy-key-91ac03';

const call = (server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) =>
  fetch(`${server.url}${path}`, { method, headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

async function setUp(options: { secrets?: ReturnType<typeof createMemorySecretStore> } = {}) {
  const server = await startTestServer({ ...(options.secrets === undefined ? {} : { secrets: options.secrets }) });
  const tab = await signIn(server);
  const add = async (body: unknown) => call(server, tab, 'POST', API_ROUTES.localEndpoints, body);
  const endpointOf = async (response: Response) => LocalEndpointResponse.parse(await response.json()).endpoint;
  return { server, tab, add, endpointOf };
}

describe('the endpoint routes (epic 14 story 14.3)', () => {
  it('lists none at first, adds a loopback server with no confirmation, and answers no-store', async () => {
    const { server, tab, add, endpointOf } = await setUp();
    const empty = await call(server, tab, 'GET', API_ROUTES.localEndpoints);
    expect(empty.headers.get('cache-control')).toBe('no-store');
    expect(LocalEndpointsResponse.parse(await empty.json())).toEqual({ endpoints: [], defaultEndpointId: null });
    const created = await add({ label: 'My Mac', baseUrl: 'http://localhost:1234/v1' });
    expect(created.status).toBe(201);
    const endpoint = await endpointOf(created);
    expect(endpoint).toMatchObject({ loopback: true, needsConfirmation: false, keySaved: false });
    expect(LocalEndpointsResponse.parse(await (await call(server, tab, 'GET', API_ROUTES.localEndpoints)).json()).endpoints).toEqual([endpoint]);
  });

  it('answers 400 in plain words for an address that cannot be used', async () => {
    const { add } = await setUp();
    const refused = await add({ label: 'x', baseUrl: 'http://user:pw@localhost/v1' });
    expect(refused.status).toBe(400);
    expect(ApiErrorBody.parse(await refused.json()).error.message).toMatch(/key box/);
    expect((await add({ label: 'x', baseUrl: 'http://localhost/v1', nonsense: 1 })).status).toBe(400);
    expect((await add('not json')).status).toBe(400);
  });

  it('refuses another host with 409 and the host, until it is confirmed, and shows the http warning', async () => {
    const { server, tab, add, endpointOf } = await setUp();
    const refused = await add({ label: 'Gateway', baseUrl: 'http://192.168.1.20:8000/v1' });
    expect(refused.status).toBe(409);
    expect(ApiErrorBody.parse(await refused.json()).error).toMatchObject({ code: 'endpoint_confirmation_required', details: { host: 'http://192.168.1.20:8000' } });
    const created = await endpointOf(await add({ label: 'Gateway', baseUrl: 'http://192.168.1.20:8000/v1', confirmHost: 'http://192.168.1.20:8000' }));
    expect(created).toMatchObject({ needsConfirmation: false, insecureRemote: true, loopback: false });
    // A changed host asks again, and the confirmation route binds to the host shown.
    const moved = await endpointOf(await call(server, tab, 'PATCH', apiPath(API_ROUTES.localEndpoint, { endpointId: created.id }), { baseUrl: 'https://gw.example.com/v1' }));
    expect(moved).toMatchObject({ needsConfirmation: true, host: 'https://gw.example.com' });
    const wrong = await call(server, tab, 'POST', apiPath(API_ROUTES.localEndpointConfirm, { endpointId: created.id }), { host: 'http://192.168.1.20:8000' });
    expect(wrong.status).toBe(409);
    const confirmed = await endpointOf(await call(server, tab, 'POST', apiPath(API_ROUTES.localEndpointConfirm, { endpointId: created.id }), { host: 'https://gw.example.com' }));
    expect(confirmed).toMatchObject({ needsConfirmation: false, insecureRemote: false });
  });

  it('keeps a key in the keychain and returns it nowhere: not in an answer, an event, the log or the database', async () => {
    const secrets = createMemorySecretStore();
    const { server, tab, add, endpointOf } = await setUp({ secrets });
    const created = await add({ label: 'Keyed', baseUrl: 'https://api.example.com/v1', confirmHost: 'https://api.example.com', key: KEY });
    const text = await created.text();
    expect(text).not.toContain(KEY);
    expect(created.headers.get('cache-control')).toBe('no-store');
    const endpoint = LocalEndpointResponse.parse(JSON.parse(text)).endpoint;
    expect(endpoint).toMatchObject({ auth: 'key', keySaved: true });
    expect(await secrets.get(`agent-endpoint-key/${endpoint.id}`)).toBe(KEY);
    const replaced = await call(server, tab, 'PUT', apiPath(API_ROUTES.localEndpointKey, { endpointId: endpoint.id }), { key: `${KEY}-2` });
    expect(await replaced.text()).not.toContain(KEY);
    const removed = await call(server, tab, 'DELETE', apiPath(API_ROUTES.localEndpointKey, { endpointId: endpoint.id }));
    expect(await endpointOf(removed)).toMatchObject({ keySaved: false });
    expect(await secrets.get(`agent-endpoint-key/${endpoint.id}`)).toBeUndefined();
    expect(JSON.stringify(server.core.events.readAfter(0))).not.toContain(KEY);
    // The log and the database hold no key (the database does hold the address).
    await server.close();
    const files = readdirSync(server.dataDir, { recursive: true, encoding: 'utf8' }).filter((name) => /(\.db(-wal|-shm)?|\.log)$/.test(name));
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) expect(readFileSync(join(server.dataDir, name)).includes(KEY), name).toBe(false);
  });

  it('refuses a key, in plain words, when no keychain can hold it', async () => {
    const broken = { backend: 'none', get: async () => undefined, set: async () => { throw new (await import('@ogden-agents/core')).SecretsUnavailableError(); }, delete: async () => undefined };
    const server = await startTestServer({ secrets: broken });
    const tab = await signIn(server);
    const refused = await call(server, tab, 'POST', API_ROUTES.localEndpoints, { label: 'x', baseUrl: 'http://localhost:1/v1', key: KEY });
    expect(refused.status).toBe(503);
    expect(ApiErrorBody.parse(await refused.json()).error.code).toBe('secrets_unavailable');
    expect(LocalEndpointsResponse.parse(await (await call(server, tab, 'GET', API_ROUTES.localEndpoints)).json()).endpoints).toEqual([]);
  });

  it('sets the default, removes an endpoint with 204, and answers 404 for one that is not there', async () => {
    const { server, tab, add, endpointOf } = await setUp();
    const a = await endpointOf(await add({ label: 'a', baseUrl: 'http://localhost:1/v1' }));
    const listed = await call(server, tab, 'PUT', API_ROUTES.localEndpointDefault, { endpointId: a.id });
    expect(LocalEndpointsResponse.parse(await listed.json()).defaultEndpointId).toBe(a.id);
    expect((await call(server, tab, 'DELETE', apiPath(API_ROUTES.localEndpoint, { endpointId: a.id }))).status).toBe(204);
    expect((await call(server, tab, 'DELETE', apiPath(API_ROUTES.localEndpoint, { endpointId: a.id }))).status).toBe(404);
    expect((await call(server, tab, 'PATCH', apiPath(API_ROUTES.localEndpoint, { endpointId: 'nonsense' }), { label: 'x' })).status).toBe(404);
  });

  it('is behind the gate: no tab token, no answer', async () => {
    const { server } = await setUp();
    for (const [method, path] of [['GET', API_ROUTES.localEndpoints], ['POST', API_ROUTES.localEndpoints], ['PUT', API_ROUTES.localEndpointDefault]] as const) {
      const response = await fetch(`${server.url}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(method === 'GET' ? {} : { body: '{}' }) });
      expect([401, 403], `${method} ${path}`).toContain(response.status);
    }
  });
});

describe('a chat reaches only a confirmed endpoint, with its key', () => {
  async function chatSetUp(dataDir = tempDataDir()) {
    const fake = await startFakeServer({ requireKey: KEY });
    const ports = {
      agent: createLocalAgent({ dataDir, server: () => ({ command: process.execPath, args: [FAKE_OPENCODE] }) }),
      setup: createMemoryAgentSetup({ agentId: 'local', displayName: 'Local model', installed: true, auth: 'signed_in' }),
    };
    const server = await startTestServer({ local: ports, dataDir });
    const tab = await signIn(server);
    const repo = removeAfterTest(mkdtempSync(join(tmpdir(), 'ogden-agents-repo-')));
    const wsId = WorkspaceResponse.parse(await (await call(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json()).workspace.id;
    const newSession = async () => SessionResponse.parse(await (await call(server, tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId }), { agentId: 'local' })).json()).session;
    const session = await newSession();
    const sendTo = async (session: { id: import('@ogden-agents/shared').SessionId }, text: string) => {
      const before = server.core.events.readAfter(0).filter((e) => e.streamId === session.id && e.type === 'session.message_completed').length;
      await call(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId, sesId: session.id }), { text });
      await waitFor(() => ['idle', 'error'].includes(server.core.entities.getSession(session.id)!.state) && server.core.events.readAfter(0).filter((e) => e.streamId === session.id && e.type === 'session.message_completed').length + (server.core.entities.getSession(session.id)!.state === 'error' ? 1 : 0) > before, `the answer to ${text}`, 15_000);
    };
    const send = (text: string) => sendTo(session, text);
    return { fake, server, tab, session, send, newSession, sendTo };
  }

  it('uses the endpoint set up in Settings, sending its key from the keychain, and refuses it once its host changed until confirmed again', async () => {
    const { fake, server, tab, send, newSession, sendTo } = await chatSetUp();
    const added = LocalEndpointResponse.parse(await (await call(server, tab, 'POST', API_ROUTES.localEndpoints, { label: 'Fake', baseUrl: `${fake.url}/v1`, key: KEY })).json()).endpoint;
    await send('hello');
    expect(fake.log.filter((entry) => entry.path === '/v1/chat/completions').every((entry) => entry.authMatches === true)).toBe(true);
    expect(fake.log.filter((entry) => entry.path === '/v1/chat/completions')).toHaveLength(1);
    // The host changes to one nobody confirmed: the next chat to start is refused, in words, and nothing is called.
    await call(server, tab, 'PATCH', apiPath(API_ROUTES.localEndpoint, { endpointId: added.id }), { baseUrl: 'https://elsewhere.example.com/v1' });
    const calls = fake.log.length;
    const second = await newSession();
    await sendTo(second, 'hello');
    expect(JSON.stringify(server.core.events.readAfter(0).filter((e) => e.streamId === second.id))).toContain('Confirm that your messages and project text may be sent to https://elsewhere.example.com');
    expect(fake.log.length).toBe(calls);
    expect(JSON.stringify(server.core.events.readAfter(0))).not.toContain(KEY);
  });

  it('says to set up a server first when none is', async () => {
    const { server, session, send } = await chatSetUp();
    await send('hello');
    expect(JSON.stringify(server.core.events.readAfter(0).filter((e) => e.streamId === session.id))).toContain('Set up a server for the Local model');
  });

  it('keeps a loopback endpoint chat from naming its key anywhere on disk', async () => {
    const { fake, server, tab, send } = await chatSetUp();
    await call(server, tab, 'POST', API_ROUTES.localEndpoints, { label: 'Fake', baseUrl: `${fake.url}/v1`, key: KEY });
    await send('hello');
    await server.close();
    const hits = readdirSync(server.dataDir, { recursive: true, encoding: 'utf8' }).filter((name) => {
      try {
        return readFileSync(join(server.dataDir, name)).includes(KEY);
      } catch {
        return false;
      }
    });
    expect(hits).toEqual([]);
    await fake.close();
  });
});

export type { LocalEndpointId };
