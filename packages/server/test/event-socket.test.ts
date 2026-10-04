/**
 * The events WebSocket's scoped, windowed subscriptions and paging (story
 * 2.9, E2-R8), end to end on a real server: a load gets only the install
 * events and each workspace's window, paging back to the start has no gap or
 * repeat, and a reconnect catches up exactly. The legacy `subscribe` still
 * works.
 */
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATABASE_FILE, newId } from '@ogden-agents/core';
import {
  DEFAULT_WINDOW_EVENTS,
  MAX_PAGE_EVENTS,
  type CoreEvent,
  type HistoryPageMessage,
  type ServerMessage,
  type SessionId,
  type WorkspaceId,
} from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { signIn, startTestServer, tempDataDir, trackSocket, waitFor, type SignedIn, type TestServer } from './helpers.js';

const unknownWs = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';

/** A connected `/ws` client recording every message it gets. */
async function connect(server: TestServer, tab: SignedIn) {
  const ws = trackSocket(new WebSocket(`${server.url.replace('http', 'ws')}/ws`, tab.protocols, { headers: { origin: server.url } }));
  // The server validated each message against the shared schema before sending it.
  const messages: ServerMessage[] = [];
  ws.on('message', (data) => messages.push(JSON.parse(String(data)) as ServerMessage));
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  const sendJson = (message: unknown) => ws.send(JSON.stringify(message));
  /** Waits for the first message after `from` that matches, and returns it. */
  const next = async <T extends ServerMessage>(match: (m: ServerMessage) => m is T, from = 0, what = 'a reply'): Promise<T> => {
    let found: T | undefined;
    await waitFor(() => (found = messages.slice(from).find(match)) !== undefined, what, 10_000);
    return found!;
  };
  return { ws, messages, sendJson, next };
}

const isEvent = (m: ServerMessage): m is CoreEvent => 'seq' in m;
const caughtUpFor = (scope: string) => (m: ServerMessage): m is Extract<ServerMessage, { type: 'caught_up' }> => m.type === 'caught_up' && m.scope === scope;
const pageFor = (requestId: string) => (m: ServerMessage): m is HistoryPageMessage => m.type === 'history_page' && m.requestId === requestId;
const failedFor = (type: string) => (m: ServerMessage): m is Extract<ServerMessage, { type: 'request_failed' }> => m.type === 'request_failed' && m.for === type;

function repo(): string {
  return mkdtempSync(join(tempDataDir(), 'repo-'));
}

/**
 * Two workspaces with one chat each, and `perWorkspace` deltas in each,
 * interleaved. Small seeds go through core; a large one is written straight
 * to the database in one transaction (the events are the same rows core
 * writes, and nobody is subscribed yet), so 100,000 events take well under a
 * second rather than half a minute of per-event validation.
 */
function seed(server: TestServer, perWorkspace: number) {
  const { entities, sessionEvents, events } = server.core;
  const a = entities.ensureWorkspace(repo());
  const b = entities.ensureWorkspace(repo());
  const sesA = entities.createSession({ workspaceId: a.id, kind: 'chat' });
  const sesB = entities.createSession({ workspaceId: b.id, kind: 'chat' });
  const sessions = [sesA, sesB];
  if (perWorkspace <= 100) {
    events.transaction(() => {
      for (let i = 0; i < perWorkspace; i++) {
        for (const session of sessions) {
          sessionEvents.appendSessionEvent(session.id, { type: 'session.message_delta', payload: { messageId: `m${i}`, role: 'agent', text: 'x' } });
        }
      }
    });
  } else {
    const db = new DatabaseSync(join(server.dataDir, DATABASE_FILE));
    try {
      db.exec('PRAGMA busy_timeout = 5000');
      const insert = db.prepare('INSERT INTO events (id, workspace_id, stream_id, type, at, payload) VALUES (?, ?, ?, ?, ?, ?)');
      const at = new Date().toISOString();
      db.exec('BEGIN');
      for (let i = 0; i < perWorkspace; i++) {
        for (const session of sessions) {
          insert.run(newId('evt'), session.workspaceId, session.id, 'session.message_delta', at, JSON.stringify({ messageId: `m${i}`, role: 'agent', text: 'x' }));
        }
      }
      db.exec('COMMIT');
    } finally {
      db.close();
    }
  }
  return { a: a.id, b: b.id, sesA: sesA.id, sesB: sesB.id };
}

const delta = (server: TestServer, sessionId: SessionId, messageId: string) =>
  server.core.sessionEvents.appendSessionEvent(sessionId, { type: 'session.message_delta', payload: { messageId, role: 'agent', text: 'y' } });

