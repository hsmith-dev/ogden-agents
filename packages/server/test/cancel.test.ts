/**
 * Stop and the quiet agent end to end (story 2.10): a real server, the real
 * `acp-claude-code` adapter and the fake ACP agent. `POST …/cancel` answers
 * 204 and the session ends `idle`, 409 when nothing is running and 404 for
 * an unknown chat; a pending card is declined; queued messages stay unsent;
 * a quiet agent gets a check-in and keeps working; the route is behind the
 * gate (AD-15); and no log line holds a message's text.
 */
import { mkdtempSync, rmSync } from 'node:fs';
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
import { checkInDelayFromEnv, type StartOptions } from '../src/start.js';
import { send as sendRaw, signIn, startTestServer, waitFor, type SignedIn, type TestServer } from './helpers.js';

const FAKE_AGENT = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-acp-agent.mjs');

const repos: string[] = [];
const servers: TestServer[] = [];
// Servers first (closing one stops its agents), then the repo folders (Windows).
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

async function startChatServer(options: StartOptions & { lines?: string[] } = {}) {
  const server = await startTestServer({ claudeAdapterPath: FAKE_AGENT, ...options });
  servers.push(server);
  return { server, tab: await signIn(server) };
}

function post(server: TestServer, tab: SignedIn, path: string, body?: unknown) {
  return fetch(`${server.url}${path}`, {
    method: 'POST',
    headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function openChat(server: TestServer, tab: SignedIn) {
  const repo = mkdtempSync(join(tmpdir(), 'ogden-agents-repo-'));
  repos.push(repo);
  const { workspace } = WorkspaceResponse.parse(await (await post(server, tab, API_ROUTES.workspaces, { path: repo })).json());
  const { session } = SessionResponse.parse(await (await post(server, tab, apiPath(API_ROUTES.workspaceSessions, { wsId: workspace.id }), {})).json());
  return { workspace, session };
}

const message = (server: TestServer, tab: SignedIn, wsId: string, sesId: string, text: string) => post(server, tab, apiPath(API_ROUTES.sessionMessages, { wsId, sesId }), { text });
const stop = (server: TestServer, tab: SignedIn, wsId: string, sesId: string) => post(server, tab, apiPath(API_ROUTES.sessionCancel, { wsId, sesId }));
const sessionEvents = (server: TestServer, sessionId: SessionId): CoreEvent[] => server.core.events.readAfter(0).filter((e) => e.streamId === sessionId);
const stateOf = (server: TestServer, sessionId: SessionId) => server.core.entities.getSession(sessionId)!.state;
const waitForState = (server: TestServer, sessionId: SessionId, state: string) => waitFor(() => stateOf(server, sessionId) === state, state, 15_000);
const replyStarted = (server: TestServer, sessionId: SessionId) =>
  waitFor(() => sessionEvents(server, sessionId).some((e) => e.type === 'session.message_delta' || e.type === 'session.tool_call'), 'the reply', 15_000);

describe('Stop (POST …/cancel)', () => {
  it('stops a running prompt: 204, the agent ends its turn, idle; nothing running is 409; an unknown chat is 404', async () => {
    const lines: string[] = [];
    const { server, tab } = await startChatServer({ lines });
    const { workspace, session } = await openChat(server, tab);

    const idle = await stop(server, tab, workspace.id, session.id);
    expect(idle.status).toBe(409);
    expect(ApiErrorBody.parse(await idle.json()).error.code).toBe('session_not_busy');
    const unknown = await stop(server, tab, workspace.id, 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W3');
    expect(unknown.status).toBe(404);
    expect((await stop(server, tab, workspace.id, 'not-a-session')).status).toBe(404);

    expect((await message(server, tab, workspace.id, session.id, 'slow')).status).toBe(202);
    await replyStarted(server, session.id);
    const stopped = await stop(server, tab, workspace.id, session.id);
    expect(stopped.status).toBe(204);
    await waitForState(server, session.id, 'idle');
    // The fake agent ended its turn on the cancel, well before its own 10 s.
    const last = sessionEvents(server, session.id).at(-1);
    expect(last).toMatchObject({ type: 'session.state_changed', payload: { state: 'idle', previous: 'working' } });
    expect(last?.type === 'session.state_changed' && last.payload.resumable).toBeUndefined();
    expect(lines.some((line) => line.includes('"session stopped"'))).toBe(true);

    // The same agent takes the next message.
    expect((await message(server, tab, workspace.id, session.id, 'hello')).status).toBe(202);
    await waitFor(
      () => sessionEvents(server, session.id).some((e) => e.type === 'session.message_completed' && e.payload.content === 'Hello from the fake agent.'),
      'the next reply',
      15_000,
    );
  });

  it('declines a pending card and drops the queue unsent', async () => {
    const { server, tab } = await startChatServer();
    const { workspace, session } = await openChat(server, tab);
    expect((await message(server, tab, workspace.id, session.id, 'permission')).status).toBe(202);
    await waitForState(server, session.id, 'waiting');
    const queued = SendMessageResponse.parse(await (await message(server, tab, workspace.id, session.id, 'after the card')).json());
    expect(queued.queued).toBe(true);

    expect((await stop(server, tab, workspace.id, session.id)).status).toBe(204);
    await waitForState(server, session.id, 'idle');
    await waitFor(() => sessionEvents(server, session.id).some((e) => e.type === 'permission.resolved'), 'the card resolved', 15_000);
    const resolved = sessionEvents(server, session.id).filter((e) => e.type === 'permission.resolved');
    expect(resolved.map((e) => e.payload)).toEqual([expect.objectContaining({ decision: 'deny', by: 'cancelled' })]);
    // Give the agent's turn time to end: the queued message is never sent.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const users = sessionEvents(server, session.id).filter((e) => e.type === 'session.message_completed' && e.payload.role === 'user');
    expect(users.map((e) => e.type === 'session.message_completed' && e.payload.messageId)).not.toContain(queued.messageId);
    expect(stateOf(server, session.id)).toBe('idle');
  });

  it('is behind the gate: 401 without a tab token, 403 from a foreign Origin', async () => {
    const { server, tab } = await startChatServer();
    const { workspace, session } = await openChat(server, tab);
    const path = apiPath(API_ROUTES.sessionCancel, { wsId: workspace.id, sesId: session.id });
    expect((await sendRaw(server, path, { method: 'POST', headers: { origin: server.url } })).status).toBe(401);
    expect((await sendRaw(server, path, { method: 'POST', headers: { ...tab.headers, origin: 'http://evil.example' } })).status).toBe(403);
  });
});

describe('the quiet agent', () => {
  it('checks in naming the tool call in progress, keeps working with no error, and Stop ends it', async () => {
    const lines: string[] = [];
    const { server, tab } = await startChatServer({ checkInDelayMs: 1_000, lines });
    const { workspace, session } = await openChat(server, tab);
    expect((await message(server, tab, workspace.id, session.id, 'quiet-tool')).status).toBe(202);
    await waitFor(() => sessionEvents(server, session.id).some((e) => e.type === 'session.check_in'), 'the check-in', 15_000);
    const checkIn = sessionEvents(server, session.id).find((e) => e.type === 'session.check_in')!;
    expect(checkIn.payload).toEqual({ sessionId: session.id, waitingOn: 'Run npm run build' });
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(stateOf(server, session.id)).toBe('working');
    expect(sessionEvents(server, session.id).filter((e) => e.type === 'session.check_in')).toHaveLength(1);

    expect((await stop(server, tab, workspace.id, session.id)).status).toBe(204);
    await waitForState(server, session.id, 'idle');
    // No log line holds the user's text or the agent's reply.
    expect(lines.join('\n')).not.toContain('quiet-tool');
    expect(lines.join('\n')).not.toContain('Starting');
  });

  it('checks in with nothing named when no tool call is in progress', async () => {
    const { server, tab } = await startChatServer({ checkInDelayMs: 1_000 });
    const { workspace, session } = await openChat(server, tab);
    expect((await message(server, tab, workspace.id, session.id, 'quiet')).status).toBe(202);
    await waitFor(() => sessionEvents(server, session.id).some((e) => e.type === 'session.check_in'), 'the check-in', 15_000);
    expect(sessionEvents(server, session.id).find((e) => e.type === 'session.check_in')!.payload).toEqual({ sessionId: session.id });
    expect(stateOf(server, session.id)).toBe('working');
  });

  it('reads the test-only delay from the environment, clamped to 1 s .. 2^31-1 ms; anything but a number is ignored', () => {
    expect(checkInDelayFromEnv({})).toBeUndefined();
    expect(checkInDelayFromEnv({ OGDEN_AGENTS_TEST_CHECK_IN_MS: '5000' })).toBe(5000);
    for (const low of ['250', '0', '-5', '1.5']) expect(checkInDelayFromEnv({ OGDEN_AGENTS_TEST_CHECK_IN_MS: low })).toBe(1000);
    expect(checkInDelayFromEnv({ OGDEN_AGENTS_TEST_CHECK_IN_MS: '1e12' })).toBe(2 ** 31 - 1);
    for (const bad of ['', '  ', 'soon']) expect(checkInDelayFromEnv({ OGDEN_AGENTS_TEST_CHECK_IN_MS: bad })).toBeUndefined();
  });
});
