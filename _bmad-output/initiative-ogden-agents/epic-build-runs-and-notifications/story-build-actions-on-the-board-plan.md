---
title: 'Build actions on the board'
type: 'feature'
ticket: '3'
created: '2026-10-05'
status: 'built'
baseline_revision: 'b88651a9f03381067dcfd5d41784babb89ef454f'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['security', 'correctness']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-build-runs-and-notifications/epic-build-runs-and-notifications.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-build-runs-and-notifications/story-verification-reporting-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The board offers only the tracer's bare Build button on Ready cards (even one that waits for another ticket), no way to build every ready story, no Build in the ticket detail sheet, and the sheet lists none of the ticket's runs.

**Approach:** Name the card action **Build this story** and show it only on a Ready ticket whose prerequisites are met and that is not queued; add **Build all ready** in the board header (5.8's all-ready request); add **Build this story** and the ticket's runs (state, failing check, links to the run view and the review) to the detail sheet, which asks the board to start the build so a refusal opens 5.6's Build dialog.

## Boundaries & Constraints

**Always:** Every Build action exists only with the `builds` piece on (the sheet reads the project's pieces; the board is given the actions only then). A refused build shows the Build dialog for a missing sandbox, else its plain sentence. Reduced mode (4.11) keeps its gating: no board, no actions. UI text has no em or en dash.

**Never:** No change to 5.8's dispatcher or its rules: Build all ready reads the main checkout's statuses and starts only tickets whose prerequisites are done there; a single Build may start a ticket whose prerequisite is built and in review. No new port or shared shape. No notifications (11.4).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Ready card | Ready, prerequisites met | Build this story on the card | refused: dialog or alert |
| Waiting card | prerequisite unmet | "Waits for 1.2", no Build | none |
| Build all ready | two independent ready, one waiting | two builds start, "Started 2 builds.", a link to Runs; the waiting one is not dispatched | refused: plain alert; none ready: button disabled with its sentence |
| Sheet | Ready ticket | Build this story and its runs list with links | same as the card |
| Builds off | piece off | no Build all ready, no card or sheet action, no build section | none |

</frozen-after-approval>

## Code Map

- `packages/web/src/planning/board-tickets.tsx`, `board-epic.tsx`, `ticket-card.tsx` -- the header action, the card gating and label.
- `packages/web/src/planning/board-build-context.tsx` (new), `ticket-build-section.tsx`, `ticket-sheet.tsx` -- the sheet's Build and runs list.
- `packages/web/src/planning/builds-api.ts`, `packages/shared/src/builds.ts` -- `startBuildAll` and the words.

## Tasks & Acceptance

**Execution:**
- [x] web, shared: the board header action, card gating, sheet action and runs list.
- [x] tests: DOM and e2e.

**Acceptance Criteria:**
- Given two ready independent stories and one waiting, when Build all ready is pressed, then two builds start and the waiting one is not dispatched.
- Given builds off, then no Build action anywhere.

## Implementation Notes

- 2026-10-05 (build): the server side (5.8's all-ready request, 5.6's dialog) already exists, so this story is web only. The board owns the build start and passes it to the sheet through a context, so the one Build dialog and alert serve both. Build all ready's count is runs started plus queued.

## Plan Change Log

## Review Triage Log

- 2026-10-05, pass 1 (security and correctness lenses): high 0, medium 2, low 8. Routed: patch 3, defer 3, reject 4. No intent_gap or bad_plan.
  - A refusal of the sheet's Build showed its alert in the board behind the modal sheet -- medium, patch: the sheet shows the same sentence.
  - The sheet offered Build for a waiting ticket while its prerequisites were unresolved (opened from its URL) -- medium, patch: unresolved counts as waiting.
  - A later single Build left the old "Started N builds." beside its own result -- low, patch.
  - DOM tests for Build all ready's states and the sheet section, an e2e for refused Build all, a live-region announcement for "Started N builds.", and the nested dialog over the sheet's focus return -- low, defer to 11.5.
  - Card and sheet Build do not exclude a ticket whose build is running (the server refuses it with a plain sentence), and Build all ready's count comes from the board's statuses -- low, reject: matches the plan (not queued) and the server decides.
  - A stale board could make Build all ready start tickets the user did not see -- low, reject: its intent is the main checkout's statuses; the notice says how many started.
  - Run order assumed newest first -- info, reject: core returns newest first (5.8).
  - XSS, request bodies, builds-off bypass -- none found.

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `pnpm test` -- all pass
- `pnpm exec playwright test tests/e2e/board-build-actions.spec.ts` -- pass
