---
title: 'Status per pane: working, needs attention, idle, exited'
type: 'feature'
ticket: '6'
created: '2026-10-05'
status: 'in-review'
baseline_revision: '5c2cd9acdfc5fb702232d7f489e3d4ccc9221d85'
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

**Problem:** With several panes open the user cannot tell, from another tab, which one is waiting for them. Spike 16.1 measured that output recency alone cannot say it, and that the screen's last lines plus a launcher's prompt patterns can, with known limits.

**Approach:** In memory only, core guesses each pane's status from output recency and the launcher's prompt patterns read from the adapter's screen mirror: working while it prints, needs attention when it has been quiet 400 ms and the last lines match a pattern, idle after 1.2 s, exited from the exit. State changes become `terminal.pane_status_changed` events (the pane's name and the states, never text); the page shows a status chip per pane, a mark on a tab, a Needs you row and the tab title count, and says plainly that it is a guess. Defaults are conservative: silence alone never says needs attention, and a pane with no patterns (the shell) is only working or idle.

## Boundaries & Constraints

**Always:** Terminal bytes and screen lines are used only in memory by the detector, never stored, logged or sent; no pane text in any event, database row or log line; patterns are launcher data, compiled once, a bad one skipped; typing answers a prompt; the page says status is a guess; a pane's attention never makes a sound or a desktop notification by itself (16.8 makes it opt in); plain words, no dashes.

**Never:** Auto answering a prompt, scripting a pane, per CLI pattern tuning from live wording (the user's live checks supply it), notifications (16.8), storing anything.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error handling |
|---|---|---|---|
| Program prints | output | working | n/a |
| Quiet 400 ms, last line is a question | pattern matches | needs attention | n/a |
| Quiet 1.2 s, no match | silent work | idle, never needs attention | n/a |
| User types at a prompt | input | working again | n/a |
| Program exits | exit | exited, final | n/a |
| Shell or unknown wording | no patterns | working or idle only | n/a |
| Old question above newer output | depth rule | not needs attention | n/a |
| Screen unreadable, bad pattern | error | not a prompt; pattern skipped | never thrown |

</frozen-after-approval>

## Code Map

- `core/src/pane-status.ts` (tracker, `compilePatterns`, `matchesPrompt`), `panes.ts` (tracker per program, `setStatus`, events), `terminal-port.ts` (`screenLines`).
- `adapters/src/terminal-pty/pane-mirror.ts` (`lastLines`), `terminal-port.ts`, `terminal-memory`; `pane-launchers/index.ts` (conservative default patterns).
- `shared/src/panes.ts` (`Pane.status`), `events-panes.ts` (optional `title`).
- `web/src/terminal/pane-status-words.ts`, `pane-view.tsx` (chip), `terminals-view.tsx` (tab mark, guess note, event invalidation), `shell/sidebar-model.ts` (`paneNeeds`), `needs-you-group.tsx`, `status-sidebar.tsx`, `notifications/*` (panes excluded from sound and desktop notices).
- Tests: `core/test/pane-status.test.ts`, `panes.test.ts`, `adapters/test/terminal-pane.test.ts`, `server/test/panes.test.ts`, `web/test/pane-needs.test.tsx`, `terminals.dom.test.tsx`, `tests/e2e/panes.spec.ts`; the fake program gained `perm`, `work` and `think`.

## Tasks & Acceptance

**Execution:**
- [x] tracker, mirror line reads, events, page chips and Needs you, tests with the fake program

**Acceptance Criteria:**
- Given a fake CLI, then a pane shows working while output flows, needs attention at the permission style prompt, idle after quiet and exited on exit.
- Given Needs you and the tab title, then a pane needing attention counts in both.
- Given the database, event log and logs, then no pane text appears in them.

## Implementation Notes

- The default patterns are the spike's conservative four (question ending in (y/n), press enter, a numbered menu whose first choice is yes, a do you want to proceed question on the last line). The exact words of each real CLI come from the user's live checks and change as data.

## Plan Change Log

## Review Triage Log
