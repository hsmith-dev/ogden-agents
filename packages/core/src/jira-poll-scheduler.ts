/**
 * The Jira poll scheduler (epic 18 story 7; AD-27): *when* a linked
 * workspace syncs, never *how* — `sync` is the caller's full sync (resolve
 * the credential, fetch, write the local tree, record `lastSyncedAt`/
 * `lastSyncError`); this module only decides when to call it.
 *
 * AD-27's own rule, exactly: a fixed interval (default 5 minutes) runs
 * only while at least one tab is subscribed to that workspace's event
 * stream — not "any tab open anywhere" — starting on the first
 * subscription and stopping on the last one's end, so a project nobody is
 * viewing draws no Jira API quota; the Board's Refresh action runs the
 * same sync immediately, debounced to at most once every 10 seconds per
 * workspace. Unlike AD-3's sessions and runs, a Jira poll is a read-
 * through cache refresh that gains nothing from running unwatched, so it
 * deliberately does not survive every tab closing.
 *
 * This module does not itself know which workspaces are watched: the
 * actual signal comes from the server's WebSocket subscription layer
 * (AD-5), which this module has no dependency on. The caller (server
 * wiring, not yet built — see this story's plan) calls
 * {@link JiraPollScheduler.onWorkspaceWatched}/`onWorkspaceUnwatched` from
 * wherever that layer already tracks a workspace's subscriber count.
 */
import type { WorkspaceId } from '@ogden-agents/shared';

/** Default poll interval (AD-27): 5 minutes. */
export const JIRA_POLL_INTERVAL_MS = 5 * 60 * 1000;
/** Default Refresh debounce (AD-27): 10 seconds. */
export const JIRA_REFRESH_DEBOUNCE_MS = 10 * 1000;

export interface JiraPollSchedulerOptions {
  /** Runs one full sync for `workspaceId`. Rejects are caught and reported via `onSyncError`, never thrown onward (a failed sync must never stop the schedule, AD-27). */
  sync: (workspaceId: WorkspaceId) => Promise<void>;
  onSyncError?: (workspaceId: WorkspaceId, error: unknown) => void;
  intervalMs?: number;
  refreshDebounceMs?: number;
  /** Injectable for tests (vitest's fake timers); default the real globals. */
  setIntervalFn?: (callback: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearIntervalFn?: (handle: ReturnType<typeof setInterval>) => void;
  now?: () => number;
}

export interface JiraPollScheduler {
  /** A tab subscribed to `workspaceId`'s event stream: starts its poll timer if this is the first one. Safe to call again while already watched (a no-op). */
  onWorkspaceWatched(workspaceId: WorkspaceId): void;
  /** The last tab subscribed to `workspaceId` unsubscribed: stops its poll timer. Safe to call when not watched (a no-op). */
  onWorkspaceUnwatched(workspaceId: WorkspaceId): void;
  /** The Board's Refresh action: runs a sync now, debounced to at most once per `refreshDebounceMs` per workspace (a Refresh inside the debounce window is dropped, not queued — the one already running, or the one that just ran, already covers it). */
  refresh(workspaceId: WorkspaceId): Promise<void>;
  /** Whether `workspaceId` currently has an active poll timer (for tests and diagnostics). */
  isPolling(workspaceId: WorkspaceId): boolean;
  /** Stops every timer (server shutdown). */
  closeAll(): void;
}

export function createJiraPollScheduler(options: JiraPollSchedulerOptions): JiraPollScheduler {
  const intervalMs = options.intervalMs ?? JIRA_POLL_INTERVAL_MS;
  const refreshDebounceMs = options.refreshDebounceMs ?? JIRA_REFRESH_DEBOUNCE_MS;
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  const now = options.now ?? (() => Date.now());

  const timers = new Map<WorkspaceId, ReturnType<typeof setInterval>>();
  const lastRefreshAt = new Map<WorkspaceId, number>();

  const runSync = async (workspaceId: WorkspaceId): Promise<void> => {
    try {
      await options.sync(workspaceId);
    } catch (error) {
      options.onSyncError?.(workspaceId, error);
    }
  };

  return {
    onWorkspaceWatched(workspaceId) {
      if (timers.has(workspaceId)) return; // already polling: a second subscriber changes nothing
      const handle = setIntervalFn(() => {
        void runSync(workspaceId);
      }, intervalMs);
      timers.set(workspaceId, handle);
    },

    onWorkspaceUnwatched(workspaceId) {
      const handle = timers.get(workspaceId);
      if (handle === undefined) return;
      clearIntervalFn(handle);
      timers.delete(workspaceId);
    },

    async refresh(workspaceId) {
      const last = lastRefreshAt.get(workspaceId);
      const at = now();
      if (last !== undefined && at - last < refreshDebounceMs) return; // dropped: within the debounce window
      lastRefreshAt.set(workspaceId, at);
      await runSync(workspaceId);
    },

    isPolling(workspaceId) {
      return timers.has(workspaceId);
    },

    closeAll() {
      for (const handle of timers.values()) clearIntervalFn(handle);
      timers.clear();
    },
  };
}
