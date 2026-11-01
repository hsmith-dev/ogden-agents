---
title: 'Epic contracts and stubs: files, search, diff views, hunk actions, project commands, editor launcher; routes and events'
type: 'feature'
ticket: '2'
created: '2026-11-01'
status: 'built'
baseline_revision: '45b95ea7c22b18b7877f1aefc4a8b5038d87cf88'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: ['{project-root}/AGENTS.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 8's lanes (diff viewer, Changes, hunks, comments, viewer, search, Problems, editor) and epic 27's worktree chats need one set of shared contracts before they can start in parallel; today only 8.1's list and read exist (E8-R1, R4, R5, R8, R9; AD-36 to AD-39).

**Approach:** Add the shared schemas, caps, texts, error codes, events and `API_ROUTES` for search, the four change views, turn snapshots, hunk actions, a worktree chat's commit, project commands and the editor launcher; the core ports and use-cases with in-memory stubs; the chat `worktreePath` and `branch` fields (set at creation, never changed, AD-8 CAP-33 note) and the worktree-chat file root; every route registered behind the AD-15 gate (501 until its lane wires it); the palette-derived syntax tokens; and architecture tests.

## Boundaries & Constraints

**Always:** client paths are `WorkspaceRelativePath` only (never absolute); a `session` query or param roots files and changes at that chat's `worktreePath` when it has one (else the project), and a session of another project is 404; event payloads carry ids, states, exit codes and counts only (`.strict()`), never file content, output, a diff or a path; content, diffs and output are GET responses with `Cache-Control: no-store`; hunk actions and commit are refused (409 `agent_mid_turn`) while a session in the same folder is `working` or `waiting`; `{error:{code,message}}`; no em or en dashes in UI strings; no git or `child_process` in core, shared, web or a route file.

**Never:** a real git implementation of the new `VcsPort` operations (8.4, 8.5), a search implementation in `workspace-files-node` (8.8), a project-command runner or parser (8.9), a real editor adapter (8.10), creating worktree chats (27.3), UI panels; putting any of these routes on a device allowlist; editing `deferred-work.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Worktree root | `?session=` a chat with `worktreePath` | list/read/search/locate use that worktree (data-dir fence lifted only for it) | none |
| Foreign session | session of another project, or unknown | | 404 `not_found` |
| Search capped | memory port, 600 matches | 500 matches, `truncated: true` | none |
| Search not built | node port (no `search`) | | 501 `not_implemented` |
| Hunk mid-turn | a `working` chat in the same folder | nothing applied | 409 `agent_mid_turn` |
| Hunk outdated | memory port reports changed since | nothing applied | 409 `hunk_outdated` |
| Commit plain chat | session without `worktreePath` | | 409 `invalid_operation` |
| Commit worktree chat | memory vcs | `{revision, files}`; `session.worktree_committed` with counts only | none |
| Editor path | `../x`, `.git/config` | launcher never called | 400 / 403 `path_protected` |
| Session fields | `createSession` with `worktreePath` and branch `ogden/chat/<id>` | stored, on `session.created`; old rows read `null` | wrong branch or one without the other: `ValidationError` |
| Unwired lanes | changes, project commands, editor routes on the real server | | 501 `not_implemented` |

</frozen-after-approval>

## Code Map

The project root is the git worktree `/Users/harrisonsmith/Library/Caches/ogden-agents-dev-worktrees/8.2`: every path below is relative to it and every command runs there; never edit another checkout, never `git stash` (shared with other worktrees), push or switch branches, and do not commit (the orchestrator commits). The machine is loaded by unrelated builds: re-run a timing failure alone.

- `packages/shared/src/workspace-files.ts`, `api.ts`, `errors.ts` (`API_ERROR_CODES`), `ids.ts` (`turn: 'trn'`, `projectCommandRun: 'pcr'`), `index.ts`, `entities.ts` `Session` (add next to `machineId`, `.nullable().default(null)`), `events.ts` (`CoreEvent`, `NewCoreEvent` unions, re-exports), `events-dev-tools.ts` (small event module pattern).
- `packages/core/src/workspace-files-port.ts`, `workspace-files.ts` (8.1's `rootOf`, `checked`, `answer`, `isRefusedWorkspacePath`) -- extend; keep every 8.1 refusal unchanged.
- `packages/core/src/vcs-port.ts` -- add a separate `VcsWorkingTreePort` interface here (VcsPort's working-tree half, AD-37) so the existing `VcsPort` implementers and test fakes stay untouched.
- `packages/core/src/entities.ts` `createSession` (`machineId` pattern, line ~500), `toSession`; `db/schema.ts` sessions; `pnpm --filter @ogden-agents/core db:generate` for `0039_*.sql`. `ids.ts` `newId`.
- `packages/core/src/core.ts` -- options like `workspaceFilesPort`; each new use-case `undefined` without its port.
- `packages/adapters/src/workspace-files-node/index.ts` -- `fences()`, `resolveChecked`: take the new root kind; add `locate`. `vcs-memory/index.ts` -- stub pattern; add the working-tree half there.
- `packages/server/src/workspace-files-routes.ts` (pattern, refusal mapping), `app.ts` (`AppOptions`, registration), `start.ts:208` wiring, `errors.ts` `notImplemented`; `test/gate.test.ts` `EXPECTED_API_ROUTES`; `test/helpers.ts` `fullTestApp`.
- `packages/web/src/ui/theme.css` (`--color-*` map), `ui/tokens.css` (syntax and diff tokens already there), `appearance/palette.ts` `applyPalette` custom branch (`mix`, `contrast`, `STATUS_SURFACES`); `tests/design-tokens.test.ts`, `packages/web/test/palette.test.ts`.
- `tests/architecture.test.ts` -- `loadWorkspaceSources`, `withoutComments`, `SPECIFIER`; add with a planted-violation case like the others.
- Session fixtures typed `Session` (`grep -rl "machineId: null" packages`) gain the two fields.

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/workspace-files.ts` -- `WorkspaceFilesQuery` (`path?`, `session?`), `WorkspaceSearchQuery` (`q` 1..200, `mode: text|names`, `matchCase`, `session?`), `WorkspaceSearchResponse` (files with matches `{line, column, preview}`, `truncated`, `limit`), caps and texts (Design Notes), `OpenInEditorRequest` -- search and editor contracts.
- [x] `packages/shared/src/workbench-changes.ts` -- `ChangesView` (`turn|unstaged|staged|branch`), `ChangedFile` (`path`, `previousPath?`, change word, `additions`, `deletions`, `binary`, `tooLarge`), `DiffHunk` (`id`, ranges, lines `{kind, text, oldLine?, newLine?}`), `ChangesResponse` (`base?`, `files`, `truncated`), `FileDiffResponse`, `HunkActionRequest` (`action: stage|unstage|revert`, `view`, `path`, `hunkId?` absent is the whole file, `session?`, `turn?`), `TurnSummary`, `CommitWorktreeRequest/Response`, `chatWorktreeBranch(id)`, texts from EXPERIENCE.md (mid-turn, outdated, too large, binary); events `session.turn_changes_recorded` (`sessionId`, `turnId`, `startTree`, `endTree`, `files`, `additions`, `deletions`) and `session.worktree_committed` (`sessionId`, `branch`, `revision`, `files`).
- [x] `packages/shared/src/project-commands.ts` -- `ProjectCommandId` slug, `ProjectCommand` (`id`, `label`, `command`, `source: settings|package_json`, `confirmed`), `ProjectCommandsResponse` (declared, offered), `SetProjectCommandsRequest` (each with the exact text confirmed), `ProjectCommandRun` (`id`, `commandId`, `state: running|passed|failed|stopped|error`, `exitCode`, `itemCount`, times), `ProblemItem` (`path`, `line`, `column?`, `message`, `format`), `ProjectCommandRunDetail` (masked `output`, `truncated`, `items`, `parsed`); events `workspace.project_command_started` / `_finished` (ids, state, exit code, counts).
- [x] `packages/shared/src/editors.ts` -- `EditorId` (slug; the fixed list lives in the adapter), `EditorInfo`, `EditorsResponse`, `OpenInEditorResponse`.
- [x] `packages/shared/src/api.ts`, `errors.ts`, `ids.ts`, `entities.ts`, `events.ts`, `index.ts` -- routes (Design Notes), codes `agent_mid_turn`, `hunk_outdated`, `editor_unavailable`, ids, `Session.worktreePath` and `branch`, event registration.
- [x] `packages/core/src/workspace-files-port.ts`, `workspace-files.ts` -- `WorkspaceRoot` `{path, kind: project|chat_worktree}` passed to `list`, `read`, optional `search`, `locate` (absolute real path of an allowed file, for the launcher); use-case takes `session` and `search` (present only when the port has it, else route 501), clamps results to the cap.
- [x] `packages/core/src/vcs-port.ts`, new `workspace-changes.ts` -- `VcsWorkingTreePort` (`changedFiles`, `fileDiff`, `applyHunk`, `snapshot`, `commitAll`) and a use-case: views, file diff, hunk action and commit, each refusing mid-turn (`working`/`waiting` session whose folder is the same) and commit refusing a chat without `worktreePath`; commit appends `session.worktree_committed`; turns read from `session.turn_changes_recorded`.
- [x] `packages/core/src/editor-launcher-port.ts`, `editor-launch.ts`, `project-commands.ts` -- `EditorLauncherPort` (`list`, `open(editorId, absolutePath, line?, column?)`) and a use-case that checks the path as files do and resolves it through `locate`; `ProjectCommandRunner` contract and `ProjectCommands` use-case interface only (8.9 implements).
- [x] `packages/core/src/entities.ts`, `db/schema.ts`, migration, `core.ts`, `index.ts` -- `createSession` takes `id?`, `worktreePath?`, `branch?` (both or neither, absolute path, branch `ogden/chat/<id>`); new options `vcsWorkingTreePort`, `editorLauncherPort`.
- [x] `packages/adapters/src/workspace-files-node/index.ts` -- `WorkspaceRoot` (data-dir fence skipped only for `chat_worktree`, everything still inside the root), `locate`; `packages/adapters/src/workspace-files-memory/`, `vcs-memory` working-tree half, `editor-launcher-memory/` (records calls), `project-commands-memory/` runner stub; `index.ts`.
- [x] `packages/server/src/workspace-files-routes.ts`, new `workbench-routes.ts`, `app.ts`, `start.ts` -- every route registered, 501 when not wired, refusal mapping as 8.1, `no-store`; start wires only the node files port as today.
- [x] `packages/web/src/ui/theme.css`, `appearance/palette.ts` -- `--color-syntax-*`, `--color-diff-*` Tailwind entries; the custom palette derives each syntax token and the gutter from its default mixed toward foreground until 4.5:1 on the custom surfaces.
- [x] Tests: shared schema tests (caps, strict events, absolute paths refused); core tests for session root, search clamp, mid-turn refusal, commit, editor path refusals, `createSession` fields; adapter tests for the chat-worktree root and `locate`; server route tests (501s, 404 foreign session, worktree root, search via memory port); `gate.test.ts` list; palette contrast test over every syntax token and surface in both themes; `tests/architecture.test.ts` checks below.

**Acceptance Criteria:**
- Given every Workbench route, when the architecture test reads its shared request schemas, then each path field is `WorkspaceRelativePath` and no route template has a `:path` param.
- Given core, shared and web sources and the Workbench route files, when scanned, then none imports `child_process` or names a `git` command (planted cases flagged).
- Given every event schema this story adds, when a payload with `content`, `output`, `diff`, `patch`, `preview` or `path` is parsed, then it is rejected.
- Given the change, when `pnpm typecheck` and `pnpm test` run, then both pass with 8.1's tests unchanged.

## Implementation Notes

- Files port: `list`/`read` keep `(root, path)` and take the root's kind as an optional third argument (`WorkspaceRootKind`, default `project`) instead of a `WorkspaceRoot` object, so 8.1's tests and fakes stay unchanged; `WorkspaceRoot {path, kind}` is exported and is what core resolves (`workspace-root.ts`). `search` and `locate` are optional port methods (a required `locate` would break 8.1's typed fakes); without `locate` there is no editor use-case.
- Routes use `:sesId` for the session param (as every existing session route does), not `:sessionId`.
- `invalid_operation` was a core code only; it is now also an `API_ERROR_CODES` entry, as the matrix's commit refusal needs it.
- The four events live in `packages/shared/src/events-workbench.ts` (pattern of `events-dev-tools.ts`, keeping the `*Input` schemas internal); `events.ts` registers and re-exports them. Contract types stay in `workbench-changes.ts`, `project-commands.ts`, `editors.ts`.
- `AGENT_MID_TURN_MESSAGE` is generic (the server names no agent); the UI's `agentMidTurnText(agentName)` and `agentStartedHereText(agentName)` carry EXPERIENCE.md's sentences.
- Project-command routes delegate to an optional `ProjectCommands` in `AppOptions`; nothing provides one yet, so all five answer 501. Changes and the editor launcher are wired from `core.workspaceChanges` / `core.editorLaunch`, which are `undefined` on the real server (no port in `start.ts`), so 501 too.
- The architecture git-command check exempts `packages/core/src/remote-worktree-sync.ts` (CAP-24, runs git on a remote over SSH; predates this story).
- `bmad-guard-coverage.test.ts`: the new routes are listed as serving no piece; `POST project-commands/:commandId/runs` is also listed as unguarded by design (its `runs` segment).
- Migration `0039_fuzzy_callisto.sql` adds `sessions.worktree_path` and `sessions.branch`.

- Review fixes (pass 1): the mid-turn check skips `build` sessions and remote chats; a `chat_worktree` root must be strictly inside the real data folder; previews are a 240-character window from 80 before the match (`previewAround`), `column` counting in the whole line; the files routes parse `WorkspaceFilesQuery` (a malformed `session` is now 400, a well-formed unknown or foreign one 404); `InvalidOperationError` answers with its own message; the editor use-case resolves the project before the path.
- Verified (after review fixes): `pnpm typecheck` clean; `pnpm test` first run 2 failures under machine load, re-run 5516 passed, 13 skipped (422 files); `workbench-files.spec.ts` passed after `pnpm run build`; provenance check passed.

## Deferred (for the sweep)

- Check order differs: the files routes now parse the path before resolving the project (unknown project with a malformed path is 400), while core's files and editor use-cases resolve the project first (404). Pick one order.
- 27.3 should check a chat's `worktreePath` lies in its chat-worktrees folder at creation; today core checks only that it is absolute, and the adapter only that it is strictly inside the data folder.
- `session.created` carries the absolute `worktreePath` (as the Session does); the no-path rule is enforced only on this story's four events.
- The architecture git-command check exempts `packages/core/src/remote-worktree-sync.ts` (CAP-24, pre-existing).

## Plan Change Log

## Review Triage Log

Pass 1 (2026-11-01; lens: quick). Verdicts: high 0, medium 3, low 3, false 0, maybe-false 0. No intent_gap or bad_plan; all six patched by the implementer.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | A working build session (in its run's worktree) or a remote chat counts as mid-turn in the project folder | medium | patch | `sessionFolder` falls back to the project for any session without `worktreePath`; builds and `machineId` chats skipped in the check |
| 2 | A `chat_worktree` root drops the whole data-folder fence | medium | patch | only `worktreePath` absoluteness is checked; the adapter now refuses a chat-worktree root not strictly inside the data folder (the exact worktrees area is 27.3's layout) |
| 3 | Search previews keep the first 240 characters, losing a later match | low | patch | `slice(0, 240)` against the doc's "cut around the match"; window around the column |
| 4 | `WorkspaceFilesQuery` never parsed, so the architecture check is vacuous for the files routes | medium | patch | routes now parse their query through it |
| 5 | Every `InvalidOperationError` answered with the commit message | low | patch | the error's own message is used |
| 6 | Editor open checks the path before the workspace, unlike the files routes | low | patch | workspace and session resolved first |

## Design Notes

Caps (Decision, autonomous 2026-11-01, settling this entry's `unknown`): search 500 matches in either mode (EXPERIENCE.md's "Showing the first 500 matches"), query at most 200 characters, a match's preview at most 240 characters, at most 20,000 files looked at and 5 seconds, files over 1 MB or binary skipped, any limit hit answers `truncated: true`. Project-command output: the masked output kept is its last 1 MiB (runners print their failure summary last), `truncated` when cut; at most 500 parsed items. Diffs: a file's diff over 1 MiB is `tooLarge` with counts only; at most 1000 changed files listed (`truncated`); the viewer opens the first 20 (`DIFF_FILES_OPEN = 20`).

Routes (under `/api/v1/workspaces/:wsId` unless noted): `GET files/search`; `GET changes?view=&session=&turn=`; `GET changes/file?view=&path=&session=&turn=`; `POST changes/hunks`; `GET sessions/:sessionId/turns`; `POST sessions/:sessionId/worktree/commit`; `GET|PUT project-commands`; `POST project-commands/:commandId/runs`; `GET project-command-runs/:runId`; `POST project-command-runs/:runId/stop`; `POST files/open-in-editor`; `GET /api/v1/editors`. The existing two files routes gain `session`. AD-34's device allowlist is not built yet (epic 24): these routes are documented as off it.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors
- `pnpm test` -- expected: all pass (timing failures re-run alone)
- `pnpm run build && pnpm exec playwright test tests/e2e/workbench-files.spec.ts` -- expected: pass (files routes changed)
- `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs` -- expected: pass
