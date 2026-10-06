---
title: 'Refactor sweep (epic 16)'
type: 'refactor'
ticket: '10'
created: '2026-10-06'
status: 'in-review'
baseline_revision: 'aa2c14fb0992b5470c940e8e23c842092c54e813'
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

**Problem:** Epic 16 added terminal code beside epic 3's: two socket modules on each side that repeat each other, a temporary spike app still in the tree, a core file over 600 lines, a layout schema that accepts layouts core would never write, and deferred findings from the stories.

**Approach:** Share what the session terminal and the panes have in common, delete the spike, split the long file, fix the cheap deferred findings and record the rest. No behaviour change beyond refusing layouts that are malformed.

## Boundaries & Constraints

**Always:** Same frames, same close codes, same limits on both sockets. Core names no CLI (the architecture test stays). No terminal text anywhere new (AD-16).

**Never:** No new dependency, route, event or setting. No change to the webhook payload (that is epic 11's public contract: recorded for the user, 16.8b). No change to how a pane is killed.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error handling |
|---|---|---|---|
| Layout with a pane in two places, two tabs with one id, or an active tab that does not exist | PUT layout, stored row | refused (400) / ignored on restore as before | plain validation message |
| Session terminal and pane sockets | same frames as before | same limits, close codes and frames | n/a |

</frozen-after-approval>

## Code Map

- `web/src/terminal/terminal-websocket.ts` (new, shared by `terminal-socket.ts` and `pane-socket.ts`).
- `server/src/terminal-socket-limits.ts` (new: close codes, input budget, viewer limits and counter; `terminal-socket.ts` re-exports the old names, `pane-socket.ts` imports from it).
- `core/src/pane-types.ts` (new: the public shapes split out of `panes.ts`, which re-exports them).
- `shared/src/panes.ts` (`PaneLayout` refinements), `adapters/src/terminal-memory/index.ts` (pane reads through to its terminal).
- `apps/terminal-spike/` deleted (its plan said removal at the latest in this story).

## Tasks & Acceptance

**Execution:**
- [x] shared web terminal WebSocket; shared server socket limits and viewer counter
- [x] delete the spike app
- [x] split `core/src/panes.ts` (707 to 604 lines); un-export two unused constants
- [x] layout refinements (16.3 finding); memory stub pane live exit state
- [x] deferred work brought up to date; the 16.8b and 16.9b items marked as needing the user
- [ ] 16.9 flood backpressure and the POSIX background jobs kill stay recorded (see Implementation Notes)

**Acceptance Criteria:**
- Given the existing socket tests, then they pass unchanged on both sockets.
- Given a malformed layout, then it is refused.

## Implementation Notes

- A boundary check found no leak: core, shared and the ACP base name no CLI; the CLI names live in `adapters/pane-launchers` as data.
- The dead export check over the epic's files found only two unused value exports (un-exported) and types used inside their own file (kept).
- The POSIX background jobs kill needs a hangup first and a short wait before the kill, which would delay Close; it stays recorded with a live check.
- 16.8b: the webhook store is on main, but sending a pane event needs a new webhook event kind and a per webhook choice, which changes epic 11's public payload; left for the user.

## Plan Change Log

## Review Triage Log
