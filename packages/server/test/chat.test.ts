/**
 * The chat routes end to end (story 2.2): a real server, the real
 * `acp-claude-code` adapter, and the fake ACP agent over stdio in place of
 * Claude Code. Every row of the story's I/O matrix the server decides: a
 * streamed reply with working then idle, the gate on every new route, a
 * missing agent, and an agent crashing mid-prompt.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { openCore, RESTARTED_REASON } from '@ogden-agents/core';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  API_ROUTES,
  ApiErrorBody,
  apiPath,
  SendMessageResponse,
  SessionResponse,
  WorkspaceResponse,
  type CoreEvent,
  type SessionId,
} from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { agentEnvironment, type StartOptions } from '../src/start.js';
import { signIn, startTestServer, tempDataDir, waitFor, type SignedIn, type TestServer } from './helpers.js';

const FAKE_AGENT = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-acp-agent.mjs');

const repos: string[] = [];
afterEach(() => {
  for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** A folder standing in for a repo. */
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-agents-repo-'));
  repos.push(dir);
  return dir;
}

async function startChatServer(options: StartOptions & { lines?: string[] } = {}) {
  const server = await startTestServer({ claudeAdapterPath: FAKE_AGENT, ...options });
  return { server, tab: await signIn(server) };
}

function post(server: TestServer, tab: SignedIn, path: string, body: unknown) {
  return fetch(`${server.url}${path}`, {
    method: 'POST',
    headers: { ...tab.headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Opens a workspace on a fresh folder and a chat session in it, through the API. */
async function openChat(server: TestServer, tab: SignedIn) {
  const created = await post(server, tab, API_ROUTES.workspaces, { path: repo() });
  expect(created.status).toBe(201);
  const { workspace } = WorkspaceResponse.parse(await created.json());
  const opened = await post(server, tab, apiPath(API_ROUTES.workspaceSessions, { wsId: workspace.id }), {});
  expect(opened.status).toBe(201);
  const { session } = SessionResponse.parse(await opened.json());
  expect(session).toMatchObject({ workspaceId: workspace.id, kind: 'chat', state: 'idle' });
  return { workspace, session };
}

const send = (server: TestServer, tab: SignedIn, wsId: string, sesId: string, text: string) =>
  post(server, tab, apiPath(API_ROUTES.sessionMessages, { wsId, sesId }), { text });

/** Whether a process with this pid exists. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const stateOf = (server: TestServer, sessionId: SessionId) => server.core.entities.getSession(sessionId)!.state;

describe('chat through the fake ACP agent', () => {
  it('streams the reply into the event log while the session goes working, then idle', async () => {
    const { server, tab } = await startChatServer();
    const live: CoreEvent[] = [];
    server.core.events.subscribe(server.core.events.lastSeq(), (event) => live.push(event));
    const { workspace, session } = await openChat(server, tab);

    const response = await send(server, tab, workspace.id, session.id, 'Say hello in five words');
    expect(response.status).toBe(202);
    const { messageId } = SendMessageResponse.parse(await response.json());
    await waitFor(() => stateOf(server, session.id) === 'idle' && live.some((e) => e.type === 'session.state_changed' && e.payload.state === 'idle'), 'idle', 15_000);

    const mine = live.filter((event) => event.streamId === session.id);
    expect(mine.every((event) => event.workspaceId === workspace.id)).toBe(true);
    const user = mine.find((e) => e.type === 'session.message_completed' && e.payload.role === 'user');
    expect(user).toMatchObject({ payload: { messageId, content: 'Say hello in five words' } });
    const deltas = mine.filter((e) => e.type === 'session.message_delta').map((e) => e.payload.text);
    expect(deltas).toEqual(['Hello', ' from the', ' fake agent.']);
    const reply = mine.find((e) => e.type === 'session.message_completed' && e.payload.role === 'agent');
    expect(reply).toMatchObject({ payload: { content: 'Hello from the fake agent.' } });
    const states = mine.filter((e) => e.type === 'session.state_changed').map((e) => e.payload.state);
    expect(states).toEqual(['working', 'idle']);

    // The session reads back through its own workspace only.
    const read = await fetch(`${server.url}${apiPath(API_ROUTES.workspaceSession, { wsId: workspace.id, sesId: session.id })}`, { headers: tab.headers });
    expect(SessionResponse.parse(await read.json()).session.state).toBe('idle');
  });

  it('refuses every new route without the tab token (401), and the POSTs without a matching Origin (403)', async () => {
    const { server, tab } = await startChatServer();
    const { workspace, session } = await openChat(server, tab);
    const routes: Array<[string, string]> = [
      ['POST', API_ROUTES.workspaces],
      ['POST', apiPath(API_ROUTES.workspaceSessions, { wsId: workspace.id })],
      ['GET', apiPath(API_ROUTES.workspaceSession, { wsId: workspace.id, sesId: session.id })],
      ['POST', apiPath(API_ROUTES.sessionMessages, { wsId: workspace.id, sesId: session.id })],
    ];
    for (const [method, path] of routes) {
      const response = await fetch(`${server.url}${path}`, {
        method,
        headers: { origin: tab.origin, 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: JSON.stringify({ path: repo(), text: 'hi' }) } : {}),
      });
      expect(response.status, `${method} ${path}`).toBe(401);
      expect(ApiErrorBody.parse(await response.json()).error.code).toBe('unauthorized');
    }
    for (const [method, path] of routes.filter(([method]) => method === 'POST')) {
      const response = await fetch(`${server.url}${path}`, {
        method,
        headers: { authorization: tab.headers.authorization!, 'content-type': 'application/json' },
        body: JSON.stringify({ path: repo(), text: 'hi' }),
      });
      expect(response.status, `${method} ${path}`).toBe(403);
    }
    // Nothing was sent to the agent.
    expect(stateOf(server, session.id)).toBe('idle');
  });

  it('answers another workspace’s session, a bad folder and an empty message in plain words', async () => {
    const { server, tab } = await startChatServer();
    const first = await openChat(server, tab);
    const second = await openChat(server, tab);
    const crossed = await send(server, tab, second.workspace.id, first.session.id, 'hello');
    expect(crossed.status).toBe(404);
    expect(ApiErrorBody.parse(await crossed.json()).error.code).toBe('not_found');

    const missing = await post(server, tab, API_ROUTES.workspaces, { path: join(repo(), 'nope') });
    expect(missing.status).toBe(400);
    expect(ApiErrorBody.parse(await missing.json()).error).toMatchObject({ code: 'invalid_request', message: 'There is no folder at that path on this computer.' });

    const empty = await send(server, tab, first.workspace.id, first.session.id, '   ');
    expect(empty.status).toBe(400);
    expect(ApiErrorBody.parse(await empty.json()).error.message).toBe('Write a message first.');
  });

  it('refuses a second message while the agent answers (409)', async () => {
    const { server, tab } = await startChatServer();
    const { workspace, session } = await openChat(server, tab);
    expect((await send(server, tab, workspace.id, session.id, 'slow')).status).toBe(202);
    const busy = await send(server, tab, workspace.id, session.id, 'hello');
    expect(busy.status).toBe(409);
    expect(ApiErrorBody.parse(await busy.json()).error.code).toBe('session_busy');
  });

  it('an agent that can’t be spawned sends the session to error with a plain message; the server stays up', async () => {
    const lines: string[] = [];
    const { server, tab } = await startChatServer({ claudeAdapterPath: join(tmpdir(), 'no-such-adapter', 'index.js'), lines });
    const { workspace, session } = await openChat(server, tab);
    expect((await send(server, tab, workspace.id, session.id, 'hello')).status).toBe(202);
    await waitFor(() => stateOf(server, session.id) === 'error', 'error', 10_000);
    const last = server.core.events.readAfter(0).filter((e) => e.streamId === session.id).at(-1);
    expect(last).toMatchObject({
      type: 'session.state_changed',
      payload: { state: 'error', reason: "Claude Code isn't set up for Ogden Agents on this computer yet." },
    });
    // Still serving.
    expect((await fetch(`${server.url}${API_ROUTES.tabCheck}`, { headers: tab.headers })).status).toBe(204);
    expect(lines.some((line) => line.includes('"agent failed"') && line.includes('agent_unavailable'))).toBe(true);
  });

  it('an agent that crashes mid-prompt sends the session to error; nothing hangs, and the next message restarts it', async () => {
    const { server, tab } = await startChatServer();
    const { workspace, session } = await openChat(server, tab);
    expect((await send(server, tab, workspace.id, session.id, 'crash')).status).toBe(202);
    await waitFor(() => stateOf(server, session.id) === 'error', 'error', 10_000);
    const reply = server.core.events
      .readAfter(0)
      .filter((e) => e.streamId === session.id && e.type === 'session.message_completed' && e.payload.role === 'agent');
    expect(reply.map((e) => (e as { payload: { content: string } }).payload.content)).toEqual(['About to ']);

    expect((await send(server, tab, workspace.id, session.id, 'hello')).status).toBe(202);
    await waitFor(() => stateOf(server, session.id) === 'idle', 'idle after restart', 10_000);
  });

  it('gives the agent only the allowlisted environment, and neither logs nor events hold a secret it echoes (AD-16)', async () => {
    const lines: string[] = [];
    const secret = 'sk-ant-api03-this-is-not-a-real-key';
    const saved = { key: process.env.ANTHROPIC_API_KEY, other: process.env.OGDEN_TEST_UNLISTED_SECRET_TOKEN };
    process.env.ANTHROPIC_API_KEY = secret;
    process.env.OGDEN_TEST_UNLISTED_SECRET_TOKEN = 'unlisted-server-secret';
    try {
      const { server, tab } = await startChatServer({ lines });
      const { workspace, session } = await openChat(server, tab);
      await send(server, tab, workspace.id, session.id, 'echo-env');
      await waitFor(() => stateOf(server, session.id) === 'idle', 'idle', 10_000);
      const events = JSON.stringify(server.core.events.readAfter(0));
      const reply = server.core.events
        .readAfter(0)
        .flatMap((e) => (e.type === 'session.message_completed' && e.payload.role === 'agent' ? [e.payload.content] : []))
        .join('');
      // The key reached the agent (masked in what it printed); nothing outside the allowlist did.
      expect(reply).toContain('ANTHROPIC_API_KEY=[redacted]');
      expect(reply).toContain('PATH=');
      expect(reply).not.toContain('OGDEN_TEST_UNLISTED_SECRET_TOKEN');
      expect(reply).not.toContain('VITEST');
      await server.close();
      const log = lines.join('');
      for (const text of [events, log]) {
        expect(text).not.toContain(secret);
        expect(text).not.toContain('unlisted-server-secret');
      }
      // The agent's stderr (which echoed the environment) is counted, not logged.
      expect(log).toContain('the agent wrote to stderr');
      expect(log).not.toContain('ANTHROPIC_API_KEY');
      expect(log).not.toContain('Say hello');
    } finally {
      if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = saved.key;
      delete process.env.OGDEN_TEST_UNLISTED_SECRET_TOKEN;
    }
  });

  it('the agent environment is an allowlist plus the user’s agent keys', () => {
    const env = agentEnvironment(
      { PATH: '/bin', HOME: '/h', LANG: 'en', LC_CTYPE: 'UTF-8', TERM: 'x', SHELL: '/bin/zsh', TMPDIR: '/t', ANTHROPIC_API_KEY: 'k', AWS_SECRET_ACCESS_KEY: 's', NODE_OPTIONS: '--inspect', CLAUDECODE: '1' },
      'darwin',
    );
    expect(Object.keys(env).sort()).toEqual(['ANTHROPIC_API_KEY', 'HOME', 'LANG', 'LC_CTYPE', 'PATH', 'SHELL', 'TERM', 'TMPDIR']);
    const windows = agentEnvironment({ Path: 'C:\\bin', SYSTEMROOT: 'C:\\Windows', ComSpec: 'cmd', PATHEXT: '.EXE', USERPROFILE: 'C:\\u', APPDATA: 'x' }, 'win32');
    expect(Object.keys(windows).sort()).toEqual(['ComSpec', 'PATHEXT', 'Path', 'SYSTEMROOT', 'USERPROFILE']);
  });

  it('a failed prompt keeps the agent: error with a plain reason, and the next message works on the same agent session', async () => {
    const { server, tab } = await startChatServer();
    const { workspace, session } = await openChat(server, tab);
    await send(server, tab, workspace.id, session.id, 'fail');
    await waitFor(() => stateOf(server, session.id) === 'error', 'error', 10_000);
    expect(server.core.events.readAfter(0).filter((e) => e.streamId === session.id).at(-1)).toMatchObject({
      payload: { state: 'error', reason: 'Claude Code stopped with an error. Try again.' },
    });
    expect((await send(server, tab, workspace.id, session.id, 'pids')).status).toBe(202);
    await waitFor(() => stateOf(server, session.id) === 'idle', 'idle', 10_000);
    const replies = server.core.events
      .readAfter(0)
      .flatMap((e) => (e.streamId === session.id && e.type === 'session.message_completed' && e.payload.role === 'agent' ? [e.payload.content] : []));
    expect(replies.at(-1)).toMatch(/^pid=\d+/);
  });

  it('refuses a relative path, and the data folder, anything in it, or any folder above it', async () => {
    const { server, tab } = await startChatServer();
    for (const path of ['.', 'repo', server.dataDir, join(server.dataDir, 'logs'), join(server.dataDir, '..')]) {
      const response = await post(server, tab, API_ROUTES.workspaces, { path });
      expect(response.status, path).toBe(400);
      expect(ApiErrorBody.parse(await response.json()).error.code).toBe('invalid_request');
    }
    expect(server.core.entities.listWorkspaces()).toEqual([]);
  });

  it('closing the server with a turn in flight leaves the session idle and resumable, and stops the agent’s whole process tree', async () => {
    const dataDir = tempDataDir();
    const core = openCore(dataDir);
    try {
      const { server, tab } = await startChatServer({ dataDir, core, extraAgentEnv: { FAKE_ACP_SPAWN_GRANDCHILD: '1' } });
      const { workspace, session } = await openChat(server, tab);
      await send(server, tab, workspace.id, session.id, 'pids');
      await waitFor(() => stateOf(server, session.id) === 'idle', 'idle', 10_000);
      const reply = core.events
        .readAfter(0)
        .flatMap((e) => (e.type === 'session.message_completed' && e.payload.role === 'agent' ? [e.payload.content] : []))
        .join('');
      const [, pid, grandchild] = /pid=(\d+) grandchild=(\d+)/.exec(reply) ?? [];
      expect(alive(Number(pid)) && alive(Number(grandchild))).toBe(true);

      await send(server, tab, workspace.id, session.id, 'slow');
      await waitFor(() => stateOf(server, session.id) === 'working', 'working', 10_000);
      await server.close();

      expect(core.entities.getSession(session.id)!.state).toBe('idle');
      expect(core.events.readAfter(0).filter((e) => e.streamId === session.id).at(-1)).toMatchObject({
        type: 'session.state_changed',
        payload: { state: 'idle', previous: 'working', reason: RESTARTED_REASON, resumable: true },
      });
      await waitFor(() => !alive(Number(pid)) && !alive(Number(grandchild)), 'the agent and its child to exit', 10_000);
    } finally {
      core.close();
    }
  });

  it('a session a crashed server left working is idle and resumable after the next start (AD-3)', async () => {
    const dataDir = tempDataDir();
    const first = await startChatServer({ dataDir });
    const { session } = await openChat(first.server, first.tab);
    // As if the server died mid-turn: the row says working, and no agent is running.
    first.server.core.entities.setSessionState(session.id, 'working');
    await first.server.close();

    const second = await startChatServer({ dataDir });
    expect(stateOf(second.server, session.id)).toBe('idle');
    expect(second.server.core.events.readAfter(0).filter((e) => e.streamId === session.id).at(-1)).toMatchObject({
      payload: { state: 'idle', previous: 'working', reason: RESTARTED_REASON, resumable: true },
    });
  });
});
