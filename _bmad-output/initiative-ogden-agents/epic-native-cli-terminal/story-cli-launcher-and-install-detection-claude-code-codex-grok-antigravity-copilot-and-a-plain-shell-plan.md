---
title: 'CLI launcher and install detection: Claude Code, Codex, Grok, Antigravity, Copilot and a plain shell'
type: 'feature'
ticket: '5'
created: '2026-10-05'
status: 'in-review'
baseline_revision: '12bc31ee90ee1e840b911a7c333304820220bcb9'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-native-cli-terminal/epic-native-cli-terminal.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-native-cli-terminal/spike-can-many-panes-run-real-clis-in-ptys-on-all-three-oses-without-leaking-secrets-plan.md'
---

<frozen-after-approval reason="human-owned intent: do not modify unless human renegotiates">

## Intent

**Problem:** A pane can only run the user's shell. The epic's point is the agent CLIs side by side, each signed in by the user inside the CLI, with Ogden Agents seeing no credential and installing nothing.

**Approach:** The launcher list as adapter data (the user's decided list: Claude Code, Codex, Grok, Antigravity, Copilot, a plain shell, and Gemini only if already installed), install detection by looking on the user's PATH and well known folders and asking for `--version` under the allowlist, a launchers route, and a pane that starts exactly the absolute path found with the launcher's plain arguments plus only what the user typed in its visible field.

## Boundaries & Constraints

**Always:** Detect never installs and runs only `--version`, no shell (a Windows shim through `cmd.exe`), under the allowlisted environment; a PATH entry that is not absolute is ignored; a pane gets the pane environment (no key, no token); Ogden adds no flag that skips a permission prompt; Copilot is marked interactive only; a missing program shows its install page and "Install it yourself, then press Detect"; Developer mode on every launcher route; tests use fake programs in a temp folder and a test run never looks at the real computer; plain words, no dashes.

**Never:** Status (16.6), saved arguments and settings (16.9), automation of any pane, auto answering a prompt, reading or storing a CLI's login, installing anything.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error handling |
|---|---|---|---|
| Program on PATH or well known place | detect | `found` with its version | n/a |
| Program missing | detect | `not_found`, install page, "Install it yourself, then press Detect" | nothing installed |
| Program there but silent | detect | `failed`, plain words | n/a |
| Gemini not installed | list | left out | n/a |
| Start a found program | POST panes with launcherId and args | pane runs the absolute path, own args then typed args | 409 `launcher_unavailable` if not found; 400 for unclosed quotes |
| Server secrets set | sentinel keys | none reaches the pane | n/a |
| Windows .cmd shim, space in path | detect and start | found and started by absolute path | n/a |

</frozen-after-approval>

## Code Map

- `adapters/src/pane-launchers/index.ts` (the list), `detect.ts` (`detectLauncher`, `createPaneLaunchers`), `child-env.ts` reuse.
- `core/src/pane-launchers.ts` (port, `splitLauncherArgs`), `panes.ts` (launcher in `open`, `launchers()`), `errors.ts` (`LauncherUnavailableError`).
- `shared/src/panes.ts` (`PaneDetection`, `PaneLauncherStatus`, request fields), `api.ts` (`terminalLaunchers`), `errors.ts` (`launcher_unavailable`).
- `server/src/pane-routes.ts`, `start-panes.ts`, `test-hooks.ts` (`OGDEN_AGENTS_TEST_PANE_PATH`).
- `web/src/terminal/launcher-list.tsx`, `panes-api.ts`, `terminals-view.tsx`.
- `tests/fixtures/fake-cli-folder.ts`, `fake-pane-shell.mjs` (`--version`, `args`); `spec-ogden-agents/agent-matrix.md` (the Terminal panes table); `spec-ogden-agents/.memlog.md` (CAP-23 proposal).

## Tasks & Acceptance

**Execution:**
- [x] launcher data, detection, port, core and routes, page, fake program fixture, tests, matrix and memlog

**Acceptance Criteria:**
- Given fake programs on a fake PATH, then each launcher shows found, not found or failed on every OS and nothing is installed.
- Given a sentinel secret in the server, then it never reaches a launched pane.
- Given any launcher, then Ogden adds no flag that skips a permission prompt.

## Implementation Notes

- The real executable names and Windows places are the spike's and the vendors' docs; the user's live checks confirm them.
- A test run with no folder named finds nothing, so no suite ever runs a real CLI (the hook `OGDEN_AGENTS_TEST_PANE_PATH` names the folder of fake ones).

## Plan Change Log

## Review Triage Log
