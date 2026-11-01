---
title: 'Worktree retention and Restore; snapshot store cleanup'
type: 'feature'
ticket: '6'
created: '2026-11-01'
status: 'built'
baseline_revision: '73bba3c169ab0b27cfb2419ae89ffcdbf61dc81d'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'defensive']
review_loop_iteration: 0
context: ['{project-root}/AGENTS.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Chat worktrees pile up in `<data>/cw` with no cap, and nothing puts one away or brings it back (E27-R5; CAP-35; AD-17 CAP-33 note's exception, AD-37); 27.2's retention routes answer 501. 8.4's snapshot store under `<data>/snapshots` is never cleaned and keeps full copies of non-ignored files (`.env` included) for deleted chats and every turn ever (8.4 review #15).

**Approach:** The install's cap (Settings, Projects, Worktrees: "Keep the last N worktrees", default 15, 1 to 100, counted over every project's chat worktrees). Beyond it the oldest idle chat worktree is put away: its agent stopped, its uncommitted and untracked work snapshotted into AD-37's store, a put-away record written, then its folder removed through 27.3's `VcsPort.removeWorktree` guards, branch kept. The chat reads "This chat's copy was put away to save space." with Restore and a disabled composer; Workspace settings lists put-away copies with Restore each. Restore recreates the worktree on its branch with the saved changes, refusing plainly when the branch is gone, has moved, or the path is taken. A snapshot cleanup removes store objects no turn (within a bound) or put-away record references.

**Decisions (user, 2026-11-01):** beyond the cap the oldest IDLE chat worktree is snapshotted with its uncommitted changes and removed automatically, never while an agent works in it; Restore brings it back; the cap is set in Settings. **Autonomous (27.2's call, kept):** one install-wide cap, not per project.

## Boundaries & Constraints

**Always:** never remove a copy without a snapshot first (a failed or refused snapshot removes nothing); never put away or restore a chat that is `working`, `waiting`, busy, switching or terminal-driven (`agent_mid_turn`), and no message starts while one is being put away or is put away; put-away refuses (and the sweep skips) a copy whose HEAD isn't its branch, with an operation in progress (merge, rebase, cherry-pick, revert) or with a submodule or nested repo (gitlink) in its snapshot; removal only through `VcsPort.removeWorktree` (27.3's checks) of a path `isChatWorktreePath` accepts, never deleting the branch; cleanup deletes only regular files and empty folders under a real `<data>/snapshots` (never through a link) and never a store it cannot map to a project unless every project mapped; objects younger than the grace period are kept; git only through the adapters, serialized by repo; events strict, ids and counts only; `{error:{code,message}}`; no em or en dashes in UI strings; say plainly in Settings that ignored files (like `.env` or `node_modules`) aren't kept and staged changes come back unstaged.

**Never:** a port per worktree (27.7), trials and Keep this one (27.8), hand-off (27.4); deleting anything in `<data>/cw` outside `removeWorktree`; a startup sweep of `<data>/cw` folders; touching the repo's own objects, refs or index during a snapshot or cleanup; editing `deferred-work.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Over the cap | keep 2, three idle worktree chats, oldest has a modified tracked file and a new untracked file | oldest put away: record, `session.worktree_put_away` {files 2}, folder and git record gone, branch kept | none |
| Mid-turn oldest | oldest `working` | next oldest idle put away; working one kept | none |
| All busy | every copy working | nothing put away, count stays over | none |
| Clean copy | no changes | put away with `snapshotTree: null`, files 0 | none |
| Unsafe copy | detached HEAD, merge in progress, or a gitlink | not put away; sweep skips it | logged, refusal |
| Send while put away | message to a put-away chat | refused | 409 `worktree_put_away` |
| Restore | put-away chat | worktree back at its path on its branch, tracked edits as unstaged, untracked files back, deletions back; record gone; `session.worktree_restored` | none |
| Branch gone | branch deleted | nothing changed, record kept | 409 `restore_failed` `branch_missing` |
| Branch moved | branch has a new commit and saved changes exist | nothing changed | 409 `restore_failed` `branch_moved` |
| Path taken | something else at the path | nothing changed | 409 `restore_failed` `path_taken` |
| Half put away | record written, folder still there (removal failed or crash) | Restore re-applies the snapshot in place and clears the record | none |
| Delete put-away chat | record with files > 0, no `discardUncommitted` | nothing deleted | 409 `uncommitted_changes` |
| Setting | `{keep: 0}` / `101` | | 400; a lower valid value enforces at once |
| Cleanup | deleted chat's trees, turns past the bound, a put-away tree, a fresh object | only unreferenced objects older than the grace removed; put-away tree and fresh object kept | none |
| Cleanup unsafe | `<data>/snapshots` or a store a link; a project folder unreadable | nothing deleted through the link; no store deleted whole | logged |

