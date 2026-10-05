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

- Implemented directly (no implementation subagent); review lenses ran as subagents. Double click renames only in the sidebar (the chat list's first click leaves the list); the list has F2 and a row menu. API keys are redacted from automatic names. The rail (md to lg) doesn't open the field; the header's Rename works there.

## Plan Change Log

## Review Triage Log

Pass 1 (lenses quick, security-ux): high 0, medium 9, low 12, false 0, maybe-false 0.

| Finding | Verdict | Route | Evidence / action |
|---|---|---|---|
| Secret in first message becomes the name | medium | patch | `redactApiKeys` in `nameChat`, now after normalizing (split keys) |
| Route and event-order tests not updated | medium | patch | gate, guard coverage, chat test updated |
| Planning chat without label named by skill name | medium | patch | label, else description, else name, as plan-home shows it |
| Blur save pulls focus back | medium | patch | focus returned only after Enter or Esc |
| `session.renamed` clears Starting and check-in | medium | patch | fold skips it; transcript test added |
| Over 2000 chars gets Zod wording | low | patch | schema message is `CHAT_NAME_TOO_LONG`; rename body limit 16 KiB |
| maxLength counts code units | low | patch | maxLength 160, cap checked on save with a plain message |
| Header Rename hidden on phone in Developer mode | medium | patch | wrapper removed; field min width |
| Backfill stops at a blank first message | low | patch | tries later messages |
| Backfill duplicates `listCompletedMessages` | low | reject | that helper drops `origin`, and the terminal import depends on its shape |
| `setSessionTitle` 400 before 404 | low | patch | session looked up first |
| No terminal header UI test | low | reject | API test covers it; the header has no driver guard |
| Invisible fillers and stacked marks pass | medium | patch | stripped / capped at 3 marks; tests |
| Right to left names not isolated | medium | patch | `<bdi>` in Needs you, sidebar rows, chat list |
| Other secret shapes not redacted | medium | defer | deferred-work.md |
| Rename body limit 1 MiB | low | patch | 16 KiB with plain 413 |
| Zod wording for wrong types | low | reject | API clients only, UI can't send them |
| Failed save loses typed name | medium | patch | field reopens with the draft |
| Esc in the sheet closes the sheet | medium | patch | window capture listener cancels first |
| Rail too narrow for the field | low | patch | rename not opened in the rail |
| Focus to row, not menu trigger | low | reject | criterion 3 names the row |
| One live region per row; stale text | low | defer | deferred-work.md |
| Assertive announcement lacks chat name | low | defer | deferred-work.md |
| `aria-description` support | low | patch | `aria-describedby` hint |
| No visible label on inline field | low | reject | inline rename keeps the name's place; labelled and described |
| "It is called New chat" wording | low | patch | "Chat name cleared, back to …" |

## Design Notes

`autoTitle` set once and never changed keeps the rule simple and makes the backfill idempotent. The event carries both fields so any fold is `latest.title ?? latest.autoTitle`. Hooking `completeMessage` (not `sendMessage`) covers the composer, queued messages, terminal imports and planning chats from every agent with one check.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: all pass
- `pnpm e2e` -- expected: all pass
- `pnpm run pack && pnpm smoke` -- expected: pass
