import type { CoreEvent, Session, Workspace } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import {
  applyCaughtUp,
  applyEvent,
  applyEvents,
  applyHistoryPage,
  beginConnection,
  emptyStore,
  MAX_LIVE_EVENTS,
  mergedEvents,
  pageCursor,
  streamEvents,
  trimWorkspaces,
  type EventStoreState,
} from '../src/events/event-store';
import { buildSidebar } from '../src/shell/sidebar-model';

const at = '2026-09-30T00:00:00.000Z';

const started = (seq: number) => ({ id: `evt_${seq}`, seq, at, workspaceId: null, streamId: 'server', type: 'server.started', payload: { version: '1' } }) as unknown as CoreEvent;
const created = (seq: number, ws: string) =>
  ({ id: `evt_${seq}`, seq, at, workspaceId: ws, streamId: ws, type: 'workspace.created', payload: { workspace: { id: ws } } }) as unknown as CoreEvent;
const delta = (seq: number, ws: string, ses: string, messageId = `m${seq}`) =>
  ({ id: `evt_${seq}`, seq, at, workspaceId: ws, streamId: ses, type: 'session.message_delta', payload: { messageId, role: 'agent', text: 'x' } }) as unknown as CoreEvent;
const completed = (seq: number, ws: string, ses: string, messageId: string) =>
  ({ id: `evt_${seq}`, seq, at, workspaceId: ws, streamId: ses, type: 'session.message_completed', payload: { messageId, role: 'agent', content: 'x' } }) as unknown as CoreEvent;
const stateChanged = (seq: number, ws: string, ses: string, state: string) =>
  ({ id: `evt_${seq}`, seq, at, workspaceId: ws, streamId: ses, type: 'session.state_changed', payload: { sessionId: ses, state, previous: 'idle' } }) as unknown as CoreEvent;
const requested = (seq: number, ws: string, ses: string, requestId: string) =>
  ({
    id: `evt_${seq}`,
    seq,
    at,
    workspaceId: ws,
    streamId: ses,
    type: 'permission.requested',
    payload: { sessionId: ses, requestId, toolCall: { toolCallId: `t-${requestId}`, title: 'Run npm test', kind: 'execute', command: 'npm test' }, alwaysAllowScope: null, cautionLevel: 'ask_every_time' },
  }) as unknown as CoreEvent;
const resolved = (seq: number, ws: string, ses: string, requestId: string) =>
  ({ id: `evt_${seq}`, seq, at, workspaceId: ws, streamId: ses, type: 'permission.resolved', payload: { sessionId: ses, requestId, decision: 'allow_once', by: 'user' } }) as unknown as CoreEvent;
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

