---
title: 'The composer keeps unsent text per chat'
type: 'feature'
ticket: '6'
created: '2026-10-04'
status: 'in-progress'
baseline_revision: '1319f26'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Text typed in a chat composer is lost when the user goes to another chat, project or page, or reloads (user feedback 2026-10-04).

**Approach:** The shared `Composer` takes a `draftKey` (workspace + chat, or workspace + `new` for a project's first-chat composer) and keeps its unsent text in per-viewer `localStorage` through a small drafts module: loaded when the key changes, saved as it changes, cleared when the server accepts the send or the field is emptied; expired after 7 days, capped in size and count.

## Boundaries & Constraints

**Always:** every storage access in try/catch (blocked storage = today's behaviour); clear only after `onSend` resolves and only when the stored text still equals what was sent (keeps the 9.7 `current === sent ? '' : current` rule and text typed while sending); the Not-sent restore keeps prepending, and the combined text becomes the draft; Enter/Shift+Enter, autofocus, labels, describedBy, Send state, error text unchanged.

**Never:** drafts on the server, in events, in URLs, or in any log/console call; live cross-tab sync (last write wins, documented); edits outside the composer and its two call sites beyond one prop each (siblings on 6.9 edit nearby code).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Leave and return | type in chat A, open chat B, back to A | A shows its text; B shows only B's draft | none |
| Reload | draft in A or in project's new-chat composer | same text after reload | none |
| Send accepted | draft sent, server 2xx | field and draft empty | none |
| Typed while sending | text changed before accept | changed text kept as draft | none |
| Send refused | server error | text and draft kept, error shown | existing message |
| Not sent | queued message ends Not sent | text prepended; draft = combined | none |
| Emptied | user clears field | draft removed | none |
| Expired | `savedAt` older than 7 days | not shown; entry removed | none |
| Over caps | > 100 000 chars, or > 50 drafts | big one not stored (old entry removed); oldest beyond 50 evicted | none |
| Storage blocked | `localStorage` throws | composer works, no drafts | swallowed |
| Corrupt entry | non-JSON / wrong shape | treated as no draft, removed | swallowed |

</frozen-after-approval>

## Code Map

- `packages/web/src/chat/composer.tsx` -- `Composer`; `text` state, `restore` effect, `submit()` with the 9.7 clear rule. Add optional `draftKey` prop. `SessionPage` is not keyed by session, so the composer must reload its text when `draftKey` changes (state adjusted during render), not only on mount.
- `packages/web/src/routes/session-page.tsx` -- `<Composer>` at ~l.510; covers chats, planning chats (same route) and the terminal-off composer. Add `draftKey={chatDraftKey(wsId, sesId)}` only.
- `packages/web/src/routes/workspace-chats-page.tsx` -- first-chat `<Composer>` ~l.169; `onSend` creates, sends, then navigates (`openChat`) before resolving, so clearing must not depend on the component still being mounted. Add `draftKey={newChatDraftKey(wsId)}` only.
- `packages/web/src/shell/status-sidebar.tsx` -- reference pattern for try/catch `localStorage` with an `ogden-agents.` key prefix.
- `packages/web/test/session-page.dom.test.tsx` -- existing composer DOM tests (pattern for rendering with a router/mocks).
- `tests/e2e/chat.spec.ts`, `tests/e2e/chat-server.ts` -- e2e with the fake agent.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/web/src/chat/drafts.ts` -- new: `chatDraftKey`, `newChatDraftKey`, `readDraft`, `writeDraft` (empty → remove), `clearDraftIfUnchanged(key, sent)`; storage key `ogden-agents.draft.v1:<key>`, value `{ text, savedAt }`; `DRAFT_TTL_MS` 7 days, `DRAFT_MAX_CHARS` 100 000, `DRAFT_MAX_COUNT` 50; prune expired/corrupt/over-count once per load; storage + clock injectable for tests -- one place owns the policy.
- [ ] `packages/web/src/chat/composer.tsx` -- `draftKey` prop: initial text from the draft, reload on key change, save on change (skip if unchanged), clear-if-unchanged in the send-accepted path using the key captured at submit -- the behaviour.
- [ ] `packages/web/src/routes/session-page.tsx`, `packages/web/src/routes/workspace-chats-page.tsx` -- pass `draftKey` -- wiring.
- [ ] `packages/web/test/drafts.test.ts` -- unit: matrix rows for expiry, caps, corrupt, blocked storage, clear-if-unchanged.
- [ ] `packages/web/test/composer-drafts.dom.test.tsx` -- DOM: key switch A→B→A, remount restore, accepted send clears, typed-while-sending kept, refused send keeps, restore prop prepends and is saved, emptied removes.
- [ ] `tests/e2e/chat.spec.ts` (or a new `composer-drafts.spec.ts`) -- leave and return, reload, and send clears; fake agent only.
- [ ] `_bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md` -- one Composer line: drafts kept per chat in this browser for 7 days.

**Acceptance Criteria:**
- Given any composer, when the user types, navigates, reloads or sends, then no request, event, URL or log carries the draft; only the sent message reaches the server.
- Given two tabs on one chat, when both type, then the stored draft is whichever wrote last and neither tab's visible text changes.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Design Notes

Why browser storage, not the server: a draft can hold a pasted secret; the server keeps an append-only event log and AGENTS.md says mask secrets in anything stored. `localStorage` is per origin (includes the port), plain text on the user's own disk, readable only by pages from this Ogden origin; the 7-day TTL bounds how long a secret lingers. Different port on next start → earlier drafts unseen; they expire.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors
- `pnpm test` -- expected: all pass
- `pnpm e2e` -- expected: all pass
- `pnpm run pack && pnpm smoke` -- expected: pass
