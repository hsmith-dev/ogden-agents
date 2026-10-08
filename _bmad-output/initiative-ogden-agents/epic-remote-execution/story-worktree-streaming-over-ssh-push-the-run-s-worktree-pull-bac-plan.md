---
title: 'Worktree streaming over SSH: push the run''s worktree, pull back the diff'
type: 'feature'
ticket: '4'
created: '2026-10-07'
status: 'built'
baseline_revision: '0920ce069f97527da8caaf98a9a47192dd41f11d'
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

**Problem:** CAP-24 needs AD-24's one-shot push/pull step built: a run's local worktree streamed to a fresh remote directory over SSH before the run starts, and the remote's resulting commits read back afterward, both binary-safe and over the same SSH transport used to spawn the agent (story 19.5, not yet built) — never a second transport or an origin-remote credential.

**Approach:** Extend `RemoteHostPort` (core) with `connect`/`RemoteHostConnection`/`RemoteHostChannel`: an authenticated SSH session whose `exec` runs one remote shell command with streamed stdin/stdout/stderr and an exit-code promise. Extend `VcsPort` with `bundleRef` (a full-history `git bundle` of a ref, for the push payload) and `importBundle` (fetch a bundle's branch into the repo fast-forward-only, then reset the worktree to match, for the pull). Add a new core module `remote-worktree-sync.ts`: `push` clones a fresh remote directory from the bundle via a validated, single-quoted shell script; `pull` asks the remote for an incremental bundle (`base..branch`) and imports it locally; `remove` deletes the remote directory. Every remote command is built from a fixed template with `runId` (`RunId` schema) and `branch` (`isBuildBranch`) validated before interpolation, never free text.

## Boundaries & Constraints

**Always:** validate `runId` and `branch` against their existing schemas before building any remote command string; namespace the remote directory under one fixed base path (`.ogden-agents/remote-runs/<runId>`) so two runs on the same machine never collide; `verifyPinnedHostKey` before connecting; close the SSH connection on every path (success, refusal, exec failure); never pass or need an origin-remote credential.

**Never:** wire this into `build-start.ts` or the `Run` entity (story 19.6's job); invent a second transport (SFTP, rsync) alongside the SSH exec channel; reuse a previous run's remote directory on retry; let the remote's shell interpret anything but the fixed template plus the two validated identifiers.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Push a binary file | worktree has a non-UTF8 binary blob committed at `base` | remote clone's blob is byte-identical | n/a |
| Two runs, one machine | `push` called twice with different `runId`s, same machine | two distinct remote directories, no collision | n/a |
| Pull with new commits | remote branch has commits past `base` | local branch fast-forwards, local worktree files reset to match, returns `'imported'` | n/a |
| Pull with nothing new | remote branch still at `base` | local state unchanged, returns `'nothing'` | n/a |
| Remove on terminal outcome | `remove` called with a pushed `remotePath` | remote directory gone; a second `remove` is a no-op | n/a |
| Retry | `push` called again for the same `runId` after a prior `remove` | fresh remote directory, never hot-patched | n/a |
| Connection drops mid-exec | fake channel closes before the remote command exits | rejects `RemoteHostError('connection_lost', …)`; no partial state assumed imported | surfaced to caller, never silently `imported` |
| Unconfirmed/changed host key | machine not yet confirmed, or fingerprint changed | refused before any connection (`RemoteHostError`), same as `verifyPinnedHostKey` today | no exec attempted |

</frozen-after-approval>

## Code Map

- `packages/core/src/remote-host-port.ts` -- add `RemoteHostCredential`, `RemoteHostChannel` (`stdin`/`stdout`/`stderr` streams, `exitCode: Promise<number>`, `kill()`), `RemoteHostConnection` (`exec(command): Promise<RemoteHostChannel>`, `close(): Promise<void>`), and `RemoteHostPort.connect(target, credential, options?)`. Reuse `RemoteHostError` for `host_unreachable`/`host_timeout`/`auth_failed`/`connection_lost`.
- `packages/adapters/src/remote-host-ssh/index.ts` -- implement `connect` over `ssh2`'s `Client` (`authHandler`/`privateKey`), `exec` over `conn.exec`, mapping its callback/stream events onto `RemoteHostChannel`.
- `packages/adapters/src/remote-host-memory/index.ts` -- extend `MemoryRemoteHostPort` with a fake `connect`/`exec` that spawns the exact command string through a real local `sh -c` (never a real SSH/network hop) against a temp directory standing in for "the remote machine," so the generated git commands are exercised for real; add `setConnectionLost(host, port)` to simulate a mid-exec drop.
- `packages/core/src/vcs-port.ts` -- add `bundleRef(repoPath, ref): Promise<Buffer>` and `importBundle(repoPath, worktreePath, branch, base, bundle): Promise<'imported' | 'nothing' | 'refused'>`.
- `packages/adapters/src/vcs-git/index.ts` -- implement both via the existing `runBinary` binary-stdio pattern (`git bundle create - <ref>`; `git fetch <tmpfile> <branch>:<branch>` then `git -C worktreePath reset --hard <branch>`), reusing `checkBranch`/`checkRevision`.
- `packages/core/src/remote-worktree-sync.ts` (new) -- `createRemoteWorktreeSync({ vcs, hosts, secrets, machines, now })`: `push`, `pull`, `remove`; shell-quotes every interpolated value even after validation (defense in depth).
- `packages/core/src/remote-machines.ts` -- no change; `remoteMachineSshSecretName` and `verifyPinnedHostKey` are reused as-is.
- `packages/core/test/remote-worktree-sync.test.ts` (new) -- the I/O matrix above, against a real local git repo (via `vcs-git`) and the extended memory fake.
- `packages/adapters/test/remote-host-memory.test.ts`, `packages/adapters/test/vcs-git.test.ts` -- extend for the new methods.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/core/src/remote-host-port.ts` -- add the connection/channel types and `connect` -- gives core a transport-agnostic exec primitive story 19.5 will reuse for the agent's own stdio
- [ ] `packages/adapters/src/remote-host-ssh/index.ts` -- real `connect`/`exec` over `ssh2` -- the only place an actual SSH authentication happens
- [ ] `packages/adapters/src/remote-host-memory/index.ts` -- fake `connect`/`exec` over a local `sh -c` against a temp dir -- lets tests prove the generated remote commands actually work, with no real network
- [ ] `packages/core/src/vcs-port.ts` + `packages/adapters/src/vcs-git/index.ts` -- `bundleRef`/`importBundle` -- the local-only, binary-safe halves of the sync
- [ ] `packages/core/src/remote-worktree-sync.ts` -- `push`/`pull`/`remove`, with `RunId`/`isBuildBranch` validation before any string is interpolated into a remote command -- the story's own deliverable
- [ ] `packages/core/test/remote-worktree-sync.test.ts` -- the I/O matrix, run against a real temp git repo
- [ ] `packages/adapters/test/vcs-git.test.ts`, `packages/adapters/test/remote-host-memory.test.ts` -- unit coverage of the new adapter methods in isolation

**Acceptance Criteria:**
- Given a worktree with a committed binary file at `base`, when `push` then `pull` run against the fake remote with no agent changes, then the local worktree's file bytes are unchanged and `pull` returns `'nothing'`.
- Given the fake remote commits a new file after `push`, when `pull` runs, then the local branch fast-forwards to that commit and the worktree's files include the new one, and `pull` returns `'imported'`.
- Given two `push` calls with different `runId`s to the same machine, when both run, then their remote directories never collide (asserted via the fake's recorded paths).
- Given a `runId` or `branch` that fails its schema/validity check, when `push` is called, then it throws before any command is built or any connection opened.

## Implementation Notes

Built as planned: `RemoteHostPort.connect`/`RemoteHostConnection`/`RemoteHostChannel` in core; a real `ssh2`-backed `connect`/`exec` in `remote-host-ssh`; a fake `connect`/`exec` in `remote-host-memory` that spawns the exact command string through a real local `sh -c` against a temp folder (plus `homeDirFor`/`setHomeDir`/`setConnectionLost`); `VcsPort.bundleRef`/`importBundle`, implemented in `vcs-git` over the real `git` binary; the new `remote-worktree-sync.ts` with `push`/`pull`/`remove`.

Two things the plan's prose didn't spell out, found while making the round trip actually work against real `git`:

- `git fetch <bundle> <branch>:<branch>` refuses with "refusing to fetch into branch … checked out at …" when that branch is the one checked out in the run's own worktree — which it always is, by design, for `pull`. `importBundle` instead fetches into a scratch ref (`refs/ogden-agents/bundle-import`), checks the new tip is a fast-forward of the old one itself (`merge-base --is-ancestor`), then moves `refs/heads/<branch>` with `update-ref <ref> <new> <old>` (a compare-and-swap, refused if the branch moved underneath), and only then resets the worktree; if that last reset fails, the ref is moved back so nothing is left half-applied. `bundleRef` has no such obstacle (reading a ref is never refused).
- `git -C <dir> fetch <path> …` resolves `<path>` as if the shell had already `cd`'d into `<dir>` (that's what `-C` does for the whole invocation, not just which repo is opened), so `push`'s script stages the piped-in bundle to `` `mktemp`'s `` own always-absolute path rather than a path relative to the run's own directory, which would otherwise resolve one level too deep once `-C` was applied.

`RemoteWorktreeSyncOptions`'s `vcs`/`hosts`/`machines` fields are narrowed to exactly the methods this module calls (`Pick<VcsPort, 'bundleRef' | 'importBundle'>`, a 1-method `connect` shape, `Pick<RemoteMachines, 'get' | 'verifyPinnedHostKey'>`) rather than the full port interfaces: smaller surface to depend on, and it keeps `packages/core/test/remote-worktree-sync.test.ts` free of any dependency on `@ogden-agents/adapters` (core depends on no adapter, even in a test — `remote-machines.test.ts`'s own existing convention, which hand-rolls its memory fakes rather than importing the real ones). That test's two small fakes (`realVcs()` over the real `git` binary; a `connect`/`exec` fake over a real local `sh -c`) are kept local to the file for the same reason; the adapter-level round trips (binary safety, fast-forward-only, a non-fast-forward or malformed bundle refused) are covered on their own in `packages/adapters/test/vcs-git.test.ts` and `packages/adapters/test/remote-host-memory.test.ts`.

Updated the pre-existing `VcsPort` fakes that predate this story to the new interface: `packages/core/test/builds-harness.ts` (never exercises either method; stubs only) and `packages/adapters/src/vcs-memory/index.ts` (a JSON-encoded `{commit, changes}` round trip through its own branch map, since that fake has no real file content to bundle) — plus `packages/adapters/test/build-stubs.test.ts`'s own exhaustiveness check, which now exercises both. `remote-host-memory`'s new `spawn` call needed an explicit allowlisted `env` (`baseEnvironment()` from `child-env.ts`) to satisfy the existing AD-16 architecture test.

Known gap, same posture as story 19.2's own: `remote-host-ssh`'s real `connect`/`exec` authentication path is not exercised by an automated test (it needs a real `sshd`); only `checkHostKey`'s unreachable path and the pure-local `generateKeypair` are. This is this entry's own flagged `hitl` live-check gap, not a behavior difference from the plan.

**Review fix (this session, before marking built): `connect` was not re-checking the host key on its own connection.** The first implementation pass gave `RemoteHostPort.connect` no way to verify the live host key at all -- `remote-host-ssh`'s real adapter opened its authenticated connection with no `hostVerifier`, trusting that `RemoteMachines.verifyPinnedHostKey`'s own short-lived probe, moments earlier, was good enough. It isn't: that probe and the real work connection are two separate TCP connections, so an on-path attacker could let the probe through untouched and intercept only the second one, defeating exactly the impersonation AD-26 names as the thing host-key pinning catches ("a later connection whose host key changed is refused outright, never silently re-prompted" -- this was a connection whose host key changed, going unchecked). Fixed by adding a required `expectedFingerprint` parameter to `connect`: `remote-worktree-sync.ts` passes the machine's own pinned `hostKeyFingerprint`, `remote-host-ssh` re-verifies it via `hostVerifier` on the real connection (rejecting `host_key_changed` on any mismatch, mirroring `checkHostKey`'s own `sha256` hash), and `remote-host-memory`'s fake does the same against its fingerprint map so the gap is actually test-covered now (`packages/adapters/test/remote-host-memory.test.ts`'s "rejects connect with host_key_changed ... even right after a matching checkHostKey" test, and `packages/core/test/remote-worktree-sync.test.ts`'s "refuses with host_key_changed when the real connection sees a different key ... never trusting that probe alone" test, which simulates the attack directly). All pre-existing `connect` call sites and fakes were updated for the new required parameter. Re-verified: `pnpm typecheck`, `npx vitest run` (383 files / 4763 tests, 8 skipped), `pnpm run build` all green after the fix.

## Plan Change Log

## Review Triage Log

## Design Notes

`push` always ships a full-history bundle of the run's branch (which, at push time, has no commits past `base` yet — the worktree was just created): a remote clone has no prior shared objects with the real repo, so a `base..branch` incremental bundle (empty at push time anyway) wouldn't let `git clone`/`fetch` reconstruct anything. `pull` is the cheap, incremental half: the remote's commits are built with the exact same parent SHA (`base`), so `git bundle create - <base>..<branch>` on the remote, fetched with a non-forced `branch:branch` refspec locally, only ever succeeds as a fast-forward — exactly the invariant AD-24 wants (never resuming or rewriting a prior remote state).

Each of `push`/`pull`/`remove` opens and closes its own SSH connection rather than holding one open across the whole run. AD-24's "not a second transport" is about not inventing SFTP/rsync alongside the exec channel, not about literal socket reuse; story 19.5/19.6 may later share one open connection across spawn+push+pull as a perf/robustness refinement, but nothing here forecloses that.

Remote shell portability: every remote command assumes a POSIX shell (`sh -lc`) and that `git` is already on the remote's `PATH` (needed for the agent CLI to work there regardless). A remote whose default SSH shell isn't POSIX (a bare Windows box without Git-for-Windows' bash, or a non-`sh`-compatible login shell) is out of scope for this story's automated tests and is this entry's own flagged `hitl` live-check gap, same posture as story 19.2's untested Windows keychain fallback.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors (all 6 packages)
- `npx vitest run` -- expected: all green, including the new round-trip tests
- `pnpm run build` -- expected: clean (packaging/dependency checks)
