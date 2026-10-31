/**
 * Epic 21, story 21.1 (the tracer) end to end: a running server registers the
 * fake ACP agent by its command line through the API, lists it in Ask with no
 * sign in, and a chat with it streams the fake agent's reply, with no restart.
 * A command that can't be found or run registers nothing; one removed after
 * it was registered fails the chat's start in plain words.
 */
import { copyFileSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API_ROUTES, ApiErrorBody, apiPath, ChatAgentsResponse, CustomAgentCreateResponse, SessionResponse, WorkspaceResponse, type SessionId } from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { FAKE_AGENT, signIn, startTestServer, waitFor, type SignedIn, type TestServer } from './helpers.js';

const folders: string[] = [];
const servers: TestServer[] = [];
// The servers (and their agents) stop before the folders go: Windows refuses to remove a folder a live process runs in.
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  folders.push(dir);
  return dir;
};

const quoted = (path: string) => `"${path}"`;
const FAKE_COMMAND = `${quoted(process.execPath)} ${quoted(FAKE_AGENT)}`;

function request(server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) {
  return fetch(`${server.url}${path}`, {
    method,
    headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function setUp() {
  const server = await startTestServer();
  servers.push(server);
  const tab = await signIn(server);
  const register = (body: unknown) => request(server, tab, 'POST', API_ROUTES.customAgents, body);
  const listed = async () => ChatAgentsResponse.parse(await (await request(server, tab, 'GET', API_ROUTES.chatAgents)).json()).agents;
  return { server, tab, register, listed };
}

/** A trusted project (a custom agent needs one) and a way to start chats in it. */
async function trustedProject(server: TestServer, tab: SignedIn) {
  const wsId = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: temp('ogden-agents-repo-') })).json()).workspace.id;
  expect((await request(server, tab, 'PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }))).status).toBe(200);
  const chatWith = async (agentId: string) => {
    const response = await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId }), { agentId });
    expect(response.status).toBe(201);
    return SessionResponse.parse(await response.json()).session;
  };
  const send = async (sesId: SessionId, text: string) => expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId, sesId }), { text })).status).toBe(202);
  return { wsId, chatWith, send };
}

const eventsOf = (server: TestServer, sessionId: SessionId) => server.core.events.readAfter(0).filter((event) => event.streamId === sessionId);
const replies = (server: TestServer, sessionId: SessionId) =>
  eventsOf(server, sessionId).flatMap((event) => (event.type === 'session.message_completed' && event.payload.role === 'agent' ? [event.payload.content] : []));
const stateOf = (server: TestServer, sessionId: SessionId) => server.core.entities.getSession(sessionId)!.state;

