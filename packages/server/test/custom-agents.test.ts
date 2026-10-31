/**
 * Epic 21, story 21.1 (the tracer) end to end: a running server registers the
 * fake ACP agent by its command line through the API, lists it in Ask with no
 * sign in, and a chat with it streams the fake agent's reply, with no restart.
 * A command that can't be found or run registers nothing; one removed after
 * it was registered fails the chat's start in plain words.
 */
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API_ROUTES, ApiErrorBody, apiPath, ChatAgentsResponse, CustomAgentListResponse, CustomAgentResponse, CustomAgentTestResponse, SessionResponse, WorkspaceResponse, type SessionId } from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createCustomAgent, createMemorySecretStore, customAgentDescriptor } from '@ogden-agents/adapters';
import { supportsUnattendedBuild } from '../src/build-agent-sandbox.js';
import { SecretsUnavailableError, type SecretStorePort } from '@ogden-agents/core';
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
  const register = Object.assign((body: unknown) => request(server, tab, 'POST', API_ROUTES.customAgents, body), { list: () => request(server, tab, 'GET', API_ROUTES.customAgents) });
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
    expect(CustomAgentResponse.parse(await first.json()).agent).toEqual({ agentId: 'custom-my-agent', displayName: 'My Agent', commandLine: FAKE_COMMAND, keyEnvName: null, hasKey: false });
    const agent = (await listed()).find((each) => each.agentId === 'custom-my-agent');
    expect(agent).toMatchObject({ displayName: 'My Agent', signInMethods: [], noAccount: true, permissionModes: ['ask'], needsProjectTrust: true, install: 'installed', auth: 'signed_in' });
    expect(agent?.unavailable).toBeUndefined();

    const second = await register({ displayName: '  My Agent ', commandLine: FAKE_COMMAND });
    expect(second.status).toBe(201);
    expect(CustomAgentResponse.parse(await second.json()).agent.agentId).toBe('custom-my-agent-2');
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

  it('finds a bare program name on the chat environment\'s PATH, as a user types it (epic 21 audit)', async () => {
    // A folder holding a link to Node (a copy on Windows) named `my-agent-node`, put on PATH for the agents only.
    const bin = temp('ogden-agents-bin-');
    const name = 'my-agent-node';
    const node = join(bin, process.platform === 'win32' ? `${name}.exe` : name);
    if (process.platform === 'win32') copyFileSync(process.execPath, node);
    else symlinkSync(process.execPath, node);
    const server = await startTestServer({ extraAgentEnv: { PATH: `${bin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}` } });
    servers.push(server);
    const tab = await signIn(server);
    const added = await request(server, tab, 'POST', API_ROUTES.customAgents, { displayName: 'Bare', commandLine: `${name} ${quoted(FAKE_AGENT)}` });
    expect(added.status).toBe(201);
    const { chatWith, send } = await trustedProject(server, tab);
    const session = await chatWith('custom-bare');
    await send(session.id, 'hi');
    await waitFor(() => stateOf(server, session.id) === 'idle' && replies(server, session.id).length > 0, 'the reply to hi', 15_000);
    expect(replies(server, session.id)).toEqual(['Hello from the fake agent.']);
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

/** Every file under `dir`, the database included, as text. */
function allText(dir: string): string {
  return readdirSync(dir)
    .map((name) => join(dir, name))
    .map((path) => (statSync(path).isDirectory() ? allText(path) : readFileSync(path).toString('latin1')))
    .join('\n');
}

const KEY = 'sk-custom-dummy-key-7d41aa';
const WITH_KEY = { displayName: 'My Agent', commandLine: FAKE_COMMAND, apiKey: { envName: 'MY_AGENT_API_KEY', value: KEY } };

describe('custom agents are kept, changed and removed, with a key only they get (epic 21 story 21.2)', () => {
  it('are still registered after a restart and chat, and their key reaches only their own process', async () => {
    const dataDir = temp('ogden-agents-data-');
    const secrets = createMemorySecretStore();
    const lines: string[] = [];
    const first = await startTestServer({ dataDir, secrets, lines });
    servers.push(first);
    const firstTab = await signIn(first);
    expect((await request(first, firstTab, 'POST', API_ROUTES.customAgents, WITH_KEY)).status).toBe(201);
    expect((await request(first, firstTab, 'POST', API_ROUTES.customAgents, { displayName: 'Other', commandLine: FAKE_COMMAND })).status).toBe(201);
    await first.close();

    const server = await startTestServer({ dataDir, secrets, lines });
    servers.push(server);
    const tab = await signIn(server);
    const listed = CustomAgentListResponse.parse(await (await request(server, tab, 'GET', API_ROUTES.customAgents)).json()).agents;
    expect(listed.map((agent) => [agent.agentId, agent.keyEnvName, agent.hasKey])).toEqual([
      ['custom-my-agent', 'MY_AGENT_API_KEY', true],
      ['custom-other', null, false],
    ]);
    const { chatWith, send } = await trustedProject(server, tab);
    const ask = async (agentId: string) => {
      const session = await chatWith(agentId);
      await send(session.id, 'has-env MY_AGENT_API_KEY');
      await waitFor(() => stateOf(server, session.id) === 'idle' && replies(server, session.id).length > 0, `${agentId}'s reply`, 15_000);
      return replies(server, session.id)[0];
    };
    expect(await ask('custom-my-agent')).toBe(`MY_AGENT_API_KEY=set ending ${KEY.slice(-4)}`);
    expect(await ask('custom-other')).toBe('MY_AGENT_API_KEY=unset');
    expect(await ask('claude-code')).toBe('MY_AGENT_API_KEY=unset');

    expect(JSON.stringify(server.core.events.readAfter(0))).not.toContain(KEY);
    await server.close();
    expect(lines.join('\n')).not.toContain(KEY);
    expect(allText(dataDir)).not.toContain(KEY);
  });

  it('changes one live (a new name and key, then no key), and refuses one not added or a bad command', async () => {
    const { server, tab, register } = await setUp();
    expect((await register(WITH_KEY)).status).toBe(201);
    const path = apiPath(API_ROUTES.customAgent, { agentId: 'custom-my-agent' });
    const renamed = await request(server, tab, 'PATCH', path, { displayName: 'Renamed', apiKey: { envName: 'OTHER_API_KEY', value: `${KEY}-2` } });
    expect(renamed.status).toBe(200);
    expect(renamed.headers.get('cache-control')).toBe('no-store');
    expect(CustomAgentResponse.parse(await renamed.json()).agent).toMatchObject({ agentId: 'custom-my-agent', displayName: 'Renamed', keyEnvName: 'OTHER_API_KEY', hasKey: true });
    const agents = ChatAgentsResponse.parse(await (await request(server, tab, 'GET', API_ROUTES.chatAgents)).json()).agents;
    expect(agents.find((agent) => agent.agentId === 'custom-my-agent')?.displayName).toBe('Renamed');

    const { chatWith, send } = await trustedProject(server, tab);
    const session = await chatWith('custom-my-agent');
    await send(session.id, 'has-env OTHER_API_KEY');
    await waitFor(() => replies(server, session.id).length > 0, 'the reply', 15_000);
    expect(replies(server, session.id)[0]).toBe(`OTHER_API_KEY=set ending ${`${KEY}-2`.slice(-4)}`);

    const keyless = await request(server, tab, 'PATCH', path, { apiKey: null });
    expect(CustomAgentResponse.parse(await keyless.json()).agent).toMatchObject({ keyEnvName: null, hasKey: false });
    expect((await request(server, tab, 'PATCH', path, { commandLine: 'ogden-no-such-agent-command' })).status).toBe(400);
    const missing = await request(server, tab, 'PATCH', apiPath(API_ROUTES.customAgent, { agentId: 'custom-nobody' }), { displayName: 'x' });
    expect(missing.status).toBe(404);
    expect(ApiErrorBody.parse(await missing.json()).error.code).toBe('custom_agent_not_found');
    expect((await request(server, tab, 'PATCH', path, {})).status).toBe(400);
  });

  it('removes one and its key; the id a chat named is not given again', async () => {
    const { server, tab, register, listed } = await setUp();
    expect((await register(WITH_KEY)).status).toBe(201);
    const { chatWith } = await trustedProject(server, tab);
    await chatWith('custom-my-agent');
    const path = apiPath(API_ROUTES.customAgent, { agentId: 'custom-my-agent' });
    expect((await request(server, tab, 'DELETE', path)).status).toBe(204);
    expect((await listed()).map((agent) => agent.agentId)).toEqual(['claude-code']);
    expect(CustomAgentListResponse.parse(await (await request(server, tab, 'GET', API_ROUTES.customAgents)).json()).agents).toEqual([]);
    expect((await request(server, tab, 'DELETE', path)).status).toBe(404);
    const again = await register({ displayName: 'My Agent', commandLine: FAKE_COMMAND });
    expect(CustomAgentResponse.parse(await again.json()).agent.agentId).toBe('custom-my-agent-2');
  });

  it.each(['PATH', 'NODE_OPTIONS', 'LD_PRELOAD_API_KEY', 'my_agent_api_key', 'MY_AGENT_TOKEN'])('refuses the key variable %s, keeping nothing', async (envName) => {
    const { register } = await setUp();
    const refused = await register({ ...WITH_KEY, apiKey: { envName, value: KEY } });
    expect(refused.status).toBe(400);
    expect(ApiErrorBody.parse(await refused.json()).error.code).toBe('invalid_request');
    expect(CustomAgentListResponse.parse(await (await register.list()).json()).agents).toEqual([]);
  });

  it('keeps nothing when the keychain is unavailable (503 secrets_unavailable)', async () => {
    const broken: SecretStorePort = {
      backend: 'broken',
      get: async () => Promise.reject(new SecretsUnavailableError()),
      set: async () => Promise.reject(new SecretsUnavailableError()),
      delete: async () => Promise.reject(new SecretsUnavailableError()),
    };
    const server = await startTestServer({ secrets: broken });
    servers.push(server);
    const tab = await signIn(server);
    const refused = await request(server, tab, 'POST', API_ROUTES.customAgents, WITH_KEY);
    expect(refused.status).toBe(503);
    expect(ApiErrorBody.parse(await refused.json()).error.code).toBe('secrets_unavailable');
    expect(CustomAgentListResponse.parse(await (await request(server, tab, 'GET', API_ROUTES.customAgents)).json()).agents).toEqual([]);
  });
});

describe('Test starts a custom agent once and says what it offers (epic 21 story 21.3)', () => {
  it('tests a typed command before it is saved: the lines from initialize, nothing kept, no key anywhere', async () => {
    const lines: string[] = [];
    const server = await startTestServer({ lines });
    servers.push(server);
    const tab = await signIn(server);
    const response = await request(server, tab, 'POST', API_ROUTES.customAgentsTest, { commandLine: FAKE_COMMAND, apiKey: { envName: 'MY_AGENT_API_KEY', value: KEY } });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.text();
    expect(CustomAgentTestResponse.parse(JSON.parse(body)).lines).toEqual([
      'It started and says it is fake-acp-agent 1.0.0.',
      "It can't reopen a chat itself. Ogden shows the saved conversation instead.",
      'Messages to it are text only.',
    ]);
    expect(body).not.toContain(KEY);
    expect(CustomAgentListResponse.parse(await (await request(server, tab, 'GET', API_ROUTES.customAgents)).json()).agents).toEqual([]);
    expect(JSON.stringify(server.core.events.readAfter(0))).not.toContain(KEY);
    expect(lines.join('\n')).not.toContain(KEY);
    expect(lines.join('\n')).not.toContain(FAKE_AGENT);
  });

  it('refuses a command that does not resolve as Save does, and an agent that fails as one plain sentence', async () => {
    const server = await startTestServer({ extraAgentEnv: { FAKE_ACP_EXIT_AT_START: '1' } });
    servers.push(server);
    const tab = await signIn(server);
    const refused = await request(server, tab, 'POST', API_ROUTES.customAgentsTest, { commandLine: 'relative/agent --acp' });
    expect(refused.status).toBe(400);
    expect(ApiErrorBody.parse(await refused.json()).error.code).toBe('custom_agent_command_invalid');
    const failed = await request(server, tab, 'POST', API_ROUTES.customAgentsTest, { commandLine: FAKE_COMMAND });
    expect(failed.status).toBe(422);
    const { error } = ApiErrorBody.parse(await failed.json());
    expect(error).toMatchObject({ code: 'custom_agent_test_failed', details: { reason: expect.any(String) } });
    expect(error.message.length).toBeGreaterThan(0);
  });

  it("gives Test the typed key, or a saved agent its own key, and no other agent's", async () => {
    const server = await startTestServer({ extraAgentEnv: { FAKE_ACP_TITLE_ENV: 'MY_AGENT_API_KEY' } });
    servers.push(server);
    const tab = await signIn(server);
    const nameOf = async (response: Response) => CustomAgentTestResponse.parse(await response.json()).advertised.name;
    expect(await nameOf(await request(server, tab, 'POST', API_ROUTES.customAgentsTest, { commandLine: FAKE_COMMAND, apiKey: { envName: 'MY_AGENT_API_KEY', value: KEY } }))).toBe('MY_AGENT_API_KEY=set');
    expect(await nameOf(await request(server, tab, 'POST', API_ROUTES.customAgentsTest, { commandLine: FAKE_COMMAND }))).toBe('MY_AGENT_API_KEY=unset');
    expect((await request(server, tab, 'POST', API_ROUTES.customAgents, WITH_KEY)).status).toBe(201);
    expect((await request(server, tab, 'POST', API_ROUTES.customAgents, { displayName: 'Other', commandLine: FAKE_COMMAND })).status).toBe(201);
    expect(await nameOf(await request(server, tab, 'POST', apiPath(API_ROUTES.customAgentTest, { agentId: 'custom-my-agent' })))).toBe('MY_AGENT_API_KEY=set');
    expect(await nameOf(await request(server, tab, 'POST', apiPath(API_ROUTES.customAgentTest, { agentId: 'custom-other' })))).toBe('MY_AGENT_API_KEY=unset');
  });

  it('runs one Test of an agent at a time: a second while the first runs is 409', async () => {
    const server = await startTestServer({ extraAgentEnv: { FAKE_ACP_INIT_DELAY_MS: '1500' } });
    servers.push(server);
    const tab = await signIn(server);
    const first = request(server, tab, 'POST', API_ROUTES.customAgentsTest, { commandLine: FAKE_COMMAND });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const second = await request(server, tab, 'POST', API_ROUTES.customAgentsTest, { commandLine: FAKE_COMMAND });
    expect(second.status).toBe(409);
    expect(ApiErrorBody.parse(await second.json()).error.code).toBe('custom_agent_test_running');
    expect((await first).status).toBe(200);
  });

  it('tests a saved agent with its own command, and 404s one not added', async () => {
    const { server, tab, register } = await setUp();
    expect((await register(WITH_KEY)).status).toBe(201);
    const response = await request(server, tab, 'POST', apiPath(API_ROUTES.customAgentTest, { agentId: 'custom-my-agent' }));
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(CustomAgentTestResponse.parse(JSON.parse(body)).advertised).toMatchObject({ name: 'fake-acp-agent', resume: false });
    expect(body).not.toContain(KEY);
    const missing = await request(server, tab, 'POST', apiPath(API_ROUTES.customAgentTest, { agentId: 'custom-nobody' }));
    expect(missing.status).toBe(404);
  });
});

describe('a custom agent stays in its limits, and its chats outlive it (epic 21 story 21.4)', () => {
  it('is Ask only, refuses Auto, says it is never an orchestration worker, and needs a trusted project', async () => {
    const { server, tab, register } = await setUp();
    expect((await register({ displayName: 'My Agent', commandLine: FAKE_COMMAND })).status).toBe(201);
    const agent = ChatAgentsResponse.parse(await (await request(server, tab, 'GET', API_ROUTES.chatAgents)).json()).agents.find((each) => each.agentId === 'custom-my-agent');
    expect(agent).toMatchObject({ permissionModes: ['ask'], interactiveOnly: expect.stringContaining('never as a worker') });

    // An untrusted project refuses a new chat with it, saying what to do.
    const untrusted = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: temp('ogden-agents-repo-') })).json()).workspace.id;
    const refused = await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId: untrusted }), { agentId: 'custom-my-agent' });
    expect(refused.status).toBe(409);
    expect(ApiErrorBody.parse(await refused.json()).error.code).toBe('project_not_trusted');

    const { wsId, chatWith } = await trustedProject(server, tab);
    const session = await chatWith('custom-my-agent');
    const auto = await request(server, tab, 'PUT', apiPath(API_ROUTES.sessionPermissionMode, { wsId, sesId: session.id }), { mode: 'auto' });
    expect(auto.status).toBe(409);
    expect(ApiErrorBody.parse(await auto.json()).error.code).toBe('mode_unavailable');
    // Skip all is refused before the mode check, at Developer mode (403): either way the chat stays in Ask.
    const skipAll = await request(server, tab, 'PUT', apiPath(API_ROUTES.sessionPermissionMode, { wsId, sesId: session.id }), { mode: 'skip_all', confirm: true });
    expect(skipAll.status).toBe(403);
    expect(server.core.entities.getSession(session.id)!.permissionMode).toBe('ask');
  });

  it("can't take the worker or reviewer role on a team: the roster says why, in its own words", async () => {
    const { server, tab, register } = await setUp();
    expect((await register({ displayName: 'My Agent', commandLine: FAKE_COMMAND })).status).toBe(201);
    const view = await request(server, tab, 'GET', API_ROUTES.teamRosterDefault);
    expect(view.status).toBe(200);
    expect(JSON.stringify(await view.json())).toContain('My Agent is never given instructions by a manager. An agent you add yourself works only in chats you drive');
  });

  it('never builds unattended: its port declares no unattended build, so the build check refuses it', async () => {
    const port = createCustomAgent({ descriptor: customAgentDescriptor({ agentId: 'custom-my-agent', displayName: 'My Agent' }), commandLine: FAKE_COMMAND });
    expect(port.unattendedBuild).not.toBe(true);
    expect(supportsUnattendedBuild(port)).toBe(false);
  });

  it('removed while it works, its turn stops as Stop does and what was queued is never sent to it', async () => {
    const { server, tab, register } = await setUp();
    expect((await register({ displayName: 'My Agent', commandLine: FAKE_COMMAND })).status).toBe(201);
    const { wsId, chatWith, send } = await trustedProject(server, tab);
    const session = await chatWith('custom-my-agent');
    await send(session.id, 'permission');
    await waitFor(() => stateOf(server, session.id) === 'waiting', 'the permission card', 15_000);
    await send(session.id, 'queued after the card');
    expect((await request(server, tab, 'DELETE', apiPath(API_ROUTES.customAgent, { agentId: 'custom-my-agent' }))).status).toBe(204);
    await waitFor(() => stateOf(server, session.id) === 'idle', 'the chat stopped', 15_000);
    const userMessages = eventsOf(server, session.id).flatMap((event) => (event.type === 'session.message_completed' && event.payload.role === 'user' ? [event.payload.content] : []));
    expect(userMessages).not.toContain('queued after the card');
    const refused = await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId, sesId: session.id }), { text: 'more' });
    expect(refused.status).toBe(409);
  });

  it("removed, its chat is still read-only after a restart", async () => {
    const dataDir = temp('ogden-agents-data-');
    const secrets = createMemorySecretStore();
    const first = await startTestServer({ dataDir, secrets });
    servers.push(first);
    const firstTab = await signIn(first);
    expect((await request(first, firstTab, 'POST', API_ROUTES.customAgents, { displayName: 'My Agent', commandLine: FAKE_COMMAND })).status).toBe(201);
    const { wsId, chatWith } = await trustedProject(first, firstTab);
    const session = await chatWith('custom-my-agent');
    expect((await request(first, firstTab, 'DELETE', apiPath(API_ROUTES.customAgent, { agentId: 'custom-my-agent' }))).status).toBe(204);
    await first.close();

    const server = await startTestServer({ dataDir, secrets });
    servers.push(server);
    const tab = await signIn(server);
    expect((await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceSession, { wsId, sesId: session.id }))).status).toBe(200);
    const refused = await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId, sesId: session.id }), { text: 'hello again' });
    expect(refused.status).toBe(409);
    expect(ApiErrorBody.parse(await refused.json()).error.code).toBe('agent_removed');
  });

  it('removed, its chat is still readable, and a message to it is refused 409 agent_removed with nothing sent', async () => {
    const { server, tab, register } = await setUp();
    expect((await register({ displayName: 'My Agent', commandLine: FAKE_COMMAND })).status).toBe(201);
    const { wsId, chatWith, send } = await trustedProject(server, tab);
    const session = await chatWith('custom-my-agent');
    await send(session.id, 'hi');
    await waitFor(() => stateOf(server, session.id) === 'idle' && replies(server, session.id).length > 0, 'the reply to hi', 15_000);

    expect((await request(server, tab, 'DELETE', apiPath(API_ROUTES.customAgent, { agentId: 'custom-my-agent' }))).status).toBe(204);
    const read = await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceSession, { wsId, sesId: session.id }));
    expect(read.status).toBe(200);
    expect(SessionResponse.parse(await read.json()).session.agentId).toBe('custom-my-agent');
    expect(replies(server, session.id)).toEqual(['Hello from the fake agent.']);

    const before = eventsOf(server, session.id).length;
    const refused = await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId, sesId: session.id }), { text: 'still there?' });
    expect(refused.status).toBe(409);
    expect(ApiErrorBody.parse(await refused.json()).error).toMatchObject({ code: 'agent_removed', message: 'This agent was removed.' });
    expect(eventsOf(server, session.id).length).toBe(before);
  });
});
