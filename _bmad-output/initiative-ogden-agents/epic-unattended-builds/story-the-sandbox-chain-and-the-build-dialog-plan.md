---
title: 'The sandbox chain and the Build dialog'
type: 'feature'
ticket: '6'
created: '2026-10-04'
status: 'built'
baseline_revision: 'c26d82359b3d585a8dbdd9c20888bb6df0b95ace'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['security']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-unattended-builds/epic-unattended-builds.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-unattended-builds/story-worktrees-in-the-data-folder-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 5.2's `sandbox-claude-native` only looks for programs (it never checks they work: bubblewrap is blocked by AppArmor on Ubuntu runners), there is no Docker step, no Build dialog (a refused Build is an alert), no attended build (so Windows has no way to build), and a build's sandbox can still write the main repo's `.git/objects` (5.2 S3, re-pointed here by 5.5).

**Approach:** Finish `SandboxPort` as a chain (native sandbox, then Docker) that probes what works and explains itself, add a plain-language sandbox status and the Build dialog (Use another agent, disabled; Install Docker; Build with me watching) opened when Build is refused `sandbox_unavailable`, add the attended build mode (permission cards at `ask_every_time`, no rules, no sandbox), and give each unattended run its own git object store so its sandbox cannot write the repo's objects.

## Boundaries & Constraints

**Always:**
- Fail closed: an unattended run starts only with a sandbox `check` that says available; `mode` defaults to `unattended`; resume re-checks. An attended run is never reached by a sandbox answer, only by the user's explicit `mode: 'attended'`, and its session has no `decide` policy: every tool call is a card.
- Attended: caution level forced to `ask_every_time`, stored rules never auto-allow, no Always allow offered, protected-path writes still always ask; run's `sandbox` is `attended`; same worktree, branch, review and approve as any run; the user cannot change the session's permission mode (build sessions already refuse it).
- Probes only spawn the program's own capability test (`sandbox-exec` trivial profile; `bwrap` unshare test; `docker version`), with a timeout, the caller's env allowlist, no shell; never anything from the project. Landlock is only read (`/sys/kernel/security/lsm`) and shown as detected.
- Nothing is installed or downloaded by Ogden Agents. "Install Docker" is a link the user opens; install hints are text.
- Object store: `<data>/r/<run8>/objects` (real folder, 0700), set up only for sandboxed runs. The agent gets `GIT_OBJECT_DIRECTORY=<store>` and `GIT_ALTERNATE_OBJECT_DIRECTORIES=<repo>/objects`; the repo's `objects` leaves the writable roots; the store is the only object path it can write (and read, via `allowedReads`). `vcs-git` derives the store from an `ogden/<run8>/` branch name and reads with it as an alternate (diff, branch revision, merged); rebase and patch write into it. Approve first imports the branch's new objects (`rev-list --objects <branch> --not <base>`, `pack-objects`, `unpack-objects --strict`, no agent-named path used) and refuses, merging nothing, when that fails. The store is removed with the run's decision (approve, reject, superseded) and by the startup sweep for decided runs. A repo path that contains the alternates delimiter is refused `vcs_unavailable`.
- Tests: fakes only for sandboxes, Docker and agents; real git in temp dirs; capability probes run for real only as unit-level checks that assert a boolean and never start a sandboxed run. Never real agents, the keychain, the network or the real `~/.claude`; hooks only under `testHooksAllowed`. No UI text holds an em or en dash.

