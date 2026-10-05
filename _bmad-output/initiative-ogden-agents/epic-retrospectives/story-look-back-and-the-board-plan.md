---
title: 'Look back from the board: the action, the finished-epic offer and the verdict'
type: 'feature'
ticket: '4'
created: '2026-10-05'
status: 'in-review'
baseline_revision: '65be8d36d146ab8dabf288e414403e09352dac07'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-retrospectives/epic-retrospectives.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The board's look-back is a bare button: it does not come from the catalog, does not say an epic is finished, does not show a verdict, and the look-back is told nothing about the epic's builds.

**Approach:** The epic header shows the catalog's epic-scoped action (or the reduced-mode sentence), a finished epic offers "Look back on it?" with Not now, an epic's retrospective verdict and date show as a chip read from the file's frontmatter, a changed file reaches the board through the watcher, and the look-back's first message carries short build summaries.

## Boundaries & Constraints

**Always:** Every read and event is behind the Retrospectives guard; the verdict comes from the frontmatter alone through the catalog port's confined reader (no script, no prose); the look-back starts only from a click; the summaries carry no transcript and only Ogden's own fixed sentences; copy has no dashes.

**Never:** No lessons or action-item steps or commit (entry 5); no notification (epic 11); no new retrospective logic; no retrospective of a ticket or initiative.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Action | Retrospectives on, catalog has an epic-scoped action | Button with the catalog's label on each epic header | Refusal shown in the alert line |
| Reduced | No epic-scoped action or `look_back` missing | The reduced-mode sentence with Upgrade, no button | |
| Unfinished | Some ticket not done or dropped | One line: the look back records it as not accepted | |
| Finished | Every ticket done or dropped, no retrospective, not dismissed | The offer with Look back and Not now; never starts by itself | Not now kept by core |
| Verdict | A retrospective file with a readable verdict | Chip with the verdict and date | |
| Unreadable | A file with no readable verdict | The one notice line, no chip | |
| File changes | A retrospective file appears, changes or goes | `retrospective.changed`, the board refetches | Only with the piece on |
| Off | Retrospectives off | Nothing read, shown or appended | |
| First message | Runs exist for the epic's tickets | Folder, then one plain line per run | None when no runs |

</frozen-after-approval>

## Code Map

- `packages/core/src/retrospective-verdict.ts`, `build-summaries.ts`, `retrospectives.ts`, `board.ts`, `ticket-watcher.ts`, `ticket-store-port.ts`, `bmad-catalog-port.ts` -- verdict read, summaries, the look-back from the catalog's action, the board overlay, the event.
- `packages/adapters/src/bmad-catalog/document.ts`, `tickets-v7/retrospective-watch.ts`, `catalog-memory`, `tickets-memory` -- confined reader, change signature, stubs.
- `packages/web/src/planning/board-look-back.tsx`, `board-epic.tsx`, `board-model.ts`, `planning-api.ts` -- header, offer, chip, refetch.

## Tasks & Acceptance

**Execution:**
- [x] verdict reader (frontmatter only), confined `readRetrospective`, the board overlay behind the guard
- [x] watcher signature and `retrospective.changed`, appended only with the piece on
- [x] build summaries (Ogden's fixed sentences) in the first message; the action from the catalog, `reduced_mode` without it
- [x] header action, finished-epic offer with Not now, verdict chip, reduced-mode sentence, refetch on the event
- [x] tests in core, adapters, server, DOM, one e2e; the 7.1 skill constant removed

**Acceptance Criteria:**
- Given Retrospectives on, then a finished epic offers the look back once and Not now stays across a reload.
- Given a look-back that wrote its file, then the epic header shows its verdict and date, and a damaged file shows the notice.
- Given Retrospectives off, then no action, offer or verdict shows and nothing is read.

## Implementation Notes

- **Deviation from the epic text:** the verdict is read in core's board use-case through the catalog port's confined `readRetrospective` (same confinement as document cards, no script runs), not inside the `tickets-v7` adapter, because the adapter does not know the output folder and `tickets.py` does not report the file. The watcher's change signature lives in `tickets-v7` as the epic says.
- The offer is shown only while the epic has no retrospective; the 7.1 skill constant is gone (the look-back uses the catalog's epic-scoped action; none is `reduced_mode`).
- Answers the plan's unknown: 4.8's rerun of `tickets.py` fires on any file change, so the watch only needed to compare retrospective signatures after each read.
- Resolves the 7.2 deferral about summaries' blocked reasons: they are Ogden's fixed sentences.

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `pnpm test` -- all pass
- `pnpm e2e` -- touched specs pass
- `PROVENANCE_BASE=origin/main pnpm provenance` -- pass