describe('event store at scale (story 2.10)', () => {
  it('a batch applies like one event at a time, copying each touched list once and leaving the others as they were', () => {
    const state = loaded();
    const batch = [delta(13, 'ws_a', 'ses_1', 'live'), delta(14, 'ws_a', 'ses_1', 'live'), created(15, 'ws_c'), completed(16, 'ws_a', 'ses_1', 'live'), delta(12, 'ws_a', 'ses_2')];
    const batched = applyEvents(state, batch);
    expect(batched).toEqual(apply(state, ...batch));
    expect(streamEvents(batched, 'ws_a', 'ses_2')).toBe(streamEvents(state, 'ws_a', 'ses_2'));
    expect(batched.workspaces.get('ws_b')).toBe(state.workspaces.get('ws_b'));
    expect(seqs(streamEvents(batched, 'ws_a', 'ses_1'))).toEqual([10, 16]);
    // The old state is untouched.
    expect(seqs(streamEvents(state, 'ws_a', 'ses_1'))).toEqual([10]);
    // A thousand chunks of one reply in one batch: only that session's stream changes.
    const chunks = Array.from({ length: 1000 }, (_, i) => delta(100 + i, 'ws_a', 'ses_1', 'long'));
    const streamed = applyEvents(state, chunks);
    expect(streamEvents(streamed, 'ws_a', 'ses_1')).toHaveLength(1001);
    expect(streamEvents(streamed, 'ws_a', 'ses_2')).toBe(streamEvents(state, 'ws_a', 'ses_2'));
    expect(streamed.workspaces.get('ws_b')).toBe(state.workspaces.get('ws_b'));
  });

  /** ws_a: the newest state of ses_1 and ses_2, an open request, an answered one, the floor, then filler. */
  function longTab(filler: number) {
    let state = apply(emptyStore(), created(1, 'ws_a'));
    state = applyCaughtUp(state, { type: 'caught_up', scope: 'install', oldestSeq: 1, hasEarlier: false });
    const early = [
      deleted(10, 'ws_a'),
      stateChanged(11, 'ws_a', 'ses_1', 'working'),
      stateChanged(12, 'ws_a', 'ses_2', 'working'),
      requested(13, 'ws_a', 'ses_1', 'req_answered'),
      resolved(14, 'ws_a', 'ses_1', 'req_answered'),
      stateChanged(15, 'ws_a', 'ses_2', 'waiting'),
      requested(16, 'ws_a', 'ses_2', 'req_open'),
      stateChanged(17, 'ws_a', 'ses_1', 'idle'),
    ];
    const rest = Array.from({ length: filler }, (_, i) => delta(100 + i, 'ws_a', i % 2 === 0 ? 'ses_3' : 'ses_open', `m${i}`));
    state = applyEvents(state, [...early, ...rest]);
    return applyCaughtUp(state, { type: 'caught_up', scope: 'ws_a', oldestSeq: 10, hasEarlier: false });
  }

  it('trims a live list to its limit, oldest first, keeping the open stream, the newest state per session, open requests and the floor', () => {
    // Half the filler is the open stream, which is held: the other half is over the limit by 400.
    const state = longTab(2 * (MAX_LIVE_EVENTS + 400));
    const open = streamEvents(state, 'ws_a', 'ses_open');
    const trimmed = trimWorkspaces(state, new Set(['ws_a/ses_open']));
    const workspace = trimmed.workspaces.get('ws_a')!;
    const kept = seqs(workspace.events);
    // The open stream is whole, with the same array.
    expect(streamEvents(trimmed, 'ws_a', 'ses_open')).toBe(open);
    // Held: the floor, ses_1's newest state (17, not 11), ses_2's newest (15, not 12), the open request (16).
    expect(kept.filter((seq) => seq < 100)).toEqual([10, 15, 16, 17]);
    // The rest is ses_3's newest events: exactly the limit of events that may be trimmed.
    const ses3 = seqs(streamEvents(trimmed, 'ws_a', 'ses_3'));
    expect(kept.length - open.length - 4).toBe(MAX_LIVE_EVENTS);
    expect(ses3.at(-1)).toBe(seqs(streamEvents(state, 'ws_a', 'ses_3')).at(-1));
    expect(ses3.length).toBeLessThan(streamEvents(state, 'ws_a', 'ses_3').length);
    // Earlier history again, paged from just after the newest event trimmed: no gap.
    const cursor = pageCursor(trimmed, 'ws_a');
    expect(cursor.hasEarlier).toBe(true);
    const all = seqs(state.workspaces.get('ws_a')!.events);
    const dropped = all.filter((seq) => !kept.includes(seq));
    expect(Math.max(...dropped)).toBe(cursor.beforeSeq! - 1);
    expect(all.filter((seq) => seq >= cursor.beforeSeq!).every((seq) => kept.includes(seq))).toBe(true);
    // The open session goes on paging from where it was.
    expect(pageCursor(trimmed, 'ws_a', 'ses_open')).toEqual({ beforeSeq: 10, hasEarlier: false });
    // Under the limit: nothing changes.
    expect(trimWorkspaces(trimmed, new Set(['ws_a/ses_open']))).toBe(trimmed);
    expect(trimWorkspaces(longTab(10))).toEqual(longTab(10));
  });

  it('a trim leaves the sidebar as it was: the same states and the same Needs you', () => {
    const state = longTab(MAX_LIVE_EVENTS * 2);
    const workspace = { id: 'ws_a', path: '/r/clay', realPath: '/r/clay', createdAt: at } as unknown as Workspace;
    const session = (id: string, state: string) =>
      ({ id, workspaceId: 'ws_a', kind: 'chat', state, driver: 'ui', title: null, adapterRefs: {}, createdAt: at, updatedAt: at }) as unknown as Session;
    const sessions = [session('ses_1', 'idle'), session('ses_2', 'waiting')];
    const trimmed = trimWorkspaces(state);
    expect(trimmed.workspaces.get('ws_a')!.events.length).toBe(MAX_LIVE_EVENTS + 4);
    expect(buildSidebar([workspace], sessions, trimmed, Date.parse(at))).toEqual(buildSidebar([workspace], sessions, state, Date.parse(at)));
    expect(buildSidebar([workspace], sessions, trimmed, Date.parse(at)).needsYou.map((entry) => entry.id)).toEqual(['req_open']);
  });

  it('a stream that lost events to a trim pages again from the workspace cursor', () => {
    let state = longTab(MAX_LIVE_EVENTS + 10);
    state = applyHistoryPage(state, { workspaceId: 'ws_a', events: [], hasMore: true }, 'ses_3');
    expect(state.sessionCursors.has('ws_a/ses_3')).toBe(true);
    const trimmed = trimWorkspaces(state);
    expect(trimmed.sessionCursors.has('ws_a/ses_3')).toBe(false);
    expect(pageCursor(trimmed, 'ws_a', 'ses_3')).toEqual(pageCursor(trimmed, 'ws_a'));
  });

  it('a reset replaces the scope with its fresh window and starts its cursors again', () => {
    let state = loaded();
    state = applyHistoryPage(state, { workspaceId: 'ws_a', events: [delta(6, 'ws_a', 'ses_2')], hasMore: true }, 'ses_2');
    const other = state.workspaces.get('ws_b');
    state = beginConnection(state);
    // The window arrives (all after the gap), then caught_up with reset.
    state = applyEvents(state, [delta(900, 'ws_a', 'ses_1'), delta(901, 'ws_a', 'ses_4')]);
    state = applyCaughtUp(state, { type: 'caught_up', scope: 'ws_a', oldestSeq: 900, hasEarlier: true, reset: true });
    const workspace = state.workspaces.get('ws_a')!;
    expect(seqs(workspace.events)).toEqual([900, 901]);
    expect(seqs(streamEvents(state, 'ws_a', 'ses_1'))).toEqual([900]);
    expect(streamEvents(state, 'ws_a', 'ses_2')).toEqual([]);
    expect(workspace).toMatchObject({ caughtUp: true, synced: true, lastSeq: 901 });
    expect(pageCursor(state, 'ws_a')).toEqual({ beforeSeq: 900, hasEarlier: true });
    expect(pageCursor(state, 'ws_a', 'ses_2')).toEqual({ beforeSeq: 900, hasEarlier: true });
    // Show earlier works from the new cursor.
    state = applyHistoryPage(state, { workspaceId: 'ws_a', events: [delta(899, 'ws_a', 'ses_1')], hasMore: true }, 'ses_1');
    expect(seqs(streamEvents(state, 'ws_a', 'ses_1'))).toEqual([899, 900]);
    // Other scopes are untouched; the install scope resets the same way.
    expect(state.workspaces.get('ws_b')!.events).toBe(other!.events);
    state = applyEvents(state, [started(950)]);
    state = applyCaughtUp(state, { type: 'caught_up', scope: 'install', oldestSeq: 950, hasEarlier: true, reset: true });
    expect(seqs(state.install.events)).toEqual([950]);
    expect(state.install).toMatchObject({ oldestSeq: 950, hasEarlier: true, caughtUp: true });
  });

  it('held events never crowd out new ones: only events that may be trimmed count against the limit', () => {
    const removed = (seq: number) =>
      ({ id: `evt_${seq}`, seq, at, workspaceId: 'ws_a', streamId: 'ws_a', type: 'workspace.permission_rule_removed', payload: { ruleId: `rule_${seq}` } }) as unknown as CoreEvent;
    let state = apply(emptyStore(), created(1, 'ws_a'));
    // 10 held events (the open stream, and an undone rule), more than the limit of 5, then 20 others.
    const held = [...Array.from({ length: 9 }, (_, i) => delta(10 + i, 'ws_a', 'ses_open')), removed(19)];
    const others = Array.from({ length: 20 }, (_, i) => delta(100 + i, 'ws_a', 'ses_other'));
    state = applyEvents(state, [...held, ...others]);
    const keep = new Set(['ws_a/ses_open']);
    let trimmed = trimWorkspaces(state, keep, 5);
    expect(seqs(trimmed.workspaces.get('ws_a')!.events)).toEqual([...seqs(held), 115, 116, 117, 118, 119]);
    expect(seqs(streamEvents(trimmed, 'ws_a', 'ws_a'))).toEqual([19]);
    // A new event is kept, and the oldest other one goes.
    trimmed = trimWorkspaces(applyEvents(trimmed, [delta(200, 'ws_a', 'ses_other')]), keep, 5);
    expect(seqs(streamEvents(trimmed, 'ws_a', 'ses_other'))).toEqual([116, 117, 118, 119, 200]);
    // Under the limit once the held ones are left out: nothing changes.
    const few = applyEvents(apply(emptyStore(), created(1, 'ws_a')), [...held, ...others.slice(0, 3)]);
    expect(trimWorkspaces(few, keep, 5)).toBe(few);
  });
});

