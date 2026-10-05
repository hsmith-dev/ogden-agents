---
title: 'Contracts and stubs for epics 5 and 11'
type: 'feature'
ticket: '3'
created: '2026-10-04'
status: 'built'
baseline_revision: '548a76da1644473523296cea73080a6482e3b596'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'security']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-unattended-builds/epic-unattended-builds.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-build-runs-and-notifications/epic-build-runs-and-notifications.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 5's lanes (5.4 to 5.9) and epic 11's (11.1 to 11.4) need one frozen set of shared shapes, error codes, events, ports, stubs, fakes and routes to build against at once; 5.2's tracer left only the minimal shapes it needed.

**Approach:** Freeze in `shared` the run additions and its derived state, the build request, blocked codes with plain sentences, the verification result, review payload, approve/reject/retry/check-again requests, the run-limit and notification settings and the webhook payload, and the new run events; complete `VcsPort`, `SandboxPort`, `BuildRunnerPort` and add `NotifierPort` with `*-memory` stubs; extend the fake ACP build agent and fixtures; pre-register every new route of both epics (501 until its lane) and every adapter wiring slot. `builds` stays shipped (5.2 appended it) and every builds route stays on `bmadPieceRoutes`.

## Boundaries & Constraints

**Always:** Back-compatible: every event and `Run` 5.2 (or earlier) stored still parses (new fields optional or defaulted). AD-8's `outcome` stays exactly `running | verified | failed | blocked | stopped`; the nine-plus states are derived from run fields by one shared function. Every shared shape and user-facing sentence lives in `shared`, with no em or en dash. Workspace build routes register only through `bmadPieceRoutes('builds', …)` (guard, then trust, before the body is read); install-level run-limit and notification routes are unguarded and name no BMad segment. Halt-to-code mapping lives only in `buildrunner-acp` (AD-12). Tests never run real claude, the keychain or the network, never read the real `~/.claude`; test hooks only under `testHooksAllowed`. Webhook payloads carry no code, diff, path or secret; webhook URLs never appear in events.

**Never:** No dispatcher, queue, limits enforcement, Stop, Retry, test re-run, sandbox chain, Build dialog, run view, Runs tab, notification sending or settings storage (lanes 5.4 to 11.4). No change to 5.2's behaviour beyond recording `blockedCode`/`decision`. No new allow-list entry in 10.6's guard-coverage test. No separate run WebSocket.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Old run event | 5.2 `run.created`/`run.outcome_changed` without new fields | parses; `agent` `claude-code`, others `null` | — |
| One ticket | `POST …/builds {ref}` (agent omitted) | 5.2 path unchanged, run `agent: claude-code` | — |
| All ready | `POST …/builds {all: true}` | nothing written | 501 `not_implemented` |
| Unknown agent | `{agent: 'codex', ref}` | nothing written | 400 `invalid_request` |
| New workspace route | stop, retry, check-again, runs, run, build-settings | guards first | 409 `feature_off` off; 501 on |
| Install route | run-limits, notifications, webhooks, test | behind the gate, no piece guard | 501 `not_implemented` |
| Blocked code | every `BLOCKED_CODES` value | one plain sentence (time limit names minutes) | — |
| Every halt | each `bmad-build-auto` blocking condition | a blocked code; unknown → `other` | — |
| Phase | outcome × blockedCode × queue × decision | one `RunPhase` | — |
| Merge conflict / reject / approve (5.2) | approve conflicts / reject / approve | `blockedCode: merge_conflict` / `decision: rejected` / `decision: approved` | — |

</frozen-after-approval>

## Code Map

