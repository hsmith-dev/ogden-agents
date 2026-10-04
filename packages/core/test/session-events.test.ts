/**
 * The session-event helper (E2-R7): the only way a session event is
 * appended. It stamps the session's workspace, refuses one naming another
 * workspace, stream or session, and the raw event log refuses them all.
 */
import type { NewCoreEvent } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { NotFoundError, SessionEventScopeError, type Core } from '../src/index.js';
import { openTestCore, tempDir } from './helpers.js';

function twoWorkspaces(core: Core) {
  const a = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
  const b = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
  const session = core.entities.createSession({ workspaceId: a.id, kind: 'chat' });
  const other = core.entities.createSession({ workspaceId: b.id, kind: 'chat' });
  return { a, b, session, other };
}

describe('appendSessionEvent', () => {
  it('stamps the session’s workspace and stream', () => {
    const core = openTestCore();
    const { a, session } = twoWorkspaces(core);
    const event = core.sessionEvents.appendSessionEvent(session.id, {
      type: 'session.message_delta',
      payload: { messageId: 'm1', role: 'agent', text: 'Hi' },
    });
    expect(event).toMatchObject({ type: 'session.message_delta', workspaceId: a.id, streamId: session.id });
    expect(core.events.readAfter(0, { workspaceId: a.id }).at(-1)).toEqual(event);
  });

  it('refuses an event constructed with another workspace’s id, storing nothing', () => {
    const core = openTestCore();
    const { b, session } = twoWorkspaces(core);
    const before = core.events.lastSeq();
    expect(() =>
      core.sessionEvents.appendSessionEvent(session.id, {
        type: 'session.message_delta',
        workspaceId: b.id,
        streamId: session.id,
        payload: { messageId: 'm1', role: 'agent', text: 'leak' },
      }),
    ).toThrow(SessionEventScopeError);
    expect(core.events.lastSeq()).toBe(before);
    expect(core.events.readAfter(before)).toEqual([]);
  });

  it('refuses another session’s stream, or a payload naming another session', () => {
    const core = openTestCore();
    const { session, other } = twoWorkspaces(core);
    const before = core.events.lastSeq();
    expect(() =>
      core.sessionEvents.appendSessionEvent(session.id, {
        type: 'session.message_delta',
        streamId: other.id,
        payload: { messageId: 'm1', role: 'agent', text: 'x' },
      }),
    ).toThrow(SessionEventScopeError);
    expect(() =>
      core.sessionEvents.appendSessionEvent(session.id, {
        type: 'session.state_changed',
        payload: { sessionId: other.id, state: 'working', previous: 'idle' },
      }),
    ).toThrow(SessionEventScopeError);
    expect(core.events.lastSeq()).toBe(before);
  });

  it('refuses an unknown session with NotFoundError, and a non-session event type', () => {
    const core = openTestCore();
    twoWorkspaces(core);
    expect(() =>
      core.sessionEvents.appendSessionEvent('ses_01J9Z3K4M5N6P7Q8R9S0T1V2W3', {
        type: 'session.message_delta',
        payload: { messageId: 'm1', role: 'agent', text: 'x' },
      }),
    ).toThrow(NotFoundError);
    const { session } = twoWorkspaces(core);
    expect(() =>
      core.sessionEvents.appendSessionEvent(session.id, { type: 'server.started', payload: { version: '1' } } as never),
    ).toThrow(SessionEventScopeError);
  });

  it('refuses a session.created whose session is another session, or names another workspace', () => {
    const core = openTestCore();
    const { b, session, other } = twoWorkspaces(core);
    const before = core.events.lastSeq();
    expect(() => core.sessionEvents.appendSessionEvent(session.id, { type: 'session.created', payload: { session: other } })).toThrow(SessionEventScopeError);
    expect(() =>
      core.sessionEvents.appendSessionEvent(session.id, { type: 'session.created', payload: { session: { ...session, workspaceId: b.id } } }),
    ).toThrow(SessionEventScopeError);
    expect(core.events.lastSeq()).toBe(before);
  });

  it('completeMessage is scoped the same way and prunes the message’s deltas', () => {
    const core = openTestCore();
    const { a, session } = twoWorkspaces(core);
    core.sessionEvents.appendSessionEvent(session.id, { type: 'session.message_delta', payload: { messageId: 'm1', role: 'agent', text: 'Hel' } });
    core.sessionEvents.appendSessionEvent(session.id, { type: 'session.message_delta', payload: { messageId: 'm1', role: 'agent', text: 'lo' } });
    const completed = core.sessionEvents.completeMessage(session.id, { messageId: 'm1', role: 'agent', content: 'Hello' });
    expect(completed).toMatchObject({ workspaceId: a.id, streamId: session.id });
    const types = core.events.readAfter(0, { workspaceId: a.id }).map((e) => e.type);
    expect(types).not.toContain('session.message_delta');
    expect(types.at(-1)).toBe('session.message_completed');
  });

  it('deleting a workspace’s history removes every one of its session events', () => {
    const core = openTestCore();
    const { a, b, session, other } = twoWorkspaces(core);
    core.sessionEvents.appendSessionEvent(session.id, { type: 'session.message_delta', payload: { messageId: 'm1', role: 'agent', text: 'a' } });
    core.sessionEvents.appendSessionEvent(other.id, { type: 'session.message_delta', payload: { messageId: 'm2', role: 'agent', text: 'b' } });
    core.events.deleteWorkspaceHistory(a.id);
    const left = core.events.readAfter(0).filter((e) => e.type.startsWith('session.'));
    expect(left.every((e) => e.workspaceId === b.id)).toBe(true);
    expect(left.some((e) => e.streamId === session.id)).toBe(false);
  });
});