**Never:** No silent installs. No running an agent inside Docker (see Design Notes), no Landlock launcher, no network allowlist. No limits storage, enforcement or settings UI (5.8 owns them; frozen contract and defaults already in `build-settings.ts`). No Stop, Retry, dispatcher, review page changes. No push, fetch or force.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| macOS | `sandbox-exec` present and its probe passes | chain `available` `seatbelt`; status has no choices | probe fails: `blocked`, then Docker step |
| Linux, bwrap blocked | `bwrap` and `socat` found, unshare probe fails | unavailable, reason names the block (AppArmor), choices | landlock shown as detected, not usable |
| Linux, bwrap missing | no `bwrap` | unavailable, install hint text | — |
| Windows, no Docker | win32 | unavailable; choices `attended` first; hint: Docker Desktop optional | — |
| Docker ready | `docker version` says Linux server | status shows Docker ready; run still refused (Design Notes) | Install Docker choice disabled with why |
| Docker Windows containers / stopped / missing | probe states | status `blocked` / `unavailable` / `missing` with plain note | — |
| Build refused | POST `sandbox_unavailable` | Build dialog opens, three choices, status in words | other refusals keep the alert |
| Build with me watching | `mode: 'attended'` | run `sandbox: attended`, first command raises a card at `ask_every_time` | stored allow rule still asks |
| Unattended, no sandbox | default mode | 409 `sandbox_unavailable`, nothing written | — |
| Object store | agent commits | repo `objects` unchanged, store holds new objects, diff works | corrupt object: approve refuses, merges nothing |
| Run end | approve, reject, sweep | store removed | failure logged, swept |

</frozen-after-approval>

## Code Map

- `packages/shared/src/build-runs.ts`, `builds.ts`, `api.ts` -- `StartBuildRequest.mode`; `SandboxStatus` (platform, available, kind, summary, probes, choices, install hint); `DOCKER_INSTALL_URL`; plain sentences; route `workspaceBuildSandbox` (`…/build-sandbox`, not under `builds/:ref`).
- `packages/core/src/sandbox-port.ts` -- `status()`, `SandboxProbe`; `build-sessions.ts` -- setup becomes unattended `{sandbox, env, decide}` or attended `{attended: true}`; `chat/agents.ts` (cards for attended, `env` into the agent), `chat/permission-requests.ts`, `permissions.ts` (`request(…, { attended })`).
- `packages/core/src/builds.ts` -- `start` mode, `sandboxFor` (store in, repo objects out, env), resume for attended, approve imports objects, `sandboxStatus`; new `build-object-store.ts` (store path, create, remove, delimiter check); `build-worktrees.ts` cleanup and sweep remove stores; `vcs-port.ts` `importObjects`; `vcs-memory` stub.
- `packages/adapters/src/sandbox-claude-native/index.ts` (probes), new `sandbox-docker/index.ts`, new `sandbox-chain/index.ts`; `sandbox-memory` `status`; `vcs-git/index.ts` (store-aware env, `importObjects`); `index.ts` exports.
- `packages/server/src/start-builds.ts` (chain, store root), `build-routes.ts` (GET status), `test-hooks.ts` (fixed sandbox status); `test/gate.test.ts`, `bmad-guard-coverage.test.ts` lists.
- `packages/web/src/planning/build-dialog.tsx` (new), `builds-api.ts` (`startBuild` mode, `fetchBuildSandbox`), `board-tickets.tsx` (open on `sandbox_unavailable`), `ui/dialog.tsx` (reuse).
- Tests: adapters `sandbox-*.test.ts`, `vcs-git-object-store.test.ts`; core `builds-attended.test.ts`, `builds-object-store.test.ts`; server `build-routes.test.ts`; web `build-dialog.dom.test.tsx`; e2e `tests/e2e/build-sandbox.spec.ts`.
- `_bmad-output/initiative-ogden-agents/deferred-work.md` -- 5.2 S3 resolved, 2.6 file-kind check-then-use closed for sandboxed commands (not the unsandboxed Edit/Write tools, 5.2 S2 stays), new deferrals.

## Tasks & Acceptance

**Execution:**
- [ ] shared -- mode, status shape, sentences, route.
- [ ] adapters -- probing native sandbox, Docker probe, chain, memory status; tests with fake probes plus gated real capability probes.
- [ ] core -- port status, attended mode and cards, object store, approve import, cleanup; tests per matrix row with fakes.
- [ ] `vcs-git` -- store-aware env, `importObjects`; temp-repo tests (repo objects untouched, import, corrupt object refused).
- [ ] server -- chain wiring, status route, hook status; route tests.
- [ ] web -- dialog, board wiring; DOM tests (three choices, Windows order, disabled other agent, link only for Docker).
- [ ] e2e -- unavailable sandbox, dialog, Build with me watching, first command card; deferred-work updates.

