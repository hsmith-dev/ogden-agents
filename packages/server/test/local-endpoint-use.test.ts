/**
 * Epic 14 story 14.4: the presets, Test connection and Detect end to end on a
 * real server, against the fake OpenAI-compatible server. Detect looks only at
 * the presets the server was given (the test's own ports, never the real
 * 1234 or 11434), and never reaches an address that is not this computer.
 */
import { API_ROUTES, apiPath, LocalEndpointDetectResponse, LocalEndpointPresetsResponse, LocalEndpointResponse, LocalEndpointTestResponse, ApiErrorBody } from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { startFakeServer, type FakeServer } from '../../../tests/fixtures/fake-openai-server.mjs';
import { signIn, startTestServer, type SignedIn, type TestServer } from './helpers.js';

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

async function closedPort(): Promise<number> {
  const server = await fake();
  const { port } = server;
  await server.close();
  servers.splice(servers.indexOf(server), 1);
  return port;
}

describe('presets, Test connection and Detect (epic 14 story 14.4)', () => {
  it('serves the shipped presets with their official download pages', async () => {
    const server = await startTestServer();
    const tab = await signIn(server);
    const { presets } = LocalEndpointPresetsResponse.parse(await (await call(server, tab, 'GET', API_ROUTES.localEndpointPresets)).json());
    expect(presets).toEqual([
      { id: 'lmstudio', label: 'LM Studio', baseUrl: 'http://localhost:1234/v1', downloadUrl: 'https://lmstudio.ai/download' },
      { id: 'ollama', label: 'Ollama', baseUrl: 'http://localhost:11434/v1', downloadUrl: 'https://ollama.com/download' },
    ]);
  });

  it('Detect finds a server on its port and reports the models; with nothing listening it finds none', async () => {
    const up = await fake({ models: ['m1', 'm2'] });
    const down = await closedPort();
    const server = await startTestServer({
      endpointPresets: [
        { id: 'one', label: 'One', baseUrl: `http://localhost:${up.port}/v1`, downloadUrl: 'https://example.com/one' },
        { id: 'two', label: 'Two', baseUrl: `http://localhost:${down}/v1`, downloadUrl: 'https://example.com/two' },
      ],
    });
    const tab = await signIn(server);
    const response = await call(server, tab, 'POST', API_ROUTES.localEndpointDetect);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const found = LocalEndpointDetectResponse.parse(await response.json()).found;
    expect(found).toEqual([{ presetId: 'one', label: 'One', baseUrl: `http://127.0.0.1:${up.port}/v1`, models: 2 }]);
    // Only the presets' own ports were probed, on this computer.
    expect(up.log.map((entry) => entry.path)).toEqual(['/v1/models']);
  });

  it('Detect is not run by anything but the button: a fresh server has probed nothing', async () => {
    const up = await fake();
    const server = await startTestServer({ endpointPresets: [{ id: 'one', label: 'One', baseUrl: `http://localhost:${up.port}/v1`, downloadUrl: 'https://example.com/one' }] });
    const tab = await signIn(server);
    await call(server, tab, 'GET', API_ROUTES.localEndpoints);
    await call(server, tab, 'GET', API_ROUTES.localEndpointPresets);
    expect(up.log).toEqual([]);
  });

  it('Test connection says ready with the models, running with none, not running, and key refused, in plain words', async () => {
    const ready = await fake({ models: ['a', 'b', 'c'] });
    const empty = await fake({ models: [] });
    const keyed = await fake({ requireKey: 'right-key' });
    const down = await closedPort();
    const server = await startTestServer();
    const tab = await signIn(server);
    const test = async (baseUrl: string, key?: string) => {
      const added = LocalEndpointResponse.parse(await (await call(server, tab, 'POST', API_ROUTES.localEndpoints, { label: 'x', baseUrl, ...(key === undefined ? {} : { key }) })).json()).endpoint;
      const response = await call(server, tab, 'POST', apiPath(API_ROUTES.localEndpointTest, { endpointId: added.id }));
      expect(response.headers.get('cache-control')).toBe('no-store');
      return LocalEndpointTestResponse.parse(await response.json());
    };
    expect(await test(`${ready.url}/v1`)).toEqual({ state: 'ready', models: ['a', 'b', 'c'], message: 'Ready. 3 models are available.' });
    expect(await test(`${empty.url}/v1`)).toMatchObject({ state: 'no_models', models: [] });
    expect(await test(`http://127.0.0.1:${down}/v1`)).toMatchObject({ state: 'not_running', message: 'Not running. Start the server, then test again.' });
    expect(await test(`${keyed.url}/v1`, 'wrong-key')).toMatchObject({ state: 'key_refused' });
    expect(await test(`${keyed.url}/v1`, 'right-key')).toMatchObject({ state: 'ready' });
  });

  it('Test connection refuses a host nobody confirmed, with 409, and calls nothing', async () => {
    const calls: string[] = [];
    const server = await startTestServer({
      localModelPort: {
        async probe(target) {
          calls.push(target.baseUrl);
          return { ok: true, models: ['m'] };
        },
        async listModels() {
          return { ok: true, models: [] };
        },
        async structuredComplete() {
          return { ok: false, kind: 'unsupported', reason: 'no' };
        },
      },
    });
    const tab = await signIn(server);
    const added = LocalEndpointResponse.parse(await (await call(server, tab, 'POST', API_ROUTES.localEndpoints, { label: 'r', baseUrl: 'https://a.example.com/v1', confirmHost: 'a.example.com' })).json()).endpoint;
    expect((await call(server, tab, 'POST', apiPath(API_ROUTES.localEndpointTest, { endpointId: added.id }))).status).toBe(200);
    await call(server, tab, 'PATCH', apiPath(API_ROUTES.localEndpoint, { endpointId: added.id }), { baseUrl: 'https://b.example.com/v1' });
    const refused = await call(server, tab, 'POST', apiPath(API_ROUTES.localEndpointTest, { endpointId: added.id }));
    expect(refused.status).toBe(409);
    expect(ApiErrorBody.parse(await refused.json()).error).toMatchObject({ code: 'endpoint_confirmation_required', details: { host: 'b.example.com' } });
    expect(calls).toEqual(['https://a.example.com/v1']);
    expect((await call(server, tab, 'POST', apiPath(API_ROUTES.localEndpointTest, { endpointId: 'lep_01J9Z3K4M5N6P7Q8R9S0T1V2W3' }))).status).toBe(404);
  });
});
