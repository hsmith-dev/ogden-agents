/**
 * Epic 12 entry 5 end to end: a real server with Claude Code (the fake ACP
 * agent) and Codex in its wiring slot, its adapter played by the fake agent's
 * Codex personality (`tests/fixtures/fake-codex.mjs`). Codex is API key only
 * (user decision, 2026-10-05): its key comes from the server's environment
 * here and reaches only Codex's process. No test runs the real adapter or
 * Codex, reads `~/.codex` or reaches OpenAI.
 */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCodexAgent, createMemoryAgentSetup } from '@ogden-agents/adapters';
import type { AgentSetupPort } from '@ogden-agents/core';
import { API_ROUTES, ApiErrorBody, apiPath, ChatAgentsResponse, SessionResponse, WorkspaceResponse, type SessionId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import type { CodexPorts } from '../src/codex-wiring.js';
import { removeAfterTest, signIn, startTestServer, tempDataDir, waitFor, type SignedIn, type TestServer } from './helpers.js';

const FAKE_CODEX = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-codex.mjs');
const KEY = `sk-proj-${'S'.repeat(40)}4321`;

const temp = (prefix: string) => removeAfterTest(mkdtempSync(join(tmpdir(), prefix)));

/** Codex's ports: the chat port on the fake, and a setup that is installed and signed out, so its key (the server's environment) is used. */
function codex(): CodexPorts {
  const base = createMemoryAgentSetup({ agentId: 'codex', displayName: 'Codex', installed: true, auth: 'needs_sign_in' });
  const setup: AgentSetupPort = {
    ...base,
    status: async () => ({ ...(await base.status()), subscription: 'signed_out' }),
    apiKey: { envName: 'CODEX_API_KEY', check: () => undefined, verify: async () => 'ok' },
  };
  return { agent: createCodexAgent({ dataDir: temp('ogden-agents-codex-'), server: () => ({ command: process.execPath, args: [FAKE_CODEX] }) }), setup };
}

function request(server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) {
  return fetch(`${server.url}${path}`, {
    method,
    headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function setUp(options: { key?: boolean; dataDir?: string; repo?: string; ports?: CodexPorts } = {}) {
  const ports = options.ports ?? codex();
  const server = await startTestServer({
    codex: ports,
    ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
    extraAgentEnv: options.key === false ? {} : { CODEX_API_KEY: KEY },
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

/** Waits for a card, answers it with `decision`, and returns the reply once the chat is idle again. */
async function answerCard(server: TestServer, tab: SignedIn, wsId: string, sesId: SessionId, text: string, decision: string): Promise<string> {
  const before = server.core.events.readAfter(0).filter((event) => event.streamId === sesId && event.type === 'permission.requested').length;
  await send(server, tab, wsId, sesId, text);
  await waitFor(() => stateOf(server, sesId) === 'waiting', `the card for ${text}`, 15_000);
  const requested = server.core.events.readAfter(0).flatMap((event) => (event.streamId === sesId && event.type === 'permission.requested' ? [event.payload] : []));
  expect(requested).toHaveLength(before + 1);
  const requestId = requested.at(-1)!.requestId;
  expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionPermission, { wsId, sesId, requestId }), { decision })).status).toBe(204);
  await waitFor(() => stateOf(server, sesId) === 'idle', 'the reply', 15_000);
  return replies(server, sesId).at(-1)!;
}

describe('Codex beside Claude Code (epic 12 entry 5)', () => {
  it('is listed after Claude Code with its provider, one API key method, Ask and Skip all, and no terminal', async () => {
    const { server, tab } = await setUp();
    const { agents } = ChatAgentsResponse.parse(await (await request(server, tab, 'GET', API_ROUTES.chatAgents)).json());
    expect(agents.map((agent) => agent.agentId)).toEqual(['claude-code', 'codex']);
    expect(agents[1]).toMatchObject({
      displayName: 'Codex',
      provider: 'OpenAI',
      signInMethods: [{ kind: 'api_key', label: 'Use an OpenAI API key' }],
      install: 'installed',
      terminalResume: false,
      permissionModes: ['ask', 'skip_all'],
    });
  });

  it('refuses a new chat without a key, in words about the key and never a sign-in', async () => {
    const { newChat } = await setUp({ key: false });
    const refused = await newChat('codex');
    expect(refused.status).toBe(409);
    expect(ApiErrorBody.parse(await refused.json()).error).toMatchObject({
      code: 'agent_signed_out',
      message: 'Codex needs an API key. Add one in Settings → Agents.',
      details: { agentId: 'codex', action: 'sign_in' },
    });
  });

  it('chats beside Claude Code: its own home and key, config written, no auth.json, and Claude Code never sees the key', async () => {
    const { server, tab, wsId, chatWith } = await setUp();
    const codexChat = await chatWith('codex');
    const claude = await chatWith('claude-code');
    const home = join(server.dataDir, 'agents', 'codex-home');
    expect(await say(server, tab, wsId, codexChat.id, 'whoami')).toBe(`agent=codex home=${home}`);
    expect(await say(server, tab, wsId, codexChat.id, 'auth')).toBe('auth=api-key key=4321');
    expect(readFileSync(join(home, 'config.toml'), 'utf8')).toContain('plugins = false');
    expect(existsSync(join(home, 'auth.json'))).toBe(false);
    const claudeEnv = await say(server, tab, wsId, claude.id, 'echo-env');
    expect(claudeEnv).not.toContain('CODEX_API_KEY');
    expect(claudeEnv).not.toContain(KEY);
    expect(claudeEnv).not.toContain('CODEX_HOME');
  });

  it('holds a shell command for its card; Deny picks decline; Always allow is kept by core and Codex only ever gets its once option', async () => {
    const { server, tab, wsId, chatWith } = await setUp();
    const session = await chatWith('codex');
    expect(await answerCard(server, tab, wsId, session.id, 'permission rm -rf build', 'deny')).toBe('Denied rm -rf build. chose=decline');
    expect(await answerCard(server, tab, wsId, session.id, 'permission npm test', 'allow_always')).toBe('Ran npm test. chose=allow_once');
    // The rule answers the next one without a card, and Codex still gets `allow_once`.
    expect(await say(server, tab, wsId, session.id, 'permission npm test')).toBe('Ran npm test. chose=allow_once');
  });

  it("keeps the protected paths behind a card in Ask, Codex's own .codex included", { timeout: 60_000 }, async () => {
    const { server, tab, wsId, chatWith } = await setUp();
    expect((await request(server, tab, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { cautionLevel: 'ask_risky_only' })).status).toBe(200);
    const session = await chatWith('codex');
    expect(await say(server, tab, wsId, session.id, 'permission-edit src/a.ts')).toBe('Edited src/a.ts.');
    // `permission-edit` asks only in modes that ask: Codex starts in `read-only`, so every edit asks; the card is what Ogden's rules answer or hold.
    for (const path of ['.codex/config.toml', '.agents/skills/x/SKILL.md', '.claude/settings.json']) {
      expect(await answerCard(server, tab, wsId, session.id, `permission-edit ${path}`, 'deny')).toBe(`Denied ${path}.`);
    }
  });

  it('refuses Auto, and Skip all runs a command without a card once Developer mode is on', async () => {
    const { server, tab, wsId, chatWith } = await setUp();
    const session = await chatWith('codex');
    const ids = { wsId, sesId: session.id };
    const auto = await request(server, tab, 'PUT', apiPath(API_ROUTES.sessionPermissionMode, ids), { mode: 'auto' });
    expect(auto.status).toBe(409);
    expect(ApiErrorBody.parse(await auto.json()).error.code).toBe('mode_unavailable');
    expect((await request(server, tab, 'PUT', API_ROUTES.developerMode, { developerMode: true })).status).toBe(200);
    expect((await request(server, tab, 'PUT', apiPath(API_ROUTES.sessionPermissionMode, ids), { mode: 'skip_all', confirm: true })).status).toBe(200);
    expect(await say(server, tab, wsId, session.id, 'mode')).toBe('mode=agent-full-access');
    expect(await say(server, tab, wsId, session.id, 'permission rm -rf build')).toBe('Ran rm -rf build.');
  });

  it('drops the chat to Ask when Codex switches itself to a mode that asks less', async () => {
    const { server, tab, wsId, chatWith } = await setUp();
    const session = await chatWith('codex');
    await say(server, tab, wsId, session.id, 'mode-switch workspace-write');
    await waitFor(() => server.core.entities.getSession(session.id)!.permissionMode === 'ask', 'Ask');
    expect(await say(server, tab, wsId, session.id, 'mode')).toBe('mode=read-only');
  });

  it('reports its terminal toggle as agent_unsupported', async () => {
    const { server, tab, wsId, chatWith } = await setUp();
    const session = await chatWith('codex');
    await say(server, tab, wsId, session.id, 'hello');
    const read = SessionResponse.parse(await (await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceSession, { wsId, sesId: session.id }))).json());
    expect(read.terminal).toMatchObject({ available: false, code: 'agent_unsupported' });
  });

  it('continues a chat after a server restart, by resuming its session', async () => {
    const dataDir = tempDataDir();
    const ports = codex();
    const first = await setUp({ dataDir, ports });
    const session = await first.chatWith('codex');
    expect(await say(first.server, first.tab, first.wsId, session.id, 'context')).toMatch(/via=new/);
    await first.server.close();
    const second = await setUp({ dataDir, ports, repo: first.repo });
    expect(second.wsId).toBe(first.wsId);
    expect(await say(second.server, second.tab, second.wsId, session.id, 'context')).toMatch(/via=resumed/);
  });

  it('says a rejected key in plain words, about the key', async () => {
    const { server, tab, wsId, chatWith } = await setUp();
    const session = await chatWith('codex');
    await send(server, tab, wsId, session.id, 'auth-expired');
    await waitFor(() => stateOf(server, session.id) === 'error', 'the error', 15_000);
    const failed = server.core.events.readAfter(0).filter((event) => event.streamId === session.id && JSON.stringify(event.payload).includes('Codex needs a valid API key'));
    expect(failed.length).toBeGreaterThan(0);
    expect(JSON.stringify(failed[0]!.payload)).toContain('auth_required');
  });
});
