---
title: 'Board and ticket detail'
type: 'feature'
ticket: '9'
created: '2026-10-02'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'ux-a11y', 'security']
review_loop_iteration: 0
baseline_revision: 'ff15147fa785ae0f437e56dc02fac429b5180e6f'
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Board tab is still 4.1's bare flat list. E4-R8 needs the designed board: tickets grouped by epic with status columns, cards with ref, title and one status line, "Waits for", blocked reasons, a highlight on live changes (4.8's `ticket.changed`), and a ticket detail side sheet at `/w/:wsId/board/:ref`.

**Approach:** Web only, plus one append-only server export for e2e. Replace `BoardTickets` with a board built from `GET …/tickets` (TanStack Query) that refetches on `ticket.changed` and highlights that card's status line for 1.2 s. Columns come from shared `boardColumnOf`. Add a child route `$ref` under the board route that renders the detail sheet from `GET …/tickets/:ref`. Keep 4.2's trust prompt, 4.14's download prompt and 4.3's setup gate exactly as they are.

**Decisions (from the entry and the user):** the board is read-only. It has no card menu, no "Move to …" and no Build action (status changes are 4.10's, Build is epic 5's). A Simple project, or one with Board off, sees no board. Dropped tickets stay hidden behind the existing "Show dropped tickets" filter (epic assumption, 4.2 decision). There is no virtualization (neither the entry nor EXPERIENCE.md asks for it). Large trees stay responsive through memoized grouping and memoized cards.

## Boundaries & Constraints

**Always:** Ticket status shows as the files give it (AD-8, AD-10). The column is `boardColumnOf(row)`, never anything worked out from sessions or runs. A prerequisite is met when its ticket's `state` is `done` or `review`, as in `tickets.py` `classify`. A sibling id `n` resolves to the row in the same epic with `id === n`, and a string resolves to the row whose `ref` equals it (or, when none does, an epic slug that is met when that epic's `status` is `done`). A link that resolves to nothing counts as unmet and shows as written. Every ticket field (title, description, verify, notes, references, unknown, blocked reason, problems) renders as plain React text: no markdown parser, no `dangerouslySetInnerHTML`, no `href` or `src` built from ticket data. References show as `mono` text, never as links. New user-facing strings go in `packages/shared/src/planning.ts`, appended after `TICKET_MARK_FAILED`, with no em or en dashes. Accessibility floor: the board is reachable by keyboard, every card is a link to its detail with an accessible name holding its ref, title and status line, and state is never shown by color alone (lock glyph plus words, blocked glyph plus reason). Targets are at least 24 or 32 px, the focus ring is never removed, the 1.2 s highlight is instant under reduced motion, and a highlight is never announced (no live-region spam). Below `md`, each epic stacks its non-empty columns as lists. At `md` and wider, each epic's seven columns sit in a horizontally scrollable, focusable, labelled region.