describe('registering a custom ACP agent by its command (epic 21 story 21.1)', () => {
  it('registers it live as custom-<slug>, lists it in Ask with no sign in, and gives a second one of the same name -2', async () => {
    const { register, listed } = await setUp();
    const first = await register({ displayName: 'My Agent', commandLine: FAKE_COMMAND });
    expect(first.status).toBe(201);
    expect(CustomAgentCreateResponse.parse(await first.json())).toEqual({ agentId: 'custom-my-agent' });
    const agent = (await listed()).find((each) => each.agentId === 'custom-my-agent');
    expect(agent).toMatchObject({ displayName: 'My Agent', signInMethods: [], noAccount: true, permissionModes: ['ask'], needsProjectTrust: true, install: 'installed', auth: 'signed_in' });
    expect(agent?.unavailable).toBeUndefined();

    const second = await register({ displayName: '  My Agent ', commandLine: FAKE_COMMAND });
    expect(second.status).toBe(201);
    expect(CustomAgentCreateResponse.parse(await second.json())).toEqual({ agentId: 'custom-my-agent-2' });
    expect((await listed()).map((each) => each.agentId)).toEqual(['claude-code', 'custom-my-agent', 'custom-my-agent-2']);
  });

  it('refuses a command that cannot be found or run with the plain reason, and registers nothing', async () => {
    const { register, listed } = await setUp();
    for (const commandLine of ['ogden-no-such-agent-command --acp', 'relative/agent --acp', quoted(join(temp('ogden-agents-none-'), 'missing-agent'))]) {
      const refused = await register({ displayName: 'My Agent', commandLine });
      expect(refused.status).toBe(400);
      const { error } = ApiErrorBody.parse(await refused.json());
      expect(error.code).toBe('custom_agent_command_invalid');
      expect(error.message.length).toBeGreaterThan(0);
    }
    expect((await listed()).map((each) => each.agentId)).toEqual(['claude-code']);
  });

  it.each([
    ['an empty name', { displayName: '   ', commandLine: FAKE_COMMAND }],
    ['an over-long name', { displayName: 'x'.repeat(41), commandLine: FAKE_COMMAND }],
    ['a name with a control character', { displayName: 'My\u0007Agent', commandLine: FAKE_COMMAND }],
    ['an empty command', { displayName: 'My Agent', commandLine: ' ' }],
    ['an over-long command', { displayName: 'My Agent', commandLine: `${FAKE_COMMAND} ${'a'.repeat(1000)}` }],
    ['no command', { displayName: 'My Agent' }],
  ])('refuses %s as invalid_request', async (_what, body) => {
    const { register, listed } = await setUp();
    const refused = await register(body);
    expect(refused.status).toBe(400);
    expect(ApiErrorBody.parse(await refused.json()).error.code).toBe('invalid_request');
    expect((await listed()).map((each) => each.agentId)).toEqual(['claude-code']);
  });

  it('a chat with it streams the fake agent\'s reply into the session, with no restart', async () => {
    const { server, tab, register } = await setUp();
    expect((await register({ displayName: 'My Agent', commandLine: FAKE_COMMAND })).status).toBe(201);
    const { chatWith, send } = await trustedProject(server, tab);
    const session = await chatWith('custom-my-agent');
    expect(session.agentId).toBe('custom-my-agent');
    await send(session.id, 'hi');
    await waitFor(() => stateOf(server, session.id) === 'idle' && replies(server, session.id).length > 0, 'the reply to hi', 15_000);
    expect(replies(server, session.id)).toEqual(['Hello from the fake agent.']);
  });

  it('never reuses an id a stored chat names: after a restart on the same data folder, the same name gets -2', async () => {
    const dataDir = temp('ogden-agents-data-');
    const first = await startTestServer({ dataDir });
    servers.push(first);
    const firstTab = await signIn(first);
    expect((await request(first, firstTab, 'POST', API_ROUTES.customAgents, { displayName: 'My Agent', commandLine: FAKE_COMMAND })).status).toBe(201);
    const { chatWith } = await trustedProject(first, firstTab);
    expect((await chatWith('custom-my-agent')).agentId).toBe('custom-my-agent');
    await first.close();

    const second = await startTestServer({ dataDir });
    servers.push(second);
    const tab = await signIn(second);
    const again = await request(second, tab, 'POST', API_ROUTES.customAgents, { displayName: 'My Agent', commandLine: FAKE_COMMAND });
    expect(again.status).toBe(201);
    expect(CustomAgentCreateResponse.parse(await again.json())).toEqual({ agentId: 'custom-my-agent-2' });
  });

  it('a command removed after it was registered fails the chat agent_unavailable in plain words; the server stays up', async () => {
    const lines: string[] = [];
    const server = await startTestServer({ lines });
    servers.push(server);
    const tab = await signIn(server);
    // A link to Node (a copy on Windows, where links need privileges), removed once registered.
    const node = join(temp('ogden-agents-node-'), process.platform === 'win32' ? 'node.exe' : 'node');
    if (process.platform === 'win32') copyFileSync(process.execPath, node);
    else symlinkSync(process.execPath, node);
    expect((await request(server, tab, 'POST', API_ROUTES.customAgents, { displayName: 'My Agent', commandLine: `${quoted(node)} ${quoted(FAKE_AGENT)}` })).status).toBe(201);
    rmSync(node, { force: true, maxRetries: 10, retryDelay: 200 });
    const { chatWith, send } = await trustedProject(server, tab);
    const session = await chatWith('custom-my-agent');
    await send(session.id, 'hi');
    await waitFor(() => stateOf(server, session.id) === 'error', 'error', 10_000);
    const failed = eventsOf(server, session.id).filter((event) => event.type === 'session.state_changed').at(-1);
    expect(failed).toMatchObject({ type: 'session.state_changed', payload: { state: 'error', reason: expect.stringContaining("couldn't find") } });
    expect(lines.some((line) => line.includes('"agent failed"') && line.includes('agent_unavailable'))).toBe(true);
    expect((await fetch(`${server.url}${API_ROUTES.tabCheck}`, { headers: tab.headers })).status).toBe(204);
  });
});
