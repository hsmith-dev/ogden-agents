---
title: 'Hunk stage, unstage and revert; refused mid-turn'
type: 'feature'
ticket: '5'
created: '2026-11-01'
status: 'built'
baseline_revision: '9a2d544382b264aac548ad75363b6d22fd7c158c'
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

**Problem:** 8.4's Changes panel shows This turn, Unstaged, Staged and Branch, but the git adapter has no `applyHunk`, so `POST …/changes/hunks` answers 501 and a user can't stage, unstage or revert the change an agent made (E8-R5, AD-37, CAP-34's "revert one hunk").

**Approach:** `applyHunk` in `vcs-git/working-tree.ts`: take the file's diff in the view exactly as git prints it, pick the hunk by its id (the whole file only when the request names every hunk id shown), and `git apply` it (`--cached` to stage, `--cached -R` to unstage, `-R` to the folder to revert) with every 8.4 protection; core runs it under `serializedByRepo` with the mid-turn check inside; the Changes panel gets the per-view hunk and file buttons, Revert's one confirmation, the mid-turn and outdated states, and an Undo for a revert while the panel is open.

## Boundaries & Constraints

**Always:** git only through the 8.4 runner (argument arrays, allowlisted env, empty `core.hooksPath`, `core.fsmonitor=false`, filter drivers blanked, no fetch, no split index, the git-pointer check, a worktree only with Ogden's pinned folders); the patch is git's own diff of that one path, rebuilt with only its `diff --git`, `new file mode`/`deleted file mode`, `---`, `+++` and the chosen `@@` hunks, and refused unless every header path is the requested path; `git apply` with `--whitespace=nowarn`, `apply.ignoreWhitespace=no`, no fuzz, `--check` first, all or nothing; only regular files (modes 100644/100755 or absent) and a path whose every folder is a real folder in the view's folder; refused (409 `agent_mid_turn`) when a chat in the same folder is `working` or `waiting`, checked inside `serializedByRepo(<project folder>)`; a hunk id not in the file's current diff (or a whole-file request whose ids differ from the current ones) is 409 `hunk_outdated` and nothing is written; revert writes the folder only, never the index; no em or en dashes in UI strings; `{error:{code,message}}`; no diff, patch or path in an event or a log.

**Never:** a shell, `git checkout`/`restore`/`reset` of a path, `--3way`, `--unidiff-zero`, `--reject`, hunks of a binary, too large, symlink or submodule file; Branch actions; line comments (8.6); Open in editor (8.10); a patch or file content sent by the client; editing `deferred-work.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Stage one hunk | file with 2 unstaged hunks, stage the 2nd | index has only that hunk; Unstaged keeps the 1st; folder file unchanged | none |
| Unstage | a staged file with 2 hunks, unstage one | Staged keeps the other; folder unchanged | none |
| Revert Unstaged | revert the 1st of 2 hunks | folder file loses only that hunk; index unchanged | none |
| Revert This turn | turn added 2 hunks, revert one | only that hunk goes back; the other stays | edited since in that hunk: 409 `hunk_outdated`, file untouched |
| New / deleted file | untracked file: Stage; This turn deleted file: Revert | staged as added; the file comes back | file recreated since: 409 `hunk_outdated` |
| Whole file | no `hunkId`, `hunkIds` the shown ids | every hunk applied | ids differ from now: 409 `hunk_outdated` |
| Stale id | Unstaged hunk id after the file changed | nothing written | 409 `hunk_outdated` |
| Mid-turn | a chat `working` in the same folder (project or its worktree) | nothing written; a chat in another worktree doesn't block | 409 `agent_mid_turn` |
| Undo | revert, then Undo with its id | the hunk is back; a second Undo, another folder or path, or an edited file | 409 `hunk_outdated` / 404 |
| Unsupported | binary, symlink, submodule, a link folder on the path | nothing written | 409 `invalid_operation` |
| Containment | `../x`, `.git/config`, `.env` revert, absolute path, a `.gitattributes` filter, a repo hook | refused or nothing run; nothing outside the folder written | 400 / 403 |

</frozen-after-approval>

## Code Map

Project root is the worktree `/Users/harrisonsmith/Library/Caches/ogden-agents-dev-worktrees/8.5`; never `git stash`, push or switch branches.

- `packages/shared/src/workbench-changes.ts` -- `HunkActionRequest` gains `hunkIds` (required when `hunkId` is absent, 1..1000); `HunkActionResponse` gains `undo?: UndoId` (revert only); new `UndoHunkRequest {undo, path, view, session?}`, `UndoId` (32 hex); texts (Design Notes). `api.ts` new `workspaceChangesHunksUndo` (`POST …/changes/hunks/undo`).
- `packages/core/src/vcs-port.ts` -- `VcsHunkResult` becomes `{outcome:'applied'; undo?} | {outcome:'outdated'|'not_found'|'unsupported'}`; `applyHunk` input gains `hunkIds?`; new optional `undoRevert(folder, {undo, path})`. Update `vcs-memory/working-tree.ts` and its users (`core/test/workbench-contracts.test.ts`, `adapters/test/workbench-adapters.test.ts`).
- `packages/core/src/workspace-changes.ts` `hunk` -- serialize under `serializedByRepo(workspaceFolder(workspace))`, `refuseMidTurn` inside; outcomes to errors (`unsupported` → `InvalidOperationError(HUNK_UNSUPPORTED_MESSAGE)`, `outdated` → `HunkOutdatedError` with the view's text); new `undo(workspaceId, body)` the same way. `HunkOutdatedError` message per view; `server/src/workspace-files-routes.ts` `workbenchRefusal` uses the error's own message for `hunk_outdated`.
- `packages/adapters/src/vcs-git/working-tree.ts` -- reuse `locate`, `viewSpec`, `listed`, `parseHunks`, `DIFF`, `located.flags`, `checkRelative`; `parseListing` keeps modes; new `applyHunk`, `undoRevert`; undo store in memory (Design Notes). `patch.ts` `headerPaths` for the header check.
- `packages/server/src/workbench-routes.ts` -- the undo route (501 without `undo`); `test/gate.test.ts` `EXPECTED_API_ROUTES`, `bmad-guard-coverage.test.ts`, `tests/architecture.test.ts` ~1106 route list.
- `packages/web/src/workbench/workbench-changes.tsx`, `changes-api.ts` -- `useHunkAction`, `useUndoRevert` (invalidate `['workspace-changes', wsId]`); `DiffViewer` `hunkActions`/`fileActions` slots (`ui/diff/diff-file.tsx` `hunkRangeText`); `AlertDialog` as `shell/quit-button.tsx`; `useSessions` (`workspaces/workspace-api.ts`) and `agentNameOf`/`useChatAgents` (`chat/chat-api.ts`) for the busy state.
- Tests: `packages/adapters/test/vcs-git-working-tree.test.ts` (fixture repo helpers), `packages/server/test/workbench-changes.test.ts` (fake agent, real server), `packages/web/test/workbench-changes.dom.test.tsx`, `tests/e2e/workbench-changes.spec.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/workbench-changes.ts`, `api.ts` -- request and response fields, undo contract and route, texts.
- [x] `packages/core/src/vcs-port.ts`, `workspace-changes.ts`, `errors.ts`, `vcs-memory/working-tree.ts` -- outcomes, serialization, undo use-case.
- [x] `packages/adapters/src/vcs-git/working-tree.ts` -- `applyHunk`, `undoRevert`, header and mode checks, link-folder check.
- [x] `packages/server/src/workbench-routes.ts`, `workspace-files-routes.ts` -- undo route, outdated message.
- [x] `packages/web/src/workbench/workbench-changes.tsx`, `changes-api.ts` -- buttons, confirmation, busy, outdated and started-here notices, Undo.
- [x] Tests: every matrix row on real git fixtures in `vcs-git-working-tree.test.ts` (plus a project in a repo's subfolder, a chat worktree, `.gitattributes` filter marker not run, pre-commit/post-index-change hooks not run, a symlinked folder on the path, `core.quotePath` paths, the repo's other files byte for byte unchanged); core contracts test (serialization, mid-turn inside the lock, per-view outdated text); server test (fake agent mid-turn refusal with its code, stage then revert on a real repo, undo); dom test (buttons per view, confirm, disabled busy, 409 notices, Undo); e2e (revert one hunk of a fake turn with confirm and Undo, axe, 390px); gate and architecture lists.

**Acceptance Criteria:**
- Given a fixture repo file with two hunks, when one is staged and the other reverted, then the index holds only the first, the folder only lacks the second, and the other files are byte for byte unchanged.
- Given a fake agent mid-turn in the project folder, when a hunk action or undo is posted, then it answers 409 `agent_mid_turn` and nothing changes.
- Given the change, when `pnpm typecheck`, `pnpm test` and the touched e2e specs run, then they pass.

## Implementation Notes

- `git apply` run in a subfolder of the repo skips a patch whose paths are relative to that subfolder unless the patch carries an `index` line (seen on git 2.54), and still exits 0. The adapter passes `--directory=<rev-parse --show-prefix>` and runs `--check --verbose` first, refusing (VcsError, nothing written) when git says it skipped the patch.
- Hunk ids are `h<n>-<sha>`: once one hunk of a file is staged or reverted, the others' ordinals shift, so their old ids are `hunk_outdated` until the diff is read again (the panel reads every view again after each action).
- A hunk or whole-file action on a file the view no longer lists is `outdated` (the change shown is gone), not `not_found`; `not_found` is only a folder in no repository, or an undo that is gone, used, or of another folder or path (404).
- An undo that no longer applies (the file edited where the lines go back) answers 409 `hunk_outdated` with `UNDO_OUTDATED_TEXT` and is kept, so it can be tried again once the edit is undone; a successful one is forgotten.
- `UndoHunkRequest.view` must offer Revert (This turn or Unstaged); the answer's file is that view's (This turn: the latest turn).
- `.env` is not a refused name for the Workbench (8.1 masks its values in the viewer only), so it is staged and reverted like any file; the test proves only that file is written and no filter or hook runs.
- The diff viewer's file actions slot now renders no wrapper when a file has no actions (binary, too large), so the chevron keeps its place.

## Plan Change Log

## Review Triage Log

Pass 1 (2026-11-01; lenses: quick, security). Verdicts: high 1, medium 6, low 6, false 0, maybe-false 0. No intent_gap or bad_plan; 9 patched, 4 deferred.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | This turn revert lands on another identical copy of the block after the user edited the file (`git apply` offsets) | high | patch | security reviewer reproduced on duplicate 8-line blocks; revert now needs each hunk's new-side block exactly once in the file |
| 2 | Undo applies after edits elsewhere, at an offset, and from another view | medium | patch | reproduced (line 18 written at 20); undo bound to the file's sha256 after the revert and to its view |
| 3 | macOS case collision: Revert of `notes.txt` overwrote and renamed `Notes.txt` | medium | patch | reproduced; each existing segment's exact name must be in its parent's listing |
| 4 | Revert recreates the file with the index mode (0600 `.env` becomes 0644) | medium | patch | reproduced; permission bits restored after the write |
| 5 | Repo `protocol.ext.allow=always` overrides `protocol.allow=never` | low | patch | only `GIT_NO_LAZY_FETCH` stopped it; every protocol set to never |
| 6 | A path containing " b/" is refused as unsupported (`headerPaths` splits at the first " b/") | medium | patch | reproduced on `x b/l.txt`; headers checked exactly against the path |
| 7 | This turn's reverted hunk keeps its Revert and a second click says "Changed again" | medium | patch | the snapshots never change; the panel marks reverted hunks and drops the whole-file Revert |
| 8 | EXPERIENCE.md still says "Ogden can't undo this." | low | patch | lines 169 and 380 updated with the Undo |
| 9 | No core test that a chat in another worktree doesn't block | low | patch | added |
| 10 | Repo `core.autocrlf`, `.gitattributes` `eol`/`ident`/`working-tree-encoding` rewrite the whole file on revert | medium | defer | git's own checkout semantics on a file already out of step with its config; nothing outside the file is written |
| 11 | A hunk action longer than 10 s lets a new turn's prompt start (its start snapshot stops waiting) | medium | defer | needs the turn to wait for an in-flight hunk action, a turns.ts change |
| 12 | Projects `repo` and `repo/src` don't block each other; terminal-pane agents aren't checked | medium | defer | pre-existing `refuseMidTurn` design (8.2) |
| 13 | An empty new file or a mode-only change has no hunk, so it can't be staged or reverted | low | defer | git prints no `@@`; needs a header-only patch path |

## Deferred (for the sweep)

- Revert follows the repo's `core.autocrlf` and `.gitattributes` `eol`, `ident` and `working-tree-encoding`, so a file out of step with them is rewritten whole (review #10). Writing the result blob ourselves with no conversion would fix it but breaks CRLF checkouts.
- A hunk action taking over 10 s lets a new turn's prompt go out while it writes, since the start snapshot stops waiting for the repo lock (review #11).
- Overlapping projects (`repo` and `repo/src`) don't block each other mid-turn, and terminal-pane agents aren't checked (review #12).
- An empty new file or a mode-only change can't be staged or reverted: git prints no hunk (review #13).

## Design Notes

Patch (adapter): `git diff --no-ext-diff --no-textconv --no-color --no-renames --relative --unified=3 --src-prefix=a/ --dst-prefix=b/ -c core.quotePath=false -c diff.suppressBlankEmpty=false` of the one path in the view's spec (the same output the viewer's ids came from; `--unified=3` and the prefixes are added to `DIFF` so both match), split at `@@` lines; ids recomputed by `parseHunks`. Stage: `apply --cached` (real index, Unstaged's temp index only for reading); unstage: `apply --cached -R`; revert: `apply -R` with the folder's own env, no `GIT_INDEX_FILE`. Patch goes to stdin. This turn revert of a file the folder no longer matches fails `--check` → outdated.

Undo (decision, autonomous 2026-11-01, the orchestrator's "undoable where cheap"): a revert keeps its patch in the adapter's memory under a random `UndoId`, bound to the folder (path, worktree) and path, for 30 minutes, at most 50 kept; `undoRevert` forward-applies it with `--check` first, then forgets it. Lost on server restart. So the confirmation reads "Revert this change? These lines go back to how they were. You can undo it right after, while Changes is open." instead of EXPERIENCE.md's "Ogden can't undo this." After a revert the panel shows "Reverted lines 40 to 46 in cart.css." with **Undo**; after Undo "Put back." Stage and unstage need no undo (the other view's button).

Busy (UI): the panel's folder is the chat's `worktreePath`, else the project; actions are disabled with `agentMidTurnText(<agent>)` while a non-build, local session with the same `worktreePath` is `working` or `waiting` (`useSessions`). 409 `agent_mid_turn` shows `agentStartedHereText(<agent>)`; 409 `hunk_outdated` shows the view's text and the diffs are read again.

Texts: `HUNK_OUTDATED_TEXT` (This turn, kept); `HUNK_CHANGED_SINCE_TEXT` "This change was edited since it was shown, so nothing was changed. Here it is as it is now."; `HUNK_UNSUPPORTED_MESSAGE` "Ogden can only stage or revert lines of a plain text file."; buttons Stage, Unstage, Revert, named "Stage lines 40 to 46" and "Revert all of cart.css".

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors
- `pnpm test` -- expected: all pass (wait for `uptime` load below 40; re-run timing failures alone)
- `pnpm run build && pnpm exec playwright test tests/e2e/workbench-changes.spec.ts` -- expected: pass (axe, 390px)
- `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs` -- expected: pass

**Results (after review fixes, 2026-11-01):** `pnpm typecheck` clean; `pnpm test` 5701 passed, 13 skipped (436 files) at load 40; after `pnpm run build`, `workbench-changes`, `diff-viewer` and `workbench-files` e2e 6 of 6 (axe at 390px in the revert and Undo spec); provenance check passed.
