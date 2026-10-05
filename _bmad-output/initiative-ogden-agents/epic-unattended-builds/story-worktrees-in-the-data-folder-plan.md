---
title: 'Worktrees in the data folder'
type: 'feature'
ticket: '5'
created: '2026-10-04'
status: 'in-review'
baseline_revision: '2f3754286d2e84b2d3a1e57be79e9ed36ae464da'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'security']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-unattended-builds/epic-unattended-builds.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-unattended-builds/story-tracer-bullet-one-ticket-built-reviewed-and-approved-from-a-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The tracer (5.2) and contracts (5.3) left `vcs-git` working but unfinished for real use: run branches pile up in the user's repo, a worktree whose removal fails (Windows locks) or whose run was decided stays forever, removal runs `git worktree prune` (touching the user's own stale worktrees) and can `rm` a path it never checked is Ogden's, nothing checks the git version (builds rely on 2.31+ and `git apply`'s 2.39.2 symlink fix) or free disk, approve merges into whatever is checked out (even a detached HEAD or another branch), the board reads a running ticket's plan from the main checkout (AD-10 says its worktree), and **Commit plan files** (user decision 2026-10-04, entry 5's) doesn't exist.

**Approach:** Finish entry 5 on the existing pieces: a confined worktree layout `<data>/w/<run8>` with collision retry, a cleanup policy (decided runs lose their worktree and branch) with a targeted removal and a startup orphan sweep that only ever touches `<data>/w`, a git version check and a disk-space guard at Build and approve, approve refusing a detached or switched checkout, a run-aware ticket store for the board, and a guarded **Commit plan files** use-case, route and button.

## Boundaries & Constraints

**Always:**
- Every removal checks first that the path is Ogden's own: `<data>/w` is a real folder (not a link or junction), the path's parent's real path is it, and its name is a run id (`[a-z2-7]{8}`). Never `git worktree prune`; never follow a link; only the repo's `worktrees/<run8>` metadata whose `gitdir` names that path is removed. Never the main checkout.
- Disposition: approved or rejected runs → worktree and branch removed (approved: `git branch -d` semantics, merged only); blocked, interrupted, failed, stopped-undecided or running → kept (Retry, Reject; E5-R8). A failed removal is logged (codes only) and retried by the startup sweep; it never fails approve or reject.
- Startup sweep (after `settleInterruptedRuns`): for each entry of `<data>/w`: a link or file is unlinked (not followed); a folder no run names is removed with `rm` (no git, no repo touched); a decided run's leftovers go through the port. Branches of decided runs that still exist (`ogden/<run8>/…` only) are deleted.
- Git version: `vcs.check()` once per process (cached); missing or below 2.39.2 → Build and approve refused `vcs_unavailable` with a plain sentence naming the found and needed version.
- Disk: Build refused (`disk_space_low`, new, additive) when the data folder's volume has less than 1 GiB free (injectable for tests).
- Approve refuses (`checkout_dirty`, run unchanged) when HEAD is detached or the run's base revision isn't an ancestor of HEAD (the user switched branches), besides 5.2's checks; `_bmad-output/` changes still don't block.
- Run-aware tickets (AD-10): for a ticket whose latest run is undecided with an existing own worktree, `tree`/`find`/`mark` use that worktree, after `requireScriptsMatch` on it; on mismatch or any error the main checkout answers (reads) or the mark is refused. The watcher stays main-checkout only.
- **Commit plan files**: builds-guarded, serialized per repo; commits only the ticket's plan and the `tickets.toml` files `plan_uncommitted` watches that have changes (`git add` then `git commit --only`), hooks off, identity fallback; refuses during a merge/rebase; other staged changes stay staged.
- Every Ogden git call keeps 5.2's flags. Tests use real git in temp dirs, never the network, real agents, the keychain or `~/.claude`; test hooks only under `testHooksAllowed`.

