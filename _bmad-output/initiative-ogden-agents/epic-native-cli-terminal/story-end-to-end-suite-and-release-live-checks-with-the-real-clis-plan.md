---
title: 'End-to-end suite and release; live checks with the real CLIs'
type: 'feature'
ticket: '11'
created: '2026-10-06'
status: 'in-review'
baseline_revision: '72ea10552208553204e14de3e9c3d275b9d97050'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-native-cli-terminal/epic-native-cli-terminal.md'
---

<frozen-after-approval reason="human-owned intent: do not modify unless human renegotiates">

## Intent

**Problem:** The terminal workspace is built, but no test follows one person through a restart, nothing proves end to end that no terminal text or secret is stored, and the README and release notes do not mention it. The real CLIs have never been run by the product.

**Approach:** Add the end to end tests that were still missing (restart restores the layout, names and opt in; nothing a terminal printed or was typed, and no planted server secret, is in any file the server keeps), write the README section and the release note, and stop: the live checks with the real CLIs are the user's.

## Boundaries & Constraints

**Always:** Fake programs only (no real agent CLI, keychain, network or real home folders). A planted secret and typed text are looked for in every file under the data folder, the database and its log included. No dashes in user text.

**Never:** No tag, no npm publish, no release (RELEASING.md is the user's step). No change to behaviour.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error handling |
|---|---|---|---|
| Server restarted | two panes in a split, one renamed and opted in | both back, stopped, same split, name and opt in kept; Start runs one | n/a |
| Stored data | typed text, printed text, planted secret | none of it in any stored file; the program lists no secret | n/a |

</frozen-after-approval>

## Code Map

- `tests/e2e/panes.spec.ts` (new restart and nothing stored test; the earlier tests already cover opening, split, programs and status, detection, Developer mode off, the settings and the keep question).
- `README.md` (Terminals section), `CHANGELOG.md` (Unreleased).

## Tasks & Acceptance

**Execution:**
- [x] the restart and nothing stored end to end test
- [x] README section and release note
- [ ] the user's live checks (hitl): see the list below; this story stops here

**Acceptance Criteria:**
- Given a server restart, then the layout, name and opt in are back and a terminal starts again with Start.
- Given a terminal that printed and was typed into, then none of that text and no planted secret is in the data folder.

## Live checks for the user (hitl; real CLIs, never in CI)

On a Mac and on a Windows machine, Developer mode on, Terminals tab:
1. Each of Claude Code, Codex, Grok, Antigravity (`agy`), Copilot (and Gemini if installed) shows as found on Detect with a version, and a missing one shows its install page.
2. Each shows its sign in inside its terminal (code or link flow works) and nothing is asked of Ogden Agents.
3. Resize the window while a CLI is open and it redraws; paste a long text (several thousand characters) into each; on Windows note how long a 100 KB paste takes.
4. Open four to six terminals at once and note the computer's memory.
5. Leave each at a permission question and send me the exact words it shows (these are the status patterns); note what it prints while thinking silently, and whether Needs attention appears for it and not before.
6. Windows only: each terminal's first prompt always appears (the held first output), PowerShell starts, and a program in a path with spaces starts.
7. Close the app window, then kill the server while a CLI runs, then start Ogden Agents again: the old program should be gone, the terminal shown as stopped with Start.
8. Turn on Notify me for one terminal, switch to another tab or window, and make it ask a question: one sound or notice with only the project and terminal name.
9. Turn Developer mode off with a terminal running and try both choices (Stop them, Keep them running).

## Implementation Notes

- The epic's release step is the user's: no tag or npm publish here. The note is in CHANGELOG.md under Unreleased.
- Not built, recorded for the user: 16.8b (a pane event to webhooks widens epic 11's public payload) and 16.9b (open a chat's session in a pane runs one CLI session twice).

## Plan Change Log

## Review Triage Log

Security pass: no findings. Correctness pass: fixed the browser's Developer mode copy after the restart (per address; the test passed without it locally, set anyway so it cannot depend on the port) and the release note wording (the notice names the project and the terminal). Verified: the planted secret name would be listed by the fake shell if it leaked, the double server close is safe, the data folder scan covers the database and its log, and the README facts match the code. Not checked against code by the reviewer: the Detect trigger and the stop or keep question, both covered by existing tests (programs and settings e2e).
