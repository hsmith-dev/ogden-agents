import type { CoreEvent } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { diffHunk, groupSummary, toolCallLabel } from '../src/chat/tool-call-row';
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
    expect(view).toEqual({
      known: false,
      state: undefined,
      errorReason: undefined,
      errorCode: undefined,
      messages: [],
      items: [],
      pendingPermissions: [],
      queued: [],
      notSent: [],
      checkIn: undefined,
      lastUserText: undefined,
    });
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

const queuedMessage = (messageId: string, content: string) => event('session.message_queued', { sessionId: 'ses_1', messageId, content });
const toolCall = (toolCallId: string, title: string, kind: string, status: string, diffs?: unknown) =>
  event('session.tool_call', { sessionId: 'ses_1', toolCallId, title, kind, status, ...(diffs === undefined ? {} : { diffs }) });
const toolCallUpdated = (toolCallId: string, title: string, kind: string, status: string, diffs?: unknown) =>
  event('session.tool_call_updated', { sessionId: 'ses_1', toolCallId, title, kind, status, ...(diffs === undefined ? {} : { diffs }) });
const checkIn = (waitingOn?: string) => event('session.check_in', { sessionId: 'ses_1', ...(waitingOn === undefined ? {} : { waitingOn }) });

describe('sessionView: session behaviour (story 2.10)', () => {
  it('groups consecutive tool calls into one item, keeps each call current, and the latest diffs when an update leaves them out', () => {
    const diff = [{ path: 'src/a.ts', oldText: 'a', newText: 'b' }];
    const view = sessionView(
      [
        created(),
        completed('u1', 'user', 'Change a'),
        stateChanged('working', 'idle'),
        toolCall('r1', 'Read src/a.ts', 'read', 'in_progress'),
        toolCallUpdated('r1', 'Read src/a.ts', 'read', 'completed'),
        toolCall('r2', 'Read src/b.ts', 'read', 'completed'),
        toolCall('e1', 'Edit src/a.ts', 'edit', 'in_progress', diff),
        toolCallUpdated('e1', 'Edit src/a.ts', 'edit', 'completed'),
        delta('a1', 'Done.'),
        toolCall('r3', 'Read src/c.ts', 'read', 'completed'),
      ],
      'ses_1',
    );
    expect(view.items.map((item) => item.type)).toEqual(['message', 'tools', 'message', 'tools']);
    const first = view.items[1]!;
    expect(first.type === 'tools' && first.calls.map((call) => [call.toolCallId, call.status])).toEqual([
      ['r1', 'completed'],
      ['r2', 'completed'],
      ['e1', 'completed'],
    ]);
    expect(first.type === 'tools' && first.calls[2]!.diffs).toEqual(diff);
  });

  it('review F3: a late update with no title or kind never blanks a known row, and makes no row for an unknown call', () => {
    const view = sessionView(
      [
        created(),
        stateChanged('working', 'idle'),
        toolCall('r1', 'Read src/a.ts', 'read', 'in_progress'),
        toolCallUpdated('r1', '', 'other', 'completed'),
        toolCallUpdated('ghost', '', 'other', 'completed'),
      ],
      'ses_1',
    );
    const tools = view.items.filter((item) => item.type === 'tools');
    expect(tools).toHaveLength(1);
    expect(tools[0]!.type === 'tools' && tools[0]!.calls.map((call) => [call.toolCallId, call.title, call.kind, call.status])).toEqual([['r1', 'Read src/a.ts', 'read', 'completed']]);
  });

  it('holds a queued message apart until it is sent, then puts it where it was sent', () => {
    const base = [created(), completed('u1', 'user', 'First'), stateChanged('working', 'idle'), delta('a1', 'Working'), queuedMessage('u2', 'Second')];
    const during = sessionView(base, 'ses_1');
    expect(during.queued).toEqual([{ messageId: 'u2', role: 'user', text: 'Second', streaming: false, status: 'queued' }]);
    expect(during.items.map((item) => item.type === 'message' && item.message.messageId)).toEqual(['u1', 'a1']);
    expect(during.lastUserText).toBe('First');

    const sent = sessionView([...base, completed('a1', 'agent', 'Working done'), completed('u2', 'user', 'Second')], 'ses_1');
    expect(sent.queued).toEqual([]);
    expect(sent.notSent).toEqual([]);
    expect(sent.items.map((item) => item.type === 'message' && [item.message.messageId, item.message.status])).toEqual([
      ['u1', undefined],
      ['a1', undefined],
      ['u2', undefined],
    ]);
    expect(sent.lastUserText).toBe('Second');
  });

  it.each(['error', 'idle'])('marks what is still queued "Not sent" when the session goes %s first (an error, a Stop, a restart)', (state) => {
    const view = sessionView(
      [created(), completed('u1', 'user', 'First'), stateChanged('working', 'idle'), queuedMessage('u2', 'Second'), queuedMessage('u3', 'Third'), stateChanged(state, 'working')],
      'ses_1',
    );
    expect(view.queued).toEqual([]);
    expect(view.notSent.map((message) => [message.messageId, message.status])).toEqual([
      ['u2', 'not_sent'],
      ['u3', 'not_sent'],
    ]);
    expect(view.items.at(-1)).toMatchObject({ type: 'message', message: { messageId: 'u3', status: 'not_sent' } });
    // Try again resends the last message that was sent.
    expect(view.lastUserText).toBe('First');
  });

  it('Try again never resends a Deny reason core sent; the user’s own last message stays the one to resend (9.4 review F4)', () => {
    const view = sessionView(
      [
        created(),
        completed('u1', 'user', 'clean up'),
        stateChanged('working', 'idle'),
        event('session.message_completed', { messageId: 'u2', role: 'user', content: 'I denied "rm -rf build": Use the clean script.', origin: 'deny_reason' }),
        stateChanged('error', 'working', 'Claude Code needs you to sign in again.'),
      ],
      'ses_1',
    );
    expect(view.messages.map((message) => message.text)).toEqual(['clean up', 'I denied "rm -rf build": Use the clean script.']);
    expect(view.lastUserText).toBe('clean up');
  });

  it('keeps a message queued after a Stop already left waiting for idle, until it is sent', () => {
    const view = sessionView([created(), stateChanged('working', 'idle'), stateChanged('waiting', 'working'), stateChanged('idle', 'waiting'), queuedMessage('u2', 'After stop')], 'ses_1');
    expect(view.queued.map((message) => message.messageId)).toEqual(['u2']);
    expect(view.notSent).toEqual([]);
  });

  it('shows the latest check-in until anything else happens in the session, and only while working', () => {
    const quiet = [created(), stateChanged('working', 'idle'), toolCall('t1', 'Run npm run build', 'execute', 'in_progress'), checkIn('Run npm run build')];
    expect(sessionView(quiet, 'ses_1').checkIn).toMatchObject({ waitingOn: 'Run npm run build' });
    expect(sessionView([...quiet.slice(0, 3), checkIn()], 'ses_1').checkIn).toMatchObject({ waitingOn: undefined });
    expect(sessionView([...quiet, delta('a1', 'Built.')], 'ses_1').checkIn).toBeUndefined();
    // Another session's events do not clear it.
    expect(sessionView([...quiet, event('session.message_delta', { messageId: 'x', role: 'agent', text: 'other' }, 'ses_2')], 'ses_1').checkIn).toBeDefined();
    expect(sessionView([...quiet, stateChanged('idle', 'working')], 'ses_1').checkIn).toBeUndefined();
  });

  it('carries the error code of an error, for the notice', () => {
    const failed = [created(), stateChanged('working', 'idle'), event('session.state_changed', { sessionId: 'ses_1', state: 'error', previous: 'working', reason: 'Sign in again.', errorCode: 'auth_required' })];
    expect(sessionView(failed, 'ses_1')).toMatchObject({ state: 'error', errorCode: 'auth_required' });
    expect(sessionView([...failed, stateChanged('working', 'error')], 'ses_1').errorCode).toBeUndefined();
  });
});

