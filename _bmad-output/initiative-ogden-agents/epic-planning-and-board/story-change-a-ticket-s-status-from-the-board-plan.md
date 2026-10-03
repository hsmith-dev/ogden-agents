---
title: "Change a ticket's status from the board"
type: 'feature'
ticket: '10'
created: '2026-10-02'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'security', 'ux-a11y']
review_loop_iteration: 0
baseline_revision: '5e5cf8ede8d665100687b7da55ffaaf7d90dd997'
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The board (4.9) is read-only and `PUT …/tickets/:ref/status` still answers 501. E4-R9 needs a person to set a ticket's status from the board ("Move to Ready"), written through `tickets.py mark` into the plan file, never `done`.

**Approach:** Fill the pre-registered route with core's existing `board.mark` use-case (piece guard, script trust, verified BMad, exact ref, `done` refused), which runs `TicketStorePort.mark` → `tickets.py mark` in the main checkout. Add a per-repo serialization and an optimistic "expected status" precondition so a change the user hasn't seen (an agent's write, a `git pull`) is never silently overwritten. Add a keyboard and screen-reader friendly status menu on each card and in the detail sheet; the card moves when 4.8's watcher emits `ticket.changed` (and the mutation's own invalidation).

**Decisions (user, epic 4 approval and 2026-10-01):** every status a person may set is offered except Done (draft, ready-for-dev, in-progress, in-review, built, blocked, dropped; the current one is left out). Writes go only through the verified-source `tickets.py`, only for a trusted project with Board on, with exact refs. No drag in v1, no optimistic UI: the card changes only when the files say so.

**Decision (this plan, concurrency):** `MarkTicketRequest` gains an optional `expectedStatus` (a `TicketStatus` or `''` for no status), and `API_ERROR_CODES` gains `ticket_changed` (409, `TICKET_CHANGED_MESSAGE`). When given and the plan's status no longer matches, nothing is written. Both are append-only, backward-compatible contract additions.

**Decision (user, 2026-10-02, reopen):** moving a ticket out of Done from the board is allowed, but only after a "Reopen this ticket?" confirmation (an accessible dialog: keyboard and screen reader; an alert dialog on a card, an inline `role="alertdialog"` in the detail sheet, never a second modal). Moving into Done stays refused (the UI never offers it; the API answers `done` with 409 `status_not_allowed`, reopen or not). Server side, a change whose `expectedStatus` is `done` must carry `reopen: true`, else 409 `reopen_not_confirmed` (`REOPEN_NOT_CONFIRMED_MESSAGE`) and nothing runs; `reopen` goes only with `expectedStatus: 'done'` (else 400). Append-only contract additions: `MarkTicketRequest.reopen`, `reopen_not_confirmed` in `API_ERROR_CODES` (after `ticket_changed`), the confirmation texts in `planning.ts`. This supersedes the S5b+U15 reject below.

## Boundaries & Constraints

**Always:** The route is registered through `bmadPieceRoutes` (already: `board`, trust); core re-checks the guard, trust and download. The ref matches `TICKET_REF_PATTERN` and the adapter's exact `find` (4.2) runs before `mark`; the script gets argv only (`mark <ref> <status> [--blocked=<reason>]`, no shell); the status is a `TicketStatus` enum value; the blocked reason is one argv element (`tickets.py` JSON-quotes it, so a newline can't add a frontmatter key). Marks of one repo run one at a time (core). Errors become plain messages: 400 invalid request, 404 no such ticket, 409 `status_not_allowed`/`ticket_changed`/`scripts_not_trusted`/`feature_off`/`bmad_not_downloaded`, 503 `tickets_unavailable` (store refusal message included). A PUT body is capped (small `bodyLimit`, after the guard). Accessibility: the menu trigger is a real button outside the card link (no nested interactive), named "Change status of <ref> <title>"; Radix menu keys (Enter/Space/arrows/Esc); a blocked status asks for a reason in a dialog with a labelled field; the result is announced once in a polite status region ("1.2 moved to Ready"), failures in an alert; focus returns to the moved card. New texts are appended to `planning.ts` (after 4.9's block), no em or en dashes.

**Never:** No `done` offered or sent; no file written by a route or the web; no script run in the web; no drag; no optimistic card move; no poll timer; no new dependency. Shared-file edits minimal and append-only (4.7 runs in parallel off 4.9). Tests never run real `claude`, the keychain or the network, never read the real `~/.claude`; test hooks only via `testHooksAllowed`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error handling |
|---|---|---|---|
| Move to Ready | planned 1.2, menu → Move to Ready | `tickets.py mark 1.2 ready-for-dev` creates the plan with `status: ready-for-dev`; 200 `{ref, status}`; card moves to Ready within seconds | — |
| Done | `PUT {status:'done'}` | 409 `status_not_allowed`, no run, no file change; the menu never lists Done | — |
| Blocked | Move to Blocked, reason "Needs the API key" | plan gets `status: blocked`, `blocked_at`, `blocked_reason`; card in Blocked | empty reason: the dialog won't submit; 400 from API |
| Unblock | blocked 1.3 → Move to Ready | blocked fields cleared | — |
| Reopen | Done 1.9, menu → Move to Ready | "Reopen this ticket?" first; Cancel or Esc sends nothing, focus back on the button; Reopen sends `{status, expectedStatus:'done', reopen:true}`, 200 | no `reopen` → 409 `reopen_not_confirmed`, no run |
| Stale view | UI saw `''`, an agent wrote `in-progress` meanwhile | 409 `ticket_changed`, nothing written; board refetches; message shown | — |
| Two clicks at once | two PUTs for one repo | run one after the other, never interleaved | — |
| Script fails | `tickets.py` exit 1 / timeout / tracker store | 503 with its plain message; card unchanged | message shown inline, menu usable again |
| Bad ref / unknown | `../x`, `-h`, `9.9`, a title word | 400 / 404, nothing run beyond `find` | — |
| Gates | Board off / untrusted / not downloaded | 409 `feature_off` / `scripts_not_trusted` / `bmad_not_downloaded`, nothing run | — |
| Keyboard | Tab to the card's status button, Enter, arrows, Enter | status changes; focus lands on the moved card | — |

</frozen-after-approval>

## Code Map

- `packages/core/src/board.ts` -- `mark` already guards, checks ref, parses `MarkTicketRequest`, refuses `done`. Add: per-repo promise chain around the store call; pass `expectedStatus` through.
- `packages/core/src/ticket-store-port.ts` -- `mark(..., options?: {blockedReason?, expectedStatus?})`; doc that a mismatch rejects with `TicketChangedError`. `packages/core/src/errors.ts` -- add `TicketChangedError` (code `ticket_changed`) beside `StatusNotAllowedError:161`; export via `index.ts` if not wildcard.
- `packages/adapters/src/tickets-v7/index.ts:275` `mark` -- after its exact `find`, compare `picked.status ?? ''` with `expectedStatus`; update header comment (route no longer 501). `packages/adapters/src/tickets-memory/index.ts:102` -- same check.
- `packages/shared/src/planning.ts:298` `MarkTicketRequest` (add optional `expectedStatus`), texts appended after `boardCardLabel` (~l.640): `TICKET_CHANGED_MESSAGE`, `boardChangeStatusLabel(ref,title)`, `BOARD_CHANGE_STATUS_LABEL` ("Change status"), `BOARD_DROP_LABEL` ("Drop this ticket"), `boardMovedText(ref, label)`, `TICKET_SAVING_TEXT`, blocked dialog texts (title, reason label, Save, Cancel). Existing `boardMoveToText(column)`, `MARKABLE_TICKET_STATUSES`, `TICKET_MARK_FAILED`, `MAX_BLOCKED_REASON_LENGTH`, `STATUS_NOT_ALLOWED_MESSAGE`. `packages/shared/src/errors.ts:88` -- append `ticket_changed` before `internal_error`.
- `packages/server/src/planning-routes.ts:198` -- replace the 501 stub: `bodyLimit`, `readBody(c, MarkTicketRequest)`... (or pass raw JSON to `board.mark`, which validates), map `ValidationError`→400, `TicketChangedError`→409, `TicketsUnavailableError`→`ticketsUnavailable`. `NotFoundError`/`StatusNotAllowedError` already map in `bmad-pieces.ts refusal`. Log ref and status only (never the reason). Update the header comment.
- `packages/web/src/planning/planning-api.ts` -- add `markTicket(wsId, ref, body)` (`PUT`, `TICKET_MARK_FAILED`, `MarkTicketResponse`) and `useMarkTicket(wsId)` (TanStack `useMutation`; on settle invalidate `['tickets', wsId]` and `['ticket', wsId, ref]`).
- New `packages/web/src/planning/ticket-status-menu.tsx` -- trigger + `DropdownMenu*` from `@/ui/dropdown-menu` listing `MARKABLE_TICKET_STATUSES` minus the current (labels: `boardMoveToText(columnOfStatus)`, dropped → `BOARD_DROP_LABEL`), Blocked opens a dialog (`@/ui/dialog` or `alert-dialog`, `@/ui/textarea`, `@/ui/label`) for the reason. Sends `expectedStatus: row.status ?? ''`.
- `packages/web/src/planning/ticket-card.tsx` -- wrap the `Link` in a relative container; the menu trigger is a sibling (top-right, ≥24px target, visible always, not hover-only). Keep `data-testid="ticket-card"` on the link. `board-epic.tsx`/`board-tickets.tsx` -- thread one stable mark handler; board-level polite status + error `Notice` (role alert); after success, once the refetch lands, focus `[data-testid=ticket-card][data-ref=…]` when focus fell to `body`.
- `packages/web/src/planning/ticket-sheet.tsx` -- Status section gains the same menu; errors inline. Update its doc comment ("Read-only" → status changes allowed).
- Tests to update: `packages/server/test/planning-routes.test.ts:230-272` (501 expectation → real behaviour), add real-uv mark test (pattern l.497-520 and the 4.8 watcher test l.520+); `packages/shared/test/planning-contracts.test.ts`; `packages/web/test/plan-and-board.dom.test.tsx`; `tests/e2e/plan-and-board.spec.ts` (memory store via `createMemoryTicketStore`, `stubSetupCatalog`). `gate.test.ts`/`bmad-guard-coverage.test.ts` lists already contain the route.
- Do not touch: `ticket-watcher.ts`, `folder-watch.ts`, `bmad-pieces.ts`, `router.tsx`, gate code.

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/{planning.ts,errors.ts}` -- `expectedStatus`, `ticket_changed`, texts; contract tests (expectedStatus accepts `''` and statuses, rejects others; new texts have no dashes).
- [x] `packages/core/src/{errors.ts,ticket-store-port.ts,board.ts}` -- `TicketChangedError`, port option, per-repo serialization (a failing mark doesn't break the chain); core tests with tickets-memory: done refused with no store call, expected mismatch → `TicketChangedError` and no write, two concurrent marks serialized (second starts after first settles), untrusted/off/not-downloaded refuse before the store.
- [x] `packages/adapters/src/{tickets-v7,tickets-memory}/index.ts` -- expected-status check after exact find; tickets-v7 unit test with a fake runner: argv exactly `['--project-root', repo, 'mark', ref, status, '--blocked=<reason>']`, mismatch runs no `mark`, a title-word ref never marks.
- [x] `packages/server/src/planning-routes.ts` -- fill the route; route tests (memory store): 200, 400 bad body/ref, 404, 409 done (store never called), 409 ticket_changed, 503 failure, body too large 413; real-uv test: fixture repo, Download, trust, `PUT 1.2 {status:'ready-for-dev', expectedStatus:''}` → plan file contains `status: ready-for-dev`, then `GET tickets` shows it in Ready, and with the watcher a `ticket.changed` for `1.2` within 3 s; `done` changes no file (`repo.hash()`); blocked reason with a newline and `status: done` text stays one quoted value.
- [x] `packages/web/src/planning/{planning-api.ts,ticket-status-menu.tsx,ticket-card.tsx,board-epic.tsx,board-tickets.tsx,ticket-sheet.tsx}` -- per Code Map.
- [x] Tests (web) -- DOM: the menu lists no Done and not the current status; choosing Move to Ready sends the PUT with `expectedStatus`; Blocked opens the dialog and requires a reason; a 503 shows its message and the card stays in its column; a 409 `ticket_changed` shows its message and refetches; status region text after success. e2e: keyboard only (Tab to "Change status of 1.2…", Enter, ArrowDown to "Move to Ready", Enter) → card in Ready column; Done absent; the sheet's menu works; a store `failWith` variant (or a ticket that 404s) shows the message.

**Acceptance Criteria:**
- Given a fixture repo through real uv, trusted and downloaded with Board on, when `PUT …/tickets/1.2/status {status:'ready-for-dev'}` runs, then the plan file holds `status: ready-for-dev`, the tree shows 1.2 Ready, and a `ticket.changed` for 1.2 arrives within 3 s; a `done` request changes no file.
- Given Playwright on the memory store, when a keyboard user moves 1.2 to Ready from the card menu, then the card sits in Ready and focus is on it; the menu never shows Done.
- Given the full suite, `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm run pack && pnpm smoke` pass.

## Implementation Notes

- Shared also gained `boardStatusActionText(status)` (menu item words, from the private status-to-column map), `boardStatusPlaceText(status)` (announcement words, "Dropped" for dropped) and `BOARD_BLOCKED_REASON_REQUIRED`; all appended after 4.9's block.
- Core serializes marks per repo with a promise chain in `createBoard` (a failed mark settles the tail, so the next still runs; the map entry is dropped when idle). Core tests use a gated fake store (core can't import `tickets-memory`, AD-1); the memory store's own check is covered in `tickets-memory.test.ts`.
- The route reads the body inside `bodyLimit` (1024 + 6 x `MAX_BLOCKED_REASON_LENGTH` bytes) after the guards and hands the raw JSON to `board.mark`, which validates it; it logs ref and status only.
- Web: `expectedStatus` is sent only for a known status or `''` (a status the board doesn't know sends none). The board focuses the moved card once its `data-column` matches the new status and focus fell to the page. The trigger is `aria-disabled` while its ticket saves, and one board change runs at a time.
- New unit test file `packages/adapters/test/tickets-v7-mark.test.ts` (fake runner argv, mismatch, title-word ref, exit 2).

## Plan Change Log

- 2026-10-02 (user decision, reopen): out of Done needs a confirmed reopen. Shared: `MarkTicketRequest.reopen` (`true` only, only with `expectedStatus: 'done'`), `reopen_not_confirmed` error code, `REOPEN_NOT_CONFIRMED_MESSAGE`, `REOPEN_ONLY_FROM_DONE_MESSAGE`, `BOARD_REOPEN_*` texts and `boardReopenDescription`. Core: `ReopenNotConfirmedError`, checked in `board.mark` before the store. Server: 409 mapping. Web: `TicketStatusMenu` asks "Reopen this ticket?" for a Done ticket (card: `AlertDialog`, focus on Cancel, focus back to the button; sheet: inline alert dialog, Esc closes only it), Blocked then asks its reason. Tests: core, server routes, shared contracts, DOM (card and sheet), e2e (keyboard only, Esc, Reopen, the API refusal). Rebased onto story 4.7 (`84ad8d4`); `baseline_revision` unchanged.

## Review Triage Log

### Pass 1 (2026-10-02; lenses: quick, security, ux-a11y)

Verdicts: high 0, medium 6, low 21, false 0, maybe-false 1 (quick Q1-Q5, security S1-S9, ux-a11y U1-U16; Q1+U4, Q2+U3 share a root cause).

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| Q1+U4 | While one save is pending, a choice on another card (even a typed Blocked reason) is silently dropped | medium | patch | `useBoardMarks` `if (pending.current) return`; only the busy card was disabled. Fixed: every trigger busy while a save is pending; "Saving" in the status region. |
| Q2+U3 | After "Drop this ticket" with dropped hidden, focus falls to `body` | medium | patch | Effect cleared `moved` without focusing. Fixed: focus the "Show dropped tickets" checkbox; the announcement says how to see it. |
| Q3 | The predicted column can never match (state dropped, `blocked_at`, a concurrent change), so `moved` stays and later steals focus | low | patch | `columnAfter` ignored `state`/`blocked_at`. Fixed: the mutation resolves after the refetch, so the card is focused wherever it is and `moved` always clears. |
| Q4 | `API_ROUTES.workspaceTicketStatus` doc lacks `ticket_changed`/`expectedStatus` | low | patch | Comment updated. |
| Q5 | "Say why it is blocked." defined twice | low | patch | One constant, used by the schema and the dialog. |
| S4 | Guards checked when a mark is queued, not when it runs | medium | patch | `board.mark` re-runs the guards inside the serialized run. |
| S5 | tickets-v7 `mark` itself doesn't refuse `done` | low | patch | Adapter refuses `done` before any run (defense in depth). |
| S8 | NUL/control characters or lone surrogates in a blocked reason answer 503 instead of 400 | low | patch | Rejected by `MarkTicketRequest`. |
| U1 | Blocked in the sheet stacks a modal dialog on the sheet's modal (EXPERIENCE.md bans it) | medium | patch | The sheet's reason form renders inline. |
| U2 | A planned ticket in Draft is offered "Move to Draft" | low | patch | Choices leave out the current column too. |
| U5 | The board shows only a dimmed icon while saving | low | patch | Covered by Q1's status-region text. |
| U6+U7 | The failure alert doesn't name the ticket and reads "couldn't read this project's tickets" for a write | medium | patch | `boardMarkFailedText(ref, message)` on board and sheet. |
| U8 | Empty-reason error not announced, focus stays on Save | low | patch | `role="alert"`, focus to the field. |
| U9 | Save is `aria-disabled` yet works | low | patch | Removed. |
| U10 | Blocked dialog title doesn't name the ticket | low | patch | Title carries the ref. |
| U12 | Dialog opened from a menu item: focus return and stuck `pointer-events` untested | maybe-false | patch | e2e of the board Blocked flow (Save and Cancel) checks focus and `body` pointer events. |
| S1 | `find` and `mark` resolve the ref in two processes; a tree change between them (epic renumbered, entry removed) can mark another ticket | low | defer | Needs a structural tree change in the milliseconds between two serialized runs; fixing it needs an upstream `tickets.py` option (mark by plan path / expected ref). Deferred. |
| S2 | The expected-status check is best effort against writers outside Ogden | low | reject | By design (Design Notes): the window is one serialized call; the watcher shows the result. |
| S3 | Upstream `tickets.py mark` truncates then writes (not atomic); a kill mid-write could cut a plan | low | defer | Pre-existing upstream behaviour; the write takes milliseconds against a 30 s timeout. Deferred to an upstream patch (temp file + rename). |
| S5b+U15 | A Done ticket can be moved out of Done from the menu | low | reject | The user's decision allows every board move except to Done; reported to the user. Superseded 2026-10-02: the user asked for a "Reopen this ticket?" confirmation and a server-side `reopen` flag (Plan Change Log). |
| S6 | `mark` follows a symlinked plan file | low | reject | Only in a trusted project, whose own Python already runs (4.2 trust model). |
| S7 | `expectedStatus` optional; unknown statuses and blocked fields not compared | low | reject | Optional by the contract decision (back-compatible); unknown statuses can't be expressed in the schema. |
| S9 | A post-mark refetch can join an in-flight `status` read and briefly show the old status | low | reject | The watcher's `ticket.changed` refetches within seconds. |
| U11 | `maxLength` truncates a long reason silently | low | reject | 500 characters; edge case, adds UI. |
| U13 | e2e lacks a below-`md` check of the card trigger | low | reject | The link reserves `pr-10` for the trigger; 4.9's narrow test still passes. |
| U14 | The card's icon button has no visible words | low | reject | Accessible name present; matches the card's compact design; the sheet shows the words. |
| U16 | The sheet's `ticket_changed` message says "check the board" after it already refetched | low | reject | Wording stays accurate; the status shown is current. |

## Design Notes

Why `expectedStatus` rather than last-writer-wins: the user picks from a menu built on what the board showed. If an agent (or a `git pull`) changed the status after that render, writing the user's choice would silently undo work they never saw. The check runs inside the adapter right after the exact `find` it already does, so it costs no extra script run. The remaining window (between that `find` and `mark`, milliseconds, both in one serialized core call) is accepted: `tickets.py` rewrites only the frontmatter keys of the file it just read, and the watcher then shows whatever the file says. A plan with git conflict markers fails to parse in `tickets.py`, so the mark fails with its plain message and writes nothing.

Status → label: `ready-for-dev` → "Move to Ready" via `boardMoveToText(boardColumnOf({status, state: ''}))` (or an exported status-to-column map); `dropped` → "Drop this ticket". The current status is omitted; a planned ticket (status `''`) offers all seven.

Plan size: about 2,300 tokens, over the 1,600 guide; kept whole (one route, its adapter check and its menu are one user goal, E4-R9).

## Verification

**Commands:**
- `pnpm typecheck && pnpm test` -- pass
- `pnpm e2e` -- pass
- `pnpm run pack && pnpm smoke` -- pass
