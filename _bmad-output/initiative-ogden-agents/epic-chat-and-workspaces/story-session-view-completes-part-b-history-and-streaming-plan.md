---
title: 'Session view completes, part B: history and streaming at scale'
type: 'feature'
ticket: '2.10'
created: '2026-09-30'
status: 'built'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-per-workspace-windowed-paged-event-subscriptions-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:**
- A chat whose events are older than the workspace window opens without its history (the 2.9 decision).
- Every chunk re-merges every scope, and live lists grow for the life of the tab (2.9 F3; 2.2's quadratic refold).
- A reconnect replays every missed event in one burst (2.9 F2).
- A user who scrolled up has no Jump to latest.

**Approach:** Move the chat screen to `useSessionEvents` with Show earlier (`useEarlierHistory`) and Jump to latest. The web store applies socket messages once per frame and trims live lists. A reconnect with too large a gap gets a fresh window and a `reset`.

## Boundaries & Constraints

**Always:**
- The fold runs over the session's own stream only.
- Show earlier sits at the top: no infinite scroll, no page reload, pages in order with no gap or repeat.
- Auto-scroll happens only while the user is at the bottom. Otherwise "Jump to latest (n)" counts the new items.
- The store applies queued socket messages in one update per animation frame.
- Each workspace's live list is trimmed to `MAX_LIVE_EVENTS` (2,000), oldest first. Trimming sets `hasEarlier`, keeps the open session's stream, and never drops a workspace's `workspace.history_deleted` floor.
- 2.11 derives session states from the REST list (`workspace-api.ts` `useAllSessions`) plus the live overlay. A trim or reset must leave that overlay correct: it may drop old `session.state_changed` events, but never the newest one per session in the list it keeps.
- Reset: when a reconnect's `afterSeq` misses more than `MAX_PAGE_EVENTS` events of a scope, the server sends that scope's window and `caught_up {reset:true}`, and the client replaces that scope's events and cursors.
- Tests are Windows-safe.

**Never:**
- Queue, Stop, tool-call rows or error changes (2.10a).
- Edits to 2.11's files: `sidebar-model.ts`, `live-announcer.tsx`, `status-sidebar.tsx`, `needs-you-group.tsx`, `app-shell.tsx`, `ui/sidebar.tsx`, `workspace-api.ts`.
- A cap on workspaces.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|---|---|---|---|
| Old chat | all its events older than the window | loading, then Show earlier pages its messages | page fails or times out → inline "Couldn't load. Try again" |
| Streaming | 1,000 chunks | at most one store update per frame; only that session's stream changes identity | — |
| Long tab | live list > 2,000 | oldest trimmed; `hasEarlier` true; sidebar states unchanged | — |
| Scrolled up | new items arrive | no scroll; "Jump to latest (n)" | — |
| Small gap | ≤ `MAX_PAGE_EVENTS` missed | exact catch-up (2.9 behaviour) | — |
| Large gap | more missed | window + `reset`; the scope is replaced; Show earlier works from the new cursor | — |

## Decisions

- Ticket 2.10 is delivered in two parts (user, 2026-09-30): 2.10a "Session behaviour", then this part B, which goes after it (both edit `session-page.tsx`). In the ticket folder this plan is `story-session-view-completes-part-b-history-and-streaming-plan.md`.

</frozen-after-approval>

## Code Map

- `packages/web/src/events/event-store.ts:84` `applyEvent`, `:167` `applyHistoryPage`, `:206` `pageCursor`, `:231` `mergedEvents` -- trimming, `applyReset`. Keep the merge memoized per list identity.
- `packages/web/src/events/event-stream.tsx:352` (store, merged events), `:395` `useSessionEvents`, `:410` `useEarlierHistory` -- frame batching and handling `reset`. `pending-pages.ts` already times pages out at 15 s.
- `packages/web/src/routes/session-page.tsx:38-45` -- switch to `useSessionEvents`. Take `projectName` from the `fetchWorkspace` query (`workspace-api.ts`, import only).
- `packages/shared/src/events.ts:585` `CaughtUpMessage` -- add `reset: z.literal(true).optional()`.
- `packages/core/src/event-log.ts` `subscribeScope` (:105) -- add a count of the missed events (the `events_workspace_seq_idx` index serves it; no migration).
- `packages/server/src/event-socket.ts:122` -- choose between catch-up and window + reset.
- `tests/e2e/layout.spec.ts` -- the reconnect test must still pass.

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/events.ts`, `core/src/event-log.ts`, `server/src/event-socket.ts` -- the reset path.
- [x] `packages/web/src/events/event-store.ts`, `event-stream.tsx` -- frame batching, trimming, reset.
- [x] `packages/web/src/routes/session-page.tsx` -- `useSessionEvents`, Show earlier with a loading state, Jump to latest with a count.
- [x] Tests:
  - `core/test/event-log.test.ts`: the count.
  - `server/test/event-socket.test.ts`: a large gap gives window + reset; a small gap is exact.
  - `web/test/event-store.test.ts`: trimming keeps the newest state per session and the open stream; reset replaces the scope.
  - `tests/e2e/session-history.spec.ts`: seed more than the window, open the chat, Show earlier, no reload; Jump to latest.

**Acceptance Criteria:**
- Given a chat whose events are all older than the window, when it opens, then Show earlier loads them in order with no gap or repeat.
- Given a streaming reply, when chunks arrive, then another workspace's session view does not re-render.

## Implementation Notes

- **Code Map re-checked against 424a1bc (2.11 + 2.10a).** Line numbers moved; intent unchanged. `session-page.tsx` now reads `useSessionEvents` (was `useEventStream().events`, 2.10a's lines 48-57); `projectName` comes from the `['workspace', wsId]` `fetchWorkspace` query with `workspaceName` (both imported from `workspace-api.ts`, which is not edited). 2.11's files are untouched.
- **The count is its own method.** `EventLog.countAfter(scope, afterSeq, cap)` reads at most `cap` seqs through `events_workspace_seq_idx` (no migration). The server calls it and `subscribeScope` in the same synchronous tick, so the choice between catch-up and window + reset cannot race an append. It applies to reconnects only (`afterSeq > 0`): a first `subscribe_install {afterSeq: 0}` keeps 2.9's behaviour.
- **Rule removals.** The fold runs over the session's own stream; the always-allow rules undone since (`workspace.permission_rule_removed`, on the workspace's stream) are passed in as `sessionView`'s new optional third argument, so a card's Undo state is unchanged.
- **Re-renders.** `useSessionEvents`, `useEarlierHistory` and the new `useCaughtUp` read the store through `useSyncExternalStore` with a selector, so the chat re-renders only for its own stream. The `useEventStream()` context (sidebar, announcer, Quit) still updates, once per frame.
- **Frame batching** (`events/frame-batch.ts`): the next animation frame, or 100 ms when none comes (a hidden tab gets no frames). The queue is flushed before a history page merges in and when the socket closes. `applyEvents` copies each touched list once per batch instead of once per event.
- **Trimming** keeps: the streams on screen (`retain` from `useSessionEvents`), each session's newest `session.state_changed`, every `permission.requested` without a `permission.resolved`, and `workspace.history_deleted`. The workspace cursor moves to just after the newest trimmed event; a stream that lost events drops its own cursor (pages again from the workspace's), and an open stream keeps paging from where it was.
- **Reset** drops the scope's events older than the window, its streams' older events and its session cursors. It also invalidates `['sessions', wsId]` (or `['workspaces']` for the install scope), because the REST states the overlay falls back to may be stale after a gap.
- **Old chat on opening**: once caught up, a chat whose `session.created` is not loaded and that has earlier history loads its latest page on its own (with the loading state), then Show earlier pages the rest. A failed or timed-out page shows "Couldn't load." with Try again.
- **Jump to latest** shows only while the reader is scrolled up and new items arrived ("Jump to latest (n)"). It counts items after the last one seen at the bottom, so Show earlier's prepends do not count. It has no live region, so it does not double up with 2.11's announcer or the page's permission announcement. Show earlier keeps the scroll position.

## Plan Change Log

## Review Triage Log

- **F1 (fixed):** a trim could drop `workspace.permission_rule_removed`, so a card offered Undo again for a rule already undone. The trim now holds every `workspace.permission_rule_removed`, and Undo answered 404 `not_found` reads "Always allow undone" instead of an error (`undoFailure` in `permission-card.tsx`). Tests: `event-store.test.ts` (held-events case), `permission-card.test.tsx`.
- **F2 (fixed):** held events counted against the limit, so with more held events than `MAX_LIVE_EVENTS` every new unheld event was dropped at once. Now only unheld events count: at most `unheld - max` are dropped. Test: `event-store.test.ts` "held events never crowd out new ones" (10 held, limit 5).
- **F3 (fixed):** a Show earlier load that failed or added nothing above left its scroll anchor set, so a later change at the top jumped the view. A layout effect clears the anchor once the load settles; it runs after the one that places a page that did add items. Not unit-testable here (no DOM test environment); covered by the Show earlier e2e path.
- **F4 (fixed):** a hidden tab waited for the fallback timer, which the browser throttles. While `document.hidden`, the batch applies each message at once. Test: `frame-batch.test.ts`.
- **F5 (deferred to 2.12):** the install scope's count and window may scan workspace rows (no index on `type`). Recorded in `deferred-work.md`: add an index on `type` or a partial index, after checking the query plan.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test` -- expected: all pass; the 100k test stays under 30 s.
- `pnpm build && pnpm e2e` -- expected: all pass, including `layout.spec.ts` and 2.11's sidebar specs once merged.
