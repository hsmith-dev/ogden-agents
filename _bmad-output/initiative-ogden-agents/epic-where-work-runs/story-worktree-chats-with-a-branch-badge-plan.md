---
title: 'Worktree chats with a branch badge'
type: 'feature'
ticket: '3'
created: '2026-11-01'
status: 'built'
baseline_revision: '8cb038bf53ba1681397cd7fd180d7116167263c6'
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

**Problem:** 27.1 makes a chat's worktree but nothing shows it, nothing removes it (no chat can be deleted on its own, and Delete history leaves every copy and branch behind), a failed creation leaves git's record and branch, and nothing proves it survives a restart or that 8.4's commit works on it (E27-R2; CAP-35, CAP-33; AD-8 and AD-17 CAP-33 notes, AD-36, AD-37).

**Approach:** A branch badge in the chat header (opening the Workbench rooted at the worktree, AD-36) and on the started chat's Location chip; a **Delete chat** action that confirms once and, for a worktree chat, removes its copy through `VcsPort` (the branch kept when it has unmerged commits); Delete history removes its chats' copies the same way; a failed creation removes the worktree's git record and branch; tests for restart, protections and 8.4's commit on a real worktree chat.

**Decisions (autonomous, 2026-11-01; user may overrule):** (1) EXPERIENCE.md's "Deleting the chat asks before removing the copy" needs a per-chat delete, which Ogden lacks; this story adds **Delete chat** for plain local chats (kind `chat`, in no orchestration run), not only worktree chats. (2) On delete the branch `ogden/chat/<ses>` is deleted only when merged into the checked-out branch (no commits of its own); otherwise kept, so committed work is never lost.

## Boundaries & Constraints

