---
title: 'Changes panel: This turn, Unstaged, Staged and Branch; turn snapshots; Commit these changes for a worktree chat'
type: 'feature'
ticket: '4'
created: '2026-11-01'
status: 'built'
baseline_revision: '1d73f150bb3371efcc12e166675c80f3e5263f68'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'security']
review_loop_iteration: 0
context: ['{project-root}/AGENTS.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 8.2 left `VcsWorkingTreePort` with only a memory stub and every Changes route answering 501, so nobody can see what a turn changed, the working tree's unstaged and staged changes, or a branch's changes, and a worktree chat cannot commit (E8-R4, AD-37, AD-17 CAP-33 note; 25.7 moved here).

**Approach:** A real git adapter for `VcsWorkingTreePort` in the `vcs-git` style (argument arrays, allowlisted env, hooks off), with turn snapshots as tree objects written to an object store in the data folder through a temporary index; core records a snapshot before each chat prompt and after it, appending `session.turn_changes_recorded`; the routes are wired on the real server; the Workbench gets a Changes panel on 8.3's `DiffViewer` with the four views, a turn picker, and Commit these changes for a worktree chat; a turn that changed files ends with "Changed N files +A -D" and **Review changes**.

## Boundaries & Constraints

**Always:** git runs only through `execFile` with an argument array, `core.hooksPath` the empty folder, `core.fsmonitor=false`, `--no-ext-diff --no-textconv`, literal pathspecs, the allowlisted env; every call's cwd is the folder core resolved (the project's real path, or a chat's worktree run with Ogden-pinned `GIT_DIR`/`GIT_COMMON_DIR`/`GIT_WORK_TREE` after the 5.3 worktree check); paths shown are relative to that folder (`--relative`) and only those `WorkspaceRelativePath` accepts and `isRefusedWorkspacePath` allows; snapshots never write the repo's index, refs or objects (temporary index and object store under `<data>/snapshots`, a real folder, never a link); a snapshot failure never fails or delays a turn past 10 s; the commit and snapshots run under `serializedByRepo(<project folder>)`; the commit is refused mid-turn, for a chat without a worktree, and with nothing to commit; no em or en dashes in UI strings; `{error:{code,message}}`.

**Never:** hunk or file stage, unstage or revert (8.5; the git adapter has no `applyHunk`, so that route answers 501); line comments (8.6); pushing, fetching, merging, creating worktree chats (27.3); the Changes panel beside the chat as a sheet and the session header's Changes count (deferred); snapshots of terminal-driven turns; a shell string; editing `deferred-work.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Two turns | fake agent writes `a.txt`, then `b.txt` | This turn (latest) lists only `b.txt`; picking the first turn lists only `a.txt` | none |
| Not a repo | project folder without git | turn runs, no `turn_changes_recorded`; views answer empty | none |
| Unstaged | modified tracked file, new untracked file, ignored file | both listed (untracked as Added), ignored absent; repo index unchanged | none |
| Staged / Branch | staged edit; commits on `feature` past `main` | Staged lists the edit; Branch lists the commits' files with `base: main` | no base branch: empty, `base` absent |
| Binary / large | a PNG; a 2 MiB text change | `binary: true` no hunks; `tooLarge: true` no hunks | none |
| Commit worktree chat | fixture worktree on `ogden/chat/<id>` with changes, a repo pre-commit hook | one commit on that branch, hook not run, main checkout's HEAD, index and files unchanged | nothing to commit: 409 `invalid_operation` |
| Tampered worktree | worktree's `.git` or admin `HEAD` changed | nothing runs | 500, nothing committed |
| Snapshot store link | `<data>/snapshots` or a store is a link out of the data folder | no snapshot taken, nothing written outside | turn unaffected |

</frozen-after-approval>

## Code Map

Project root is the worktree `/Users/harrisonsmith/Library/Caches/ogden-agents-dev-worktrees/8.4`; never `git stash`, push or switch branches.

- `packages/core/src/vcs-port.ts` -- `VcsWorkingTreePort`: change `root: string` to `VcsFolder { path; worktree?: { repoPath; branch } }`; `applyHunk` optional; `commitAll` returns `'nothing'` when empty. Update `vcs-memory/working-tree.ts` and its three test users (`packages/core/test/workbench-contracts.test.ts`, `packages/server/test/workbench-routes.test.ts`, `packages/adapters/test/workbench-adapters.test.ts`).
- `packages/core/src/workspace-changes.ts` -- build `VcsFolder` from `resolveWorkspaceRoot`; filter files through `WorkspaceRelativePath.safeParse` and `isRefusedWorkspacePath`; `hunk` throws `NotImplementedError` without `port.applyHunk`; commit under `serializedByRepo(workspaceFolder)` and `'nothing'` → `InvalidOperationError`.
- New `packages/core/src/turn-snapshots.ts` -- `createTurnSnapshots({entities, sessionEvents, port})`: `start(sessionId)` / `end(handle)`; skips `build` and remote (`machineId`) sessions; counts from `changedFiles` turn target. `core.ts` exposes `core.turnSnapshots` (undefined without the port).
- `packages/core/src/chat/turns.ts` `runTurn` -- await `options.turnSnapshots?.start` (raced with 10 s) just before `started.prompt`; call `end` once the prompt settles. `chat/types.ts` `ChatOptions.turnSnapshots?`.
- `packages/core/src/repo-serialization.ts` `serializedByRepo` -- reuse; `workspace-root.ts` `workspaceFolder`, `sessionFolder`.
- `packages/adapters/src/vcs-git/` -- new `working-tree.ts` (`createGitWorkingTree({ hooksDir, env, snapshotsRoot, git?, timeoutMs? })`), reuse `checks.ts` (`checkPath`, `REVISION`, `SAFE_CONFIG`, `realOf`, `isInside`), extract `run`/`pinnedWorktree`/`identityFlags` from `index.ts` into a shared module rather than copying. Export from `adapters/src/index.ts`.
- `packages/server/src/start.ts` ~208 -- `vcsWorkingTreePort: options.vcsWorkingTreePort ?? createGitWorkingTree(...)` (env as `createServerVcs`); `createChat({... turnSnapshots: core.turnSnapshots })`; `start-types.ts` option. `workspace-files-routes.ts` `workbenchRefusal`: `NotImplementedError` → 501.
- `packages/web/src/workbench/` -- new `workbench-changes.tsx`, `changes-api.ts`; `routes/workspace-workbench-page.tsx` gains the Changes tab; `router.tsx` `WorkbenchSearch` gains `panel`, `view`, `session`, `turn`. Reuse `DiffViewer`, `DiffFileList` (`ui/diff-viewer.tsx`), `ToggleGroup`, `Button`, `Text`, `Skeleton`; texts from `shared/workbench-changes.ts`.
- `packages/web/src/chat/transcript.ts` -- new item `turn_changes` from `session.turn_changes_recorded` with `files > 0`; rendered in `routes/session-page.tsx` (`itemKey` and the item switch) as a small row linking to the Workbench Changes on that turn.
- Tests pattern: `packages/server/test/send-now.test.ts` (real server, fake agent `write-file <relpath> <base64>`), `tests/e2e/workbench-files.spec.ts` (`withChatServer`, `addProject`, axe, 390px).

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/vcs-port.ts`, `vcs-memory/working-tree.ts`, `workspace-changes.ts`, new `turn-snapshots.ts`, `core.ts`, `index.ts`, `chat/turns.ts`, `chat/types.ts` -- contract change, path filter, serialization, snapshots around prompts.
- [x] `packages/adapters/src/vcs-git/working-tree.ts` (+ shared runner) -- views, file diff (parse `@@` hunks, ids `h<n>-<sha1 10>`), snapshot, commitAll, store checks.
- [x] `packages/server/src/start.ts`, `start-types.ts`, `workspace-files-routes.ts` -- wiring, 501 mapping.
- [x] `packages/web/src/workbench/workbench-changes.tsx`, `changes-api.ts`, `routes/workspace-workbench-page.tsx`, `router.tsx`, `chat/transcript.ts`, `routes/session-page.tsx` -- the panel, turn picker, commit form, Changed row.
- [x] Tests: `packages/adapters/test/vcs-git-working-tree.test.ts` (every matrix row on real git fixtures, plus security rows: absolute and `..` paths, a symlink to `/etc/passwd` shown as its link text, store and snapshots root as links refused, tree ids not hex refused, index and refs of the repo unchanged after a snapshot, nothing written outside `<data>/snapshots`, env has only the allowlist plus git's own), core `turn-snapshots.test.ts` and updated contracts test, `packages/server/test/workbench-changes.test.ts` (two fake-agent turns, worktree commit), web `workbench-changes.dom.test.tsx` and transcript test, `tests/e2e/workbench-changes.spec.ts` (fake turn, Changed row, Review changes opens This turn, view switch, axe, 390px).

**Acceptance Criteria:**
- Given a chat in a git project, when the fake agent writes a file in each of two turns, then This turn shows only the second turn's file and the turn picker shows both turns.
- Given a fixture worktree chat with a repo hook, when Commit these changes is clicked, then the branch `ogden/chat/<id>` has one new commit, no hook ran, nothing was pushed and the main checkout is unchanged.
- Given the change, when `pnpm typecheck`, `pnpm test` and the touched e2e specs run, then they pass.

## Implementation Notes

- `VcsWorkingTreePort.snapshot` answers `undefined` for a folder in no repository (the Not a repo row), so core records nothing; a refusal or failure throws and core skips the turn's record.
- Turns with no changes are still recorded (`files: 0`), so This turn of the latest turn never shows an older turn's files; the chat's Changed row appears only for `files > 0`.
- The temporary index keeps the real index's mtime (`utimesSync`): a newer copy hid racily clean edits (same size, same second) from `add`, which made the subfolder Unstaged case flaky.
- Renames show as a deletion and an addition (`--no-renames`), so a file's diff can always be read by its one path.
- A listing's `tooLarge` is from blob sizes (either side over 1 MiB); the file's diff also says `tooLarge` when the diff text itself is over it.
- `run`, `must`, `identityFlags` and `pinnedWorktree` moved to `vcs-git/runner.ts`; `index.ts` adds the run's object store to the pinned env itself.
- New shared texts in `workbench-changes.ts`: `COMMIT_NOTHING_MESSAGE`, `HUNK_ACTIONS_NOT_AVAILABLE_MESSAGE`, the panel's labels, `turnChangedText`, `REVIEW_CHANGES_LABEL`.
- Decided by the user (2026-11-01, review #12; AD-37 Rule): a project's `.git` file is followed only for a standard linked worktree (`<repo>/.git/worktrees/<name>` whose `gitdir` points back at this `.git` file, its `commondir` that repo's `.git`) or submodule (inside `<super>/.git/modules/`, `core.worktree` if set resolving to this project), by real path; anything else and the views, snapshots and Commit refuse with `GIT_POINTER_UNUSUAL_MESSAGE` (409 `invalid_operation`). Built as an epic follow-up in `vcs-git/git-pointer.ts`; git's discovered git folder must then be the one checked. A bare repo's worktree (`<repo>.git/worktrees/<name>`) is not one of the two layouts and is refused.
- Not done: the snapshot store is never pruned (no GC of `<data>/snapshots`); snapshot failures are not logged by the server.

## Plan Change Log

## Review Triage Log

Pass 1 (2026-11-01; lenses: quick, security). Verdicts: high 4, medium 5, low 6, false 0, maybe-false 0. No intent_gap or bad_plan; 11 patched, 4 deferred.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | Snapshot, Unstaged and commit `git add` run configured clean/process filter drivers (a `.gitattributes` the agent writes picks one; git-lfs writes `.git/lfs`) | high | patch | security reviewer reproduced a marker; quick lens found the same; every configured filter blanked per call |
| 2 | A promisor remote makes a view or snapshot lazy-fetch and run `uploadpack`/`sshCommand` | high | patch | reproduced; `protocol.allow=never`, `core.sshCommand=false`, `GIT_NO_LAZY_FETCH=1` |
| 3 | A symbolic chat branch ref makes the commit move `main`; HEAD checked once before several processes | high | patch | reproduced; symbolic ref refused, commit by `write-tree`/`commit-tree`/`update-ref --no-deref` compare-and-swap |
| 4 | Index copy and worktree file reads follow links and block the event loop on a FIFO | high | patch | `copyFileSync` copied through a link and hung on a FIFO; one no-follow, non-blocking, size-capped regular-file read |
| 5 | `core.splitIndex=true` leaves a `sharedindex.*` in the repo's `.git` | low | patch | reproduced; `core.splitIndex=false`, `core.untrackedCache=false` |
| 6 | Forced `core.autocrlf=false` on the user's checkout shows CRLF checkouts as fully rewritten | medium | patch | the override was for Ogden's build worktrees; the working-tree runner omits it |
| 7 | A hung snapshot holds `serializedByRepo` up to 120 s (builds, commit wait) | medium | patch | the 10 s race only stops waiting; 30 s git timeout for the working-tree adapter |
| 8 | Awaiting the end snapshot keeps the turn busy while the chat shows idle (messages queue, ~20 s before the next prompt) | medium | patch | `turns.ts` finally; end snapshot no longer awaited, ordered by the repo chain |
| 9 | Two sr-only loading strings inline in the panel | low | patch | moved to `shared/workbench-changes.ts` |
| 10 | Snapshot failures never logged (`onError` unwired) | low | patch | core option passed through; server logs session id and code only |
| 11 | Missing security test rows (filters, lazy fetch, symbolic branch, FIFO/links, splitIndex, autocrlf) | medium | patch | added with each fix above |
| 12 | `<project>/.git` as a gitfile to another repo makes the views read (and a crafted worktree commit write) that repo | medium | defer | pinning the project's git folder refuses linked-worktree and submodule projects; a product choice for the sweep |
| 13 | A turn whose start snapshot failed records nothing, so This turn shows the previous turn | medium | defer | rare (timeout or git failure); needs a "not recorded" marker in the event contract |
| 14 | Turn counts stop at 1000 files | low | defer | `listed` caps at `MAX_CHANGED_FILES`; a `--shortstat` count would fix it |
| 15 | Snapshot store never cleaned and holds full copies of non-ignored files (`.env` included) | medium | defer | the data folder is per-user; store retention and GC belong with 27.x retention |

## Deferred (for the sweep)

- A turn whose start snapshot timed out or failed records nothing, so This turn shows the previous turn; a "not recorded" marker needs an event contract change (review #13).
- Turn counts stop at `MAX_CHANGED_FILES` (1000) files; a `--shortstat` count would be exact (review #14).
- The snapshot store under `<data>/snapshots` is never cleaned and holds full copies of non-ignored files, `.env` included; retention and GC belong with 27.x retention (review #15).
- With filter drivers disabled, git-lfs files show as changed against their pointers in Unstaged and This turn; an allowlist of known-safe drivers (or `--attr-source` once the minimum git is 2.40) would fix it.
- Filter names are read, then blanked on the next call: an agent that adds a filter between the two calls could still race one run.
- The Changes panel opens in the Workbench, not as a sheet beside the chat; the session header's Changes count is not built; terminal-driven turns get no snapshots.
- Unstaged copies the index for every request, once per file diff (up to 100 per panel load).

## Design Notes

Snapshot (settles the entry's `unknown`): copy the folder's index (`rev-parse --git-path index`) to a temp file in `<data>/snapshots/tmp`, then with `GIT_INDEX_FILE=<temp>`, `GIT_OBJECT_DIRECTORY=<data>/snapshots/<sha256(real common dir)[:16]>/objects` and the repo's objects as `GIT_ALTERNATE_OBJECT_DIRECTORIES`, run `add -A -- .` and `write-tree`; delete the temp. Plain files and env vars only, so it works the same on all three OSes. Reads of a turn take the store as an alternate. Unstaged uses the same temp index with untracked files added `-N` (no blobs written) so new files show as Added.

Branch base: `origin/HEAD`'s branch, else `main`, else `master`; compared from `merge-base` to `HEAD`, commits only.

Panel decisions (autonomous): the Changes panel lives in the Workbench (`?panel=changes`), opening on Unstaged; with `?session=` it opens on This turn for that chat, and that chat's worktree shows Commit these changes. The chat's Review changes link opens it there rather than in a sheet beside the chat. Diffs are fetched for the first 100 listed files.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors
- `pnpm test` -- expected: all pass (wait for `uptime` load below 40; re-run timing failures alone)
- `pnpm run build && pnpm exec playwright test tests/e2e/workbench-changes.spec.ts tests/e2e/workbench-files.spec.ts` -- expected: pass
- `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs` -- expected: pass

**Results (after review fixes, 2026-11-01):** `pnpm typecheck` clean; `pnpm test` 5590 passed, 13 skipped (430 files) at load 2; after `pnpm run build`, `workbench-changes`, `workbench-files`, `diff-viewer` and `send-now` e2e 7 of 7 (axe and 390px in `workbench-changes`); provenance check passed.
