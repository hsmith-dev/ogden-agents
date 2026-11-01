---
title: 'Refactor sweep (epic 8)'
type: 'refactor'
ticket: '12'
created: '2026-11-01'
status: 'in-review'
baseline_revision: '17a9d78c8efd00c1513de6b85f957407c0a2473a'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-v2-developer-experience/epic-v2-developer-experience.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 8's eleven stories were built in parallel worktrees, each leaving a "Deferred (for the sweep)" list; Developer mode's pane-launcher detection (released code) runs each program's `--version` with the server's PATH unfiltered (an empty or relative entry) and the temp folder as its working folder, so a planted program can run (the weakness 8.10 closed in the editor launcher), and linked-command resolution and the Problems runner each filter PATH their own way; "a chat's folder" is computed inline in several places; `antigravity-setup.spec.ts:89` and `workspaces.spec.ts:131` are flaky.

**Approach:** As the epic 26 sweep (26.9): one shared adapter helper for launching a program safely (only absolute PATH entries, Windows drive-letter ones; the allowlisted environment; the user's home as working folder, else the filesystem's root, never the temp folder) used by the editor launcher, pane-launcher detection, linked-command resolution and the Problems runner, in its own self-contained commit with tests that plant a program behind an empty and a relative PATH entry; `sessionFolder` (core `workspace-root.ts`) behind every epic 8 root, and the palette's Files on a worktree chat searching that chat's worktree; both flaky tests fixed at their cause; small duplication and dead code in epic 8's code fixed; every Deferred line fixed, marked done by a later story, or logged and indexed in `deferred-work.md`.

## Boundaries & Constraints

**Always:** the PATH fix commit touches only the helper, its four users and their tests, so it cherry-picks onto the release; no behaviour change beyond the PATH and working-folder rule and the palette's worktree search; AGENTS.md (no em or en dashes in UI strings, no copied code, files under 600 lines); `deferred-work.md` header rules (index phrase copied verbatim from a one-line summary); `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs` passes.

**Never:** weaken what a test proves; widen any environment allowlist; change the environment of agent chat processes or terminal panes (logged for a decision instead); change API status codes; edit EXPERIENCE.md or the architecture; touch epic 27 work.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Empty PATH entry | `PATH=/abs/bin::` and a planted `helper` in the working folder; the found program calls bare `helper` | the planted `helper` never runs, in detection, the editor launch and a Problems run | the program fails or answers without it |
| Relative PATH entry | `PATH=/abs/bin:rel` with `rel/helper` planted | same: never runs; linked-command resolution never finds `rel/prog` | "couldn't find" in plain words |
| Working folder | HOME absolute / unset or relative | detection and editor start in HOME / in `/` (Windows `%SystemRoot%`, else `C:\Windows`) | n/a |
| Worktree chat | palette open on a chat with a worktree | Files lists the worktree's names; opening one keeps `?session=` | n/a |

</frozen-after-approval>

## Code Map

- `packages/adapters/src/editor-launcher-node/index.ts` -- `editorEnvironment` (absolute-PATH filter, the model), `homeOf` (home else `tmpdir`), `absoluteDir`; `EditorSystem.tmpdir` only feeds `homeOf`.
- `packages/adapters/src/pane-launchers/detect.ts` -- `candidatesFor` already drops non-absolute PATH dirs (shared with the editor); `probeEnvironment` passes PATH unfiltered; `nodeDetectSystem.probe` uses `cwd: tmpdir()`; `DetectSystem.probe(path, env)`. `server/src/start-panes.ts:51` spreads `nodeDetectSystem` (keep compatible).
- `packages/adapters/src/acp-base/linked-command.ts` -- `resolveProgram` drops only empty PATH dirs (relative ones searched); `findProgram` (Problems) rebuilds PATH with `paths.isAbsolute` (on win32 accepts `\dir`).
- `packages/adapters/src/project-commands-node/index.ts` -- spawn env `baseEnvironment(from)` keeps the raw PATH; cwd is the project (by design).
- `packages/adapters/src/child-env.ts` -- `helperEnvironment`, `DESKTOP_SESSION`, `WINDOWS_FOLDERS`; untouched (agents and panes keep theirs).
- Tests: `adapters/test/{editor-launcher-node,pane-launchers,linked-command,project-commands-node,child-env}.test.ts`.
- `packages/core/src/workspace-root.ts` -- `sessionFolder`, `vcsFolderOf` and `resolveWorkspaceRoot` (both inline the worktree-else-project rule); users `workspace-changes.ts`, `turn-snapshots.ts`, `workspace-files.ts`, `editor-launch.ts`, `project-commands.ts`.
- `packages/web/src/palette/palette-sources.ts` `useFileItems`, `workbench/workbench-api.ts` `usePaletteFileSearch` (no `session`); web inline folder: `routes/session-page.tsx:144`, `workbench/workbench-changes.tsx:163`.
- `tests/e2e/antigravity-setup.spec.ts:89` -- CI: "Finish signing in" not seen; the route handler writes the consent file as the tab opens, so sign-in can finish before the check. `tests/e2e/workspaces.spec.ts:131` -- fails 15 of 15 here: alpha's first turn ends after the test sets the chat `working`, putting it back to idle, so Delete history goes through.
- `_bmad-output/initiative-ogden-agents/deferred-work.md`; the eleven 8.x plans' Deferred sections.

