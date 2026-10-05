---
title: 'Single instance, app menu, window and clean quit'
type: 'feature'
ticket: '5'
created: '2026-10-05'
status: 'built'
baseline_revision: 'ce32f0c663f508f69e4a9919c284eb6574c49f38'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['security', 'correctness']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-desktop-app/epic-desktop-app.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-desktop-app/spike-can-a-tauri-app-run-ogden-s-packed-server-on-a-bundled-node-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The tracer quits by killing the server and closes with the window; it has no menu, no single instance, no confirmation when agents are working, and it does not attach to a server `npx ogden-agents` already started (E13-R1, E13-R3, E13-R4). Spike 13.1 found that on macOS a process-group kill leaves a running agent behind, and that on Windows only a job object stops the whole tree.

**Approach:** The shell runs the launcher's `--json --no-open` mode (13.3) on the bundled Node instead of the server directly: the launcher does the find, attach and AD-20 handshake and prints `{owned, port, pid, dataDir, launchUrl, ...}`. The single-instance plugin is registered first and a second launch focuses the window. An app menu has About, Check for Updates (a stub until 13.10) and Quit, plus Edit for copy and paste. Quit (menu, window close on Windows, Dock) goes through one path: the server's `/launcher/quit` (new, shell mode only), a native question if agents are working ("Quit anyway" or "Keep working"), then a descendant sweep and a kill as the fallback, then exit. A server the app only attached to is never stopped. Closing the window on macOS hides it and the app stays in the Dock; on Windows it quits. On Windows the shell joins a kill-on-close job object; elsewhere the server follows the closed pipe (13.3).

## Boundaries & Constraints

**Always:** AD-15 unchanged (no capability or IPC for the page; navigation locked; outside links to the system browser). Quitting stops only a server the app started. The page never learns of the shell except through the server. Plain words, no dashes in user text.

**Never:** a tray icon (user, 2026-10-04); the updater (13.10); changing the gate.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Second launch | app running | second process exits; first window focused; one server | none |
| Quit, idle | owned server | `/launcher/quit` 202, launcher and server exit, no `ogden-node` left | timeout: sweep and kill |
| Quit, busy | working session | native question; "Keep working" cancels the quit; "Quit anyway" forces it and stops the agent and its child | none |
| Quit, attached | server started by npm | server left running | none |
| Shell killed | SIGKILL or TerminateProcess | Windows: job object kills the tree; macOS: the pipe closes and the server follows | none |
| Window closed | macOS / Windows | macOS hides it (Dock icon reopens it); Windows quits | none |

</frozen-after-approval>

## Code Map

- `packages/desktop/src-tauri/src/{main,server,ui,report}.rs`, `Cargo.toml` (single-instance 2.4.5, dialog 2).
- `packages/server/src/app.ts` -- `POST /launcher/quit` in shell mode (launcher token), same rule as the page's Quit.
- `packages/desktop/scripts/{lifecycle,install-nsis,app-harness}.mjs` and the Desktop workflow's `app` job.

## Tasks & Acceptance

**Execution:**
- [x] shell restructured into modules; launcher JSON handshake; owned or attached
- [x] single instance, menu, quit path, hide on macOS, job object on Windows
- [x] `/launcher/quit` and its test
- [x] lifecycle script (A to E) in CI beside the smoke
- [x] CI: Windows x64 and ARM64 build, smoke, and lifecycle scenarios C, D1, D2 and E pass (run 37304094233); A needed the fix below
- [x] review and triage

## Implementation Notes

- Unknown "how the busy confirmation is best shown": a native dialog from Rust (`tauri-plugin-dialog`, no IPC for the page), so quitting from the menu, the Dock or the window uses one question and the web UI needs no event.
- The server follows a closed pipe (13.3's parent watch) and the Windows job object covers a crashed shell; the descendant sweep covers a server that did not stop in time.

## Plan Change Log

## Review Triage Log

Pass 1 (security and correctness, self-review of the shell and the quit path): high 1, medium 3, low 2.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | The shell uses the launch link from the launcher's JSON without checking it points at the server | high | patch | \`open_window\` refuses a link whose origin is not \`http://127.0.0.1:<port>\` (AD-15; same check the tracer had). |
| 2 | \`/launcher/quit\` is a new way to stop a server | medium | patch | Registered only in shell mode, launcher token only (a tab token is refused); same busy rule and answers as the page's Quit; tested. |
| 3 | Quitting must never stop a server the app did not start | medium | patch | Only \`owned\` (the launcher started it) is stopped; \`quit_not_ours\` for an attached one; lifecycle scenario C proves an npm-started server survives. |
| 4 | Process ids noted before the quit could have been reused | medium | reject | The window is about a second and each is checked alive before it is killed; the worst case is a straggler agent is left, not another process killed in practice. |
| 5 | Scenario A compared process ids too early: start-up helpers made the set change | low | patch | Found in CI (run 37304094233, Windows x64 and ARM64). The check waits 6 s first. |
| 6 | Test hooks (\`OGDEN_DESKTOP_TEST_CONFIRM\`, quit file) are read in the shipped binary | low | reject | Same-user environment only; they only answer the quit question or run the normal quit path. |

## Verification

**Commands:**
- `gh run list --workflow Desktop` -- both legs green, scenarios A to E pass.
