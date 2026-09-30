---
title: 'Refactor sweep (epic 2)'
type: 'refactor'
ticket: '2.12'
created: '2026-09-30'
status: 'built'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 2 left items deferred to this sweep (2.11 F7, 2.10b F5, 2.4's `callNoContent` nit, 2.5's typed-path form), plus copied fetch-error helpers, six e2e specs with their own chat-server setup, dead exports and stale comments. Agents copy what they find.

**Approach:** One no-behaviour-change pass over the items below, one commit per item, suite green after each. Items 1 and 2 are the only intended changes, both assigned by review.

## Scope

1. **Sidebar focus hold (2.11 F7):** the order is held while keyboard focus is inside the sidebar, as under the pointer.
2. **Install-scope scan (2.10b F5):** check `countAfter`/`subscribeScope` for the install scope with `EXPLAIN QUERY PLAN`; if either scans the table, add an index (on `type`, or partial on `workspace.created`) in migration `0004` so both use an index.
3. **One web fetch-error helper:** `call`, `callNoContent`, `postJson`, `ChatApiError`, `UNREACHABLE` and a body-message reader live in one module; `app-shortcut-api` drops `callDelete`; `toolchain-api` and `server-control` use the shared constant and reader but keep their own fallback text and status checks.
4. **E2E chat helpers:** one shared `withChatServer` / `startChat` / `send`; specs drop their local `FAKE_AGENT` and the redundant `claudeAdapterPath` (the default of `startServer`). Each test still gets its own server.
5. **Dead code:** `useAllSessions` (web), `LAUNCH_CODE_PATTERN` (shared).
6. **Stale comments:** `chat.ts` "declining stub until 2.6", `permissions.ts` "reaches it with story 2.10", `start-chat-form.tsx` "stand-in … arrives with 2.5".

## Boundaries & Constraints

**Always:** Same UI copy, error messages, HTTP status codes, routes and event shapes, except items 1 and 2. AD-1 dependency, design-token and feature-styling lints pass.

**Never:** Story 9.2's files (secrets-keyring, `setup-claude-code`, core `agent-setup`, `agent-setup-routes`, `start.ts`, `agent-card`, shared `setup.ts`/`api.ts`, `log.ts`), nor `agent-setup-api.ts` or `agents-settings.spec.ts`. The flaky e2e (2.13). Deferred instead: `killTree` ×3 (bare vs absolute `taskkill`; 9.6), splitting the >600-line files, moving `readBody`/`ids` out of `chat-routes.ts`, `agent-setup-api`'s `callNoContent` copy, `secret-store-port.ts` "9.4".

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Focus hold | Tab focus on a sidebar row; another session changes state | Rows update in place, order unchanged; new order applies once focus leaves the sidebar (and the pointer is outside) | — |
| Install scope | Many workspace events after `afterSeq` | Query plan uses an index; counts and windows are the same as before | — |
| Refused call | Any 4xx/5xx or unreachable server | Same message and `status` as before | — |

- Decision (2026-09-30, user): remove the typed-path "Start a chat" form (StartChatForm) and its Home slot; Add project is the only way in. The e2e startChat helper creates the workspace and chat through REST with the tab's token, then opens the chat URL.

</frozen-after-approval>

## Code Map

Baseline `08fc329` (branch `story/2.10b-history-at-scale`). 9.2 builds on `ba935a9`, the parent: rebase after 9.2 lands.

