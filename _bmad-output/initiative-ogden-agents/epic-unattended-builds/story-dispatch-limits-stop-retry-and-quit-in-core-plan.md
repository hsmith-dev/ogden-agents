---
title: 'Dispatch, limits, Stop, Retry and Quit in core'
type: 'feature'
ticket: '8'
created: '2026-10-05'
status: 'in-progress'
baseline_revision: 'e260e8ae1fe64f61638f400b6642cd083cf88ab1'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-unattended-builds/epic-unattended-builds.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-unattended-builds/story-contracts-and-stubs-for-epics-5-and-11-plan.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-unattended-builds/story-the-build-runner-over-acp-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Build starts exactly one run at once, with no queue, no limits, no Stop, no maximum run time, no Retry beyond a checkpoint, and a run whose plan says built is ready for review without Ogden checking its tests. Settings for the limits do not exist.

**Approach:** Core gets the dispatcher (one ticket, or every ready one), the limits (2 per project, 3 per install, 45 minutes, stored and editable), a queue shown as Queued, the time limit, Stop, Retry (marks the plan's resume status in the run's worktree, then redispatches there), and the verification that runs before a run is ready for review: the plan is built, the project's tests re-run inside the run's own sandbox pass, and the diff is not empty. The sandbox port gains a way to run one command inside a sandbox. The board card shows Queued, the build session header shows Stop and Retry, and the limits have settings.

## Boundaries & Constraints

**Always:** Every use-case calls the builds guards first. The test re-run executes the agent's code, so it runs only inside the run's sandbox with no network, after the agent is released; it never runs on the server unsandboxed (an attended build has no sandbox: its tests check is not run and says so, the user having watched every command). The test command comes from the main checkout (the project's AGENTS.md, else its package.json test script), never from the worktree the agent can edit. A limit change applies to the next dispatch. Turning builds or board off lets running runs finish and dispatches nothing more. Quit and restart mark running runs blocked as interrupted; queued runs stay queued. Costs and budgets stay out. No UI text holds an em or en dash.

**Never:** No review page changes, rebase, apply-fix or reject-with-note (5.9, 11.1). No Runs tab or Build all ready button (11.1, 11.3). No webhooks. No change to approve.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Under the limits | one ready ticket | dispatched at once as today | none |
| Over a limit | the project (2) or the install (3) is full | the run is created queued with its position, no worktree yet; Queued on its card | none |
| Slot frees | a run ends, stops or is rejected | the next queued run (oldest first, within both limits) gets its worktree and starts | a launch that fails ends that run failed, the queue goes on |
| Build all ready | three ready tickets, limit 2 | runs two, queues one, keeps dispatching tickets that become ready until none is left | a ticket with an unmet prerequisite is never dispatched |
| Limit changed | project limit raised or lowered | applies to the next dispatch | out of bounds: 400 |
| Time limit | run past its minutes | agent stopped, run blocked `time_limit`, "Stopped after 45 minutes without finishing." | none |
| Stop | running or queued run | agent stopped, run `stopped`; a queued run leaves the queue | not running: `run_not_active` |
| Retry blocked | blocked, failed or stopped run, undecided | plan marked with its resume status in the worktree (only when blocked), run `running` again in the same worktree, queued if full | checkpoint pauses resume as before |
| Quit or restart | runs running | blocked `interrupted`, worktree kept; queue kept and drained at start | none |
| Piece off | builds or board turned off | running runs finish, nothing is dispatched until it is on | every use-case `feature_off` |
| Tests fail | plan built, re-run exits non-zero | run failed, "3 tests failed when re-run", not ready for review | no test command: "No test command found" |
| Empty diff, plan not built | built with no changes, or any other status | that check fails, tests not run | as today |
| All pass | all three checks | run verified, `run.verification_completed` emitted | none |

</frozen-after-approval>

## Code Map

- `packages/core/src/builds.ts` -- start, launch, decideOutcome, resume; split the dispatcher and verification into `build-dispatch.ts` and `build-verify.ts`.
- `packages/core/src/sandbox-port.ts`, `packages/adapters/src/sandbox-*` -- `run` of one command inside a sandbox (Seatbelt profile, bubblewrap arguments).
- `packages/core/src/entities.ts`, `db/schema.ts`, migration -- queue position, dispatch, limits and test command storage.
- `packages/server/src/build-routes.ts`, `run-settings-routes.ts` -- Stop, Retry, build-settings, run-limits, all-ready.
- `packages/web` -- Queued on the card, Stop and Retry in the build header, limit settings.

## Tasks & Acceptance

**Execution:**
- [ ] shared and core: settings storage, queue, dispatcher, time limit, Stop, Retry, interrupted handling.
- [ ] core and adapters: sandbox `run`, verification.
- [ ] server routes and wiring.
- [ ] web: Queued, Stop, Retry, settings.
- [ ] tests per matrix in core, adapters, server, web, e2e.

**Acceptance Criteria:**
- Given three ready tickets and the default limits, when Build all ready is requested, then two run and one is queued, and the third starts when one ends.
- Given a run that marks its plan built but whose tests fail when re-run, when it ends, then it is failed with "3 tests failed when re-run" and cannot be approved.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Design Notes

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `pnpm test` -- all pass
- `pnpm e2e` -- all pass
- `pnpm run pack && pnpm smoke` -- pass
