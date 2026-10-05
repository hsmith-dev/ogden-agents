---
title: 'Each chat has a name the user can change'
type: 'feature'
ticket: '2'
created: '2026-10-04'
status: 'in-review'
baseline_revision: '56883363a54bcfb42b8ae698522dd02e34af5ef2'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'security-ux']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/backlog/story-each-chat-has-a-name-the-user-can-change.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every chat is called "Chat" in the sidebar, the chat list and its header (`session.title` exists but is never set), so chats in a project can't be told apart (user feedback, 2026-10-04).

**Approach:** Two stored names per session: `title` (the user's, nullable, existing column) and a new `autoTitle` (set once by core: the planning action's label at creation, else from the first non Deny-reason user message, whatever path appended it). Shown name = `title ?? autoTitle ?? "New chat"`. Each change appends one `session.renamed` event carrying both; a `PUT .../sessions/:sesId/title` route renames; every view overlays the latest event so tabs follow live. Older chats get their automatic name from their first stored user message at server start.

## Boundaries & Constraints

**Always:** ticket criteria 1–7 are the bar. Names are normalized in shared code used by server and UI (strip `\p{Cc}` and `\p{Cf}`, collapse white space, trim); the server refuses a normalized name over 80 characters (400, no event); empty → `null` (fallback). Names render as React text only. A rename does not change `updatedAt` (sidebar order unchanged). Rename is allowed in any state and driver. `session.created` events without `autoTitle` still parse. Tests never run real agents, keychain, network or read `~/.claude`.

**Never:** send the name to the agent; add a search box; reorder rows on rename; markup in names; edit `.claude/settings*`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First message | new chat, user sends "  Fix the\nlogin bug  " | autoTitle "Fix the login bug", one `session.renamed` | none |
| Long first message | 200 chars | autoTitle ≤ 60 chars ending "…" at a word break | none |
| Deny reason first | user message with origin `deny_reason` | no autoTitle | none |
| Planning chat | start skill with label "Create a PRD" | autoTitle "Create a PRD" at creation, first message doesn't change it | none |
| Rename | PUT `{title:"Auth \u0007work"}` | title "Auth work", event, 200 | none |
| Clear | PUT `{title:"   "}` or `null` | title null, shows autoTitle | none |
| Too long | 81 chars after normalize | nothing stored | 400 plain "A chat name can be at most 80 characters." |
| Unknown session | PUT on other workspace's session | 404 | as other session routes |
| Old chat | session with null autoTitle and a stored user message | server start sets autoTitle (event) | none |

</frozen-after-approval>

## Code Map

- `packages/shared/src/entities.ts` -- `Session`: add `autoTitle` (nullish, back-compat).
- `packages/shared/src/chat.ts` (or new `chat-name.ts`, exported from index) -- `CHAT_NAME_MAX = 80`, `AUTO_CHAT_NAME_MAX = 60`, `NEW_CHAT_NAME = 'New chat'`, `normalizeChatName`, `autoChatName(text)`, `chatName(session)`.
- `packages/shared/src/events-session.ts` + `events.ts` union -- `session.renamed` {sessionId, title, autoTitle, cause: 'user'|'auto'}.
- `packages/shared/src/api.ts` -- `API_ROUTES.sessionTitle`, `RenameSessionRequest` ({title: string|null}, string max 2000 raw).
- `packages/core/drizzle` -- migration 0012 adds `sessions.auto_title`; schema.ts column.
- `packages/core/src/entities.ts` -- `NewSession.autoTitle`, `toSession`, `setSessionTitle(id, title)`, `setSessionAutoTitle(id, name)` (only when null), `backfillAutoTitles()`.
- `packages/core/src/session-events.ts` `completeMessage` -- the one place every user message lands: names the chat on the first non-deny user message (same transaction).
- `packages/core/src/chat/workspaces.ts` `createChatSession` option `autoTitle`; `chat/types.ts` + `chat.ts` expose `renameSession(wsId, sesId, title)`.
- `packages/core/src/planning.ts` `start` -- passes the skill's label (or name).
- `packages/server/src/chat-routes.ts` -- PUT route like `sessionPermissionMode`; `start.ts` calls the backfill beside `resetPermissionModes`.
- `packages/web/src/chat/chat-name.tsx` (new) -- `useChatName` overlay, `renameChat` api call, `ChatNameField` inline editor (Enter/blur save, Esc cancel, maxLength 80, polite announcement).
- `packages/web/src/workspaces/workspace-api.ts` -- overlay `session.renamed` in `useSessions`/`useAllSessionsStatus`.
- `packages/web/src/shell/sidebar-model.ts`, `status-sidebar.tsx`, `needs-you-group.tsx` -- row title via `chatName`; row rename (double click, F2, row menu); Needs you names the chat.
- `packages/web/src/routes/session-page.tsx` + `shell/workspace-header.tsx` -- header shows name with Rename.
- `packages/web/src/routes/workspace-chats-page.tsx` -- list rows: name, rename.

## Tasks & Acceptance

**Execution:**
- [ ] shared: name helpers, `autoTitle`, event, API schema; contract tests.
- [ ] core: migration, entities methods, completeMessage hook, planning label, chat `renameSession`; unit tests (matrix rows).
- [ ] server: route + backfill at start; route tests (rename, clear, too long, control chars, 404).
- [ ] web: overlay, `ChatNameField`, header, sidebar, chat list, Needs you; dom tests for Enter/Esc/blur/fallback/announce and the live overlay.
- [ ] e2e: rename from header shows in sidebar and survives reload (fake agent only).
- [ ] docs: EXPERIENCE.md rows for chat name; architecture event list if it enumerates events.

**Acceptance Criteria:**
- Given two tabs, when a chat is renamed in one, then the other shows it without reload.
- Given a chat driven by the terminal, when renamed from the header, then it succeeds.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Design Notes

`autoTitle` set once and never changed keeps the rule simple and makes the backfill idempotent. The event carries both fields so any fold is `latest.title ?? latest.autoTitle`. Hooking `completeMessage` (not `sendMessage`) covers the composer, queued messages, terminal imports and planning chats from every agent with one check.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: all pass
- `pnpm e2e` -- expected: all pass
- `pnpm run pack && pnpm smoke` -- expected: pass
