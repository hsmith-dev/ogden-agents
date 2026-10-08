/**
 * The Jira poll scheduler (epic 18 story 7; AD-27): polls only while
 * watched, stops the instant the last watcher goes, and debounces
 * Refresh. Fake timers throughout; no real clock or network.
 */
import type { WorkspaceId } from '@ogden-agents/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJiraPollScheduler, JIRA_POLL_INTERVAL_MS, JIRA_REFRESH_DEBOUNCE_MS } from '../src/jira-poll-scheduler.js';

const WS1 = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W1' as WorkspaceId;
const WS2 = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W2' as WorkspaceId;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setUp(overrides: Partial<Parameters<typeof createJiraPollScheduler>[0]> = {}) {
  const syncs: unknown[] = [];
  const errors: unknown[] = [];
  const scheduler = createJiraPollScheduler({
    sync: async (workspaceId) => {
      syncs.push(workspaceId);
    },
    onSyncError: (workspaceId, error) => errors.push({ workspaceId, error }),
    ...overrides,
  });
  return { scheduler, syncs, errors };
}

describe('onWorkspaceWatched / onWorkspaceUnwatched', () => {
  it('does not poll until a workspace is watched', () => {
    const { scheduler } = setUp();
    expect(scheduler.isPolling(WS1)).toBe(false);
    vi.advanceTimersByTime(JIRA_POLL_INTERVAL_MS * 3);
    expect(scheduler.isPolling(WS1)).toBe(false);
  });

  it('polls on the interval once watched, and stops the instant the last watcher goes', async () => {
    const { scheduler, syncs } = setUp();
    scheduler.onWorkspaceWatched(WS1);
    expect(scheduler.isPolling(WS1)).toBe(true);

    await vi.advanceTimersByTimeAsync(JIRA_POLL_INTERVAL_MS);
    expect(syncs).toEqual([WS1]);

    await vi.advanceTimersByTimeAsync(JIRA_POLL_INTERVAL_MS);
    expect(syncs).toEqual([WS1, WS1]);

    scheduler.onWorkspaceUnwatched(WS1);
    expect(scheduler.isPolling(WS1)).toBe(false);
    await vi.advanceTimersByTimeAsync(JIRA_POLL_INTERVAL_MS * 3);
    expect(syncs).toEqual([WS1, WS1]); // no more ticks after the last watcher left
  });

  it('a second watcher of the same workspace changes nothing (one timer, not two)', async () => {
    const { scheduler, syncs } = setUp();
    scheduler.onWorkspaceWatched(WS1);
    scheduler.onWorkspaceWatched(WS1); // a second tab
    await vi.advanceTimersByTimeAsync(JIRA_POLL_INTERVAL_MS);
    expect(syncs).toEqual([WS1]); // not twice
  });

  it('resumes polling, from a fresh interval, when watched again after stopping', async () => {
    const { scheduler, syncs } = setUp();
    scheduler.onWorkspaceWatched(WS1);
    scheduler.onWorkspaceUnwatched(WS1);
    scheduler.onWorkspaceWatched(WS1);
    expect(scheduler.isPolling(WS1)).toBe(true);
    await vi.advanceTimersByTimeAsync(JIRA_POLL_INTERVAL_MS);
    expect(syncs).toEqual([WS1]);
  });

  it('tracks each workspace independently', async () => {
    const { scheduler, syncs } = setUp();
    scheduler.onWorkspaceWatched(WS1);
    await vi.advanceTimersByTimeAsync(JIRA_POLL_INTERVAL_MS / 2);
    scheduler.onWorkspaceWatched(WS2);
    await vi.advanceTimersByTimeAsync(JIRA_POLL_INTERVAL_MS / 2);
    expect(syncs).toEqual([WS1]); // WS1's own interval elapsed; WS2's has not yet
    await vi.advanceTimersByTimeAsync(JIRA_POLL_INTERVAL_MS / 2);
    expect(syncs).toEqual([WS1, WS2]);
  });

  it('unwatching a workspace that was never watched is a no-op', () => {
    const { scheduler } = setUp();
    expect(() => scheduler.onWorkspaceUnwatched(WS1)).not.toThrow();
  });

  it('a sync failure is reported but never stops the schedule', async () => {
    const { scheduler, errors } = setUp({ sync: async () => Promise.reject(new Error('boom')) });
    scheduler.onWorkspaceWatched(WS1);
    await vi.advanceTimersByTimeAsync(JIRA_POLL_INTERVAL_MS);
    expect(errors).toHaveLength(1);
    expect(scheduler.isPolling(WS1)).toBe(true);
    await vi.advanceTimersByTimeAsync(JIRA_POLL_INTERVAL_MS);
    expect(errors).toHaveLength(2); // kept ticking, kept reporting
  });
});

describe('refresh', () => {
  it('runs a sync immediately', async () => {
    const { scheduler, syncs } = setUp();
    await scheduler.refresh(WS1);
    expect(syncs).toEqual([WS1]);
  });

  it('drops a second Refresh within the debounce window', async () => {
    const { scheduler, syncs } = setUp();
    await scheduler.refresh(WS1);
    await scheduler.refresh(WS1);
    expect(syncs).toEqual([WS1]);
  });

  it('allows a Refresh again once the debounce window passes', async () => {
    const { scheduler, syncs } = setUp();
    await scheduler.refresh(WS1);
    vi.advanceTimersByTime(JIRA_REFRESH_DEBOUNCE_MS + 1);
    await scheduler.refresh(WS1);
    expect(syncs).toEqual([WS1, WS1]);
  });

  it('debounces independently per workspace', async () => {
    const { scheduler, syncs } = setUp();
    await scheduler.refresh(WS1);
    await scheduler.refresh(WS2);
    expect(syncs).toEqual([WS1, WS2]);
  });

  it('works whether or not the workspace is also being polled on the interval', async () => {
    const { scheduler, syncs } = setUp();
    scheduler.onWorkspaceWatched(WS1);
    await scheduler.refresh(WS1);
    expect(syncs).toEqual([WS1]);
  });
});

describe('closeAll', () => {
  it('stops every timer', async () => {
    const { scheduler, syncs } = setUp();
    scheduler.onWorkspaceWatched(WS1);
    scheduler.onWorkspaceWatched(WS2);
    scheduler.closeAll();
    expect(scheduler.isPolling(WS1)).toBe(false);
    expect(scheduler.isPolling(WS2)).toBe(false);
    await vi.advanceTimersByTimeAsync(JIRA_POLL_INTERVAL_MS * 2);
    expect(syncs).toEqual([]);
  });
});
