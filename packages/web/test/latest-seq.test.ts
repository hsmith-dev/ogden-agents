/** Story 11.2: the refetch trigger of a run query follows the newest event, so a trimmed old event cannot hide a new one. */
import { describe, expect, it } from 'vitest';
import { latestSeq } from '../src/planning/builds-api';

const event = (seq: number, type: string) => ({ seq, type, workspaceId: 'ws_1' }) as never;
const matches = (e: { type: string }) => e.type.startsWith('run.');

describe('latestSeq', () => {
  it('moves with the newest matching event even when the count does not', () => {
    // run.created was trimmed as run.outcome_changed arrived: one matching event before and after.
    expect(latestSeq([event(6, 'run.created')], matches)).toBe(6);
    expect(latestSeq([event(18, 'run.outcome_changed')], matches)).toBe(18);
    expect(latestSeq([event(7, 'session.state_changed')], matches)).toBe(0);
    expect(latestSeq([], matches)).toBe(0);
  });
});
