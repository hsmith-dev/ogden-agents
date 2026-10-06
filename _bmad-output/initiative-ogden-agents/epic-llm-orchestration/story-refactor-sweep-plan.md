---
title: 'Refactor sweep (epic 15)'
type: 'refactor'
ticket: '15.13'
created: '2026-10-06'
status: 'in-review'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick-security', 'quick-correctness']
review_loop_iteration: 0
baseline_revision: '4bcf88c756a7f90c5b796e9830395746dbd31214'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-llm-orchestration/epic-llm-orchestration.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Stories 15.1 to 15.12 grew `core/orchestration.ts` to one 1746 line closure holding the run's life, dispatch, the engine, the read-back, the reviewer and the builds, with the same few statements written out many times. A reader cannot see where the manager's boundary is, and the architecture tests had to cut the file by text markers. The user also needs one place that says what only a person can check and decide.

**Approach:** Cut the use-case into cohesive modules behind the same `Orchestration` shape, with no change of behaviour: rows, transcript, loop state, build read, manager input and output, review, run, read-back, activity, dispatch, engine, the user's actions, and routing. Pull out what several of them repeat (find a run, update a step, give a step back to the user, one line of masked text, a plain refusal). Hold every orchestration module to the architecture rules by pattern. Fix the small deferred findings that are cheap and safe, make the deferred index accurate, and write the live checks and the user's open decisions into RELEASING.md.

**Decisions (user, 2026-10-05 and 2026-10-06; epic Notes):** behaviour must not change; the manager is a tool-free call and never approves, edits, skips, reorders, stops, answers a card, changes a mode or settings or starts a build; subscription agents are approve one by one only until their terms are checked again.

## Boundaries & Constraints

**Always:** the public `Orchestration` shape and every test stay as they were; each moved function keeps its checks and its transaction; the use-case modules import no shell, file or credential port and name no model product; plain copy with no em or en dash; a finding is fixed or recorded in `deferred-work.md` with the index accurate.

**Never:** a change of behaviour; a hand edit of the spec or architecture; a new product feature; an index entry that is closed but still listed.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Every use-case call | any call on `Orchestration` | the same result, events and rows as before the split | same errors |
| A user action named in a module | `approveStep`, `editStep`, `skipStep`, `reorderSteps`, `stopRun`, `answerQuestion` outside `orchestration-actions.ts` and the assembly | the architecture test fails with the file | n/a |
| A new `orchestration-*.ts` file in core | any | held to the same rules with no list to update | n/a |
| Oversized body with no length | chunked, over the limit | 413 in the route's words | n/a |
| Move beside a sent step | the neighbour was sent | the button is off; no request is sent | n/a |

</frozen-after-approval>

## Code Map

