/**
 * Epic 14 story 14.2 end to end: a real server with Claude Code (the fake ACP
 * agent) and the Local model in its wiring slot, played by the fake agent's
 * OpenCode personality (`tests/fixtures/fake-opencode.mjs`), which talks to the
 * fake OpenAI-compatible server on loopback. A Local model chat is made through
 * the real server API, the reply streams into the session, Ogden probes the
 * endpoint itself before the chat starts, and the harness's only connection is
 * to the fake server. No test runs the real harness, a real model or the real network.
 */
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalAgent, createMemoryAgentSetup, localHome } from '@ogden-agents/adapters';
import { API_ROUTES, ApiErrorBody, apiPath, SessionResponse, WorkspaceResponse, type SessionId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { startFakeServer, type FakeServer } from '../../../tests/fixtures/fake-openai-server.mjs';
import type { LocalChatTarget, LocalPorts } from '../src/local-wiring.js';
import { removeAfterTest, signIn, startTestServer, tempDataDir, waitFor, type SignedIn, type TestServer } from './helpers.js';

const FAKE_OPENCODE = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-opencode.mjs');
const KEY = 'sk-ogden-test-dummy-key-77c3e1';

const temp = (prefix: string) => removeAfterTest(mkdtempSync(join(tmpdir(), prefix)));

function request(server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) {
  return fetch(`${server.url}${path}`, {
    method,
    headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const openAiServers: FakeServer[] = [];
async function openAi(options: Parameters<typeof startFakeServer>[0] = {}) {
  const server = await startFakeServer(options);
  openAiServers.push(server);
  return server;
}

async function setUp(options: { target?: () => Promise<LocalChatTarget | undefined>; dataDir?: string; installed?: boolean; repo?: string } = {}) {
  const dataDir = options.dataDir ?? tempDataDir();
  const ports: LocalPorts = {
    agent: createLocalAgent({ dataDir, server: () => ({ command: process.execPath, args: [FAKE_OPENCODE] }) }),
    setup: createMemoryAgentSetup({ agentId: 'local', displayName: 'Local model', installed: options.installed !== false, auth: 'signed_in' }),
    target: options.target,
  };
  const server = await startTestServer({ local: ports, dataDir });
  const tab = await signIn(server);
  const repo = options.repo ?? temp('ogden-agents-repo-');
  const wsId = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json()).workspace.id;
  const newChat = () => request(server, tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId }), { agentId: 'local' });
  const chat = async () => SessionResponse.parse(await (await newChat()).json()).session;
  return { server, tab, wsId, repo, dataDir, newChat, chat };
}

const replies = (server: TestServer, sessionId: SessionId) =>
  server.core.events
    .readAfter(0)
    .filter((event) => event.streamId === sessionId)
    .flatMap((event) => (event.type === 'session.message_completed' && event.payload.role === 'agent' ? [event.payload.content] : []));
const stateOf = (server: TestServer, sessionId: SessionId) => server.core.entities.getSession(sessionId)!.state;

async function say(server: TestServer, tab: SignedIn, wsId: string, sesId: SessionId, text: string): Promise<string> {
  const before = replies(server, sesId).length;
  expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId, sesId }), { text })).status).toBe(202);
  await waitFor(() => stateOf(server, sesId) === 'idle' && replies(server, sesId).length > before, `the reply to ${text}`, 15_000);
  return replies(server, sesId).at(-1)!;
}

const failureOf = (server: TestServer, sessionId: SessionId) =>
  server.core.events.readAfter(0).filter((event) => event.streamId === sessionId && JSON.stringify(event.payload).includes('"reason"')).map((event) => JSON.stringify(event.payload));

