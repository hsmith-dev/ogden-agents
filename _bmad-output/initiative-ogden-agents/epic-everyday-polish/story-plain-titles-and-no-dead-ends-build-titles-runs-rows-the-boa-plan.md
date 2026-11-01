---
title: 'Plain titles and no dead ends'
type: 'feature'
ticket: '6'
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

**Problem:** The audit (ogden-current.md: Board, Runs, Terminals) found five dead ends: build sessions are titled with the raw skill command ("/bmad-build-auto ticket 1.2"), a Runs row can't be clicked, the Board's epic heading reads a bare "1", the Review page highlights the Board tab, and the terminal pane header buttons render as empty boxes (E26-R6).

**Approach:** Core names a build session "Build 1.2: <ticket title>" when it creates it; sessions made before keep their stored name and show "Build 1.2" through a display mapping in the shared `chatName`. A Runs row's ticket title becomes a link stretched over the row (its buttons stay on top). The epic heading reads "Epic 1: <name>". Review adds its own selected tab ("Review 1.2"). Pane header buttons become icon buttons in the terminal's foreground colour with an accessible name and a tooltip.

## Boundaries & Constraints

**Always:** no stored session, event or history is rewritten (the mapping is read-side only; a user's own chat name still wins); no em or en dashes in UI strings; existing DESIGN.md tokens only; every existing `data-testid` keeps working; the Runs row's buttons keep their own targets; the transient Review tab is a link to the page shown, marked `aria-current="page"`, and no slot tab is current with it.

**Never:** a data migration or backfill of `autoTitle`; changing the prompt the build runner sends; Developer mode's skill name beside the title (deferred); reading epic files for their frontmatter title (deferred); changes to the sidebar row layout (26.5), tool rows (26.4) or New chat controls (26.2).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New build | start 1.2 "Deposit checkout" (now or queued) | session `autoTitle` "Build 1.2: Deposit checkout"; sidebar, header show it | No error expected |
| Old build session | `autoTitle` "/bmad-build-auto ticket 1.2" or "$bmad-build-auto ticket 1.2 A note…" | shows "Build 1.2" | No error expected |
| Renamed build | user title "Mine" | shows "Mine" | No error expected |
| Runs row click | click the phase badge or empty row space | opens `/w/:wsId/s/:sesId` | No error expected |
| Runs row button | click Review | opens the review page, not the run | No error expected |
| Epic with id | slug `epic-everyday-polish`, id 26 | heading "Epic 26: Everyday polish" | No error expected |
| Bare numbered slug | slug `epic-1`, no id | heading "Epic 1" | No error expected |
| No epic | slug '' | "Not in an epic" | No error expected |
| Review page | `/w/x/review/1.2` | tab "Review 1.2" current; Board not current | No error expected |
| Split refused | at the pane limit | split button aria-disabled, tooltip names the reason, click does nothing | No error expected |

</frozen-after-approval>

## Code Map

- `packages/core/src/build-start.ts` -- `enqueue` (~l.108) and `begin` (~l.166) call `chat.createChatSession(workspaceId, { kind: 'build', agentId })`; pass `autoTitle: buildSessionTitle(ref, plan.ticket.title)` (planning.ts:146 does the same). `session-events.nameChat` skips a session with an `autoTitle`, so the first prompt no longer names it.
- `packages/shared/src/builds.ts` -- add `buildSessionTitle(ref, title)` ("Build 1.2: T", or "Build 1.2" with no title) beside `REVIEW_PAGE_TITLE` (l.335); add `reviewTabLabel(ref)` ("Review 1.2").
- `packages/shared/src/chat-name.ts` -- `chatName`: an `autoTitle` that is a build skill command (`/` or `$` + `bmad-build-auto ticket <ref>`, optionally followed by more text) shows "Build <ref>". Used by sidebar-model.ts:303, chat-row.tsx, chat-name.tsx (header).
- `packages/web/src/planning/runs-list.tsx` -- `RunRow`: li `relative`, hover fill; title becomes a `Link` to the run with an `after:absolute after:inset-0` overlay and an accessible name "Open the build 1.2 <title>"; the buttons' span `relative z-10`.
- `packages/web/src/planning/board-model.ts` -- `humanEpicTitle`; add `epicHeading(group)`; `board-epic.tsx` heading (l.~72) renders it as plain text instead of id span + title.
- `packages/web/src/shell/workspace-tabs.tsx` -- `WorkspaceTabId` gains `'review'`; `WorkspaceTabsView`/`WorkspaceTabs` take optional `reviewRef`; when given, a last `TabNavItem current` links to `/w/$wsId/review/$ref`. `workspace-header.tsx` passes `reviewRef` through (no styling there: shell is token-guarded). `routes/workspace-review-page.tsx` uses `tab="review" reviewRef={ref}`.
- `packages/web/src/terminal/pane-view.tsx` -- header buttons (l.~280-305) Split right, Split down, Start/Restart, Close: `size="icon"`, new `terminal` Button variant, Phosphor glyph (SquareSplitHorizontal, SquareSplitVertical, Play/ArrowClockwise, X), `aria-label` and a `Tooltip`; split uses `aria-disabled` + guarded click so its reason tooltip shows. Close's name "Close pane".
- `packages/web/src/ui/button.tsx` -- add `terminal` variant: transparent, `text-terminal-foreground`, hover `bg-terminal-foreground/15`.
- Tests to update: `packages/web/test/terminals.dom.test.tsx` l.324, 333 (`textContent` 'Start' → aria-label); `plan-and-board.dom.test.tsx:625` heading text; `board-model.test.ts` humanEpicTitle.
- `tests/fixtures/plan-file-ticket-store.ts` -- optional per-ticket `epic` slug and an `epics` option (default unchanged) so a spec can name an epic.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/shared/src/builds.ts`, `chat-name.ts` -- the two label helpers and the legacy mapping; `packages/shared/test` unit cases from the matrix (new, old slash, old dollar with note, renamed).
- [ ] `packages/core/src/build-start.ts` -- autoTitle at both creations; assert it in `packages/core/test/builds.test.ts` (start) and `builds-dispatch.test.ts` (queued).
- [ ] `packages/web/src/planning/runs-list.tsx` -- stretched row link; `packages/web/test/runs-list.dom.test.tsx` checks the row link target and that Review keeps its own.
- [ ] `packages/web/src/planning/board-model.ts`, `board-epic.tsx` -- epic heading; update the two tests; cases for id, bare number, no epic.
- [ ] `packages/web/src/shell/workspace-tabs.tsx`, `workspace-header.tsx`, `routes/workspace-review-page.tsx` -- Review tab; `workspace-tabs.dom.test.tsx` case.
- [ ] `packages/web/src/ui/button.tsx`, `terminal/pane-view.tsx` -- icon buttons; `terminals.dom.test.tsx` asserts every header button has a name and an svg.
- [ ] `tests/fixtures/plan-file-ticket-store.ts`, `tests/e2e/plain-titles.spec.ts` (new) -- start build 1.1, read "Build 1.1: <title>" on its sidebar row and header, open the run by clicking its row on Runs, read "Epic 1: Clay bookings" on the Board, see "Review 1.1" current on the review page with Board not current. Pane names are covered in `tests/e2e/panes.spec.ts`'s first test: every `pane` header button has an accessible name.

**Acceptance Criteria:**
- Given a build session made before this change, when the sidebar lists it, then it reads "Build 1.2" and the stored `autoTitle` is unchanged.
- Given the terminal pane header, when a keyboard user tabs through it, then each button announces its name and shows its tooltip.

## Implementation Notes

- `routes/session-page.tsx` (not in the Code Map): the build session's header read a fixed "Build"; it now shows the session's name ("Build" only before it loads), so the header matches the sidebar as the matrix asks.
- `buildSessionTitle` cuts at `CHAT_NAME_MAX` (80), the same cap `entities.createSession` applies to a stored `autoTitle`; `runRowLinkLabel` and `BOARD_EPIC_LABEL` live in shared beside the other UI words.
- The core build harness's fake `createChatSession` now passes `autoTitle` through, so the start and queued tests read the stored name.
- In the e2e spec the badge click goes through `page.mouse` at the badge's box: the stretched link lies over it, so Playwright's own `click` refuses (the overlay intercepts, as intended).
- Pane tooltips: a refused split's tooltip is the reason itself; the rest show the button's name.
- Review patches: list labels from `epicHeading`, the row's focus ring on the stretched overlay, a busy Start/Restart is `aria-disabled` and stays focusable.
- Verification after the patches: `pnpm typecheck` clean; `pnpm test` 5153 passed, 10 skipped (an earlier run during a parallel build timed out in unrelated timing tests; the final full run was clean); after `pnpm run build`, plain-titles, panes, run-view and plan-and-board: 22 passed; provenance passes.

## Plan Change Log

## Review Triage Log

Pass 1 (quick lens, fresh subagent given the diff and code): 7 findings; medium 2, low 5, false 0, maybe-false 0.

| # | Finding | Verdict | Route |
|---|---------|---------|-------|
| 1 | `board-epic.tsx` column and dropped list labels still use `epic.title`, so a screen reader hears "1, Draft" while the heading reads "Epic 1" | medium | patch: labels built from `epicHeading(epic)` |
| 2 | Runs row stretched link: focus outline wraps only the title text (an empty box with no title), not the clickable row | medium | patch: link `outline-none`, focus ring on the `after:` overlay |
| 3 | `PaneHeaderButton` passes native `disabled={restarting}`: activating Start/Restart by keyboard drops focus and closes its tooltip | low | patch: `aria-disabled` with the guarded click, as the refused split |
| 4 | Legacy `chatName` mapping ignores session kind: a plain chat whose first message is `/bmad-build-auto ticket 1.2` shows "Build 1.2" | low | reject: unlikely in use, the name is still accurate to what that chat ran, and the fix adds a parameter to every caller |
| 5 | `chat-name.ts` hard-codes "Build" instead of `BUILD_LABEL` | low | reject: `builds.ts` imports `chat-name.ts`, so reusing it means an import cycle or a move; one word, covered by `build-titles.test.ts` |
| 6 | `'review'` added to `WorkspaceTabId`, which `WorkspaceTabSlot.id` also types; `tab="review"` without `reviewRef` type-checks | low | reject: no caller does either; splitting the type adds surface for a state never reached |
| 7 | Tasks checkboxes still `[ ]` while status is in-review | low | reject: the fix edits this build's plan |

## Design Notes

Titles: core sets the name at creation, so every surface that already reads `chatName` (sidebar, header, palette, notifications) follows with no new field. Old sessions: a read-side mapping in `chatName` only; the ticket's title isn't known there, so they read "Build 1.2" (as Needs you's run rows already do). Rewriting stored `autoTitle` or replaying `session.renamed` was rejected (history is append-only).

Epic name: `tickets.py status` reports only slug and id per epic, so the name is the humanized slug ("epic-everyday-polish" is "Everyday polish"); a slug that is only a number reads "Epic 1". The audit's bare "1" was `epic-1` from the plan-file fixture with no epics list.

## Deferred (for the sweep)

- Developer mode shows the skill name in mono beside a build session's title (EXPERIENCE.md Live run view). (26.9: logged in `deferred-work.md`.)
- The Board heading could show the epic file's own frontmatter `title` once `tickets.py status` (the BMad fork) reports it. (26.9: logged in `deferred-work.md`, the BMad fork.)

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors
- `pnpm test` -- expected: full suite passes
- `pnpm run build && pnpm exec playwright test tests/e2e/plain-titles.spec.ts tests/e2e/panes.spec.ts tests/e2e/run-view.spec.ts tests/e2e/plan-and-board.spec.ts` -- expected: pass
- `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs` -- expected: pass
