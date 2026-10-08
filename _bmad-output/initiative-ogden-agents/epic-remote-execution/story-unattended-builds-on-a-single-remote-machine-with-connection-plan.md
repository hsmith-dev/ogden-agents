---
title: 'Unattended builds on a single remote machine, with connection_lost handling'
type: 'feature'
ticket: '6'
created: '2026-10-07'
status: 'built'
baseline_revision: '2679a1b7df4b3e4d8ba70ebb15f32413af771aa5'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Stories 19.4 (push/pull) and 19.5 (spawn over SSH) exist but nothing calls them: a build has no `machineId`, nothing pushes a worktree before a remote run or pulls it back after, and a dropped SSH connection has no `BLOCKED_CODE` of its own.

**Approach:** Add `machineId: RemoteMachineId | null` to `Run` (a migration) and `BuildCtx` gets an optional `remote` capability (`{ sync: RemoteWorktreeSync; connect(machineId): Promise<RemoteHostConnection> }`, absent in every existing test harness that doesn't care about CAP-24 — zero ripple). `build-start.ts`'s `begin()` pushes the worktree to the chosen machine right after it creates it and opens one long-lived connection handed to the chat layer as `AttendedBuildSetup.remote` (story 19.5's seam); `build-outcome.ts`'s `decideOutcome` pulls the remote's diff back into the local worktree *before* it reads the ticket's status, for every ended turn except a hard `connection_lost`. Add `connection_lost` as a new `AgentErrorCode` (19.5's `remoteProcessOf` reports it through the exit path's existing `signal` slot, since a real SSH channel never uses one otherwise) and as a new shared `BlockedCode`/`BLOCKED_SENTENCES` entry, wired through `decideOutcome`'s existing `auth_required`/`usage_limit` branch (same shape, one more value) and through a pull-back failure's own catch.

**Scope decision, made here, not guessed past (see Boundaries):** this story wires **attended-only** remote builds end to end (push, run with every tool call a permission card, pull, verify/approve locally, `connection_lost`, retry). An **unattended** remote build is refused with a clear, plain-words reason. Why: `AgentSandbox`'s `writableRoots`/`deniedPaths`/`deniedReads` (`build-context.ts`'s `sandboxFor`) are all *local* filesystem paths (the controller's worktree, data dir, `credentialReadFences` against the controller's own home folder) computed for the agent's own native sandbox at spawn; none of that is meaningful for a process that actually runs on a different machine's filesystem, and computing a real remote equivalent (the remote's OS, its home directory's credential-folder layout, its own writable run directory) is real, unscoped new work that neither AD-24 nor this ticket's text specifies — CAP-24's own non-goals rule out Ogden discovering things about the remote machine, which a faithful remote sandbox computation would need. Building a *fake* remote sandbox (skipping the credential fences because there's no way to compute them) would be a silent security downgrade dressed as a feature. Attended mode has no `AgentSandbox` at all today (`{ attended: true, cwd }` only) and its safety is the user watching every tool call, which works identically over SSH (19.5 already proved this) — so it is the one mode this story can wire with full fidelity and no new guesswork.

## Boundaries & Constraints

**Always:** refuse an unattended build whose `machineId` is set, before anything is written (`validateStart`), with a plain-words reason naming that this isn't supported yet; push before the agent is ever spawned and pull before the outcome's ticket/status read; close the long-lived chat connection and the pull/remove connections independently (never assume one is still open for the other, matching 19.4/19.5's own "each opens and closes its own" posture); treat a pull-back failure (connection dropped between the remote finishing and the diff being read back) exactly like an in-run drop: `blocked`/`connection_lost`, never a guessed `verified` or `failed`.

**Never:** build a remote equivalent of `sandboxFor`/`credentialReadFences` in this story (flagged above, left for a human decision); add a machine-picker UI, a build-dialog change, or a REST field for `machineId` (19.7's job — this story's `machineId` is reached only by calling `startLocked`/`enqueue`/`begin` directly, exactly as 19.4/19.5 were reached only by direct calls); change `AgentSandbox`, `sandboxFor`, or any local-build behavior when `machineId` is `null`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Remote attended build, full round trip | `startLocked(..., mode: 'attended', machineId: <confirmed machine>)` against the fake remote-host + fake ACP agent | worktree created locally, pushed, agent runs over SSH with permission cards, diff pulled back, ticket verified/failed exactly as the equivalent local-run fixture, Approve merges from the controller's own checkout | n/a |
| Unattended + remote | `startLocked(..., mode: 'unattended', machineId: <confirmed machine>)` | refused before any worktree/branch is created, with a plain reason naming unattended remote builds aren't supported yet | `BuildRefusedError`, never a half-created run |
| Connection drops mid-run | the fake channel's `exitCode` rejects while the agent is working | outcome `blocked`, `blockedCode: 'connection_lost'`, never `verified`; one fatal `state:'error'` event with `code: 'connection_lost'` | never retried by itself |
| Connection drops between finish and pull-back | the agent reports idle, then the fake `pull` connection rejects | outcome `blocked`/`connection_lost`, never a guessed `verified`/`failed` | the local worktree is left as it was before the failed pull |
| Retry after a drop | `Retry` on a `blocked`/`connection_lost` run | a fresh remote directory (the same `runId`, wiped and reseeded, never hot-patched) and a fresh connection; the run proceeds exactly as a first attempt | n/a |
| No remote capability wired | `BuildCtx.remote` is `undefined` and `machineId` is given anyway | refused the same way as "unavailable machine" (fail closed), never silently run locally instead | `BuildRefusedError` |

</frozen-after-approval>

## Code Map

- `packages/shared/src/entities.ts` -- add `machineId: RemoteMachineId.nullable().default(null)` to `Run` (after `agent`, following the exact "`null` in runs from before it" precedent already on `branch`/`baseRevision`/`baseBranch`).
- `packages/core/src/db/schema.ts` -- add `machineId: text('machine_id')` to the `runs` table; run `pnpm --filter @ogden-agents/core run db:generate` to create the migration (do not hand-write the SQL).
- `packages/core/src/entities.ts` -- add `machineId?: RemoteMachineId | null` to `NewRun`; `run-entities.ts` persists it the same way `branch`/`baseRevision` are persisted (find and mirror those exact lines).
- `packages/shared/src/build-runs.ts` -- add `'connection_lost'` to `BLOCKED_CODES` and a `BLOCKED_SENTENCES.connection_lost` entry (mirroring `interrupted`'s "Stopped because ... Retry to carry on." shape: something like "The connection to the remote machine was lost. Retry to carry on.").
- `packages/core/src/agent-port.ts` -- add `'connection_lost'` to `AgentErrorCode`'s union (alongside `'agent_unavailable' | 'agent_failed' | 'auth_required' | 'usage_limit'`).
- `packages/adapters/src/acp-base/remote-launch.ts` -- `remoteProcessOf`: when `channel.exitCode` *rejects* (a dropped connection, never a clean exit), `settle(null, 'connection_lost')` -- the existing `signal` parameter's slot, which a real SSH channel never otherwise populates (ssh2 channels don't report POSIX signals the way a local child does). Document this reuse plainly in the doc comment.
- `packages/adapters/src/acp-base/acp-agent.ts` -- `startOnChild`'s `child.once('exit', (code, signal) => {...})`: when `signal === 'connection_lost'`, pass `code: 'connection_lost'` into both the thrown `AgentError`'s `details`/top-level `code` and `reportGone`'s emitted fatal event (give `reportGone` an optional second `code?: AgentErrorCode` parameter, mirroring how `setState`'s already takes one). A local child's real POSIX signals (`'SIGKILL'` etc.) are untouched; only this one sentinel string is special-cased.
- `packages/core/src/remote-worktree-sync.ts` -- export `openRemoteConnection(machineId, { hosts, secrets, machines }): Promise<RemoteHostConnection>` (the connection-opening half of the existing `withConnection`, factored out so `build-start.ts` can open a *long-lived* connection for the chat session the same verified way `push`/`pull`/`remove` already do; `withConnection` itself becomes `openRemoteConnection(...)` + `work` + `close` in a `finally`, no behavior change to any existing caller).
- `packages/core/src/build-context.ts` (or wherever `BuildCtx`'s shape is declared/assembled -- check `builds-types.ts` too) -- add an optional `remote?: { sync: RemoteWorktreeSync; connect(machineId: RemoteMachineId): Promise<RemoteHostConnection> }` field. Every existing test harness that builds a `BuildCtx` without it keeps compiling and behaving exactly as today (absent means "no remote capability," not "broken").
- `packages/core/src/build-sessions.ts` -- add `remote?: RemoteHostConnection` to `AttendedBuildSetup` (never to `UnattendedBuildSetup` -- see the Intent's scope decision).
- `packages/core/src/chat/agents.ts` -- in the `input` object (around its existing `...(build?.attended === true ? { attended: true as const } : {})` line), add `...(build?.attended === true && build.remote !== undefined ? { remote: build.remote } : {})`.
- `packages/core/src/build-start.ts` -- `validateStart`: accept `machineId: RemoteMachineId | null`; refuse (`BuildRefusedError('sandbox_unavailable', <new plain-words message>)`) when `machineId !== null && (mode !== 'attended' || ctx's remote capability is undefined || the machine isn't usable)`, before any write, mirroring the existing `runnerFor(agent) === undefined` fail-fast at the top. `begin`: after the worktree/branch exist and (for an attended remote run) right where today's `{ attended: true, cwd: real }` setup object is built, open the connection (`ctx.remote!.connect(machineId)`), `ctx.remote!.sync.push({ repoPath, branch, runId: run-short-or-whatever-19.4-expects, machineId })`, and use the returned `remotePath` as the setup's `cwd` (never the local `real` worktree path) plus `remote: connection`. Store `machineId` on the created `Run` (`entities.createRun`/`enqueue`'s call). On any failure after the worktree exists (the existing `catch` block), also close the connection and best-effort `remove()` the remote directory if it was pushed.
- `packages/core/src/build-outcome.ts` -- `decideOutcome`: right after `if (run.worktreePath === null) return;`, when `run.machineId !== null`, pull back first: call `ctx.remote!.sync.pull({...})` inside its own `try`; on success continue exactly as today (the local worktree now reflects the remote's final state, so the existing `trust.requireScriptsMatch`/`tickets.find`/verification code runs completely unchanged); on failure, skip straight to `entities.setRunOutcome(run.id, 'blocked', blockedSentence('connection_lost'), { blockedCode: 'connection_lost' })` and return, never falling into the normal verification path. The *in-run* drop path (the agent's own session reported a fatal `connection_lost` error) needs no special-casing here at all: extend the `events.subscribe` handler's `errorCode` check (currently `errorCode === 'auth_required' || errorCode === 'usage_limit'`) to also accept `'connection_lost'`, and extend `options.errorCode`'s type union the same way -- the existing `else if (ended === 'error' && options.errorCode !== undefined) { blockedCode = options.errorCode; ... }` branch then handles it with no other change, since `'connection_lost'` is now a valid `BlockedCode`.
- `packages/core/test/build-*.test.ts`, `packages/adapters/test/*` -- existing build-integration test fixtures/harnesses to extend with a fake `remote` capability (a fake `RemoteWorktreeSync` + a fake `connect`), reusing 19.4/19.5's own fakes (`createMemoryRemoteHostPort`, the core-side inline fakes) rather than inventing new ones.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/shared/src/entities.ts`, `packages/core/src/db/schema.ts` (+ generated migration), `packages/core/src/entities.ts` -- `Run.machineId`
- [ ] `packages/shared/src/build-runs.ts`, `packages/core/src/agent-port.ts` -- `connection_lost` as a `BlockedCode` and an `AgentErrorCode`
- [ ] `packages/adapters/src/acp-base/remote-launch.ts`, `acp-agent.ts` -- surface `connection_lost` through the existing exit/fatal-event path (the `signal` slot reuse)
- [ ] `packages/core/src/remote-worktree-sync.ts` -- `openRemoteConnection`, extracted and reused by `withConnection`
- [ ] `packages/core/src/build-context.ts`/`builds-types.ts`, `build-sessions.ts`, `chat/agents.ts` -- the optional `remote` capability and `AttendedBuildSetup.remote` plumbing
- [ ] `packages/core/src/build-start.ts` -- refuse unattended+remote; push + open connection + record `machineId` in `begin`
- [ ] `packages/core/src/build-outcome.ts` -- pull-before-read-status, `connection_lost` on a failed pull, the `errorCode` branch extension
- [ ] Tests: the full I/O matrix, integration-level, against fakes -- reusing 19.4/19.5's own fake adapters, never a new fake SSH transport

**Acceptance Criteria:**
- Given a confirmed remote machine and an attended build dispatched to it, when the fake agent finishes normally, then the outcome and ticket-verification result are identical to the equivalent local-run fixture's (byte-identical assertions, machine-targeted inputs only).
- Given `mode: 'unattended'` and a `machineId`, when `startLocked` is called, then it rejects with `BuildRefusedError` before any worktree exists.
- Given the fake channel drops mid-turn, when the session reports its fatal error, then the run's outcome is `blocked` with `blockedCode: 'connection_lost'`, never `verified`.
- Given the fake `pull` connection rejects after the agent reports idle, when `decideOutcome` runs, then the outcome is `blocked`/`connection_lost` and the local worktree is untouched.
- Given a `blocked`/`connection_lost` run, when Retry runs it again, then a fresh remote directory is used (asserted via the fake's own recorded pushes) and the run completes normally.

## Implementation Notes

Built as planned, with two things worth recording that the plan's prose didn't spell out:

- The `connection_lost` vocabulary had to reach one layer the Code Map didn't name: `AgentErrorCode` (adapters) needed a matching `SessionErrorCode` entry (`packages/shared/src/events-common.ts`) and `chat/turns.ts`'s `fail()` had to pass it through to `session.state_changed`'s `errorCode` payload (the same shape as the existing `auth_required`/`usage_limit` pair) before `build-outcome.ts`'s `events.subscribe` handler could ever see it. Checked the web UI's own `errorCode` consumers (`sign-in-again.tsx`, `transcript.ts`, `sidebar-model.ts`, `session-page.tsx`): none switches exhaustively on `SessionErrorCode`, so `connection_lost` falls through to the same generic "show the plain reason" rendering `agent_failed`/`agent_unavailable` already get today -- no UI gap, nothing else to wire.
- A `BuildsTestHooks`/`captureStarter` seam was added to `createBuilds` (test-only, an optional second parameter nothing in `packages/server` ever passes) so `builds-harness.ts` could expose `h.start.startLocked` directly -- the only way a test reaches `machineId` per the scope decision (no REST field yet). `packages/core/test/remote-test-fakes.ts` extracts the fakes 19.4's own test already had inline, shared with this story's `build-remote.test.ts` so there is still only one fake-SSH-transport technique in the whole epic.

**Review fix (this session, before marking built): a dropped remote connection's reason text was the generic local-crash sentence.** `startOnChild`'s exit handler mapped `connection_lost` onto the correct `blockedCode`/`AgentErrorCode`, but passed the same `STOPPED` ("X stopped unexpectedly...") reason string `acpReasons()` already uses for an ordinary local crash -- accurate but non-specific, and it was what both a plain remote chat's fatal event and (through `agentReason`) a remote build's own `blocked` reason would have shown. Added `acpReasons().connectionLost` ("Lost the connection to the remote machine running X. Send your message again to restart it.") and used it in place of `STOPPED` for exactly the `signal === 'connection_lost'` branch, nowhere else. Re-verified: `pnpm typecheck`, `npx vitest run` (385 files, 4781 tests, 8 skipped), `pnpm run build` all green after the fix.

Flagged, not guessed past (see the Intent's own scope decision, restated here for the record): this story deliberately ships **attended-only** remote builds. An unattended remote build needs a real, remote-path-aware `AgentSandbox` (writable roots in the remote run directory, denied-read fences against the *remote* user's credential folders) that neither AD-24 nor this ticket specifies how to compute, and that risks crossing into the remote-discovery CAP-24 explicitly rules out as a non-goal. Building a sandbox that skips the credential fences because Ogden can't compute them for an unknown remote machine would be a silent security downgrade dressed as a feature, not an engineering judgment call -- so it was left refused (`sandbox_unavailable`, a clear plain-words reason) rather than guessed at. This is new territory the previous stories' own flags didn't cover and needs a human decision before a future story builds it.

## Plan Change Log

## Review Triage Log

## Design Notes

The `signal === 'connection_lost'` sentinel reuses a parameter slot rather than adding a new one to `AcpProcess.once('exit', ...)`'s signature, because a real SSH channel (unlike a local child) never reports a POSIX signal there at all -- the slot is otherwise always `null` for a remote process, so repurposing it for this one string is a small, contained hack with no local-process ambiguity (a local child's `'SIGKILL'`/`'SIGTERM'` etc. are untouched; only the literal string `'connection_lost'` is special-cased, and nothing produces that string from a local kill).

Pull-before-read-status is the one change to `decideOutcome`'s own control flow (everything else -- `verifyBuilt`, `resultHolds`, the branch structure -- is unchanged): for a local run (`machineId === null`) this whole step is skipped, so nothing about today's behavior moves.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors (all 6 packages)
- `npx vitest run` -- expected: all green, including the new remote-build integration tests
- `pnpm run build` -- expected: clean
