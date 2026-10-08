---
title: 'Spawn the agent''s ACP process over SSH for interactive chat'
type: 'feature'
ticket: '5'
created: '2026-10-07'
status: 'built'
baseline_revision: '2696864608aeb09e0ac507bd6e84eeecc2f15efb'
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

**Problem:** CAP-24 needs a chat's ACP agent process actually runnable on a remote machine over SSH, with `createAcpAgent`, the permission-card machinery and the event log completely unchanged — a remote chat must look identical to a local one in every event the UI sees.

**Approach:** Add an optional `remote?: RemoteHostConnection` field to core's `StartAgentSession` (inherited by `ReopenAgentSession`): an already-open connection (story 19.4's `RemoteHostPort.connect`) the caller hands in when a chat targets a remote machine. In `acp-base/acp-agent.ts`, abstract the one thing `startOnChild` needs from a spawned process into a small `AcpProcess` shape (`stdin`/`stdout`/`stderr` streams, `once('error'|'exit', …)`, `kill()`); `spawnAgent` builds this from a real local `child_process.spawn()` as today, or, when `remote` is given, from `remote.exec()` of one shell command built from the *same* `AcpLaunch` (`command`/`args`) the per-agent quirk already returns — no quirk changes. Env vars (API keys, AD-16) go through SSH's own protocol-level `exec(command, { env })`, never embedded in the command-line text itself, extending `RemoteHostPort.exec` with that option.

## Boundaries & Constraints