describe('permission events through the helper', () => {
  it('stamps the session’s workspace and stream, and refuses a payload naming another session', () => {
    const core = openTestCore();
    const { a, session, other } = twoWorkspaces(core);
    const requested = core.sessionEvents.appendSessionEvent(session.id, {
      type: 'permission.requested',
      payload: {
        sessionId: session.id,
        requestId: 'req-1',
        toolCall: { toolCallId: 't1', title: 'Run npm test', kind: 'execute', command: 'npm test' },
        alwaysAllowScope: { kind: 'command_prefix', value: 'npm test', label: 'npm test in this project' },
        cautionLevel: 'ask_every_time',
      },
    });
    expect(requested).toMatchObject({ type: 'permission.requested', workspaceId: a.id, streamId: session.id });
    const resolved = core.sessionEvents.appendSessionEvent(session.id, {
      type: 'permission.resolved',
      payload: { sessionId: session.id, requestId: 'req-1', decision: 'allow_once', by: 'user' },
    });
    expect(resolved).toMatchObject({ workspaceId: a.id, streamId: session.id });
    const before = core.events.lastSeq();
    expect(() =>
      core.sessionEvents.appendSessionEvent(session.id, {
        type: 'permission.resolved',
        payload: { sessionId: other.id, requestId: 'req-1', decision: 'deny', by: 'user' },
      }),
    ).toThrow(SessionEventScopeError);
    expect(core.events.lastSeq()).toBe(before);
  });

  it('deleting a workspace’s history removes its permission events too', () => {
    const core = openTestCore();
    const { a, session } = twoWorkspaces(core);
    core.sessionEvents.appendSessionEvent(session.id, {
      type: 'permission.resolved',
      payload: { sessionId: session.id, requestId: 'req-1', decision: 'deny', by: 'cancelled' },
    });
    core.events.deleteWorkspaceHistory(a.id);
    expect(core.events.readAfter(0).some((e) => e.type.startsWith('permission.'))).toBe(false);
  });
});

describe('the raw event log', () => {
  it('refuses every session.* and permission.* event, even one with the right workspace, and stores nothing', () => {
    const core = openTestCore();
    const { a, session } = twoWorkspaces(core);
    const before = core.events.lastSeq();
    const raw: NewCoreEvent[] = [
      { type: 'session.message_delta', workspaceId: a.id, streamId: session.id, payload: { messageId: 'm1', role: 'agent', text: 'x' } },
      { type: 'session.message_completed', workspaceId: a.id, streamId: session.id, payload: { messageId: 'm1', role: 'agent', content: 'x' } },
      { type: 'session.state_changed', workspaceId: a.id, streamId: session.id, payload: { sessionId: session.id, state: 'working', previous: 'idle' } },
      { type: 'session.created', workspaceId: a.id, streamId: session.id, payload: { session } },
      {
        type: 'permission.requested',
        workspaceId: a.id,
        streamId: session.id,
        payload: {
          sessionId: session.id,
          requestId: 'req-1',
          toolCall: { toolCallId: 't1', title: 'Run npm test', kind: 'execute', command: 'npm test' },
          alwaysAllowScope: null,
          cautionLevel: 'ask_every_time',
        },
      },
      {
        type: 'permission.resolved',
        workspaceId: a.id,
        streamId: session.id,
        payload: { sessionId: session.id, requestId: 'req-1', decision: 'deny', by: 'user' },
      },
    ];
    for (const event of raw) expect(() => core.events.append(event)).toThrow(SessionEventScopeError);
    expect(core.events.lastSeq()).toBe(before);
  });

  it('does not expose a completeMessage around the helper', () => {
    const core = openTestCore();
    expect('completeMessage' in core.events).toBe(false);
  });
});
