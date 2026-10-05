/**
 * Send now or wait end to end (2026-10-04): a real server, the real
 * `acp-claude-code` adapter and the fake ACP agent, which offers the
 * steering extension as claude-agent-acp 0.84 does. A message sent right
 * away goes into the running turn; the waiting messages are changed one at
 * a time; a waiting card refuses sending right away; the app-wide and
 * project settings are kept by the server; and no log line holds a message.
 */
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  API_ROUTES,
  ApiErrorBody,
  apiPath,
  ChatSettingsResponse,
  SendMessageResponse,
  SessionResponse,
  WorkspaceResponse,
  WorkspaceSettingsResponse,
  type CoreEvent,
  type SessionId,
} from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { removeAfterTest, signIn, startTestServer, waitFor, type SignedIn, type TestServer } from './helpers.js';

const FAKE_AGENT = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-acp-agent.mjs');

function request(server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) {
  return fetch(`${server.url}${path}`, {
    method,
    headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function setUp() {
  const lines: string[] = [];
  const server = await startTestServer({ claudeAdapterPath: FAKE_AGENT, lines });
  const tab = await signIn(server);
  const repo = removeAfterTest(mkdtempSync(join(tmpdir(), 'ogden-agents-repo-')));
  const wsId = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json()).workspace.id;
  const session = SessionResponse.parse(await (await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId }), {})).json()).session;
  const send = (text: string, delivery?: 'now' | 'wait') =>
    request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId, sesId: session.id }), delivery === undefined ? { text } : { text, delivery });
  const queued = (messageId: string) => apiPath(API_ROUTES.sessionQueuedMessage, { wsId, sesId: session.id, messageId });
  return { server, tab, wsId, sesId: session.id, send, queued, lines };
}

const eventsOf = (server: TestServer, sessionId: SessionId): CoreEvent[] => server.core.events.readAfter(0).filter((e) => e.streamId === sessionId);
const stateOf = (server: TestServer, sessionId: SessionId) => server.core.entities.getSession(sessionId)!.state;
const holding = (server: TestServer, sessionId: SessionId) =>
  waitFor(() => eventsOf(server, sessionId).some((e) => e.type === 'session.message_delta' && e.payload.text.includes('Holding')), 'the held turn', 15_000);

