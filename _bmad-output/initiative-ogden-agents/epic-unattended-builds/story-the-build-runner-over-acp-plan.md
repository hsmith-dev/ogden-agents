---
title: 'The build runner over ACP'
type: 'feature'
ticket: '7'
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
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-unattended-builds/story-headless-build-session-over-acp-for-one-named-ticket-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Stories 5.2 to 5.6 built most of the runner already (the `build` session on the shared ACP client, the allowlisted environment, the run folder, checkpoint pauses, halt mapping), but nothing yet reads a run's per-run JSON result back through the runner and cross-checks it, nothing proves the skill's real halts all map to a code, and nothing proves the API key stays out of every event, file and log of a build. A branch that moves after the end checks (a command the agent left running) is not noticed before the run shows as ready for review.

**Approach:** Finish the runner's side: core reads the result it wrote back through `BuildRunnerPort.readResult` and fails the run when the result disagrees with the plan, the run or the branch head the end checks saw; a contract test reads the installed `bmad-build-auto` and fails when a halt condition has no Ogden code; a server test runs a build with a key and an unlisted secret in the server's environment and checks the child's environment, events, run folder and log; the fake build agent can dump its environment.

## Boundaries & Constraints

**Always:** Core names no skill and never reads a halt's words (AD-12): only `buildrunner-acp` does. The status a run ends with stays the plan's, read in the worktree through the trusted scripts; the result is a cross-check, never a second source of truth. A run is `verified` only when its result reads back, says `built`, names the branch head the checks diffed and the run's base. Nothing is written under the repo outside the worktree and git's own metadata. Tests use only the fake ACP agent, the memory secret store and fixture repos; never a real agent, keychain, network or `~/.claude`. No UI text holds an em or en dash.

**Never:** No change to the frozen shapes except additive sentences. No dispatcher, limits, Stop, Retry beyond 5.4's, verification re-run, review page (5.8, 5.9). No second runner, no bmad-loop, tmux or psmux.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | plan built, head unchanged | result written and read back, run `verified` | none |
| Branch moved after the checks | a commit lands on the branch between the end checks and the result | run `failed`, reason says the build changed while it was being checked | result still written |
| Result unreadable | the run folder's `result.json` is missing or invalid after the write | run `failed` with the same reason | reported with a code only |
| Result disagrees | read back status or base differs from the plan or the run | run `failed` | same |
| Halt in the skill | any `blocking condition` in the installed skill | maps to a code other than `other` | contract test fails, naming the condition |
| Key in the environment | `ANTHROPIC_API_KEY` and an unlisted secret in the server's environment | child has the allowlist and the key only; the key is in no event, NDJSON line, result, log or review | the agent printing it is masked |

</frozen-after-approval>

## Code Map

- `packages/core/src/builds.ts` -- `decideOutcome` (the end checks, `writeResult`, `setRunOutcome`): write and read back the result before a `verified` outcome; compare with the head the checks saw.
- `packages/core/src/build-runner-port.ts`, `packages/adapters/src/buildrunner-acp/index.ts` -- `readResult` is the read-back; halts list stays here only.
- `packages/shared/src/builds.ts` -- the plain sentence for a result that did not hold.
- `tests/fixtures/fake-acp-agent.mjs` -- `FAKE_ACP_BUILD_ENV_DUMP`, `FAKE_ACP_BUILD_ECHO_KEY`.
- Tests: `packages/adapters/test/build-adapters.test.ts` (halt drift), `packages/core/test/builds.test.ts` (read-back cross-check), `packages/server/test/build-session.test.ts` (environment, secrets, late commit).

## Tasks & Acceptance

**Execution:**
- [ ] `packages/shared/src/builds.ts` -- `RUN_REASON_RESULT_MISMATCH`.
- [ ] `packages/core/src/builds.ts` -- result read back and cross-checked before `verified`.
- [ ] `tests/fixtures/fake-acp-agent.mjs` -- the two switches (the late-commit case is a core test: the fake VCS moves the branch while the diff is read).
- [ ] Tests per the matrix.
- [ ] `deferred-work.md` -- index lines for what the reviews defer.

**Acceptance Criteria:**
- Given a build whose branch gets a commit after the end checks, when the run ends, then it is `failed`, not `verified`, and cannot be approved.
- Given a key and an unlisted secret in the server's environment, when a build runs, then the agent's environment holds the key and no unlisted name, and no file or event the run left holds the key's value.
- Given the installed `bmad-build-auto`, when its halts are read, then every one maps to an Ogden code.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Design Notes

- The per-run result is written by core (5.4: the sandboxed agent cannot reach the data folder), so a read-back cannot catch the agent lying; it catches a result that did not land, and, because the result's `commit` is the branch head read after the agent was released, a branch that moved after the end checks.

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `pnpm test` -- all pass
- `pnpm e2e` -- all pass (build specs)
- `pnpm run pack && pnpm smoke` -- pass
