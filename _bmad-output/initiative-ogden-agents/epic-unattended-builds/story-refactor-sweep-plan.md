---
title: 'Refactor sweep'
type: 'refactor'
ticket: '10'
created: '2026-10-05'
status: 'built'
baseline_revision: 'e2cf0effef808d429c5835c7e098f420654e6e17'
route: 'oneshot'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-unattended-builds/epic-unattended-builds.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

Clean up the code the epic grew, with no behavior change: split any file the epic grew past 600 lines, run the provenance check, and remove 4.14's unused bmad-loop pin and resolver unless 4.12 did.

</frozen-after-approval>

## Implementation Notes

- `packages/core/src/builds.ts` (1,501 lines) is now seven files, none over 400 lines: `builds.ts` (the use-cases' wiring and methods), `builds-types.ts` (`BuildsUseCases`, `BuildsDeps`), `build-names.ts` (branch names, prerequisites, forbidden changes, checkpoint and intent-gap helpers), `build-context.ts` (the guards, sandbox setup, limits, timers, queue notes, cleanup), `build-start.ts` (starting, the queue entry, the worktree), `build-outcome.ts` (verification, the result read-back, the outcome), `build-dispatch.ts` (time limit, queue drain, Build all ready, Retry, Resume, Update and retry), `build-review.ts` (the review answer). The two calls that cross from the starter and the outcome back to dispatch (arming a time limit, scheduling a drain) go through one late-bound object on the shared context. Every export `builds.ts` had is still exported from it.
- `packages/core/src/entities.ts` grew from 745 to 997 lines in this epic; the run methods moved to `run-entities.ts` (413 lines), leaving it at 735, under where the epic found it. `check` moved to `entity-check.ts`.
- `packages/adapters/src/vcs-git/index.ts` (711 lines) lost its options and pure checks to `checks.ts` (146 lines), leaving 588.
- The bmad-loop pin and `createBmadLoopResolver` were already removed (by 4.12): nothing in the source, `bmad-lock.json` or the scripts names them but a comment saying none is used.
- Deferred items that named this story (a build command that leaves its process group, the board reading a live worktree) were left as they are: each needs a sandbox change, not a no-behavior cleanup; their owners now say a later sandbox story.

## Review Triage Log

- 2026-10-05, pass 1 (quick, by the full test suite and the e2e specs as the reviewer of a no-behavior move): one defect found by the tests, patched: a mechanical de-duplication had dropped the `diffStats` field from the review answer (caught by `builds-review.test.ts`). No other finding.

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `pnpm test` -- all pass
- `pnpm e2e` -- all pass
- `pnpm run pack && pnpm smoke` -- pass
