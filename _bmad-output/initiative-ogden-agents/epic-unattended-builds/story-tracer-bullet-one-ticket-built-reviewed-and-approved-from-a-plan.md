---
title: 'Tracer bullet: one ticket built, reviewed and approved from a bare page'
type: 'feature'
ticket: '2'
created: '2026-10-04'
status: 'in-progress'
baseline_revision: '7cb4f4721571886f48384a496b36e8fffc780f1f'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
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
- [ ] `packages/shared/src/builds.ts` (+ `api.ts`, `index.ts`, `errors.ts`) -- `StartBuildRequest {ref}`, `BuildResponse`, `ReviewResponse {run, outcome, reason, diff, files}`, error codes and sentences (`prerequisite_unmet`, `not_ready`, `run_active`, `sandbox_unavailable`, `checkout_dirty`, `merge_conflict`, `checks_failed`, `plan_uncommitted`), route paths -- minimal shapes 5.3 will freeze.
- [ ] `packages/core/src/vcs-port.ts`, `sandbox-port.ts`, `build-runner-port.ts` -- minimal ports (`addWorktree`, `status`, `diff`, `merge`/`abort`/`commit`, `removeWorktree`; `sandbox.check()`→kind or unavailable + writable roots; `runner.invocation(ref)`).
- [ ] `packages/adapters/src/vcs-git/` -- git through `execFile` with the Always flags; `packages/adapters/src/sandbox-claude-native/` -- macOS `sandbox-exec`, Linux `bwrap`+`socat`, else unavailable; `packages/adapters/src/buildrunner-acp/` -- `/bmad-build-auto ticket <ref>` (the only place naming the skill).
- [ ] `packages/core/src/builds.ts` -- `start`, `review`, `approve`, `reject`, and the turn-end hook that reads plan status in the worktree (after the fingerprint check) and sets the outcome; registered in `core.ts`.
- [ ] `packages/core/src/chat/agents.ts`, `agent-port.ts`, `claude-code-agent.ts` -- build sessions: worktree cwd, sandbox settings, and the Decisions' permission policy; the policy engine in `packages/core/src/build-permission-policy.ts` (pure, path normalization injected for tests: symlinks, `..`, case-insensitive FS, 8.3 names) with its own unit tests.
- [ ] `packages/core/src/db/schema.ts`, migration, `entities.ts` -- run `branch`, `base_revision`, lookups.
- [ ] `packages/server/src/build-routes.ts`, `bmad-pieces.ts`, `start*.ts`, `test-hooks.ts` -- routes via `bmadPieceRoutes('builds')`, wiring, `OGDEN_AGENTS_TEST_SANDBOX` hook.
- [ ] `packages/web/src/planning/ticket-card.tsx`, `routes/session-page.tsx`, `routes/workspace-review-page.tsx`, `router.tsx`, `planning/builds-api.ts` -- Build, read-only build session, bare review page.
- [ ] Tests: core `builds.test.ts` (matrix rows), adapter tests for `vcs-git` against temp repos (hooks never run, merge conflict leaves checkout unchanged, `_bmad-output` exception), fake agent build mode, `gate.test.ts` route registry, architecture/guard-coverage, installed suite's Coming soon check, e2e `build-tracer.spec.ts` (Build → session → review → Approve → Done; `feature_off` with builds off).

**Acceptance Criteria:**
- Given a fixture repo with a ready ticket, builds on and trusted, when Build is clicked, then a worktree appears under the data folder (none in the repo), the build session streams in the read-only session view, the run ends `verified`, and Approve leaves one merge commit on the checked-out branch containing the change and the plan `done`, and the board shows Done.
- Given builds off, when `POST …/builds` is called, then 409 `feature_off` and no worktree, branch or session exists.
- Given an agent-written `.husky`/hook file in the run's branch, when Approve runs, then no hook executes.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Design Notes

- Outcome `verified` in the tracer means plan `built` and a non-empty diff only; 5.8 adds the test re-run before release (5.11), so AD-17 holds at release.
- `builds` is made available here (not in 5.3) because the hitl live check needs it on; 5.3 still freezes the contracts.
- Hooks are disabled because the agent controls the branch content (e.g. `.husky/`, `core.hooksPath` set by a repo) and approve runs git unsandboxed in the main checkout.
- Record live: whether `bmad-build-auto` accepts `ogden/<ref>-<slug>`, and how a `plan_checkpoint` stop shows over ACP (for 5.4).

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `pnpm test` -- all pass
- `pnpm e2e` -- all pass, including `build-tracer.spec.ts`
- `pnpm run pack && pnpm smoke` -- pass

**Manual checks (hitl, developer's machine):**
- In a scratch repo (never this repo) with Planning, Board and Unattended builds on and trusted: Build on one ready ticket → worktree under the data folder, Claude Code's work streams, ends built; Approve → merge commit locally, board shows Done; note the branch acceptance and checkpoint behaviour.