**Always:** build the remote command from `launch.command`/`args`/`cwd` only, every value shell-quoted even though none of it is attacker-controlled free text (defense in depth, matching `remote-worktree-sync.ts`'s own posture); keep every env var (secrets included) out of the command-line string, passed only through `exec`'s `env` option; map a channel close (clean or dropped) onto the exact same `'exit'` path `startOnChild` already has for a local crash — never a new state the session/event-log layer has to learn.

**Never:** change `AcpLaunch`, `AcpLaunchInput`, any per-agent quirk (`acp-claude-code`, `acp-codex`, …), the permission-card flow, or the event shapes `AgentEvent` already defines; request a pseudo-tty (ACP's stdio framing is ndjson, not a terminal); wire a machine picker, Settings, or `build-start.ts` into this (story 19.7/19.6's job) — this story only adds the mechanism `StartAgentSession.remote` triggers.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Remote chat, full round trip | `startSession` with `remote` set, against the fake ACP agent over a fake channel | starts, streams `message_chunk`s, shows and resolves a permission card, `close()` ends it — no event differs from the existing local test of the same fake agent | n/a |
| Resume over remote | `reopenSession` with `remote` set | resumes (or loads) exactly as a local reopen does | n/a |
| Channel closes unexpectedly | the fake channel's `exitCode` rejects mid-session (simulating a dropped SSH connection) | one fatal `state: 'error'` event, `AgentError('agent_failed')` on the next `prompt()` -- same shape as a local crash | never a distinct "remote" error shown to the UI |
| Stop / kill | `session.close()` while a remote prompt is running | the channel's own `kill()` runs (signal + close); no local process is touched | n/a |
| Secrets never on the command line | `env` holds an API-key-shaped value | the exact shell command string `exec` is called with never contains that value; it travels only in `exec`'s `env` option | a unit test scans the built command string for the secret, asserting absence |
| Shell-quoting | `cwd`/`command`/args containing a space and a single quote | the remote command still runs the right program with the right arguments (round-tripped through a real local `sh -c`, mirroring story 19.4's fake) | n/a |

</frozen-after-approval>

## Code Map

- `packages/core/src/agent-port.ts` -- add `remote?: RemoteHostConnection | undefined` to `StartAgentSession` (so `ReopenAgentSession` inherits it); import the type from `./remote-host-port.js`.
- `packages/core/src/remote-host-port.ts` -- tighten `RemoteHostChannel.stdin`/`stdout`/`stderr` from `NodeJS.WritableStream`/`NodeJS.ReadableStream` to real `node:stream` `Writable`/`Readable` (both the real `ssh2` channel and the memory fake already hand back genuine Node streams; `Writable.toWeb`/`Readable.toWeb` in `acp-agent.ts` need the concrete class, not the structural interface). Add an `env?` option to `RemoteHostConnection.exec` (SSH's own protocol-level env passthrough, never the command line): `exec(command: string, options?: { env?: Readonly<Record<string, string>> }): Promise<RemoteHostChannel>`.
- `packages/adapters/src/remote-host-ssh/index.ts` -- pass `options?.env` through to `ssh2`'s `conn.exec(command, { env }, callback)` (its own `ExecOptions.env`).
- `packages/adapters/src/remote-host-memory/index.ts` -- merge `options?.env` on top of `baseEnvironment()` for the spawned `sh -c` fake.
- `packages/adapters/src/acp-base/remote-launch.ts` (new) -- `AcpProcess` interface; `remoteProcessOf(channel): AcpProcess` (wraps a `RemoteHostChannel`'s `exitCode` settle/reject into one `'exit'` emission, never `'error'`; `kill` calls `channel.kill()`); `buildRemoteCommand({ cwd, command, args }): string` (one `cd '<cwd>' && exec '<command>' '<args…>'` line, every segment shell-quoted). Kept out of `acp-agent.ts` to respect its own existing "moved out to keep it under budget" convention (`quirks.ts`'s header).
- `packages/adapters/src/acp-base/acp-agent.ts` -- replace the free `killTree(child)` function and its 3 call sites with `child.kill()`; change `spawnAgent`'s return to `Promise<{ child: AcpProcess; secrets: readonly string[] }>` (async now), branching on `launchInput`'s new `remote` field (passed down from `open()`'s `input.remote`) to either the existing local `spawn()` path (wrapped as an `AcpProcess` whose `kill()` is today's `killProcessTree(child.pid)`) or `remote-launch.ts`'s remote path; `startOnChild`'s `child` parameter type becomes `AcpProcess`.
- `packages/adapters/test/remote-host-memory.test.ts` -- a test that `exec`'s `env` option reaches the spawned command.
- `packages/adapters/test/acp-base-remote.test.ts` (new) -- the I/O matrix, against the real `fake-acp-agent.mjs` fixture over `createMemoryRemoteHostPort()` (the same fake adapter story 19.4 built, exercised for real rather than re-faked).

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/remote-host-port.ts` -- tighten stream types, add `exec`'s `env` option -- the two small core-level seams this story needs beyond story 19.4's
- [x] `packages/core/src/agent-port.ts` -- add `StartAgentSession.remote` -- the one new field the whole remote-chat seam hangs off
- [x] `packages/adapters/src/remote-host-ssh/index.ts`, `remote-host-memory/index.ts` -- thread `exec`'s `env` through to the real and fake transports
- [x] `packages/adapters/src/acp-base/remote-launch.ts` -- `AcpProcess`, `remoteProcessOf`, `buildRemoteCommand` -- the story's own deliverable, isolated and independently testable
- [x] `packages/adapters/src/acp-base/acp-agent.ts` -- wire `remote` through `open()`/`spawnAgent`, abstract `killTree`/`startOnChild` onto `AcpProcess` -- the minimal-diff integration into the existing, unchanged event/permission-card machinery
- [x] `packages/adapters/test/acp-base-remote.test.ts` -- the I/O matrix against the real fake-agent fixture
- [x] `packages/adapters/test/remote-host-memory.test.ts` -- `exec`'s `env` option, unit-level

**Acceptance Criteria:**
- Given a `startSession` call with `remote` set to a connection whose `exec` runs the real `fake-acp-agent.mjs` fixture, when the session starts and a message is sent, then the events emitted are indistinguishable in shape from the existing local test of the same fixture (reusing its assertions).
- Given a permission request during a remote session, when the test resolves it through `onPermissionRequest`, then the tool call proceeds exactly as locally.
- Given the fake channel's `exitCode` rejects mid-session, when the next `prompt()` is awaited, then it rejects with `AgentError('agent_failed', …)` and one fatal `state: 'error'` event was already emitted.
- Given `session.close()` on a remote session, when it resolves, then the fake connection recorded a `kill`/close call and no local child process was ever spawned for that session.
- Given an env var shaped like a secret, when the remote spawn path builds its exec command, then that value never appears in the command string passed to `exec` (asserted directly on the string the test's fake connection recorded).

## Implementation Notes

`spawnAgent` takes `remote` as its own parameter (not a field added to `AcpLaunchInput`, per the Boundaries' "Never change ... `AcpLaunchInput`"): `open()` passes `input.remote` straight through, and the per-agent quirk's `launch(launchInput)` call is completely unchanged either way -- the quirk never sees or knows about `remote`.

`AcpProcess.once` is declared with the two overload signatures (`'error'`, `'exit'`) `startOnChild` actually calls; both `localProcessOf` (wraps a real `ChildProcessWithoutNullStreams`) and `remoteProcessOf` (`remote-launch.ts`) implement it as a same-named local function with the standard TS overload-implementation idiom (a wider implementation signature, `any[]`, never exposed to callers) so the object literal satisfies the interface without `as` casts.

The "channel closes unexpectedly" and "stop/kill" tests need a still-open, mid-session channel to drop or count a kill on; `createMemoryRemoteHostPort`'s own `setConnectionLost` is one-shot and only affects the *next* `exec`, so those two tests use a small `createTrackedConnection()` helper local to `acp-base-remote.test.ts` that still runs the real fixture as a real local process (standing in for the remote one, exactly as the memory adapter's own `exec` does) but exposes a `dropLatest()`/`kills` hook the memory adapter doesn't need for anything else.

## Plan Change Log

## Review Triage Log

## Design Notes

`startOnChild`'s only real coupling to `ChildProcessWithoutNullStreams` is three `killTree(child)` call sites (one on an unattended-build mode violation, one on process `'exit'`, one in `close()`'s own grace-period teardown) plus the stream/event surface `Writable.toWeb`/`Readable.toWeb`/`child.once(...)` already use structurally. Collapsing `killTree` into `child.kill()` on a small `AcpProcess` interface is the whole seam: nothing else in `startOnChild`, the ACP connection wiring, or the permission-card/event code needs to know whether `child` is a real local process or a wrapped SSH channel.

Env vars never travel in the remote command's text, only through `ssh2`'s own `ExecOptions.env` (an SSH protocol-level request sent before the command runs) -- this is the literal "never on a command line" AD-16 already requires for a local process's `env`, extended rather than relaxed for the remote case. Known, accepted gap: many `sshd` configs restrict which env names they accept via `AcceptEnv`/`SetEnv` and silently drop the rest, so a real remote machine's default `sshd` could simply never deliver the key and the agent would fail to authenticate -- loudly (`agent_unavailable`/sign-in required), never a leak. This is this story's own flagged `hitl` live-check gap (same posture as story 19.2's keychain-size unknown and story 19.4's Windows-shell assumption), not a design question needing a human call: the alternative (embedding secrets in the command line as a fallback) would be a straight AD-16 violation, so there is no silent-success fallback to add.

Process-tree cleanup is weaker over SSH than locally: `killProcessTree` reaps a whole local process group; the remote side only ever signals the one process `exec` started (`channel.kill()` -> `signal('KILL')` + `close()`). Since the agent's own process replaces the launching shell (`exec` in the remote command, not a sub-shell), there is normally nothing left over, but a tool call the agent itself spawned and left running outside that single process is not guaranteed reaped the way a local process-group kill guarantees it. Documented rather than solved: the same class of gap as above, deferred to this story's live check.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors (all 6 packages) -- ran clean (shared, web, core, adapters, server all "Done")
- `npx vitest run` -- expected: all green, including the new remote-chat round-trip tests -- 384 test files, 4770 passed, 8 pre-existing skips
- `pnpm run build` -- expected: clean -- ran clean, `dist/` assembled
