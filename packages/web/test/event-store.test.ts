import type { CoreEvent } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import {
  applyCaughtUp,
  applyEvent,
  applyHistoryPage,
  beginConnection,
  emptyStore,
  mergedEvents,
  pageCursor,
  streamEvents,
  type EventStoreState,
} from '../src/events/event-store';

const at = '2026-09-30T00:00:00.000Z';

const started = (seq: number) => ({ id: `evt_${seq}`, seq, at, workspaceId: null, streamId: 'server', type: 'server.started', payload: { version: '1' } }) as unknown as CoreEvent;
const created = (seq: number, ws: string) =>
  ({ id: `evt_${seq}`, seq, at, workspaceId: ws, streamId: ws, type: 'workspace.created', payload: { workspace: { id: ws } } }) as unknown as CoreEvent;
const delta = (seq: number, ws: string, ses: string, messageId = `m${seq}`) =>
  ({ id: `evt_${seq}`, seq, at, workspaceId: ws, streamId: ses, type: 'session.message_delta', payload: { messageId, role: 'agent', text: 'x' } }) as unknown as CoreEvent;
const completed = (seq: number, ws: string, ses: string, messageId: string) =>
  ({ id: `evt_${seq}`, seq, at, workspaceId: ws, streamId: ses, type: 'session.message_completed', payload: { messageId, role: 'agent', content: 'x' } }) as unknown as CoreEvent;
const deleted = (seq: number, ws: string) =>
  ({ id: `evt_${seq}`, seq, at, workspaceId: ws, streamId: ws, type: 'workspace.history_deleted', payload: {} }) as unknown as CoreEvent;

const apply = (state: EventStoreState, ...events: CoreEvent[]) => events.reduce(applyEvent, state);
const seqs = (events: readonly CoreEvent[]) => events.map((e) => e.seq);

/** Install events 1–3 (two workspaces created), then each workspace's window, caught up with earlier history. */
function loaded() {
  let state = apply(emptyStore(), started(1), created(2, 'ws_a'), created(3, 'ws_b'));
  state = applyCaughtUp(state, { type: 'caught_up', scope: 'install', oldestSeq: 1, hasEarlier: false });
  state = apply(state, delta(10, 'ws_a', 'ses_1'), delta(11, 'ws_b', 'ses_3'), delta(12, 'ws_a', 'ses_2'));
  state = applyCaughtUp(state, { type: 'caught_up', scope: 'ws_a', oldestSeq: 10, hasEarlier: true });
  state = applyCaughtUp(state, { type: 'caught_up', scope: 'ws_b', oldestSeq: 11, hasEarlier: true });
  return state;
}

