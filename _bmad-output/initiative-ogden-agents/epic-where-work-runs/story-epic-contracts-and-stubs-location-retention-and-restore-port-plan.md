---
title: 'Epic contracts and stubs: Location, retention and Restore, ports, multi-agent trials'
type: 'feature'
ticket: '2'
created: '2026-11-01'
status: 'built'
baseline_revision: '74f0ac19168d6cccbcfe6a863161479ace16f8b0'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: ['{project-root}/AGENTS.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 27's lanes (worktree chats 27.3, hand-off 27.4, remote Location 27.5, retention and Restore 27.6, ports 27.7, trials 27.8) share contracts that don't exist yet, and two architecture notes block them: AD-8's CAP-33 note fixes `worktreePath` forever, and AD-17's says a chat worktree is removed only with the chat (E27-R3 to R7; CAP-35).

**Approach:** Add the shared schemas, texts, ids, error codes, events and `API_ROUTES` for a chat's Location, hand-off, retention (setting and put-away records) and Restore, per-worktree ports and trials; core port and use-case interfaces with in-memory port stubs; the one entity writer that changes a chat's worktree (with its event); every route behind the AD-15 gate answering 501 until its lane wires it; and an architecture test that no server route file runs git. Encode and record the user's two decisions of 2026-11-01 (below).

**Decisions (user, 2026-11-01):** (1) A chat's worktree can change, but only through Hand off, which records `session.location_changed` (like `session.agent_changed`) so history shows where each turn ran; AD-8's CAP-33 note becomes "set at creation; changed only by Hand off, recorded as an event". (2) Beyond the user's cap (default 15, set in Settings), the oldest idle chat worktree is snapshotted (uncommitted changes kept, AD-37's snapshot store) and removed automatically, never while an agent works in it; Restore brings it back. AD-17's CAP-33 note gains that exception.

## Boundaries & Constraints

**Always:** event payloads `.strict()` with ids, states, branch names, ports and counts only (never a path, file content or task text); `{error:{code,message}}`; `/api/v1`; no em or en dashes in UI strings; no git or `child_process` in core, shared, web or any server route file; `worktreePath`/`branch` written only by `createSession` and the new hand-off writer; retention and hand-off refuse a `working` or `waiting` chat (`agent_mid_turn`).

