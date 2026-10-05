---
title: 'Dispatch, limits, Stop, Retry and Quit in core'
type: 'feature'
ticket: '8'
created: '2026-10-05'
status: 'built'
baseline_revision: 'e260e8ae1fe64f61638f400b6642cd083cf88ab1'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['security', 'correctness']
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

- 2026-10-05 (build): implemented directly from this plan in local milestone commits. Shared: `VerificationResult.attended`, `RUN_REASON_STOPPED`, `ALL_READY_ASK_MESSAGE`, test-check sentences. Core: `build-settings.ts` (the install's and a project's limits, one migration `0020_build_settings`), queue and dispatch entity methods (`listRunningRuns`, `listQueuedRuns`, `queueOf`, `queueRun`, `dispatchRun`, `leaveQueue`, `listRuns`; a queued run is `running` with a queue position and no worktree), `build-verify.ts` (test command detection, the three checks), `SandboxPort.run`, and in `builds.ts` the dispatcher: `validateStart` and `begin` split out of `startLocked`, `hasCapacity`, `enqueue`, `launchQueued`, `drainQueue` behind one global dispatch lock (never held while waiting for it), `startAll`, `stop`, Retry (`retryLocked`, `startAgain`), the time limit timers, `runs` and `run`. Adapters: `sandbox-claude-native/exec.ts` (Seatbelt profile and bubblewrap arguments; the real macOS Seatbelt run is tested here), chain, memory and fixed sandboxes get `run`. Server: Stop, Retry, build-settings, run-limits, all-ready (202), runs, run; `dispatchQueued` at start and after a limit change. Web: Queued on the card, Stop and Retry (Continue at a checkpoint) in the header, Settings, Builds and the project's limit, the review page refetching on run events.
- Decision (default, flagged for the user): an attended build (Build with me watching, the only build on Windows without Docker) has no sandbox, and the re-run runs the agent's code only inside one, so its tests check is `not_run` ("Not re-run: this build had no sandbox, and you watched it") and the run can still be `verified` on the other two checks. AD-17's verification is about unattended runs; the user saw every command. `VerificationResult` gained `attended` (default false) for this; nothing runs unsandboxed.
- Decision (default): the test command is read from the main checkout's `AGENTS.md` (a `Tests: \`cmd\`` line) or `package.json`, never the worktree, so the agent cannot change what is run; the project's override (11.2's editor, stored here) wins.
- Prerequisites and Retry's mark go through the board's run-aware ticket store (a ticket built in a worktree is in review there); start and approve keep the main checkout's.
- Quit and a crash already blocked running runs as interrupted at the next start (5.2); queued runs have no agent and stay queued, and are started at the start.

## Plan Change Log

## Review Triage Log

- 2026-10-05, pass 1 (security and correctness lenses): high 0, medium 7, low 8. Routed: patch 11, defer 5, reject 3. No intent_gap or bad_plan.
  - Retry and Resume bypassed the dispatch lock, so limits could be exceeded (both lenses) -- medium, patch: both take the dispatch lock; a queued launch re-checks capacity under the repo lock.
  - Stop then Retry let the old turn's verdict overwrite the restarted run -- medium, patch: a generation per start, bumped by Stop and Retry; an older decision is dropped and announces no verification.
  - Resume at the done checkpoint held the repo lock for the whole test re-run -- medium, patch: the end checks run on their own after the resume answers.
  - A re-run whose pipes never close hung the run -- medium, patch: resolve shortly after the child exits.
  - Build all ready kept stale tried tickets -- medium, patch: a fresh set per request.
  - Build all ready could start a dependent on the agent's own word (a worktree plan saying built) -- medium, patch: prerequisites are read from the main checkout only, so a dependent waits for the merge.
  - Linux sandbox left host unix sockets (/run) visible -- medium, patch: /run is an empty tmpfs; macOS network deny covers unix sockets.
  - Retry shown for a run with no worktree; Retry of a superseded run; a queued checkpoint Continue sent the wrong prompt; vitest and jest print a files line before the tests count -- low to medium, patch: button hidden, latest run only, resume flag kept in the queue, tests line preferred, tests added.
  - Cosmetic (one-line brace, detached comment) -- low, patch.
  - The re-run is not stopped by Stop or Quit, and macOS Seatbelt leaves mach lookups and signals open -- medium, defer.
  - Read fences use unresolved credential folder paths and a short list; shared temp folders on macOS -- low, defer.
  - Queued runs not started when the piece is turned back on until another run ends or a restart -- low, defer.
  - Queue order versus createdAt for retried runs; the time limit sentence names the current setting, not the run's; test gaps for restart and races -- low, reject: minor, oldest first holds, wording only.

## Design Notes

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `pnpm test` -- all pass
- `pnpm e2e` -- all pass
- `pnpm run pack && pnpm smoke` -- pass
