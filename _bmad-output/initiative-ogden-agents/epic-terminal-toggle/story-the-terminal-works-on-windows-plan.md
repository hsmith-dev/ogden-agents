---
title: 'The terminal works on Windows'
type: 'feature'
ticket: '8'
created: '2026-10-01'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'pinned'
lenses_ran: ['security', 'correctness', 'tests']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Under ConPTY (node-pty 1.1.0) a resize never reached the fake CLI, and what a CLI started outlives a CLI that exits by itself. An npm-installed `claude` (a `.cmd` shim) is never found, and paste, colours and Ctrl+. were never checked. The resize and crash tests are skipped on win32.

**Approach:** There is no Windows machine, so a temporary CI probe gets the facts first. Then fix what they show, turn the win32 skips back on, and record the result. A person then runs the live flow on a real Windows machine (hitl).

## Boundaries & Constraints

**Always:** Spawn with argument arrays, never a shell or a `.cmd`. Reuse `killProcessTree` and `skipConsoleProcessList`. The probe prints sizes, codes and hex of its own test strings, never other terminal bytes. Record each finding with its CI run id. Remove the probe before review.

**Never:** Don't upgrade node-pty, set `useConptyDll`, add native code or a dependency, or declare anything unsupported without the user's answer. Don't edit core, server or web source, `shared`, or 3.9's files.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Resize | `resize(100,30)`, win32 | fake CLI shows `size=100x30` and `resized=100x30` | Open Question 1 |
| CLI exits by itself | crash with a grandchild, win32 | grandchild stopped, no "AttachConsole failed" | Open Question 2 |
| npm install | only `%APPDATA%\npm\claude.cmd` | resolves `node_modules\@anthropic-ai\claude-code\bin\claude.exe` beside it | not there: next candidate, never the `.cmd` |

