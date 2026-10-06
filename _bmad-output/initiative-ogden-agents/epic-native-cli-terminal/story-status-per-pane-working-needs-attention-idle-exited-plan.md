---
title: 'Status per pane: working, needs attention, idle, exited'
type: 'feature'
ticket: '6'
created: '2026-10-05'
status: 'built'
baseline_revision: '5c2cd9acdfc5fb702232d7f489e3d4ccc9221d85'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['security', 'correctness']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-native-cli-terminal/epic-native-cli-terminal.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-native-cli-terminal/spike-can-many-panes-run-real-clis-in-ptys-on-all-three-oses-without-leaking-secrets-plan.md'
---

<frozen-after-approval reason="human-owned intent: do not modify unless human renegotiates">

## Intent

**Problem:** With several panes open the user cannot tell, from another tab, which one is waiting for them. Spike 16.1 measured that output recency alone cannot say it, and that the screen's last lines plus a launcher's prompt patterns can, with known limits.

**Approach:** In memory only, core guesses each pane's status from output recency and the launcher's prompt patterns read from the adapter's screen mirror: working while it prints, needs attention when it has been quiet 400 ms and the last lines match a pattern, idle after 1.2 s, exited from the exit. Changes into or out of needs attention, and the end, become `terminal.pane_status_changed` events (the pane's name and the states, never text); working and idle go to each pane's page over its own socket, since every typed command would otherwise add two log rows; the page shows a status chip per pane, a mark on a tab, a Needs you row and the tab title count, and says plainly that it is a guess. Defaults are conservative: silence alone never says needs attention, and a pane with no patterns (the shell) is only working or idle.

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

Two reviews ran (one security, one correctness).

| Finding | Verdict | Route |
|---|---|---|
| A failed Restart left status working on an exited pane (C) | medium, real | patch: exited in status and state |
| A pane that never prints stayed working forever (C) | medium, real | patch: the quiet timer starts with the tracker |
| The page's own replies (focus reports, cursor position, device answers) counted as typing and flipped a waiting pane (C) | medium, real | patch: `isAutomaticReply` |
| Every working and idle flip was a persisted event; the 2000 event window was crowded (C) | medium, real | patch: events only into or out of needs attention and for the end; working and idle ride the pane's socket; the list is read every 3 seconds for tab marks |
| Trimmed or deleted pane events lost a waiting row; stale rows after a crash (C) | medium, real | patch: the newest pane events of a live pane are held when trimming; pane events from before the last server start are ignored |
| Exited status event came before the exit event, and the socket sent the exit twice (C) | low | patch |
| Repeated groups in a pattern could run away; the heuristic comment overstated (S) | low, latent (the list is the adapters' own) | patch: any repeated group refused; comment says it is a heuristic |
| Long line cut kept the start, not the end where a prompt sits (C) | low | patch |
| Date.now steps; `menu-yes` could match a quoted list in output; live announcer says nothing for panes (C) | low | by design for now: the tab title and the row carry it |
| Tests used their own patterns, not the defaults; the sidebar build path is not run whole (C) | low | partly patched; the live checks supply real wording |