describe('scoped subscriptions over 100,000 events', () => {
  it('a load gets only the windows, paging back to the start has no gap or repeat, and a reconnect catches up exactly', async () => {
    const server = await startTestServer();
    const tab = await signIn(server);
    const { a, b, sesA, sesB } = seed(server, 50_000);
    const allA = server.core.events.readAfter(0, { workspaceId: a, limit: 200_000 });
    const allB = server.core.events.readAfter(0, { workspaceId: b, limit: 200_000 });
    expect(allA.length + allB.length).toBeGreaterThan(100_000);

    // Load: install events and each workspace's window, never the whole history.
    const client = await connect(server, tab);
    client.sendJson({ type: 'subscribe_install', afterSeq: 0 });
    client.sendJson({ type: 'subscribe_workspace', workspaceId: a });
    client.sendJson({ type: 'subscribe_workspace', workspaceId: b });
    const install = await client.next(caughtUpFor('install'));
    const caughtA = await client.next(caughtUpFor(a));
    const caughtB = await client.next(caughtUpFor(b));
    const events = client.messages.filter(isEvent);
    const installEvents = events.filter((e) => e.workspaceId === null || e.type === 'workspace.created');
    expect(installEvents.map((e) => e.type)).toEqual(['server.started', 'workspace.created', 'workspace.created']);
    expect(install).toMatchObject({ oldestSeq: installEvents[0]!.seq, hasEarlier: false });
    const windowA = events.filter((e) => e.workspaceId === a && e.type !== 'workspace.created');
    expect(windowA).toEqual(allA.slice(-DEFAULT_WINDOW_EVENTS));
    expect(caughtA).toMatchObject({ oldestSeq: windowA[0]!.seq, hasEarlier: true });
    expect(events.filter((e) => e.workspaceId === b && e.type !== 'workspace.created')).toEqual(allB.slice(-DEFAULT_WINDOW_EVENTS));
    expect(caughtB.hasEarlier).toBe(true);
    // Install events (each workspace.created comes with the install scope only) plus two windows, each event once.
    expect(events).toHaveLength(3 + 2 * DEFAULT_WINDOW_EVENTS);
    expect(new Set(events.map((e) => e.seq)).size).toBe(events.length);

    // Page back to the start: oldest first, every event before the cursor, no gap or repeat.
    const paged: CoreEvent[][] = [];
    let before = caughtA.oldestSeq!;
    for (let i = 0; ; i++) {
      const from = client.messages.length;
      client.sendJson({ type: 'page_history', requestId: `p${i}`, workspaceId: a, beforeSeq: before, limit: MAX_PAGE_EVENTS });
      const page = await client.next(pageFor(`p${i}`), from);
      expect(page.events.length).toBeLessThanOrEqual(MAX_PAGE_EVENTS);
      expect(page.events.every((e) => e.seq < before && e.workspaceId === a)).toBe(true);
      paged.unshift(page.events);
      if (!page.hasMore) break;
      before = page.events[0]!.seq;
    }
    expect([...paged.flat(), ...windowA].map((e) => e.seq)).toEqual(allA.map((e) => e.seq));

    // A session page stays in its session; a session of another workspace gives an empty page.
    let from = client.messages.length;
    client.sendJson({ type: 'page_history', requestId: 's1', workspaceId: a, sessionId: sesA, beforeSeq: caughtA.oldestSeq!, limit: 50 });
    const sessionPage = await client.next(pageFor('s1'), from);
    expect(sessionPage.events).toHaveLength(50);
    expect(sessionPage.events.every((e) => e.streamId === sesA)).toBe(true);
    client.sendJson({ type: 'page_history', requestId: 's2', workspaceId: a, sessionId: sesB, beforeSeq: caughtA.oldestSeq!, limit: 50 });
    expect(await client.next(pageFor('s2'), from)).toMatchObject({ events: [], hasMore: false });

    // Live: a new event of each workspace arrives once.
    from = client.messages.length;
    const liveA = delta(server, sesA, 'live-a');
    const liveB = delta(server, sesB, 'live-b');
    await waitFor(() => client.messages.slice(from).filter(isEvent).length >= 2, 'live events');
    expect(client.messages.slice(from).filter(isEvent)).toEqual([liveA, liveB]);

    // Reconnect: exactly the missed events of each scope, then live.
    client.ws.close();
    const missedA = [delta(server, sesA, 'gone-1'), delta(server, sesA, 'gone-2')];
    const missedB = [delta(server, sesB, 'gone-3')];
    const again = await connect(server, tab);
    again.sendJson({ type: 'subscribe_install', afterSeq: installEvents.at(-1)!.seq });
    again.sendJson({ type: 'subscribe_workspace', workspaceId: a, afterSeq: liveA.seq });
    again.sendJson({ type: 'subscribe_workspace', workspaceId: b, afterSeq: liveB.seq });
    await again.next(caughtUpFor(b));
    expect(again.messages.filter(isEvent)).toEqual([...missedA, ...missedB]);
    expect(again.messages.find(caughtUpFor(a))).toMatchObject({ oldestSeq: missedA[0]!.seq, hasEarlier: true });
    expect(again.messages.find(caughtUpFor('install'))).toMatchObject({ oldestSeq: null, hasEarlier: true });
  }, 30_000);
});

