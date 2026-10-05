/**
 * Epic 6, entry 2 (the tracer) end to end: a real server with Claude Code
 * (the fake ACP agent standing in, as every server test has it) and the fake
 * ACP agent registered again as a second agent. One project holds a chat with
 * each; both stream at once and each reaches its own agent. The server
 * enforces the agent choice and each agent's declared modes from the API.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClaudeCodeAgent } from '@ogden-agents/adapters';
import { createMemoryAgentSetup } from '@ogden-agents/adapters';
import type { AgentDescriptor, AgentPort } from '@ogden-agents/core';
import type { AgentWiring } from '../src/agent-wiring.js';
import {
  AgentsResponse,
  API_ROUTES,
  ApiErrorBody,
  apiPath,
  ChatAgentsResponse,
  NewProjectDefaultsResponse,
  SessionResponse,
  SessionsResponse,
  SignInResponse,
  WorkspaceResponse,
  WorkspaceSettingsResponse,
  type SessionId,
} from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { signIn, startTestServer, testDescriptor, waitFor, type SignedIn, type TestServer } from './helpers.js';

const FAKE_AGENT = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-acp-agent.mjs');

/**
 * The fake ACP agent as a second agent: its own name and modes (Ask and Skip
 * all), no terminal; `setup` its setup port (none: always ready), and
 * `descriptor` changes to its descriptor.
 */
function secondAgent(options: { setup?: AgentWiring['setup']; descriptor?: Partial<AgentDescriptor> } = {}): AgentWiring {
  const base = createClaudeCodeAgent({ adapterPath: FAKE_AGENT, claudeExecutable: null });
  const named = <T extends { env: Readonly<Record<string, string>> }>(input: T): T => ({ ...input, env: { ...input.env, FAKE_ACP_AGENT_NAME: 'fake-agent' } });
  const agent: AgentPort = {
    displayName: 'Fake Agent',
    permissionModes: ['ask', 'skip_all'],
    skillInvocation: (skill, idea) => base.skillInvocation(skill, idea),
    startSession: (input) => base.startSession(named(input)),
    reopenSession: (input) => base.reopenSession(named(input)),
    listAuthMethods: (input) => base.listAuthMethods(input),
  };
  return { descriptor: testDescriptor('fake-agent', agent, options.descriptor), agent, setup: options.setup };
}

const folders: string[] = [];
const servers: TestServer[] = [];
// The servers (and their agents, whose working folder is the repo) stop before the folders go:
// Windows refuses to remove a folder a live process runs in (EPERM). This hook runs before the helpers' own.
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  folders.push(dir);
  return dir;
};

function request(server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) {
  return fetch(`${server.url}${path}`, {
    method,
    headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function setUp(second: AgentWiring = secondAgent(), extra: Parameters<typeof startTestServer>[0] = {}) {
  const server = await startTestServer({ extraAgents: [second], ...extra });
  servers.push(server);
  const tab = await signIn(server);
  const repo = temp('ogden-agents-repo-');
  const wsId = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json()).workspace.id;
  const newChat = async (body: unknown) => request(server, tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId }), body);
  const chatWith = async (agentId?: string) => SessionResponse.parse(await (await newChat(agentId === undefined ? {} : { agentId })).json()).session;
  return { server, tab, wsId, newChat, chatWith };
}

const replies = (server: TestServer, sessionId: SessionId) =>
  server.core.events
    .readAfter(0)
    .filter((event) => event.streamId === sessionId)
    .flatMap((event) => (event.type === 'session.message_completed' && event.payload.role === 'agent' ? [event.payload.content] : []));
const stateOf = (server: TestServer, sessionId: SessionId) => server.core.entities.getSession(sessionId)!.state;

async function send(server: TestServer, tab: SignedIn, wsId: string, sesId: SessionId, text: string) {
  expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId, sesId }), { text })).status).toBe(202);
}

async function say(server: TestServer, tab: SignedIn, wsId: string, sesId: SessionId, text: string): Promise<string> {
  const before = replies(server, sesId).length;
  await send(server, tab, wsId, sesId, text);
  await waitFor(() => stateOf(server, sesId) === 'idle' && replies(server, sesId).length > before, `the reply to ${text}`, 15_000);
  return replies(server, sesId).at(-1)!;
}

