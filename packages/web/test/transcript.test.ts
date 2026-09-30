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
    expect(view).toEqual({ known: false, state: undefined, errorReason: undefined, messages: [] });
  });
});
