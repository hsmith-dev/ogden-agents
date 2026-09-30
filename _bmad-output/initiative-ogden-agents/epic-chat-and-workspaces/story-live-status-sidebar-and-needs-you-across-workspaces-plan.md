---
title: 'Live status sidebar and Needs you across workspaces'
type: 'feature'
ticket: '11'
created: '2026-09-30'
status: 'built'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/ux-ogden-agents/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The sidebar shows only Add project and an always-empty Needs you (`items={[]}`), so a user coming back to several busy workspaces cannot see what is working or what waits on them (E2-R6).

**Approach:** Build the sidebar from data the web already has: the REST session lists with live states from the event stream (`useAllSessions`), and each workspace's event window for pending permission requests. Group sessions by workspace, active first, and never move the row under the pointer. Aggregate pending requests into Needs you, count them in the tab title, and announce changes through one polite region (batched, at most one every 5 s) and one assertive region (a new request, once).

## Boundaries & Constraints

**Always:**
- Web only. No server, core, shared or `api.ts` change. Session state comes from `session.state_changed` over REST (AD-4, AD-5).
- Rows are ordered working, waiting, error, then idle, then done. Done sessions older than 24 h go under a collapsed "Earlier". Workspace groups keep creation order.
- While the pointer is over the sidebar, rows update in place and do not reorder. The new order applies when the pointer leaves.
- State is never shown by color alone: glyph plus word (`StateGlyph`). In the rail, the word is the tooltip and accessible name.
- Shared components go in `packages/web/src/ui` (AD-18). Collapsed state per workspace goes in `localStorage`, with try/catch around every read and write.
- Nothing is announced for backlog events. Announcements start after the first `caughtUp`.

**Never:**
- Editing `session-page.tsx` or `transcript.ts` (2.7, then 2.10), or `permission-card.tsx` (2.8).
- Questions, reviews or blocked runs in Needs you (epics 4 and 5). No `g n` shortcut or command palette.
- A new REST route for pending requests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Two busy workspaces | A is `working`; B's chat asked permission for `npm test` | Both groups show their rows. Needs you shows 1 row "B: Claude Code wants to run npm test". Title reads "(1) Ogden Agents" | — |
| Change under the pointer | A row's state changes while the sidebar is hovered | Glyph and word update in place. Order changes only after pointer leave | — |
| Resolved elsewhere | `permission.resolved`, any tab | The row leaves Needs you. Title returns to "Ogden Agents". The group hides at 0 | — |
| Request outside window | Session `waiting`, its `permission.requested` older than the window | Row text reads "Claude Code is waiting for you" and links to the session | — |
| Burst | 3 state changes within 5 s | One polite announcement, latest state per session ("B: Chat is working") | — |
| New request, other session | Request in a session that is not open | One assertive announcement "Claude Code is waiting for you: run npm test" | — |
| New request, open session | Request in the session on screen | The shell stays silent (session-page already announces it) | — |
| History deleted | `workspace.history_deleted` | That workspace's rows and items disappear | — |
| Reopen from the shortcut | New tab, backlog replays | The sidebar shows current states without announcing them | REST list failure: the rows show skeletons, and the stream retry refetches |

</frozen-after-approval>

## Code Map

- `packages/web/src/shell/status-sidebar.tsx` -- `StatusSidebarBody` renders `<NeedsYouGroup items={[]}/>` and the Projects group with Add project only. Keep the header, footer and `SettingsMenu`.
- `packages/web/src/shell/needs-you-group.tsx` -- a presentational group plus a rail button (`onOpenFirst`). `NeedsYouItem {id, workspaceName, text}`.
- `packages/web/src/workspaces/workspace-api.ts` -- `useAllSessions()` (REST lists plus `session.created`/`state_changed`/`history_deleted`), `useWorkspaces`, `workspaceName`, `isBusy`. Reuse them. `quit-button.tsx` also uses `useAllSessions`.
- `packages/web/src/events/event-stream.tsx` / `event-store.ts` -- subscribes to install plus every workspace window (2.9). `store`, `streamEvents(store, wsId, sesId)` and `caughtUp` are read-only here.
- `packages/web/src/chat/transcript.ts` -- `sessionView(events, sesId).pendingPermissions`. Import only; 2.7 is editing it.
- `packages/web/src/permissions/permission-card.tsx` -- `permissionAnnouncement(p)` ("run npm test"). `chat/chat-api.ts` `AGENT_NAME`.
- `packages/web/src/ui/sidebar.tsx` -- `SidebarMenuButton` (tooltip in the rail), `SidebarAttentionGroup`/`Button`. `ui/state-glyph.tsx` -- `StateGlyph`, `STATE_WORDS`.
- `packages/web/src/routes/session-page.tsx:53` -- this route's own assertive region for its card. Leave it.
- `tests/e2e/permissions.spec.ts` (`withChatServer`), `tests/e2e/tab.ts` (`launchLink`, `landConnected`, `sidebarOf`). The fake agent's `slow` and `permission` keywords.