- Decision (2026-10-01, coordinator): Q3 POSIX reused-id residual — accept (a) and close the entry. Q4 `.cmd` scope — (a) change both chat and terminal (one `claude`, 3.1's rule). Q5 hitl timing — (b) merge on green CI; the Windows live check moves into 3.10's release live checks.
- Q1 (resize if still failing with a raw-mode CLI) and Q2 (children of a dead CLI) are decided by the user AFTER the CI probe results; the build runs the probe first and stops to report.
- Decision (2026-10-01): plan kept whole.
- Decision (2026-10-01, after the CI probe): Q1 closed as not needed: resize works with a raw-mode CLI under node-pty 1.1.0's system ConPTY; the fake CLI reads raw (H1).
- Decision (2026-10-01, after the CI probe): Q2 (a) accept and document: a Node or Bun CLI's children stop with it through libuv's job; only programs started outside it on purpose survive; stopping a live terminal still runs `taskkill /T`.

</frozen-after-approval>

## Code Map

- `packages/adapters/src/terminal-pty/index.ts` -- `hiddenPtySpawner`: spawn options at l.146 (no `useConpty*`); `onExit` stops the POSIX group and skips win32 (l.163-176); `killTerminalTree`/`skipConsoleProcessList` (l.105-141, 9.6's AttachConsole fix). `process-tree.ts` `killProcessTree`: reuse.
- `tests/fixtures/fake-claude-cli.mjs` -- reads stdin through line-mode `readline`; the `resize` listener is POSIX-only (l.82-88). **H1:** on Windows libuv only sees ConPTY's resize event while reading raw, and otherwise keeps the cached size. The real `claude` (Ink) reads raw, so the fake may be what's wrong, not ConPTY.
- Skips: `adapters/test/terminal-pty.test.ts` l.27, 204, 222, 234; `server/test/terminal-socket.test.ts` l.49, 469, 504; its grandchild checks are POSIX-only (l.591, 607).
- `acp-claude-code/detect.ts` `findClaudeExecutable`: on win32 only `claude.exe` counts. It serves the chat (`claude-code-agent.ts` l.161) and the terminal (`terminal-command.ts` l.67). `@anthropic-ai/claude-code@2.1.286`'s bin is `bin/claude.exe`.
- `web/src/terminal/use-driver-shortcut.ts` -- the browser catches Ctrl+., so it never reaches the PTY. Verify only.
- `ci.yml` `test` job: `pnpm test` on windows-latest (Node 24/26) already runs the real-PTY round trip. Browser e2e is Linux-only (3.10).
- node-pty: `latest` 1.1.0, `beta` 1.2.0-beta.15. No release since 1.1.0 lists a resize fix (#881, #885, #898, #935, #943).
- `agent-matrix.md` Claude Code row; `deferred-work.md` open items l.22-24.

## Tasks & Acceptance

**Execution:**
- [x] `scripts/conpty-probe.mjs` + a `conpty-probe` job in `ci.yml` (windows-latest, `continue-on-error`) -- temporary (Design Notes). Run it on the story PR, as 3.1 did with PR #34, and read it with `gh run view --log`. Iterate, then delete both.
- [x] `tests/fixtures/fake-claude-cli.mjs` -- if H1 holds: raw-mode input with its own echo, and `resized=` on Windows too.
- [x] `terminal-pty/index.ts` -- the win32 stop after exit that the probe shows works (likely: close the pseudo-console in `onExit`, with the console list skipped); the POSIX residual per Open Question 3.
- [x] `detect.ts` -- on win32, when a `claude.cmd` has the package's `claude.exe` beside it, use that `.exe`. Unit tests use an injected `isExecutable`.
- [x] The two test files -- drop the skips the fixes allow; add a bracketed-paste test and a truecolour pass-through test.
- [x] `agent-matrix.md`, `deferred-work.md` -- the Windows result; resolve or re-file each of l.22-24.

**Acceptance Criteria:**
- Given windows-latest CI, when `pnpm test` runs, then the resize, crash and two-viewer tests run unskipped, or are skipped for a reason the user approved, and "AttachConsole failed" is absent from the logs.
- Given a person on Windows with Claude Code signed in, when they switch to the terminal, type, paste, resize, press Ctrl+. both ways and switch back, then the message shows in the chat as from terminal.

## Open Questions

1. **If resize still fails with a raw-mode CLI:** (a) declare Windows resize unsupported: the tests stay skipped and the terminal keeps its first size; (b) pin node-pty 1.2.0-beta.x, a prerelease shipped to users; (c) set `useConptyDll: true` on 1.1.0, which uses node-pty's bundled conpty.dll and OpenConsole.exe instead of Windows' console host.
2. **If closing the pseudo-console leaves a dead CLI's children running:** (a) accept and document it; only a stop before the exit stops the tree; (b) a Job Object, which needs native code or a helper process (an architecture change); (c) poll the CLI's descendants with CIM and taskkill them, at a process per poll and with reused-id risk.
3. **POSIX reused-id residual:** (a) accept it and close the entry: an id isn't reused while its group has members, so the risk needs an empty group reused by a new group leader in the same tick; (b) check the group's members with `ps` before signalling, which costs a spawn and is still racy.
4. **`.cmd` scope:** `findClaudeExecutable` serves the chat too. (a) Change both: chat and terminal keep one `claude`, which is 3.1's rule, and an npm user's Windows chat moves from the bundled CLI to their own. (b) Terminal only: the two may differ in version.
5. **hitl timing:** (a) 3.8 stays open until a person checks it on Windows; (b) merge on green CI and move that check into 3.10's release live checks.

## Implementation Notes

- CI probe (temporary `scripts/conpty-probe.mjs` and a `conpty-probe` job, removed; runs 36896007333, 36896903713, 36898705640; windows-latest = Windows Server 2025 build 26100, Node 24.21, node-pty 1.1.0, `_useConpty` true):
  - Resize to 100x30: a line-mode child keeps 80x24 (`getWindowSize` and `columns`), dll off or on; a raw-mode child gets the `resize` event and 100x30 within ~0.5 s (dll: at once); `mode con` shows 100x30. H1 holds.
  - Exit: a Node or Bun CLI's non-detached grandchild dies with it (libuv's kill-on-close job). A grandchild started outside any job (PowerShell `Start-Process -NoNewWindow`, node or ping) survives the CLI's exit, `kill()` with or without the console list, and `taskkill /T` of the gone root (exit 128). With `useConptyDll` on, `onExit` waits for that grandchild, and `kill()` stops it. A grandchild that keeps writing can hold off `onExit` under system ConPTY (deferred-work).
  - Input: bracketed paste arrives byte-identical, Ctrl+C in raw mode arrives as 0x03 (no SIGINT, child lives), truecolour SGR comes back unchanged (system ConPTY moves it before the CRLF).
  - npm: `claude`, `claude.cmd`, `claude.ps1` in the npm prefix; the `.cmd` runs `%dp0%\node_modules\@anthropic-ai\claude-code\bin\claude.exe`; 2.1.286's `bin` is `bin/claude.exe`; `claude.exe --version` through node-pty exits 0.
  - "AttachConsole failed" comes only from node-pty's default `kill()` console list; never with it skipped (9.6's path, used by every kill) or with the dll. The `test` job now fails if the line appears.

## Plan Change Log

## Review Triage Log

Lenses: security (the `claude.cmd` -> `claude.exe` resolution), correctness (Windows tree stop, `onExit` residual, fake CLI raw mode, the AttachConsole guard), tests (fakes only, real Windows coverage). Net diff `origin/story/3.9-epic3-sweep...HEAD` (the probe commits net to nothing). Windows CI run 36903485293: `terminal-pty.test.ts` 15 tests, 1 skipped (the POSIX-only group test, by design); `terminal-socket.test.ts` 24 tests, none skipped; no "AttachConsole failed".

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| R1 | Security: the `.cmd` -> `.exe` step could be steered to an attacker's binary through PATH order, a cwd- or project-relative lookup, or a `node_modules` in the opened project | false | dismiss | `detect.ts` only joins fixed segments onto PATH entries that passed `isAbsolute` (relative entries such as `.` are dropped first); no cwd or workspace folder is consulted. The `.exe` is used only when `claude.cmd` sits in the same folder, and is checked right after that folder's own `claude.exe` and before the next PATH entry, which is the order `cmd` would run the shim in (PATHEXT: .EXE before .CMD). Whoever can write `<dir>\node_modules\@anthropic-ai\claude-code\bin\claude.exe` and `<dir>\claude.cmd` can already write `<dir>\claude.exe`, which won before this change. A project's `node_modules\.bin` on PATH (npx) is the same: its own `claude.cmd` points at `..\@anthropic-ai\...`, not `.bin\node_modules\...`, so it is not followed, and a planted `.bin\claude.exe` already won. Symlinks/junctions and 8.3 names resolve to the same target `cmd` would run. |
| R2 | Security: a `.cmd` could still be run through a shell with untrusted args | false | dismiss | Missing package `.exe` falls through to the next candidate or `undefined` (the bundled CLI), never the `.cmd` (unit test "the package's .exe is missing"). Every caller (`claude-code-agent.ts`, `terminal-command.ts`, `setup-claude-code`) passes the result as `CLAUDE_CODE_EXECUTABLE` or spawns it with an argument array (`terminal-port.ts`, `execFile`, no `shell`). A user-set `CLAUDE_CODE_EXECUTABLE` naming a `.cmd` is pre-existing and user-chosen, and the terminal's args are fixed flags and a UUID. AD-15/AD-16 untouched: the environment is still `agentEnvironment`'s allowlist. |
| R3 | Correctness: the `.cmd` rule now also feeds sign-in and `auth status` (`setup-claude-code/index.ts` l.194, 209), not only chat and terminal | false | dismiss | Intended by Q4a (one `claude` everywhere); setup sets it only as `CLAUDE_CODE_EXECUTABLE` for the adapter and runs `node <script>` with an argument array. |
| R4 | Correctness: `killTerminalTree` on Windows after the CLI exited by itself | false | dismiss | Unchanged from 9.6: `taskkill /T` (exit 128 on a gone root) then the console list skipped and `kill()`; `kill()` after an exit is a no-op in `hiddenPtySpawner`. The `onExit` comment matches the probe (runs 36896903713, 36898705640) and decision Q2a; the stuck-exit case is filed in deferred-work. |
| R5 | Correctness: the fake CLI in raw mode loses SIGINT / EOF behaviour some test relies on | false | dismiss | No test sends 0x03 except the new one, which expects `ctrl-c`; readline's `close` had no handler, so 0x04 never did anything. CR, LF and CR LF across chunks are handled by `lastWasCr`; a partial escape waits for more input. |
| R6 | Correctness: the AttachConsole guard could false-positive on a test name or the dist comment | false | dismiss | Only `pnpm test` output is grepped; the one test name says "no AttachConsole noise" and the dist comment splits the words across lines. The line reaches the job log (9.6 found it there), so a false negative needs node-pty to print it elsewhere; `pipefail` keeps a test failure failing the step. |
| R7 | Tests: the guard step ran every Windows test under Git Bash (`shell: bash`), which prepends Git's `usr\bin`/`mingw64\bin` to PATH and sets HOME and SHELL for every test and agent process, so Windows coverage no longer matched a user's Windows | medium | patch | Run 36903485293 log: `shell: C:\Program Files\Git\bin\bash.EXE`. Fixed: Windows runs the same step in its default `pwsh` (`Tee-Object`, `$LASTEXITCODE`, `Select-String -SimpleMatch`); Linux and macOS keep bash. Regression check: the PR's Windows CI run. |
| R8 | Tests: no fake-platform test shows `onExit` does nothing on win32 | low | dismiss | Covered for real on windows-latest by the two crash tests (grandchild gone, no kill); a fake would need `taskkill` injected, more than a direct correction. |
| R9 | Tests: unit tests use fakes only | false | dismiss | `findClaudeExecutable` tests inject `isExecutable` and `platform`; the real-PTY tests use `fake-claude-cli.mjs`; no test needs a real `claude`. |
| R10 | Tests: the new paste test is flaky on Windows: the fake CLI never turns on bracketed paste (`ESC[?2004h`), which Claude Code and the CI probe both do, and ConPTY then delivered `pa ste` without its markers | medium | patch | PR #47 run 36908981716, windows-latest / Node 24: received `ready>pa ste`, no `pasted:`; the same test passed in runs 36903485293 and 36908834956. Fixed: the fake writes `ESC[?2004h` before its banner in a terminal, so it is set before the test sees `ready>`. Regression check: the paste test on windows-latest. |

Also in this branch (coordinator request): `OGDEN_AGENTS_TEST_CHECK_IN_MS` is now honoured only when `testHooksAllowed` (a test run on a data folder in the OS temp folder), like the other test hooks; `checkInDelayFromEnv(env, dataDir)`. Tests: `cancel.test.ts` (unchanged values under `VITEST`; ignored outside a test run or outside temp). `pnpm dev:chat` now needs `NODE_ENV=test` to use it.

## Design Notes

**Probe:** each step is capped at 10 s and prints facts only.
- **Versions:** OS build, Node, node-pty, and `_agent`'s `_useConpty`/`_useConptyDll`.
- **Resize:** run `resize(100,30)` on a `node` child. Sample every 250 ms for 5 s, in three modes: line-mode `getWindowSize()` (today's fake), raw mode with the `resize` event, and `cmd /c mode con` (Windows' own answer). Run each with `useConptyDll` off and on; the second run only informs Open Question 1.
- **Exit:** the child starts a grandchild and exits. Check the grandchild after 2 s, and again after `kill()` with the console list skipped. Record stderr too.
- **Input:** in raw mode, enable `?2004h` and send a bracketed paste and Ctrl+C; print the hex the child receives. Check that a truecolour SGR comes back unchanged.
- **Real CLI:** `npm i -g @anthropic-ai/claude-code`, then print `where claude`, the shim's target, and `claude.exe --version` through node-pty (no sign-in needed).
- **Noise:** grep the adapters' test stderr for "AttachConsole".

## Verification

**Commands:**
- `pnpm typecheck && pnpm test` -- expected: green locally.
- `gh pr checks <pr>` -- expected: all `test` jobs green; the Windows logs show the unskipped tests and no "AttachConsole failed".

**Manual checks (if no CLI):**
- A person on Windows runs the second acceptance criterion and reports whether Claude Code came from npm or the native installer.
