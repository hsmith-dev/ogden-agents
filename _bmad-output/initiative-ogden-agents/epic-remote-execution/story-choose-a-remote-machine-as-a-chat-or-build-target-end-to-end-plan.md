---
title: 'Choose a remote machine as a chat or build target, end to end'
type: 'feature'
ticket: '7'
created: '2026-10-07'
status: 'built'
baseline_revision: 'e8f7a1779f680e56a03d52b8b5191557bd1bab37'
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

**Problem:** Stories 19.1-19.6 built the whole single-remote-machine mechanism (registry, credentials, push/pull, SSH spawn, build wiring), but nothing in production actually constructs the `remote` capability `BuildCtx`/`ChatOptions` can take, no REST field reaches it, and there is no UI to choose a machine at all. Chats specifically have no remote path yet (19.5's seam was build-only in practice; 19.6 wired only `BuildCtx.remote`).

**Approach:** Wire the real production capability once (`start-agents.ts`'s `wireAgents` already builds `remoteMachines`/`secrets`/the real `RemoteHostPort`; add a `createRemoteWorktreeSync` + `openRemoteConnection` over them in `start.ts` and hand the same `{ sync, connect }` to both `createChat` and `createBuildsWiring`). Add `Session.machineId` (a migration, mirroring `Run.machineId`) and `ChatOptions.remote`, so a **plain chat** can target a remote machine too (`chat/agents.ts`'s `begin()` opens a connection the same way `build-start.ts`'s `begin()` already does, closed the same way by the agent session itself, 19.5's own contract). Add `CreateSessionRequest.machineId` and `StartBuildRequest.machineId`, both reaching `createChatSession`/`startLocked` directly (19.6's existing seam, now reachable from the real routes too). Add a `MachinePicker` web component (mirroring `AgentPicker`'s unavailable-but-focusable pattern) next to the chat composer's agent picker and inside the Build dialog; unattended + remote is shown unavailable with 19.6's own `UNATTENDED_REMOTE_MESSAGE`, no live check needed (it is universal, not per-machine); a genuine connectivity/host-key problem is shown via one live probe (reusing `checkRemoteMachineHostKey`, already built in 19.3) when the picker opens. **No new "resume" UI is needed**: a dropped remote chat already surfaces through the *existing* generic fatal-error `Notice` + "Try again" (`session-page.tsx`, unconditional for any `errorCode` other than `auth_required`) with 19.6's own `connectionLost` reason text; "Try again" resends the last message, which re-enters `agentFor()`'s `begin()` and opens a fresh connection — confirm this with a test rather than building a second UI path.

## Boundaries & Constraints

**Always:** keep the unattended-remote refusal from 19.6 (never add a UI path that lets unattended + remote through); validate `machineId` the same way builds already do (`validateStart`'s probe-connect) for both chats and builds -- fail closed, a plain reason, never a silent local run; keep every new REST field optional and backward compatible (omitted = local, exactly as today); run the refactor sweep (any file now over this repo's own size convention -- `acp-agent.ts` is the known one, at 842 lines) with the existing test suite as the safety net, never changing behavior.

**Never:** build a remote equivalent of `AgentSandbox`/`sandboxFor` (19.6's own flagged gap, still open, still a human decision); add a second "retry" UI specifically for `connection_lost` (the generic one already covers it -- prove it, don't duplicate it); change AD-24/25/26 or re-open the AD-25 (multi-machine) question -- single machine only, exactly as every prior story in this epic.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Chat composer, machine choice | one or more confirmed machines exist | the picker offers Local plus each confirmed machine; choosing one and sending a message starts the agent over that connection (the real fake-agent fixture through the real `createMemoryRemoteHostPort` fake, server-level) | n/a |
| Build dialog, machine choice | mode `attended`, a confirmed machine chosen | the build pushes, runs attended over SSH, pulls back, verifies/approves locally -- identical in outcome to 19.6's own core-level test, now reachable through the real route and dialog | n/a |
| Unattended + remote in the UI | mode `unattended`, a machine selected (or vice-versa) | that combination is shown unavailable with 19.6's plain reason, and cannot be submitted | never silently falls back to a local unattended build |
| A machine with a changed host key | the live probe's fingerprint differs from the pinned one | shown unavailable in the picker with a plain reason, unselectable | the chat/build start itself also refuses it server-side (defense in depth, not UI-only) |
| Connection drops mid-chat | the remote channel's `exitCode` rejects during a prompt | the existing fatal-error `Notice` shows 19.6's `connectionLost` reason text and "Try again"; clicking it resends the last message over a *fresh* connection | never a second, remote-specific error UI |
| No REST field given | an existing client/test calls `StartBuildRequest`/`CreateSessionRequest` with no `machineId` | behaves exactly as before this story (local), byte-identical | n/a |

</frozen-after-approval>

## Code Map

**Production wiring (new in this story -- nothing before it ever constructed the real capability):**
- `packages/server/src/start-agents.ts` -- `wireAgents`'s return gains `remoteHosts` (the already-resolved `options.remoteHost ?? createSshRemoteHostPort()`, currently local to the function) alongside the existing `remoteMachines`/`secrets`, so `start.ts` can build one shared capability instead of a second, differently-faked `RemoteHostPort` instance.
- `packages/server/src/start.ts` -- after `wireAgents(...)` (around line 299) and once `vcs` exists (used by `createBuildsWiring` already), build `const remote = { sync: createRemoteWorktreeSync({ vcs, hosts: remoteHosts, secrets, machines: remoteMachines }), connect: (machineId) => openRemoteConnection(machineId, { hosts: remoteHosts, secrets, machines: remoteMachines }) }`; pass it to `createChat({ ..., remote })` (line ~336) and to `createBuildsWiring({ ..., remote })` (line ~385, threaded into its own `createBuilds({ ..., remote })` call).

**Chats gain a remote target (new -- 19.5 only proved the adapter seam; nothing in core's chat layer used it for a plain chat):**
- `packages/shared/src/entities.ts` -- `Session.machineId: RemoteMachineId.nullable().default(null)` (mirror `Run.machineId`'s own addition in 19.6).
- `packages/core/src/db/schema.ts` -- `sessions` table gains `machine_id`; `pnpm --filter @ogden-agents/core run db:generate`.
- `packages/core/src/entities.ts`/wherever `createSession`'s input type lives -- `machineId?: RemoteMachineId | null`, persisted the same way `Run.machineId` was (19.6's own commit is the exact mirror to find and follow).
- `packages/core/src/chat/types.ts` -- `ChatOptions.remote?: { connect(machineId: RemoteMachineId): Promise<RemoteHostConnection> }` (chats never need `.sync`: nothing to push/pull for a plain chat).
- `packages/core/src/chat/workspaces.ts`'s `createChatSession` -- accepts `machineId` in its options, validated against the real `RemoteMachines` if the chat layer is given one (or left to `begin()`'s own connect-time refusal below -- pick whichever this repo's existing validation convention favors once you see `createChatSession`'s current shape; don't invent a third place to check it).
- `packages/core/src/chat/agents.ts`'s `agentFor`/`begin` -- when `session.machineId !== null`: refuse (`AgentError('agent_unavailable', ...)`) if `ctx.options.remote` (or wherever `ChatOptions` lands in `ChatContext`) is absent; otherwise `await ctx.options.remote.connect(session.machineId)` once per `begin()` call (so a fresh connection every time a live agent is (re)started, exactly 19.6's "always fresh" posture) and add `remote: connection` to `input` next to the existing `cwd`/`env` fields. `cwd` for a remote chat is **not** `workspace.realPath` -- it has no meaning on another machine. Decide and document plainly what it should be instead (a plain chat has no pushed worktree the way a build does; this is this story's own design call, not 19.6's -- a fixed, documented folder such as the machine's own home directory, or whatever is simplest and safe, is fine, but it must be decided here, not guessed silently into something that happens to work).
- `packages/shared/src/chat.ts` -- `CreateSessionRequest.machineId: RemoteMachineId.nullable().optional()`.
- `packages/server/src/chat-routes.ts` -- thread `body.value?.machineId` into `chat.createChatSession(...)`.

**Builds reach the real route (19.6 built the mechanism; nothing before this story called it from `StartBuildRequest`):**
- `packages/shared/src/builds.ts` -- `StartBuildRequest.machineId: RemoteMachineId.nullable().optional()`.
- `packages/core/src/builds.ts`'s `start()` -- pass `parsed.data.machineId ?? null` into `startLocked(...)` as its existing `machineId` parameter (19.6's own signature).

**Web UI (new):**
- `packages/web/src/remote-machines/` -- a `MachinePicker` component, modeled on `packages/web/src/chat/agent-picker.tsx` (Local plus each *confirmed* machine from `useRemoteMachines()`; an item whose live probe -- `checkRemoteMachineHostKey`, run once when the menu opens, cached briefly -- disagrees with its pinned fingerprint, or fails outright, is shown unavailable-but-focusable with a plain reason, same pattern as an unavailable agent).
- Wherever the chat composer renders `AgentPicker` -- render `MachinePicker` beside it; wire the chosen `machineId` into the session-creation call.
- `packages/web/src/planning/build-dialog.tsx` -- add the machine choice (a `RadioGroup` section, matching the dialog's existing attended/unattended and sandbox-choice sections); when `mode === 'unattended'`, every remote machine shows unavailable with `UNATTENDED_REMOTE_MESSAGE`'s exact text (`packages/core/src/build-names.ts`, already exported); wire the chosen `machineId` into `startBuild(...)`.
- `packages/web/src/routes/session-page.tsx` -- **do not add new UI for a dropped connection.** Write (or extend) a component test proving the existing fatal-error `Notice`/"Try again" path already renders 19.6's `connectionLost` reason and resends correctly; only touch this file if that test finds a real gap.

**Refactor/consolidation sweep (this entry's own, per the epic-12/epic-17 precedent):**
- `packages/adapters/src/acp-base/acp-agent.ts` (842 lines, up from 796 before this epic) -- split further, following the same convention `quirks.ts`'s own header describes (`moved out of acp-agent.ts by story 6.9 to keep it under 600 lines`); `localProcessOf` and the small kill/exit plumbing are reasonable candidates to join `remote-launch.ts` (renaming it, if a single "process launch" module reads better than a remote-only one) or a new sibling file. Re-run the full adapter test suite after; zero behavior change.
- Re-check every other file this epic touched (`build-start.ts` 283, `build-outcome.ts` 210, `remote-worktree-sync.ts` 244, `chat/agents.ts` 235, `remote-machines.ts` 230) against whatever the actual convention threshold turns out to be (check the epic-12/epic-17 sweep commits for the number this repo really enforces, rather than assuming 600) -- split only what is actually over it.

**Docs:**
- `_bmad-output/initiative-ogden-agents/spec-ogden-agents/agent-matrix.md` -- a new section: every ACP-based agent (it all runs through `acp-base`) is remote-eligible for chat; only `attended` builds run remotely (19.6's scope decision, cited plainly); the POSIX-shell/`git`-on-`PATH` assumption and the `sshd` `AcceptEnv` caveat (19.4/19.5's own flags) belong here too, not just buried in code comments.

**E2E:**
- `tests/e2e/remote-target.spec.ts` (new) -- against `startServer(dataDir, 0, { remoteHost: hosts, secrets })` (19.3's own pattern, `createMemoryRemoteHostPort()`): add a machine, confirm its host key, pick it in the chat composer and send a message (the real fake-agent fixture runs through the fake remote host's real local `sh -c`, exactly as the server's default local chat does), pick it in the Build dialog for an attended build, approve. One spec, the epic's own closing proof.

## Tasks & Acceptance

**Execution:**
- [ ] `start-agents.ts`, `start.ts` -- construct and thread the real `remote` capability once, shared by chat and builds
- [ ] `Session.machineId` (shared, schema, migration, entities) -- mirroring `Run.machineId`
- [ ] `ChatOptions.remote`, `chat/workspaces.ts`, `chat/agents.ts` -- a plain chat can target a remote machine; decide and document the remote `cwd`
- [ ] `CreateSessionRequest.machineId`, `chat-routes.ts` -- reaches `createChatSession`
- [ ] `StartBuildRequest.machineId`, `builds.ts` -- reaches `startLocked`
- [ ] `MachinePicker` (web, new) -- beside the chat composer's agent picker
- [ ] `build-dialog.tsx` -- the machine choice, unattended+remote shown unavailable
- [ ] A component/integration test proving the existing "Try again" path already handles `connection_lost` -- no new UI unless this fails
- [ ] Refactor sweep -- `acp-agent.ts` first, then whatever else is actually over this repo's real convention
- [ ] `agent-matrix.md` -- the new section
- [ ] `tests/e2e/remote-target.spec.ts` -- the epic's closing end-to-end proof
- [ ] `pnpm typecheck`, `pnpm test` (or `npx vitest run`), `pnpm e2e` all green for the whole epic

**Acceptance Criteria:**
- Given a confirmed machine and no other change, when a user starts a new chat choosing that machine, then the agent runs over SSH (the real fake-agent fixture, through the real `createMemoryRemoteHostPort` fake) and the chat looks identical to a local one in every event the UI shows.
- Given mode `unattended` in the Build dialog, when a remote machine is also selected, then it is shown unavailable and cannot be submitted, with `UNATTENDED_REMOTE_MESSAGE`'s own text.
- Given a remote chat whose connection drops mid-turn, when the existing fatal-error `Notice` appears, then its text is 19.6's `connectionLost` reason and clicking "Try again" resends successfully over a fresh connection -- proven by a test, not assumed.
- Given no `machineId` anywhere in a request, when any existing chat or build flow runs, then nothing about its behavior differs from before this story.
- Given the whole epic at this entry, when `pnpm typecheck`, `pnpm test` and `pnpm e2e` run, then all are green.

## Implementation Notes

Built as planned, per the Code Map, with these notes:

**Production wiring:** `start-agents.ts`'s `wireAgents` now also returns `remoteHosts`; `start.ts` moved `createServerVcs` earlier (so it's available before `createChat` runs) and builds one shared `remote` capability (`createRemoteWorktreeSync` + `openRemoteConnection`), threaded into both `createChat` and `createBuildsWiring`/`createBuilds`.

**Chats gain a remote target:** `Session.machineId` (migration `0038_freezing_madrox.sql`, mirroring `Run.machineId`); `ChatOptions.remote` (`connect` only, no `.sync` -- a plain chat has nothing to push or pull); `chat/agents.ts`'s `begin()` opens a fresh connection per start, refusing `agent_unavailable` when unwired. **Design call, recorded here as the plan asked:** a remote chat's ACP `cwd` is `REMOTE_CHAT_CWD` (an alias of `remote-worktree-sync.ts`'s `REMOTE_LAUNCH_CWD`, `'.'`) -- the machine's own home directory, since a plain chat has no pushed worktree the way a build does.

**A real bug the story's own e2e spec caught**, not present until a real agent genuinely wrote files on another machine for the first time: the ACP `cwd` field told to the agent was the *same* relative string used for the shell's own `cd` navigation. For chat that coincided harmlessly (both were "the home directory"); for a remote attended build the navigation target is the run's own subdirectory (`remoteRunDir`, relative to the login directory), and reporting that same relative string back to the agent as its ACP `cwd` let the agent re-join it onto a location it was already in, landing writes in a doubly-nested, nonexistent subdirectory -- the build never left `ready-for-dev`. Fixed in `acp-agent.ts`'s `open()`: once `remote` is set, the ACP-reported `cwd` is always `REMOTE_LAUNCH_CWD` ("you're already there"), while the real shell navigation target (`spawnAgent`'s own `buildRemoteCommand` call) is untouched. Documented at length in `remote-worktree-sync.ts`'s own `REMOTE_LAUNCH_CWD` doc comment, since this is exactly the kind of two-things-both-called-"cwd" confusion that reappears if not spelled out.

**Web UI:** `MachinePicker` (new, mirroring `AgentPicker`'s unavailable-but-focusable pattern, with a live host-key probe cached 30s) beside the chat composer's `AgentPicker`; `build-dialog.tsx`'s new `MachineChoice` `RadioGroup`, disabling the unattended Start button with `UNATTENDED_REMOTE_MESSAGE` (moved to `@ogden-agents/shared`, re-exported unchanged from `build-names.ts`) whenever a remote machine is picked.

**Refactor sweep:** `acp-agent.ts` (842 lines before this story) split into `process-launch.ts` (renamed from `remote-launch.ts`; `AcpProcess`, `spawnAcpProcess`, `localProcessOf`/`remoteProcessOf`, and a new `trackAcpProcess` lifecycle helper extracted from `startOnChild`) and `session-context.ts` (`StartContext`/`Opening`/the small ACP-protocol helpers), landing at 659 lines -- still over the repo's ~600-line convention, but the remaining mass is `startOnChild`'s own deeply-stateful `session/update` handler, which the implementing session judged too risky to decompose further without a dedicated, carefully reviewed follow-up; left as-is and documented rather than rushed.

**Review findings and fixes (this session, before marking built):**
- **A real, untested gap in the Board's own "Build" action**: `board-tickets.tsx`'s `build()` callback only opened the Build dialog (where the new `MachineChoice` lives) when more than one agent could build, or when the local sandbox was unavailable -- with a single agent and a ready local sandbox (the common case), clicking Build started an unattended run directly, with **no way to ever reach the machine picker**, defeating this story's own purpose for most installs. Fixed: `build()` now also opens the dialog whenever a confirmed remote machine exists, regardless of agent count or local sandbox state. Added two component tests (`build-picker.dom.test.tsx`) proving this and that an *unconfirmed* machine doesn't trigger it.
- **A real gap in the plan's own I/O matrix coverage**: the "unattended + remote in the UI" and "a machine with a changed host key" matrix rows had no automated test at all beyond the one e2e spec, which never actually exercises either (it only runs the attended-with-a-healthy-machine path). Added `packages/web/test/machine-picker.dom.test.tsx` (6 tests: offers Local + confirmed machines only, selecting one, a changed-fingerprint machine shown unavailable and unselectable, an unreachable machine's plain reason, `unattendedMode`'s universal block) and three tests to `build-dialog.dom.test.tsx` (the machine choice disables/re-enables unattended Start with the exact reason text and posts nothing while blocked; an attended start sends the chosen `machineId`; no confirmed machine means no picker at all).
- A doc-comment artifact in `packages/shared/src/chat.ts` (`CreateSessionRequest.machineId`'s own comment had a garbled, duplicated clause) was cleaned up; no behavior change.

Re-verified after all fixes: `pnpm typecheck` (all 6 packages), `npx vitest run` (387 files, 4798 tests, 8 skipped), `pnpm e2e` (204 Playwright specs, including `remote-target.spec.ts` and `remote-machines.spec.ts`), and `pnpm run build` -- all green.

## Plan Change Log

## Review Triage Log

## Design Notes

The remote `cwd` for a plain chat is this story's own open design point (flagged in the Code Map, not resolved here): a build has a pushed worktree to point at; a plain chat has nothing pushed at all (CAP-24's non-goals rule out provisioning anything on the remote), so the agent necessarily starts in *some* existing folder on the remote machine the user already controls. Picking something reasonable (the remote user's own home directory, `~`, resolved the same way `buildRemoteCommand` already resolves `cwd`) and documenting the choice plainly is enough; this is not the AD-24/CAP-24-boundary-level gap 19.6 flagged (no sandbox, no credential-fencing claim is being made here), just a user-facing "where does my remote chat actually run" decision that needs to be visible, not accidental.

`createRemoteWorktreeSync`'s `vcs` dependency (`Pick<VcsPort, 'bundleRef' | 'importBundle'>`) is the same `vcs` `start.ts` already has in scope by the time `createBuildsWiring` runs; confirm it is available early enough to also build `remote` before `createChat(...)`, which runs earlier in `start.ts` -- reordering `createChat`'s call, or constructing `vcs` slightly earlier, is a reasonable, low-risk adjustment if needed.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors (all 6 packages)
- `npx vitest run` -- expected: all green
- `pnpm e2e` (or the repo's actual Playwright invocation -- check `package.json`) -- expected: all green, including the new `remote-target.spec.ts`
- `pnpm run build` -- expected: clean