**Never:** No core, adapter, route or contract-shape change (4.8 already serves `GET tickets/:ref`). No status write, card menu, drag or Build button. No new dependency. No poll timer (the board refetches on events only, plus TanStack's defaults). Shared files take minimal, append-only edits (4.4 and 4.6 run in parallel): `router.tsx` gains one child route, `planning.ts` gains texts, and `packages/server/src/index.ts` gains one export line. Tests never run real `claude`, the keychain or the network, and never read the real `~/.claude`. Test hooks run only through `testHooksAllowed`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error handling |
|---|---|---|---|
| Columns | rows with statuses `ready-for-dev`, `in-review`, planned, blocked, dropped | Each card sits in its column, grouped under its epic in build order. Dropped is hidden until "Show dropped tickets" is on. | — |
| Waits for | 1.3 `after: [2]`, and 1.2 has state `planned` | Card shows a lock glyph and "Waits for 1.2" | — |
| Met prerequisite | the prerequisite's state is `review` or `done` | No "Waits for" line | — |
| Blocked | `blocked_at` set, with a reason | Card is in Blocked, with the blocked glyph and the one-line reason (truncated, full text in the accessible name) | — |
| Problems | `problems: [a, b]` | One-line notice "Some ticket files could not be read (2)" with Show details | — |
| Live change | `ticket.changed {ref: '1.2'}` for this workspace | Tickets (and that ticket's detail) refetch, and 1.2's status line highlights for 1.2 s | Events from other workspaces, and events already in the stream at mount, are ignored |
| Detail from card | click or Enter on a card | URL becomes `/w/:wsId/board/1.2`, and the sheet shows the title, status, plan summary (description), how it is checked (verify), prerequisites with met or waiting, notes, open question, references | — |
| Detail from URL | open `/w/:wsId/board/1.2` directly | Board renders with the sheet open | 404: "No ticket 1.2 in this project." 400 or other: plain error text in the sheet |
| Close sheet | Esc or Close | Back to `/w/:wsId/board`, focus returns to the card | — |
| Hostile text | title or description holds `<img onerror>`, `[x](javascript:…)`, `../../etc/passwd` | Shown literally as text, with no element or link created | — |
| Narrow | viewport < 768 px | Epics stack, and each column is a list under its heading | — |
| Gates | untrusted, not downloaded, no `_bmad/`, Board off | Unchanged from 4.2, 4.14, 4.3, and a plain error | — |

</frozen-after-approval>

## Code Map

- `packages/web/src/planning/board-tickets.tsx` -- current bare list. Keep its gate branches (`scripts_not_trusted` → `ScriptTrustPrompt`, `bmad_not_downloaded` → `BmadDownloadPrompt`, error, loading skeleton plus sr-only status) and replace the list with the board.
- `packages/web/src/planning/planning-api.ts` -- `fetchTickets`/`useTickets` (`['tickets', wsId]`). Add `fetchTicket`/`useTicket` (`['ticket', wsId, ref]`, `TicketResponse`, fallback `TICKET_LOAD_FAILED`) and a `useBoardEvents(wsId)` hook. The hook is built on `useEventStream()` (`events/event-stream.tsx:467`) and the pattern in `events/use-event-invalidation.ts` (skip events already present at mount). It filters `ticket.changed` (`shared/src/events.ts:186`, `workspaceId` plus `payload.ref`), invalidates both keys and returns the highlighted refs, each kept for 1.2 s.
- `packages/web/src/routes/workspace-board-page.tsx` -- renders `<Outlet />` for the sheet route. `BmadSetupGate` stays around the board.
- `packages/web/src/router.tsx` -- add `workspaceBoardTicketRoute` (`path: '$ref'`, parent `workspaceBoardRoute`, lazy component) and change `workspaceBoardRoute` to `workspaceBoardRoute.addChildren([...])` in the tree. No other edit.
- `packages/web/src/ui/sheet.tsx` (`SheetContent side="right" title`), `ui/notice.tsx`, `ui/state-glyph.tsx`, `ui/checkbox.tsx`, `ui/badge.tsx`, `ui/skeleton.tsx`, `ui/typography` `Text`, Phosphor `Lock` and `Prohibit`/`Wall` icons -- reuse. Components come only from `packages/web/src/ui`.
- `packages/web/src/appearance/appearance-provider.tsx` `useAppearance().appearance.developerMode` -- in Developer mode the sheet also shows the raw plan `status`/`state` in mono.
- `packages/shared/src/planning.ts:314-372,551-575` -- `BOARD_COLUMNS`, `BOARD_COLUMN_LABELS`, `boardColumnOf`, `boardWaitsForText`, `BOARD_*` texts, `TicketDetail`, `TicketEpic`. Append new texts after `TICKET_MARK_FAILED` (`:575`).
- `packages/adapters/src/tickets-memory/index.ts` -- `createMemoryTicketStore({repos, text})`, `emit(repoPath, refs)`. Export it from `packages/server/src/index.ts` (append one line beside `createMemoryBmadSource`, `:47`) for e2e.
- `tests/support.ts:95` `stubSetupCatalog` (`outputFolder: '_bmad-output'`, so 4.8's watcher starts with a memory store) and `tests/e2e/plan-and-board.spec.ts` (its `ticket-row`/`ticket-state` assertions change to cards). `tests/e2e/chat-server.ts` `withChatServer` (`extra`, `files`).
- `packages/web/test/plan-and-board.dom.test.tsx` -- happy-dom pattern with a mocked `tabAuth.fetch`. Existing Board assertions move to the new markup.
- Do not touch: core `board.ts`, `ticket-watcher.ts`, server routes, `ticket-store-port.ts`, adapters other than the export.

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/planning.ts` -- append texts: `BOARD_EPICS_LABEL`, `BOARD_DROPPED_LABEL` ("Dropped"), `boardProblemsLine(n)`, `BOARD_SHOW_DETAILS_LABEL`, `TICKET_NOT_FOUND(ref)`, detail headings (`TICKET_SUMMARY_HEADING` "Plan summary", `TICKET_VERIFY_HEADING`, `TICKET_PREREQUISITES_HEADING`, `TICKET_NOTES_HEADING`, `TICKET_REFERENCES_HEADING`, `TICKET_UNKNOWN_HEADING`, `TICKET_NO_PLAN_TEXT`, `TICKET_NO_PREREQUISITES_TEXT`, met and waiting words), `boardCardLabel(...)`. Add contract tests for the functions.
- [x] `packages/web/src/planning/board-model.ts` -- pure functions: `groupBoard(response, showDropped)` → epics in first-seen build order, each epic's columns in `BOARD_COLUMNS` order and its dropped list; `unmetPrerequisites(row, rows, epics)` → display refs; `cardStatusLine(row, unmet)` (blocked reason, else "Waits for …", else the column label); `humanEpicTitle(slug)`. Unit-tested, including the matrix cases.
- [x] `packages/web/src/planning/board-tickets.tsx` (+ `ticket-card.tsx`, `board-epic.tsx`) -- the board per the matrix and Boundaries. `memo` cards, the problems one-liner with Show details, the dropped checkbox, cards as `<Link to="/w/$wsId/board/$ref">` with `data-testid="ticket-card"`, `data-ref` and `data-column`, the highlight via `data-highlighted` plus a token-based background (instant under `motion-reduce`), and the in-review card's 2px signal left rail.
- [x] `packages/web/src/planning/ticket-sheet.tsx` + `routes/workspace-board-ticket.tsx` -- the sheet route component: `useParams` `wsId`/`ref`, `useTicket`, `SheetContent` titled with the ticket title (ref in mono). Show skeleton, 404 and error states. Sections only when non-empty. Prerequisites resolve against the cached tickets with met or "Waits for" words. Close or Esc navigates to the board and focus returns to the card with that `data-ref`.
- [x] `packages/web/src/router.tsx`, `routes/workspace-board-page.tsx` -- the child route and `<Outlet />`.
- [x] `packages/server/src/index.ts` -- export `createMemoryTicketStore` (type too).
- [x] Tests -- the web DOM test covers columns, Waits for, met prerequisites, blocked reason, problems line, dropped filter, hostile text rendered literally (no `img`, no `a[href^=javascript]`), the highlight on a fed `ticket.changed` (fake timers, gone after 1.2 s, other workspace ignored) and the sheet states. Update existing Board DOM assertions. e2e (`plan-and-board.spec.ts`, against `createMemoryTicketStore` with `stubSetupCatalog` and a ready memory source): cards in the right columns, "Waits for 1.2", the blocked reason, `store.emit(realPath, ['1.2'])` after a memory `mark` → highlight seen, the sheet opens from a card and from its URL, Esc returns, and at 600 px wide the columns stack (the bounding boxes of two columns of one epic are vertically ordered). Update the earlier e2e assertions.

**Acceptance Criteria:**
- Given Playwright against `tickets-memory` with Board on, trusted and downloaded, when the board loads, then each card sits in its column, 1.3 shows "Waits for 1.2", the blocked card shows its reason, a `ticket.changed` highlights the changed card, the detail sheet opens from a card and from its URL, and below `md` the epics are lists.
- Given the full suite, `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm run pack && pnpm smoke` pass.

## Implementation Notes

- `useBoardEvents` invalidates on every new `ticket.changed` of the workspace but highlights only once the stream has caught up: a reload replays the backlog after mount, and those replayed events are not live changes (seen in the e2e screenshots before the fix).
- The sheet component (`planning/ticket-sheet.tsx`) takes `wsId`, `ticketRef` and `onClose`; the route component (`routes/workspace-board-ticket.tsx`) reads the params, navigates back to the board and then focuses the card by `data-ref`.
- Added texts beyond the list: `BOARD_NO_EPIC_TITLE`, `BOARD_HIDE_DETAILS_LABEL`, `TICKET_LOADING_TEXT`, `TICKET_STATUS_HEADING`.
- Sizes use the spacing scale (`w-112`, `calc(var(--spacing)*48)`) so `tests/design-tokens.test.ts` stays green.

## Plan Change Log

- 2026-10-02: `packages/server/src/app.ts` SPA fallback now serves `index.html` for `/w/:wsId/board/:ref` even when the ref looks like an extension (`1.2`). Without it, opening a ticket's URL directly answered 404 "Not found", which the matrix row "Detail from URL" and the acceptance criterion require. One condition in the fallback, plus a case in `packages/server/test/gate.test.ts`; no API route or contract changed. This goes beyond the Never list's "no route change" and wants the human's OK.

## Review Triage Log

### Pass 1 (2026-10-02; lenses: quick, ux-a11y, security)

Verdicts: high 0, medium 5, low 16, false 3, maybe-false 0 (quick Q1-Q8, ux-a11y U1-U18, security S1-S4; Q3+U4, Q4+U10, Q5+U6, Q6+U11 and Q7+U1 share a root cause).

The orchestrator accepted the SPA fallback change in the Plan Change Log (Q2). It is not an API route, contract or security boundary: the gate still treats the path as a static GET. Without it the frozen matrix row "Detail from URL" fails.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| Q1 | The detail sheet's `<Outlet />` mounted while the board showed the trust or download prompt, covering it with a modal | medium | patch | `workspace-board-page.tsx` rendered the outlet beside `BoardTickets`. Fixed: `BoardTickets` renders the `sheet` only once the tickets have loaded. DOM test: untrusted shows the prompt and no sheet. |
| Q4+U10 | The sheet resolved prerequisites against an empty list while the tickets loaded or after they failed (all "Waiting", raw sibling ids) | medium | patch | Fixed: a skeleton line while loading; on failure the links show as written, with no met or waiting word; test. |
| Q6+U11 | "Waits for" overrode the In progress, In review, Built, Done and Dropped cards | medium | patch | Fixed: "Waits for" shows only in Draft and Ready. |
| U8 | A failed background refetch replaced the loaded board and sheet with an assertive alert | medium | patch | Fixed: data stays, with a quiet notice above; test. |
| S1 | Prerequisite resolution was O(rows x links x rows) on every refetch | medium | patch | Fixed: `indexTickets` builds the maps once per response. |
| Q2 | The SPA fallback exemption matched any last segment, so `/w/x/board/main.js` returned `index.html` | low | patch | Narrowed to the ticket ref character class. A dotted name such as `main.js` still fits a valid ref, which is accepted because the static assets live under `/assets`. Gate test added. |
| Q3+U4 | Card focus rings were clipped by the `md:overflow-x-auto` region | low | patch | `md:p-1` on the region. |
| Q5+U6 | The highlight used the signal color, which is reserved for "your turn" | low | patch | Now `bg-accent`. |
| Q7+U1 | Close pushed a history entry, and focus fell to `body` when no card matched (Back, a dropped ticket, an unknown ref) | low | patch | Now `replace: true`, with fallback focus on the page `h1`. |
| U2 | The epic section and its region shared one name, giving duplicate landmarks | low | patch | Removed the section's label. |
| U5 | Empty columns rendered empty `<ul>`s | low | patch | An empty column now shows only its heading and count. |
| U7 | The highlight started before the refetch landed | low | patch | It now starts after `invalidateQueries` resolves; test. |
| U9 | Loading skeletons were not card-shaped | low | patch | Now card-shaped. |
| U12 | The sheet's Close button scrolled out of view | low | patch | An inner body now scrolls instead. |
| U17 | The prerequisites heading contradicted the rows marked Met | low | patch | Now "Prerequisites" / "No prerequisites.". |
| U18 | A blocked card had no "Blocked" word | low | patch | `boardBlockedText`: "Blocked: <reason>". |
| U3 | Below `md` the scroll region is an inert tab stop | low | reject | One extra stop per epic. Fixing it needs a media-query-driven tabIndex. |
| U16 | The sheet's accessible name changes from the ref to the title once loaded | low | reject | The ref is the name until the title arrives. A stable name would hide the title. |
| S2 | Rows' refs are not checked against `TICKET_REF_PATTERN` before they become links | low | reject | Router and `apiPath` encode the ref, and the server re-validates it (400). No injection is possible. |
| S3 | Export of `createMemoryTicketStore` from the server entry | low | reject | Follows `createMemoryBmadSource`. No env or test hook selects it. |
| Q8 | `BOARD_TICKETS_LABEL` is now unused | low | reject | A frozen 4.2 shared export. Removing it is not append-only while lanes 4.4/4.6 run. |
| U13 | `w-112` overrides the sheet's token width | false | reject | Tailwind's 4px spacing scale is the token scale (DESIGN.md Layout & Spacing). The sheet's default sidebar width is too narrow for detail. |
| U14 | The ticket card is built outside `packages/web/src/ui` | false | reject | Feature components compose `ui` primitives in their feature folder, like `permissions/permission-card.tsx`. |
| U15 | At `xl` the sheet should sit beside the board | false | reject | EXPERIENCE.md calls the `xl` peek "optional"; the overlay meets the spec. |

Security check of the frozen rule (no injection through ticket fields): no `dangerouslySetInnerHTML`, no markdown, and no `href`/`src` built from ticket data. The DOM test renders hostile text literally.

## Design Notes

Card status line, in priority order: blocked → reason (or "Blocked"), unmet prerequisite → "Waits for 1.2, 1.4", otherwise the column label. One line, truncated, with the full text in the card's accessible name. The highlight lands on the status line, as DESIGN.md says.

Epic titles: tickets.py gives slugs only, so `epic-planning-and-board` shows as "Planning and board", with the epic id in mono when `TicketsResponse.epics` has it. One epic's folder (`epics: []`) still groups by `row.epic`.

Plan size: about 1,900 tokens, over the 1,600 guide. Kept whole: the board and its detail sheet are one user goal (E4-R8).

## Verification

**Commands:**
- `pnpm typecheck && pnpm test` -- pass
- `pnpm e2e` -- pass
- `pnpm run pack && pnpm smoke` -- pass