describe('two agents side by side in one project (epic 6, entry 2)', () => {
  it('lists the agents a chat can start with, Claude Code first and the default', async () => {
    const { server, tab } = await setUp();
    const response = await request(server, tab, 'GET', API_ROUTES.chatAgents);
    expect(response.status).toBe(200);
    expect(ChatAgentsResponse.parse(await response.json())).toEqual({
      agents: [
        {
          agentId: 'claude-code',
          displayName: 'Claude Code',
          provider: 'Anthropic',
          signInMethods: [
            { kind: 'subscription', label: 'Sign in with your Claude account' },
            { kind: 'api_key', label: 'Use an Anthropic API key' },
          ],
          apiKeyFormat: 'Starts with sk-ant-',
          install: 'installed',
          auth: 'signed_in',
          terminalResume: true,
          needsProjectTrust: false,
          permissionModes: ['ask', 'auto', 'skip_all'],
        },
        {
          agentId: 'fake-agent',
          displayName: 'Fake Agent',
          provider: 'Fake Provider',
          signInMethods: [
            { kind: 'subscription', label: 'Sign in with your account' },
            { kind: 'api_key', label: 'Use an API key' },
          ],
          apiKeyFormat: 'Starts with fake-',
          install: 'installed',
          auth: 'signed_in',
          terminalResume: false,
          needsProjectTrust: false,
          permissionModes: ['ask', 'skip_all'],
        },
      ],
      defaultAgentId: 'claude-code',
    });
  });

  it('a chat with each agent: both stream at once, and each reaches its own agent', async () => {
    const { server, tab, wsId, chatWith } = await setUp();
    const claude = await chatWith('claude-code');
    const fake = await chatWith('fake-agent');
    expect([claude.agentId, fake.agentId]).toEqual(['claude-code', 'fake-agent']);
    const dir = temp('ogden-agents-wait-');
    const [first, second] = [join(dir, 'first'), join(dir, 'second')];
    await send(server, tab, wsId, claude.id, `wait ${first}`);
    await send(server, tab, wsId, fake.id, `wait ${second}`);
    await waitFor(() => stateOf(server, claude.id) === 'working' && stateOf(server, fake.id) === 'working', 'both chats working at once', 15_000);
    writeFileSync(first, '');
    writeFileSync(second, '');
    await waitFor(() => stateOf(server, claude.id) === 'idle' && stateOf(server, fake.id) === 'idle', 'both turns to end', 15_000);
    expect(existsSync(first) && existsSync(second)).toBe(true);
    expect(await say(server, tab, wsId, claude.id, 'whoami')).toBe('agent=default');
    expect(await say(server, tab, wsId, fake.id, 'whoami')).toBe('agent=fake-agent');
    const listed = SessionsResponse.parse(await (await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceSessions, { wsId }))).json()).sessions;
    expect(Object.fromEntries(listed.map((session) => [session.id, session.agentId]))).toEqual({ [claude.id]: 'claude-code', [fake.id]: 'fake-agent' });
  });

  it('a new chat without an agent gets the default; an unknown or malformed agent is refused and nothing is created', async () => {
    const { server, wsId, newChat, chatWith } = await setUp();
    expect((await chatWith()).agentId).toBe('claude-code');
    const unknown = await newChat({ agentId: 'missing-agent' });
    expect(unknown.status).toBe(400);
    expect(ApiErrorBody.parse(await unknown.json()).error.code).toBe('agent_unknown');
    const malformed = await newChat({ agentId: 'Not An Agent' });
    expect(malformed.status).toBe(400);
    expect(ApiErrorBody.parse(await malformed.json()).error.code).toBe('invalid_request');
    expect(server.core.entities.listSessions(wsId as never)).toHaveLength(1);
  });

  it("a chat is offered only its agent's declared modes, and the server refuses the others", async () => {
    const { server, tab, wsId, chatWith } = await setUp();
    const fake = await chatWith('fake-agent');
    const got = SessionResponse.parse(await (await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceSession, { wsId, sesId: fake.id }))).json());
    expect(got.permissionModes).toEqual([
      { mode: 'ask', available: true },
      { mode: 'auto', available: false, reason: "Fake Agent doesn't offer Auto." },
      { mode: 'skip_all', available: true },
    ]);
    // No terminal: the second agent's CLI can't resume its sessions.
    expect(got.terminal).toMatchObject({ available: false, code: 'agent_unsupported' });
    const refused = await request(server, tab, 'PUT', apiPath(API_ROUTES.sessionPermissionMode, { wsId, sesId: fake.id }), { mode: 'auto' });
    expect(refused.status).toBe(409);
    expect(ApiErrorBody.parse(await refused.json()).error.code).toBe('mode_unavailable');
  });

  it('a chat stored before agents could be chosen lists, opens and answers as Claude Code', async () => {
    const { server, tab, wsId } = await setUp();
    // A row as an older install left it: no agent id.
    const old = server.core.entities.createSession({ workspaceId: wsId as never, kind: 'chat' });
    expect(server.core.entities.getSession(old.id)?.agentId).toBeUndefined();
    const got = SessionResponse.parse(await (await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceSession, { wsId, sesId: old.id }))).json());
    expect(got.session.agentId).toBe('claude-code');
    expect(await say(server, tab, wsId, old.id, 'whoami')).toBe('agent=default');
  });
});

