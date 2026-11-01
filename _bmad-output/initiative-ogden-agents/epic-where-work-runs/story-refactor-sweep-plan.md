---
title: 'Refactor sweep (epic 27)'
type: 'refactor'
ticket: '9'
created: '2026-11-01'
status: 'built'
baseline_revision: '1b1cbad6219b9adfc7e15eebaa592d4731ff0cff'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-where-work-runs/epic-where-work-runs.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 27's eight stories were built in parallel worktrees, each leaving a "Deferred (for the sweep)" list. An attended remote build with the Local model connects to the machine and pushes the repo before the agent-start refusal; agent child processes get the server's PATH with empty and relative entries (a bare name could run a program planted in the project or the chat's copy); and a chat's place (this folder, its worktree, a remote machine) is derived inline in a dozen places with three names and two different rules for "is a worktree".

**Approach:** As the epic 8 sweep (8.12). Security, decided for the user by the orchestrator: (a) a remote build (start, queued dispatch, Retry or Resume) with an agent that has `localOnlyReason` is refused in its words before any connection or push; (b) the agent environment's PATH keeps only absolute folders through 8.12's `withAbsolutePath`, the user's terminal panes untouched. One shared model of a chat's place (`ChatPlace`, `chatPlaceOf`, `localPlaceOf`, `inOwnWorktree` in shared `where-work-runs.ts`) used by core (location, hand-off, retention, put-away, ports, ignored files, delete, workspace root, project commands) and web (composer chip, header, hand-off, settings, workbench). Small duplication, naming and dead code fixed; every 27.x Deferred line fixed, marked done, or logged and indexed in `deferred-work.md`.

## Boundaries & Constraints

**Always:** the two security changes in their own commit, with tests proving no connect/push happens and no empty or relative PATH entry reaches an agent; no behaviour change beyond those, the orchestration route's put-away code and the chat-worktree root fence; AGENTS.md (no dashes in UI strings, files under 600 lines for new files, no copied code); `deferred-work.md` header rules; provenance passes.

**Never:** change terminal panes' environment; widen an environment allowlist; weaken what a test proves; change API status codes or event payloads; edit EXPERIENCE.md or the architecture; push, open PRs or switch branches.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Local-only remote build | attended start with `local` on a machine | `BuildRefusedError` `sandbox_unavailable`, the agent's reason | no connect, no push, no session, no git call |
| Retry after hand-off to it | remote run blocked, session now `local` | Retry refused the same way | no connect, no push |
| Other agent remote | `claude-code` on a machine | starts as before | n/a |
| Agent PATH | server PATH `…::rel:.` | the agent's PATH has only absolute folders | n/a |
| Pane PATH | `/bin::rel:.` | unchanged | n/a |

</frozen-after-approval>

## Code Map

- `packages/core/src/build-start.ts` -- `validateStart` (remote probe `remote.connect`), `prepareContinue` (push then connect); `chat.chatAgents` lists `localOnly`.
- `packages/core/test/build-remote.test.ts`, `builds-harness.ts` (`chatAgents` stub).
- `packages/server/src/start-env.ts` `agentEnvironment` -- the one source of agent, git and sandbox env; `adapters/src/program-launch.ts` `withAbsolutePath`; panes use `child-env.ts` `paneEnvironment`.
- Shared: `where-work-runs.ts` `SessionLocation` (full union), its private `Branch` (copy of `events-where-work-runs.ts`'s); `chat.ts` `ChatLocation`.
- Core place derivations: `chat/location.ts` (`requireMovable`, `chatLocation`, others-in-folder), `entities.ts` `setSessionWorktree` (payload ternaries, copied refusal texts), `chat/put-away.ts` `ownCopy`, `worktree-retention.ts` candidates, `worktree-ports.ts` `eligible`, `chat/context.ts` `portOf`, `chat/ignored-files.ts`, `chat/delete-chat.ts` `ownsCopy`, `project-commands.ts` setup, `workspace-root.ts` `vcsFolderOf`, `workspace-changes.ts` and `chat/folder-hold.ts` (local sessions in a folder).
- Web: `routes/session-page.tsx` (993 lines; inline place and hand-off/delete availability), `chat/setup-row.tsx` (local `ChatPlace`), `routes/new-chat-page.tsx`, `routes/workspace-settings-page.tsx`, `workbench/chat-folder.ts`, `chat/hand-off-dialog.tsx` (one hyphen from `handoff-dialog.tsx`, the agent switch).
- `server/src/orchestration-routes.ts` -- `WorktreePutAwayError` unmapped. `adapters/src/workspace-files-node/index.ts` -- chat-worktree root fenced to the data folder only.

## Tasks & Acceptance

**Execution:**
- [x] `core/src/build-start.ts` + tests -- `refuseLocalOnly` before the probe and in `prepareContinue` (the session's current agent).
- [x] `server/src/start-env.ts`, adapters index -- `agentEnvironment` through `withAbsolutePath`; unit, real-agent and pane tests. Commit alone.
- [x] `shared/src/where-work-runs.ts` -- `ChatPlace`, `chatPlaceOf`, `localPlaceOf`, `inOwnWorktree`; one `Branch`; hand-off refusal texts shared with `entities.ts`; tests.
- [x] core and web call sites above through them; core `localFolderOf` for the three "local sessions in this folder" filters; web `ChatPlace` interface renamed `LocationChoice`; session-page's chat-action availability moved to `chat/chat-actions.ts`.
- [x] `chat/hand-off-dialog.tsx` renamed `move-chat-dialog.tsx` (`MoveChatDialog`).
- [x] dead code: `TRIAL_WAITING_TEXT`; local-only `export`s in epic 27 web modules.
- [x] `orchestration-routes.ts` maps `WorktreePutAwayError` to 409 `worktree_put_away`; `workspace-files-node` takes `chatWorktreesRoot` (server passes `<data>/cw`); tests.
- [x] `deferred-work.md` and the 27.x plans -- each Deferred line ends with its 27.9 disposition; logged ones indexed; 8.12's agent-PATH entry resolved.

**Acceptance Criteria:**
- Given `pnpm test` run twice (load below 40 at each start), then both pass; typecheck, touched Playwright specs, secret scan and provenance pass.
- Given the sweep, then its list of changes and dispositions is in Implementation Notes.

## Implementation Notes

The changes (27.9), each behaviour-preserving unless named:

- Security (a): `core/src/build-start.ts` `refuseLocalOnly` refuses an attended remote start (and a queued dispatch, which runs `validateStart`) before the probe's `remote.connect`, and Retry or Resume (`prepareContinue`) before the push, for the session's current agent (Continue with another agent may have changed it). `BuildRefusedError` `sandbox_unavailable` with the agent's `localOnly` words. Tests: `core/test/build-remote.test.ts` (no connect, no push, no git call, no session; Retry after a hand-off to the Local model; another agent still starts); `builds-harness.ts` `localOnly`.
- Security (b): `server/src/start-env.ts` `agentEnvironment` goes through 8.12's `withAbsolutePath` (now exported from the adapters index), so agents and the git and sandbox processes built from that environment get only absolute PATH folders. Panes (`paneEnvironment`) untouched. Tests: `server/test/chat.test.ts` (unit, POSIX and Windows spellings; a real fake-agent process sees no empty or relative entry), `adapters/test/terminal-pane.test.ts` (a pane keeps `/bin::rel:.`).
- Shared place model (`shared/src/where-work-runs.ts`): `ChatPlace` (`SessionLocation['kind']`), `chatPlaceOf` (machine, then a worktree path with its branch, else this folder), `localPlaceOf` (the hand-off's `ChatLocation`), `inOwnWorktree` (type guard: no machine, a path with its branch; true exactly when `chatPlaceOf` says `worktree`). One branch schema, `WorktreeBranch`, exported from `events-where-work-runs.ts` (internal: not re-exported by `events.ts`) and used by both modules. Hand-off refusal texts shared with `entities.ts`: `HANDOFF_CHAT_ONLY_TEXT`, `HANDOFF_REMOTE_TEXT` (= `CHAT_REMOTE_FIXED_TEXT`), `handOffAlreadyThereText`, `HANDOFF_MID_TURN_MESSAGE`. Tests in `shared/test/where-work-runs-contracts.test.ts`.
- Core call sites: `entities.ts` `setSessionWorktree` (payload through `localPlaceOf`, the shared texts), `chat/location.ts` (`requireMovable`, `chatLocation`, the cast in `moveChat` replaced by the guard), `chat/put-away.ts` `ownCopy`, `worktree-retention.ts` candidates, `worktree-ports.ts` `eligible`, `chat/context.ts` `portOf`, `chat/ignored-files.ts`, `chat/delete-chat.ts` `ownsCopy`, `project-commands.ts` `runSetup`, `workspace-root.ts` `vcsFolderOf` (the root kind keeps reading `worktreePath`, as `sessionFolder` does), `workspace-changes.ts` commit. New `workspace-root.ts` `localFolderOf` for the three "local sessions in this folder" filters (hand-off's others, `folder-hold.ts`, `workspace-changes.ts` `refuseMidTurn`). Where a site read the path alone it now reads path and branch, and `ownsCopy` now also reads no machine; rows hold both or neither (`checkedWorktree`) and a remote chat is never made with a worktree (`CHAT_WORKTREE_REMOTE_TEXT`), so no row answers differently.
- Web call sites: `chat/chat-actions.ts` (new) holds Continue, Delete chat and Hand off availability, moved out of `routes/session-page.tsx` (993 to 968 lines), which reads its place through `chatPlaceOf` (the machine badge) and `localPlaceOf` (the hand-off target; path and branch, as core). `chat/setup-row.tsx` interface `ChatPlace` renamed `LocationChoice`; `routes/new-chat-page.tsx` reuse check, `routes/workspace-settings-page.tsx`, `workbench/chat-folder.ts` `chatWorktree`, `workbench/workbench-changes.tsx` through the shared helpers.
- Naming: `chat/hand-off-dialog.tsx` renamed `chat/move-chat-dialog.tsx` (`MoveChatDialog`, `MoveChatDialogProps`); the page's `handOffOpen` is `moveOpen`.
- Dead code: `TRIAL_WAITING_TEXT` removed (the words stay in EXPERIENCE.md, logged). `export` dropped where only the module used it: `useCopyIgnoredFiles`, `PutAwayCopiesView`, `WorktreeCopyStatusView`, `fetchWorktreeRetention`, `fetchPutAwayWorktrees`, `restoreWorktree`, `WorktreeSetupView`, `trialQueryKey`, `fetchTrials`, `fetchTrial`. Exported `*Props` interfaces kept (the web's convention).
- `server/src/orchestration-routes.ts` maps `WorktreePutAwayError` to 409 `worktree_put_away` (was a 500); test in `server/test/orchestration-contract.test.ts`.
- The chat-worktree root fence: `adapters/src/workspace-files-node` takes `chatWorktreesRoot` (absent: the data folder, as before); the server passes `chatWorktreesRootOf(dataDir)` (`<data>/cw`), so a `chat_worktree` root elsewhere in the data folder is `protected`. Tests: `adapters/test/workbench-adapters.test.ts`; `server/test/workbench-routes.test.ts` now makes its copy in `<data>/cw` as core does.
- Dispositions: every Deferred line of the 27.1 to 27.8 plans ends with `27.9:` fixed, done by an earlier story, settled by a decision, or logged. 22 logged lines are new Log entries in `deferred-work.md`, each indexed; 8.12's agent-PATH entry is `Resolved:` (index line removed); the 8.2 chat-worktree fence entry is closed for the adapter's part (`Resolved (the adapter's part, 27.9):`), its index line reworded to core's check at creation, which stays open.

Not done here: the plan's "commit alone" for the two security changes. The build was run with no commits allowed, so all changes are in the working tree; the orchestrator should commit the security files (`core/src/build-start.ts`, `core/test/build-remote.test.ts`, `core/test/builds-harness.ts`, `server/src/start-env.ts`, `adapters/src/index.ts`, `server/test/chat.test.ts`, `adapters/test/terminal-pane.test.ts`) on their own first.

Review patches (pass 1, rows 1 to 6): a queued remote run's dispatch (`validateStart` with `self`) also refuses its session's current agent when local-only (`build-remote.test.ts`, shown to fail without it); `withAbsolutePath` drops a PATH key with no absolute folder left instead of setting it empty (`program-launch.test.ts`); the chat-worktree fence keeps "strictly inside the real data folder" and refuses every root when `<data>/cw` is a link (`workbench-adapters.test.ts`, POSIX); the real-agent PATH test compares with the real PATH's absolute folders; `resolveWorkspaceRoot`'s kind restored to `worktreePath`.

Verification after the review patches (2026-11-01): `pnpm typecheck` clean; `pnpm test` twice back to back (load 3 and 19 at start), both passed, 487 files, 6342 passed, 13 skipped; after `pnpm run build`, ten Playwright specs (command-palette, composer-setup-row, handoff, remote-target, try-several-agents, workbench-changes, workbench-files, workspaces, worktree-chat, worktree-retention) 23 passed (`--retries=0`); secret scan clean; provenance passes. Commits: the two security changes alone, then the sweep.

## Plan Change Log

## Review Triage Log

Pass 1 (quick lens; a fresh subagent given only the code diff and the repo's rules): 7 findings; medium 3, low 4, false 0, maybe-false 0; patched 6, rejected 1, deferred 0.

| # | Finding | Verdict | Route |
|---|---------|---------|-------|
| 1 | `workspace-files-node` `chatRootAllowed` checks only realpath(`<data>/cw`), so a linked `cw` lets a root anywhere (an ancestor of the data folder) drop the data fence | medium | patch: both checks (inside the real data folder, and `cw` itself not a link); linked-`cw` test |
| 2 | The new adapter test skips `locate` and the linked case | low | patch, with 1 |
| 3 | `withAbsolutePath` sets `PATH=''` when nothing absolute is left, which execvp and shells read as the working folder; now behind every agent | medium | patch: the key is dropped instead; unit case |
| 4 | The real-agent PATH test's `folders.length > 0` can never fail | low | patch: the agent's PATH must equal the real PATH's absolute folders |
| 5 | A queued remote run's dispatch checks `run.agent`, not its existing session's agent, which Continue with another agent may have changed to the Local model | medium | patch: `validateStart` with `self` also checks that session's agent |
| 6 | `resolveWorkspaceRoot`'s `kind` (now `inOwnWorktree`) and `path` (`sessionFolder`) can disagree for a row with a machine and a path | low | patch: `kind` restored to `worktreePath === null` (behaviour-preserving, as 8.12 row 1) |
| 7 | The web's "has its own worktree" (settings, workbench) is stricter: no machine and a branch too | low | reject: intended (Design Notes: one rule, core's); real rows have path and branch together and no remote chat has a worktree (`createChatSession` refuses it) |

## Design Notes

`ChatPlace` is `SessionLocation['kind']`, so the response, the composer and core say one thing. `chatPlaceOf` checks the machine first, then a worktree path with its branch (core's rule; the web had path only), else this folder. `ChatLocation` stays the picker's and hand-off's two places. Put-away stays a server fact (the location response and the put-away list), not derived from the row.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: clean
- `pnpm test` twice -- expected: both pass
- `pnpm run build && pnpm exec playwright test <touched specs> --retries=0` -- expected: pass
- `node scripts/secret-scan.mjs`; `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs` -- expected: pass
