---
title: 'Tool rows wait in words; Normal and Verbose detail per chat'
type: 'feature'
ticket: '4'
created: '2026-10-31'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
baseline_revision: '147801c01aefefe089eee8e28dcc699229a9dc09'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-everyday-polish/epic-everyday-polish.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A tool row whose permission card is still open reads "Running npm test" with the working glyph, contradicting the card (audit Chat mid-turn, top 10 #4); and how much tool detail a chat shows is decided by density, so a developer in Compact gets every row but diffs still closed, and nobody can choose per chat (E26-R4).

**Approach:** The transcript marks each tool call held by a pending card (and one denied); its row reads "Waiting for you: <target>" with the waiting glyph, then Running and Ran as the call proceeds, or "Denied: <target>". Each chat gets a detail level, Normal or Verbose, remembered in this browser (Normal by default, Verbose by default in Developer mode), switched from the session header menu ("Show every step" / "Show less detail") keeping the item in view still; Normal groups consecutive calls as today, Verbose lists every call with edit diffs open. Density no longer decides grouping.

## Boundaries & Constraints

**Always:** words follow EXPERIENCE.md Tool-call row and Detail level; no em or en dashes in UI strings; existing DESIGN.md tokens only; the level is per chat (session id) in `localStorage`, guarded (storage may throw), never sent to the server; the menu is present on every chat with a session (handoff item still only with several agents); one setter for the level, so the palette (26.3) can call it.

**Never:** the permission card's buttons, Always allow scope or record line (26.8); Normal's "Changed 3 files" row and Review changes (8.4); command output in rows (not in the transcript model); server or shared contract changes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Held at card | execute call `pending`, its card pending | "Waiting for you: npm test", waiting glyph, no working glyph | No error expected |
| Allowed | card resolved allow, call `pending` or `in_progress` | "Running npm test", working glyph | No error expected |
| Finished | call `completed` | "Ran npm test" | No error expected |
| Denied | card resolved `deny` | "Denied: npm test", no "Failed" tag | No error expected |
| Card unanswered (agent gone) | permission `unanswered` | as today (verb by status) | No error expected |
| Normal, group with a held call | read, read, execute held | group row "Read 2 files" then the held row on its own, below it | No error expected |
| Verbose | 3 reads and an edit | four rows, the edit's hunk shown without a click | No error expected |
| Default | no stored choice; Developer mode off / on | Normal / Verbose | No error expected |
| Stored choice | chosen Verbose, reload | Verbose | storage throws: default, menu still switches for this page |

</frozen-after-approval>

## Code Map

- `packages/web/src/chat/transcript.ts` -- `TranscriptToolCall` (add optional `held?: 'waiting' | 'denied'`), the fold's `permissions` map; after the loop (where pending becomes `unanswered`, ~line 377) mark `toolCalls.get(permission.toolCall.toolCallId)`: pending → `waiting`, resolution decision `deny` → `denied`. Tool call objects are fresh per fold.
- `packages/web/src/chat/tool-call-row.tsx` -- `toolCallLabel` (verb from `VERBS` by status; add held words "Waiting for you:" / "Denied:"), `RowLine` (working glyph while running; Failed tag), `ToolCallRow` (expand state), `ToolCalls({calls, density})` (density rule at line ~207). Replace `density` with `detail: ChatDetail`; reuse `groupSummary`, `diffHunk`, `StateGlyph state="waiting"`.
- `packages/web/src/chat/session-menu.tsx` -- `SessionMenu({blockedReason, onContinue})`; testids `session-menu`, `session-menu-continue`, `session-menu-continue-reason` used by `tests/e2e/handoff.spec.ts` and `session-page.dom.test.tsx`. Make Continue optional, add the detail item.
- `packages/web/src/routes/session-page.tsx` -- renders `<ToolCalls ... density={appearance.density}/>` (~569), the menu only when `severalAgents` (~507), scroll container via `scroller()` (`[data-slot="page-body"]`), `section[data-testid="transcript"]`, Show earlier anchor pattern (~207-226).
- `packages/web/src/chat/drafts.ts` -- guarded storage pattern to copy (env with `storage()`); `useAppearance().appearance.developerMode`.
- Tests: `packages/web/test/transcript.test.ts` (`toolCallLabel`, `groupSummary` cases ~300), `session-page.dom.test.tsx` (mocks appearance with `developerMode: true`); e2e `tests/e2e/session-behaviour.spec.ts` lines 33-64 (Compact lists rows: rewrite to the detail rule), `chat-scroll.spec.ts` (data-status only), helpers `withChatServer`, `startChat`, `send`, `setDeveloperMode` in `tests/e2e/chat-server.ts`; fake agent `permission-hold` (held then `in_progress` after allow), `tools` (3 reads, 1 edit with diff).

## Tasks & Acceptance

**Execution:**
- [x] `packages/web/src/chat/transcript.ts` -- add `held` and mark it after the fold.
- [x] `packages/web/src/chat/detail-level.ts` (new) -- `ChatDetail = 'normal' | 'verbose'`, one bounded map in `localStorage` (`ogden-agents.chat-detail.v1`, at most 200 chats, oldest dropped), `chatDetailOf(sesId)`, `setChatDetail(sesId, level)` (runs before-change listeners, writes, notifies), `onBeforeChatDetailChange`, `useChatDetail(sesId)` (stored, else Verbose in Developer mode, else Normal; follows other tabs via `storage`), and `DETAIL_MENU_WORDS`.
- [x] `packages/web/src/chat/tool-call-row.tsx` -- held words and glyph; `ToolCalls({calls, detail})`: Verbose lists all rows with diffs open, Normal groups as today but shows held calls on their own rows after the group; rows keyed by detail so open state resets on switch.
- [x] `packages/web/src/chat/session-menu.tsx` -- `detail` + `onDetail` item (Phosphor `ListBullets` / `ListDashes`), `onContinue` optional.
- [x] `packages/web/src/routes/session-page.tsx` -- pass `detail`; menu always once the session loaded; on before-change capture the first transcript child in view and its offset, and restore it in a layout effect after the switch.
- [x] `packages/web/test/tool-call-row.test.ts` + `detail-level.test.ts` (new), `transcript.test.ts` -- matrix rows: labels per held state, fold marks held, grouping per level, storage default, stored, throwing storage, bound.
- [x] `tests/e2e/tool-row-detail.spec.ts` (new) -- the verify: `permission-hold` reads "Waiting for you: npm test", then "Running npm test" after Allow once; `tools` in Verbose shows the hunk without a click, survives reload, "Show less detail" groups again.
- [x] `tests/e2e/session-behaviour.spec.ts` -- Compact density keeps the group (detail decides, not density).

**Acceptance Criteria:**
- Given a chat scrolled so a message sits mid-view, when the user switches the detail level, then that message stays within a few pixels of where it was.
- Given one agent installed, when a chat opens, then the header `…` menu offers "Show every step" (Normal) and no handoff item.

## Implementation Notes

- `useChatDetail(sesId, developerMode)` takes Developer mode as an argument instead of reading the appearance context, so components mocked without the provider (and tests) need nothing extra.
- The row test is `packages/web/test/tool-call-row.test.tsx` (JSX, rendered with `renderToStaticMarkup`).
- A denial counts only when the resolution is `deny` by the user, a rule or the caution level; `deny` by `cancelled` (a step stopped for a send now) leaves the row to its status, like an unanswered card.
- The waiting glyph uses `labelMode="none"`: the row's words already say "Waiting for you", so it is not read twice.
- Chromium's own CSS scroll anchoring already keeps the item in view; the e2e scroll test turns it off (`overflow-anchor: none`) so it proves the page's anchoring, which Safari relies on. Checked: without the restore the message moved 183 px and the test failed.
- The scroll anchor is the item starting in view nearest the view's middle that is not tool calls (else the first starting in view, else the one the view starts inside): with a tool row in view above the message, anchoring the first non-tools item let that row push the message 76 px. No anchor is kept when the setter is called with the level already shown.
- Verification after review patches: `pnpm typecheck` clean; `pnpm test` 5132 passed, 24 failed, 10 skipped under load average ~225 (timeouts in 15 server/adapter files and the timing bounds in `chat-markdown.dom.test.tsx`, none touched here); each failing file then passed alone. `pnpm run build` passes; the five Verification specs 18 passed; provenance passes.

## Plan Change Log

## Review Triage Log

Pass 1 (quick lens, fresh subagent): 5 findings; medium 1, low 2, false 2, maybe-false 0.

| # | Finding | Verdict | Route |
|---|---------|---------|-------|
| 1 | The scroll anchor is the first child starting in view, which can be a tools item above the message the reader looks at; Verbose grows it and pushes the message down | medium | patch: the anchor is the non-tools item starting in view nearest the view's middle (the first non-tools item still let a tool row above the message push it 76px); e2e case added with an edit row in view above the message |
| 2 | `setChatDetail` with the level already shown stores an anchor the layout effect never clears; a later change from another tab or Developer mode applies the stale offset | low | patch: the listener stores no anchor when the next level equals the current one |
| 3 | Deferred items are not added to `deferred-work.md` | false | parallel-safety rule for this build: deferred items live in this plan's Deferred section only |
| 4 | A denied call never rejoins the Normal group | false | intended: the matrix's Denied row requires "Denied: npm test" to read on the row; folding it into the group summary would hide it |
| 5 | `chat-scroll.spec.ts` comment still says the held tool call shows "In progress" | low | patch: comment updated to "Waiting for you" |

## Design Notes

Held state lives in the fold, not the row, because the permission and the tool call are separate transcript items linked only by `toolCall.toolCallId`. Pulling a held call out of a Normal group keeps "Waiting for you" readable right above its card instead of hidden in "Read 2 files, ran 1 command"; once allowed it rejoins the group. Scroll keeping anchors by child index of the transcript section: switching changes only what a tools item contains, never how many items there are.

## Deferred (for the sweep)

- Verbose "with its input" and command output open: the transcript has neither (title only); needs the adapter to carry `rawInput`/output content. (26.9: logged in `deferred-work.md`.)
- Palette action "Show every step" (26.3 uses `setChatDetail`). (26.9: done by 26.3.)

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors
- `pnpm test` -- expected: full suite passes
- `pnpm run build && pnpm exec playwright test tests/e2e/tool-row-detail.spec.ts tests/e2e/session-behaviour.spec.ts tests/e2e/chat-scroll.spec.ts tests/e2e/handoff.spec.ts tests/e2e/permissions.spec.ts` -- expected: pass
- `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs` -- expected: pass
