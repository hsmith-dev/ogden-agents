---
title: 'Tracer bullet: one ticket built, reviewed and approved from a bare page'
type: 'feature'
ticket: '2'
created: '2026-10-04'
status: 'built'
baseline_revision: '870b61bd603b512b3feb9628e46d337bb59707c8'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'security']
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-unattended-builds/epic-unattended-builds.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nothing in Ogden Agents can build a ticket unattended: there is no Build action, no worktree, no build session, no review and no approve, so epic 5's riskiest path (worktree in the data folder, a headless Claude Code ACP session running `bmad-build-auto`, a local merge) has never run end to end.

**Approach:** One thin path through every layer: a bare **Build** on a board card (builds piece on, project trusted) → core's guarded `builds` use-case → a minimal `vcs-git` worktree under `<data>/w/<id>` on branch `ogden/<ref>-<slug>` → a minimal Claude Code native-sandbox check → a minimal `buildrunner-acp` that starts a `build` session in the worktree and sends `bmad-build-auto` for that one ticket → its activity in the read-only session view → outcome from the plan status → a bare review page with the diff, **Approve** (local merge with the `done` mark in the merge commit) or **Reject** (discard).

## Boundaries & Constraints

**Always:**
- Every builds use-case calls `requireBmadFeature(ws,'builds')`, then the script trust, `source.requireReady`, and `requireScriptsUnchanged` (board's guard order); every route goes through `bmadPieceRoutes('builds', …)`; `builds` is appended to `SHIPPED_BMAD_PIECES`.
- The worktree lives only under Ogden's data folder (`<data>/w/<8-char id>`), never in the repo; branch from the main checkout's current branch (`HEAD` must be a branch with a commit). Every Ogden git call: argument arrays (no shell), `-c core.longpaths=true`, `-c core.hooksPath=<empty Ogden folder>` (no repo or agent-written hook ever runs), `--no-ext-diff --no-textconv` on diffs; refs validated before use.
- Before any `tickets.py` run against the worktree, the worktree's `_bmad/scripts/` fingerprint must equal the trusted one (the agent may have edited them); at approve, `requireScriptsUnchanged` runs again after the merge and before `mark`, and a change aborts the merge.
- Approve: refused with `checkout_dirty` when the main checkout has uncommitted changes outside `_bmad-output/`; `git merge --no-ff --no-commit <branch>`; a conflict → `git merge --abort`, main checkout unchanged, run `blocked` (`merge_conflict`); then `TicketStorePort.mark(repo, ref, 'done')`, `git add` the plan file, one merge commit; never push, never force; then remove the worktree (branch kept). Approve is the only path to `done`.
- The agent runs with core's allowlisted environment (AD-16) and is a direct child of the server.
- Tests never run real claude, the keychain or the network, and never read the real `~/.claude`; the fake ACP agent plays the build; any sandbox override is a test hook honoured only when `testHooksAllowed`.

**Never:** No bmad-loop, tmux or psmux. No queue, concurrency limits, Stop, max run time, Retry, restart recovery, test re-run, Build dialog or Docker (5.4–5.9). No push, PR or remote call. No unsandboxed unattended run: on Windows (or no sandbox) Build is refused with `sandbox_unavailable`. Core names no skill (AD-12).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | builds on, trusted, ready ticket, clean HEAD | worktree under data folder, `build` session streams, plan `built` + non-empty diff → outcome `verified`, review offers Approve | — |
| Piece off | builds off | 409 `feature_off`, nothing written | route helper |
| Not trusted / scripts changed | trust missing or stale | 409 `scripts_not_trusted` / `scripts_changed` | route helper / core |
| Unmet prerequisite | an `after` ticket not done/in review | 409 `prerequisite_unmet`, no worktree | — |
| Already building | active run for ref | 409 `run_active` | — |
| No sandbox | Windows, or no `sandbox-exec` / `bwrap`+`socat` | 409 `sandbox_unavailable` | — |
| Run ends not built | plan `blocked` or other | outcome `blocked`/`failed`, no Approve | reason shown |
| Dirty checkout | change outside `_bmad-output` | 409 `checkout_dirty`, nothing merged | — |
| Merge conflict | branch conflicts | merge aborted, run `blocked` `merge_conflict` | main unchanged |
| Reject | verified run | worktree removed, branch kept, run `stopped`, ticket untouched | — |

## Decisions

- 2026-10-04, user (Q1 = A, security): **the build session's permission policy is deny-by-default, enforced by core.** Core answers each `request_permission` of a `build` session by rule, with no card: `allow_once` for a file edit or write whose every path, normalized (absolute, `..` resolved, symlinks resolved through the deepest existing ancestor, compared case-insensitively where the filesystem is, Windows 8.3 short names expanded or refused), is inside the run's worktree and outside the protected paths (the shared 2.8 list, which includes `_bmad/`), or inside the git paths a commit in that worktree needs (the main `.git`'s `objects`, `refs`, `logs`, `worktrees/<id>`, never `hooks` or `config`); `reject_once` for everything else (paths outside, a path that can't be resolved, unsandboxed commands, web fetch, MCP, anything unknown). Bash runs in Claude Code's sandbox (`sandbox.enabled`, `autoAllowBashIfSandboxed`, `allowUnsandboxedCommands: false`) with the same writable roots and **no network**; a failure for want of network (such as `npm install`) is named plainly in the run's result. A network allowlist is a later story (deferred-work entry).
- 2026-10-04, user (security, fail closed): where the native sandbox isn't available (Windows; macOS without `sandbox-exec`; Linux without `bwrap` and `socat`), an unattended build is refused with `sandbox_unavailable` and a clear reason; it never runs unsandboxed.
- 2026-10-04, user (Q2 = A): Build is refused with a clear message (`plan_uncommitted`) when the ticket's `tickets.toml` or plan file has uncommitted changes in the main checkout; other uncommitted changes don't block dispatch. **Commit plan files** stays 5.5's.
- 2026-10-04, user (Q3): keep the plan whole (about 2,600 tokens; the tracer crosses every layer by design).

</frozen-after-approval>

## Code Map

- `packages/core/src/planning.ts` -- the planning-session pattern to copy: guard, `chat.createChatSession(ws, kind)`, `chat.sendMessage(ws, id, agent.skillInvocation(...))`; `workspaceRepoPath`.
- `packages/core/src/board.ts` -- guard order (`guarded`) and per-repo `serialized` marks to reuse for approve's `mark`.
- `packages/core/src/chat/agents.ts` `agentFor` -- sets `cwd: workspace.realPath`; a `build` session must use its run's `worktreePath`, the build sandbox settings, and the build permission policy instead of cards.
- `packages/core/src/agent-port.ts` `StartAgentSession` -- add an optional `sandbox` (writable roots) field; `ProtectedPaths` pattern.
- `packages/adapters/src/acp-claude-code/claude-code-agent.ts` -- `_meta.claudeCode.options.settings` (line ~352, flag settings, fixed per session): merge sandbox settings with the guard settings; `skillInvocation`.
- `packages/core/src/entities.ts` `createRun`/`getRun`/`setRunOutcome`; `packages/core/src/db/schema.ts` runs table (`worktree_path`, `sandbox`); add nullable `branch`, `base_revision` (+ migration `0010_*`), and a lookup of a run by session and of the active run by ticket.
- `packages/core/src/bmad-script-trust.ts`, `BmadCatalogPort.scriptsFingerprint` -- fingerprint the worktree's `_bmad/scripts/`.
- `packages/core/src/ticket-store-port.ts` -- `find`/`mark` against the worktree path (status) and the main checkout (approve's `done`).
- `packages/server/src/bmad-pieces.ts` -- `SHIPPED_BMAD_PIECES`, `bmadPieceRoutes`; `packages/server/src/planning-routes.ts` as route pattern; `packages/server/src/test-hooks.ts` for the sandbox test hook.
- `packages/adapters/src/process-tree.ts` -- not changed (session close already kills the tree).
- `packages/web/src/planning/ticket-card.tsx`, `ticket-sheet.tsx` -- Build button; `packages/web/src/routes/session-page.tsx` -- no Composer for `kind === 'build'`, header with ref and outcome and a link to review; `packages/web/src/router.tsx` -- `/w/:wsId/review/:ref`.
- `tests/fixtures/fake-acp-agent.mjs`, `tests/fixtures/fake-bmad-repo.ts`, `tests/e2e/plan-and-board.spec.ts` -- fake agent and fixture repo to extend.
- Spike 5.1 (`origin/spike/5.1-build-driver`): `core.longpaths=true` and short layout on Windows; ubuntu runners have no working bwrap (AppArmor userns), so CI uses the sandbox test hook.

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/builds.ts` (+ `api.ts`, `index.ts`, `errors.ts`) -- `StartBuildRequest {ref}`, `BuildResponse`, `ReviewResponse {run, outcome, reason, diff, files}`, error codes and sentences (`prerequisite_unmet`, `not_ready`, `run_active`, `sandbox_unavailable`, `checkout_dirty`, `merge_conflict`, `checks_failed`, `plan_uncommitted`), route paths -- minimal shapes 5.3 will freeze.
- [x] `packages/core/src/vcs-port.ts`, `sandbox-port.ts`, `build-runner-port.ts` -- minimal ports (`addWorktree`, `status`, `diff`, `merge`/`abort`/`commit`, `removeWorktree`; `sandbox.check()`→kind or unavailable + writable roots; `runner.invocation(ref)`).
- [x] `packages/adapters/src/vcs-git/` -- git through `execFile` with the Always flags; `packages/adapters/src/sandbox-claude-native/` -- macOS `sandbox-exec`, Linux `bwrap`+`socat`, else unavailable; `packages/adapters/src/buildrunner-acp/` -- `/bmad-build-auto ticket <ref>` (the only place naming the skill).
- [x] `packages/core/src/builds.ts` -- `start`, `review`, `approve`, `reject`, and the turn-end hook that reads plan status in the worktree (after the fingerprint check) and sets the outcome; registered in `core.ts`.
- [x] `packages/core/src/chat/agents.ts`, `agent-port.ts`, `claude-code-agent.ts` -- build sessions: worktree cwd, sandbox settings, and the Decisions' permission policy; the policy engine in `packages/core/src/build-permission-policy.ts` (pure, path normalization injected for tests: symlinks, `..`, case-insensitive FS, 8.3 names) with its own unit tests.
- [x] `packages/core/src/db/schema.ts`, migration, `entities.ts` -- run `branch`, `base_revision`, lookups.
- [x] `packages/server/src/build-routes.ts`, `bmad-pieces.ts`, `start*.ts`, `test-hooks.ts` -- routes via `bmadPieceRoutes('builds')`, wiring, `OGDEN_AGENTS_TEST_SANDBOX` hook.
- [x] `packages/web/src/planning/ticket-card.tsx`, `routes/session-page.tsx`, `routes/workspace-review-page.tsx`, `router.tsx`, `planning/builds-api.ts` -- Build, read-only build session, bare review page.
- [x] Tests: core `builds.test.ts` (matrix rows), adapter tests for `vcs-git` against temp repos (hooks never run, merge conflict leaves checkout unchanged, `_bmad-output` exception), fake agent build mode, `gate.test.ts` route registry, architecture/guard-coverage, installed suite's Coming soon check, e2e `build-tracer.spec.ts` (Build → session → review → Approve → Done; `feature_off` with builds off).

- [x] Review loop 1 hardening -- every item in Design Notes "Hardening (review loop 1)", each with a test (policy unit tests for dangling symlink and hard link; vcs-git tests for in-progress merge, staged change, ignored file, reviewed revision; builds tests for protected-path diff, other ticket's plan, rebuild after Reject, failure cleanup, start-time settle; adapter test that the build session's options carry `managedSettings`, `settingSources` and `strictMcpConfig`).

**Acceptance Criteria:**
- Given a fixture repo with a ready ticket, builds on and trusted, when Build is clicked, then a worktree appears under the data folder (none in the repo), the build session streams in the read-only session view, the run ends `verified`, and Approve leaves one merge commit on the checked-out branch containing the change and the plan `done`, and the board shows Done.
- Given builds off, when `POST …/builds` is called, then 409 `feature_off` and no worktree, branch or session exists.
- Given an agent-written `.husky`/hook file in the run's branch, when Approve runs, then no hook executes.

## Implementation Notes

- 2026-10-04 (build): the whole path runs end to end against the fake ACP agent's new build mode (`/bmad-build-auto ticket <ref>` in `tests/fixtures/fake-acp-agent.mjs`), real `git` on a fixture repo, and a ticket store that reads and writes the plan files (`tests/fixtures/plan-file-ticket-store.ts`): `packages/server/test/build-routes.test.ts` and `tests/e2e/build-tracer.spec.ts`.
- Shapes added beyond the plan's list, all minimal and for 5.3 to freeze: the run also stores a plain `reason` (column `reason`, migration `0010_run_branch` with `branch` and `base_revision`; `run.outcome_changed` carries it), because a blocked run's reason and `merge_conflict` must survive a reload; a ninth refusal code `vcs_unavailable` (the checkout isn't a branch with a commit); `TicketDetail.plan` (the plan's repo-relative path, `null` without one) so `plan_uncommitted` checks exactly the plan and the `tickets.toml` files above it, and approve stages exactly the plan; `TicketStorePort.mark(…, 'done', { approve: true })` is the only way a store writes `done`; `Chat.releaseAgent` stops a run's agent before its worktree goes; `GET …/sessions/:sesId/run` (`SessionRunResponse`) for the read-only session header.
- The build permission policy (`packages/core/src/build-permission-policy.ts`) is wired through an in-memory `BuildSessions` registry on `Core` (`core.buildSessions`): the builds use-case registers the run's worktree, sandbox and policy; `chat/agents.ts` reads it for a `build` session and never starts one without it (no restart recovery in the tracer). Only the `edit` tool kind can be allowed; `~` paths and Windows segments that may be 8.3 names are refused rather than expanded.
- Claude Code's flag settings for a build session (`claudeSandboxSettings`): `sandbox.enabled`, `failIfUnavailable`, `autoAllowBashIfSandboxed`, `allowUnsandboxedCommands: false`, `network.allowedDomains: []` with `strictAllowlist`, `filesystem.allowWrite` (worktree, `.git/objects|refs|logs|worktrees/<id>`) and `denyWrite` (`.git/hooks`, `.git/config`, the protected names at the worktree root); plus `permissions.deny` for WebFetch/WebSearch and `disableAllHooks: true` (no Claude Code hook runs unsandboxed in an unattended run).
- `vcs-git` also passes `-c core.fsmonitor=false`, refuses to run if its empty hooks folder is not empty, and commits with a fallback identity (`Ogden Agents <ogden-agents@localhost>`) only where git has none.
- The chat routes refuse a message, a permission mode or a driver change for a `build` session (409 `session_busy`, "read-only"): a Skip-all build session would bypass the policy.
- The turn-end hook follows `session.state_changed` to `idle`/`error`, but not a `resumable` one (an agent stopped under the run by a server stop): those runs stay `running` until 5.x's restart recovery.
- Not done here (other stories): "a failure for want of network is named plainly in the run's result" needs the per-run JSON result (5.4); the tracer's run has only its outcome and reason. The hitl live check (a scratch repo with real Claude Code, Seatbelt or bubblewrap) is still to do: record there whether `bmad-build-auto` accepts the `ogden/<ref>-<slug>` branch and how a `plan_checkpoint` stop shows over ACP.
- 2026-10-04 (review loop 1 hardening, built): every Hardening item is in place, each with a test. Notes on how:
  - Claude Code options come from `claudeSessionOptions` (`managedSettings`, `settingSources: ['project']`, `strictMcpConfig: true`; the Auto guards stay as flag `settings`). `disableAllHooks` is dropped in favour of `allowManagedHooksOnly`. `AgentSandbox` gained `deniedReads` and `allowedReads`; the home folder's credential folders come from the server (`homeDir`).
  - Raw paths: `AgentPermissionRequest.rawPaths` (unmasked, never shown or stored). Policy hard links go through an optional `PathNormalizer.linkCount`.
  - `VcsPort` gained `topLevel`, `branchRevision`, `operationInProgress`, `staged` and `restore`. `worktreeGitPaths(worktree, branch)` returns and creates the run's `branchRefDir` and `branchLogDir`. `merge(repo, revision)` answers `merged | conflict | refused` and never touches a merge it didn't start. `--no-overwrite-ignore` does not stop a three-way merge from overwriting an ignored file (git 2.54), so `vcs-git` also refuses (`refused`) when the merge would add a file that is already on disk untracked.
  - A refused merge answers 409 `checkout_dirty` (`MERGE_REFUSED_MESSAGE`) with the run left `verified`. Staged changes, a changed plan file or an operation in progress answer `checkout_dirty` (`CHECKOUT_BUSY_MESSAGE`). Uncommitted BMad scripts in the new worktree answer `plan_uncommitted` (`BMAD_FILES_UNCOMMITTED_MESSAGE`).
  - `ReviewResponse.headRevision` and `ApproveBuildRequest { revision }` (the web sends what the page showed).
  - The per-repo serialization is `repo-serialization.ts` `serializedByRepo`, used by the board's marks and by builds' start, approve and reject.
  - Core's chat throws `BuildSessionReadOnlyError` for a build session's user message, mode, driver and cancel. The builds use-case sends its prompt with `sendMessage(…, { build: true })`.
  - `Entities.settleInterruptedRuns` runs at server start; the reason is `interrupted`.
  - A diff touching protected paths, any `tickets.toml`, or a `-plan.md` under `_bmad-output/` other than the ticket's own fails the run.

## Plan Change Log

- 2026-10-04, review loop 1 (security lens S1, S3, S4, S5, S6, S8, S10, S11, S12; quick lens Q1, Q2, Q7). Triggering findings: the policy allowed a write through a dangling symlink; the agent could write the main repo's whole `refs/`, `logs/` and `objects/info` (moving the user's branches); user, project and local Claude Code settings (allow rules, hooks, MCP, sandbox widening) bypassed core's policy; Approve merged whatever the branch pointed to at that moment, could abort the user's own merge, overwrite ignored files and sweep staged changes into the merge commit; the branch could carry protected files or other tickets' plan marks made with git plumbing; a rebuild failed on the fixed branch name. Amended (outside the frozen block): Design Notes "Hardening (review loop 1)" and the Execution task "Review loop 1 hardening". Known-bad states avoided: an escape through a symlink or hard link; changed refs in the user's repo; a policy that user or project settings override; merging unreviewed commits; losing the user's merge or ignored files; `done` reached for another ticket without approve; a ticket that can't be rebuilt or stays `running` forever. KEEP: the whole current implementation (ports, adapters, routes, web, tests, migration, the fake agent's build mode, `core.hooksPath` override and its hook test). Code is amended in place, not reverted: every defect is local to a named function and the rest was reviewed sound. This is a deliberate deviation from the full-revert loopback, recorded here.

## Review Triage Log

- 2026-10-04, pass 1 (lenses quick, security): high 6, medium 15, low 4, false 0, maybe-false 0. Routed: bad_plan (amended in place, see Plan Change Log) for the design-level group; patch for the rest; defer 2.
  - S1 dangling symlink passes the policy -- high, bad_plan: `nodePathNormalizer.realpath` treats `ENOENT` of a link as "not yet there"; lstat refusal added to the plan.
  - S2 race between decision and write; hard links -- medium: hard links patch (nlink > 1 refused); the swap race is inherent to deciding before an unsandboxed write: defer.
  - S3 whole `refs`/`logs`/`objects` writable -- high, bad_plan: `builds.ts` `sandboxFor` lists `<common>/refs`, `logs`; per-run ref folders in the plan. Deleting `objects` stays possible (data loss, not an escape): defer.
  - S4 Approve merges the branch as it is then -- high, bad_plan: `vcs-git` `merge` takes `refs/heads/<branch>`; reviewed revision in the plan.
  - S5 protected files via git plumbing -- high, bad_plan: nothing checks the branch's content; protected-path diff check in the plan.
  - S6 other tickets' plans marked in the branch -- medium, bad_plan: same root as S5's missing content check.
  - S7 ignored files overwritten -- medium, patch: `--no-overwrite-ignore`.
  - S8 Approve aborts the user's merge; staged changes -- high, bad_plan: `merge` aborts on any `MERGE_HEAD`.
  - S9 catch path leaves a mid-merge checkout with `done` -- medium, patch: restore the plan from `HEAD`, then abort.
  - S10 user/project settings override the policy -- high, bad_plan: claude-agent-acp defaults `settingSources` to user, project, local; `managedSettings` lockdown in the plan.
  - S11 sandbox protects names only at the root; no `denyRead` -- medium, bad_plan: `denyWrite` built from root names; pre-created folders and `denyRead` in the plan.
  - S12 sandbox probe checks presence only -- medium, patch: `failIfUnavailable` (a real key in the SDK typings) makes Claude Code refuse; look up `bwrap`/`socat` on the agent's PATH.
  - S13 / Q3 core doesn't refuse a build session's mode, messages, cancel -- medium, patch.
  - S14 / Q4 `runOfSession` guards -- low, patch.
  - S15 `_bmad/` not committed means every run fails -- medium, patch: refuse at dispatch with a plain reason.
  - S16 / Q1 rebuild fails on the fixed branch -- medium, bad_plan (per-run branch).
  - S17 policy decides on masked paths -- low, patch.
  - Q2 run stuck `running` after a late failure -- medium, patch.
  - Q5 approve's own serialization -- medium, patch: one shared helper.
  - Q6 merge commit sweeps staged `_bmad-output` -- medium, merged into S8.
  - Q7 any merge refusal labelled conflict -- medium, merged into S8.
  - Q8 workspace not the repo's top level -- medium, patch: refuse at dispatch.
  - Q9 epic-slug prerequisites -- low, patch.
  - Q10 sandbox reason dropped -- low, patch.
  - Q11 agent-written reason stored unmasked -- medium, patch.
  - Q12 = S11.
  - Implementer's notes: network failure not named -- medium, patch (plain line); a `running` run after a restart -- medium, patch (settle at start).

## Design Notes

- Outcome `verified` in the tracer means plan `built` and a non-empty diff only; 5.8 adds the test re-run before release (5.11), so AD-17 holds at release.
- `builds` is made available here (not in 5.3) because the hitl live check needs it on; 5.3 still freezes the contracts.
- Hooks are disabled because the agent controls the branch content (e.g. `.husky/`, `core.hooksPath` set by a repo) and approve runs git unsandboxed in the main checkout.
- Record live: whether `bmad-build-auto` accepts `ogden/<ref>-<slug>`, and how a `plan_checkpoint` stop shows over ACP (for 5.4).

### Hardening (review loop 1)

- **Claude Code settings lockdown:** build sessions pass `managedSettings` (policy tier, passed through by claude-agent-acp 0.84) with `allowManagedPermissionRulesOnly`, `allowManagedHooksOnly`, `allowManagedMcpServersOnly`, `permissions.deny` (`WebFetch`, `WebSearch`, `mcp__*`), and the sandbox: `enabled`, `failIfUnavailable`, `autoAllowBashIfSandboxed`, `allowUnsandboxedCommands: false`, `network: { allowedDomains: [], allowManagedDomainsOnly, strictAllowlist }`, filesystem `allowWrite`/`denyWrite`, and `denyRead` of Ogden's data folder (re-allowing the run's worktree) and the usual credential folders (`~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config/gh`, `~/.netrc`, `~/.docker`). Also `settingSources: ['project']` (CLAUDE.md and the repo's skills still load; user and local settings don't) and `strictMcpConfig: true`. Excluded commands then still go through core's policy, which denies them.
- **Git paths:** run branch `ogden/<run8>/<ref>-<slug>` (unique per run, so Reject or a failed run never blocks a rebuild); writable git paths are only `objects` (minus `objects/info`), `refs/heads/ogden/<run8>`, `logs/refs/heads/ogden/<run8>` and `worktrees/<id>`. Empty protected folders (`.claude`, `.vscode`, `.idea`, and `_bmad` when absent) are created in a new worktree so bubblewrap's read-only binds exist.
- **Policy engine:** a missing path component that `lstat` finds (a dangling symlink) is refused; an existing target with more than one hard link is refused; decisions use the raw paths (masking is for display only).
- **Dispatch:** the workspace must be the repo's top level (`rev-parse --show-toplevel`), else `vcs_unavailable` with a plain reason; right after the worktree is made, its `_bmad/scripts/` fingerprint must match the trust, else the worktree is removed and Build is refused with a plain reason (BMad files not committed); any failure after the worktree exists removes it and ends the run (`failed`), so no run stays `running`; the sandbox's own reason reaches the user; prerequisite links that name an epic are met when that epic is done (the board's rule).
- **Run end:** the agent is released (process tree stopped) when the outcome is decided; the outcome is `failed` with a plain reason when the diff touches a protected path (any segment in the 2.8 list, or `_bmad/`), any `tickets.toml`, or a plan file other than this ticket's; the stored reason is masked (AGENTS.md); a run that isn't verified says builds have no network access when relevant ("Builds have no network, so installs such as npm install fail.").
- **Approve:** the review returns the branch's head revision and Approve must send it back; Approve merges that revision only when the branch still points at it (else 409 `checks_failed` "The build changed after you reviewed it."). Refused (`checkout_dirty`, run unchanged) when the index has any staged change, when the plan file itself has changes, or when a merge, rebase, cherry-pick or revert is in progress; never aborts a merge Ogden didn't start. `git merge --no-ff --no-commit --no-overwrite-ignore`; only a real conflict (unmerged paths) blocks the run as `merge_conflict`; any other refusal leaves the run `verified`. On a failure after `mark`, the plan file is restored from `HEAD` before the merge is aborted. Approve's `mark` uses the same per-repo serialization as the board's marks (one shared helper).
- **Build sessions in core:** `chat` refuses user messages, permission-mode and driver changes and cancel for a `build` session in core (not only in routes); `runOfSession` uses the full guard order. At server start a `running` run is set `blocked` with reason "interrupted" (its worktree kept).

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `pnpm test` -- all pass
- `pnpm e2e` -- all pass, including `build-tracer.spec.ts`
- `pnpm run pack && pnpm smoke` -- pass

**Manual checks (hitl, developer's machine):**
- In a scratch repo (never this repo) with Planning, Board and Unattended builds on and trusted: Build on one ready ticket → worktree under the data folder, Claude Code's work streams, ends built; Approve → merge commit locally, board shows Done; note the branch acceptance and checkpoint behaviour.