describe('send now or wait (routes)', () => {
  it('puts a message sent right away into the running turn: no stop, the turn ends answering it', async () => {
    const { server, sesId, send, lines } = await setUp();
    expect((await send('hold')).status).toBe(202);
    await holding(server, sesId);
    const now = await send('use the other file', 'now');
    expect(now.status).toBe(202);
    const { messageId } = SendMessageResponse.parse(await now.json());
    await waitFor(() => stateOf(server, sesId) === 'idle', 'the turn to end', 15_000);
    const events = eventsOf(server, sesId);
    expect(events.find((e) => e.type === 'session.message_completed' && e.payload.messageId === messageId)).toMatchObject({ payload: { role: 'user', delivery: 'injected' } });
    expect(events.some((e) => e.type === 'session.turn_interrupted')).toBe(false);
    const agentReplies = events.flatMap((e) => (e.type === 'session.message_completed' && e.payload.role === 'agent' ? [e.payload.content] : []));
    expect(agentReplies).toEqual(['Holding', 'Steered: use the other file.']);
    expect(lines.join('\n')).not.toContain('use the other file');
    // No session/cancel reached the agent: the message went into the turn.
    expect((await send('cancels')).status).toBe(202);
    await waitFor(
      () => eventsOf(server, sesId).some((e) => e.type === 'session.message_completed' && e.payload.role === 'agent' && e.payload.content === 'cancels=0'),
      'the cancel count',
      15_000,
    );
  });

  it('refuses to send right away while a card waits (409 answer_first), recording nothing', async () => {
    const { server, sesId, send } = await setUp();
    expect((await send('permission')).status).toBe(202);
    await waitFor(() => stateOf(server, sesId) === 'waiting', 'the card', 15_000);
    const before = eventsOf(server, sesId).length;
    const refused = await send('urgent', 'now');
    expect(refused.status).toBe(409);
    expect(ApiErrorBody.parse(await refused.json()).error).toMatchObject({ code: 'answer_first', message: 'Answer the request above first, then send your message.' });
    expect(eventsOf(server, sesId).length).toBe(before);
    // Waiting still works; an unknown delivery is a bad request.
    expect((await send('later', 'wait')).status).toBe(202);
    expect((await send('later', 'soon' as 'now')).status).toBe(400);
  });

  it('edits, moves, removes and sends right away a waiting message; one no longer waiting is 409', async () => {
    const { server, tab, sesId, send, queued } = await setUp();
    expect((await send('hold')).status).toBe(202);
    await holding(server, sesId);
    const a = SendMessageResponse.parse(await (await send('a')).json());
    const b = SendMessageResponse.parse(await (await send('b')).json());
    expect((await request(server, tab, 'PATCH', queued(a.messageId), { content: 'a, edited' })).status).toBe(204);
    expect((await request(server, tab, 'PATCH', queued(b.messageId), { position: 0 })).status).toBe(204);
    expect((await request(server, tab, 'PATCH', queued(b.messageId), {})).status).toBe(400);
    expect((await request(server, tab, 'PATCH', queued(b.messageId), { content: '   ' })).status).toBe(400);
    expect((await request(server, tab, 'DELETE', queued(b.messageId))).status).toBe(204);
    const gone = await request(server, tab, 'DELETE', queued(b.messageId));
    expect(gone.status).toBe(409);
    expect(ApiErrorBody.parse(await gone.json()).error.code).toBe('message_not_queued');
    const changes = eventsOf(server, sesId).flatMap((e) => (e.type === 'session.queue_changed' ? [e.payload.cause] : []));
    expect(changes).toEqual(['edited', 'moved', 'removed']);
    expect((await request(server, tab, 'POST', `${queued(a.messageId)}/send-now`)).status).toBe(204);
    await waitFor(() => stateOf(server, sesId) === 'idle', 'the turn to end', 15_000);
    expect(eventsOf(server, sesId).find((e) => e.type === 'session.message_completed' && e.payload.messageId === a.messageId)).toMatchObject({
      payload: { content: 'a, edited', delivery: 'injected' },
    });
    expect((await request(server, tab, 'PATCH', queued(a.messageId), { content: 'too late' })).status).toBe(409);
  });

  it('keeps the app-wide choice and a project override, each change an event; bad values are 400', async () => {
    const { server, tab, wsId } = await setUp();
    expect(ChatSettingsResponse.parse(await (await request(server, tab, 'GET', API_ROUTES.chatSettings)).json())).toEqual({ whileWorking: 'wait' });
    const saved = await request(server, tab, 'PUT', API_ROUTES.chatSettings, { whileWorking: 'now' });
    expect(ChatSettingsResponse.parse(await saved.json())).toEqual({ whileWorking: 'now' });
    expect((await request(server, tab, 'PUT', API_ROUTES.chatSettings, { whileWorking: 'soon' })).status).toBe(400);
    const settingsEvents = server.core.events.readAfter(0).filter((e) => e.type === 'settings.while_working_changed');
    expect(settingsEvents.map((e) => e.payload)).toEqual([{ whileWorking: 'now', previous: 'wait' }]);

    const settingsPath = apiPath(API_ROUTES.workspaceSettings, { wsId });
    const project = WorkspaceSettingsResponse.parse(await (await request(server, tab, 'PATCH', settingsPath, { whileWorking: 'wait' })).json()).settings;
    expect(project.whileWorking).toBe('wait');
    const back = WorkspaceSettingsResponse.parse(await (await request(server, tab, 'PATCH', settingsPath, { whileWorking: null })).json()).settings;
    expect(back.whileWorking).toBeUndefined();
    const changed = server.core.events.readAfter(0).flatMap((e) => (e.type === 'workspace.settings_changed' && e.payload.whileWorking !== undefined ? [[e.payload.whileWorking, e.payload.previousWhileWorking]] : []));
    expect(changed).toEqual([
      ['wait', null],
      [null, 'wait'],
    ]);
    expect((await request(server, tab, 'PATCH', settingsPath, { whileWorking: 'soon' })).status).toBe(400);
  });
});
