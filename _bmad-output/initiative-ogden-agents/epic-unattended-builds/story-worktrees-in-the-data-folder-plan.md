---
title: 'Worktrees in the data folder'
type: 'feature'
ticket: '5'
created: '2026-10-04'
status: 'built'
baseline_revision: 'd4df60487dd472201d0bedda9efae98bd9b36ba2'
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

- 2026-10-04 (build): implemented directly from this plan (5.3's subagent attempt stalled; the context was loaded), in local milestone commits.
- Core: `build-worktrees.ts` (`ensureWorktreesRoot`, `isOwnWorktreePath`, `worktreeDisposition`, `removeRunWorktree`, `sweepWorktrees`, `sweepRunBranches`, `freeBytesOf`, `removeLinkOnly`), `run-aware-tickets.ts` (`createRunAwareTickets`, `planConfined`), `entities.listRunsWithWorktree`. `builds.ts` gains `requireGit`, the disk guard, collision-checked run ids, `commitPlanFiles` and `sweep`. Approve and reject now release the agent, record the decision, then clean up. A cleanup failure is logged and never thrown. An approved run's review answers `merged: true` once its branch is gone. The test harness moved to `packages/core/test/builds-harness.ts`, which keeps `builds.test.ts` under 600 lines.
- Ports and adapters: `VcsPort.check`, `isAncestor` and `commitPaths`, and `removeWorktree(…, { deleteBranch, mergedOnly })`. `vcs-git` gains `worktreesRoot`, `parseGitVersion` and `gitVersionAtLeast`. `vcs-memory` follows.
- Shared and server: the `disk_space_low` code, the sentences, `CommitPlanFilesResponse`, the `workspaceBuildCommitPlan` route and the server routes. Its route-list tests are updated. The server awaits `builds.sweep()` before it listens. The board's store is the run-aware one, and the watcher keeps the raw store.
- Web: **Commit plan files** shows on a `plan_uncommitted` refusal whose message is `PLAN_UNCOMMITTED_MESSAGE`; uncommitted BMad scripts get no button. After it runs, a notice says to build again.
- Verified after the review patches: `pnpm typecheck` clean; `pnpm test` 1946 passed, 4 skipped (after the contract test learned `baseBranch`); `pnpm e2e` 104 passed; `pnpm run pack && pnpm smoke` OK; provenance OK.
- Verified (before the review patches): `pnpm typecheck` clean; `pnpm test` 1937 passed, 4 skipped; `pnpm e2e` 104 passed; `pnpm run pack && pnpm smoke` OK; provenance OK.

## Plan Change Log

- 2026-10-04, review pass 1 (quick Q2): Approve only checked that the build's base was in HEAD, so it could still merge into another branch holding it. That is the "another branch" case the Intent names. Amended outside the frozen block: the run stores `baseBranch` (nullable column `base_branch`, migration `0012_run_base_branch`, `Run.baseBranch` defaulting to `null`), and approve refuses with `CHECKOUT_MOVED_MESSAGE` when the checked-out branch isn't it. A run from before this has `null` and keeps the ancestor check. Known-bad state avoided: a reviewed build merged into a branch the user never chose. KEEP: everything else. The fix is additive and local to approve, so the code was amended in place rather than reverted (the same deliberate deviation 5.2's loop 1 recorded).

## Review Triage Log

- 2026-10-04, pass 1 (lenses quick, security). Counts: high 3, medium 9, low 7, false 1, maybe-false 0. Routes: bad_plan 1 (amended in place, see Plan Change Log), patch 14, defer 1, reject 4. No intent_gap.
  - Q1: a superseded undecided run was never cleaned up. Medium, patch. A new Build cleans up the ticket's previous finished undecided run, and the sweep removes superseded runs (`worktreeDisposition(run, superseded)`). Tests added.
  - Q2: approve could merge into another branch that holds the base. High, bad_plan, amended in place (`baseBranch`). Test added.
  - Q3: the branch sweep was fire-and-forget, and its 30-day window wasn't in the plan. Medium, patch. The sweep is now awaited before the server listens. The window stays and is recorded in Design Notes: it bounds startup git calls, and a branch missed past it is a harmless leftover.
  - Q4: the API doc said 409 and the board said "committed" even when nothing was committed; there was an unused constant. Low, patch. The doc says `committed: []`, the board says there was nothing to commit, and the constant is replaced. Web test added.
  - Q5: a failed Commit plan files left the files staged. Medium, patch: `git reset -- <files>` on failure. Test uses a signing program that can't run.
  - Q6: the adapter's removal guard didn't check the run-id name. Medium, patch: `RUN_SHORT_ID` is required inside `worktreesRoot`. Test added.
  - Q7: the planned web component test was missing. Low, patch: two DOM tests in `plan-and-board.dom.test.tsx`.
  - Q8: the collision retry only checked the exact branch, then went ahead anyway. Low, patch: it also checks runs already using that id under `ogden/<id>/`, and refuses (`vcs_unavailable`) after 5 tries.
  - Q9: a linked `<data>/w` gave a 500, and the folder was made before the disk check. Medium, patch: a `vcs_unavailable` refusal with `WORKTREES_FOLDER_NOT_REAL_MESSAGE`, and the disk is checked on the data folder before `mkdir`. Tests updated.
  - Q10, S9: the link helper existed twice, and `rmdir` didn't re-check that the path was a link. Low, patch: core's `removeLinkOnly` (lstat re-check) is shared with `vcs-git`.
  - S1: a board mark into a worktree followed links the agent planted in `_bmad-output/` (an unsandboxed write outside it). High, patch: `planConfined` requires no link on the way, a regular single-link file and the real path inside the worktree. A mark is refused while the run's agent is running (`run_active`) and when the plan isn't confined (`checks_failed`, `RUN_PLAN_NOT_CONFINED_MESSAGE`). The board route maps `BuildRefusedError` to 409. Tests added.
  - S2: worktree reads while the agent is live are check-then-use. Medium, defer: the same class as 5.2's `decideOutcome` reads and the 4.13 entry. Confinement now keeps reads off links; what's left is the scripts swap the sandbox denies.
  - S3, S4: removal went through `git worktree remove <path>`, which resolves a path that became a link, and an agent-edited `gitdir` left a live record. High, patch: Ogden removes the folder itself (no link followed), then the record `<common>/worktrees/<id>` by id, never via git's path match or a prune. Test: the folder swapped for a link to the user's worktree plus a forged `gitdir` leaves the user's worktree and record intact.
  - S5: the sweep keyed runs by their stored parent folder, so a moved data folder made kept runs look orphaned. Medium, patch: runs are keyed by run id alone. Test added.
  - S6: the sweep could race a build start. False for the folder sweep, which `start.ts` awaits before `listen`. The branch part is now awaited too (Q3).
  - S7: pathspec magic and globs in Commit plan files, `add` and `restore`. Medium, patch: `--literal-pathspecs`. Test: `[ab].md` commits only itself.
  - S8: the user's own `commit.gpgsign` or filters run on Commit plan files. Low, reject: this is the user's own configuration, applied to the user's own files in their checkout.
  - S10: case and 8.3 forms in comparisons when a path no longer exists. Low, reject: that case fails closed (nothing removed), and the open case is S5's, now fixed.
  - S11: a failed git check was cached for the life of the process. Low, patch: only a usable answer is cached.
  - S12: branch deletion checked only the `ogden/` prefix. Medium, patch: it must be `ogden/<the folder's id>/`. Test added.
  - S13: an agent-written symref as the run's branch. Low, reject: `branch -d`/`-D` delete the symref itself (no deref), and no damage was found.

## Design Notes

- Plan kept whole (~2,300 tokens): every task is entry 5's own text or a user decision assigned to it; splitting would leave the adapter half-done.
- The branch sweep looks back 30 days (`BRANCH_SWEEP_WINDOW_MS`) and is awaited before builds are served. This bounds startup git calls; a branch older than that whose removal failed stays as a harmless leftover.
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