## Tasks & Acceptance

**Execution:**
- [x] `packages/web/src/shell/sidebar-model.ts` (new, pure) -- `buildSidebar(workspaces, sessions, store, now)` → groups `{wsId, name, rows, earlier, summary}` and Needs you items `{id: requestId|sesId, wsId, sesId, workspaceName, text, at}`, oldest first. Also `holdOrder(previous, next)` (keeps the previous order and appends new rows at the end) and `diffForAnnouncements(prev, next)` → `{polite: string[], assertive: {sesId, text}[]}`. Rationale: every rule is unit-testable.
- [x] `packages/web/src/ui/sidebar.tsx` -- add `SidebarWorkspaceGroup` (chevron button with `aria-expanded`; when collapsed, one glyph and count per non-zero state) and `SidebarStatusRow` (glyph, one-line title, caption "Claude Code, <state>", tabular relative time, signal rail when `waiting`, selected style; glyph only in the rail). Follow DESIGN.md Status row and Workspace group.
- [x] `packages/web/src/shell/status-sidebar.tsx` -- render the groups (rows link to `/w/$wsId/s/$sesId`; title `session.title ?? 'Chat'`) and Needs you. Freeze the order on `pointerenter` and release it on `pointerleave`. Keep collapsed state in `localStorage`. Show skeleton rows while loading.
- [x] `packages/web/src/shell/needs-you-group.tsx` -- items become links to their session. The rail button navigates to the first item.
- [x] `packages/web/src/shell/live-announcer.tsx` (new; mounted once in `shell/app-shell.tsx`) -- a polite region batched to one message per 5 s, an assertive region (one message per request id, skipping the open session from the router params), and `document.title` set to "(n) Ogden Agents" or restored.
- [x] `packages/web/src/shell/app-shell.tsx` -- mount `LiveAnnouncer`.
- [x] `packages/web/src/workspaces/workspace-api.ts` -- `useAllSessions` also takes `updatedAt` from the `at` of `state_changed`, for the relative time.
- [x] `packages/web/test/sidebar-model.test.ts`, `live-announcer.test.tsx` (fake timers), `needs-you-group.test.tsx` -- cover each I/O matrix row.
- [x] `tests/e2e/sidebar.spec.ts` (new) -- the ticket's verify: two repos (`mkdtemp`), `slow` in one and `permission` in the other. Close the page, then `landConnected(page, await launchLink(server.url, dataDir))`. Assert both groups' states, the Needs you row naming its workspace, and the title `(1) Ogden Agents`. Allow the request, and Needs you is gone.

**Acceptance Criteria:**
- Given the rail (768 to 1023 px), when a session waits, then the counted Needs you button and the row glyphs show it, each with an accessible name.
- Given the sheet below md, when a row is clicked, then the session opens and the sheet closes.

## Review Triage Log

- F1 (patch): the same announcement twice in a row was not said again, since the region's text did not change. Each message now carries a counter `n`, and the region's child is keyed by it, so every message is a new node. Tests: `live-announcer.test.tsx` (same words twice).
- F2 (patch): the "Claude Code is waiting for you" fallback showed for a moment when a session was `waiting` with no open request (answered before `working` arrived, or `waiting` before its request), which also bumped the title. It now shows only when the event window has no state for the session (a request older than the window). Tests: `sidebar-model.test.ts` (both orders, and a window with no state).
- F3 (patch): the model was built three times (column, sheet, announcer), each with its own clock. `SidebarDataProvider` in `app-shell.tsx` now builds it once with one minute tick; the column, the sheet, the announcer and Quit read it. `pendingRequests` returns before folding the stream unless the session is `waiting`, and rows are memoized on plain values.
- F4 (patch): the e2e depended on `slow`'s 10 s timer. The fake agent has a new `hold` keyword that waits only for cancel, and the test uses it. The "backlog not announced" check now runs after a live change: another tab answers the request, the tab's clock (`page.clock`) steps the 5 s batch, the polite region says only that chat's new state, and the assertive region stays empty.
- F5 (patch): polite announcements now also skip the chat on screen, as the assertive ones did. Test: `live-announcer.test.tsx`.
- F6 (patch): each loading group had its own `role="status"`. There is now one status line per copy of the sidebar, and the skeletons are only visual.
- F7 (defer to 2.12): hold the order while keyboard focus is inside the sidebar, not just under the pointer. Logged in `deferred-work.md`.

## Verification

**Commands:**
- `pnpm typecheck && pnpm test` -- expected: all pass, including the new model and announcer tests.
- `pnpm e2e` -- expected: `sidebar.spec.ts` and the existing suites pass. CI runs on macOS, Windows and Linux; the tests assert path segments and names, never full paths.

**Manual checks:**
- VoiceOver or NVDA: a burst of changes gives one polite announcement, and a new card in a background workspace is announced once.
