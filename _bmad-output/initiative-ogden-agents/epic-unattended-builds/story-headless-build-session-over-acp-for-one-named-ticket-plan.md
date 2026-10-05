---
title: 'Headless build session over ACP for one named ticket'
type: 'feature'
ticket: '4'
created: '2026-10-04'
status: 'built'
baseline_revision: '4f8f0c5dd946fd44e26acc01d7c2f8296fb62be7'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'security']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-unattended-builds/epic-unattended-builds.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-unattended-builds/story-tracer-bullet-one-ticket-built-reviewed-and-approved-from-a-plan.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-unattended-builds/story-contracts-and-stubs-for-epics-5-and-11-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The tracer's (5.2) `build` session streams into the session view, but nothing records a run outside the event log: no NDJSON activity and no per-run JSON result in the run's folder (the two bmad-integration.md extensions Ogden now owns), no checkpoint pause and resume, and no test that stopping a run leaves no process behind. 5.7's runner reads exactly these.

**Approach:** On Ogden's side of the headless ACP build session (core, agent-neutral; the Claude Code adapter keeps the agent a direct child): a run folder `<data>/r/<run8>` per run; a recorder that appends the run's `session.*` and `run.*` events (as stored, already masked) to `activity.ndjson`; a validated `result.json` written atomically each time the session's turn ends; checkpoint pauses as a `blocked` run with `checkpoint_plan` / `checkpoint_done` that a resume use-case continues in the same agent session, or in a fresh one from the plan's status when the agent is gone (server restart); the frozen `runs/:runId/retry` route serves resume for a run at a checkpoint only.

## Boundaries & Constraints

**Always:** Run folder and its files only under Ogden's data folder (folder `0o700`, files `0o600`), never in the repo or worktree; the sandbox's `denyRead` of the data folder already keeps the agent out. `result.json` is parsed with the frozen `BuildRunResult` before it is written, through a temp file and rename; its `blockedCondition` and `blockedReason` are masked; no secret, no env. The activity file is bounded (32 MiB, then one `truncated` line). Resume calls the full builds guards, re-checks the sandbox (fail closed), re-checks the worktree's `_bmad/scripts/` against the trust, re-registers the run's setup (worktree, sandbox, policy) and refuses anything but a run at a checkpoint (`run_not_active`). A run at a checkpoint counts as active for `start` (`run_active`). Stopping a run is `chat.releaseAgent` (adapter `killProcessTree`); a test proves the agent and a grandchild it spawned are gone. Tests use only the fake ACP agent; no real claude, keychain, network or `~/.claude`; test hooks only under `testHooksAllowed`. Core names no skill (AD-12). No acp-base client or `child-env.ts` on this lineage: keep the existing Claude Code adapter and env allowlist.

**Never:** No Stop route, time limit, generic Retry, Quit/restart settling beyond today's, dispatcher, queue or UI (5.7, 5.8, 11.1). No change to 5.3's frozen shapes beyond additive, defaulted fields. No bmad-loop, tmux or psmux.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | ready ticket, no checkpoints | `activity.ndjson` + `result.json` (status `built`, commit = branch head, base) in `<data>/r/<run8>`; nothing new under the repo | — |
| Halt | plan `blocked` (intent gap) | result names the condition and the `.patch` beside the plan | patch path only if a regular file under `_bmad-output` |
| Plan checkpoint | ticket `plan_checkpoint = true` | run `blocked` `checkpoint_plan`, result written | — |
| Resume, same agent | resume at a checkpoint | run `running`, the build continues in the same ACP session | guards, sandbox, scripts re-checked |
| Resume after restart | checkpoint, server restarted | fresh agent session, invocation resumes from the plan's status | — |
| Done checkpoint | `done_checkpoint = true`, plan `built` | run `blocked` `checkpoint_done`; resume runs the end checks | — |
| Not at a checkpoint | resume on running/verified/other blocked | 409 `run_not_active`, nothing changes | — |
| Unreadable plan | plan missing at turn end | result `status: null`, run `failed` as today | — |
| Stop | release a running build | agent and its child processes gone | — |

## Decisions

- 2026-10-04, user (Q1 = A): **checkpoint pauses are Ogden's own.** `bmad-build-auto` stops after planning only when told "Halt after planning." and has no stop after `built`, and Build accepts only a `ready-for-dev` plan (5.2's rule, unchanged). So with `plan_checkpoint` the run pauses (`blocked`, `checkpoint_plan`) right after its worktree and session exist and before the build prompt is sent; with `done_checkpoint` it pauses (`checkpoint_done`) when the plan ends `built`, before Ogden's end checks. Resume continues either way: it sends the prompt, or runs the end checks. The `tickets-v7` adapter reads `plan_checkpoint`/`done_checkpoint` from the entry in `tickets.toml`, read-only (`tickets.py find` doesn't report them).

</frozen-after-approval>

## Code Map

