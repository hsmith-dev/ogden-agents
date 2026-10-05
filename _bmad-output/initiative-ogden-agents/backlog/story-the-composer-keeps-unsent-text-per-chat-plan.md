---
title: 'The composer keeps unsent text per chat'
type: 'feature'
ticket: '6'
created: '2026-10-04'
status: 'built'
baseline_revision: '1319f268f444986c8f73018435781367a786408b'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
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

- Implemented directly in this session (no separate coding subagent): small change, the session already held the investigation.
- `drafts.ts` owns the policy (key `ogden-agents.draft.v1:<wsId>:<sesId|new>`, `{ text, savedAt }`, 7 days, 100 000 chars, 50 drafts); prune runs once per page load and when a new draft is added, never per keystroke over all entries.
- `Composer`: text starts from the draft; a `draftKey` change swaps text during render (SessionPage stays mounted across chats); an effect saves; the accept path calls `clearDraftIfUnchanged` with the key captured at submit (works after unmount, the first-chat flow) and clears the field only if the page is still on that key.
- Tests: `packages/web/test/drafts.test.ts`, `packages/web/test/composer-drafts.dom.test.tsx`, `tests/e2e/composer-drafts.spec.ts`. EXPERIENCE.md Composer row updated.

## Plan Change Log

## Review Triage Log

Pass 1 (quick lens; UX and privacy focus). Verdicts: high 0, medium 3, low 5, false 0, maybe-false 0; 1 rejected low. No intent_gap, no bad_plan.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | Text typed during a first-chat send stays under `<ws>:new`, unseen until the project is empty again | low | defer | Real: `onlyFirstChat` is lost on remount. Before this change that text was lost outright; the fix needs a carry-over into the new chat's key. deferred-work.md |
| 2 | Not-sent text prepended twice when the composer remounts (404 detour), and could land in another chat | medium | patch | Reproduced in a DOM test. The composer now skips a restore key already applied before mount. |
| 3 | A refused send after moving chats shows its error under the other chat | medium | patch | Error cleared on key change, and a refusal for a left chat is not shown; the text stays in that chat's draft. DOM test. `sending` carry-over is pre-existing, left. |
| 4 | The 7-day TTL is enforced only when Ogden loads again on the same origin | medium | patch | True (the port may change). Doc comment and Design Notes now say so; no code can clear another origin's storage. |
| 5 | A future `savedAt` never expires and is never evicted | low | patch | Entries dated more than a day ahead now count as expired. Unit test. |
| 6 | Deleting a chat or project leaves its draft until expiry | low | defer | Real; needs deletion events wired to drafts. deferred-work.md |
| 7 | The cursor lands before a restored draft; there is no cue that the text was kept | low | patch (caret) | The e2e check reproduced the caret at 0. The cursor is now set after the text on mount and on a chat change. Adding a cue is not part of the intent: rejected. |
| 8 | The e2e "leave and return" was a full load, not an in-app move | low | patch | Added an e2e test that moves between two chats through the sidebar links. |
| 9 | The two plan ACs (no leak; two tabs) had no tests | low | patch | The e2e test checks that no request or console line carries the draft. A DOM test covers two composers on one key. |
| 10 | Every keystroke parses and rewrites the whole draft | low | reject | Within the plan. This is a few ms at the 100 000-character cap, and debouncing risks losing text on unload. |

## Design Notes

Why browser storage, not the server: a draft can hold a pasted secret; the server keeps an append-only event log and AGENTS.md says mask secrets in anything stored. `localStorage` is per origin (includes the port), plain text in the browser profile, readable only by pages from that origin. The 7-day TTL is enforced when Ogden next loads on the same origin; drafts on a port Ogden no longer uses (or never reopened) stay until the browser's site data is cleared (review finding 4).

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors
- `pnpm test` -- expected: all pass
- `pnpm e2e` -- expected: all pass
- `pnpm run pack && pnpm smoke` -- expected: pass
