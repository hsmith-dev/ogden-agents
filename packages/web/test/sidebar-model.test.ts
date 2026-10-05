import type { CoreEvent, Session, SessionState, Workspace } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { applyEvent, emptyStore, type EventStoreState } from '../src/events/event-store';
import { buildSidebar, diffForAnnouncements, EARLIER_AFTER_MS, holdOrder, relativeTime, type SidebarModel } from '../src/shell/sidebar-model';

/** Every chat here is Claude Code's (epic 6: the name comes from the agent list). */
const CLAUDE = () => 'Claude Code';

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
    const model = buildSidebar([B, A], sessions, store(waiting('ws_b', 'ses_b'), requested('ws_b', 'ses_b', 'req_1')), NOW, CLAUDE);
    expect(model.groups.map((g) => g.name)).toEqual(['Clay-and-kiln', 'Letterpress']);
    expect(rows(model, 'ws_a')).toEqual(['ses_a:working']);
    expect(rows(model, 'ws_b')).toEqual(['ses_b:waiting']);
    // A chat with no name and no message yet (backlog story 12).
    expect(model.groups[1]!.rows[0]!.title).toBe('New chat');
    expect(model.needsYou).toEqual([
      { id: 'req_1', kind: 'permission', chatName: 'New chat', wsId: 'ws_b', sesId: 'ses_b', workspaceName: 'Letterpress', text: 'Claude Code wants to run npm test', agentName: 'Claude Code', at: expect.any(String), request: 'run npm test' },
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
    const model = buildSidebar([A], sessions, emptyStore(), NOW, CLAUDE);
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

  it('a chat shows the user’s name, else its automatic name, and Needs you names it (backlog story 12)', () => {
    const named = { ...session('ses_b', 'ws_b', 'waiting', ago(3 * MINUTE)), autoTitle: 'Fix the login bug' } as Session;
    const model = buildSidebar([B], [named], emptyStore(), NOW, CLAUDE);
    expect(model.groups[0]!.rows[0]).toMatchObject({ title: 'Fix the login bug', userTitle: null });
    expect(model.needsYou[0]).toMatchObject({ chatName: 'Fix the login bug' });
    const renamed = buildSidebar([B], [{ ...named, title: 'Auth work' }], emptyStore(), NOW, CLAUDE);
    expect(renamed.groups[0]!.rows[0]).toMatchObject({ title: 'Auth work', userTitle: 'Auth work' });
  });

  it('a workspace with no chats still has its group', () => {
    const model = buildSidebar([A], [], emptyStore(), NOW, CLAUDE);
    expect(model.groups).toEqual([{ wsId: 'ws_a', name: 'Clay-and-kiln', rows: [], earlier: [], summary: [] }]);
  });

  it('resolved elsewhere: the request leaves Needs you', () => {
    const events = [waiting('ws_b', 'ses_b'), requested('ws_b', 'ses_b', 'req_1'), resolved('ws_b', 'ses_b', 'req_1')];
    const stateChanged = event('ws_b', 'ses_b', 'session.state_changed', { sessionId: 'ses_b', state: 'working', previous: 'waiting' });
    const model = buildSidebar([B], [session('ses_b', 'ws_b', 'working')], store(...events, stateChanged), NOW, CLAUDE);
    expect(model.needsYou).toEqual([]);
  });

  it('request outside the window: a waiting session still needs you, with the plain text', () => {
    const model = buildSidebar([B], [session('ses_b', 'ws_b', 'waiting', ago(3 * MINUTE))], emptyStore(), NOW, CLAUDE);
    expect(model.needsYou).toEqual([{ id: `waiting:ses_b:${ago(3 * MINUTE)}`, kind: 'waiting', chatName: 'New chat', wsId: 'ws_b', sesId: 'ses_b', workspaceName: 'Letterpress', text: 'Claude Code is waiting for you', agentName: 'Claude Code', at: ago(3 * MINUTE) }]);
  });

  it('a working agent that checked in needs you, without naming what it waits on, until anything else happens', () => {
    const checkIn = event('ws_b', 'ses_b', 'session.check_in', { sessionId: 'ses_b', waitingOn: 'Run cat ~/.ssh/id_rsa' }, ago(2 * MINUTE));
    const titled = session('ses_b', 'ws_b', 'working', ago(MINUTE), 'Refunds');
    const model = buildSidebar([B], [titled], store(checkIn), NOW, CLAUDE);
    expect(model.needsYou).toEqual([
      { id: `check_in:ses_b:${ago(2 * MINUTE)}`, kind: 'check_in', chatName: 'Refunds', wsId: 'ws_b', sesId: 'ses_b', workspaceName: 'Letterpress', text: 'Claude Code has been quiet for 10 minutes', agentName: 'Claude Code', at: ago(2 * MINUTE) },
    ]);
    const delta = event('ws_b', 'ses_b', 'session.message_delta', { messageId: 'm1', role: 'agent', text: 'back' });
    expect(buildSidebar([B], [titled], store(checkIn, delta), NOW, CLAUDE).needsYou).toEqual([]);
    // The session moved on (REST says idle): the check-in no longer stands.
    expect(buildSidebar([B], [session('ses_b', 'ws_b', 'idle')], store(checkIn), NOW, CLAUDE).needsYou).toEqual([]);
  });

  it('a new check-in in a chat already shown is said assertively, so sound is never the only signal', () => {
    const titled = session('ses_b', 'ws_b', 'working');
    const before = buildSidebar([B], [titled], emptyStore(), NOW, CLAUDE);
    const checkIn = event('ws_b', 'ses_b', 'session.check_in', { sessionId: 'ses_b' });
    const after = buildSidebar([B], [titled], store(checkIn), NOW, CLAUDE);
    expect(diffForAnnouncements(before, after).assertive.map((a) => a.text)).toEqual(['Letterpress: Claude Code has been quiet for 10 minutes']);
  });

  it('a chat stopped until its agent signs in again needs you; another error does not', () => {
    const signIn = event('ws_b', 'ses_b', 'session.state_changed', { sessionId: 'ses_b', state: 'error', previous: 'working', reason: 'Sign in again', errorCode: 'auth_required' });
    const model = buildSidebar([B], [session('ses_b', 'ws_b', 'error')], store(signIn), NOW, CLAUDE);
    expect(model.needsYou).toMatchObject([{ id: `sign_in:ses_b:${signIn.seq}`, kind: 'sign_in', text: 'Claude Code needs you to sign in again' }]);
    const failed = event('ws_b', 'ses_b', 'session.state_changed', { sessionId: 'ses_b', state: 'error', previous: 'working', reason: 'It failed', errorCode: 'agent_failed' });
    expect(buildSidebar([B], [session('ses_b', 'ws_b', 'error')], store(failed), NOW, CLAUDE).needsYou).toEqual([]);
    expect(buildSidebar([B], [session('ses_b', 'ws_b', 'idle')], store(signIn), NOW, CLAUDE).needsYou).toEqual([]);
  });

  it('the window has the session but no state for it: a waiting session still gets the plain row', () => {
    const delta = event('ws_b', 'ses_b', 'session.message_delta', { messageId: 'm1', role: 'agent', text: 'x' });
    const model = buildSidebar([B], [session('ses_b', 'ws_b', 'waiting')], store(delta), NOW, CLAUDE);
    expect(model.needsYou.map((entry) => entry.text)).toEqual(['Claude Code is waiting for you']);
  });

  it('a transient waiting with no open request gets no row and no count: waiting before its request arrives', () => {
    const model = buildSidebar([B], [session('ses_b', 'ws_b', 'waiting')], store(waiting('ws_b', 'ses_b')), NOW, CLAUDE);
    expect(model.needsYou).toEqual([]);
  });

  it('a transient waiting with no open request gets no row and no count: the request answered before working arrives', () => {
    const events = [waiting('ws_b', 'ses_b'), requested('ws_b', 'ses_b', 'req_1'), resolved('ws_b', 'ses_b', 'req_1')];
    const model = buildSidebar([B], [session('ses_b', 'ws_b', 'waiting')], store(...events), NOW, CLAUDE);
    expect(model.needsYou).toEqual([]);
  });

  it('a request in the window whose waiting state is older than it (the state from REST) still counts', () => {
    const model = buildSidebar([B], [session('ses_b', 'ws_b', 'waiting')], store(requested('ws_b', 'ses_b', 'req_1', 'npm install stripe')), NOW, CLAUDE);
    expect(model.needsYou.map((entry) => entry.text)).toEqual(['Claude Code wants to run npm install stripe']);
  });

  it('Needs you is oldest first across workspaces', () => {
    const events = [
      waiting('ws_a', 'ses_a'),
      requested('ws_a', 'ses_a', 'req_new', 'npm run build', ago(MINUTE)),
      waiting('ws_b', 'ses_b'),
      requested('ws_b', 'ses_b', 'req_old', 'npm test', ago(10 * MINUTE)),
    ];
    const model = buildSidebar([A, B], [session('ses_a', 'ws_a', 'waiting'), session('ses_b', 'ws_b', 'waiting')], store(...events), NOW, CLAUDE);
    expect(model.needsYou.map((entry) => `${entry.workspaceName}: ${entry.text}`)).toEqual([
      'Letterpress: Claude Code wants to run npm test',
      'Clay-and-kiln: Claude Code wants to run npm run build',
    ]);
  });

  it('history deleted: with its sessions gone, the workspace has no rows and no items', () => {
    const deleted = event('ws_b', 'ws_b', 'workspace.history_deleted', {});
    const model = buildSidebar([B], [], store(waiting('ws_b', 'ses_b'), requested('ws_b', 'ses_b', 'req_1'), deleted), NOW, CLAUDE);
    expect(model.groups[0]!.rows).toEqual([]);
    expect(model.needsYou).toEqual([]);
  });
});

