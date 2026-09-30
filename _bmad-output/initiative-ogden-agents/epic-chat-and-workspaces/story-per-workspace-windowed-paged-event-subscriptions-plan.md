---
title: 'Per-workspace windowed, paged event subscriptions'
type: 'feature'
ticket: '2.9'
created: '2026-09-30'
status: 'built'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-epic-contracts-and-stubs-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every page load replays the whole install history (the legacy `subscribe {afterSeq:0}`), and each streamed chunk refolds all of it, which is quadratic (deferred-work, shared with 2.10). E2-R8 needs windowed subscriptions for each workspace instead.

**Approach:** Build the 2.3 protocol (`subscribe_install`, `subscribe_workspace`, `unsubscribe_workspace`, `page_history`, `history_page`, scoped `caught_up`) on top of scoped `EventLog` reads. The UI keeps a store for each workspace, plus a paging API for 2.10's Show earlier. Amend AD-5 in place, as the epic decided.

## Boundaries & Constraints

**Always:**
- Each subscription reads its backlog and registers in one synchronous tick, so no event is skipped or repeated.
- The install scope is `workspaceId IS NULL` plus `workspace.created`.
- Pages filter by `workspaceId`, and also by `streamId` when a `sessionId` is given.
- An unknown workspace gets `request_failed` `not_found`.
- The window is `DEFAULT_WINDOW_EVENTS` by default, and a page holds at most `MAX_PAGE_EVENTS`.
- The legacy `subscribe` keeps working, but the web no longer sends it.
- No migration or index: `events_workspace_seq_idx` serves the queries.