describe('scoped subscriptions', () => {
  async function ready() {
    const server = await startTestServer();
    const ids = seed(server, 10);
    return { server, ids, client: await connect(server, await signIn(server)) };
  }

  it('a reconnect with nothing missed says oldestSeq null, and whether anything is earlier', async () => {
    const { server, ids, client } = await ready();
    client.sendJson({ type: 'subscribe_workspace', workspaceId: ids.a, afterSeq: server.core.events.lastSeq() });
    expect(await client.next(caughtUpFor(ids.a))).toMatchObject({ oldestSeq: null, hasEarlier: true });
    server.core.events.deleteWorkspaceHistory(ids.b);
    client.sendJson({ type: 'subscribe_workspace', workspaceId: ids.b, afterSeq: server.core.events.lastSeq() });
    expect(await client.next(caughtUpFor(ids.b))).toMatchObject({ oldestSeq: null, hasEarlier: true });
  });

  it('a reconnect that missed more than MAX_PAGE_EVENTS gets the window and a reset; one that missed exactly that many catches up exactly', async () => {
    const server = await startTestServer();
    const ids = seed(server, MAX_PAGE_EVENTS + 50);
    const client = await connect(server, await signIn(server));
    const all = server.core.events.readAfter(0, { workspaceId: ids.a, limit: 10_000 }).filter((e) => e.type !== 'workspace.created');
    expect(all.length).toBeGreaterThan(MAX_PAGE_EVENTS + 1);

    // Large gap: the newest window instead of the gap, then live.
    const large = all.at(-(MAX_PAGE_EVENTS + 2))!.seq;
    client.sendJson({ type: 'subscribe_workspace', workspaceId: ids.a, afterSeq: large });
    const reset = await client.next(caughtUpFor(ids.a));
    const window = all.slice(-DEFAULT_WINDOW_EVENTS);
    expect(client.messages.filter(isEvent)).toEqual(window);
    expect(reset).toEqual({ type: 'caught_up', scope: ids.a, oldestSeq: window[0]!.seq, hasEarlier: true, reset: true });

    // Exactly MAX_PAGE_EVENTS missed: every one of them, and no reset.
    let from = client.messages.length;
    const exact = all.at(-(MAX_PAGE_EVENTS + 1))!.seq;
    client.sendJson({ type: 'subscribe_workspace', workspaceId: ids.a, afterSeq: exact });
    const caught = await client.next(caughtUpFor(ids.a), from);
    expect(client.messages.slice(from).filter(isEvent)).toEqual(all.slice(-MAX_PAGE_EVENTS));
    expect(caught).toEqual({ type: 'caught_up', scope: ids.a, oldestSeq: all.at(-MAX_PAGE_EVENTS)!.seq, hasEarlier: true });

    // The install scope counts its own events only: a small gap there is exact.
    from = client.messages.length;
    client.sendJson({ type: 'subscribe_install', afterSeq: 1 });
    const install = await client.next(caughtUpFor('install'), from);
    expect(install.reset).toBeUndefined();
    expect(client.messages.slice(from).filter(isEvent).map((e) => e.type)).toEqual(['workspace.created', 'workspace.created']);
  });

  it('subscribing to the same workspace again replaces the old one, however often: live events arrive once', async () => {
    const { server, ids, client } = await ready();
    client.sendJson({ type: 'subscribe_workspace', workspaceId: ids.a, window: 5 });
    await client.next(caughtUpFor(ids.a));
    for (let i = 0; i < 20; i++) client.sendJson({ type: 'subscribe_workspace', workspaceId: ids.a, window: 1 });
    await waitFor(() => client.messages.filter(caughtUpFor(ids.a)).length === 21, 'every resubscription');
    const from = client.messages.length;
    client.sendJson({ type: 'subscribe_workspace', workspaceId: ids.a, window: 5 });
    await client.next(caughtUpFor(ids.a), from);
    const live = delta(server, ids.sesA, 'once');
    await waitFor(() => client.messages.some((m) => isEvent(m) && m.seq === live.seq), 'the live event');
    client.sendJson({ type: 'ping' });
    await client.next((m): m is Extract<ServerMessage, { type: 'pong' }> => m.type === 'pong', from);
    expect(client.messages.filter((m) => isEvent(m) && m.seq === live.seq)).toHaveLength(1);
    // The window was sent again, for the client to dedupe by seq; nothing else.
    expect(client.messages.slice(from).filter(isEvent)).toHaveLength(6);
  });

  it('unsubscribe_workspace stops that workspace only', async () => {
    const { server, ids, client } = await ready();
    client.sendJson({ type: 'subscribe_workspace', workspaceId: ids.a, window: 1 });
    client.sendJson({ type: 'subscribe_workspace', workspaceId: ids.b, window: 1 });
    await client.next(caughtUpFor(ids.b));
    client.sendJson({ type: 'unsubscribe_workspace', workspaceId: ids.a });
    client.sendJson({ type: 'ping' });
    await client.next((m): m is Extract<ServerMessage, { type: 'pong' }> => m.type === 'pong');
    const from = client.messages.length;
    delta(server, ids.sesA, 'dropped');
    const kept = delta(server, ids.sesB, 'kept');
    await waitFor(() => client.messages.slice(from).some(isEvent), 'a live event');
    client.sendJson({ type: 'ping' });
    await client.next((m): m is Extract<ServerMessage, { type: 'pong' }> => m.type === 'pong', from);
    expect(client.messages.slice(from).filter(isEvent)).toEqual([kept]);
  });

  it('an unknown workspace is request_failed / not_found, for a subscription and a page', async () => {
    const { client } = await ready();
    client.sendJson({ type: 'subscribe_workspace', workspaceId: unknownWs });
    expect(await client.next(failedFor('subscribe_workspace'))).toEqual({
      type: 'request_failed',
      for: 'subscribe_workspace',
      workspaceId: unknownWs,
      code: 'not_found',
      message: expect.any(String),
    });
    client.sendJson({ type: 'page_history', requestId: 'r1', workspaceId: unknownWs, beforeSeq: 10, limit: 10 });
    expect(await client.next(failedFor('page_history'))).toEqual({
      type: 'request_failed',
      for: 'page_history',
      requestId: 'r1',
      workspaceId: unknownWs,
      code: 'not_found',
      message: expect.any(String),
    });
    expect(client.messages.filter(isEvent)).toEqual([]);
  });

  it('refuses an oversized page with its request id, and ignores an oversized window, which carries none', async () => {
    const lines: string[] = [];
    const server = await startTestServer({ lines });
    const ids = seed(server, 10);
    const client = await connect(server, await signIn(server));
    client.sendJson({ type: 'page_history', requestId: 'big', workspaceId: ids.a, beforeSeq: 1000, limit: MAX_PAGE_EVENTS + 1 });
    // Nothing valid to correlate: an over-long request id, and no request id at all.
    client.sendJson({ type: 'page_history', requestId: 'x'.repeat(129), workspaceId: ids.a, beforeSeq: 1000, limit: 10 });
    client.sendJson({ type: 'page_history', workspaceId: 'not-an-id', beforeSeq: 0, limit: 0 });
    client.sendJson({ type: 'subscribe_workspace', workspaceId: ids.a, window: MAX_PAGE_EVENTS + 1 });
    client.sendJson({ type: 'ping' });
    await client.next((m): m is Extract<ServerMessage, { type: 'pong' }> => m.type === 'pong');
    expect(client.messages).toEqual([
      { type: 'request_failed', for: 'page_history', requestId: 'big', workspaceId: ids.a, code: 'invalid_request', message: expect.any(String) },
      { type: 'pong', at: expect.any(String) },
    ]);
    expect(lines.join('').split('ignoring client message that fails the shared schema').length - 1).toBe(4);
  });

  it('the legacy subscribe still streams every event, then caught_up', async () => {
    const { server, client } = await ready();
    client.sendJson({ type: 'subscribe', afterSeq: 0 });
    const caught = await client.next((m): m is Extract<ServerMessage, { type: 'caught_up' }> => m.type === 'caught_up');
    expect(caught).toEqual({ type: 'caught_up' });
    expect(client.messages.filter(isEvent)).toEqual(server.core.events.readAfter(0, { limit: 1000 }));
  });
});
