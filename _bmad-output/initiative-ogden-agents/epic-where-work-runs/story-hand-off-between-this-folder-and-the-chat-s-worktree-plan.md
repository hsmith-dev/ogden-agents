---
title: "Hand-off between this folder and the chat's worktree"
type: 'feature'
ticket: '4'
created: '2026-11-01'
status: 'built'
baseline_revision: '73bba3c169ab0b27cfb2419ae89ffcdbf61dc81d'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'defensive']
review_loop_iteration: 1
context: ['{project-root}/AGENTS.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A started chat's Location chip only shows its place: nothing moves a chat between this folder and its own worktree, so work begun in the wrong place stays there (E27-R3; CAP-35; AD-8 CAP-33 note as amended 2026-11-01, AD-37).

**Approach:** Wire 27.2's `ChatLocations` (`location`, `handOff`) over a git `moveChanges` and `setSessionWorktree`: the started chat's Location chip offers **Move to its own worktree** / **Move to this folder**, confirmed once, moving the uncommitted changes all or nothing; the agent restarts in the new folder on its own session where it can; the transcript shows a "Moved to ..." divider from `session.location_changed`.

**Decisions (autonomous, 2026-11-01; user may overrule):** (1) Moving to a worktree carries every uncommitted change of the project folder (it can't tell the chat's from the user's), as Codex does. (2) Moving back removes the now clean copy as Delete chat does (its branch kept when it has commits); moving to a worktree again reuses a kept branch. (3) Moved changes arrive unstaged.

## Boundaries & Constraints

**Always:** git only through `VcsPort`/`VcsChatWorktreePort`, under `serializedByRepo(<project folder>)`, AD-17 protections (8.4 runner, filters off, pinned worktree); both folders snapshotted into AD-37's store before anything moves (tree ids logged, never a path); apply to the target `--check` first, all or nothing, then the source; an adapter throw means the source still holds its changes; refused (409 `agent_mid_turn`) while this chat or any local chat in the project folder is `working`, `waiting`, busy, switching or terminal-driven, checked again inside the chain; refused (409 `handoff_conflict`, `details.files`) when the target has uncommitted changes to any of the same files or the patch doesn't apply there, nothing moved; only the project folder and the chat's own `<data>/cw/<8>` (`isChatWorktreePath`) are written; the agent released before and its next start's cwd the new folder (`resumes` = it has its own agent session); events strict (27.2's); no em or en dashes in UI strings; `{error:{code,message}}`.

**Never:** a shell, `git stash`, `checkout`/`reset`/`restore` of a path, `--3way`; merging or pushing; moving a remote, build or planning chat; retention, Restore, ports, trials (27.5 to 27.8); editing `deferred-work.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| To worktree | idle this-folder chat, edited + untracked + staged files | copy `<data>/cw/<8>` on `ogden/chat/<ses>` holds them unstaged; project folder matches HEAD; event {worktree, previous this_folder, branch, files, resumes} | none |
| Back | idle worktree chat with edits | project folder holds them; copy removed; branch kept only with commits; event previous worktree | none |
| Round trip | both, fixture repo | the edit intact both ways; next turn's cwd the new folder | none |
| Mid-turn | this chat or another this-folder chat working/waiting/busy | nothing moves | 409 `agent_mid_turn` |
| Overlap | project folder has its own change to a file the copy changed | nothing moves | 409 `handoff_conflict` files 1 |
| Base moved | project HEAD changed the same file since | nothing moves | 409 `handoff_conflict` |
| Kept branch | branch has commits, move to worktree again | copy on the existing branch | conflict as above |
| Same place / remote / not chat / terminal | | nothing | 409 `invalid_operation` |
| Tampered row | `worktreePath` outside `<data>/cw` | nothing written | 409 `invalid_operation` |
| Failure after copy made | apply fails | new copy removed (a reused branch kept); source untouched | plain 409 |
| Row write fails after move | | changes moved back, best effort; else copy left and reported | original error |

</frozen-after-approval>

## Code Map

Project root is the worktree `/Users/harrisonsmith/Library/Caches/ogden-agents-dev-worktrees/27.4`; every path is relative to it, every command runs there. Never edit another checkout, `git stash`, push or switch branches. Wait for `uptime` load below 40 before `pnpm test`; re-run timing failures alone. 27.5 and 27.6 are built in parallel: keep edits to shared files (`where-work-runs.ts`, `vcs-port.ts`, `vcs-memory/chat-worktree.ts`, `start.ts`) small and additive.

- `packages/shared/src/where-work-runs.ts` -- `HandOffRequest`, texts (`HANDOFF_*`, `handOffDividerText`, `handOffConflictText`, `handOffMidTurnText`); add only a failure text and the confirm title. `events-where-work-runs.ts` event exists.
- `packages/core/src/entities.ts:756` `setSessionWorktree` -- the only writer; already refuses mid-turn, remote, non-chat.
- `packages/core/src/vcs-port.ts:299` `VcsChatWorktreePort.moveChanges` -- change `from`/`to` to `VcsFolder` (a worktree needs its pin) and add `snapshots {from, to}` to `VcsMoveChanges`; `VcsPort.addWorktree` gains `existingBranch?: boolean` (`git worktree add <path> <branch>`).
- `packages/core/src/where-work-runs.ts` -- `ChatLocations` interface (unknown inputs). New `packages/core/src/chat/location.ts` (pattern `chat/handoff.ts`: `switching.add`, `releaseAgent`, `storedAgentSessionId`; `chat/delete-chat.ts`: `isChatWorktreePath`, merged-branch removal, `onWorktreeCleanupError`; `chat/workspaces.ts:184` `makeChatWorktree`: extract a variant taking the session id; `workspace-changes.ts:119` folder-busy check). Expose `chat.chatLocation`/`chat.moveChat` in `chat/types.ts`, `chat.ts`; `ChatOptions.vcsChatWorktree?: Pick<VcsChatWorktreePort,'moveChanges'>`, `vcs` Pick widened with `branchRevision`, `onHandOffSnapshot?`. A `createChatLocations(chat)` parsing ids and the body (new `core/src/chat-locations.ts`), exported from `index.ts`.
- `packages/adapters/src/vcs-git/working-tree.ts` -- add `moveChanges` to `createGitWorkingTree`'s object (reuses `locate`, `storeOf`, `tempIndex`, `storeEnv`, snapshot logic); `vcs-git/index.ts:314` `addWorktree` `existingBranch`; `vcs-memory/index.ts:136` and `chat-worktree.ts` mirror.
- `packages/server/src/start.ts:394-430` -- give chat `vcsChatWorktree` (an option override `vcsChatWorktreePort` for tests, else the git working tree), log `onHandOffSnapshot`; pass `chatLocations: createChatLocations(chat)` to `createApp` (`app.ts:186` already takes it; routes in `where-work-runs-routes.ts` already map errors).
- Web: `chat/setup-row.tsx` `LocationChip` (started: one hand-off item with its line, disabled with reason), new `chat/hand-off-dialog.tsx` (AlertDialog pattern `delete-chat-dialog.tsx`; on 409 shows `handOffConflictText(details.files)` or `handOffMidTurnText`), `chat/chat-api.ts` `handOffChat`, `routes/session-page.tsx:874` (reason from `handoffBlocked` logic, refetch session on `session.location_changed`), `chat/transcript.ts` item `location_changed`, `chat/transcript-parts.tsx` `LocationChangedMarker` (as `AgentChangedMarker`), `workspaces/workspace-api.ts` sessions list follows the branch.
- Folder hold (loop 1): `packages/core/src/chat/context.ts` (the shared sets `busy`, `switching`), refused in `chat/turns.ts:352` `sendMessage`, `chat/send-now.ts:36`, and `chat/terminal.ts` `switchDriver`, beside their `switching` checks; `SessionNotIdleError` (`errors.ts`). Modes: `vcs-git/working-tree.ts` `applyPatch` keeps a file's mode (`chmodSync`) as the pattern. Link copy: `isRealFolder` (`build-worktrees.ts`).
- Tests: core (`packages/core/test`, memory VCS fakes; 27.3 delete-chat tests pattern), adapter (`packages/adapters/test/vcs-git*.test.ts` real git fixtures), server (`packages/server/test/where-work-runs-routes.test.ts`, worktree chat fixtures from 27.3, fake agent `write-file`), web dom, e2e `tests/e2e/worktree-chat.spec.ts` (`withChatServer`, axe, 390px).

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/vcs-port.ts`, `adapters/src/vcs-memory/*` -- contract changes above; memory mirror.
- [x] `packages/adapters/src/vcs-git/working-tree.ts`, `index.ts` -- `moveChanges` (Design Notes) and `existingBranch`.
- [x] `packages/core/src/chat/location.ts`, `chat/workspaces.ts`, `chat/types.ts`, `chat.ts`, `chat-locations.ts`, `index.ts` -- the use-case.
- [x] `packages/shared/src/where-work-runs.ts` -- texts.
- [x] `packages/server/src/start.ts` -- wiring.
- [x] Web files above -- chip item, dialog, divider, refetch.
- [x] Pass-1 review rows 5 to 12 (Review Triage Log), each with a test: modes kept (0600 tracked and untracked), partly staged file keeps its staged version, read-only folder and git timeout (a wrapper with a small `timeoutMs`) lose nothing and carry the snapshot ids, forward apply failing partway rolls back, an undeletable file is `leftBehind` not moved, a link copy refused, thousands of long paths unstaged, a send and a terminal switch to another project-folder chat refused during a held move, the two new texts.
- [x] Tests: every matrix row in core; adapter round trip (edit, untracked, staged, binary, CRLF untouched), overlap, base moved, source dirtied mid-move, filter/hook never runs, only the two folders written; server route round trip with the fake agent's cwd; web dom (chip item and reason, dialog texts, divider); e2e: move a chat to its worktree and back with an edit intact.

**Acceptance Criteria:**
- Given a fixture chat with an uncommitted edit, when it is handed to its worktree and back, then the edit is intact both times and the transcript shows both dividers.
- Given a hand-off asked mid-turn, then it is refused with `agent_mid_turn` and nothing moved.
- Given `pnpm typecheck` and `pnpm test`, then both pass.

## Implementation Notes

- `ChatOptions.vcs` takes `branchRevision` as an optional extra (`Partial<Pick<VcsPort,'branchRevision'>>`), so existing harnesses and the parallel lanes' fakes need no change; without it a hand-off to a worktree always makes a new branch.
- `createGitWorkingTree` now returns `GitWorkingTree` (`VcsWorkingTreePort & Pick<VcsChatWorktreePort,'moveChanges'>`); the server's hand-off git is a second instance (`createServerChatWorktree`, overridable with `StartOptions.vcsChatWorktreePort`).
- A move refuses the whole hand-off (plain 409 `invalid_operation`, `HANDOFF_FAILED_TEXT`) when a moved path is a submodule or not a plain file (a symbolic link included), or either folder is not its repository's top folder.
- This chat terminal-driven is 409 `invalid_operation` (matrix); another local chat in the project folder terminal-driven is 409 `agent_mid_turn` (Boundaries).
- Web: `ChatApiError` carries `details` (for `handoff_conflict`'s `files`); the sessions list is read again on `session.location_changed`.
- Server test in its own file `packages/server/test/chat-hand-off.test.ts` (real git, fake agent); `where-work-runs-routes.test.ts` now expects the Location routes wired (404 for an unknown chat).

- Loop 1 (re-derived from the pass-1 patch): the target is never undone once applied; the source is cleaned best effort and checked (`leftBehind`); a forward-apply failure tries only a checked `apply -R` and reports `targetClean`; snapshot ids ride on every answer and every thrown `VcsError`; the folder hold is `chat/folder-hold.ts` (sends, send-now, terminal switch and Continue with another agent of any chat whose folder is the held one or inside it refuse with "This chat's folder is being moved. Try again in a moment.").
- Pass 2 fixes: a hand-off is refused, nothing moved, without a readable branch lookup (supersedes the first note: no `branchRevision`, no hand-off to a worktree), during a merge, rebase, cherry-pick or revert or with unresolved entries, with assume-unchanged or skip-worktree entries, for text that isn't UTF-8, for a path holding a line break, and when git would change a moved file's bytes (raw `hash-object --no-filters` against the snapshot blob before writing, and on the target after; `* text=auto` with LF files and CRLF already in the index move unchanged). Copies' branches are deleted only merged; exact modes are kept (`core.fileMode=false` too); only paths that left are unstaged, intent-to-add entries cleared.
- A git timeout before the forward write counts as possibly written: that new copy is left and reported, not removed. Leftovers are logged through `onWorktreeCleanupError` ("a chat worktree was left in place"), even when they are in the project folder.
- Verified (after pass 2, 2026-11-01, load ~22): `pnpm typecheck` clean; `pnpm test` 466 files, 6055 passed, 13 skipped; after `pnpm run build`, Playwright worktree-chat and composer-setup-row 4 of 4 (the hand-off spec checks axe and 390px); provenance check passed.

## Plan Change Log

- Loop 1 (2026-11-01, review pass 1, findings 1 to 4 and 8): the Design Notes told the adapter to undo the target and throw when the source revert failed. The defensive lens showed with real git that `git apply` writes file by file: a source `-R` that fails partway (E7), or a git timeout that rejects before the undo (E10, then core removed the copy holding the changes), loses uncommitted work, and an ignored undo result leaves both folders changed under "nothing moved". Amended: Design Notes (once the target applied, it is never undone; the source is cleaned best effort and checked; leftovers are reported, never thrown; a forward-apply failure is rolled back with its result checked; snapshot ids travel on every outcome and every throw; modes kept; index entries that differ from the snapshot kept; unstage chunked), Code Map and Tasks (a folder hold that refuses sends and terminal switches to other chats in the project folder for the move's length; the copy refused when it is a link; no move back of the whole project folder after a row-write failure; place-specific conflict and busy words). Known-bad state avoided: a hand-off error path that deletes or half-reverts the only copy of a change. KEEP: everything else of pass 1. Start by applying `/private/tmp/claude-501/-Users-harrisonsmith-Documents-GitHub-ogden-aiagents/ba73160c-7998-4d32-a639-beae2f2ad1ca/scratchpad/27.4-pass1-keep.patch` with `git apply` (it is the whole pass-1 code: ports, memory fakes, `existingBranch`, `chat/location.ts`, `chat-locations.ts`, wiring, the web chip item, dialog, divider, refetch, and every test), then change only what the amended Design Notes and the review rows below require; keep its tests, adding the new rows.

## Review Triage Log

Pass 1 (2026-11-01; lenses: quick, and defensive (a fresh subagent given only the diff, trying to make a hand-off lose or overwrite uncommitted work, run mid-turn, or touch anything beyond the project folder and the chat's `<data>/cw` copy; it ran real-git experiments). Verdicts: high 4, medium 8, low 4, false 0, maybe-false 0. Routed bad_plan (1 to 4, 8; loopback 1); 5 to 7 and 9 to 12 patched in the re-derivation; 13 to 15 deferred; 16 rejected.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | Source `-R` that fails partway (read-only folder, tracked deletion): the target is undone, the edit survives only in an unlogged snapshot ("nothing moved") | high | bad_plan | defensive E7 reproduced with the adapter; the plan's own "undo the target and throw" |
| 2 | Git timeout or kill during the source `-R`: `run` rejects, the undo is skipped, `toWorktree` removes the copy that holds the changes | high | bad_plan | defensive E10: the tracked edit and the untracked file both gone; `runner.ts:109`, `location.ts` catch |
| 3 | Undo result ignored; a forward apply that fails partway leaves the target half-written as `conflict`; `-R` that can't delete a file exits 0 and reports `moved` | high | bad_plan | quick 2; defensive E4, E4b; no check of either folder afterwards |
| 4 | Snapshot ids logged only on a normal return, so the failure paths where the store is the only copy log nothing | medium | bad_plan | `logSnapshots` after `moveChanges` only; `VcsError` carries none; `moveBack` drops them |
| 5 | Permission bits reset to 644 in both folders (a 0600 `.env` becomes world-readable) | high | patch | defensive E2; `applyToFolder` lacks the hunk path's mode restore |
| 6 | Partly staged file (index B, folder C): `unstage` drops B | medium | patch | defensive E1, B only in `fsck --unreachable`; keep index entries that differ from the snapshot |
| 7 | Moving back after a row-write failure runs `moveChanges` from the whole project folder, carrying the user's unrelated edits into the copy | medium | patch | quick 1; `toThisFolder` catch; leave both and report instead |
| 8 | Other project-folder chats can start a turn (or switch to the terminal) during the move; their writes are swept in or make the source check fail | high | bad_plan | quick 4, defensive G2; only this chat is in `switching`; turn snapshot waits only 10 s |
| 9 | A link at `<data>/cw/<8>` is not refused (`isChatWorktreePath` checks the parent only) | medium | patch | defensive G3; add `isRealFolder` on the row's path |
| 10 | `unstage` passes every path on one command line (E2BIG swallowed), `update-index` exit unchecked: moved content stays staged in the project | medium | patch | defensive G3; chunk and check |
| 11 | To a worktree, a conflict says "This folder has its own changes", but the clash is in the copy's branch | low | patch | quick 5; dialog ignores `to`; one text |
| 12 | `agent_mid_turn` from another chat in the folder shows this chat's agent name | low | patch | quick 6; one neutral text |
| 13 | Moving back removes ignored and assume-unchanged files in the copy (`.env`) | medium | defer | same root as 27.3 deferred review 13 (ignored files not counted); needs an ignored-files read in `VcsWorkingTreePort` |
| 14 | Agent CLIs in Developer-mode terminal panes in the project folder aren't counted as working there | medium | defer | pre-existing: Workbench hunk actions and Commit ignore panes the same way (8.5) |
| 15 | Filter driver (git-lfs) changes always report a false conflict; a copy left behind keeps the branch checked out so the next move fails with the generic sentence | medium | defer | no loss either way; LFS needs smudged apply, the orphan needs the 27.3 cleanup the sweep owns |
| 16 | Conflict count forced to 1 when the cause isn't a file difference; tiny window between `readsClean` and removal | low | reject | rare, words only / milliseconds; the same window exists in Delete chat |

Pass 2 (2026-11-01, after loop 1; lenses: quick and defensive, fresh subagents given only the diff; defensive ran real-git experiments). Verdicts: high 5, medium 9, low 4, false 0, maybe-false 0. No intent_gap or bad_plan (each fix local to the adapter or core checks): 12 patched, 5 deferred, 2 rejected.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | `branchRevision` absent or rejecting: `kept` false, `addWorktree -b` fails, cleanup `branch -D` deletes the kept branch and its commits | high | patch | quick 1, defensive e3 reproduced; refused without a branch lookup, and hand-off cleanup deletes a branch only `mergedOnly` + `keepUnmerged` |
| 2 | Forward-apply rollback restores the target to its snapshot, erasing a concurrent user edit, and reports `targetClean: true` (copy then removed) | high | patch | defensive e2/e2b; snapshot-restore step dropped, `targetClean` only after a checked `-R` |
| 3 | Non-UTF-8 text corrupted (runner decodes stdout as UTF-8) | high | patch | defensive e1 (`e9` became `EF BF BD`); refused when the patch holds U+FFFD |
| 4 | Line endings normalized (CRLF index + `text=auto`; mixed endings with `autocrlf=true`) | high | patch | defensive e6/e6b; refused when eol conversion applies |
| 5 | Exec bits lost with `core.fileMode=false`; setuid dropped | medium | patch | defensive e8; exact source mode set on the target |
| 6 | Merge/rebase in progress split from its resolution | medium | patch | quick 2, defensive e9; refused in either folder |
| 7 | `assume-unchanged`/`skip-worktree` edits never moved and lost with the copy | medium | patch | defensive e10; refused when either index has such entries |
| 8 | `unstage` runs when the source revert failed (staging lost); intent-to-add entry left (` D new.txt`) | medium | patch | quick 3, defensive e5; only paths that left, absent i-t-a entries removed |
| 9 | A project in a subfolder of the same repo isn't checked or held | medium | patch | defensive G2 by reading `location.ts:127`, `folder-hold.ts:21`; covered by folder containment |
| 10 | Switching another chat's agent during the hold commits the switch, then the send fails | medium | patch | defensive G2, `handoff.ts:164`; refused in `checkNow` |
| 11 | The moving chat gets "switching to or from the terminal" | low | patch | quick 6; hold checked first |
| 12 | Test header contradicts the test (target put back) | low | patch | quick 4; reworded |
| 13 | Ignored files in the copy (`.env`) deleted on moving back | medium | defer | carried from pass 1 row 13; a product call (node_modules in every copy); settled 2026-11-01 by the user's decision (Decisions after the build) |
| 14 | Terminal panes and idle chats' background processes in the project folder not held | medium | defer | carried from pass 1 row 14; 27.3 deferred 15 |
| 15 | Crash between the apply and the row write orphans the changes in an unreferenced copy, snapshot ids unlogged; a left-behind copy keeps the branch checked out so the next move fails | medium | defer | needs startup reconciliation of `<data>/cw`; 27.3 deferred the same orphan |
| 16 | Orchestration dispatch, planning or retrospective start during the hold fails its step or leaves an empty session | medium | defer | a dispatch must land in a seconds-long window; needs those callers to wait on the hold |
| 17 | Filter (git-lfs) edits always a false conflict | medium | defer | carried from pass 1 row 15 |
| 18 | Move uses the destructive confirm style | low | reject | `AlertDialogConfirm` is destructive app-wide; a variant prop is new surface for a style |
| 19 | Conflict count forced to 1 | low | reject | carried from pass 1 row 16 |

## Decisions after the build

- Decision (2026-11-01, user): ignored files in a removed copy. Removing a chat's worktree copy loses its ignored files (git doesn't keep them), so Move to this folder and Delete chat list them in their confirmation, names only, so the user can copy anything first; retention's put-away keeps saying plainly in Settings that ignored files aren't kept. The list skips rebuildable folders (node_modules, dist, build, out, target, .next, .turbo, .cache, coverage, __pycache__, .venv, venv, vendor/bundle and similar; one shared constant, `REBUILDABLE_IGNORED_FOLDERS`) and is capped (the first 20 names, then "and N more"). It is read through git (`VcsWorkingTreePort.ignoredFiles`: `git status --ignored=matching`, an ignored folder as one entry), never a shell, never a file's contents; a list that can't be read says so. Settles review 13 (pass 1 and 2) and 27.3 review 13 for ignored files; assume-unchanged entries still refuse a hand-off before anything moves.

## Deferred (for the sweep)

- Agent CLIs in Developer-mode terminal panes in the project folder are not counted as working there, so a hand-off can run beside one (review 14). 27.9: logged in `deferred-work.md`.
- A server crash between a hand-off's apply and its row write leaves the changes in a copy no row names, with the snapshot ids unlogged; a copy left behind keeps its branch checked out, so the next move to a worktree fails (pass 2 row 15). 27.9: logged in `deferred-work.md`.
- An orchestration dispatch, planning or retrospective start that lands during a hand-off's folder hold fails its step or leaves an empty session (pass 2 row 16). 27.9: logged in `deferred-work.md`.
- Changes under a clean/smudge filter (git-lfs) can't be handed off (a false `handoff_conflict`); a copy left behind after moving back keeps the branch checked out, so the next move to a worktree fails with the generic sentence (review 15). 27.9: logged in `deferred-work.md`.

## Design Notes

`moveChanges(repo, {from, to})` (git): locate both (a copy must be a real folder, never a link); snapshot both (8.4's temp index + store) before anything else; `H` = `from` HEAD tree, `T` = its snapshot; moved = `diff-tree -r` `H..T` (a gitlink or a path the 8.5 `plainPath` check refuses: VcsError); `to`'s own changes = its HEAD tree vs its snapshot; overlap → `conflict` (count). Record each moved file's mode in both folders. Patch = `diff --binary --full-index --no-renames H T` (store as alternate).

Forward: `apply --check` in `to`; a failed check → `conflict` (nothing written). The apply itself is wrapped (a non-zero exit or a throw/timeout): on failure, `apply -R` the target, its result checked, then throw `VcsError` with `details.snapshots` and `details.targetClean` (whether the target reads as before); the source is untouched either way.

Once the target applied, it is never undone: the changes are safe there. The source is then cleaned best effort (`apply -R --check`, then `apply -R`, a throw caught), modes restored in both folders (a file kept 0600 stays so), and the result is checked by snapshotting the source again: moved paths still differing from `H` are `leftBehind` (a count; the move still answers `moved`, never throws). Index: only moved paths whose index entry equals the snapshot's go back to HEAD's (`ls-tree` into `update-index --index-info`, chunked, exit checked, best effort); an entry that differs (partly staged) is kept. `VcsMoveChanges` gains `leftBehind: number`; every answer and every thrown `VcsError` carries `snapshots`.

Core order: checks; chain; checks again; `switching.add` and a folder hold (`ctx` set of folders a hand-off holds: `sendMessage`, send-now and the terminal switch of any chat whose `sessionFolder` is held refuse with a plain "This chat's folder is being moved. Try again in a moment.", `SessionNotIdleError`); `releaseAgent`; to worktree: make the copy (`existingBranch` when `branchRevision` finds it), move, `setSessionWorktree`; back: move, `setSessionWorktree`, then remove the copy only if it reads clean (`leftBehind` 0 and `vcsWorkingTree.changedFiles` empty), else leave and report. A conflict, or a throw whose `details.targetClean` is not false, after a copy was made removes it (branch deleted only if new); a throw with `targetClean: false` in `toWorktree` leaves the copy and reports (the source still has everything, so nothing is lost; nothing is deleted that may hold work). After a row-write failure: to worktree, move the copy's changes back (the copy holds only the moved ones); back, never move the project folder into the copy: leave both and report. Snapshot ids go to `onHandOffSnapshot` on every outcome and from a thrown error's details. Words: a conflict when moving to a worktree uses a new `handOffWorktreeConflictText(files)` ("This chat's branch changed {n} of the same files since, so its changes can't go there. Commit or set them aside first, then move."); a 409 `agent_mid_turn` the dialog didn't foresee uses a new `HANDOFF_FOLDER_BUSY_TEXT` ("Move once the agents working in this folder have finished.").

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors
- `pnpm test` -- expected: all pass (timing failures re-run alone)
- `pnpm run build && pnpm exec playwright test tests/e2e/worktree-chat.spec.ts tests/e2e/composer-setup-row.spec.ts` -- expected: pass
- `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs` -- expected: pass
