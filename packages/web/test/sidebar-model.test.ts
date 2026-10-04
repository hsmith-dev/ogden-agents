import type { CoreEvent, Session, SessionState, Workspace } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { applyEvent, emptyStore, type EventStoreState } from '../src/events/event-store';
import { buildSidebar, diffForAnnouncements, EARLIER_AFTER_MS, holdOrder, relativeTime, type SidebarModel } from '../src/shell/sidebar-model';

const NOW = Date.parse('2026-09-30T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MINUTE = 60_000;

const workspace = (id: string, name: string, createdAt: string): Workspace =>
  ({ id, path: `/Users/sam/${name}`.toLowerCase(), realPath: `/Users/sam/${name}`, createdAt }) as Workspace;

const session = (id: string, workspaceId: string, state: SessionState, updatedAt = ago(MINUTE), title: string | null = null): Session =>
  ({ id, workspaceId, kind: 'chat', state, driver: 'ui', title, adapterRefs: {}, createdAt: ago(60 * MINUTE), updatedAt }) as unknown as Session;

let seq = 0;
const event = (workspaceId: string, streamId: string, type: string, payload: Record<string, unknown>, at = ago(MINUTE)) =>
  ({ id: `evt_${++seq}`, seq, at, workspaceId, streamId, type, payload }) as unknown as CoreEvent;
const requested = (ws: string, ses: string, requestId: string, command = 'npm test', at = ago(MINUTE)) =>
  event(ws, ses, 'permission.requested', {
    sessionId: ses,
    requestId,
    toolCall: { toolCallId: `t-${requestId}`, title: `Run ${command}`, kind: 'execute', command },
    alwaysAllowScope: null,
    cautionLevel: 'ask_every_time',
  }, at);
const waiting = (ws: string, ses: string) => event(ws, ses, 'session.state_changed', { sessionId: ses, state: 'waiting', previous: 'working' });
const resolved = (ws: string, ses: string, requestId: string) =>
  event(ws, ses, 'permission.resolved', { sessionId: ses, requestId, decision: 'allow_once', by: 'user' });
const store = (...events: CoreEvent[]): EventStoreState => events.reduce(applyEvent, emptyStore());

const A = workspace('ws_a', 'Clay-and-kiln', '2026-09-01T00:00:00.000Z');
const B = workspace('ws_b', 'Letterpress', '2026-09-02T00:00:00.000Z');

const rows = (model: SidebarModel, wsId: string) => model.groups.find((g) => g.wsId === wsId)!.rows.map((r) => `${r.sesId}:${r.state}`);

describe('buildSidebar (EXPERIENCE.md Status sidebar)', () => {
  it('two busy workspaces: both groups, in creation order, and Needs you names the request and its workspace', () => {
    const sessions = [session('ses_a', 'ws_a', 'working'), session('ses_b', 'ws_b', 'waiting')];
    const model = buildSidebar([B, A], sessions, store(waiting('ws_b', 'ses_b'), requested('ws_b', 'ses_b', 'req_1')), NOW);
    expect(model.groups.map((g) => g.name)).toEqual(['Clay-and-kiln', 'Letterpress']);
    expect(rows(model, 'ws_a')).toEqual(['ses_a:working']);
    expect(rows(model, 'ws_b')).toEqual(['ses_b:waiting']);
    expect(model.groups[1]!.rows[0]!.title).toBe('Chat');
    expect(model.needsYou).toEqual([
      { id: 'req_1', wsId: 'ws_b', sesId: 'ses_b', workspaceName: 'Letterpress', text: 'Claude Code wants to run npm test', at: expect.any(String), request: 'run npm test' },
    ]);
  });

  it('orders rows working, waiting, error, then idle, then done, and puts done older than a day under Earlier', () => {
    const sessions = [
      session('ses_idle', 'ws_a', 'idle'),
      session('ses_done_old', 'ws_a', 'done', ago(EARLIER_AFTER_MS + MINUTE)),
      session('ses_done', 'ws_a', 'done', ago(EARLIER_AFTER_MS - MINUTE)),
      session('ses_error', 'ws_a', 'error'),
      session('ses_waiting', 'ws_a', 'waiting'),
      session('ses_working_old', 'ws_a', 'working', ago(30 * MINUTE)),
      session('ses_working', 'ws_a', 'working', ago(2 * MINUTE)),
    ];
    const model = buildSidebar([A], sessions, emptyStore(), NOW);
    expect(rows(model, 'ws_a')).toEqual(['ses_working:working', 'ses_working_old:working', 'ses_waiting:waiting', 'ses_error:error', 'ses_idle:idle', 'ses_done:done']);
    expect(model.groups[0]!.earlier.map((r) => r.sesId)).toEqual(['ses_done_old']);
    // The collapsed summary: one count per non-zero state, Earlier included.
    expect(model.groups[0]!.summary).toEqual([
      { state: 'working', count: 2 },
      { state: 'waiting', count: 1 },
      { state: 'error', count: 1 },
      { state: 'idle', count: 1 },
      { state: 'done', count: 2 },
    ]);
  });

  it('a workspace with no chats still has its group', () => {
    const model = buildSidebar([A], [], emptyStore(), NOW);
    expect(model.groups).toEqual([{ wsId: 'ws_a', name: 'Clay-and-kiln', rows: [], earlier: [], summary: [] }]);
  });

  it('resolved elsewhere: the request leaves Needs you', () => {
    const events = [waiting('ws_b', 'ses_b'), requested('ws_b', 'ses_b', 'req_1'), resolved('ws_b', 'ses_b', 'req_1')];
    const stateChanged = event('ws_b', 'ses_b', 'session.state_changed', { sessionId: 'ses_b', state: 'working', previous: 'waiting' });
    const model = buildSidebar([B], [session('ses_b', 'ws_b', 'working')], store(...events, stateChanged), NOW);
    expect(model.needsYou).toEqual([]);
  });

  it('request outside the window: a waiting session still needs you, with the plain text', () => {
    const model = buildSidebar([B], [session('ses_b', 'ws_b', 'waiting', ago(3 * MINUTE))], emptyStore(), NOW);
    expect(model.needsYou).toEqual([{ id: 'ses_b', wsId: 'ws_b', sesId: 'ses_b', workspaceName: 'Letterpress', text: 'Claude Code is waiting for you', at: ago(3 * MINUTE) }]);
  });

  it('the window has the session but no state for it: a waiting session still gets the plain row', () => {
    const delta = event('ws_b', 'ses_b', 'session.message_delta', { messageId: 'm1', role: 'agent', text: 'x' });
    const model = buildSidebar([B], [session('ses_b', 'ws_b', 'waiting')], store(delta), NOW);
    expect(model.needsYou.map((entry) => entry.text)).toEqual(['Claude Code is waiting for you']);
  });

  it('a transient waiting with no open request gets no row and no count: waiting before its request arrives', () => {
    const model = buildSidebar([B], [session('ses_b', 'ws_b', 'waiting')], store(waiting('ws_b', 'ses_b')), NOW);
    expect(model.needsYou).toEqual([]);
  });

  it('a transient waiting with no open request gets no row and no count: the request answered before working arrives', () => {
    const events = [waiting('ws_b', 'ses_b'), requested('ws_b', 'ses_b', 'req_1'), resolved('ws_b', 'ses_b', 'req_1')];
    const model = buildSidebar([B], [session('ses_b', 'ws_b', 'waiting')], store(...events), NOW);
    expect(model.needsYou).toEqual([]);
  });

  it('a request in the window whose waiting state is older than it (the state from REST) still counts', () => {
    const model = buildSidebar([B], [session('ses_b', 'ws_b', 'waiting')], store(requested('ws_b', 'ses_b', 'req_1', 'npm install stripe')), NOW);
    expect(model.needsYou.map((entry) => entry.text)).toEqual(['Claude Code wants to run npm install stripe']);
  });

  it('Needs you is oldest first across workspaces', () => {
    const events = [
      waiting('ws_a', 'ses_a'),
      requested('ws_a', 'ses_a', 'req_new', 'npm run build', ago(MINUTE)),
      waiting('ws_b', 'ses_b'),
      requested('ws_b', 'ses_b', 'req_old', 'npm test', ago(10 * MINUTE)),
    ];
    const model = buildSidebar([A, B], [session('ses_a', 'ws_a', 'waiting'), session('ses_b', 'ws_b', 'waiting')], store(...events), NOW);
    expect(model.needsYou.map((entry) => `${entry.workspaceName}: ${entry.text}`)).toEqual([
      'Letterpress: Claude Code wants to run npm test',
      'Clay-and-kiln: Claude Code wants to run npm run build',
    ]);
  });

  it('history deleted: with its sessions gone, the workspace has no rows and no items', () => {
    const deleted = event('ws_b', 'ws_b', 'workspace.history_deleted', {});
    const model = buildSidebar([B], [], store(waiting('ws_b', 'ses_b'), requested('ws_b', 'ses_b', 'req_1'), deleted), NOW);
    expect(model.groups[0]!.rows).toEqual([]);
    expect(model.needsYou).toEqual([]);
  });
});

describe('holdOrder (EXPERIENCE.md Interaction Rules: nothing moves under the pointer)', () => {
  it('a change under the pointer updates the row in place; the new order applies once released', () => {
    const before = buildSidebar([A], [session('ses_1', 'ws_a', 'working'), session('ses_2', 'ws_a', 'idle')], emptyStore(), NOW);
    const after = buildSidebar([A], [session('ses_1', 'ws_a', 'idle', ago(5 * MINUTE)), session('ses_2', 'ws_a', 'working')], emptyStore(), NOW);
    expect(rows(after, 'ws_a')).toEqual(['ses_2:working', 'ses_1:idle']);
    const held = holdOrder(before, after);
    expect(rows(held, 'ws_a')).toEqual(['ses_1:idle', 'ses_2:working']);
  });

  it('appends new rows at the end, drops gone ones, and keeps a row in the section it was shown in', () => {
    const before = buildSidebar([A], [session('ses_1', 'ws_a', 'done', ago(EARLIER_AFTER_MS - MINUTE)), session('ses_2', 'ws_a', 'idle')], emptyStore(), NOW);
    // A minute on, ses_1 would go under Earlier; ses_2 is gone; ses_3 is new and working.
    const after = buildSidebar([A], [session('ses_1', 'ws_a', 'done', ago(EARLIER_AFTER_MS - MINUTE)), session('ses_3', 'ws_a', 'working')], emptyStore(), NOW + 2 * MINUTE);
    expect(after.groups[0]!.earlier.map((r) => r.sesId)).toEqual(['ses_1']);
    const held = holdOrder(before, after);
    expect(rows(held, 'ws_a')).toEqual(['ses_1:done', 'ses_3:working']);
    expect(held.groups[0]!.earlier).toEqual([]);
  });

  it('keeps Needs you in place and appends new items', () => {
    const one = buildSidebar([A], [session('ses_a', 'ws_a', 'waiting')], store(waiting('ws_a', 'ses_a'), requested('ws_a', 'ses_a', 'req_2', 'b', ago(MINUTE))), NOW);
    const two = buildSidebar(
      [A],
      [session('ses_a', 'ws_a', 'waiting')],
      store(waiting('ws_a', 'ses_a'), requested('ws_a', 'ses_a', 'req_2', 'b', ago(MINUTE)), requested('ws_a', 'ses_a', 'req_1', 'a', ago(9 * MINUTE))),
      NOW,
    );
    expect(two.needsYou.map((e) => e.id)).toEqual(['req_1', 'req_2']);
    expect(holdOrder(one, two).needsYou.map((e) => e.id)).toEqual(['req_2', 'req_1']);
  });
});

describe('diffForAnnouncements (EXPERIENCE.md Accessibility Floor)', () => {
  const models = (states: Record<string, SessionState>, events: CoreEvent[] = []) =>
    buildSidebar([A, B], Object.entries(states).map(([id, state]) => session(id, id === 'ses_b' ? 'ws_b' : 'ws_a', state)), store(...events), NOW);

  it('a state change is polite, in words: "<workspace>: <title> is <state>"', () => {
    const changes = diffForAnnouncements(models({ ses_b: 'idle' }), models({ ses_b: 'working' }));
    expect(changes).toEqual({ polite: [{ sesId: 'ses_b', text: 'Letterpress: Chat is working' }], assertive: [] });
    expect(diffForAnnouncements(models({ ses_b: 'working' }), models({ ses_b: 'error' })).polite[0]!.text).toBe('Letterpress: Chat stopped with an error');
  });

  it('a new request in a session already shown is assertive, once; moving to waiting is not also polite', () => {
    const before = models({ ses_b: 'working' });
    const after = models({ ses_b: 'waiting' }, [waiting('ws_b', 'ses_b'), requested('ws_b', 'ses_b', 'req_1')]);
    expect(diffForAnnouncements(before, after)).toEqual({
      polite: [],
      assertive: [{ id: 'req_1', sesId: 'ses_b', text: 'Claude Code is waiting for you: run npm test' }],
    });
    expect(diffForAnnouncements(after, after)).toEqual({ polite: [], assertive: [] });
  });

  it('sessions and requests that only appeared (a list loading, a backlog) say nothing', () => {
    const empty = buildSidebar([A, B], [], emptyStore(), NOW);
    const loaded = models({ ses_a: 'working', ses_b: 'waiting' }, [waiting('ws_b', 'ses_b'), requested('ws_b', 'ses_b', 'req_1')]);
    expect(diffForAnnouncements(empty, loaded)).toEqual({ polite: [], assertive: [] });
  });
});

describe('relativeTime', () => {
  it('is short: now, minutes, hours, days', () => {
    expect(relativeTime(ago(20_000), NOW)).toBe('now');
    expect(relativeTime(ago(5 * MINUTE), NOW)).toBe('5m');
    expect(relativeTime(ago(3 * 60 * MINUTE), NOW)).toBe('3h');
    expect(relativeTime(ago(49 * 60 * MINUTE), NOW)).toBe('2d');
    // A clock a little behind the server's never shows a negative time.
    expect(relativeTime(ago(-MINUTE), NOW)).toBe('now');
  });
});
