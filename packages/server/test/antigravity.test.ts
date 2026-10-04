/**
 * Epic 6 entry 5 end to end: a real server with Claude Code (the fake ACP
 * agent) and Antigravity in its wiring slot, its server played by the fake
 * agent's Antigravity personality (`tests/fixtures/fake-antigravity.mjs`) and
 * its setup port the real one on a data folder where the pinned server is
 * planted. No test runs the real server, reads `~/.gemini` or reaches Google.
 */
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ANTIGRAVITY_PINS, createAntigravityAgent, createAntigravitySetup } from '@ogden-agents/adapters';
import { API_ROUTES, ApiErrorBody, apiPath, ChatAgentsResponse, SessionResponse, WorkspaceResponse, type SessionId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import type { AntigravityPorts } from '../src/antigravity-wiring.js';
import { removeAfterTest, signIn, startTestServer, tempDataDir, waitFor, type SignedIn, type TestServer } from './helpers.js';

const FAKE_ANTIGRAVITY = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-antigravity.mjs');
const KEY = `AIza${'S'.repeat(31)}4321`;
const PINNED = ANTIGRAVITY_PINS.archives[`${process.platform}-${process.arch}` as keyof typeof ANTIGRAVITY_PINS.archives];

// Servers (started through `startTestServer`) close, and folders go, in the shared afterEach (helpers.ts).
const temp = (prefix: string) => removeAfterTest(mkdtempSync(join(tmpdir(), prefix)));

/** Antigravity's own ports on a folder of their own, the pinned server planted there unless `installed: false`. */
function antigravity(options: { installed?: boolean } = {}): AntigravityPorts {
  const dataDir = temp('ogden-agents-agy-');
  if (options.installed !== false && PINNED !== undefined) {
    const folder = join(dataDir, 'agents', 'antigravity', ANTIGRAVITY_PINS.version);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, PINNED.binary), '');
  }
  return {
    agent: createAntigravityAgent({ dataDir, server: () => ({ command: process.execPath, args: [FAKE_ANTIGRAVITY, '--uid='] }) }),
    setup: createAntigravitySetup({ dataDir }),
  };
}