describe('tool-call rows', () => {
  it('say a plain verb and the target, without repeating the verb in the agent’s title', () => {
    expect(toolCallLabel({ title: 'Read src/a.ts', kind: 'read', status: 'completed', diffs: undefined })).toEqual({ verb: 'Read', target: 'src/a.ts' });
    expect(toolCallLabel({ title: 'Edit src/a.ts', kind: 'edit', status: 'in_progress', diffs: undefined })).toEqual({ verb: 'Editing', target: 'src/a.ts' });
    expect(toolCallLabel({ title: 'Run npm test', kind: 'execute', status: 'completed', diffs: undefined })).toEqual({ verb: 'Ran', target: 'npm test' });
    expect(toolCallLabel({ title: 'Write', kind: 'edit', status: 'completed', diffs: [{ path: 'b.ts', oldText: null, newText: 'x' }] })).toEqual({ verb: 'Edited', target: 'b.ts' });
    expect(toolCallLabel({ title: 'Something new', kind: 'other', status: 'completed', diffs: undefined })).toEqual({ verb: undefined, target: 'Something new' });
  });

  it('sum a run up in one line, kinds in the order they came', () => {
    const kinds = (...list: string[]) => list.map((kind) => ({ kind }) as { kind: 'read' });
    expect(groupSummary(kinds('read', 'read', 'read', 'edit'))).toBe('Read 3 files, edited 1');
    expect(groupSummary(kinds('read', 'read', 'read', 'read', 'edit', 'edit'))).toBe('Read 4 files, edited 2');
    expect(groupSummary(kinds('execute', 'read'))).toBe('Ran 1 command, read 1 file');
  });

  it('show an edit as its hunk: the changed lines with a little context', () => {
    const before = ['one', 'two', 'three', 'four', 'five', 'six'].join('\n');
    const after = ['one', 'two', 'three', 'FOUR', 'five', 'six'].join('\n');
    expect(diffHunk(before, after)).toEqual([
      { mark: ' ', text: 'two' },
      { mark: ' ', text: 'three' },
      { mark: '-', text: 'four' },
      { mark: '+', text: 'FOUR' },
      { mark: ' ', text: 'five' },
      { mark: ' ', text: 'six' },
    ]);
    expect(diffHunk(null, 'new\nfile\n')).toEqual([
      { mark: '+', text: 'new' },
      { mark: '+', text: 'file' },
    ]);
  });
});

