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

const delta = (ids: { workspaceId: WorkspaceId; sessionId: SessionId }, messageId: string, text: string): NewCoreEvent => ({
  type: 'session.message_delta',
  workspaceId: ids.workspaceId,
  streamId: ids.sessionId,
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
    const newest = first.events.append(delta(ids, 'm1', 'x'));
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
    const other = core.events.append(delta(ids, 'm2', 'other message'));
    const deltas = ['Hel', 'lo, ', 'world'].map((text) => core.events.append(delta(ids, 'm1', text)));

    const completed = core.events.completeMessage({
      type: 'session.message_completed',
      workspaceId: ids.workspaceId,
      streamId: ids.sessionId,
      payload: { messageId: 'm1', role: 'agent', content: 'Hello, world' },
    });
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
    const first = core.events.append(delta(ids, 'm1', 'Hel'));
    core.events.append(delta(ids, 'm1', 'lo'));

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

    core.events.completeMessage({
      type: 'session.message_completed',
      workspaceId: ids.workspaceId,
      streamId: ids.sessionId,
      payload: { messageId: 'm1', role: 'agent', content: 'Hello' },
    });

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
    core.events.append(delta(ids, 'm1', 'a'));
    core.events.completeMessage({
      type: 'session.message_completed',
      workspaceId: ids.workspaceId,
      streamId: ids.sessionId,
      payload: { messageId: 'm1', role: 'agent', content: 'a' },
    });
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
