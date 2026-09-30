import type { CoreEvent } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { sessionView } from '../src/chat/transcript';

const at = '2026-09-30T00:00:00.000Z';
let seq = 0;
const event = (type: string, payload: unknown, streamId = 'ses_1') =>
  ({ id: `evt_${++seq}`, seq, at, workspaceId: 'ws_1', streamId, type, payload }) as unknown as CoreEvent;

const created = (state = 'idle') => event('session.created', { session: { id: 'ses_1', state } });
const stateChanged = (state: string, previous: string, reason?: string) =>
  event('session.state_changed', { sessionId: 'ses_1', state, previous, ...(reason === undefined ? {} : { reason }) });
const delta = (messageId: string, text: string) => event('session.message_delta', { messageId, role: 'agent', text });
const completed = (messageId: string, role: string, content: string) => event('session.message_completed', { messageId, role, content });

describe('sessionView', () => {
  it('streams the reply from its deltas while working, then shows the completed message when idle', () => {
    const working = [created(), completed('u1', 'user', 'Say hello'), stateChanged('working', 'idle'), delta('a1', 'Hel'), delta('a1', 'lo')];
    const during = sessionView(working, 'ses_1');
    expect(during).toMatchObject({ known: true, state: 'working' });
    expect(during.messages).toEqual([
      { messageId: 'u1', role: 'user', text: 'Say hello', streaming: false },
      { messageId: 'a1', role: 'agent', text: 'Hello', streaming: true },
    ]);

    const after = sessionView([...working, completed('a1', 'agent', 'Hello!'), stateChanged('idle', 'working')], 'ses_1');
    expect(after.state).toBe('idle');
    expect(after.messages.at(-1)).toEqual({ messageId: 'a1', role: 'agent', text: 'Hello!', streaming: false });
  });

  it('carries the plain reason of an error, and forgets it once the session recovers', () => {
    const failed = [created(), stateChanged('working', 'idle'), stateChanged('error', 'working', 'Claude Code stopped unexpectedly.')];
    expect(sessionView(failed, 'ses_1')).toMatchObject({ state: 'error', errorReason: 'Claude Code stopped unexpectedly.' });
    expect(sessionView([...failed, stateChanged('working', 'error')], 'ses_1').errorReason).toBeUndefined();
  });

  it("ignores other sessions' events, and knows nothing of a session it never saw created", () => {
    const view = sessionView([event('session.message_delta', { messageId: 'x', role: 'agent', text: 'other' }, 'ses_2')], 'ses_1');
    expect(view).toEqual({ known: false, state: undefined, errorReason: undefined, messages: [], items: [], pendingPermissions: [] });
  });
});

const requested = (requestId: string, command = 'npm test', scope: unknown = { kind: 'command_prefix', value: 'npm test', label: 'npm test' }) =>
  event('permission.requested', {
    sessionId: 'ses_1',
    requestId,
    toolCall: { toolCallId: `t-${requestId}`, title: `Run ${command}`, kind: 'execute', command },
    alwaysAllowScope: scope,
    cautionLevel: 'ask_every_time',
  });
const resolved = (requestId: string, decision: string, by: string, extra: Record<string, unknown> = {}) =>
  event('permission.resolved', { sessionId: 'ses_1', requestId, decision, by, ...extra });

