---
title: 'Review, approve and merge, reject and retry'
type: 'feature'
ticket: '9'
created: '2026-10-05'
status: 'built'
baseline_revision: '1b4ef0144c2f23c46e82ab53823553626bab65b1'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['security', 'correctness']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-unattended-builds/epic-unattended-builds.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-unattended-builds/story-dispatch-limits-stop-retry-and-quit-in-core-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The review page is the tracer's bare one: no summary, no checks, no findings, the diff always open, no way to update a conflicting run or to reject with a note and build again. Approve, the merge with the `done` mark in the merge commit, the dirty checks and the conflict block already exist from 5.2 to 5.6.

**Approach:** Give the review answer a plain summary, the diff size and the findings from the plan's Review Triage Log; design the page (summary, three checks, findings, the diff behind Show the code changes, a sticky bar with Approve and merge disabled until every check passes); add Update and retry (rebase the blocked run onto the checkout, then check it again) and Reject and retry (discard, then build the ticket again from a new worktree with an optional note); prove no other code marks a ticket done.

## Boundaries & Constraints

**Always:** Approve stays the only path to `done` (a test searches the code). Nothing is pushed or forced. A rebase that conflicts again or cannot run changes nothing and says so. Findings are the plan's own words, masked and bounded, read only from a plain plan file inside the run's worktree. UI text has no em or en dash.

**Never:** No change to approve's rules. No run view, Runs tab or webhooks (epic 11). No apply-fix retry (11.1). No automatic conflict resolution.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Review | verified run | summary, diff size, three checks, findings, diff | none |
| Failing check | tests failed when re-run | cross with its detail, no Approve | approve refused `checks_failed` as before |
| Watched build | attended, tests check not run | Approve enabled | none |
| Conflict | merge conflict blocked the run | Update and retry shown | rebase conflicts again: 409 with its sentence, unchanged |
| Update and retry | conflicted run, clean rebase | base moved, checks run again, run ready for review | checkout on another branch: `checkout_dirty` |
| Reject and retry | optional note | old worktree gone, new run built from a new worktree, note in its first message | over a limit: queued with its note |
| Repeat Reject | already rejected | without retry nothing is written; with retry the ticket is built again (a start refused the first time) | none |

</frozen-after-approval>

## Code Map

- `packages/core/src/builds.ts` -- `reviewOf` (summary, stats, findings), `rebaseLocked`, `reject` with retry, `startLocked` note; `build-findings.ts` (new) the log parser; `entities.ts` `setRunBase`.
- `packages/shared/src/builds.ts` -- `RejectBuildRequest.retry`, sentences.
- `packages/server/src/build-routes.ts` -- reject takes an optional body.
- `packages/web/src/planning/build-review.tsx`, `builds-api.ts` -- the designed page.
- `tests/architecture.test.ts` -- only `builds.ts` passes `approve: true`.

## Tasks & Acceptance

**Execution:**
- [x] core, shared, server: summary, findings, Update and retry, Reject and retry.
- [x] web: the designed review page and its calls.
- [x] tests: core, server (real git conflict), DOM, e2e, architecture.

**Acceptance Criteria:**
- Given a conflicted run, when Update and retry runs and the rebase is clean, then its base moves and it is checked again.
- Given Reject and retry with a note, then the new run's first message carries it.
- Given the source, then only core's builds use-case marks done through the approve option.

## Implementation Notes

- 2026-10-05 (build): approve, the merge commit with the `done` mark, the dirty checks (`_bmad-output` ignored, others `checkout_dirty`), a conflict blocking the run and a second approve not being refused were built and tested in 5.2 to 5.6; this story adds the rest of the entry. Reject keeps its discard meaning without `retry`; the page always sends `retry: true` (Reject and retry). Update and retry reruns the end checks (plan built, tests re-run in the sandbox, diff), not the agent: the plan is already built and the rebase only moves the base. The fake ACP agent takes only the first word after the ticket command as the ref, so a note after it is harmless.

## Plan Change Log

## Review Triage Log

- 2026-10-05, pass 1 (security and correctness lenses): high 0, medium 3, low 12. Routed: patch 8, defer 2, reject 5. No intent_gap or bad_plan.
  - A plan bullet that is empty once stripped made the review response invalid (500) -- medium, patch: empty findings dropped; test.
  - Reject and retry could not be redone after its start was refused (the discard had happened) -- medium, patch: a repeat Reject with retry builds the ticket again; matrix row reworded; test.
  - A queued run's note was lost when the slot was taken again -- medium, patch: kept until the dispatch happens; test with a real queue (the first test never queued).
  - Findings read had a check-then-use gap (a swapped-in FIFO or link) -- low to medium, patch: open without following or blocking, judge the opened file, bounded read; not read while the run is running.
  - "No findings" said where the plan was never read, and agent-written findings looked like a review -- low, patch: says so when the folder is gone; labelled as written by the agent.
  - Update and retry took no generation bump -- low, patch.
  - Update and retry checks no run limit and arms no deadline; the tests re-run is long; review runs tickets.py on every read -- low, defer to 5.10 or 11.1 (the re-check is one bounded run).
  - Only-path-to-done test is textual; the stores' own refusal is the real guard; the agent can write `done` in its own plan, which the merge would carry -- low, reject: approve marks done itself and `forbiddenChanges`-style checks read the plan status at review; stated in the test name.
  - Parser edge cases (mixed nesting, first severity word, numbered lists) -- low, reject: plain best effort over a free-form log; empty and size cases are handled.
  - Weak tests (e2e note, real-git successful rebase) -- low, defer: the note reaches the first message in the core test; a real-git clean rebase needs a non-conflicting meanwhile change that approve cannot hit.

## Design Notes

- The findings parser reads nested bullets under `## Review Triage Log` (the top-level bullet of a pass is its heading); any bullet naming a deferral is shown as deferred.

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `pnpm test` -- all pass
- `pnpm e2e` -- all pass
- `pnpm run pack && pnpm smoke` -- pass