function request(server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) {
  return fetch(`${server.url}${path}`, {
    method,
    headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function setUp(options: { installed?: boolean; key?: boolean; dataDir?: string; repo?: string; ports?: AntigravityPorts } = {}) {
  const ports = options.ports ?? antigravity(options);
  const server = await startTestServer({
    antigravity: ports,
    ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
    // A key in the server's own environment follows core's precedence rule, as a saved one does.
    extraAgentEnv: options.key === false ? {} : { GEMINI_API_KEY: KEY },
  });
  const tab = await signIn(server);
  const repo = options.repo ?? temp('ogden-agents-repo-');
  const wsId = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json()).workspace.id;
  const newChat = (agentId: string) => request(server, tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId }), { agentId });
  const chatWith = async (agentId: string) => SessionResponse.parse(await (await newChat(agentId)).json()).session;
  return { server, tab, wsId, repo, ports, newChat, chatWith };
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

describe.skipIf(PINNED === undefined)('Antigravity beside Claude Code (epic 6 entry 5)', () => {
  it('is listed after Claude Code with its provider, sign-in methods, Ask and Skip all, and no terminal', async () => {
    const { server, tab } = await setUp();
    const { agents } = ChatAgentsResponse.parse(await (await request(server, tab, 'GET', API_ROUTES.chatAgents)).json());
    expect(agents.map((agent) => agent.agentId)).toEqual(['claude-code', 'antigravity']);
    expect(agents[1]).toMatchObject({
      agentId: 'antigravity',
      displayName: 'Antigravity',
      provider: 'Google',
      signInMethods: [
        { kind: 'subscription', label: 'Sign in with Google' },
        { kind: 'api_key', label: 'Use a Gemini API key' },
      ],
      apiKeyFormat: 'Starts with AIza',
      install: 'installed',
      terminalResume: false,
      permissionModes: ['ask', 'skip_all'],
    });
  });

  it('refuses a new chat while not installed, or signed out without a key (6.3 refusals)', async () => {
    const missing = await setUp({ installed: false });
    const refused = await missing.newChat('antigravity');
    expect(refused.status).toBe(409);
    expect(ApiErrorBody.parse(await refused.json()).error).toMatchObject({ code: 'agent_not_installed', details: { agentId: 'antigravity', action: 'install' } });
    const keyless = await setUp({ key: false });
    const signedOut = await keyless.newChat('antigravity');
    expect(signedOut.status).toBe(409);
    expect(ApiErrorBody.parse(await signedOut.json()).error).toMatchObject({ code: 'agent_signed_out', details: { agentId: 'antigravity', action: 'sign_in' } });
  });

  it('chats beside Claude Code: its own home and key, and Claude Code never sees the key', async () => {
    const { server, tab, wsId, chatWith } = await setUp();
    const agy = await chatWith('antigravity');
    const claude = await chatWith('claude-code');
    expect(await say(server, tab, wsId, agy.id, 'whoami')).toBe(`agent=antigravity home=${join(server.dataDir, 'agents', 'antigravity-home')}`);
    expect(await say(server, tab, wsId, agy.id, 'auth')).toBe('auth=gemini-api-key key=4321');
    expect(existsSync(join(server.dataDir, 'agents', 'antigravity-home'))).toBe(true);
    const claudeEnv = await say(server, tab, wsId, claude.id, 'echo-env');
    expect(claudeEnv).not.toContain('GEMINI_API_KEY');
    expect(claudeEnv).not.toContain(KEY);
    expect(claudeEnv).not.toContain('GEMINI_HOME');
  });

  it('holds a shell command for its card; Always allow is kept by core and the agent only ever gets its once option', async () => {
    const { server, tab, wsId, chatWith } = await setUp();
    const session = await chatWith('antigravity');
    await send(server, tab, wsId, session.id, 'permission npm test');
    await waitFor(() => stateOf(server, session.id) === 'waiting', 'the card', 15_000);
    const requested = server.core.events.readAfter(0).find((event) => event.streamId === session.id && event.type === 'permission.requested');
    expect(requested?.type === 'permission.requested' && requested.payload.toolCall).toMatchObject({ kind: 'execute', command: 'npm test' });
    const requestId = requested?.type === 'permission.requested' ? requested.payload.requestId : '';
    expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionPermission, { wsId, sesId: session.id, requestId }), { decision: 'allow_always' })).status).toBe(204);
    await waitFor(() => stateOf(server, session.id) === 'idle', 'the reply', 15_000);
    expect(replies(server, session.id).at(-1)).toBe('Ran npm test. chose=allow');
    // The rule answers the next one without a card, and the agent still gets `allow`.
    expect(await say(server, tab, wsId, session.id, 'permission npm test')).toBe('Ran npm test. chose=allow');
  });

  it('refuses Auto, and Skip all runs a command without a card once Developer mode is on', async () => {
    const { server, tab, wsId, chatWith } = await setUp();
    const session = await chatWith('antigravity');
    const ids = { wsId, sesId: session.id };
    const auto = await request(server, tab, 'PUT', apiPath(API_ROUTES.sessionPermissionMode, ids), { mode: 'auto' });
    expect(auto.status).toBe(409);
    expect(ApiErrorBody.parse(await auto.json()).error.code).toBe('mode_unavailable');
    expect((await request(server, tab, 'PUT', API_ROUTES.developerMode, { developerMode: true })).status).toBe(200);
    expect((await request(server, tab, 'PUT', apiPath(API_ROUTES.sessionPermissionMode, ids), { mode: 'skip_all', confirm: true })).status).toBe(200);
    expect(await say(server, tab, wsId, session.id, 'mode')).toBe('mode=yolo');
    expect(await say(server, tab, wsId, session.id, 'permission rm -rf build')).toBe('Ran rm -rf build.');
  });

  it('drops the chat to Ask when Antigravity switches itself to a mode that asks less', async () => {
    const { server, tab, wsId, chatWith } = await setUp();
    const session = await chatWith('antigravity');
    await say(server, tab, wsId, session.id, 'mode-switch auto_edit');
    await waitFor(() => server.core.entities.getSession(session.id)!.permissionMode === 'ask', 'Ask');
    expect(await say(server, tab, wsId, session.id, 'mode')).toBe('mode=default');
  });

  it('reports its terminal toggle as agent_unsupported', async () => {
    const { server, tab, wsId, chatWith } = await setUp();
    const session = await chatWith('antigravity');
    await say(server, tab, wsId, session.id, 'hello');
    const read = SessionResponse.parse(await (await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceSession, { wsId, sesId: session.id }))).json());
    expect(read.terminal).toMatchObject({ available: false, code: 'agent_unsupported' });
  });

  it('continues a chat after a server restart, by resuming its session', async () => {
    const dataDir = tempDataDir();
    const ports = antigravity();
    const first = await setUp({ dataDir, ports });
    const session = await first.chatWith('antigravity');
    expect(await say(first.server, first.tab, first.wsId, session.id, 'context')).toMatch(/via=new/);
    await first.server.close();
    const second = await setUp({ dataDir, ports, repo: first.repo });
    expect(second.wsId).toBe(first.wsId);
    expect(await say(second.server, second.tab, second.wsId, session.id, 'context')).toMatch(/via=resumed/);
  });
});

describe('the shipped wiring (epic 6 entry 5)', () => {
  it('registers Antigravity by default, not installed, with its home folder in the data folder', async () => {
    const server = await startTestServer({ antigravity: undefined });
      const tab = await signIn(server);
    const { agents } = ChatAgentsResponse.parse(await (await request(server, tab, 'GET', API_ROUTES.chatAgents)).json());
    expect(agents.find((agent) => agent.agentId === 'antigravity')).toMatchObject({ install: 'not_installed', permissionModes: ['ask', 'skip_all'] });
    expect(existsSync(join(server.dataDir, 'agents', 'antigravity-home'))).toBe(true);
  });
});
