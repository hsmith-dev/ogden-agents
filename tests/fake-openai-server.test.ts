/**
 * The fake OpenAI-compatible server fixture (epic 14 story 14.3, shared by
 * every story's tests): every mode a real local server has is there, so the
 * stories can test against failures without a real model or network.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { startFakeServer, type FakeServer } from './fixtures/fake-openai-server.mjs';

const servers: FakeServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});
async function fake(options: Parameters<typeof startFakeServer>[0] = {}) {
  const server = await startFakeServer(options);
  servers.push(server);
  return server;
}
const chat = (server: FakeServer, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  fetch(`${server.url}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ model: 'fake-small', messages: [{ role: 'user', content: 'hello' }], ...body }) });

describe('the fake OpenAI-compatible server', () => {
  it('lists models on both server shapes', async () => {
    const server = await fake({ models: ['a', 'b'] });
    expect((await (await fetch(`${server.url}/v1/models`)).json()).data.map((m: { id: string }) => m.id)).toEqual(['a', 'b']);
    expect((await (await fetch(`${server.url}/api/tags`)).json()).models.map((m: { name: string }) => m.name)).toEqual(['a', 'b']);
  });

  it('streams a reply, and answers without streaming', async () => {
    const server = await fake();
    const streamed = await (await chat(server, { stream: true })).text();
    expect(streamed).toContain('Hello');
    expect(streamed).toContain('[DONE]');
    expect((await (await chat(server, {})).json()).choices[0].message.content).toBe('Hello from the fake model.');
  });

  it('asks for a tool call when told to run something, and answers after its result', async () => {
    const server = await fake();
    const tools = [{ type: 'function', function: { name: 'bash', parameters: { type: 'object', properties: { command: { type: 'string' } } } } }];
    const first = await (await chat(server, { tools, messages: [{ role: 'user', content: 'please run echo hi' }] })).json();
    expect(first.choices[0].message.tool_calls[0].function.name).toBe('bash');
    expect(JSON.parse(first.choices[0].message.tool_calls[0].function.arguments)).toMatchObject({ command: 'echo hi' });
    const after = await (await chat(server, { tools, messages: [{ role: 'user', content: 'please run echo hi' }, first.choices[0].message, { role: 'tool', tool_call_id: 'call_fake_1', content: 'hi' }] })).json();
    expect(after.choices[0].message.content).toContain('tool said: hi');
  });

  it('has its failure modes: model not found, context full, a wrong key, a malformed structured reply', async () => {
    const server = await fake({ requireKey: 'k' });
    const auth = { authorization: 'Bearer k' };
    expect((await chat(server, {})).status).toBe(401);
    const missing = await chat(server, { model: 'nope' }, auth);
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe('model_not_found');
    const full = await chat(server, { messages: [{ role: 'user', content: 'CTXFULL' }] }, auth);
    expect(full.status).toBe(400);
    expect((await full.json()).error.code).toBe('context_length_exceeded');
    const bad = await (await chat(server, { messages: [{ role: 'user', content: 'MALFORMED' }], response_format: { type: 'json_schema', json_schema: { schema: { type: 'object', properties: { a: { type: 'string' } } } } } }, auth)).json();
    expect(() => JSON.parse(bad.choices[0].message.content)).toThrow();
  });

  it('waits before the first token on SLOW, and is refused at a closed port', async () => {
    const server = await fake({ slowMs: 300 });
    const started = Date.now();
    await (await chat(server, { messages: [{ role: 'user', content: 'SLOW' }] })).json();
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    const url = server.url;
    await server.close();
    servers.splice(servers.indexOf(server), 1);
    await expect(fetch(`${url}/v1/models`)).rejects.toThrow();
  });

  it('can come back on the same port after a restart', async () => {
    const first = await startFakeServer();
    const port = first.port;
    await first.close();
    const second = await fake({ port });
    expect(second.port).toBe(port);
    expect((await fetch(`${second.url}/v1/models`)).status).toBe(200);
  });

  it('can be bound to another address than loopback, for a remote endpoint test, and records every request', async () => {
    const server = await fake({ host: '0.0.0.0' });
    await fetch(`http://127.0.0.1:${server.port}/v1/models`);
    expect(server.log.map((entry) => entry.path)).toEqual(['/v1/models']);
  });
});
