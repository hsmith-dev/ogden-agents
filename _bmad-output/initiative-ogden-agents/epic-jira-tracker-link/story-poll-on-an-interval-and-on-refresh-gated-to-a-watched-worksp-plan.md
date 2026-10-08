---
title: 'Poll on an interval and on Refresh, gated to a watched workspace'
type: 'feature'
ticket: '7'
created: '2026-10-07'
status: 'in-progress'
route: 'oneshot'
route_source: 'auto'
baseline_revision: '9bf59c72'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** AD-27 needs sync to run on a 5-minute interval only while a workspace is watched, plus an immediate, debounced Refresh — and no part of this epic decides *when* to sync yet (entries 5-6 built *what* a sync does).

**Approach:** `createJiraPollScheduler` (`packages/core`): a pure, timer-based scheduler taking an injected `sync` callback and exposing `onWorkspaceWatched`/`onWorkspaceUnwatched`/`refresh`/`closeAll`. It has no dependency on the real "is this workspace watched" signal, which lives in the server's WebSocket subscription layer — a capability that does not exist yet anywhere in this codebase (confirmed by searching for it) and is out of this entry's scope to build.

</frozen-after-approval>

## Code Map

- `packages/core/src/jira-poll-scheduler.ts` — the scheduler.
- Searched and confirmed absent: no existing "workspace subscriber count" or "is this workspace watched" API anywhere in `packages/core` or `packages/server` (grepped for `watchedWorkspaces`, `activeSubscribers`, `subscriberCount`, `hasSubscriber`, `workspaceSubscribers`, `onSubscriptionChange` — none exist). AD-27 cites "AD-5's existing per-workspace subscription" as the signal source, but AD-5 (the event log) does not itself expose a subscriber-count API; that lives in the server's WebSocket handling, wherever it tracks which workspace each open tab's socket is subscribed to.

## Implementation Notes

**Scope boundary, stated rather than discovered too late:** this entry is deliberately narrow. It builds and thoroughly tests the *scheduling* logic in complete isolation from the server, because the thing AD-27 says to gate on — "at least one tab subscribed to that workspace's event stream" — has no existing hook to attach to. Wiring this scheduler into the real server needs three things none of which exist yet and none of which this entry attempts:

1. A way to observe the WebSocket layer's per-workspace subscriber count changing (0→1 calls `onWorkspaceWatched`, 1→0 calls `onWorkspaceUnwatched`).
2. A real `sync` implementation composing `core.jiraLinks.get(workspaceId)` (the credential), `workspaceRepoPath` (the repo), `searchAllIssues`/`pullJiraIssuesIntoLocalTree` (entries 5-6's work), and writing `jira_links.lastSyncedAt`/`lastSyncError` (columns that already exist in the schema, unused until now).
3. The Board's Refresh route calling `scheduler.refresh(workspaceId)`.

None of the three touch this entry's own code once built — `createJiraPollScheduler` takes `sync` as a parameter precisely so the real wiring is additive, not a rewrite. Flagged here as the next concrete step for whoever picks this up, not left to be discovered by reading the whole epic over again.

## Verification

**Commands:**
- `npx vitest run packages/core/test/jira-poll-scheduler.test.ts` -- 13 passed (fake timers; no real clock)
- `pnpm typecheck` -- clean across all packages
- `pnpm test` -- 386 files / 4858 passed, 8 pre-existing skips (no regressions)
- `pnpm e2e` -- green on the prior story's push; this entry touches no UI so no new e2e coverage applies
