---
title: 'Open in editor'
type: 'feature'
ticket: '10'
created: '2026-11-01'
status: 'built'
baseline_revision: '91bf4aae86d887b5cc784c3906d1b40142f8eaf2'
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

**Problem:** 8.2 left `EditorLauncherPort`, `POST …/files/open-in-editor` and `GET /editors` answering 501: nothing opens a file at its line in the user's own editor (E8-R9, AD-39, EXPERIENCE.md Open in editor).

**Approach:** An `editor-launcher-node` adapter with a fixed editor list found on `PATH` (absolute entries only) and at known install places, started with argv only, no shell, AD-16's allowlisted environment, for a path only 8.2's use-case located through `WorkspaceFilesPort.locate`; a server-kept choice (Settings, Projects, Editor: **Open files in**, default the first found); Open in editor on the viewer header, the diff file headers (Changes, Review, chat edit rows), Problems items, and `Cmd/Ctrl`+click on path links. One server path serves the desktop app too (its webview has no IPC, AD-15 epic 13 note); the known install places cover a GUI-started server's short `PATH`.

## Boundaries & Constraints

**Always:** the program is only ever one of the adapter's fixed list, resolved by the adapter at each open (never a path from the client, never cached from an earlier list); the file argument is the absolute real path `locate` answered, re-checked absolute; line and column are positive safe integers or absent; for `path:line:col` editors (VS Code, Cursor, Zed) a path holding `:` (beyond a Windows drive's) is refused; a Windows `.cmd`/`.bat` goes through `cmd.exe /d /s /v:off /c` with verbatim, quoted arguments, and a shim path or any argument holding `" % ^ ! & | < > ( )` or a control character is refused; `child_process.spawn` with `env` built by `helperEnvironment(DESKTOP_SESSION)`, `detached`, `stdio: 'ignore'`, `windowsHide`, `cwd` the OS temp folder, an `error` handler, `unref`; "opened" on the `spawn` event, "unavailable" on `error`; a test run (test hooks allowed) looks only inside the folder a hook names, never at the real computer; nothing is logged but a code; no em or en dashes in UI strings; `{error:{code,message}}`.