describe('holdOrder (EXPERIENCE.md Interaction Rules: nothing moves under the pointer)', () => {
  it('a change under the pointer updates the row in place; the new order applies once released', () => {
    const before = buildSidebar([A], [session('ses_1', 'ws_a', 'working'), session('ses_2', 'ws_a', 'idle')], emptyStore(), NOW, CLAUDE);
    const after = buildSidebar([A], [session('ses_1', 'ws_a', 'idle', ago(5 * MINUTE)), session('ses_2', 'ws_a', 'working')], emptyStore(), NOW, CLAUDE);
    expect(rows(after, 'ws_a')).toEqual(['ses_2:working', 'ses_1:idle']);
    const held = holdOrder(before, after);
    expect(rows(held, 'ws_a')).toEqual(['ses_1:idle', 'ses_2:working']);
  });

  it('appends new rows at the end, drops gone ones, and keeps a row in the section it was shown in', () => {
    const before = buildSidebar([A], [session('ses_1', 'ws_a', 'done', ago(EARLIER_AFTER_MS - MINUTE)), session('ses_2', 'ws_a', 'idle')], emptyStore(), NOW, CLAUDE);
    // A minute on, ses_1 would go under Earlier; ses_2 is gone; ses_3 is new and working.
    const after = buildSidebar([A], [session('ses_1', 'ws_a', 'done', ago(EARLIER_AFTER_MS - MINUTE)), session('ses_3', 'ws_a', 'working')], emptyStore(), NOW + 2 * MINUTE);
    expect(after.groups[0]!.earlier.map((r) => r.sesId)).toEqual(['ses_1']);
    const held = holdOrder(before, after);
    expect(rows(held, 'ws_a')).toEqual(['ses_1:done', 'ses_3:working']);
    expect(held.groups[0]!.earlier).toEqual([]);
  });

  it('keeps Needs you in place and appends new items', () => {
    const one = buildSidebar([A], [session('ses_a', 'ws_a', 'waiting')], store(waiting('ws_a', 'ses_a'), requested('ws_a', 'ses_a', 'req_2', 'b', ago(MINUTE))), NOW, CLAUDE);
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
    buildSidebar([A, B], Object.entries(states).map(([id, state]) => session(id, id === 'ses_b' ? 'ws_b' : 'ws_a', state)), store(...events), NOW, CLAUDE);

  it('a state change is polite, in words: "<workspace>: <title> is <state>"', () => {
    const changes = diffForAnnouncements(models({ ses_b: 'idle' }), models({ ses_b: 'working' }));
    expect(changes).toEqual({ polite: [{ sesId: 'ses_b', text: 'Letterpress: New chat is working' }], assertive: [] });
    expect(diffForAnnouncements(models({ ses_b: 'working' }), models({ ses_b: 'error' })).polite[0]!.text).toBe('Letterpress: New chat stopped with an error');
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
    const empty = buildSidebar([A, B], [], emptyStore(), NOW, CLAUDE);
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