**Never:** a git implementation of the new VCS operations, a port probe on the real network, the retention sweep, a trial runner or any UI (27.3 to 27.8); wiring these use-cases in `start.ts`; putting these routes on a device allowlist; editing `deferred-work.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Hand-off writer to worktree | this-folder chat, path + `ogden/chat/<id>` | row updated, `session.location_changed` {location worktree, previous this_folder, branch, files, resumes} in one transaction | wrong branch, relative path, one without the other: `ValidationError` |
| Hand-off writer back | worktree chat, `null`/`null` | path and branch null, event previous worktree | none |
| Writer on build/planning or remote chat | | nothing written | `InvalidOperationError` |
| Unchanged | same place | no event | none |
| Retention setting | `{keep: 0}` or `101` or `2.5` | | 400 (schema), default 15 |
| Trial request | 1 agent, or 5, or duplicates | | 400 |
| Event with a path | `session.location_changed` payload plus `worktreePath` | rejected by the schema | |
| Unwired lanes | every new route on the real server | | 501 `not_implemented` |
| Planted git in a route | `'git status'` in `packages/server/src/x-routes.ts` | architecture test flags it | |

</frozen-after-approval>

## Code Map

Project root is the worktree `/Users/harrisonsmith/Library/Caches/ogden-agents-dev-worktrees/27.2`; every path is relative to it and every command runs there. Never edit another checkout, never `git stash`, push, switch branches or commit (the orchestrator commits). The machine is loaded: check `uptime` before `pnpm test`; re-run timing failures alone.

- Pattern to copy: 8.2's commit `d715ef82` (`git show d715ef82 -- <file>`): `packages/shared/src/events-workbench.ts` (strict event module, `onSessionStream`/`onWorkspaceStream`/`assigned` from `events-envelope.ts`; registered and re-exported in `events.ts`), `workbench-changes.ts` (contract types and texts), `packages/server/src/workbench-routes.ts` (501 when the use-case is `undefined`, `workbenchRefusal`, `NO_STORE`, `bodyLimit`), `app.ts` `AppOptions`/registration, `packages/core/src/project-commands.ts` (interface-only use-case), `vcs-port.ts` `VcsWorkingTreePort` (separate interface so `VcsPort` fakes stay untouched), `adapters/src/vcs-memory/working-tree.ts`, `project-commands-memory/`.
- `packages/shared/src/chat.ts:34-60` -- `ChatLocation` (`this_folder|worktree`), Location texts (27.1); add the new texts beside them or in the new module.
- `packages/shared/src/ids.ts` -- add `trial: 'try'` (EXPERIENCE route `/w/:wsId/try/:tryId`), `worktreeSnapshot: 'wsn'`; `RemoteMachineId` exists; `TurnId` pattern.
- `packages/shared/src/api.ts:532` `sessionWorktreeCommit` route pattern; `errors.ts` `API_ERROR_CODES` (`agent_mid_turn`, `invalid_operation` exist).
- `packages/core/src/entities.ts` -- `setSessionAgent` (~line 669) is the pattern for the new `setSessionWorktree`; `checkedWorktree` (~356) validates; `createSession` doc (~103-112) says "set at creation and never changed": update.
- `packages/core/src/errors.ts` (`AgentMidTurnError`, `InvalidOperationError`), `core.ts` (optional use-cases), `index.ts` exports.
- `packages/server/test/gate.test.ts` `EXPECTED_API_ROUTES` (~576), `bmad-guard-coverage.test.ts` (list each new route as serving no piece), `test/workbench-routes.test.ts` (501 tests pattern).
- `tests/architecture.test.ts:1129-1205` -- `WORKBENCH_ROUTE_FILE`, `findWorkbenchProcessViolations` with planted cases; widen to every `packages/server/src/*-routes.ts` and `app.ts`. `packages/server/src/build-routes.ts:97` logs `'git failed'`, which the widened check flags: reword it (no test asserts it; grep first).
- Web: `packages/web/src/chat/transcript.ts:245` and `workspaces/workspace-api.ts` switch on event types; add no UI, only what typecheck demands.

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/where-work-runs.ts` (new) -- `SessionLocation` (discriminated: `this_folder`; `worktree` {branch, port nullable, putAway boolean}; `remote` {machineId}) and `SessionLocationResponse`; `HandOffRequest` {to: ChatLocation}, `HandOffResponse` {session}; `WORKTREE_RETENTION_DEFAULT = 15`, `WorktreeRetentionSetting` {keep: int 1..100}; `PutAwayCause` (`retention|not_kept`), `PutAwayWorktree` {id, sessionId, workspaceId, branch, files, cause, putAwayAt} and its list response; `WORKTREE_PORT_RANGE` {first 41000, last 41999}; `TRIAL_AGENTS_MIN = 2`, `MAX = 4`, `CreateTrialRequest` {text 1..20000, agentIds unique 2..4}, `Trial` {id, workspaceId, sessionIds, keptSessionId nullable, createdAt}, `TrialResponse`, `KeepTrialRequest` {sessionId}; EXPERIENCE.md texts (hand-off sentences and dividers, refusals, "This chat's copy was put away to save space.", "Restored.", restore failure, trial line and keep confirmation).
- [x] `packages/shared/src/events-where-work-runs.ts` (new), `events.ts`, `ids.ts`, `errors.ts`, `api.ts`, `index.ts` -- events `session.location_changed` {sessionId, location, previous, branch nullable, files, resumes}, `session.worktree_put_away` {sessionId, snapshotId, cause, files}, `session.worktree_restored` {sessionId, snapshotId}, `session.port_assigned` / `session.port_released` {sessionId, port}, `settings.worktree_retention_changed` {keep, previous}, `workspace.trial_started` {trialId, sessionIds}, `workspace.trial_kept` {trialId, sessionId, putAway: SessionId[]}; codes `handoff_conflict`, `restore_failed`; routes in Design Notes.
- [x] `packages/core/src/entities.ts` -- `setSessionWorktree(id, {worktreePath, branch, files, resumes})`: the only writer after creation; chat kind, no `machineId`, `checkedWorktree`; row and `session.location_changed` in one transaction; no event when unchanged. Doc comments state decision 1.
- [x] `packages/core/src/vcs-port.ts` -- `VcsChatWorktreePort`: `putAway(repoPath, worktreePath, branch)` → {snapshotTree nullable, files} (snapshot in the data directory, then remove keeping the branch), `restore(repoPath, {path, branch, snapshotTree})` → `restored|branch_missing|path_taken`, `moveChanges(repoPath, {from, to})` → {result `moved|conflict`, files}.
- [x] `packages/core/src/where-work-runs.ts` (new), `core.ts`, `index.ts` -- interfaces only: `ChatLocations` (`location`, `handOff`), `WorktreeRetention` (`setting`, `setSetting`, `listPutAway`, `putAway(sessionId, cause)`, `restore`, `enforce`), `WorktreePorts` (`assign`, `release`, `portOf`), `PortProbePort` (`isFree(port)`), `Trials` (`start`, `get`, `keep`); docs naming the never-mid-turn and snapshot rules.
- [x] `packages/adapters/src/vcs-memory/chat-worktree.ts`, `port-probe-memory/index.ts`, `index.ts` -- memory stubs recording calls (conflict and missing branch settable).
- [x] `packages/server/src/where-work-runs-routes.ts` (new), `app.ts` -- every route registered, 501 when its use-case is absent, `no-store` on GETs, body limit.
- [x] `packages/server/src/build-routes.ts` -- reword the `'git failed'` log.
- [x] Tests: shared schema tests (caps, strict events refuse `worktreePath`/`path`/`text`); core `setSessionWorktree` (both directions, refusals, unchanged, one transaction); adapter stubs; server 501s; `gate.test.ts`, `bmad-guard-coverage.test.ts`; architecture check widened with a planted route file.

**Acceptance Criteria:**
- Given every server route file, when the architecture test scans it, then none loads `child_process` or names a git command (a planted one is flagged).
- Given `pnpm typecheck` and `pnpm test`, then both pass with 8.2's and 27.1's tests unchanged.

## Implementation Notes

- Built per the plan: shared `where-work-runs.ts` and `events-where-work-runs.ts` (eight strict events, ids `try` and `wsn`, codes `handoff_conflict` and `restore_failed`, the routes in Design Notes); `entities.setSessionWorktree` (decision 1, row and `session.location_changed` in one transaction, mid-turn refused); `VcsChatWorktreePort`; core interfaces `ChatLocations`, `WorktreeRetention`, `WorktreePorts`, `PortProbePort`, `Trials`; memory stubs `vcs-memory/chat-worktree.ts` and `port-probe-memory`; `where-work-runs-routes.ts` answering 501 until wired; the server-route git check in `tests/architecture.test.ts`; `build-routes.ts`'s `'git failed'` log reworded.
- Review fixes (pass 1): the route-file check covers `*-route(s).ts`, `routes.ts`, `*-socket.ts` and `app.ts` in any server subfolder; the remaining "never changed" comments reworded; these routes answer 404 with core's message.
- Verified (after review fixes): `pnpm typecheck` clean; `pnpm test` 429 files, 5561 passed, 13 skipped (the first run before the fixes had one `bmad-catalog-catalog` timing failure under load, which passed re-run alone); no Playwright spec touched; provenance check passed.

## Plan Change Log

## Review Triage Log

Pass 1 (2026-11-01; lens: quick, fresh subagent given the plan and the diff). Verdicts: high 0, medium 1, low 2, false 0, maybe-false 0. No intent_gap or bad_plan; three patched by the implementer.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | The widened architecture check misses server files that register routes (`local-endpoint-models-route.ts`, `update-notice/routes.ts`, the three `*-socket.ts`) and its planted case passes a nested `y-routes.ts` | medium | patch | regex matched only top-level `*-routes.ts` and `app.ts`; widened to `*-route(s).ts`, `routes.ts`, `*-socket.ts` and `app.ts` in any server subfolder, with those files asserted scanned |
| 2 | `Session.worktreePath`/`branch` docs (shared `entities.ts`), `db/schema.ts` and `chat/workspaces.ts` still say "never changed" | low | patch | reworded to "changed only by Hand off" |
| 3 | A 404 on these routes answers the Files panel's "That isn't there any more" sentence | low | patch | `refusal` now answers `not_found` with the error's own message |

## Deferred (for the sweep)

- None from this story's review. 27.9: nothing to dispose of.

## Design Notes

Routes (under `/api/v1/workspaces/:wsId` unless noted): `GET|POST sessions/:sesId/location` (read; hand off); `POST sessions/:sesId/worktree/restore`; `GET worktrees/put-away`; `GET|PUT /api/v1/settings/worktree-retention`; `POST trials`; `GET trials/:tryId`; `POST trials/:tryId/keep`. Ports have no route: `SessionLocation.port` carries them.

Autonomous calls (2026-11-01): the retention cap is per install (Settings, as EXPERIENCE.md and the user say), counted over all projects' chat worktrees, changeable in 27.6. A hand-off restarts the agent in the new folder and resumes its own session when it can (`resumes` on the event), clearing 27.4's other unknown. With the conflict settled, the hand-off contract is here so 27.4 starts at once.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors
- `pnpm test` -- expected: all pass (timing failures re-run alone)
- `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs` -- expected: pass