</frozen-after-approval>

## Code Map

Project root is the worktree `/Users/harrisonsmith/Library/Caches/ogden-agents-dev-worktrees/27.6`; every path is relative to it. Never edit another checkout, `git stash`, push, switch branches or commit (the orchestrator commits). Wait for `uptime` load below 40 before `pnpm test`; re-run timing failures alone.

- Contracts (27.2): `packages/shared/src/where-work-runs.ts` (`WorktreeRetentionSetting`, `PutAwayWorktree`, texts `WORKTREE_PUT_AWAY_TEXT`, `restoreBranchMissingText`, `RESTORE_PATH_TAKEN_TEXT`, `worktreeRetentionLabel`), `events-where-work-runs.ts` (put-away, restored and retention-changed events), `api.ts:592-601` routes, `errors.ts` codes. `packages/core/src/where-work-runs.ts` `WorktreeRetention`; `vcs-port.ts:273-316` `VcsPutAway`, `VcsRestoreResult`, `VcsChatWorktreePort`; `errors.ts:823` `RestoreFailedError`; `adapters/src/vcs-memory/chat-worktree.ts` stub; `server/src/where-work-runs-routes.ts` (wired when `worktreeRetention` is given); `core.ts:312` `worktreeRetention: undefined`.
- Pattern for chat-side guards: `packages/core/src/chat/delete-chat.ts` (`requireDeletable`, `stopLive`, `droppedAgents` bounded wait, `isChatWorktreePath` twice, `serializedByRepo`); `chat/context.ts` (`busy`, `switching`, `live`, `droppedAgents`); `chat/turns.ts:343` `sendMessage` refusals; `chat/workspaces.ts` `createChatSession` (worktree made there).
- Git: `adapters/src/vcs-git/working-tree.ts` (`locate`, `storeOf`, `tempIndex`, `storeEnv`, `filterFlags`, `snapshot` ~719) and `runner.ts` `pinnedWorktree`; `index.ts` `removeWorktree` (27.3 guards), `requireOwnWorktree`, `addWorktree`. Server: `start-builds.ts` `createServerWorkingTree`, `snapshotsRootOf`, `createServerVcs`; `start.ts` ~394 `createChat`, ~520 `createApp`.
- Turns: `core/src/workspace-changes.ts:102-113,207` (`recordedTurns`, `targetOf`, `turns`), `turn-snapshots.ts`.
- DB: `core/src/db/schema.ts`; migrations by `pnpm --filter @ogden-agents/core db:generate` (next is `0041`); settings pattern `core/src/build-settings.ts`.
- Web: settings groups `web/src/settings/settings-groups.ts:33`, `router.tsx:66-118`; number field `web/src/planning/build-limit-fields.tsx` `NumberSetting`; event-following setting `web/src/terminal/terminals-settings.ts`; `web/src/events/use-event-invalidation.ts`; `routes/session-page.tsx:633-648` banners, `832-846` `Composer` `blockedReason`/`disabled`; `routes/workspace-settings-page.tsx` sections, row list pattern `AlwaysAllowRulesView` (354-432); `ui/banner.tsx`, `ui/notice.tsx`; `api/http.ts` `call`, `postJson`, `isApiError`; `chat/chat-api.ts:216` `deleteChat`.
- Tests: `packages/adapters/test/vcs-git*.test.ts` (real git fixtures), core tests with `vcs-memory`, `packages/server/test/workbench-changes.test.ts` and `send-now.test.ts` (fake agent `write-file`), web `session-page.dom.test.tsx`, `workspace-settings-page.test.tsx`, `settings-groups.test.ts`, e2e `tests/e2e/worktree-chat.spec.ts`.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/shared/src/*` -- `RestoreFailedReason` adds `branch_moved` (`restoreBranchMovedText`); code `worktree_put_away` (`WORKTREE_PUT_AWAY_SEND_MESSAGE`); `TURN_SNAPSHOTS_KEPT = 50`; Settings texts (Worktrees page title, the what-isn't-kept sentence), list texts.
- [ ] `packages/core/src/vcs-port.ts`, `errors.ts` -- `VcsChatWorktreePort.putAway` becomes `saveForPutAway(repoPath, worktreePath, branch)` → `{snapshotTree, head, files}` (snapshot only; refuses unsafe copies); `restore` input gains `head`, result gains `branch_moved`; new `VcsSnapshotStorePort.pruneSnapshots(entries: {folder, keep}[], {olderThanMs})` → counts; `WorktreePutAwayError`.
- [ ] `packages/core/src/db/schema.ts` + migration `0041` -- `chat_worktree_retention` (id 1, keep) and `chat_worktrees_put_away` (snapshot id, session id unique FK cascade, workspace id FK cascade, branch, snapshot tree nullable, head, files, cause, put-away at).
- [ ] `packages/core/src/worktree-put-away-store.ts` (new) -- rows: get, list by workspace newest first, insert with its event and remove with its event, each in one transaction; the setting read and write with its event.
- [ ] `packages/core/src/chat/put-away.ts` (new), `chat/types.ts`, `chat/context.ts`, `chat.ts`, `chat/turns.ts`, `chat/send-now.ts`, `chat/delete-chat.ts` -- `putAwayWorktree(sessionId, cause)`: require idle, hold the chat (sends refused), stop its agent and terminal (bounded wait), under the repo chain re-check, `saveForPutAway`, record, then `removeWorktree` without branch (failure reported, record kept); `restoreWorktree(workspaceId, sessionId)`; `worktreeIdle(sessionId)`; sends refused while held or put away; Delete chat counts a put-away record with files as uncommitted. `onChatWorktreeAdded` hook after creation and restore.
- [ ] `packages/core/src/worktree-retention.ts` (new), `core.ts`, `index.ts` -- `createWorktreeRetention` implementing `WorktreeRetention` (one sweep at a time, oldest `updatedAt` first, sparing the chat just added); `createSnapshotCleanup` (keep = latest `TURN_SNAPSHOTS_KEPT` turns' trees per chat + put-away trees; skips a project with a chat working or waiting); `workspace-changes.ts` lists and resolves only the kept turns.
- [ ] `packages/adapters/src/vcs-git/working-tree.ts`, new `vcs-git/chat-worktree.ts`, `index.ts` -- expose the working tree's internals; `createGitChatWorktree` (`saveForPutAway`, `restore`: branch checks, `worktree add <path> <branch>`, files from the snapshot through a temporary index with filters blanked, deletions applied, verified by a fresh snapshot; in place when the half-put-away copy is still there) and `pruneSnapshots`; `vcs-memory` stub updated.
- [ ] `packages/server/src/start.ts`, `start-builds.ts`, `where-work-runs-routes.ts`, `chat-routes.ts` -- wiring, enforce after start and after each added worktree, cleanup a minute after start then daily (timers unref, stopped on close), logs with ids and codes only; `branch_moved` text; `worktree_put_away` 409.
- [ ] `packages/web/src/*` -- Settings › Projects › Worktrees page (number field, sentence); session page notice with Restore, Try again on failure, composer disabled; Workspace settings "Put-away copies" list with Restore each; invalidation on the three events.
- [ ] Tests: adapter real-git (every matrix row for save/restore/prune, link refusals, nothing written outside `<data>/snapshots` or removed outside `<data>/cw`, repo objects/refs/index unchanged); core retention and put-away (mid-turn kept, all busy, send refused, hold race, half put away, delete refusal, setting); server routes end to end with the fake agent; web dom; e2e `tests/e2e/worktree-retention.spec.ts` (cap 1, second worktree chat puts the first away, Restore brings its file back; axe, 390px).

**Acceptance Criteria:**
- Given a fixture project and the cap at 1, when a second worktree chat is made, then the first idle one is put away with its changes snapshotted, a working one is never chosen, and Restore brings the copy back intact on its branch.
- Given `pnpm typecheck`, `pnpm test` and the touched e2e specs, then all pass.

## Implementation Notes

- The put-away state is the record (`chat_worktrees_put_away`); the session row keeps its `worktreePath` and `branch` so Restore knows where. The web reads it from `GET …/worktrees/put-away` (no new `Session` field), invalidated on the three events.
- `saveForPutAway` copies every object the snapshot's changes need into the store (pack from the repo, unpack with the store as git's only object folder): a blob the copy had staged lives only in the repo's objects and would go with a `gc` once the copy is removed.
- Retention is made over the server's chat (`core.createWorktreeRetention`), so `Core.worktreeRetention` became that factory plus `core.worktreePutAway` and `core.createSnapshotCleanup`. `RestoreFailedError` carries the branch so the route can use the branch's sentence.
- `runBinary` moved from `vcs-git/index.ts` into `runner.ts` (shared with the chat-worktree half); the working tree's internals are `createWorkingTreeInternals`.
- Core's tests use their own fake of retention's git (`test/support/worktree-chat-fakes.ts`; core depends on no adapter); 27.3's agent and git fakes moved there too.
- Workspace settings' Put-away copies section shows only when the project has a put-away copy (or a Restore just ran there).

- Review fixes (pass 1): `saveForPutAway` also refuses assume-unchanged or skip-worktree entries (`index_flags`), a path both staged and edited again (`partly_staged`), any `.git`-named entry below the top (`nested_git`, a walk that never follows links, capped at 500,000 entries) and a link at the copy's path; put-away saves once as a check before stopping the agent, then for real, then once more after the record (a difference leaves the copy half put away); Restore in place writes only missing paths and never overwrites; any git failure in Restore is 409 `restore_failed` reason `failed`; the cleanup groups projects by store, takes a `protect` list of every put-away tree, judges `tmp` files by ctime and counts refusals; the server's stop waits (bounded) for route-started put-aways and Restores (`Chat.worktreeOpsSettled`).
- Verified (after review fixes, 2026-11-01, load ~10): `pnpm typecheck` clean; `pnpm test` 467 files, 6035 passed, 13 skipped; after `pnpm run build`, Playwright worktree-retention, worktree-chat, workbench-changes and settings-nav 25 of 25 (axe and 390px in worktree-retention); provenance check passed. The migration is `0041_gray_mysterio.sql`: renumber on merge if a sibling lane also adds `0041`.

## Plan Change Log

## Review Triage Log

Pass 1 (2026-11-01; lenses: quick and defensive, fresh subagents given the diff; the defensive lens checked that put-away, Restore and cleanup never lose uncommitted work without a snapshot, never delete outside `<data>/cw` and `<data>/snapshots`, and never act mid-turn, with scratch git experiments). Verdicts: high 9, medium 12, low 5, false 0, maybe-false 0. No intent_gap; the fixes add no public surface beyond internal port fields, so patched. 19 patched, 4 deferred, 3 rejected.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | Two projects of one repo share a store; cleanup pruned per project, deleting the other's kept and put-away trees; a sibling's busy skip ignored | high | patch | reproduced by both lenses; entries grouped by store, keep lists joined, any `null` skips the store; test |
| 2 | A link at `<cw>/<id>`: Restore wrote into an outside worktree; put-away removed git's record of the user's own worktree | high | patch | reproduced; the path, when present, must be a real folder; tests |
| 3 | Assume-unchanged / skip-worktree edits left out of the snapshot and lost | high | patch | reproduced; refused (`index_flags`); test |
| 4 | Partly staged content lost (staged version gone) | high | patch | reproduced; refused (`partly_staged`); test; Settings sentence updated |
| 5 | `.git`-named files and ignored nested repos deleted unsaved | high | patch | reproduced; refused (`nested_git`); test |
| 6 | `tmp` sweep deletes an in-flight temp index (mtime backdated to the index's) | high | patch | reproduced 3-day-old in-flight file; judged by ctime; test |
| 7 | Hook after the 404 early return in the session page | high | patch | React hook order; moved above; dom test |
| 8 | In-place Restore overwrote edits made after the snapshot; a failing final check after writing left the chat stuck | high | patch | reproduced; in place writes missing paths only, no strict check; tests |
| 9 | Folder changed between snapshot and removal is deleted unsaved | high | patch | code reading; re-save after the record, a difference leaves the copy half put away; test (outside processes' residual window deferred, 27.3 #15) |
| 10 | Orphan store removal ignores put-away trees in it (common dir moved) | medium | patch | code reading; `protect` list; test |
| 11 | Store objects present but stale are not freshened, so a racing cleanup can unlink a needed blob | medium | patch | code reading; needed objects `utimes`'d, recopied on ENOENT |
| 12 | A readable non-repo project blocks orphan store removal forever | medium | patch | `locate` undefined for a non-repo; only missing or unreadable blocks; test |
| 13 | Cleanup refusals not logged (matrix says logged) | low | patch | `refused` count, logged |
| 14 | `dropStaleRecord` misses a symlinked data dir or relative `gitdir` (500) | medium | patch | resolved against the record, compared by real path; test |
| 15 | Other Restore failures answer 500 (branch checked out elsewhere, verify failed) | medium | patch | mapped to 409 `restore_failed` `failed`; test |
| 16 | Agent killed on every sweep for an always-refused copy; refusal logged as `remove` | medium | patch | check save before stopping; report dropped; test |
| 17 | Stop doesn't wait for route-started put-away or Restore | medium | patch | `worktreeOpsSettled` awaited, bounded |
| 18 | Restore forced `core.autocrlf=false` unlike the snapshot's own config | low | patch | override dropped |
| 19 | Missing test rows (Delete history of a put-away chat, Restore hold vs send/send-now/handoff/switch, repo untouched during Restore and cleanup) | medium | patch | added |
| 20 | `branch_moved` / `branch_missing` are dead ends; unchanged entries' blobs rely on the repo's objects once the branch moved | medium | defer | needs a product call (restore onto the new tip, or as a new branch) |
| 21 | A partly removed folder (its `.git` gone) answers `path_taken` forever | medium | defer | needs a repair path for a broken copy; rare (a crash mid-removal) |
| 22 | Cleanup not serialized with the repo chain; relies on mtimes and the 24 h grace | medium | defer | #11 and the busy skip close the known race; full ordering needs nested repo locks |
| 23 | CRLF under `text=auto` comes back normalized | medium | defer | git's own normalization; byte-for-byte needs storing raw blobs |
| 24 | Exec bit lost with `core.fileMode=false` | low | reject | the repo's own config says modes are ignored; fix needs a stat walk |
| 25 | Empty folders dropped | low | reject | git keeps no folders; stated in Settings now |
| 26 | Ignored files removed with no per-chat warning | low | reject | the user's retention decision; stated plainly in Settings as asked |

## Deferred (for the sweep)

- Restore refuses for good when the branch is gone or has moved and saved changes exist; the unchanged files' blobs live in the repo's objects and can be gc'd once the branch moved. Restoring onto the new tip or a new branch is a product call (review 20).
- A half put-away copy whose `.git` file went (a crash mid-removal) answers `path_taken` on every Restore; the saved changes are kept but need a repair path (review 21).
- The snapshot cleanup runs outside `serializedByRepo`, relying on fresh mtimes, the busy skip and the 24 h grace (review 22).
- Files normalized by `text=auto` come back with git's line endings, not byte for byte (review 23).
- A process the agent started (a dev server) or the user's editor can still write in the copy in the moment between the last save and the removal (review 9 residual; 27.3 review 15).
- 27.4's `ChatLocations.location` should read `putAway` from `core.worktreePutAway`; `moveChanges` in `vcs-git/chat-worktree.ts` throws until 27.4 builds it there.
- Orchestration's message route doesn't map `worktree_put_away` to its own 409.

## Design Notes

Put-away order (safety): hold the chat, stop its agent, snapshot, record (row and event in one transaction), then remove. A crash or removal failure after the record leaves a "half put away" copy that Restore repairs in place from the snapshot, so a record always exists while the copy may be gone. Restore applies the snapshot as working files over the branch's HEAD; the real index stays at HEAD, so tracked edits are unstaged and new files untracked. `branch_moved` only when saved changes exist (a clean copy restores on the new tip).

Cleanup: per store, the reachable set of the kept trees (`rev-list --objects` over existing ones); loose objects outside it and older than 24 hours are unlinked; packs are left. A store matching no project is removed only when every project's store was found. `<data>/snapshots/tmp` files older than the grace go too. Documented in the architecture's Config and data row and AD-37's rule.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors
- `pnpm test` -- expected: all pass (timing failures re-run alone)
- `pnpm run build && pnpm exec playwright test tests/e2e/worktree-retention.spec.ts tests/e2e/worktree-chat.spec.ts tests/e2e/workbench-changes.spec.ts` -- expected: pass
- `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs` -- expected: pass