**Never:** No per-run object store (re-deferred, needs 5.6's sandbox env). No Stop, Retry beyond 5.4's, dispatcher, run-folder pruning (5.8/11.1), Update and retry UI (5.9). No push, fetch or force.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Two builds | two ready tickets | two worktrees under `<data>/w`, no shared files, none in repo | — |
| Deep data folder | ~200-char data path (Windows) | worktree add, diff, merge, remove work | — |
| Old git | `check()` says 2.30 | 409 `vcs_unavailable` "needs git 2.39.2 or newer (found 2.30.0)" | nothing written |
| Low disk | < 1 GiB free | 409 `disk_space_low` | nothing written |
| Approve, detached / switched | HEAD detached, or base not in HEAD | 409 `checkout_dirty`, plain reason | run stays `verified` |
| Approve done | merged | worktree and branch gone; review shows merged | removal failure logged, swept |
| Reject | verified run | worktree and branch gone | — |
| Sweep | orphan folder, link, decided leftovers, live blocked run | orphan/link/leftovers gone; blocked kept; nothing outside `<data>/w` | errors logged |
| Forged path | run's `worktreePath` outside `<data>/w`, or `<data>/w` a link | nothing removed | logged |
| Active run plan | agent marks plan `in-progress` in worktree | board shows it; main checkout unchanged | scripts mismatch → main |
| Commit plan files | plan + tickets.toml uncommitted | one commit with exactly those; Build then works | not changed → nothing; merge in progress → 409 `checkout_dirty` |

</frozen-after-approval>

## Code Map

- `packages/adapters/src/vcs-git/index.ts` -- add `check()` (parse `git --version`, cache), `commitPaths`; `removeWorktree`: drop `worktree prune`, remove `<common>/worktrees/<basename>` only when its `gitdir` names the path, `rm` only under `options.worktreesRoot`, branch delete only `ogden/` names (`-d` vs `-D` by option). Keep flags, `pinnedWorktree`, `merge`.
- `packages/core/src/vcs-port.ts` -- `check`, `commitPaths`, `removeWorktree` options `{ deleteBranch, mergedOnly }`, `isAncestor(repo, revision)`; `packages/adapters/src/vcs-memory` stub likewise.
- `packages/core/src/builds.ts` (743 lines: put new logic in new files) -- `startLocked` (git check, disk guard, collision retry), `retire` (branch too, own-path check), approve checks, `reviewOf` (approved run with branch gone → `merged: true`), new `commitPlanFiles`.
- `packages/core/src/build-worktrees.ts` (new) -- `ownWorktreePath(dataDir, path)`, `worktreeDisposition(run)`, `sweepWorktrees(...)`, `freeBytes` default via `statfs`.
- `packages/core/src/run-aware-tickets.ts` (new) -- `TicketStorePort` decorator; `entities.listWorkspaces`, `latestRunForTicket`, a new `listUndecidedRunsWithWorktree(workspaceId)`.
- `packages/core/src/entities.ts` -- `listRuns()` for the sweep and the decorator.
- `packages/shared/src/errors.ts`, `builds.ts`, `api.ts` -- `disk_space_low`; sentences `GIT_MISSING_MESSAGE`, `gitTooOldMessage`, `DISK_SPACE_LOW_MESSAGE`, `CHECKOUT_MOVED_MESSAGE`, `PLAN_FILES_COMMITTED`; route `workspaceBuildCommitPlan` (`…/builds/:ref/commit-plan`); `core/src/errors.ts` `BuildRefusalCode`.
- `packages/server/src/start-builds.ts`, `start.ts` (~281), `build-routes.ts` -- `worktreesRoot`, run-aware store for the board, sweep at start, route via `bmadPieceRoutes('builds')`; `test/gate.test.ts`, `bmad-guard-coverage.test.ts` lists.
- `packages/web/src/planning/board-tickets.tsx` `useBoardBuild`, `builds-api.ts` -- **Commit plan files** on a `plan_uncommitted` refusal whose message is `PLAN_UNCOMMITTED_MESSAGE`.
- Tests: `packages/adapters/test/vcs-git*.test.ts`, `packages/core/test/builds.test.ts`, new core tests, `packages/server/test/build-routes.test.ts`, `tests/e2e/build-tracer.spec.ts`.

## Tasks & Acceptance

**Execution:**
- [ ] shared + core ports/errors -- new code, sentences, route, port methods, memory stub.
- [ ] `vcs-git` -- version check, targeted removal, `commitPaths`, `isAncestor`; tests on temp repos: deep path, two worktrees, removal leaves no worktree/branch/metadata and keeps another stale worktree's metadata, link refused, version parsing.
- [ ] core `build-worktrees.ts`, `run-aware-tickets.ts`, `entities.listRuns`, `builds.ts` changes -- with unit tests per matrix row.
- [ ] server wiring, sweep at start, route; gate and guard-coverage lists; route tests.
- [ ] web button + component test; e2e: Commit plan files then Build; approve removes worktree and branch.

**Acceptance Criteria:**
- Given entry 5's verify list, when the adapter and core tests run on all three OSes, then each item holds (two worktrees, deep path, stats match `git diff --numstat`, clean merge, uncommitted merge takes an added file, `_bmad-output` exception, conflict leaves checkout byte-for-byte unchanged, removal leaves nothing, worktree plan returned while active).
- Given a server start with an orphan folder and a symlink in `<data>/w` pointing at a folder outside, then both entries are gone and the outside folder is intact.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Design Notes

- Plan kept whole (~2,300 tokens): every task is entry 5's own text or a user decision assigned to it; splitting would leave the adapter half-done.
- Interrupted and failed runs keep their worktrees (E5-R8, Retry/Reject); "cleanup on stop/fail" means their removal comes with the decision (Reject) or the sweep after it.
- 5.2 kept the branch after approve and reject (its tracer scope); entry 5's approved text ("removes a worktree and its branch after a merge or a discard") supersedes that here.
- Approved run reviews: the branch is gone, so `reviewOf` answers `merged: true` with an empty diff.
- The 5.2 deferral "per-run object store" pointed at 5.5 is re-pointed to 5.6 (needs the sandbox's env); recorded in deferred-work.md.

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `pnpm test` -- all pass
- `pnpm e2e` -- all pass
- `pnpm run pack && pnpm smoke` -- pass