## Tasks & Acceptance

**Execution:**
- [x] `packages/adapters/src/program-launch.ts` (new) -- `absolutePathFolders`, `withAbsolutePath(env, platform)`, `launchEnvironment(extra, source, platform)`, `safeWorkingFolder(env, platform)`; exported from the adapters index if a server user needs it.
- [x] editor launcher, `pane-launchers/detect.ts` (probe gets `{ env, cwd }`), `linked-command.ts` (`resolveProgram` and `findProgram` through the helper), `project-commands-node` (env through `withAbsolutePath`) -- use the helper; drop `EditorSystem.tmpdir`.
- [x] tests -- real planted-program tests (POSIX) for an empty and a relative entry in detection and Problems; unit cases for the editor, linked commands and the helper; commit alone (the PATH fix).
- [x] `core/src/workspace-root.ts` -- `resolveWorkspaceRoot` and `vcsFolderOf` through `sessionFolder`; web `chatFolder` helper for the two inline spots; palette Files passes the worktree chat (search and open).
- [x] `tests/e2e/antigravity-setup.spec.ts`, `workspaces.spec.ts` -- hold the consent until the in-progress text is checked; wait for alpha's chat to be idle before marking it working.
- [x] small dedupe and dead code from the survey (Implementation Notes list).
- [x] `deferred-work.md` and the 8.x plans -- each Deferred line ends with its 8.12 disposition; logged ones indexed.

**Acceptance Criteria:**
- Given `pnpm test` run twice (load below 40 at each start), then both pass.
- Given the sweep, then its list of changes and dispositions is in Implementation Notes.

## Implementation Notes

Implemented directly by the build session (it had done the investigation; the PATH fix needed its own cherry-pickable commit), not by a separate implementation subagent.

