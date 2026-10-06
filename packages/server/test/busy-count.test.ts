/**
 * What Quit and "Restart to update" wait for (story 5.8 review): sessions working or waiting, and build runs
 * still running whose session is not (the tests' re-run and the end checks), never a queued run.
 */
import type { Core } from '@ogden-agents/core';
import { describe, expect, it } from 'vitest';
import { countBusySessions } from '../src/start.js';

function core(sessions: Array<{ id: string; state: string }>, runs: Array<{ sessionId: string }>): Core {
  return {
    entities: {
      listWorkspaces: () => [{ id: 'ws_a' }],
      listSessions: () => sessions,
      listRunningRuns: () => runs,
    },
  } as unknown as Core;
}

describe('countBusySessions', () => {
  it('counts working and waiting sessions, once, and a running build whose session is idle', () => {
    expect(countBusySessions(core([], []))).toBe(0);
    expect(countBusySessions(core([{ id: 's1', state: 'working' }, { id: 's2', state: 'waiting' }, { id: 's3', state: 'idle' }], []))).toBe(2);
    // A build whose agent is working is one, not two.
    expect(countBusySessions(core([{ id: 's1', state: 'working' }], [{ sessionId: 's1' }]))).toBe(1);
    // The same build while the tests re-run: its session is idle, the run is not.
    expect(countBusySessions(core([{ id: 's1', state: 'idle' }], [{ sessionId: 's1' }]))).toBe(1);
  });
});