**Always:** git only through `VcsPort`, serialized by repo (`serializedByRepo`); a removal only of a direct child of a real `<data>/cw` named like `RUN_SHORT_ID`, never through a link, never the repo or a folder holding it, checked in core (`isChatWorktreePath`) and again in the adapter; never while the chat is `working`, `waiting`, busy or terminal-driven (`agent_mid_turn`); a copy with uncommitted changes (staged, unstaged or untracked; a copy whose state can't be read counts as changed) is removed only when the request says `discardUncommitted: true`, which the UI sends only after a confirmation naming that; rows deleted in one transaction before the folder goes; events strict with ids, booleans and counts only; `sessionFolder` for anything rooted at a chat's folder; `{error:{code,message}}`, `/api/v1`; no em or en dashes in UI strings; confirmations once, consequence in one sentence (EXPERIENCE State Patterns).

**Never:** hand-off, retention, Restore, ports, trials, remote Location (27.4 to 27.8); merging or pushing; deleting a build or planning session, or a chat an orchestration run names; a startup sweep that removes folders; editing `deferred-work.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Badge | idle worktree chat | header badge `ogden/chat/<ses>` linking to Workbench `?session=`; Location chip shows Worktree with the branch | none |
| Restart | worktree chat, server restarted on the same data folder | chat keeps path and branch; folder and git record intact; next turn's agent cwd is the worktree | none |
| Commit | worktree chat after a fake-agent write, Commit these changes | one commit on `ogden/chat/<ses>`, main checkout HEAD, index and files unchanged, no hook ran | none |
| Delete clean | idle worktree chat, no changes, no commits | chat, its events, folder, git record and branch gone; `workspace.chat_deleted` | none |
| Delete with commits | branch has an unmerged commit | folder and record gone, branch kept (`branchKept: true`) | none |
| Delete dirty | uncommitted file, no `discardUncommitted` | nothing removed | 409 `uncommitted_changes` |
| Delete dirty confirmed | same, `discardUncommitted: true` | removed | none |
| Mid-turn | `working`, `waiting`, busy or terminal driver | nothing removed | 409 `agent_mid_turn` |
| Path outside cw | row's `worktreePath` not a child of `<data>/cw` (tampered), or `<data>/cw` a link | chat rows deleted, no folder touched outside; reported, not removed | logged |
| Copy is a link | `<data>/cw/<8>` replaced by a link to a folder | only the link removed; target intact | none |
| Not deletable | build/planning session, orchestration chat | nothing deleted | 409 `invalid_operation` |
| Delete history | project with a dirty worktree chat | without confirmation 409 `uncommitted_changes`; with it every chat's copy removed | as above |
| Create fails late | insert throws after `addWorktree` | folder, `.git/worktrees/<8>` and branch removed | original error |

</frozen-after-approval>

## Code Map

Project root is the worktree `/Users/harrisonsmith/Library/Caches/ogden-agents-dev-worktrees/27.3`; every path is relative to it and every command runs there. Never edit another checkout, `git stash`, push or switch branches. The machine is shared: wait for `uptime` load below 40 before `pnpm test`; re-run timing failures alone.

- `packages/core/src/chat/workspaces.ts:184-345` -- `makeChatWorktree`, `removeFolder`, `createChatSession` (late-failure cleanup: call `vcs.removeWorktree(repoPath, path, { deleteBranch: branch })` best effort, then `removeFolder`), `deleteHistory` (~263; add copy removal). Add `deleteChat` here (or a new `chat/delete-chat.ts`); `Chat` in `chat/types.ts` (+ `ChatOptions.vcs` widened with `removeWorktree`; `ChatOptions.vcsWorkingTree?` for the uncommitted check), `chat.ts` wiring; live entry `drop`, `stopTerminal`, `busy` as `deleteHistory` uses them.
- `packages/core/src/chat-worktrees.ts` -- `isChatWorktreePath`; `workspace-root.ts` `sessionFolder`, `vcsFolderOf`, `workspaceFolder`; `repo-serialization.ts`.
- Uncommitted check: `VcsWorkingTreePort.changedFiles(vcsFolderOf(ws, session), {view:'unstaged'})` and `'staged'` (pinned, safe, untracked included; throws on a tampered copy, which counts as changed). `workspace-changes.ts` shows its use.
- `packages/core/src/entities.ts` -- new `deleteChatSession(id)`: one transaction refusing non-chat kinds, `machineId` irrelevant, `working`/`waiting` (`AgentMidTurnError`), any `orchestration_steps.session_id`/`chat` naming it (`InvalidOperationError`); deletes events with `streamId = id` and the row; appends `workspace.chat_deleted`. Pattern: `event-log.ts:477` `deleteWorkspaceHistory`, `entities.ts:538`.
- `packages/core/src/vcs-port.ts:44` `RemoveWorktreeOptions` -- add `keepUnmerged?: boolean` (with `mergedOnly`, a branch `-d` refuses is kept and reported, not thrown); `removeWorktree` returns `{ branchKept: boolean }` or keep `void` plus a new return field, your call; doc names chat worktrees.
- `packages/adapters/src/vcs-git/index.ts:190-205,321-366`, `checks.ts:27` -- `GitVcsOptions.chatWorktreesRoot`; `requireOwnWorktree` accepts a direct child of either root; the branch rule: run root → `ogden/<id>/…`, chat root → `CHAT_WORKTREE_BRANCH_PREFIX` + a valid session id only. Keep the lstat/no-follow removal and the by-id admin record removal. `vcs-memory` adapter mirrors it.
- `packages/server/src/start-builds.ts:31` `createServerVcs` -- pass `chatWorktreesRoot: chatWorktreesRootOf(dataDir)`; `start.ts:~420` gives chat `vcs` and the working-tree port.
- `packages/server/src/chat-routes.ts`, `workspace-routes.ts:95-118` -- `DELETE API_ROUTES.workspaceSession` (body optional `DeleteChatRequest`), history route takes the same body; map `UncommittedChangesError` → 409 `uncommitted_changes`, `AgentMidTurnError` → 409 `agent_mid_turn`.
- `packages/shared/src/` -- `chat.ts` or `where-work-runs.ts`: `DeleteChatRequest {discardUncommitted: boolean default false}`, `ChatDeletedResponse {sessionId, worktreeRemoved, branchKept}`, texts (badge tooltip "Never pushed. Merge it yourself when ready.", Delete chat label, confirmations, refusals); `errors.ts` `uncommitted_changes`; new strict event `workspace.chat_deleted` {sessionId, worktreeRemoved, branchKept} registered in `events.ts`; `api.ts` doc on `workspaceSession`.
- Web: `routes/session-page.tsx:524-575` header (badge beside the model; `Badge` from `ui/badge.tsx`, `GitBranch` glyph, mono, truncating) and `SessionMenu` (`chat/session-menu.tsx`, add Delete chat with reason when blocked); `chat/setup-row.tsx` `LocationChip` (started worktree chat: branch beside the word); AlertDialog pattern `routes/workspace-settings-page.tsx:435-500` (Delete history; add the copies sentence when any chat has a worktree, send `discardUncommitted: true`); `workspaces/workspace-api.ts:76-190` and `events/event-store.ts`/`fold.ts` handle `workspace.chat_deleted` (refetch sessions, drop that session's events); `chat/chat-api.ts` `deleteChat`; after delete navigate to the project's new-chat draft.
- Tests: `packages/core/test` (fake VcsPort; chat-worktree tests from 27.1), `packages/adapters/test/vcs-git*.test.ts` (real git fixtures), `packages/server/test/workbench-changes.test.ts` (worktree commit pattern), `send-now.test.ts` (fake agent `write-file`), server restart pattern (grep `restart` in `packages/server/test`), `tests/e2e/composer-setup-row.spec.ts` (`withChatServer`, git init, `expectNoHorizontalOverflow`, axe).

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/*` -- request/response, event, error code, texts.
- [x] `packages/core/src/vcs-port.ts`, `adapters/src/vcs-git/index.ts`, `checks.ts`, `vcs-memory` -- chat root, chat branch rule, `keepUnmerged`.
- [x] `packages/core/src/entities.ts` -- `deleteChatSession`.
- [x] `packages/core/src/chat/workspaces.ts`, `chat/types.ts`, `chat.ts` -- `deleteChat(workspaceId, sessionId, {discardUncommitted})` (refuse, check changes under `serializedByRepo`, delete rows, drop agent and terminal, remove copy; folder failures logged, never thrown after rows go), `deleteHistory` copies, late-creation cleanup.
- [x] `packages/server/src/start-builds.ts`, `start.ts`, `chat-routes.ts`, `workspace-routes.ts` -- wiring and routes.
- [x] `packages/web/src/routes/session-page.tsx`, `chat/session-menu.tsx`, `chat/setup-row.tsx`, `chat/chat-api.ts`, `routes/workspace-settings-page.tsx`, `workspaces/workspace-api.ts`, `events/*` -- badge, Delete chat dialog, Delete history sentence, event handling.
- [x] Tests: adapter (chat root removal, link root refused, path outside refused, link copy unlinked only, unmerged branch kept, merged deleted, run-branch rule unchanged); core (every matrix row, late-creation cleanup, protected path in a worktree chat asks); server (restart keeps the chat and runs the agent there, 8.4 commit on a created worktree chat, DELETE routes and codes); web dom (badge, Location chip branch, Delete chat dialog texts and disabled reason, Delete history sentence); `tests/e2e/worktree-chat.spec.ts` (create from the composer, badge, write-doc only in the copy, badge opens Workbench rooted there, delete after confirmation removes the folder; axe, 390px).

**Acceptance Criteria:**
- Given a worktree chat on a fixture repo, when the server restarts, then the chat, its folder and branch are intact and its next turn runs there.
- Given that chat, when Commit these changes runs, then only `ogden/chat/<ses>` gains a commit.
- Given that chat, when the user deletes it and confirms, then the copy is gone and nothing outside `<data>/cw` changed.
- Given `pnpm typecheck` and `pnpm test`, then both pass.

## Implementation Notes

- Delete chat and Delete history's copies live in `packages/core/src/chat/delete-chat.ts`; `chat/workspaces.ts` keeps creation (late-failure cleanup through `removeUnusedWorktree`, serialized by repo).
- `VcsPort.removeWorktree` now answers `RemovedWorktree | void` (`branchKept`); old fakes returning nothing still fit. Core reads `isMerged` before the rows go so `workspace.chat_deleted.branchKept` is known in the same transaction, and still passes `mergedOnly` + `keepUnmerged` so git never deletes an unmerged branch.
- A copy whose folder is already gone counts as unchanged (nothing to lose); one whose state can't be read counts as changed; without a working-tree port every copy counts as changed.
- Delete history refuses (`sessions_busy`) while a worktree chat is terminal-driven; a plain terminal chat is stopped as before.
- `ChatOptions.vcsWorkingTree` is a second `createServerWorkingTree` instance in `start.ts` (stateless, same snapshot folder); `onWorktreeCleanupError` logs the session id, step and an error code only.
- The header badge is `ui/badge.tsx` `BranchBadge` (AD-18: no visual utilities in routes).
- Verified (after review fixes, 2026-11-01): `pnpm typecheck` clean; `pnpm test` 462 files, 5956 passed, 13 skipped (load ~11); after `pnpm run build`, Playwright worktree-chat, composer-setup-row, workbench-changes and new-chat 9 of 9 (axe and 390px in worktree-chat); provenance check passed. Review fix 1 also accepts a record whose `gitdir` an agent rewrote when its `HEAD` is the copy's own branch being deleted (a branch is checked out in one worktree only), keeping 5.5's existing swapped-link test.

## Plan Change Log

## Review Triage Log

Pass 1 (2026-11-01; lenses: quick and defensive, fresh subagents given the diff; the defensive lens checked removal never reaches outside `<data>/cw`, never takes uncommitted work unconfirmed, never runs while an agent works). Verdicts: high 3, medium 9, low 8, false 0, maybe-false 0. No intent_gap; the remote-chat deviation's fix is one check, so patched. 11 patched, 5 deferred, 4 rejected.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | git's record found by basename: git suffixes a digit on a name clash, so a user's own worktree record is deleted and Ogden's left | high | patch | reproduced by the reviewer; the record is now found through the copy's `gitdir` pointer and removed only when its `gitdir` points back; clash test |
| 2 | `.git/worktrees` as a link makes the record removal follow it | medium | patch | `lstat` of the record only; now refused unless `<common>/worktrees` is a real folder |
| 3 | No `switching` check: a chat switching to the terminal (CLI starting in the copy) can be deleted | high | patch | `sendMessage` refuses while switching, delete did not; refused now |
| 4 | A whole turn can run during the awaited git reads, so its new changes are removed unconfirmed | high | patch | re-checks compared only state; now also `updatedAt` per session |
| 5 | After the 10 s wait the copy is removed even if the agent has not exited | medium | patch | now left and reported |
| 6 | Remote chats deletable, against "plain local chats" | low | patch | `requireDeletable` ignored `machineId`; refused and not offered |
| 7 | A dirty worktree chat needs two confirmations (plan: once) | medium | patch | the one confirmation names uncommitted changes and sends `discardUncommitted` |
| 8 | Delete history confirmable before the sessions load, so copies go unnamed | medium | patch | Confirm disabled until known |
| 9 | DELETE body limit answers with the chat-name message | low | patch | own limit, generic message |
| 10 | `vcs-memory` does not mirror git (branch rule, `mergedOnly`, merged predicate) | medium | patch | aligned so core tests match git |
| 11 | Missing test rows (link copy in core, staged-only, Delete history mid-turn) | medium | patch | added |
| 12 | `workspace.chat_deleted` written before removal, so a failed removal or kept branch disagrees with the log | medium | defer | the rows must go first (design notes); a follow-up event or "planned" wording |
| 13 | Ignored files count as clean, so a copy holding only `.env` or notes is removed without the changes step | medium | defer | ignored files are mostly build output; asking for every copy with `node_modules` would make the step noise; a product call |
| 14 | Commits on a detached HEAD in the copy become unreachable | low | defer | rare; needs the copy's HEAD checked against its branch |
| 15 | Child processes the agent started (dev servers) may still run in the copy | medium | defer | needs process-tree tracking per chat (AD-3) |
| 16 | Web store sets no floor for a deleted chat, so an in-flight history page can bring its events back | low | defer | rare race; a per-session floor |
| 17 | Chat branch rule not tied to the copy (a tampered row could name another chat's branch) | low | reject | needs a database write; `-d` only deletes merged branches |
| 18 | `<data>/cw` swapped for a link between check and `rmSync` | low | reject | needs write access to the owner-only data folder |
| 19 | Delete history reports no per-copy result | low | reject | logged; no user harm named |
| 20 | Orchestration chats show Delete chat enabled, refused after confirming | low | reject | rare; the fix needs a new membership read in the page |

## Design Notes

Order of delete: refuse and check changes under the repo chain, then delete rows (atomic; a send after that finds no chat), then stop the agent and terminal, then remove the copy. A removal failure after the rows are gone is logged with the session id only and leaves the folder (recorded as deferred) rather than failing a delete the user already confirmed.

## Deferred (for the sweep)

- `workspace.chat_deleted` is written with the planned outcome before the copy goes, so a failed removal or a branch `-d` kept disagrees with the log (review 12).
- Ignored files are not counted as uncommitted, so a copy holding only ignored files (`.env`, notes) is removed without the changes step (review 13).
- Commits made on a detached HEAD in the copy become unreachable on delete (review 14).
- Processes the agent started in the copy (dev servers) may outlive it during removal (review 15).
- The web event store sets no floor for a deleted chat; an in-flight history page can bring its events back (review 16).
- A chat copy whose removal failed after its rows went (logged `a chat worktree was left in place`) stays in `<data>/cw` with its git record; nothing removes it later (no startup sweep, by this story's Never). A later story's retention or a manual cleanup has to handle it.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors
- `pnpm test` -- expected: all pass (timing failures re-run alone)
- `pnpm run build && pnpm exec playwright test tests/e2e/worktree-chat.spec.ts tests/e2e/composer-setup-row.spec.ts tests/e2e/workbench-changes.spec.ts` -- expected: pass
- `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs` -- expected: pass