Changes (8.12 sweep):
- PATH fix, split in two commits. `fef87357` (cherry-picks cleanly onto `origin/main`, checked with `git merge-tree`; the adapters suite passes on it alone): `packages/adapters/src/program-launch.ts` (`absolutePathFolders`, `envValue`, `withAbsolutePath`, `launchEnvironment`, `safeWorkingFolder`, `windowsCmd`); `pane-launchers/detect.ts` uses it for the lookup, the version request's environment (PATH only absolute folders) and working folder (home, else `/`, Windows `%SystemRoot%`, never the temp folder), and `cmd.exe` (a drive-letter `ComSpec` ending in `cmd.exe` only; the deferred "unchecked ComSpec"); `DetectSystem.probe(path, { env, cwd })`; `linked-command.ts` `resolveProgram` searches only absolute folders (it searched relative ones). `9916a160`: the editor launcher (`editorEnvironment` is `launchEnvironment(DESKTOP_SESSION)`, working folder `safeWorkingFolder`, `EditorSystem.tmpdir` removed, its own `cmd.exe` choice now `windowsCmd`) and the Problems runner (the command's own PATH keeps only absolute folders, so `node` behind npm's shim is never one planted in the project); `findProgram` no longer rebuilds PATH. Tests: `test/program-launch.test.ts`, `test/planted-program.ts` (a real program that runs a bare `helper`, with a planted `helper` behind an empty and a relative entry); real runs in `pane-launchers.test.ts`, `editor-launcher-node.test.ts`, `project-commands-node.test.ts`; unit cases in `linked-command.test.ts`, `pane-launchers.test.ts`, `editor-launcher-node.test.ts`.
- A chat's folder: core `sessionFolder(workspace, session | undefined)` is behind `resolveWorkspaceRoot` and `vcsFolderOf` (both had the rule inline), so files, search, changes, hunks, snapshots and editor opens root the same way; `namedSession(value)` replaces seven `(x as { session?: unknown } | null | undefined)?.session` casts. Web `workbench/chat-folder.ts`: `chatWorktree`, `chatRoots` (the chat page's Open in editor roots), `sessionKey` (the chat query's key, three places), `useWorktreeChat`. The palette's Files on a worktree chat searches that worktree and opens the file with `?session=` (`usePaletteFileSearch(…, session)`); test in `command-palette.dom.test.tsx`. Problems stays project-rooted by design (8.9).
- Flaky: `antigravity-setup.spec.ts:89`: the route wrote the fake's consent on the tab's visit, so sign-in could finish before "Finish signing in" was checked (the CI failure's received text was already "Installed, signed in"); consent is now written after that check (on POSIX once the tab reached the stand-in page). `workspaces.spec.ts:131`: failed 15 of 15 here (Delete history went through): alpha's first turn ended after the test set the chat `working` by hand, putting it back to `idle`; the test now waits for the chat's `idle` state first. Both 20 of 20 under `--repeat-each=10 --retries=0`, twice. No assertion removed.
- Dedupe and dead code (from a read-only survey): core `issuesOf` (errors.ts; the epic 8 use-cases and `refuseInvalid`); shared `UNIFIED_HUNK_HEADER` (vcs-git and the web diff parser had the same regex); `WORKSPACE_SEARCH_MAX_FILE_BYTES` (unused) deleted; adapters `platformKey` shared (editor, detection); server `test-confined.ts` (`inside`, `confinedEnvironment`; the editor's and the panes' test confinement were copies); server `workbench-refusal.ts` (`NO_STORE`, `workbenchRefusal`, so `workbench-routes.ts` no longer imports `workspace-files-routes.ts`; the architecture rule covers it); web `worktree-commit.tsx` (Commit these changes out of `workbench-changes.tsx`, 634 to 568 lines; `isBusy` for its two inline state checks; prop `session`).

Deferred dispositions: every Deferred line in the eleven 8.x plans now ends with its 8.12 disposition. Fixed here: 8.10's pane-launcher probe, 8.11's worktree palette search. Done by a later story: 8.3's "8.7 reuses `ui/syntax/`" (0ef09b61), 8.7's Cmd/Ctrl+click and viewer Open in editor (8.10), and 8.7's Problems and search links (8.8, 8.9; tool rows logged). The other 48 (the links line for its tool rows) are Log entries in `deferred-work.md`, each indexed in Open items, plus two found here: agent chat processes and terminal panes still inherit relative PATH entries (a decision for the user), and the sweep's leftovers (`vcs-git/working-tree.ts` 763 lines, `dev-tools-catalog`'s own `candidatesFor`, `linesOf` twice, a file name taken three ways in the web, three different "inside" checks, local-only exports).

Verification (2026-11-01): `pnpm typecheck` clean. `pnpm test`: run 1 (load 13 at start) 1 failure, the architecture test's Workbench route file count (2, now 3 with `workbench-refusal.ts`; fixed); runs 2 and 3 back to back (load 22 and 25 at start) both passed, 460 files, 5962 passed, 13 skipped. Playwright after the build: antigravity-setup, workspaces, command-palette, panes, workbench-changes, workbench-files, workbench-problems 24 passed (`--retries=0`). Provenance passes.

## Plan Change Log

## Review Triage Log

## Design Notes

The working folder: on Linux the temp folder is shared and writable by every user, and on Windows `cmd.exe` and `CreateProcess` search the working folder before PATH, so a launch helper never starts there; the home folder is the user's own, and without an absolute one the filesystem root (`/`, `%SystemRoot%`) is not writable by a normal user. Agent chat processes and panes inherit the base environment's PATH as is; changing that touches every agent and the user's terminals, so it is logged for a decision, not changed here.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: clean
- `pnpm test` twice -- expected: both pass
- `pnpm run build && pnpm exec playwright test tests/e2e/antigravity-setup.spec.ts tests/e2e/workspaces.spec.ts <other touched specs> --repeat-each=10 --retries=0` -- expected: pass
- `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs` -- expected: pass