**Never:** a URL scheme, `open -a`, `xdg-open` or `shell: true`; an editor name or argument from free text; a desktop-specific (Tauri) launch path; probing an editor with `--version` (a JetBrains launcher would start the IDE); editing `deferred-work.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| VS Code | fake `code` on PATH, `src/a.ts` line 12 | argv `-g <real>/src/a.ts:12:1`; 200 `Opened in VS Code` | none |
| JetBrains | fake `idea` only | argv `--line 12 --column 1 <real path>` | none |
| No line | path only | goto editors `:1:1`; JetBrains path only | none |
| Windows shim | `code.cmd` found | `cmd.exe /d /s /v:off /c ""<shim>" "-g" "<path>:12:1""` | `%`/`&`/`!`/... in shim or path: `unavailable`, nothing spawned |
| Colon path | `a:3:x.ts` with VS Code | nothing spawned | 409 `editor_unavailable` |
| Refused path | `../x`, `/etc/passwd`, `.git/config`, `x.git/HEAD`, `.ssh/id`, hard link, link out | launcher never called | 400 / 403 / 404 as files routes |
| Client program | `editorId: "sh"` or `"../code"` | not in list / schema | 409 `editor_unavailable` / 400 |
| Extra body | `{path, args:[...]}` | strict schema | 400 |
| None found | empty PATH | `GET /editors` `[]`, default null | open 409 with `EDITOR_NONE_FOUND_TEXT` |
| Choice | `PUT /editors {editorId:"cursor"}` found | kept in `<dataDir>/editor.json`; default is cursor; open uses it | not found 409; malformed 400 |
| Choice gone | chosen not found now | default falls back to first found | none |
| Spawn fails | ENOENT/EACCES after resolve | | 409 `editor_unavailable` |

</frozen-after-approval>

## Code Map

Project root is the worktree `/Users/harrisonsmith/Library/Caches/ogden-agents-dev-worktrees/8.10`; run everything there; never `git stash`, push or switch branches, and do not commit (the orchestrator commits). The machine is loaded: run focused tests while working (`pnpm exec vitest run <files>`), re-run a timing failure alone.

- `packages/shared/src/editors.ts` -- 8.2 contract: add `chosenEditorId` (nullable) to `EditorsResponse`, `SetEditorRequest` (`{editorId: EditorId | null}` strict), texts (Settings label `Open files in`, page `Editor`, intro, "Couldn't open", `editorOpenFailed…`). `workspace-files.ts` `OpenInEditorRequest` unchanged; `api.ts` `editors` route gains `PUT`.
- `packages/core/src/editor-launch.ts`, `editor-launcher-port.ts` -- 8.2 use-case (project, path, body, `locate`, then launcher). Add the choice: option `choice: {get(): EditorId|null; set(id): void}`; `editors()` default = chosen if found else first; `setChoice(body)`; `open` without `editorId` uses the default. New `editor-choice.ts`: file store `<dataDir>/editor.json` (pattern `onboarding.ts` write: 0600, temp then rename; unreadable reads as null, reported by code). `core.ts:298` wiring takes `dataDir`.
- `packages/adapters/src/pane-launchers/detect.ts` -- `candidatesFor` (bare name on absolute PATH dirs with PATHEXT, `~`/`%VAR%` expansion, missing variable = no candidate) and `nodeDetectSystem.runnable`: export and reuse; the shim metacharacter rule and `cmd.exe` quoting pattern in `probe` (lines ~50-60).
- `packages/adapters/src/acp-base/linked-command.ts` -- `WINDOWS_STARTABLE` rule (only `.exe`/`.com` start without a shell); keep unchanged.
- `packages/adapters/src/child-env.ts` -- `helperEnvironment`, `DESKTOP_SESSION` (GUI session variables, Windows folders).
- `packages/adapters/src/editor-launcher-memory/` -- stub kept; `editor-launcher-node/` (new) -- the adapter; `index.ts` export.
- `packages/server/src/start.ts` (~line 199 `openCore` options), `test-hooks.ts` (`testPanePath` pattern, `PANE_PATH_ENV`; add `OGDEN_AGENTS_TEST_EDITOR_PATH`, same checks, `''` = find nothing), `start-panes.ts:44-57` (restricted `system` pattern), `workbench-routes.ts:168-185` (editor routes), `workspace-files-routes.ts:103` refusal mapping; `test/gate.test.ts:618` `EXPECTED_API_ROUTES`, `test/bmad-guard-coverage.test.ts` lists.
- `packages/web/src/workbench/code-view.tsx` (`ViewerHeader` actions, `ViewerState` gains `actions`), `workbench-files.tsx` (file, markdown, masked, binary, too large, empty get the button; protected, folder, error don't), `ui/diff-viewer.tsx` `fileActions` slot (callers `workbench/workbench-changes.tsx:287` (compose with hunk file actions), `planning/build-review.tsx:84`, `chat/tool-call-row.tsx:156`), `workbench-problems.tsx:459` item row, `path-links.tsx:231` `PathLink` (`Cmd/Ctrl`+click: `preventDefault`, open at its line), `CopyPathButton` feedback pattern (no toast component exists: the button's own word plus a `role=status`).
- `packages/web/src/settings/settings-groups.ts` (Projects pages), `new-project-defaults.tsx` (page, query, `RadioGroup` pattern), `router.tsx` settings routes.
- Tests: `packages/adapters/test/` (fake editor scripts in a temp folder: posix `#!/bin/sh` writing argv to a file, Windows `.cmd` and `.exe` via `platform` overrides), `packages/core/test/editor-launch.test.ts` (8.2), `packages/server/test/workbench-routes.test.ts`, `tests/e2e/workbench-files.spec.ts` (`OGDEN_AGENTS_TEST_EDITOR_PATH` with a fake `code`; panes.spec.ts:224 pattern).

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/editors.ts`, `api.ts`, `index.ts` -- contract additions above -- one contract.
- [x] `packages/core/src/editor-choice.ts`, `editor-launch.ts`, `core.ts`, `index.ts` -- choice store and use-case changes -- the default lives on the server so every tab agrees.
- [x] `packages/adapters/src/editor-launcher-node/index.ts`, `pane-launchers/detect.ts` (export), `index.ts` -- the fixed list (Design Notes), `list()` resolves each editor's first runnable candidate, `open()` re-resolves it, builds argv per syntax, applies the refusals, spawns -- the launcher.
- [x] `packages/server/src/start.ts`, `test-hooks.ts`, `workbench-routes.ts` -- wire the node launcher (test hook folder in a test run), `PUT /editors` -- delivery.
- [x] `packages/web/src/workbench/open-in-editor.tsx` (new) -- `useEditors` (501 or none: disabled with `EDITOR_NONE_FOUND_TEXT` as visible reason via tooltip and `aria-describedby`), `useOpenInEditor`, `OpenInEditorButton` (shows `Opened in VS Code` or the error a moment, announced), `openInEditorClick` for links -- the client half.
- [x] `packages/web/src/workbench/code-view.tsx`, `workbench-files.tsx`, `workbench-changes.tsx`, `chat/tool-call-row.tsx` (with the chat's `session`, only for a path that parses as `WorkspaceRelativePath`), `workbench-problems.tsx`, `path-links.tsx` -- the surfaces.
- [x] `packages/web/src/settings/editor-settings.tsx` (new), `settings-groups.ts`, `router.tsx` -- Settings, Projects, Editor: radio group of found editors, saved on change.
- [x] Tests -- adapter: each editor's argv on darwin, linux, win32 (shim and exe), colon and metacharacter refusals, relative path refused, PATH relative entries ignored, a test-folder system finds nothing outside it, env has no planted key, a real fake `code` script on POSIX records its argv; core: choice default, fallback, set refusals; server: routes 200/400/403/404/409, `PUT`, nothing logged with the path; security rows from the I/O matrix; web: button states; Playwright `workbench-files.spec.ts` opens a file in a fake `code` (argv checked), `Cmd/Ctrl`+click on a link, Settings choice, axe, 390px.

**Acceptance Criteria:**
- Given a fake `code` in the test editor folder, when the user clicks Open in editor on `src/a.ts` at line 12 in the viewer, then the fake records `-g <real>/src/a.ts:12:1` and the button says `Opened in VS Code`.
- Given no editor found, when any surface renders, then Open in editor is disabled with `EDITOR_NONE_FOUND_TEXT`.
- Given `pnpm typecheck` and `pnpm test`, then both pass.

## Implementation Notes

- Colon path row: `WorkspaceRelativePath` (8.2's shared schema) already refuses `:`, so over HTTP `a:3:x.ts` is 400 `invalid_request`, never reaching the launcher; the adapter's own colon refusal stays as a second layer and is unit-tested (`unavailable`, nothing spawned).
- Link out of the project is 403 `path_protected` (as the files routes answer it), not 404.
- `EditorSystem.start` (not `spawn`) so the AD-16 static scan sees only the one real `spawn(...)` call, which passes `env`.
- Open in editor's accessible name is its visible words plus a visually hidden `: <path>` (axe `label-content-name-mismatch` refused an `aria-label` that didn't contain the visible text).
- Review's diff headers open the project's copy of the file (a build's worktree is not a Workbench root: build sessions carry no `worktreePath`), so a file the build added and not yet merged answers "Couldn't open" with the not-found reason.
- `tests/support.ts` `startServer` gives every e2e server an empty launcher unless `OGDEN_AGENTS_TEST_EDITOR_PATH` is set, because e2e servers are not a test run (no `NODE_ENV=test`) and would otherwise look at the real computer.
- `packages/core/test/editor-launch.test.ts` is new (the 8.2 tests live in `workbench-contracts.test.ts`); new `packages/server/test/open-in-editor.test.ts` runs the matrix's path rows through the real files adapter and a fake `code`.

- Review fix: the editor's environment keeps only absolute PATH folders (empty, `.` and relative entries dropped; Windows: drive-letter folders) and it starts in the user's home (absolute, from the environment), the temp folder only without one, so a launcher script's bare `dirname` can't run a program planted in the temp folder.
- Review fix: `cmd.exe` comes from `ComSpec` only when it is a drive-letter path ending in `\cmd.exe`, else from a drive-letter `SystemRoot`, else `C:\Windows\System32\cmd.exe` (no share, no drive-relative path).
- Review fix: in a test run the launcher's folder confinement compares real paths, so a link in the folder that leads out of it is not found (`packages/server/test/start-editor.test.ts`).
- Review fix: a chat edit row's absolute agent path under the chat's folder (its worktree, else the project's path and real path) is made relative to it (separator-aware, no `.` or `..`) before the `WorkspaceRelativePath` check; outside it, no button. The server checks again.
- Review fix: `Cmd`/`Ctrl`+click on a path link with no editor found never follows the link; it announces `EDITOR_NONE_FOUND_TEXT` in the link's status region.
- Review fix: server security rows added: `.env` opens (the user's editor shows the real file; Files masks only what Ogden shows), a link inside the project to `a:3:x.ts` is 409 for VS Code and opens whole in JetBrains, a folder 404, a foreign or unknown chat 404, a malformed chat 400 (core now checks the chat id's shape after the project, as the files routes answer it), a malformed line or extra field 400, `editorId: 'sh'` 409, `-rf.ts` passed as `-g <real>/-rf.ts:1:1`; no log line holds the path.

## Plan Change Log

## Review Triage Log

Pass 1 (2026-11-01; lenses: quick, security). Verdicts: high 1, medium 3, low 6, false 0, maybe-false 0. No intent_gap or bad_plan; patches sent to the implementer, two rejected, two deferred. The security lens probed with throwaway tests (no client input chose the program, injected an argument, reached a shell or opened a refused path); its proposed rows were added to `open-in-editor.test.ts`, `start-editor.test.ts` and `editor-launcher-node.test.ts`.

| # | Lens | Finding | Verdict | Route | Evidence / action |
|---|------|---------|---------|-------|-------------------|
| S1 | security | Child env kept relative/empty PATH entries with cwd in the temp folder: an editor script's bare `dirname` ran a program planted there | high | patch | reviewer reproduced `PWNED`; only absolute PATH entries pass, cwd is home |
| S2 | security | File swapped (parent folder to a symlink) between `locate` and the editor opening it | medium | defer | can't be closed: an editor takes a path, not a handle; content only reaches the user's own screen |
| S3 | security | `.env` opens unmasked in the editor | low | patch | decision: the user's own editor shows the real file (AD-39 hand-off); Files masks only what Ogden shows; pinned by a test |
| S4 | security | `ComSpec`/`SystemRoot` accepted as UNC or drive-less | low | patch | server env only; drive-letter absolute required, else `C:\Windows\System32\cmd.exe` |
| S5 | security | Test editor folder check compared text, a symlink out was found; real wiring untested | low | patch | test runs only; real-path check and `start-editor.test.ts` |
| S6a | security | `CMD_UNSAFE` misses U+0085, U+2028, full-width quote | low | reject | cmd.exe and the editors read the command line as Unicode; no exploit found |
| S6b | security | `editor.json` temp write follows a planted symlink | low | reject | data folder is the user's own (0700), same pattern as `onboarding.json` |
| Q1 | quick | Chat edit rows carry absolute ACP paths, so the button never shows there | medium | patch | `diffsOf` passes `item.path` raw; absolute under the chat's root made relative client-side, server re-checks |
| Q2 | quick | No editor found: Cmd/Ctrl+click on a path link silently follows the link | low | patch | reason announced, link not followed |
| D1 | impl | Review opens the main checkout's copy, not the build worktree's | medium | defer | build sessions have no root the files port can open |

## Deferred (for the sweep)

- Check-then-use gap (S2): `locate` then the editor opens by name a moment later; an agent that swaps a parent folder for a symlink in between gets an outside file shown in the user's editor. A re-check just before spawn would only narrow it. (8.12: logged in `deferred-work.md`.)
- `pane-launchers/detect.ts` `probe` (pre-existing) has S1's shape: the server PATH unfiltered and the temp folder as cwd, and an unchecked `ComSpec`. (8.12: fixed (`packages/adapters/src/program-launch.ts`: absolute PATH folders only, the home folder else the filesystem root as working folder, `cmd.exe` from a drive-letter `ComSpec` only).)
- Review's Open in editor opens the project's copy of a file, not the build worktree's; a file the build added is "Couldn't open" (D1). (8.12: logged in `deferred-work.md`.)
- A file on a remote machine ("This file is on build-box.", EXPERIENCE.md) is not built: a remote chat's file opens nothing special. (8.12: logged in `deferred-work.md`.)
- Windows: the `.cmd` shim path and real `cmd.exe` quoting are unit-tested with a simulated platform only; the e2e suite has run on macOS here. (8.12: logged in `deferred-work.md`.)
- One hidden status region per path link in a long chat; one shared announcer would be lighter. (8.12: logged in `deferred-work.md`.)

## Design Notes

The list (order is the default order; `syntax` `goto` = `-g path:l:c`, `colon` = `path:l:c`, `jetbrains` = `--line l --column c path`). Bare names are searched on PATH; absolute entries are known install places (`~` home, `%VAR%` expanded; unset variable, no candidate):

- `vscode` VS Code, goto: `code`; darwin `/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`, `~/Applications/…same`, `/usr/local/bin/code`, `/opt/homebrew/bin/code`; linux `/usr/bin/code`, `/snap/bin/code`, `/usr/share/code/bin/code`; win32 `%LOCALAPPDATA%\Programs\Microsoft VS Code\bin\code.cmd`, `%ProgramFiles%\Microsoft VS Code\bin\code.cmd`.
- `cursor` Cursor, goto: `cursor`; darwin `/Applications/Cursor.app/Contents/Resources/app/bin/cursor`, `~/Applications/…`; linux `/usr/bin/cursor`; win32 `%LOCALAPPDATA%\Programs\cursor\resources\app\bin\cursor.cmd`.
- `zed` Zed, colon: `zed`; darwin `/Applications/Zed.app/Contents/MacOS/cli`, `/usr/local/bin/zed`, `~/.local/bin/zed`; linux `zeditor`, `~/.local/bin/zed`; win32 `%LOCALAPPDATA%\Programs\Zed\bin\zed.exe`.
- JetBrains (jetbrains syntax; Toolbox script folder: darwin `~/Library/Application Support/JetBrains/Toolbox/scripts`, linux `~/.local/share/JetBrains/Toolbox/scripts`, win32 `%LOCALAPPDATA%\JetBrains\Toolbox\scripts` with `.cmd`): `idea` IntelliJ IDEA, `webstorm` WebStorm, `pycharm` PyCharm, `goland` GoLand, `clion` CLion, `phpstorm` PhpStorm, `rubymine` RubyMine, `rider` Rider, `rustrover` RustRover. Each: the bare name; linux also `<name>.sh`; win32 also `<name>64` (`.exe` from the product's `bin`) before the bare name.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors
- `pnpm test` -- expected: all pass (wait for `uptime` load below 40; timing failures re-run alone)
- `pnpm run build && pnpm exec playwright test tests/e2e/workbench-files.spec.ts tests/e2e/workbench-problems.spec.ts tests/e2e/workbench-changes.spec.ts` -- expected: pass (axe, 390px)
- `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs` -- expected: pass
