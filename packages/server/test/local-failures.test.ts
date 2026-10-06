/**
 * Epic 14 story 14.6 on a real server: the failures a model server has are
 * plain-words states (not running, a full context), a server killed mid reply
 * does not hang the chat, and the chat goes on once the server is back (the
 * fake OpenAI server restarts on the same port). The Local model is registered
 * as it is shipped (no test hook), with its fast watch settings for the test.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalAgent, createMemoryAgentSetup } from '@ogden-agents/adapters';
import { API_ROUTES, apiPath, ChatAgentsResponse, SessionResponse, WorkspaceResponse, type SessionId } from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { startFakeServer, type FakeServer } from '../../../tests/fixtures/fake-openai-server.mjs';
import { removeAfterTest, signIn, startTestServer, tempDataDir, waitFor, type SignedIn, type TestServer } from './helpers.js';

const FAKE_OPENCODE = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-opencode.mjs');
const servers: FakeServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});
const call = (server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) =>
  fetch(`${server.url}${path}`, { method, headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

async function setUp(fake: FakeServer) {
  const dataDir = tempDataDir();
  const ports = {
    agent: createLocalAgent({ dataDir, server: () => ({ command: process.execPath, args: [FAKE_OPENCODE], env: { FAKE_OPENCODE_CONNECT_DELAY_MS: '60000' } }), watch: { intervalMs: 100, misses: 2 } }),
    setup: createMemoryAgentSetup({ agentId: 'local', displayName: 'Local model', installed: true, auth: 'signed_in' }),
  };
  const server = await startTestServer({ local: ports, dataDir });
  const tab = await signIn(server);
  await call(server, tab, 'POST', API_ROUTES.localEndpoints, { label: 'Fake', baseUrl: `${fake.url}/v1` });
  const repo = removeAfterTest(mkdtempSync(join(tmpdir(), 'ogden-agents-repo-')));
  const wsId = WorkspaceResponse.parse(await (await call(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json()).workspace.id;
  const session = SessionResponse.parse(await (await call(server, tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId }), { agentId: 'local' })).json()).session;
  const stateOf = () => server.core.entities.getSession(session.id)!.state;
  const send = async (text: string) => call(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId, sesId: session.id }), { text });
  const reasons = () => server.core.events.readAfter(0).flatMap((event) => (event.streamId === session.id && event.type === 'session.state_changed' && 'reason' in event.payload ? [String(event.payload.reason)] : []));
  const replies = (id: SessionId = session.id) => server.core.events.readAfter(0).flatMap((event) => (event.streamId === id && event.type === 'session.message_completed' && event.payload.role === 'agent' ? [event.payload.content] : []));
  return { server, tab, session, stateOf, send, reasons, replies };
}

describe('a Local model chat when the server fails (epic 14 story 14.6)', () => {
  it('is registered as shipped: the picker lists it with Ask only, with no test hook', async () => {
    const server = await startTestServer({ local: undefined });
    const tab = await signIn(server);
    const agents = ChatAgentsResponse.parse(await (await call(server, tab, 'GET', API_ROUTES.chatAgents)).json()).agents;
    expect(agents.map((agent) => agent.agentId)).toEqual(['claude-code', 'local']);
    expect(agents.find((agent) => agent.agentId === 'local')).toMatchObject({ displayName: 'Local model', noAccount: true, permissionModes: ['ask'] });
  });

  it('says a full context in plain words and the chat can go on', async () => {
    const fake = await startFakeServer();
    servers.push(fake);
    const { send, stateOf, reasons, replies } = await setUp(fake);
    await send('CTXFULL please');
    await waitFor(() => stateOf() === 'error', 'the error', 15_000);
    expect(reasons().at(-1)).toContain("no longer fits in the model's context");
    await send('hello');
    await waitFor(() => stateOf() === 'idle' && replies().length > 0, 'the next reply', 15_000);
    expect(replies().at(-1)).toBe('Hello from the fake model.');
  });

  it('a server killed in the middle of a reply shows not running within seconds, and the chat continues once it is back', async () => {
    const fake = await startFakeServer({ slowMs: 30_000 });
    servers.push(fake);
    const port = fake.port;
    const { send, stateOf, reasons, replies } = await setUp(fake);
    const started = Date.now();
    await send('SLOW please');
    await waitFor(() => stateOf() === 'working', 'working', 10_000);
    await new Promise((resolve) => setTimeout(resolve, 400));
    await fake.close();
    servers.splice(servers.indexOf(fake), 1);
    await waitFor(() => stateOf() === 'error', 'the not running state', 20_000);
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(reasons().at(-1)).toBe("The server stopped answering. Start it again, then send your message again.");
    // The server comes back on the same port; the next message works.
    const back = await startFakeServer({ port });
    servers.push(back);
    await send('hello');
    await waitFor(() => stateOf() === 'idle' && replies().length > 0, 'the reply after the restart', 20_000);
    expect(replies().at(-1)).toBe('Hello from the fake model.');
  });

  it('a server that is not running when the chat starts says so at once, naming the host, without starting the harness', async () => {
    const fake = await startFakeServer();
    const host = new URL(fake.url).host;
    const { send, stateOf, reasons } = await setUp(fake);
    await fake.close();
    await send('hello');
    await waitFor(() => stateOf() === 'error', 'the error', 15_000);
    expect(reasons().at(-1)).toContain(host);
    expect(reasons().at(-1)).toContain("isn't answering");
  });
});