describe('sessionView message origin (story 3.6)', () => {
  it('carries origin terminal onto a message typed in the terminal, and it still counts as the last user message', () => {
    const view = sessionView(
      [
        created(),
        completed('u1', 'user', 'from the chat'),
        event('session.message_completed', { messageId: 'u2', role: 'user', content: 'typed in the terminal', origin: 'terminal' }),
        completed('a1', 'agent', 'reply'),
      ],
      'ses_1',
    );
    expect(view.messages.map((message) => message.origin)).toEqual([undefined, 'terminal', undefined]);
    expect(view.messages[0]).not.toHaveProperty('origin');
    expect(view.lastUserText).toBe('typed in the terminal');
  });
});

describe('document cards in the transcript (story 4.7)', () => {
  const written = (path: string, next: unknown = { skill: 'bmad-ticket', label: 'Turn this spec into tickets' }, toolCallId: string | null = 't1') =>
    event('session.document_written', { path, toolCallId, next });
  const toolCall = (toolCallId: string) => event('session.tool_call', { sessionId: 'ses_1', toolCallId, title: 'Write spec', kind: 'edit', status: 'completed' });

  it('folds a written document into a card after its tool call, with its next step', () => {
    const view = sessionView([created(), completed('u1', 'user', '/bmad-spec'), toolCall('t1'), written('_bmad-output/spec.md')], 'ses_1');
    expect(view.items.map((item) => item.type)).toEqual(['message', 'tools', 'document']);
    expect(view.items.at(-1)).toEqual({ type: 'document', path: '_bmad-output/spec.md', next: { skill: 'bmad-ticket', label: 'Turn this spec into tickets' }, toolCallId: 't1', at });
  });

  it('keeps one card per path, where the latest write happened; another path is its own card; next may be null', () => {
    const view = sessionView(
      [created(), written('_bmad-output/spec.md'), completed('a1', 'agent', 'Done.'), written('_bmad-output/other.md', null, null), written('_bmad-output/spec.md', null, 't9')],
      'ses_1',
    );
    expect(view.items.map((item) => (item.type === 'document' ? `${item.path}:${item.toolCallId ?? '-'}:${item.next?.skill ?? '-'}` : item.type))).toEqual([
      'message',
      '_bmad-output/other.md:-:-',
      '_bmad-output/spec.md:t9:-',
    ]);
  });

  it("ignores another session's documents", () => {
    expect(sessionView([created(), event('session.document_written', { path: 'x/a.md', toolCallId: null, next: null }, 'ses_2')], 'ses_1').items).toEqual([]);
  });
});
