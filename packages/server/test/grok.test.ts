/**
 * Epic 12 entry 7 end to end: a real server with Claude Code (the fake ACP
 * agent) and Grok in its wiring slot, played by the fake agent's Grok
 * personality (`tests/fixtures/fake-grok.mjs`). Grok is an xAI API access
 * token only (user decision, 2026-10-05): the token comes from the server's
 * environment here and reaches only Grok's process. A chat starts only in a
 * project the user trusted, its mode is given once at start, and it continues
 * after a restart. No test runs the real Grok, reads `~/.grok` or reaches xAI.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGrokAgent, createMemoryAgentSetup } from '@ogden-agents/adapters';
import type { AgentSetupPort } from '@ogden-agents/core';
import { API_ROUTES, ApiErrorBody, apiPath, ChatAgentsResponse, SessionResponse, WorkspaceResponse, type SessionId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import type { GrokPorts } from '../src/grok-wiring.js';
import { removeAfterTest, signIn, startTestServer, tempDataDir, waitFor, type SignedIn, type TestServer } from './helpers.js';

const FAKE_GROK = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-grok.mjs');
const KEY = `xai-${'S'.repeat(60)}4321`;

const temp = (prefix: string) => removeAfterTest(mkdtempSync(join(tmpdir(), prefix)));

/** Grok's ports: the chat port on the fake, and a setup that is installed and signed out, so its token (the server's environment) is used. */
function grok(): GrokPorts {
  const base = createMemoryAgentSetup({ agentId: 'grok', displayName: 'Grok', installed: true, auth: 'needs_sign_in' });
  const setup: AgentSetupPort = {
    ...base,
    status: async () => ({ ...(await base.status()), subscription: 'signed_out' }),
    apiKey: { envName: 'XAI_API_KEY', check: () => undefined, verify: async () => 'ok' },
  };
  return { agent: createGrokAgent({ dataDir: temp('ogden-agents-grok-'), server: () => ({ command: process.execPath, args: [FAKE_GROK] }) }), setup };
}

function request(server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) {
  return fetch(`${server.url}${path}`, {
    method,
    headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function setUp(options: { key?: boolean; dataDir?: string; repo?: string; ports?: GrokPorts } = {}) {
  const ports = options.ports ?? grok();
  const server = await startTestServer({
    grok: ports,
    ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
    extraAgentEnv: options.key === false ? {} : { XAI_API_KEY: KEY },
  });
  const tab = await signIn(server);
  const repo = options.repo ?? temp('ogden-agents-repo-');
  const wsId = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json()).workspace.id;
  const newChat = (agentId: string) => request(server, tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId }), { agentId });
  const trust = async () => expect((await request(server, tab, 'PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }))).status).toBe(200);
  const chatWith = async (agentId: string) => SessionResponse.parse(await (await newChat(agentId)).json()).session;
  return { server, tab, wsId, repo, ports, newChat, chatWith, trust };
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

async function answerCard(server: TestServer, tab: SignedIn, wsId: string, sesId: SessionId, text: string, decision: string): Promise<string> {
  await send(server, tab, wsId, sesId, text);
  await waitFor(() => stateOf(server, sesId) === 'waiting', `the card for ${text}`, 15_000);
  const requested = server.core.events.readAfter(0).flatMap((event) => (event.streamId === sesId && event.type === 'permission.requested' ? [event.payload] : []));
  const requestId = requested.at(-1)!.requestId;
  expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionPermission, { wsId, sesId, requestId }), { decision })).status).toBe(204);
  await waitFor(() => stateOf(server, sesId) === 'idle', 'the reply', 15_000);
  return replies(server, sesId).at(-1)!;
}