- `packages/core/src/builds.ts` -- `startLocked` (worktree `<data>/w/<run8>`, `buildSessions.set`, `chat.sendMessage(…runner.invocation)`), `decideOutcome` (turn end: plan status, diff checks, `releaseAgent`, `setRunOutcome`), the `session.state_changed` subscription. Add the run folder, result write, checkpoint branch, `resume`.
- `packages/core/src/build-sessions.ts` -- in-memory setup; lost on restart, so resume rebuilds it from the run (`worktreePath`, `branch`, `sandbox`).
- `packages/core/src/chat/agents.ts` `agentFor` -- `storedAgentSessionId` reopens a previous agent session; resume after restart clears the build session's `AGENT_SESSION_REF` so a fresh one starts.
- `packages/core/src/entities.ts` -- `activeRunForTicket` (only `running`): `start` also refuses the latest run at a checkpoint; `setRunOutcome(…, 'running')` for resume.
- `packages/core/src/event-log.ts` `subscribe(lastSeq)` -- events carry `streamId` = session id for `session.*` and `run.*`.
- `packages/shared/src/build-runs.ts` -- frozen `BuildRunResult`, `BUILD_RESULT_FILE`, `BUILD_ACTIVITY_FILE`, `CHECKPOINT_BLOCKED_CODES`, `blockedSentence`; `planning-board.ts` `TicketDetail` (add defaulted `plan_checkpoint`, `done_checkpoint`).
- `packages/adapters/src/tickets-v7/index.ts` `find` -- read the two booleans from the entry in its epic's `tickets.toml` (regular file inside the repo, bounded); `tickets-memory` stub likewise.
- `packages/adapters/src/buildrunner-acp/index.ts` -- `readResult` already validates; 5.7 completes the rest.
- `packages/server/src/build-routes.ts` line ~157 `runRetry` (501) -- serve `mode: resume` for a checkpoint run, else 501.
- `tests/fixtures/fake-acp-agent.mjs` build mode (~431) -- add `FAKE_ACP_BUILD_CHILD=<pidfile>` (spawns a long-lived grandchild); `tests/fixtures/fake-bmad-repo.ts` -- a checkpoint ticket.
- Tests: `packages/core/test/builds.test.ts`, `packages/server/test/build-routes.test.ts`, `packages/adapters/test/process-tree.test.ts` / `acp-claude-code.test.ts`, `tickets-v7` tests.

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/planning-board.ts` -- `plan_checkpoint`, `done_checkpoint` on `TicketDetail` (default false).
- [x] `packages/adapters/src/tickets-v7/index.ts`, `tickets-memory` -- read them.
- [x] `packages/core/src/build-run-folder.ts` (new) -- run folder path, activity recorder (event-log subscriber, per-run serialized appends, cap), `writeRunResult` (validate, mask, atomic).
- [x] `packages/core/src/builds.ts` -- result at every turn end; checkpoint pauses; `resume(ws, runId)`; checkpoint run blocks `start`.
- [x] `packages/server/src/build-routes.ts` -- retry route resumes a checkpoint run.
- [x] Fixtures and tests per the matrix, plus a process-tree test with the fake agent's grandchild.

**Acceptance Criteria:**
- Given a finished build, when the repo is listed, then it has no new file and the run's two files are in the data folder.
- Given a build released mid-turn, then the agent's pid and its grandchild's pid are gone.

## Implementation Notes

- 2026-10-04 (build): implemented directly by the build session from this plan (no implementation subagent: the plan's context was already loaded, and 5.3's subagent attempt stalled), in local milestone commits.
- The run folder is `<data>/r/<run8>` (review: first built as `<data>/r/<runId>`, a deviation from the Intent; now the run's 8-character id from its branch, validated as `[a-z2-7]{8}`). `build-run-folder.ts` holds `runFolderOf`, `writeRunResult` (parsed with `BuildRunResult`, temp file `wx` then rename, folder `0o700`, file `0o600`) and the activity recorder (an event-log subscriber from `lastSeq`; a stream is a build run's when its session is `build` and has a run; lines masked again with the builds `mask`; `session.message_delta` skipped; per-run serialized appends; bound injectable for tests).
- `TicketDetail` gained optional `plan_checkpoint`/`done_checkpoint` (absent means false, so 4.x fixtures stay valid); `tickets-v7` reads them in `checkpoints.ts` from `<dirname(epic_file)>/tickets.toml` (regular file, real path inside the repo, at most 1 MiB, only `key = true` lines in the `[[entry]]` whose `id` matches). `tickets-memory` and the plan-file fixture store take them too.
- Core: the result is written at every stop (plan pause, done pause, end of run), never failing the run; `networkFailure` is set when the agent's own message or a tool call title in the run holds a no-network error (ENOTFOUND, EAI_AGAIN, getaddrinfo, could not resolve host, …; events carry no tool output); `blockedCondition` is the plan's `blocked_reason` masked, `blockedReason` the run's own reason. `resume` and `retry` are on `BuildsUseCases`; Retry with `mode: resume` on a checkpoint run resumes (its note reaches the plan-checkpoint prompt through `runner.invocation`); Retry of a run running, ready for review or decided is 409 `run_not_active`; every other Retry is `NotImplementedError` (501) until 5.8. `RETRY_NOT_AVAILABLE_MESSAGE` added to shared.
- A plan-checkpoint pause never started the agent, so a resume after a restart needs no agent-session reset: rebuilding the in-memory setup is enough, and the prompt starts a fresh agent session in the worktree.
- The fake ACP agent's `FAKE_ACP_BUILD_CHILD=<file>` leaves a command running; the server test checks the agent and that child are gone once the run ends (`releaseAgent` → `killProcessTree`).
- Not here: the attended build (permission cards for every tool call) has no start path until 5.6, so `BuildSessionSetup` still always carries the deny-by-default policy. Follow-up when the lines meet: move the build session onto epic 6's `acp-base` client and `adapters/src/child-env.ts` (neither is on this lineage; the existing Claude Code adapter and env allowlist are kept).
- Verified after the review patches: `pnpm typecheck` clean; `pnpm test` 1910 passed, 4 skipped; `pnpm e2e` 104 passed; `pnpm run pack && pnpm smoke` OK.

## Plan Change Log

## Review Triage Log

- 2026-10-04, pass 1 (lenses quick, security): high 1, medium 7, low 9, false 0, maybe-false 0. Routed: patch 12, defer 2, reject 6. No intent_gap or bad_plan: each patched defect is local to a function this story added.
  - Q1 / S1 the agent can switch off `done_checkpoint` by editing the worktree's `tickets.toml` uncommitted -- high, patch: read in the main checkout after `requireScriptsUnchanged`; test.
  - Q2 Retry of a running or verified run answered 501, the route doc says 409 -- medium, patch: `run_not_active` for running, verified or decided runs; other blocked runs stay 501 (5.8); tests for running, other blocked, verified.
  - Q3 / S8 Retry's body limit (1 KiB) smaller than its 4,000-character note -- medium, patch: own 64 KiB limit; test with the longest note.
  - Q4 / S7 a resume whose prompt can't be sent left the run `running` forever -- medium, patch: the pause is restored and the error thrown; test.
  - Q5 Retry's note dropped on the done checkpoint -- low, reject: no prompt follows a done pause; harmless.
  - Q6 run folder `<data>/r/<runId>` against the Intent's `<run8>` -- medium, patch: `runFolderOf(dataDir, run8)` from the run's branch.
  - Q7 / S6b `networkFailure` set by any text, the user's included -- medium, patch: only the agent's messages and tool call titles; test with a user message. That the agent can set it in its own words is by design (no tool output in events): reject that part.
  - Q8 `networkFailure` lost across a restart -- low, reject: a done pause resumed after a restart only; fix would read the old result back.
  - Q9 / S6a truncation not kept across a restart -- low, patch: a file ending in the marker, or at its bound, stays truncated; test.
  - Q10 `session.created` before the run exists is not in the activity -- low, reject: the activity starts at the run; nothing the run view needs is lost.
  - Q11 mid-turn release not tested -- medium, patch: server test stops the server mid-turn and checks the agent and its child are gone.
  - Q12 checkpoint flags optional, not defaulted -- low, patch: `.default(false)`.
  - Q13 / S2 the checkpoint reader misread multi-line strings and nested-array lines (fail open, shadow entries) -- medium, patch: multi-line strings skipped, only real table headers end an entry; tests. `bmad-catalog/toml.ts` keeps no booleans, so it can't be reused.
  - Q14 intent-gap patch path through a symlinked folder -- low, patch: real path must be inside the worktree's own `_bmad-output/`.
  - Q15 fixture child without an `error` handler -- low, patch.
  - S3 FIFO or link swapped in between the reader's checks and its open -- medium, patch: `O_NOFOLLOW | O_NONBLOCK` and `fstat` on the opened handle.
  - S4 a descendant that leaves the process group (`setsid`) or whose parent exited on Windows survives `killProcessTree` -- medium, defer: pre-existing (9.6's `process-tree.ts`); the sandbox still holds it.
  - S5 the second mask ran on JSON-escaped text -- low, patch: every string masked before encoding; test with a quote.
  - S6c run folders and in-memory maps are never pruned -- low, defer: retention belongs with run cleanup (5.8, 11.1).
  - S7b resume doesn't re-check the ticket's status or a newer run -- low, reject: start refuses while the latest run is paused, and the plan's status is read when the turn ends.

## Design Notes

- One run folder per run, `<data>/r/<run8>` (the worktree's short id), short for Windows paths.
- NDJSON lines are the stored events (`seq`, `at`, `type`, `payload`) of the run's session stream, so they match the session view (AD-5).
- `networkFailure` is set when the agent's own messages or tool call titles in the run match common no-network errors (`ENOTFOUND`, `EAI_AGAIN`, `getaddrinfo`, `Could not resolve host`): the events carry no tool output.
- `done_checkpoint` is read in the main checkout at the turn's end (after the scripts check), never in the worktree, whose `tickets.toml` the agent can edit.
- Follow-ups: move the build session onto epic 6's `acp-base` client and `child-env.ts` when the lines meet.

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `pnpm test` -- all pass
- `pnpm e2e` -- all pass
- `pnpm run pack && pnpm smoke` -- pass