- `packages/core/src/orchestration.ts` -- the public shape and the assembly only (184 lines); `orchestration-kernel.ts` -- types and the three late bound calls.
- `orchestration-rows.ts` (rows, transitions, mode sync, `findRun`, `updateStep`, `returnToUser`), `orchestration-transcript.ts` (last reply, Deny, restart cut off, build checks, `oneLine`), `orchestration-loop-state.ts`, `orchestration-build-read.ts`, `orchestration-manager-io.ts` (manager, workers, plan, decision record), `orchestration-review.ts`.
- `orchestration-run.ts` (start, close, limits, resume), `orchestration-readback.ts` (settle, read back, list, get), `orchestration-activity.ts`, `orchestration-dispatch.ts`, `orchestration-engine.ts` (the automatic engine and the loop), `orchestration-actions.ts` (the user's own actions), `orchestration-routing.ts` (store and `createRouting`).
- `packages/shared/src/orchestration.ts` (the manager protocol), `orchestration-run.ts` (run, limits, REST views), `orchestration-build-review.ts`, `orchestration-text.ts` (internal text rules), `index.ts`, `events-orchestration.ts`, `bmad.ts`, `events.ts`, `events-settings.ts`, `roster.ts`, `chat.ts` (imports).
- `packages/server/src/orchestration-routes.ts` -- the `withBody` helper for the six body routes.
- `packages/web/src/orchestrate/orchestrate-view.tsx` -- Move buttons beside a sent step.
- `tests/architecture.test.ts` -- guards by pattern; `RELEASING.md` -- live checks and decisions; `_bmad-output/initiative-ogden-agents/deferred-work.md` -- the index.

## Tasks & Acceptance

- [x] split `core/orchestration.ts` into modules and keep the `Orchestration` shape
- [x] extract what the modules repeat
- [x] architecture guards by pattern, extended to the new modules, with a size cap
- [x] split `shared/orchestration.ts`; share the routes' body handling
- [x] small fixes: Move beside a sent step; a chunked body is proved 413
- [x] RELEASING.md: live checks and "Decisions for you"; the deferred index made accurate

**Acceptance Criteria:**
- Given the whole existing suite, it passes unchanged apart from the architecture tests, which now name the modules.
- Given a user action named in any use-case module except the actions and the assembly, the architecture test fails.
- Given the deferred list, every epic 15 item is open with a reason or resolved with a log entry.
- Given RELEASING.md, a person can run every live check as a checklist and sees the five decisions in one list.

## Implementation Notes

- **How it was cut.** `createOrchestration` builds a `Base` (the collaborators and the three in memory maps) and then each module is a function of `Base` and the modules before it, so the dependencies point one way and their types never loop. Only three calls reach across (`scheduleAdvance`, `tell`, `readBack`: the engine, the tell and the read-back call each other), through a small `Late` object bound once everything exists. The listener on the event log is made with the engine, as before.
- **What the modules share now.** `findRun` (the stored run row, read in a dozen places before), `updateStep` (a step's columns, many places before), `failIfDispatched`, `returnToUser` (what the mode approved goes back to the user: three copies became one that takes a step or the whole run), `oneLine` (masked, one line, cut), and a plain `refusal` for dispatch.
- **Architecture.** `ORCHESTRATION_USE_CASE` is now every `core/src/orchestration*.ts` except the install's defaults, so a new module is guarded with no list. The user's actions may be named only by `orchestration-actions.ts` and the assembly that lists them. The old slices (`startRun`, `dispatchStep`, `readBack`, the engine) are whole files now. A module may not pass 450 lines.
- **Shared.** The manager protocol stays in `orchestration.ts`; run and views, builds and the reviewer's message, and the text rules moved to their own files, with the index exporting all but the text rules. No name changed.
- **Not changed.** `web/orchestrate-view.tsx` (700 lines) is in line with the repo's other pages and keeps one page's code together. `ORCHESTRATION_BUILD_STEP_WORDS` and `MANAGER_STATUS_JSON_SCHEMA` are exported contracts with a test and no caller; they stay.
- **Deferred list**: see the log entries of this story and the index. Still open: the empty "Not sent" chat (needs a delete chat use-case), the manager not told of every ending, the cut off step's missing button, the build link choice, Test as a manager results kept in memory, one worker role, the `json_extract` read. Closed here: the chunked body (already 413, now proved), the Move button.

## Spec proposals

None. The `Orchestration` shape, the events and the routes are unchanged.

## Plan Change Log

None yet.

## Review Triage Log

2026-10-06, security and correctness reviewers (2 lenses), no critical, high or medium findings. Both read every moved function against the original (`git show 4bcf88c7:packages/core/src/orchestration.ts`) and found no change of behaviour. Patched: the assembly (`createOrchestration`) was exempt from the user action guard, so a call to a user action could have been added there unseen (low security), now the guard checks that slice with planted cases; the two places in `advancePass` that give a mode approved step back to the user lost the step read that threw for a missing step (low correctness, cosmetic), now kept for exact parity. Not changed: none.

## Verification

**Results:** `pnpm typecheck` clean; `pnpm test` 351 files, 4445 passed, 8 skipped (the three added tests: a chunked body is 413, Move beside a sent step is off, the assembly guard cases are inside the architecture test); Playwright `orchestrate` 18 passed; `PROVENANCE_BASE=origin/main pnpm provenance` passes.

**Commands:** `pnpm typecheck`, `pnpm test`, `npx playwright test tests/e2e/orchestrate.spec.ts` (after `pnpm run build`), `PROVENANCE_BASE=origin/main pnpm provenance`.