describe('event store (E2-R8)', () => {
  it('keeps each scope apart and merges them in seq order, each event once', () => {
    let state = loaded();
    // A workspace window that includes its own workspace.created: still once, in the install scope.
    state = applyEvent(state, created(2, 'ws_a'));
    expect(seqs(state.install.events)).toEqual([1, 2, 3]);
    expect(seqs(state.workspaces.get('ws_a')!.events)).toEqual([10, 12]);
    expect(seqs(state.workspaces.get('ws_b')!.events)).toEqual([11]);
    expect(seqs(mergedEvents(state))).toEqual([1, 2, 3, 10, 11, 12]);
    // Memoized: the same lists give the same array.
    expect(mergedEvents(applyCaughtUp(state, { type: 'caught_up', scope: 'install' }))).toBe(mergedEvents(state));
  });

  it('ignores an event at or below its scope’s last seq, so a replayed backlog applies nothing twice', () => {
    const state = loaded();
    expect(apply(state, delta(10, 'ws_a', 'ses_1'), delta(12, 'ws_a', 'ses_2'), started(1))).toEqual(state);
    const next = applyEvent(state, delta(13, 'ws_a', 'ses_1'));
    expect(seqs(next.workspaces.get('ws_a')!.events)).toEqual([10, 12, 13]);
    expect(next.workspaces.get('ws_a')!.lastSeq).toBe(13);
  });

  it('a streamed chunk changes only its own session’s events, and a completed message replaces its deltas', () => {
    const state = loaded();
    const other = streamEvents(state, 'ws_a', 'ses_2');
    const otherWorkspace = streamEvents(state, 'ws_b', 'ses_3');
    const next = apply(state, delta(13, 'ws_a', 'ses_1', 'live'), delta(14, 'ws_a', 'ses_1', 'live'));
    expect(streamEvents(next, 'ws_a', 'ses_2')).toBe(other);
    expect(streamEvents(next, 'ws_b', 'ses_3')).toBe(otherWorkspace);
    expect(seqs(streamEvents(next, 'ws_a', 'ses_1'))).toEqual([10, 13, 14]);
    const done = applyEvent(next, completed(15, 'ws_a', 'ses_1', 'live'));
    expect(seqs(streamEvents(done, 'ws_a', 'ses_1'))).toEqual([10, 15]);
    expect(seqs(done.workspaces.get('ws_a')!.events)).toEqual([10, 12, 15]);
    expect(streamEvents(done, 'ws_a', 'ses_2')).toBe(other);
    expect(streamEvents(done, 'ws_a', 'ses_none')).toEqual([]);
  });

  it('prepends a page of older history, dedupes by seq, and moves the cursor', () => {
    let state = loaded();
    expect(pageCursor(state, 'ws_a')).toEqual({ beforeSeq: 10, hasEarlier: true });
    state = applyHistoryPage(state, { workspaceId: 'ws_a', events: [delta(5, 'ws_a', 'ses_1'), delta(7, 'ws_a', 'ses_2'), delta(10, 'ws_a', 'ses_1')], hasMore: true });
    expect(seqs(state.workspaces.get('ws_a')!.events)).toEqual([5, 7, 10, 12]);
    expect(seqs(streamEvents(state, 'ws_a', 'ses_1'))).toEqual([5, 10]);
    expect(pageCursor(state, 'ws_a')).toEqual({ beforeSeq: 5, hasEarlier: true });
    state = applyHistoryPage(state, { workspaceId: 'ws_a', events: [created(2, 'ws_a'), delta(4, 'ws_a', 'ses_1')], hasMore: false });
    expect(seqs(state.workspaces.get('ws_a')!.events)).toEqual([4, 5, 7, 10, 12]);
    expect(pageCursor(state, 'ws_a')).toEqual({ beforeSeq: 2, hasEarlier: false });
    expect(seqs(mergedEvents(state))).toEqual([1, 2, 3, 4, 5, 7, 10, 11, 12]);
  });

  it('pages one session on its own cursor, which starts at the workspace window', () => {
    let state = loaded();
    expect(pageCursor(state, 'ws_a', 'ses_2')).toEqual({ beforeSeq: 10, hasEarlier: true });
    state = applyHistoryPage(state, { workspaceId: 'ws_a', events: [delta(6, 'ws_a', 'ses_2')], hasMore: true }, 'ses_2');
    expect(pageCursor(state, 'ws_a', 'ses_2')).toEqual({ beforeSeq: 6, hasEarlier: true });
    expect(pageCursor(state, 'ws_a')).toEqual({ beforeSeq: 10, hasEarlier: true });
    expect(seqs(streamEvents(state, 'ws_a', 'ses_2'))).toEqual([6, 12]);
    // An empty page (such as another workspace's session): nothing earlier.
    state = applyHistoryPage(state, { workspaceId: 'ws_a', events: [], hasMore: false }, 'ses_2');
    expect(pageCursor(state, 'ws_a', 'ses_2')).toEqual({ beforeSeq: 6, hasEarlier: false });
  });

  it('a deleted history empties the workspace, resets its cursors, and a late page cannot bring it back', () => {
    let state = loaded();
    state = applyHistoryPage(state, { workspaceId: 'ws_a', events: [delta(6, 'ws_a', 'ses_2')], hasMore: true }, 'ses_2');
    const other = streamEvents(state, 'ws_b', 'ses_3');
    state = applyEvent(state, deleted(20, 'ws_a'));
    expect(seqs(state.workspaces.get('ws_a')!.events)).toEqual([20]);
    expect(streamEvents(state, 'ws_a', 'ses_1')).toEqual([]);
    expect(streamEvents(state, 'ws_b', 'ses_3')).toBe(other);
    expect(pageCursor(state, 'ws_a')).toEqual({ beforeSeq: 20, hasEarlier: false });
    expect(pageCursor(state, 'ws_a', 'ses_2')).toEqual({ beforeSeq: 20, hasEarlier: false });
    const late = applyHistoryPage(state, { workspaceId: 'ws_a', events: [delta(5, 'ws_a', 'ses_1')], hasMore: true });
    expect(late).toBe(state);
    // The install scope keeps the workspace's creation.
    expect(seqs(mergedEvents(state))).toEqual([1, 2, 3, 11, 20]);
  });

  it('a reconnect keeps the paging cursor, and drops a workspace whose window never finished', () => {
    let state = loaded();
    state = applyEvent(state, delta(30, 'ws_c', 'ses_9'));
    state = beginConnection(state);
    expect(state.install.caughtUp).toBe(false);
    expect(state.workspaces.get('ws_a')!.caughtUp).toBe(false);
    expect(state.workspaces.has('ws_c')).toBe(false);
    state = apply(state, delta(31, 'ws_a', 'ses_1'));
    state = applyCaughtUp(state, { type: 'caught_up', scope: 'ws_a', oldestSeq: 31, hasEarlier: true });
    expect(state.workspaces.get('ws_a')).toMatchObject({ caughtUp: true, oldestSeq: 10, hasEarlier: true, lastSeq: 31 });
  });

  it('an empty window has nothing earlier', () => {
    const state = applyCaughtUp(emptyStore(), { type: 'caught_up', scope: 'ws_a', oldestSeq: null, hasEarlier: false });
    expect(pageCursor(state, 'ws_a')).toEqual({ beforeSeq: null, hasEarlier: false });
    expect(pageCursor(state, 'ws_missing', 'ses_1')).toEqual({ beforeSeq: null, hasEarlier: false });
  });
});