**Acceptance Criteria:**
- Given a fake sandbox that never allows writes outside its roots, when a run starts, then the repo's `objects` is not in its writable roots and its env names the store.
- Given windows-like `win32` with no Docker, when `check` runs, then `sandbox_unavailable` and the dialog lists Build with me watching first.
- Given the unattended default and an unavailable sandbox, when any path starts a build, then no run, session setup with `decide`, or worktree exists.

## Implementation Notes

- 2026-10-04 (build): implemented directly from this plan in local milestone commits. Shared: `mode`, `SandboxStatus`, the `…/build-sandbox` route, sentences. Core: attended setup (`BuildSessionSetup` union), `permissions.request(…, { attended })`, `build-object-store.ts`, `builds.ts` (`requireSandbox`, `unattendedSetup`, approve import, `sandboxStatus`), `VcsPort.importObjects`. Adapters: `sandbox-chain`, `sandbox-docker`, probing `sandbox-claude-native`, store-aware `vcs-git`. Web: `build-dialog.tsx`. Tests: adapters, core, server (real git through the fake agent, store, import, fsck), DOM, e2e `build-sandbox.spec.ts`.
- Scope calls: limits (2/3/45) are 5.8's (5.3 froze the split; defaults already in `shared/build-settings.ts`), so none built; Docker and Landlock are detected and shown, never selected (Design Notes); the Install Docker choice is a link, disabled with the reason when Docker already runs.

## Plan Change Log

## Review Triage Log

- 2026-10-04, pass 1 (security, one reviewer). Counts: high 0, medium 2, low 7. Routes: patch 4, defer 4, reject 1. No intent_gap.
  - M1 an agent-planted `info/alternates`, link or FIFO in the run store is followed by host git: patch (`storeIsPlain`: reads go without the store, import refuses). Test added.
  - M2 attended sessions have no managed Claude settings, so the user's own settings can skip a card: defer (deferred-work.md); spec wording holds for every request Claude raises.
  - L3 a path with a line break makes approve refuse: patch (ids matched by pattern).
  - L6 approve with a sandboxed run's store missing: patch (refused with the plain message before merging).
  - L9 dialog offered attended when a sandbox became available: patch (says to build again).
  - L4 compression bomb, L5 unremovable store, L7 weaker bwrap probe, L8 docker lookup and probe cost: defer (deferred-work.md).

## Design Notes

- Entry text wins over the brief: the dialog's choices are Use another agent (disabled until epic 6), Install Docker, Build with me watching; the first non-disabled choice in the port's order is the default, so Windows (attended first) differs from macOS and Linux.
- Docker is detected and described, but a run is never launched inside it in this story: nothing in the spec, architecture or epic says which image carries Claude Code or how the agent would reach its model while its commands have no network (an agent in a no-network container cannot call its API). The chain therefore reports Docker as ready-but-unsupported and stays unavailable; recorded in deferred-work.md. Landlock is the same: Claude Code cannot use it, so it is shown, not selected.
- Limits (2 per project, 3 per install, 45 minutes): the defaults and bounds already exist in `shared/build-settings.ts`; storage, enforcement and settings belong to 5.8 (5.3 froze that split), so none is built here.
- Known cost of the per-run store: from the agent's first commit, the run's branch ref points at objects only the store holds, so a user's own `git log --all` or `git gc` in the repo reports a bad object for `ogden/<run8>/…` until approve imports it or the run is discarded. Recorded in deferred-work.md.

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `pnpm test` -- all pass
- `pnpm e2e` -- all pass
- `pnpm run pack && pnpm smoke` -- pass