- `packages/shared/src/entities.ts` `Run` -- add `agent`, `blockedCode`, `queuePosition`, `decision` (defaulted); keep `outcome` and `sandbox: string` (a test sandbox stores `test`).
- `packages/shared/src/builds.ts` -- 5.2's requests, responses and sentences; `StartBuildRequest` is `.strict()` `{ref}`; `ReviewResponse`; reuse its message constants.
- `packages/shared/src/events.ts` (592 lines) -- `RunCreatedInput`/`RunOutcomeChangedInput` at ~201-215, unions at ~340/~380: move run events to a new `events-runs.ts` (like `events-settings.ts`) and re-export.
- `packages/shared/src/errors.ts` -- the 5.2 build codes exist; add `run_not_active`.
- `packages/shared/src/api.ts` ~255-268 -- build routes; add the new ones (see Tasks). `tests/route-literals.test.ts` may check literals.
- `packages/core/src/{vcs-port,sandbox-port,build-runner-port}.ts` -- 5.2's minimal ports; `errors.ts` `BuildRefusalCode`/`BuildRefusedError` ~464.
- `packages/core/src/builds.ts` -- 5.2 use-cases: set `blockedCode` where it blocks (`merge_conflict`), `decision` on approve/reject; `entities.ts` `createRun`/`setRunOutcome`/`settleInterruptedRuns` (code `interrupted`); `db/schema.ts` runs table + `drizzle/0011_*` migration (and `meta` journal, as 0010 did).
- `packages/adapters/src/sandbox-claude-native/index.ts` `createFixedSandbox` -- move to `sandbox-memory/` (re-export); `buildrunner-acp/index.ts` -- the only place naming the skill; add halt mapping. `tickets-memory/`, `catalog-memory/` -- stub pattern.
- `packages/server/src/build-routes.ts`, `bmad-pieces.ts`, `errors.ts` `notImplemented`, `start-builds.ts`, `start-types.ts` (`vcs`, `sandbox` slots exist), `app.ts` -- routes and wiring. Install-level route pattern: `bmad-routes.ts` new-projects.
- `packages/server/test/gate.test.ts` `EXPECTED_API_ROUTES` + piece-route list ~633/~650; `bmad-guard-coverage.test.ts` `BUILD_ROUTES`/`TRUSTED_ROUTES`; `stub-routes.test.ts` 501 pattern.
- `tests/fixtures/fake-acp-agent.mjs` build mode ~421 (`FAKE_ACP_BUILD_OUTCOME`), `tests/fixtures/fake-bmad-repo.ts` `FAKE_BUILD_TICKET_FILES` (ready `1.1`, waiting `1.2` exist).
- `.claude/skills/bmad-build-auto/step-0*.md`, `workflow.md` -- the halts' blocking conditions (Design Notes).
- `tests/e2e-installed/bmad-journey.spec.ts` ~190 -- already names only Retrospectives Coming soon; keep.

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/build-runs.ts` (new) -- `BUILD_AGENTS = ['claude-code']`; `SANDBOX_KINDS` (`seatbelt`,`bubblewrap`,`docker`) and `ATTENDED_SANDBOX`; `BLOCKED_CODES` + `blockedSentence(code, {minutes?})`; `RUN_DECISIONS`; `RUN_PHASES` + `runPhase(run)`; `RunQueueEntry`; `BuildRunResult` (per-run JSON result).
- [x] `packages/shared/src/build-verification.ts` (new) -- `VERIFICATION_CHECKS` (`plan_built`,`tests_pass`,`code_changed`) with labels, `CheckResult` (`pass|fail|not_run`, detail), `VerificationResult`, `testsFailedDetail(n)`, `NO_TEST_COMMAND_DETAIL`, `MAX_TEST_OUTPUT_TAIL_BYTES`, `CheckAgainRequest`.
- [x] `packages/shared/src/build-settings.ts` (new) -- `RUN_LIMIT_DEFAULTS` (2, 3, 45) with bounds, `RunLimitSettings`, `WorkspaceBuildSettings {maxConcurrentRuns, testCommand}` and update requests/responses; `NOTIFICATION_EVENTS`, `NotificationSettings`, `WebhookTarget` (id, host, events; never the URL), add/update webhook requests, `WebhookTestResult`, `WebhookPayload`; sentences.
- [x] `packages/shared/src/builds.ts`, `entities.ts`, `errors.ts`, `api.ts`, `events-runs.ts` (new), `events.ts`, `index.ts` -- `StartBuildRequest` = `{agent?, ref}` or `{agent?, all: true}`; `ReviewResponse` + `summary`, `verification`, `findings`, `diffStats` (defaulted); `RejectBuildRequest {note?}`, `RetryRunRequest {mode: resume|rebase|apply_fix, note?}`, `RunResponse`, `RunsResponse {runs, queue}`; `Run` fields; events `run.dispatched`, `run.queue_changed`, `run.verification_completed`, `run.decided`, `workspace.build_settings_changed`, `settings.run_limits_changed`, `settings.notifications_changed`, `run.outcome_changed` + optional `blockedCode`; routes `workspaceRuns`, `workspaceRun`, `runStop`, `runRetry`, `runCheckAgain`, `workspaceBuildSettings`, `runLimits`, `notificationSettings`, `notificationWebhooks`, `notificationWebhook`, `notificationWebhookTest`; error `run_not_active`.
- [x] `packages/core/src/{vcs-port,sandbox-port,build-runner-port,notifier-port}.ts`, `index.ts` -- `VcsPort` + `diffStats`, `rebase`, `applyPatch`, `worktreeExists`; `SandboxPort.check({agent})` with unavailable `choices`; `BuildRunnerPort` + `agent`, `invocation(ref, {note?, resume?})`, `blockedCode(condition)`, `readResult(runFolder)`; `NotifierPort.send(url, payload, {timeoutMs})` → `WebhookTestResult`.
- [x] `packages/core/src/{entities,builds,errors}.ts`, `db/schema.ts`, `drizzle/0011_run_contract.sql` -- columns `agent`, `blocked_code`, `queue_position`, `decision`; 5.2 records `merge_conflict`, `interrupted`, `approved`, `rejected`; `BuildRefusalCode` + `run_not_active`; all-ready → core `NotImplemented`.
- [x] `packages/adapters/src/{build-memory,vcs-memory,sandbox-memory,notify-memory}/index.ts`, `buildrunner-acp`, `sandbox-claude-native`, `vcs-git`, `index.ts` -- memory stubs recording calls; `buildrunner-acp` maps every halt; real adapters satisfy the completed ports (new `vcs-git` methods real; `readResult` reads the JSON result if present).
- [x] `packages/server/src/{build-routes,run-settings-routes,start-builds,start-types,app}.ts` -- new routes 501 after guards; `StartOptions` `buildRunner`, `notifier` slots.
- [x] `tests/fixtures/fake-acp-agent.mjs`, `fake-bmad-repo.ts`, `fake-test-command.mjs` (new) -- build halts by condition (`FAKE_ACP_BUILD_HALT`), intent-gap patch beside the plan, `FAKE_ACP_BUILD_FAIL_TESTS`, `FAKE_ACP_BUILD_DELAY_MS`; `FAKE_TEST_COMMAND_FILES` (package.json `test` → one node process, stdin ignored, "3 tests failed" when the marker exists).
- [x] Tests: `packages/shared/test/build-contracts.test.ts` (every shape, request, code, event incl. 5.2-era payloads, every blocked code's sentence, phase table); `packages/adapters/test/build-memory-stubs.test.ts` (every port method of the four stubs), halt mapping test, `vcs-git` new methods; core builds tests for recorded codes/decisions; `gate.test.ts`, `bmad-guard-coverage.test.ts`, `build-routes.test.ts` (501s, all-ready, bad agent), `stub-routes` for install routes; fake test command fixture test.

**Acceptance Criteria:**
- Given the fully wired app, when the route-registry and guard-coverage tests run, then every new workspace route is guarded under `/api/v1/workspaces/:wsId`, the install ones are not, and no allow-list entry was added.
- Given `GET /api/v1/bmad/pieces`, then `builds` is available.

## Implementation Notes

- 2026-10-04 (build): implemented directly by the build session from this plan (a previous attempt with a subagent stalled without saving), in local milestone commits.
- Shared: `build-runs.ts` (agents, sandbox kinds and choices, blocked codes and sentences, decisions, `runPhase`, queue entry, `BuildRunResult`), `build-verification.ts`, `build-settings.ts` (limits, project build settings, notifications, `WebhookPayload` `.strict()`), `events-runs.ts` (5.2's two run events moved here, seven new events; `events.ts` imports them as `runs.*` to stay under 600 lines). `WebhookId` (`hook_`). `WebhookUrl` takes `https:`, or `http:` to this computer only, and no user or password in the URL.
- Core: migration `0011_run_contract` (generated with `drizzle-kit`); `Entities.setRunOutcome(…, { blockedCode })` keeps a code only on `blocked`; `setRunDecision` appends `run.decided`; `settleInterruptedRuns` records `interrupted`. 5.2's builds record `merge_conflict`, `approved` (with the merge commit) and `rejected`, and the plan's blocked reason is turned into a code by `runner.blockedCode` (core still never reads it). `NotImplementedError` (501) for `{ all: true }`; an agent with no runner is 400.
- Ports: `VcsPort` + `diffStats`, `worktreeExists`, `rebase`, `applyPatch` (real in `vcs-git`, tested on temp repos); `SandboxPort.check({ agent })` with optional `choices` (native adapter gives them, Windows with attended first); `BuildRunnerPort` + `agent`, `invocation(ref, { note, resume })`, `blockedCode`, `readResult`; new `NotifierPort`.
- Adapters: `build-memory`, `vcs-memory`, `sandbox-memory` (`createFixedSandbox` moved here from `sandbox-claude-native`), `notify-memory`; `buildrunner-acp` maps every halt (test reads the conditions out of `.agents/skills/bmad-build-auto`). The skill's unresolved-questions halt has free text as its condition, so it maps to `other` and its words are the reason shown.
- Server: 7 workspace routes through `bmadPieceRoutes('builds')` and 8 install routes (`run-settings-routes.ts`), all 501; `StartOptions.buildRunner` and `notifier` slots.
- Fixtures: the fake agent's `FAKE_ACP_BUILD_HALT`, `FAKE_ACP_BUILD_FAIL_TESTS`, `FAKE_ACP_BUILD_DELAY_MS`; the fake test command is `FAKE_TEST_COMMAND_FILES` in `fake-bmad-repo.ts` (a string the repo gets, so no separate `fake-test-command.mjs`).

- Verified after the review patches: `pnpm typecheck` clean; `pnpm test` 1891 passed, 4 skipped; `pnpm e2e` 104 passed; `pnpm run pack && pnpm smoke` OK.

## Plan Change Log

## Review Triage Log

- 2026-10-04, pass 1 (lenses quick, security): high 2, medium 9, low 6, false 0, maybe-false 0. Routed: patch 14, defer 2, reject 4. No intent_gap or bad_plan: every patched defect is local to a function this story added, and the port signature changes for `rebase`/`applyPatch` only add the inputs the safety checks need (no lane uses them yet).
  - S1 `vcs-git` `rebase`/`applyPatch` ran git in the worktree, whose admin folder (`HEAD`, `commondir`) the sandboxed agent can write: a forged `HEAD` would move `main`, a forged `commondir` load the agent's config (filters, gpg) unsandboxed -- high, patch: `pinnedWorktree` checks `HEAD`, `commondir` and the `.git` link against the repo and runs git with `GIT_DIR`/`GIT_COMMON_DIR`/`GIT_WORK_TREE` set by Ogden, plus `commit.gpgsign=false`, `rebase.updateRefs=false`, `--no-update-refs`; port takes `{ repoPath, worktreePath, branch, … }`. Test: forged `HEAD` and `commondir` refused, `main` unmoved.
  - S2 `applyPatch` applies an agent-written patch unsandboxed, reaching protected paths -- high, patch: patch must be a regular file inside the worktree; `--numstat --summary` first; any symlink (120000) or a path `refuse` (core's protected paths) refuses it. Tests added.
  - S3 `BuildRunResult.intentGapPatch` unvalidated -- medium, patch: a `.patch` under `_bmad-output/`, no `..`, bounded.
  - S4 the result file could name its own `blockedCode`; `runId` not cross-checked; who writes it unclear -- medium, patch: field removed (code only through `runner.blockedCode`), `readResult(folder, { runId, ticketRef })` checks both, doc says Ogden's side writes it (the agent can't reach the data folder).
  - S5 / Q6 `readResult` read the whole file first and followed links -- medium, patch: `lstat`, regular file, size first. Test added.
  - S6 rebase timeout never aborted; Q9 any failure reported as `conflict` -- medium, patch: abort on a thrown run; `refused` when git never started it. Test added.
  - S7 `rebase.updateRefs` could move other branches -- medium, merged into S1's patch.
  - S8 `worktreeExists` true for the main checkout -- medium, patch: first entry skipped. Q4 `-z` needs git 2.36 and a failure read as `false` -- medium, patch: no `-z`, a failure throws.
  - S9 webhook redirects -- low, patch: `NotifierPort` says a redirect is never followed. Private-network https stays allowed (the user types the URL behind the gate).
  - S10 a webhook's host can hold its token -- medium, defer (11.4's own unknown on how a URL is listed back).
  - S11 the note to the agent appended raw -- low, patch: control characters stripped, fenced, no fence of its own; test added.
  - S12 `run.decided` couldn't show the reviewed revision -- low, patch: `reviewedRevision` added (optional); server test checks it is the merge's second parent.
  - S13 Reject's outcome and decision in two transactions -- low, reject: a crash between them shows `stopped`, and 0011's backfill and a repeat Reject don't depend on it.
  - S14 the test re-run executes agent code -- medium, patch: the verification contract now says it always runs inside the run's sandbox with no network.
  - S15 `git apply` symlink protection depends on git 2.39.2 -- medium, defer: no minimum git version is checked anywhere (5.5).
  - Q1 an unknown agent got "Invalid input" -- medium, patch: one object schema with the agent's own message and a refine for exactly one of `ref`/`all`. Test checks the message.
  - Q2 repeat Reject appended a duplicate `run.decided` -- medium, patch: `setRunDecision` is a no-op for the same decision and `reject` returns early. Tests added.
  - Q3 5.2-era runs got no code or decision -- medium, patch: 0011 backfills `rejected` for `stopped`, `interrupted` and `merge_conflict` from their stored reasons.
  - Q5 the unresolved-questions halt maps to `other` -- low, reject: the skill writes the questions themselves, which no prefix can name; the questions are the reason shown (Implementation Notes).
  - Q7 `blocked plan supplied` can't fire through core -- low, reject: harmless, and start refuses a plan that isn't ready.
  - Q8 `StartOptions.notifier` read by nothing -- low, reject: a declared slot for 11.4, documented so.
  - Q10 fixture comment named a missing file -- low, patch.

## Design Notes

- **States without changing AD-8:** `runPhase(run)`: `running`+`queuePosition` → `queued`; `running` → `running`; `blocked`+`checkpoint_*` → `checkpoint`; `blocked`+`interrupted` → `interrupted`; other `blocked` → `needs_you`; `verified` → `approved` if `decision` approved else `built`; `failed` → `failed`; `stopped` → `rejected` if `decision` rejected else `stopped`.
- **Blocked codes** (Ogden's; halts → codes in `buildrunner-acp` only): `unclear_intent` (unclear intent; the unresolved-questions halt writes the questions themselves, so it reads as `other` with them as the reason), `intent_gap`, `plan_not_ready` (plan failed RFD standard, matrix ambiguity, matrix test audit failed, handoff conflicts with plan), `verification_failed` (implementation / patch verification failed), `review_loop_exceeded`, `ticket_not_found` (ticket not resolved, missing plan_file, plan file disappeared), `blocked_plan`, `checkout_problem` (dirty tree, branch mismatch, metadata not writable, finalization left repository dirty), `no_subagents`, `merge_conflict`, `time_limit`, `interrupted`, `checkpoint_plan`, `checkpoint_done`, `agent_error`, `other`. Every halt in the skill maps (the entry's unknown).
- **Run stream:** a build session's `session.*` and `run.*` events travel on the existing `/ws` workspace subscription (AD-5); no run socket exists, so nothing on `/ws` serves builds outside the guard.
- **Routes** (all `…/workspaces/:wsId/`): `runs` GET, `runs/:runId` GET, `runs/:runId/stop|retry|check-again` POST, `build-settings` GET/PATCH. Install: `/api/v1/settings/run-limits` GET/PATCH, `/api/v1/settings/notifications` GET/PATCH, `…/notifications/webhooks` POST, `…/webhooks/:webhookId` PATCH/DELETE, `…/webhooks/:webhookId/test` POST.
- Plan kept whole (~2,400 tokens): one contract surface; splitting would freeze half the shapes.

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `pnpm test` -- all pass
- `pnpm e2e` -- all pass
- `pnpm run pack && pnpm smoke` -- pass