describe('sessionView: permission requests (story 2.6)', () => {
  it('folds a request in order among the messages, pending while the session waits', () => {
    const events = [created(), completed('u1', 'user', 'Run the tests'), stateChanged('working', 'idle'), requested('p1'), stateChanged('waiting', 'working')];
    const view = sessionView(events, 'ses_1');
    expect(view.items.map((item) => item.type)).toEqual(['message', 'permission']);
    expect(view.pendingPermissions.map((p) => p.requestId)).toEqual(['p1']);
    expect(view.pendingPermissions[0]).toMatchObject({
      status: 'pending',
      toolCall: { command: 'npm test', kind: 'execute' },
      scope: { value: 'npm test' },
      cautionLevel: 'ask_every_time',
      resolution: undefined,
    });
  });

  it('a decision resolves it with its reason; the reply after it follows in order', () => {
    const events = [
      created(),
      stateChanged('working', 'idle'),
      requested('p1'),
      stateChanged('waiting', 'working'),
      resolved('p1', 'deny', 'user', { reason: 'Not now' }),
      stateChanged('working', 'waiting'),
      completed('a1', 'agent', 'Denied npm test.'),
      stateChanged('idle', 'working'),
    ];
    const view = sessionView(events, 'ses_1');
    expect(view.items.map((item) => (item.type === 'message' ? item.message.text : item.type === 'permission' ? item.permission.requestId : item.type))).toEqual(['p1', 'Denied npm test.']);
    expect(view.pendingPermissions).toEqual([]);
    const [first] = view.items;
    expect(first?.type === 'permission' && first.permission).toMatchObject({ status: 'resolved', resolution: { decision: 'deny', by: 'user', reason: 'Not now' } });
  });

  it('a request with no answer once the session stopped waiting is unanswered (after a restart)', () => {
    const events = [created(), stateChanged('working', 'idle'), requested('p1'), stateChanged('waiting', 'working'), stateChanged('idle', 'waiting', 'Ogden Agents was restarted')];
    const view = sessionView(events, 'ses_1');
    expect(view.pendingPermissions).toEqual([]);
    const [item] = view.items;
    expect(item?.type === 'permission' && item.permission.status).toBe('unanswered');
  });

  it('knows a rule was undone from the workspace stream', () => {
    const events = [
      created(),
      stateChanged('working', 'idle'),
      requested('p1'),
      resolved('p1', 'allow_always', 'user', { ruleId: 'rule_1' }),
      requested('p2', 'npm test --watch'),
      resolved('p2', 'allow_once', 'rule', { ruleId: 'rule_1' }),
    ];
    const before = sessionView(events, 'ses_1');
    expect(before.items.map((item) => item.type === 'permission' && item.permission.resolution?.ruleRemoved)).toEqual([false, false]);
    const after = sessionView([...events, event('workspace.permission_rule_removed', { ruleId: 'rule_1' }, 'ws_1')], 'ses_1');
    expect(after.items.map((item) => item.type === 'permission' && item.permission.resolution?.ruleRemoved)).toEqual([true, true]);
  });
});

const resumed = (via: string) => event('session.resumed', { sessionId: 'ses_1', via });

describe('sessionView: resumed chats (story 2.7)', () => {
  it('puts the marker just before the user message that reopened the chat, for every way it came back', () => {
    for (const via of ['resumed', 'loaded', 'transcript']) {
      const events = [
        created(),
        completed('u1', 'user', 'First'),
        completed('a1', 'agent', 'Answer'),
        stateChanged('idle', 'working', 'Ogden Agents was restarted'),
        completed('u2', 'user', 'What did I say?'),
        stateChanged('working', 'idle'),
        resumed(via),
        delta('a2', 'You said'),
      ];
      const view = sessionView(events, 'ses_1');
      expect(view.items.map((item) => (item.type === 'message' ? item.message.messageId : item.type))).toEqual(['u1', 'a1', 'resumed', 'u2', 'a2']);
      expect(view.items[2]).toEqual({ type: 'resumed', via, at });
    }
  });

  it('shows one marker per reopen, and one with no user message before it at the end', () => {
    const events = [
      created(),
      completed('u1', 'user', 'One'),
      resumed('resumed'),
      completed('a1', 'agent', 'Answer'),
      completed('u2', 'user', 'Two'),
      resumed('transcript'),
    ];
    const view = sessionView(events, 'ses_1');
    expect(view.items.map((item) => item.type)).toEqual(['resumed', 'message', 'message', 'resumed', 'message']);
    expect(sessionView([created(), resumed('loaded')], 'ses_1').items).toEqual([{ type: 'resumed', via: 'loaded', at }]);
  });
});
