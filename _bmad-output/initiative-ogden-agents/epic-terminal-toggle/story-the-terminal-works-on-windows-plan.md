---
title: 'The terminal works on Windows'
type: 'feature'
ticket: '8'
created: '2026-10-01'
status: 'in-progress'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
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
- [ ] `scripts/conpty-probe.mjs` + a `conpty-probe` job in `ci.yml` (windows-latest, `continue-on-error`) -- temporary (Design Notes). Run it on the story PR, as 3.1 did with PR #34, and read it with `gh run view --log`. Iterate, then delete both.
- [ ] `tests/fixtures/fake-claude-cli.mjs` -- if H1 holds: raw-mode input with its own echo, and `resized=` on Windows too.
- [ ] `terminal-pty/index.ts` -- the win32 stop after exit that the probe shows works (likely: close the pseudo-console in `onExit`, with the console list skipped); the POSIX residual per Open Question 3.
- [ ] `detect.ts` -- on win32, when a `claude.cmd` has the package's `claude.exe` beside it, use that `.exe`. Unit tests use an injected `isExecutable`.
- [ ] The two test files -- drop the skips the fixes allow; add a bracketed-paste test and a truecolour pass-through test.
- [ ] `agent-matrix.md`, `deferred-work.md` -- the Windows result; resolve or re-file each of l.22-24.

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

## Plan Change Log

## Review Triage Log

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