describe('a Local model chat (epic 14 story 14.2)', () => {
  it('streams the reply of the fake server into the session, and the harness talks to nothing else', async () => {
    const fake = await openAi();
    const { server, tab, wsId, chat } = await setUp({ target: async () => ({ baseUrl: `${fake.url}/v1` }) });
    const session = await chat();
    expect(await say(server, tab, wsId, session.id, 'hello')).toBe('Hello from the fake model.');
    // Ogden probed the endpoint itself (`/models`), then the harness sent one chat request; nothing else reached the server.
    expect(fake.log.map((entry) => `${entry.method} ${entry.path}`)).toEqual(['GET /v1/models', 'POST /v1/chat/completions']);
    expect(fake.log.every((entry) => entry.host?.startsWith('127.0.0.1:') === true)).toBe(true);
  });

  it('gives the harness the config, the switches and the empty home: the environment it runs in is Ogden\'s own', async () => {
    const fake = await openAi();
    const { server, tab, wsId, chat, dataDir } = await setUp({ target: async () => ({ baseUrl: `${fake.url}/v1` }) });
    const session = await chat();
    const report = JSON.parse(await say(server, tab, wsId, session.id, 'env-report')) as { switches: Record<string, string>; folders: Record<string, string>; key: string };
    expect(Object.values(report.switches).every((value) => value !== null)).toBe(true);
    expect(report.switches.OPENCODE_DISABLE_PROJECT_CONFIG).toBe('1');
    expect(report.folders.HOME).toBe(localHome(dataDir).home);
    expect(report.folders.XDG_DATA_HOME).toBe(localHome(dataDir).xdg.data);
    expect(report.key).toBe('absent');
  });

  it('writes the endpoint, the models the server lists and the model it starts on into the config, which holds no key', async () => {
    const fake = await openAi();
    const { server, tab, wsId, chat } = await setUp({ target: async () => ({ baseUrl: `${fake.url}/v1`, model: 'fake-large', key: undefined }) });
    const session = await chat();
    const config = JSON.parse(await say(server, tab, wsId, session.id, 'config-report')) as { model: string; provider: { ogden: { options: Record<string, unknown>; models: Record<string, unknown> } } };
    expect(config.model).toBe('ogden/fake-large');
    expect(config.provider.ogden.options).toEqual({ baseURL: `${fake.url}/v1` });
    expect(Object.keys(config.provider.ogden.models)).toEqual(['fake-small', 'fake-large', 'fake-nojson', 'fake-noformat']);
  });

  it('passes an endpoint\'s key only in the process environment: the server accepts it and no file holds it', async () => {
    const fake = await openAi({ requireKey: KEY });
    const { server, tab, wsId, chat, dataDir } = await setUp({ target: async () => ({ baseUrl: `${fake.url}/v1`, key: KEY }) });
    const session = await chat();
    expect(await say(server, tab, wsId, session.id, 'hello')).toBe('Hello from the fake model.');
    expect(fake.log.every((entry) => entry.authMatches === true)).toBe(true);
    const configs = JSON.parse(await say(server, tab, wsId, session.id, 'config-report')) as { provider: { ogden: { options: { apiKey: string } } } };
    expect(configs.provider.ogden.options.apiKey).toBe('{env:OGDEN_ENDPOINT_KEY}');
    // Not in the replies, the events, or the data folder's config.
    expect(JSON.stringify(server.core.events.readAfter(0))).not.toContain(KEY);
    const home = localHome(dataDir);
    expect(readFileSync(join(home.configDir, readdirSync(home.configDir).find((name) => name.endsWith('.json'))!), 'utf8')).not.toContain(KEY);
  });

  it('refuses to start, in plain words and without calling the harness, when the endpoint is not running', async () => {
    const fake = await openAi();
    const base = `${fake.url}/v1`;
    await fake.close();
    const { server, tab, wsId, chat } = await setUp({ target: async () => ({ baseUrl: base }) });
    const session = await chat();
    const started = Date.now();
    expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId, sesId: session.id }), { text: 'hello' })).status).toBe(202);
    await waitFor(() => stateOf(server, session.id) === 'error', 'the error state', 15_000);
    // Not the harness's own 63 to 66 seconds of retries.
    expect(Date.now() - started).toBeLessThan(10_000);
    const failure = failureOf(server, session.id).join(' ');
    expect(failure).toContain("isn't answering");
    expect(failure).toContain(new URL(base).host);
  });

  it('says to set up a server when none is set up', async () => {
    const { server, tab, wsId, chat } = await setUp({ target: async () => undefined });
    const session = await chat();
    expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId, sesId: session.id }), { text: 'hello' })).status).toBe(202);
    await waitFor(() => stateOf(server, session.id) === 'error', 'the error state', 15_000);
    expect(failureOf(server, session.id).join(' ')).toContain('Set up a server for the Local model');
  });

  it('refuses, in plain words, a server whose model names the harness could not safely be told', async () => {
    const fake = await openAi({ models: ['{file:/etc/passwd}', '{env:HOME}'] });
    const { server, tab, wsId, chat } = await setUp({ target: async () => ({ baseUrl: `${fake.url}/v1` }) });
    const session = await chat();
    expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId, sesId: session.id }), { text: 'hello' })).status).toBe(202);
    await waitFor(() => stateOf(server, session.id) === 'error', 'the error state', 15_000);
    expect(failureOf(server, session.id).join(' ')).toContain("None of the server's model names can be used");
  });

  it('is refused as not installed until Install has put the harness in the data folder', async () => {
    const fake = await openAi();
    const { newChat } = await setUp({ installed: false, target: async () => ({ baseUrl: `${fake.url}/v1` }) });
    const refused = await newChat();
    expect(refused.status).toBe(409);
    expect(ApiErrorBody.parse(await refused.json()).error).toMatchObject({ code: 'agent_not_installed', details: { agentId: 'local' } });
  });

  it('holds a shell command for its card until it is allowed once, and does not run it after Deny', async () => {
    const fake = await openAi();
    const { server, tab, wsId, chat } = await setUp({ target: async () => ({ baseUrl: `${fake.url}/v1` }) });
    const session = await chat();
    const ids = { wsId, sesId: session.id };
    const decide = async (decision: string) => {
      const before = replies(server, session.id).length;
      expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, ids), { text: 'please run echo hi' })).status).toBe(202);
      await waitFor(() => stateOf(server, session.id) === 'waiting', 'the card', 15_000);
      const requested = server.core.events.readAfter(0).flatMap((event) => (event.streamId === session.id && event.type === 'permission.requested' ? [event.payload] : []));
      expect(requested.at(-1)).toMatchObject({ toolCall: { kind: 'execute', command: 'echo hi' } });
      expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionPermission, { ...ids, requestId: requested.at(-1)!.requestId }), { decision })).status).toBe(204);
      await waitFor(() => stateOf(server, session.id) === 'idle' && replies(server, session.id).length > before, 'the reply', 15_000);
      return replies(server, session.id).at(-1)!;
    };
    expect(await decide('allow_once')).toBe('tool said: ran(once): echo hi');
    expect(await decide('deny')).toContain('The user rejected permission');
  });

  it('refuses Auto and Skip all, even with Developer mode on, and has no terminal toggle yet', async () => {
    const fake = await openAi();
    const { server, tab, wsId, chat } = await setUp({ target: async () => ({ baseUrl: `${fake.url}/v1` }) });
    const session = await chat();
    const ids = { wsId, sesId: session.id };
    expect((await request(server, tab, 'PUT', API_ROUTES.developerMode, { developerMode: true })).status).toBe(200);
    for (const mode of ['auto', 'skip_all']) {
      const refused = await request(server, tab, 'PUT', apiPath(API_ROUTES.sessionPermissionMode, ids), { mode, confirm: true });
      expect(refused.status, mode).toBe(409);
      expect(ApiErrorBody.parse(await refused.json()).error.code).toBe('mode_unavailable');
    }
    await say(server, tab, wsId, session.id, 'hello');
    const read = SessionResponse.parse(await (await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceSession, ids))).json());
    expect(read.terminal).toMatchObject({ available: false, code: 'agent_unsupported' });
  });

  it('continues a chat after a server restart by resuming its session from the data folder', async () => {
    const fake = await openAi();
    const dataDir = tempDataDir();
    const target = async () => ({ baseUrl: `${fake.url}/v1` });
    const first = await setUp({ dataDir, target });
    const session = await first.chat();
    expect(await say(first.server, first.tab, first.wsId, session.id, 'session-start')).toMatch(/^via=new /);
    await first.server.close();
    const second = await setUp({ dataDir, target, repo: first.repo });
    expect(second.wsId).toBe(first.wsId);
    expect(await say(second.server, second.tab, second.wsId, session.id, 'session-start')).toMatch(/^via=resumed /);
  });
});