**Never:**
- Show earlier UI, tool-call rows or chunk coalescing (2.10), or sidebar data (2.11).
- Edits to `session-page.tsx` or `transcript.ts` (2.6's files); the chat screen switches to paged history in 2.10.
- A cap on the number of workspaces.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|---|---|---|---|
| Load | `subscribe_workspace {wsId}`, 50k events | the last 200 in order, `caught_up {scope, oldestSeq, hasEarlier:true}`, then live | — |
| Empty | no events | `caught_up {oldestSeq:null, hasEarlier:false}` | — |
| Page | `page_history {beforeSeq, limit}` | oldest first, all `< beforeSeq`, with `hasMore` | an oversized limit fails the schema and is ignored |
| Foreign session | a `sessionId` from another workspace | an empty page, `hasMore:false` | — |
| Reconnect | `{afterSeq}` | exactly the missed events, then live | — |
| Resubscribe | the same workspace twice | the new one replaces the old, with no double delivery | — |
| Unknown | subscribe or page for a missing workspace | `request_failed {for, workspaceId, code:not_found}` | — |

## Decisions

- The chat screen keeps reading the merged `events` until 2.10 switches it to `useSessionEvents` and paged history. Until then, a chat whose events are all older than the window opens without its history. This is recorded as a deferred-work entry (user, 2026-09-30).
- AD-5 is amended in place with exactly the wording in Tasks, and logged in `.memlog.md` (user, 2026-09-30).

</frozen-after-approval>

## Code Map

- `packages/core/src/event-log.ts:210-290` -- `readAfter`, `subscribe` (backlog, then live) and `notify`. Leave `completeMessage` and the E2-R7 guard as they are.
- `packages/shared/src/events.ts:40-46,588-736` -- the 2.3 constants and messages. Only the doc comments change: the install scope includes `workspace.created`, and legacy `subscribe` is deprecated.
- `packages/server/src/event-socket.ts` -- 2.9's file. Today it answers `not_implemented`.
- `packages/web/src/events/event-stream.tsx` -- one socket and a flat `events` list. Its readers are `quit-button.tsx`, `workspaces/workspace-api.ts`, `session-page.tsx`, `toolchain/use-uv-status.ts` and `useServerVersion`. `events/fold.ts` `addEvent` can be reused for each list.
- `packages/web/src/workspaces/workspace-api.ts` -- `useSessions`, where REST (2.5) supplies the list and events add live state.
- `packages/server/test/stub-routes.test.ts:101-116` -- the WS `not_implemented` case to replace. `test/helpers.ts` has `signIn` and `trackSocket`. The plan is checked against `b8c3ff4` (2.6 on top of 2.5); 2.6 rewrote `session-page.tsx` and `transcript.ts`, which still read `useEventStream().events`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/event-log.ts` -- add two methods:
  - `subscribeScope(scope: 'install'|WorkspaceId, from: {afterSeq}|{window}, listener) → {unsubscribe, oldestSeq, hasEarlier}`. The window reads newest first and reverses. It throws `NotFoundError` for an unknown workspace.
  - `readBefore(wsId, beforeSeq, limit, sessionId?) → {events, hasMore}`.
- [x] `packages/server/src/event-socket.ts` -- keep one install subscription and a `Map<wsId, unsubscribe>` for each socket, and handle the four messages. Release all of them on close or error.
- [x] `packages/shared/src/events.ts` -- change the doc comments only.
- [x] `packages/web/src/events/event-store.ts` (new, pure) -- the install state, and for each workspace `{events, lastSeq, oldestSeq, hasEarlier, caughtUp}`, plus page cursors per `wsId` or `wsId/sesId`. Provide `applyEvent`, `applyCaughtUp`, `applyHistoryPage` (prepend and dedupe by seq), a memoized `mergedEvents`, and `streamEvents(sesId)` whose identity stays stable per stream.
- [x] `packages/web/src/events/event-stream.tsx` -- on each open:
  - Send `subscribe_install {afterSeq}`.
  - `auth.fetch(API_ROUTES.workspaces)`, then send `subscribe_workspace` for each workspace (with its `afterSeq` on reconnect), and again on each `workspace.created`.
  - Keep a `requestId` pending map, and reject its entries on close.
  - `caughtUp` means every scope has caught up.
  - Keep `events`, now the merged list. Add `useSessionEvents(wsId, sesId)` and `useEarlierHistory(wsId, sesId?) → {hasEarlier, loading, error, loadEarlier}`.
- [x] `packages/web/src/workspaces/workspace-api.ts`, `shell/quit-button.tsx` -- add `useAllSessions()`, which is REST plus the live overlay, and take the busy count from it. A state older than the window is not in the stream.
- [x] `architecture-ogden-agents.md` AD-5 line 91 and `.memlog.md` -- amend to: "The UI holds one WebSocket; it subscribes to install-level events after seq N and to each workspace's recent window, pages older history on demand, and reconnects per scope after its last seq." Log it.
- [x] `_bmad-output/initiative-ogden-agents/deferred-work.md` -- append an entry (`source_plan` is this plan): "Chat screen switches to `useSessionEvents` and paged history (story 2.10); until then a chat whose events are older than the workspace window opens without its history, and the session fold runs over the merged window list." Evidence: user decision on 2.9 OQ1, 2026-09-30.
- [x] Tests:
  - `packages/core/test/event-log.test.ts`: the scope and window matrix, no gaps while events are appended, and pages that concatenate to exactly `readAfter`.
  - `packages/server/test/event-socket.test.ts` (new): seed 100,000 events across two workspaces in one transaction. Check that a load gets only the windows, that paging back to the start has no gap or repeat, and that a reconnect catches up exactly. Replace the stub case.
  - `packages/web/test/event-store.test.ts`: merge order, dedupe, prepend, and history deletion.

**Acceptance Criteria:**
- Given a page load, when the UI connects, then it never sends `subscribe`, and it receives only install events and each workspace's window.
- Given a streaming reply, when chunks arrive, then `useSessionEvents` changes only for that session.

## Implementation Notes

- A workspace subscription leaves out its own `workspace.created`, which the install scope already carries, so a tab following both gets every event once over the wire. Pages still filter by `workspaceId` only; the store keeps `workspace.created` in the install list.
- The 100,000-event server test seeds the rows straight into SQLite (`node:sqlite`, one transaction); seeding through core's per-event validation took 20 to 25 s.
- `tests/e2e/layout.spec.ts` reconnect test now watches `subscribe_install` (the web no longer sends `subscribe`) and asserts that no legacy `subscribe` is sent.
- `busySessionCount` (event-stream) is replaced by `useAllSessions()` + `isBusy` in `workspace-api.ts`.

## Plan Change Log

## Review Triage Log

- **F1 (fixed):** `loadEarlier` sent unchecked route params and a page could wait forever. Page requests now go through `events/pending-pages.ts`: each is checked with `PageHistoryMessage.safeParse` and rejected at once if invalid (never sent), and times out after 15 s. On the server, a message that fails the schema but carries a valid `requestId` for a request type is answered `request_failed` / `invalid_request` (with its `workspaceId` when that is valid); anything uncorrelatable is still ignored. The comment claiming the server answers invalid params with `not_found` is corrected. Tests: `packages/web/test/pending-pages.test.ts`, `event-socket.test.ts`.
- **F2 (deferred to 2.10):** a reconnect's `afterSeq` backlog is unbounded; bounding it needs a protocol change with a reset. Recorded in `deferred-work.md`.
- **F3 (deferred to 2.10):** every chunk re-merges the scopes into `events`, and each workspace's live list grows without bound for the life of the tab. Recorded in `deferred-work.md`.
- **F4 (fixed):** the 1000-subscription cap is removed (the plan says never cap workspaces). The per-socket map is keyed by workspace id and only existing workspaces can be subscribed, so it is bounded by the install's projects; a repeated subscribe replaces the old one. Test: 21 resubscriptions, one live delivery.
- **F5 (fixed):** when the workspace list keeps failing, the reconnect backs off 1 s, doubling to at most 30 s, and resets once the list loads (`nextReconnectDelay`, tested).

## Design Notes

- **Why `workspace.created` is in the install scope.** It is on the workspace stream, and without it a project added in another tab would never be subscribed.
- **Why a plain window is enough.** Deltas are pruned when their message completes (AD-5), so a window holds whole messages, apart from the one in flight.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test` -- expected: all pass on the macOS, Windows and Linux CI legs, with the 100k test under 30 s.
- `pnpm build && pnpm e2e` -- expected: the existing e2e suite passes unchanged.
