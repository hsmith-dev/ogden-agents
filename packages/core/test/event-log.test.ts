import { CoreEvent, SERVER_STREAM, type NewCoreEvent, type SessionId, type WorkspaceId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { EventValidationError, NotFoundError, type Core } from '../src/index.js';
import { openTestCore, tempDir } from './helpers.js';

const started = (version = '1.0.0'): NewCoreEvent => ({
  type: 'server.started',
  workspaceId: null,
  streamId: SERVER_STREAM,
  payload: { version },
});

function appendStarted(core: Core, count: number) {
  return Array.from({ length: count }, (_, i) => core.events.append(started(`1.0.${i}`)));
}

/** A workspace with one chat session, for message events. */
function chat(core: Core) {
  const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
  const session = core.entities.createSession({ workspaceId: workspace.id, kind: 'chat' });
  return { workspaceId: workspace.id, sessionId: session.id };
}

/** Appends a message delta through the session-event helper, the only way (E2-R7). */
const appendDelta = (core: Core, ids: { workspaceId: WorkspaceId; sessionId: SessionId }, messageId: string, text: string) =>
  core.sessionEvents.appendSessionEvent(ids.sessionId, {
    type: 'session.message_delta',
    payload: { messageId, role: 'agent', text },
  });

describe('append', () => {
  it('stores a schema-valid envelope with a strictly increasing seq', () => {
    const core = openTestCore();
    const [a, b, c] = appendStarted(core, 3);
    for (const event of [a, b, c]) expect(CoreEvent.parse(event)).toEqual(event);
    expect(a!.id).toMatch(/^evt_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a!.workspaceId).toBeNull();
    expect(b!.seq).toBeGreaterThan(a!.seq);
    expect(c!.seq).toBeGreaterThan(b!.seq);
    expect(core.events.readAfter(0)).toEqual([a, b, c]);
    expect(core.events.lastSeq()).toBe(c!.seq);
  });

  it('rejects an event that fails its schema with a typed error, writing nothing', () => {
    const core = openTestCore();
    const [first] = appendStarted(core, 1);
    const before = core.events.lastSeq();

    const bad = [
      { ...started(), payload: { version: '' } },
      { ...started(), workspaceId: 'ws_not-a-ulid' },
      { type: 'launch.missiles', workspaceId: null, streamId: SERVER_STREAM, payload: {} },
      { ...started(), streamId: 'elsewhere' },
    ];
    for (const event of bad) {
      expect(() => core.events.append(event as NewCoreEvent)).toThrow(EventValidationError);
    }
    const error = (() => {
      try {
        core.events.append(bad[0] as NewCoreEvent);
      } catch (e) {
        return e as EventValidationError;
      }
    })();
    expect(error?.code).toBe('invalid_event');
    expect(error?.issues.length).toBeGreaterThan(0);

    expect(core.events.lastSeq()).toBe(before);
    expect(core.events.readAfter(0)).toEqual([first]);
    // The next valid event continues directly after the last one.
    const [next] = appendStarted(core, 1);
    expect(next!.seq).toBe(before + 1);
  });

  it('does not store keys outside the schema', () => {
    const core = openTestCore();
    const event = core.events.append({ ...started(), payload: { version: '1', secret: 'x' } } as unknown as NewCoreEvent);
    expect(event.payload).toEqual({ version: '1' });
    expect(core.events.readAfter(0)[0]!.payload).toEqual({ version: '1' });
  });
});

describe('readAfter', () => {
  it('returns only events after the given seq, in order, up to the limit', () => {
    const core = openTestCore();
    const all = appendStarted(core, 5);
    expect(core.events.readAfter(all[1]!.seq)).toEqual(all.slice(2));
    expect(core.events.readAfter(all[1]!.seq, { limit: 2 })).toEqual(all.slice(2, 4));
    expect(core.events.readAfter(all[4]!.seq)).toEqual([]);
  });

  it('filters by workspace, or to install-level events with null', () => {
    const core = openTestCore();
    const [server] = appendStarted(core, 1);
    const ids = chat(core);
    const inWorkspace = core.events.readAfter(0, { workspaceId: ids.workspaceId });
    expect(inWorkspace.map((e) => e.type)).toEqual(['workspace.created', 'session.created']);
    expect(core.events.readAfter(0, { workspaceId: null })).toEqual([server]);
  });

  it('rejects a cursor that is not a non-negative integer', () => {
    const core = openTestCore();
    for (const bad of [-1, 1.5, Number.NaN]) {
      expect(() => core.events.readAfter(bad)).toThrow(RangeError);
      expect(() => core.events.subscribe(bad, () => {})).toThrow(RangeError);
    }
  });
});

describe('subscribe', () => {
  it('catch-up: delivers N+1…M in order, then live events, with no gap or duplicate', () => {
    const core = openTestCore();
    const all = appendStarted(core, 6);
    const n = all[2]!.seq;
    const received: number[] = [];
    const unsubscribe = core.events.subscribe(n, (event) => received.push(event.seq));
    expect(received).toEqual(all.slice(3).map((e) => e.seq));

    const live = appendStarted(core, 2);
    expect(received).toEqual([...all.slice(3), ...live].map((e) => e.seq));

    unsubscribe();
    appendStarted(core, 1);
    expect(received).toHaveLength(5);
  });

  it('delivers a backlog larger than one page, and events the listener appends while catching up', () => {
    const core = openTestCore();
    appendStarted(core, 1203);
    const received: number[] = [];
    let appended = false;
    core.events.subscribe(0, (event) => {
      received.push(event.seq);
      if (!appended && received.length === 1203) {
        appended = true;
        core.events.append(started('appended during catch-up'));
      }
    });
    expect(received).toHaveLength(1204);
    expect(received).toEqual([...received].sort((a, b) => a - b));
    expect(new Set(received).size).toBe(1204);
  });

  it('page reconnect: resubscribing after the last seen seq shows nothing twice', () => {
    const core = openTestCore();
    const seen: number[] = [];
    let unsubscribe = core.events.subscribe(0, (e) => seen.push(e.seq));
    appendStarted(core, 3);
    unsubscribe(); // the connection drops
    appendStarted(core, 2); // missed while away
    unsubscribe = core.events.subscribe(seen.at(-1)!, (e) => seen.push(e.seq));
    appendStarted(core, 1);
    unsubscribe();
    expect(seen).toEqual(core.events.readAfter(0).map((e) => e.seq));
    expect(new Set(seen).size).toBe(6);
  });

  it('does not deliver events at or below a cursor set beyond the current end', () => {
    const core = openTestCore();
    appendStarted(core, 1);
    const received: number[] = [];
    core.events.subscribe(core.events.lastSeq() + 1, (e) => received.push(e.seq));
    const [skipped, delivered] = appendStarted(core, 2);
    expect(received).toEqual([delivered!.seq]);
    expect(skipped!.seq).toBeLessThan(delivered!.seq);
  });

  it('keeps notifying other subscribers when one throws', () => {
    const errors: unknown[] = [];
    const core = openTestCore(undefined, (error) => errors.push(error));
    const received: number[] = [];
    core.events.subscribe(0, () => {
      throw new Error('boom');
    });
    core.events.subscribe(0, (e) => received.push(e.seq));
    const [event] = appendStarted(core, 1);
    expect(received).toEqual([event!.seq]);
    expect(errors).toHaveLength(1);
  });
});

describe('transactions', () => {
  it('delivers events only after commit, and none from a rolled-back transaction', () => {
    const core = openTestCore();
    const received: string[] = [];
    core.events.subscribe(0, (e) => received.push(e.type === 'server.started' ? e.payload.version : e.type));

    core.events.transaction(() => {
      core.events.append(started('a'));
      expect(received).toEqual([]);
    });
    expect(received).toEqual(['a']);

    expect(() =>
      core.events.transaction(() => {
        core.events.append(started('b'));
        throw new Error('roll back');
      }),
    ).toThrow('roll back');
    expect(received).toEqual(['a']);
    expect(core.events.readAfter(0)).toHaveLength(1);
  });
});

describe('restart', () => {
  it('keeps earlier events readable, and new seq values continue above the old maximum', () => {
    const dataDir = tempDir();
    const first = openTestCore(dataDir);
    const before = appendStarted(first, 3);
    first.close();

    const second = openTestCore(dataDir);
    expect(second.events.readAfter(0)).toEqual(before);
    const [after] = appendStarted(second, 1);
    expect(after!.seq).toBeGreaterThan(before.at(-1)!.seq);
  });

  it('never reuses a seq, even after the newest events are deleted', () => {
    const dataDir = tempDir();
    const first = openTestCore(dataDir);
    const ids = chat(first);
    const newest = appendDelta(first, ids, 'm1', 'x');
    first.events.deleteWorkspaceHistory(ids.workspaceId);
    const deletedAndAppended = first.events.lastSeq();
    expect(deletedAndAppended).toBeGreaterThan(newest.seq);
    first.close();

    const second = openTestCore(dataDir);
    const [next] = appendStarted(second, 1);
    expect(next!.seq).toBe(deletedAndAppended + 1);
  });
});

describe('message compaction', () => {
  it('appends the completed message with full content, then removes that message’s deltas', () => {
    const core = openTestCore();
    const ids = chat(core);
    const other = appendDelta(core, ids, 'm2', 'other message');
    const deltas = ['Hel', 'lo, ', 'world'].map((text) => appendDelta(core, ids, 'm1', text));

    const completed = core.sessionEvents.completeMessage(ids.sessionId, { messageId: 'm1', role: 'agent', content: 'Hello, world' });
    expect(completed.seq).toBeGreaterThan(deltas.at(-1)!.seq);
    expect(completed.payload.content).toBe('Hello, world');

    const remaining = core.events.readAfter(0, { workspaceId: ids.workspaceId });
    const deltaSeqs = new Set(deltas.map((d) => d.seq));
    expect(remaining.some((e) => deltaSeqs.has(e.seq))).toBe(false);
    expect(remaining).toContainEqual(other);
    expect(remaining).toContainEqual(completed);
  });

  it('a client resuming mid-message ends with exactly the completed message', () => {
    const core = openTestCore();
    const ids = chat(core);
    const first = appendDelta(core, ids, 'm1', 'Hel');
    appendDelta(core, ids, 'm1', 'lo');

    // The client has seen the first delta, then drops.
    const messages = new Map<string, string>();
    const fold = (event: CoreEvent) => {
      if (event.type === 'session.message_delta') {
        messages.set(event.payload.messageId, (messages.get(event.payload.messageId) ?? '') + event.payload.text);
      } else if (event.type === 'session.message_completed') {
        messages.set(event.payload.messageId, event.payload.content);
      }
    };
    fold(first);

    core.sessionEvents.completeMessage(ids.sessionId, { messageId: 'm1', role: 'agent', content: 'Hello' });

    const received: CoreEvent[] = [];
    core.events.subscribe(first.seq, (e) => {
      received.push(e);
      fold(e);
    });
    expect(received.map((e) => e.type)).toEqual(['session.message_completed']);
    expect([...messages]).toEqual([['m1', 'Hello']]);
  });

  it('a live subscriber sees the deltas and then the completed message', () => {
    const core = openTestCore();
    const ids = chat(core);
    const types: string[] = [];
    core.events.subscribe(core.events.lastSeq(), (e) => types.push(e.type));
    appendDelta(core, ids, 'm1', 'a');
    core.sessionEvents.completeMessage(ids.sessionId, { messageId: 'm1', role: 'agent', content: 'a' });
    expect(types).toEqual(['session.message_delta', 'session.message_completed']);
  });
});

describe('deleteWorkspaceHistory', () => {
  it('removes one workspace’s events, sessions and runs, keeping its row and every other workspace', () => {
    const core = openTestCore();
    const [server] = appendStarted(core, 1);
    const doomed = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    const kept = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    for (const ws of [doomed, kept]) {
      const build = core.entities.createSession({ workspaceId: ws.id, kind: 'build' });
      core.entities.createRun({ sessionId: build.id, ticketRef: '1.3' });
      core.entities.createSession({ workspaceId: ws.id, kind: 'chat' });
    }
    const keptEvents = core.events.readAfter(0, { workspaceId: kept.id });

    const result = core.events.deleteWorkspaceHistory(doomed.id);
    expect(result).toMatchObject({ deletedEvents: 4, deletedSessions: 2, deletedRuns: 1 });
    expect(result.event).toMatchObject({
      type: 'workspace.history_deleted',
      workspaceId: doomed.id,
      payload: { deletedEvents: 4, deletedSessions: 2, deletedRuns: 1 },
    });

    expect(core.entities.getWorkspace(doomed.id)).toEqual(doomed);
    expect(core.entities.listSessions(doomed.id)).toEqual([]);
    expect(core.events.readAfter(0, { workspaceId: doomed.id })).toEqual([result.event]);

    expect(core.entities.listSessions(kept.id)).toHaveLength(2);
    expect(core.events.readAfter(0, { workspaceId: kept.id })).toEqual(keptEvents);
    expect(core.events.readAfter(0, { workspaceId: null })).toEqual([server]);
  });

  it('throws NotFoundError for an unknown workspace', () => {
    const core = openTestCore();
    expect(() => core.events.deleteWorkspaceHistory('ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3')).toThrow(NotFoundError);
  });
});

describe('subscribeScope (E2-R8)', () => {
  /** Two workspaces with a chat each, and `count` deltas in each chat, interleaved. */
  function twoWorkspaces(core: Core, count: number) {
    const a = chat(core);
    const b = chat(core);
    core.events.transaction(() => {
      for (let i = 0; i < count; i++) {
        appendDelta(core, a, `a${i}`, 'x');
        appendDelta(core, b, `b${i}`, 'y');
      }
    });
    return { a, b };
  }

  it('install scope: install-level events plus every workspace.created, then live', () => {
    const core = openTestCore();
    const [server] = appendStarted(core, 1);
    const { a } = twoWorkspaces(core, 3);
    const seen: CoreEvent[] = [];
    const sub = core.events.subscribeScope('install', { afterSeq: 0 }, (event) => seen.push(event));
    expect(seen.map((e) => e.type)).toEqual(['server.started', 'workspace.created', 'workspace.created']);
    expect(sub).toMatchObject({ oldestSeq: server!.seq, hasEarlier: false });
    appendDelta(core, a, 'live', 'z');
    const [next] = appendStarted(core, 1);
    expect(seen.at(-1)).toEqual(next);
    expect(seen).toHaveLength(4);
    sub.unsubscribe();
    appendStarted(core, 1);
    expect(seen).toHaveLength(4);
  });

  it('workspace window: the newest N of that workspace only, oldest first, then live; hasEarlier says whether more exist', () => {
    const core = openTestCore();
    const { a, b } = twoWorkspaces(core, 10);
    // Its workspace.created comes with the install scope instead.
    const all = core.events.readAfter(0, { workspaceId: a.workspaceId, limit: 1000 }).filter((e) => e.type !== 'workspace.created');
    const seen: CoreEvent[] = [];
    const sub = core.events.subscribeScope(a.workspaceId, { window: 4 }, (event) => seen.push(event));
    expect(seen).toEqual(all.slice(-4));
    expect(sub).toMatchObject({ oldestSeq: all.at(-4)!.seq, hasEarlier: true });

    appendDelta(core, b, 'other', 'no');
    const live = appendDelta(core, a, 'live', 'yes');
    expect(seen.at(-1)).toEqual(live);
    expect(seen).toHaveLength(5);

    // A window larger than the history sends it all, with nothing earlier.
    const whole: CoreEvent[] = [];
    const big = core.events.subscribeScope(a.workspaceId, { window: 500 }, (event) => whole.push(event));
    expect(whole).toEqual([...all, live]);
    expect(big).toMatchObject({ oldestSeq: all[0]!.seq, hasEarlier: false });
  });

  it("sends only what there is: a deleted history's window, and nothing (oldestSeq null) after the last seq, then live", () => {
    const core = openTestCore();
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    core.events.deleteWorkspaceHistory(workspace.id);
    const deleted = core.events.readAfter(0, { workspaceId: workspace.id });
    const seen: CoreEvent[] = [];
    const sub = core.events.subscribeScope(workspace.id, { window: 1 }, (event) => seen.push(event));
    expect(seen).toEqual(deleted);
    expect(sub.hasEarlier).toBe(false);

    const fresh = openTestCore();
    const ws = fresh.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    fresh.events.deleteWorkspaceHistory(ws.id);
    const empty: CoreEvent[] = [];
    // After the only event: nothing in the backlog, and the one event is earlier.
    const after = fresh.events.subscribeScope(ws.id, { afterSeq: fresh.events.lastSeq() }, (event) => empty.push(event));
    expect(empty).toEqual([]);
    expect(after).toMatchObject({ oldestSeq: null, hasEarlier: true });
    const s = fresh.entities.createSession({ workspaceId: ws.id, kind: 'chat' });
    expect(empty.map((e) => e.type)).toEqual(['session.created']);
    expect(empty[0]!.streamId).toBe(s.id);
  });

  it('reconnect after a seq: exactly the missed events of that scope, then live', () => {
    const core = openTestCore();
    const { a } = twoWorkspaces(core, 5);
    const all = core.events.readAfter(0, { workspaceId: a.workspaceId });
    const cut = all[3]!.seq;
    const seen: CoreEvent[] = [];
    const sub = core.events.subscribeScope(a.workspaceId, { afterSeq: cut }, (event) => seen.push(event));
    expect(seen).toEqual(all.filter((e) => e.seq > cut));
    expect(sub).toMatchObject({ oldestSeq: all[4]!.seq, hasEarlier: true });
  });

  it('has no gap while events are appended during delivery, including by the listener itself', () => {
    const core = openTestCore();
    const { a } = twoWorkspaces(core, 5);
    const seen: number[] = [];
    let appended = 0;
    core.events.subscribeScope(a.workspaceId, { window: 3 }, (event) => {
      seen.push(event.seq);
      if (appended < 3) {
        appended++;
        appendDelta(core, a, `during${appended}`, 'x');
      }
    });
    for (let i = 0; i < 3; i++) appendDelta(core, a, `after${i}`, 'x');
    const all = core.events.readAfter(0, { workspaceId: a.workspaceId, limit: 1000 }).map((e) => e.seq);
    expect(seen).toEqual(all.slice(all.indexOf(seen[0]!)));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('throws NotFoundError for an unknown workspace, and RangeError for a bad window', () => {
    const core = openTestCore();
    const { a } = twoWorkspaces(core, 1);
    expect(() => core.events.subscribeScope('ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3', { window: 10 }, () => {})).toThrow(NotFoundError);
    expect(() => core.events.subscribeScope(a.workspaceId, { window: 0 }, () => {})).toThrow(RangeError);
    expect(() => core.events.subscribeScope(a.workspaceId, { window: 501 }, () => {})).toThrow(RangeError);
    expect(() => core.events.subscribeScope(a.workspaceId, { afterSeq: -1 }, () => {})).toThrow(RangeError);
  });
});

describe('countAfter (story 2.10)', () => {
  it("counts a scope's events after a seq, at most the cap", () => {
    const core = openTestCore();
    appendStarted(core, 2);
    const a = chat(core);
    const b = chat(core);
    for (let i = 0; i < 6; i++) {
      appendDelta(core, a, `a${i}`, 'x');
      appendDelta(core, b, `b${i}`, 'y');
    }
    const all = core.events.readAfter(0, { workspaceId: a.workspaceId }).filter((e) => e.type !== 'workspace.created');
    // The workspace scope leaves out its own workspace.created, as subscribeScope does.
    expect(core.events.countAfter(a.workspaceId, 0, 100)).toBe(all.length);
    expect(core.events.countAfter(a.workspaceId, all[2]!.seq, 100)).toBe(all.length - 3);
    expect(core.events.countAfter(a.workspaceId, 0, 3)).toBe(3);
    expect(core.events.countAfter(a.workspaceId, core.events.lastSeq(), 100)).toBe(0);
    // Install: the two server.started and both workspace.created.
    expect(core.events.countAfter('install', 0, 100)).toBe(4);
    expect(() => core.events.countAfter('install', -1, 10)).toThrow(RangeError);
    expect(() => core.events.countAfter('install', 0, 0)).toThrow(RangeError);
  });
});

describe('readBefore (E2-R8)', () => {
  it('pages back to the start, oldest first, and the pages concatenate to exactly readAfter', () => {
    const core = openTestCore();
    const a = chat(core);
    const b = chat(core);
    core.events.transaction(() => {
      for (let i = 0; i < 40; i++) {
        appendDelta(core, a, `a${i}`, 'x');
        appendDelta(core, b, `b${i}`, 'y');
      }
    });
    const all = core.events.readAfter(0, { workspaceId: a.workspaceId, limit: 1000 });
    const pages: CoreEvent[][] = [];
    let before = core.events.lastSeq() + 1;
    for (;;) {
      const page = core.events.readBefore(a.workspaceId, before, 7);
      expect(page.events.length).toBeLessThanOrEqual(7);
      for (const event of page.events) expect(event.seq).toBeLessThan(before);
      pages.unshift(page.events);
      if (!page.hasMore) break;
      before = page.events[0]!.seq;
    }
    expect(pages.flat()).toEqual(all);
  });

  it("filters by session, and another workspace's session gives an empty page", () => {
    const core = openTestCore();
    const a = chat(core);
    const b = chat(core);
    const second = core.entities.createSession({ workspaceId: a.workspaceId, kind: 'chat' });
    appendDelta(core, a, 'm1', 'x');
    core.sessionEvents.appendSessionEvent(second.id, { type: 'session.message_delta', payload: { messageId: 'm2', role: 'agent', text: 'y' } });
    appendDelta(core, b, 'm3', 'z');
    const end = core.events.lastSeq() + 1;

    const page = core.events.readBefore(a.workspaceId, end, 500, a.sessionId);
    expect(page.hasMore).toBe(false);
    expect(page.events.map((e) => e.type)).toEqual(['session.created', 'session.message_delta']);
    for (const event of page.events) expect(event.streamId).toBe(a.sessionId);

    expect(core.events.readBefore(a.workspaceId, end, 500, b.sessionId)).toEqual({ events: [], hasMore: false });
  });

  it('throws NotFoundError for an unknown workspace, and RangeError past MAX_PAGE_EVENTS', () => {
    const core = openTestCore();
    const a = chat(core);
    expect(() => core.events.readBefore('ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3', 10, 10)).toThrow(NotFoundError);
    expect(() => core.events.readBefore(a.workspaceId, 10, 501)).toThrow(RangeError);
    expect(() => core.events.readBefore(a.workspaceId, 0, 10)).toThrow(RangeError);
  });
});