- `packages/web/src/shell/status-sidebar.tsx` -- `useHeldModel` (113), `pointerInside` (129), `onPointerEnter/Leave` (142). Add focus-within (`onFocus`; `onBlur` checks `relatedTarget`). Mounted twice below md; state is per instance.
- `packages/core/src/event-log.ts` -- `scopeFilter` (295), `subscribeScope` (387), `countAfter` (442). `db/schema.ts` events indexes (93); migrations in `packages/core/drizzle/` via `db:generate`.
- `packages/web/src/chat/chat-api.ts` -- `UNREACHABLE` (23), `ChatApiError`, `call` (36), `postJson`, private `callNoContent` (89). Move to new `web/src/api/http.ts`; `chat-api.ts` re-exports `call`, `postJson`, `ChatApiError` so its importers (incl. 9.2's `agent-setup-api.ts`) compile unchanged.
- `appearance/app-shortcut-api.ts` (`callDelete` 31), `toolchain/toolchain-api.ts` (`errorMessage`), `events/server-control.ts` (lines 23, 47; plain `Error`, keep).
- `tests/e2e/{caution,chat,permissions,session-behaviour,session-history,sidebar}.spec.ts` -- local helpers; `tests/support.ts:50` already defaults the fake agent. New `tests/e2e/chat-server.ts`; keep per-spec options (chunk delay, `extra`, caution's `src/a.ts`).
- Dead: `web/src/workspaces/workspace-api.ts:189`, `shared/src/tab-token.ts:22`. Comments: `core/src/chat.ts:14`, `core/src/permissions.ts:592`, `web/src/chat/start-chat-form.tsx:11`.

## Tasks & Acceptance

**Execution:**
- [x] `status-sidebar.tsx` -- item 1; e2e in `sidebar.spec.ts`: keyboard-focus a row, change a state, order held; focus out, reorder (web has no DOM unit env).
- [x] `core/test/event-log.test.ts` -- assert no `SCAN events` in both install-scope query plans; `schema.ts` + migration `0004` only if it fails first -- item 2.
- [x] `web/src/api/http.ts`, `chat-api.ts`, `app-shortcut-api.ts`, `toolchain-api.ts`, `server-control.ts` -- item 3.
- [x] `tests/e2e/chat-server.ts` + the six specs -- item 4.
- [x] `workspace-api.ts`, `shared/src/tab-token.ts` -- item 5.
- [x] `chat.ts`, `permissions.ts`, `start-chat-form.tsx` -- item 6.
- [x] `_bmad-output/initiative-ogden-agents/deferred-work.md` -- append "Resolved" for 2.11 F7 and 2.10b F5, and one entry per out-of-scope item above.

**Acceptance Criteria:**
- Given the full suite, e2e, smoke, fork and pin checks, when run after the sweep, then all pass and no copy, status code or route changed.
- Given `packages/web/src` (except `agent-setup-api.ts`) and `tests/e2e`, then `UNREACHABLE`, the no-content call and `FAKE_AGENT` are each defined once.

## Implementation Notes

- Item 1: the hold counts keyboard focus only (`:focus-visible` on the focused element, inside the sidebar's own DOM subtree), so a mouse-clicked row, or focus bubbling out of the Add project dialog's portal, doesn't hold the order after the pointer leaves. The new e2e fails with the hold removed.
- Item 2 (F5 stays open in deferred-work: no full table scan, but the range steps over other workspaces' rows): every install-scope read (`countAfter`, `subscribeScope` window, drain and `anyBefore`) plans as `SEARCH events USING INTEGER PRIMARY KEY` (a `seq` range), never `SCAN events`, so no index and no migration 0004. The test records the SQL Drizzle actually prepares.
- Item 3: `web/src/api/http.ts` holds `call`, `callNoContent`, `postJson`, `ChatApiError`, `UNREACHABLE`, `errorMessage`; generic importers (`workspace-api`, `event-stream`, `app-shortcut-api`) import it directly, `chat-api` re-exports `call`, `postJson`, `ChatApiError`.
- Item 4 and the Home decision: `tests/e2e/chat-server.ts` (`withChatServer`, `startChat` over REST with the tab token, `send`, `composer`); the e2e "a folder that does not exist is refused ... on the home page" went with the form (the refusal stays covered in `core/test/chat.test.ts`, `server/test/chat.test.ts`, `server/test/workspaces.test.ts`).
- Item 6: the `start-chat-form.tsx` comment went with the file.

## Plan Change Log

## Review Triage Log

- F1 (fixed): the focus hold now also releases when the focused element unmounts (no blur fires): an effect keyed on the live model clears it when the sidebar content no longer contains `document.activeElement`. E2E "the hold ends when the focused Needs you entry leaves" (fails without the effect).
- F2 (fixed): the plan check matches `/\bSCAN (TABLE )?events\b/`, for older SQLite's wording.
- F3 (fixed): 2.10b F5 is no longer called resolved in deferred-work: no full table scan (verified), the seq range still steps over other workspaces' rows, revisit if slow.
- F4 (fixed): `tests/e2e/workspaces.spec.ts` "Add project, then New chat" goes through the real UI to `/w/ws_…/s/ses_…` with the composer focused.
- Also: deferred-work entry for 2.13, the `tests/launcher.test.ts` "--foreground beside a background server" 5 s timeout under a full run.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm e2e` -- expected: all pass.
- `pnpm pack && pnpm smoke` -- expected: exit 0.