describe('Grok beside Claude Code (epic 12 entry 7)', () => {
  it('is listed after Claude Code with its provider, one API token method, Ask and Skip all, and no terminal', async () => {
    const { server, tab } = await setUp();
    const { agents } = ChatAgentsResponse.parse(await (await request(server, tab, 'GET', API_ROUTES.chatAgents)).json());
    expect(agents.map((agent) => agent.agentId)).toEqual(['claude-code', 'grok']);
    expect(agents[1]).toMatchObject({
      displayName: 'Grok',
      provider: 'xAI',
      signInMethods: [{ kind: 'api_key', label: 'Use an xAI API access token' }],
      install: 'installed',
      terminalResume: false,
      permissionModes: ['ask', 'skip_all'],
      needsProjectTrust: true,
    });
  });

  it('refuses a new chat without a token, in words about the token and never a sign-in', async () => {
    const { newChat, trust } = await setUp({ key: false });
    await trust();
    const refused = await newChat('grok');
    expect(refused.status).toBe(409);
    const error = ApiErrorBody.parse(await refused.json()).error;
    expect(error).toMatchObject({ code: 'agent_signed_out', details: { agentId: 'grok' } });
    expect(error.message).not.toMatch(/sign in with/i);
  });

  it('refuses a chat in a project nobody trusted, with the trust action, and starts once it is trusted', async () => {
    const { server, tab, wsId, newChat, chatWith, trust } = await setUp();
    const refused = await newChat('grok');
    expect(refused.status).toBe(409);
    expect(ApiErrorBody.parse(await refused.json()).error).toMatchObject({ code: 'project_not_trusted', details: { agentId: 'grok', action: 'trust_project' } });
    await trust();
    const session = await chatWith('grok');
    expect(await say(server, tab, wsId, session.id, 'whoami')).toBe(`agent=grok home=${join(server.dataDir, 'agents', 'grok-home')}`);
  });

  it('chats beside Claude Code with its own home and token, and Claude Code never sees the token', async () => {
    const { server, tab, wsId, chatWith, trust } = await setUp();
    await trust();
    const grokChat = await chatWith('grok');
    const claude = await chatWith('claude-code');
    expect(await say(server, tab, wsId, grokChat.id, 'auth')).toBe('auth=xai.api_key key=4321');
    expect(await say(server, tab, wsId, grokChat.id, 'env')).toBe('GROK_FOLDER_TRUST=0 GROK_DISABLE_AUTOUPDATER=1 key=4321');
    const claudeEnv = await say(server, tab, wsId, claude.id, 'echo-env');
    expect(claudeEnv).not.toContain('XAI_API_KEY');
    expect(claudeEnv).not.toContain(KEY);
    expect(claudeEnv).not.toContain('GROK_HOME');
  });

  it('holds a shell command for its card, in Ask, even in a project whose settings say bypassPermissions', async () => {
    const { server, tab, wsId, repo, chatWith, trust } = await setUp();
    mkdirSync(join(repo, '.claude'));
    writeFileSync(join(repo, '.claude', 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'bypassPermissions' } }));
    await trust();
    const session = await chatWith('grok');
    expect(await say(server, tab, wsId, session.id, 'mode')).toBe('mode=ask');
    expect(await answerCard(server, tab, wsId, session.id, 'permission rm -rf build', 'deny')).toBe('Denied rm -rf build. chose=reject_once');
    expect(await answerCard(server, tab, wsId, session.id, 'permission npm test', 'allow_once')).toBe('Ran npm test. chose=allow_once');
  });

  it('refuses Auto, takes Skip all at chat start only under Developer mode, and refuses a change once the chat has started', async () => {
    const { server, tab, wsId, chatWith, trust } = await setUp();
    await trust();
    const session = await chatWith('grok');
    const ids = { wsId, sesId: session.id };
    const auto = await request(server, tab, 'PUT', apiPath(API_ROUTES.sessionPermissionMode, ids), { mode: 'auto' });
    expect(auto.status).toBe(409);
    expect(ApiErrorBody.parse(await auto.json()).error.code).toBe('mode_unavailable');
    expect((await request(server, tab, 'PUT', API_ROUTES.developerMode, { developerMode: true })).status).toBe(200);
    // Not started yet, so the mode can still be chosen.
    expect((await request(server, tab, 'PUT', apiPath(API_ROUTES.sessionPermissionMode, ids), { mode: 'skip_all', confirm: true })).status).toBe(200);
    expect(await say(server, tab, wsId, session.id, 'mode')).toBe('mode=skip_all');
    expect(await say(server, tab, wsId, session.id, 'permission rm -rf build')).toBe('Ran rm -rf build.');
    // Started: Grok cannot change it, and core says so.
    const change = await request(server, tab, 'PUT', apiPath(API_ROUTES.sessionPermissionMode, ids), { mode: 'ask' });
    expect(change.status).toBe(409);
  });

  it('reports its terminal toggle as agent_unsupported', async () => {
    const { server, tab, wsId, chatWith, trust } = await setUp();
    await trust();
    const session = await chatWith('grok');
    await say(server, tab, wsId, session.id, 'hello');
    const read = SessionResponse.parse(await (await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceSession, { wsId, sesId: session.id }))).json());
    expect(read.terminal).toMatchObject({ available: false, code: 'agent_unsupported' });
  });

  it('continues a chat after a server restart, by resuming its session, in the mode it started in', async () => {
    const dataDir = tempDataDir();
    const ports = grok();
    const first = await setUp({ dataDir, ports });
    await first.trust();
    const session = await first.chatWith('grok');
    expect(await say(first.server, first.tab, first.wsId, session.id, 'context')).toMatch(/via=new/);
    await first.server.close();
    const second = await setUp({ dataDir, ports, repo: first.repo });
    expect(second.wsId).toBe(first.wsId);
    expect(await say(second.server, second.tab, second.wsId, session.id, 'context')).toMatch(/via=resumed/);
    expect(await say(second.server, second.tab, second.wsId, session.id, 'mode')).toBe('mode=ask');
  });

  it('says a rejected token in plain words, about the token', async () => {
    const { server, tab, wsId, chatWith, trust } = await setUp();
    await trust();
    const session = await chatWith('grok');
    await send(server, tab, wsId, session.id, 'auth-expired');
    await waitFor(() => stateOf(server, session.id) === 'error', 'the error', 15_000);
    const failed = server.core.events.readAfter(0).filter((event) => event.streamId === session.id && JSON.stringify(event.payload).includes('Grok needs a valid xAI API access token'));
    expect(failed.length).toBeGreaterThan(0);
  });
});