describe('a new chat only with an agent that can start it (epic 6, 6.3)', () => {
  it('refuses a chat with an agent that is not installed, says why and what fixes it, and creates nothing', async () => {
    const { server, wsId, newChat, tab } = await setUp(secondAgent({ setup: createMemoryAgentSetup({ agentId: 'fake-agent', displayName: 'Fake Agent', installed: false }) }));
    const refused = await newChat({ agentId: 'fake-agent' });
    expect(refused.status).toBe(409);
    expect(ApiErrorBody.parse(await refused.json()).error).toEqual({
      code: 'agent_not_installed',
      message: "Fake Agent isn't installed. Install it in Settings → Agents.",
      details: { agentId: 'fake-agent', action: 'install' },
    });
    expect(server.core.entities.listSessions(wsId as never)).toHaveLength(0);
    const listed = ChatAgentsResponse.parse(await (await request(server, tab, 'GET', API_ROUTES.chatAgents)).json());
    expect(listed.agents[1]).toMatchObject({ install: 'not_installed', unavailable: { code: 'agent_not_installed', action: 'install' } });
  });

  it('refuses a chat with an agent that is signed out, and starts one once it is signed in', async () => {
    const setup = createMemoryAgentSetup({ agentId: 'fake-agent', displayName: 'Fake Agent', installed: true, auth: 'needs_sign_in' });
    const { server, tab, wsId, newChat } = await setUp(secondAgent({ setup }), { subscriptionMaxAgeMs: 0 });
    const refused = await newChat({ agentId: 'fake-agent' });
    expect(refused.status).toBe(409);
    expect(ApiErrorBody.parse(await refused.json()).error).toEqual({
      code: 'agent_signed_out',
      message: "Fake Agent isn't signed in. Sign in or add an API key in Settings → Agents.",
      details: { agentId: 'fake-agent', action: 'sign_in' },
    });
    expect(server.core.entities.listSessions(wsId as never)).toHaveLength(0);
    expect((await request(server, tab, 'POST', apiPath(API_ROUTES.agentSignIn, { agentId: 'fake-agent' }))).status).toBe(200);
    setup.complete();
    await waitFor(async () => (await newChat({ agentId: 'fake-agent' })).status === 201, 'a chat once signed in', 5_000);
  });

  it('refuses a chat with an agent that needs a trusted project, in a project nobody trusted', async () => {
    const { server, wsId, newChat } = await setUp(secondAgent({ descriptor: { needsProjectTrust: true } }));
    const refused = await newChat({ agentId: 'fake-agent' });
    expect(refused.status).toBe(409);
    expect(ApiErrorBody.parse(await refused.json()).error).toMatchObject({ code: 'project_not_trusted', details: { agentId: 'fake-agent', action: 'trust_project' } });
    expect(server.core.entities.listSessions(wsId as never)).toHaveLength(0);
  });

  it("starts one once the project is trusted (story 4.2's trust), and refuses again once its scripts change (4.13)", async () => {
    const { server, tab, wsId, newChat, chatWith } = await setUp(secondAgent({ descriptor: { needsProjectTrust: true } }));
    expect((await newChat({ agentId: 'fake-agent' })).status).toBe(409);
    expect((await request(server, tab, 'PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }))).status).toBe(200);
    const session = await chatWith('fake-agent');
    expect(session.agentId).toBe('fake-agent');
    // A script planted after the trust (by an agent or anyone) means the project is no longer the one the user trusted.
    const repo = server.core.entities.getWorkspace(wsId as never)!.path;
    mkdirSync(join(repo, '_bmad', 'scripts'), { recursive: true });
    writeFileSync(join(repo, '_bmad', 'scripts', 'config_utils.py'), 'print("planted")\n');
    const refused = await newChat({ agentId: 'fake-agent' });
    expect(refused.status).toBe(409);
    expect(ApiErrorBody.parse(await refused.json()).error).toMatchObject({ code: 'project_not_trusted', details: { agentId: 'fake-agent', action: 'trust_project' } });
    // Agents that need no trust are not held back by it.
    expect((await chatWith()).agentId).toBeDefined();
    expect(server.core.entities.listSessions(wsId as never)).toHaveLength(2);
  });

  it('the trust also binds the files the agent runs (epic 12, 12.3): the list read for the project says so, and a change asks again before the next start', async () => {
    const { server, tab, wsId, newChat, chatWith } = await setUp(secondAgent({ descriptor: { needsProjectTrust: true, projectFiles: ['.claude/settings.json', '.mcp.json'] } }));
    const listed = async () =>
      ChatAgentsResponse.parse(await (await request(server, tab, 'GET', `${API_ROUTES.chatAgents}?workspaceId=${wsId}`)).json()).agents.find((agent) => agent.agentId === 'fake-agent')!;
    // Read for no project, the agent is listed as startable: each project asks for its trust.
    const global = ChatAgentsResponse.parse(await (await request(server, tab, 'GET', API_ROUTES.chatAgents)).json());
    expect(global.agents.find((agent) => agent.agentId === 'fake-agent')?.unavailable).toBeUndefined();
    expect((await listed()).unavailable).toMatchObject({ code: 'project_not_trusted', action: 'trust_project' });
    expect((await request(server, tab, 'PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }))).status).toBe(200);
    expect((await listed()).unavailable).toBeUndefined();
    const session = await chatWith('fake-agent');
    expect(await say(server, tab, wsId, session.id, 'whoami')).toBe('agent=fake-agent');
    // A chat made while the project was trusted, not yet started.
    const fresh = await chatWith('fake-agent');
    // A hook planted in the project's settings after the user trusted it: nothing of that agent starts until trusted again.
    const repo = server.core.entities.getWorkspace(wsId as never)!.path;
    mkdirSync(join(repo, '.claude'), { recursive: true });
    writeFileSync(join(repo, '.claude', 'settings.json'), '{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"echo planted"}]}]}}\n');
    expect((await listed()).unavailable).toMatchObject({ code: 'project_not_trusted' });
    const refused = await newChat({ agentId: 'fake-agent' });
    expect(refused.status).toBe(409);
    expect(ApiErrorBody.parse(await refused.json()).error).toMatchObject({ code: 'project_not_trusted', details: { agentId: 'fake-agent', action: 'trust_project' } });
    // The chat that exists is held back too: its agent process is not started in a changed project.
    await send(server, tab, wsId, fresh.id, 'whoami');
    await waitFor(() => stateOf(server, fresh.id) === 'error', 'the refused start', 15_000);
    expect(replies(server, fresh.id)).toEqual([]);
    expect((await request(server, tab, 'PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }))).status).toBe(200);
    expect((await listed()).unavailable).toBeUndefined();
    expect((await newChat({ agentId: 'fake-agent' })).status).toBe(201);
  });

  it('gives an agent with a home variable its own folder in the data folder, and no other agent its key', async () => {
    // Claude Code signed out, so its key (from this server's environment) is in use: it still reaches only Claude Code.
    const { server, tab, wsId, chatWith } = await setUp(secondAgent({ descriptor: { homeEnv: 'FAKE_AGENT_HOME' } }), {
      extraAgentEnv: { FAKE_LOGIN_STATE: join(tmpdir(), 'ogden-agents-no-login-state.json'), ANTHROPIC_API_KEY: 'sk-ant-inherited-key-for-claude-only-0000', FAKE_AGENT_KEY: 'fake-inherited-key-0000' },
    });
    const fake = await chatWith('fake-agent');
    const env = await say(server, tab, wsId, fake.id, 'echo-env');
    expect(env).toContain(`FAKE_AGENT_HOME=${join(server.dataDir, 'agents', 'fake-agent-home')}`);
    expect(existsSync(join(server.dataDir, 'agents', 'fake-agent-home'))).toBe(true);
    // Every registered agent's key variable is kept out (derived from the descriptors), its own included while signed in.
    expect(env).not.toMatch(/^(ANTHROPIC_API_KEY|FAKE_AGENT_KEY)=/m);
    const claude = await chatWith('claude-code');
    const claudeEnv = await say(server, tab, wsId, claude.id, 'echo-env');
    expect(claudeEnv).toMatch(/^ANTHROPIC_API_KEY=/m);
    expect(claudeEnv).not.toMatch(/^(FAKE_AGENT_HOME|FAKE_AGENT_KEY)=/m);
  });

  it('refuses a wiring whose setup port is for another agent or gives its key in another variable', async () => {
    await expect(startTestServer({ extraAgents: [secondAgent({ setup: createMemoryAgentSetup({ agentId: 'other-agent' }) })] })).rejects.toThrow(/setup port is other-agent's/);
    const keyed = { ...createMemoryAgentSetup({ agentId: 'fake-agent' }), apiKey: { envName: 'OTHER_KEY', check: () => undefined, verify: async () => 'ok' as const } };
    await expect(startTestServer({ extraAgents: [secondAgent({ setup: keyed })] })).rejects.toThrow(/gives its key in OTHER_KEY/);
  });
});

describe("a project's default agent and the default for new projects (epic 6, entry 6)", () => {
  const settingsEvents = (server: TestServer, wsId: string) =>
    server.core.events.readAfter(0).filter((event) => event.type === 'workspace.settings_changed' && event.workspaceId === wsId);

  it('keeps a project default through PATCH settings, with its event, and a new chat with no agent picked gets it', async () => {
    const { server, tab, wsId, chatWith } = await setUp();
    const path = apiPath(API_ROUTES.workspaceSettings, { wsId });
    const saved = await request(server, tab, 'PATCH', path, { defaultAgentId: 'fake-agent' });
    expect(saved.status).toBe(200);
    expect(WorkspaceSettingsResponse.parse(await saved.json()).settings.defaultAgentId).toBe('fake-agent');
    expect(WorkspaceSettingsResponse.parse(await (await request(server, tab, 'GET', path)).json()).settings.defaultAgentId).toBe('fake-agent');
    expect(settingsEvents(server, wsId).at(-1)?.payload).toMatchObject({ defaultAgentId: 'fake-agent', previousDefaultAgentId: null });

    // The same value again changes nothing: no event.
    const before = settingsEvents(server, wsId).length;
    expect((await request(server, tab, 'PATCH', path, { defaultAgentId: 'fake-agent' })).status).toBe(200);
    expect(settingsEvents(server, wsId)).toHaveLength(before);

    const chat = await chatWith();
    expect(chat.agentId).toBe('fake-agent');
    expect(await say(server, tab, wsId, chat.id, 'whoami')).toBe('agent=fake-agent');
    // A chat can still pick another agent.
    expect((await chatWith('claude-code')).agentId).toBe('claude-code');

    // null goes back to the install's default.
    const cleared = WorkspaceSettingsResponse.parse(await (await request(server, tab, 'PATCH', path, { defaultAgentId: null })).json()).settings;
    expect(cleared.defaultAgentId).toBeUndefined();
    expect(settingsEvents(server, wsId).at(-1)?.payload).toMatchObject({ defaultAgentId: null, previousDefaultAgentId: 'fake-agent' });
    expect((await chatWith()).agentId).toBe('claude-code');
  });

  it('refuses an agent this install does not have, storing nothing', async () => {
    const { server, tab, wsId } = await setUp();
    const path = apiPath(API_ROUTES.workspaceSettings, { wsId });
    const before = settingsEvents(server, wsId).length;
    const refused = await request(server, tab, 'PATCH', path, { defaultAgentId: 'gone-agent', cautionLevel: 'ask_for_commands' });
    expect(refused.status).toBe(400);
    expect(ApiErrorBody.parse(await refused.json()).error.code).toBe('agent_unknown');
    expect(settingsEvents(server, wsId)).toHaveLength(before);
    expect(WorkspaceSettingsResponse.parse(await (await request(server, tab, 'GET', path)).json()).settings).toEqual({ cautionLevel: 'ask_every_time', bmadPieces: [], bmadScriptsTrusted: false });
  });

  it("keeps the default for new projects beside the pieces; a project added later gets it, one that exists keeps its own", async () => {
    const { server, tab, wsId } = await setUp();
    const saved = await request(server, tab, 'PATCH', API_ROUTES.newProjectDefaults, { defaultAgentId: 'fake-agent' });
    expect(saved.status).toBe(200);
    expect(NewProjectDefaultsResponse.parse(await saved.json()).defaults).toEqual({ bmadPieces: [], defaultAgentId: 'fake-agent' });
    // Saving the pieces alone keeps the agent.
    const pieces = NewProjectDefaultsResponse.parse(await (await request(server, tab, 'PATCH', API_ROUTES.newProjectDefaults, { bmadPieces: [] })).json()).defaults;
    expect(pieces.defaultAgentId).toBe('fake-agent');
    const unknown = await request(server, tab, 'PATCH', API_ROUTES.newProjectDefaults, { defaultAgentId: 'gone-agent' });
    expect(unknown.status).toBe(400);
    expect(ApiErrorBody.parse(await unknown.json()).error.code).toBe('agent_unknown');

    const repo = temp('ogden-agents-repo-');
    const added = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json()).workspace.id;
    const settingsOf = async (id: string) => WorkspaceSettingsResponse.parse(await (await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceSettings, { wsId: id }))).json()).settings;
    expect((await settingsOf(added)).defaultAgentId).toBe('fake-agent');
    expect(settingsEvents(server, added).at(-1)?.payload).toMatchObject({ defaultAgentId: 'fake-agent', previousDefaultAgentId: null });
    expect((await settingsOf(wsId)).defaultAgentId).toBeUndefined();
  });

  it('names each agent\'s provider in its setup status, and hands a sign-in code back only in the sign-in answer', async () => {
    const setup = createMemoryAgentSetup({ agentId: 'fake-agent', displayName: 'Fake Agent', installed: true, auth: 'needs_sign_in', userCode: 'ABCD-1234' });
    const { server, tab } = await setUp(secondAgent({ setup }));
    const agents = AgentsResponse.parse(await (await request(server, tab, 'GET', API_ROUTES.agents)).json()).agents;
    expect(agents.find((agent) => agent.agentId === 'fake-agent')?.provider).toBe('Fake Provider');
    expect(agents.find((agent) => agent.agentId === 'claude-code')?.provider).toBe('Anthropic');
    const answer = await request(server, tab, 'POST', apiPath(API_ROUTES.agentSignIn, { agentId: 'fake-agent' }));
    expect(SignInResponse.parse(await answer.json())).toMatchObject({ state: 'signing_in', code: 'ABCD-1234' });
    expect(JSON.stringify(server.core.events.readAfter(0))).not.toContain('ABCD-1234');
  });
});
