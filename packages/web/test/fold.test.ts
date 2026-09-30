import type { CoreEvent } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { addEvent } from '../src/events/fold';

const at = '2026-09-29T00:00:00.000Z';
const base = { at, streamId: 'ses_1', workspaceId: 'ws_1' };

const delta = (seq: number, messageId: string, text: string) =>
  ({ ...base, id: `evt_${seq}`, seq, type: 'session.message_delta', payload: { messageId, role: 'agent', text } }) as unknown as CoreEvent;

describe('event fold (AD-5)', () => {
  it('a completed message replaces its own deltas only', () => {
    let events: CoreEvent[] = [];
    events = addEvent(events, delta(1, 'm1', 'Hel'));
    events = addEvent(events, delta(2, 'm2', 'Other'));
    events = addEvent(events, delta(3, 'm1', 'lo'));
    const completed = { ...base, id: 'evt_4', seq: 4, type: 'session.message_completed', payload: { messageId: 'm1', role: 'agent', text: 'Hello' } } as unknown as CoreEvent;
    events = addEvent(events, completed);
    expect(events.map((e) => e.seq)).toEqual([2, 4]);
  });

  it("a deleted workspace history drops that workspace's events", () => {
    let events: CoreEvent[] = [delta(1, 'm1', 'a'), { ...delta(2, 'm2', 'b'), workspaceId: 'ws_2' } as CoreEvent];
    const deleted = { ...base, id: 'evt_3', seq: 3, type: 'workspace.history_deleted', payload: {} } as unknown as CoreEvent;
    events = addEvent(events, deleted);
    expect(events.map((e) => e.seq)).toEqual([2, 3]);
  });
});