describe('terminal pane events survive trimming while the pane lives (epic 16, story 16.6)', () => {
  it('keeps a live pane\'s open and newest status however many chat events follow, and lets a closed pane go', async () => {
    const { applyEvents: apply, emptyStore: empty, MAX_LIVE_EVENTS: MAX, streamEvents: streams, trimWorkspaces: trim } = await import('../src/events/event-store');
    const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
    const paneEvent = (seq: number, type: string, payload: Record<string, unknown>) =>
      ({ id: `evt_01J9Z3K4M5N6P7Q8R9S0T1V2W${seq % 10}`, seq, at: '2026-10-05T12:00:00.000Z', type, workspaceId: WS, streamId: WS, payload }) as never;
    const chat = (seq: number) =>
      ({ id: `evt_01J9Z3K4M5N6P7Q8R9S0T1V2X${seq % 10}`, seq, at: '2026-10-05T12:00:00.000Z', type: 'session.message_delta', workspaceId: WS, streamId: 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W3', payload: { messageId: 'msg_1', text: 'x' } }) as never;
    const live = 'pan_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
    const gone = 'pan_01J9Z3K4M5N6P7Q8R9S0T1V2W4';
    const batch = [
      paneEvent(1, 'terminal.pane_opened', { paneId: live, launcherId: 'a', title: 'One' }),
      paneEvent(2, 'terminal.pane_status_changed', { paneId: live, status: 'needs_attention', previous: 'working' }),
      paneEvent(3, 'terminal.pane_opened', { paneId: gone, launcherId: 'a', title: 'Two' }),
      paneEvent(4, 'terminal.pane_closed', { paneId: gone, cause: 'user' }),
      ...Array.from({ length: MAX + 50 }, (_, i) => chat(10 + i)),
    ];
    const kept = streams(trim(apply(empty(), batch)), WS, WS).map((e) => e.seq);
    expect(kept).toEqual(expect.arrayContaining([1, 2]));
    expect(kept).not.toContain(3);
  });
});
