---
title: 'Epic contracts and stubs: panes, launchers, layout and pane events'
type: 'feature'
ticket: '3'
created: '2026-10-05'
status: 'in-review'
baseline_revision: '4f0e48606793a40cceed401c70d86f16b20621da'
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

**Problem:** Story 16.2 built one shell pane with a thin contract. Stories 16.4 (layout), 16.5 (launchers and detection), 16.6 (status), 16.7 (persistence), 16.8 (notifications) and 16.9 (settings and gating) would each invent shapes in shared files.

**Approach:** Freeze the shared shapes now, naming no program: the launcher as data, the four statuses, the layout tree, the Terminals settings and the pane events (state only), with core appending the events it already knows (opened, exited, closed), the memory stub and a contract test, and an architecture test that core, shared and acp-base name no pane program.

## Boundaries & Constraints

**Always:** Pane events carry state only: no payload field holds terminal text. Launchers are data validated by `PaneLauncher`; core and shared name no program. Settings default to everything off. Existing behavior and the chat toggle tests are unchanged.

**Never:** Status derivation (16.6), layout operations and storage (16.4, 16.7), detection and the real launcher list (16.5), notifications (16.8), settings routes (16.9), migrations.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error handling |
|---|---|---|---|
| Pane opens, exits, closes | the use-cases | `terminal.pane_opened`, `pane_exited` (exit code), `pane_closed` (cause) on the workspace stream, with ids and enums only | an event that fails to append never reaches the pane |
| Open fails | spawn error | no event | n/a |
| Developer mode off or server stop | stop all | `pane_closed` with cause `developer_mode_off` or `server_stopped` | n/a |
| Launcher, layout or settings data | parsed | defaults filled; malformed id, empty label, bad ratio, too many tabs refused | validation error |

</frozen-after-approval>

## Code Map

- `packages/shared/src/panes.ts` (`PaneStatus`, `PanePromptPattern`, `PaneExecutables`, `PaneLauncher`, `PaneLayout`, `TerminalsSettings`), `events-panes.ts` and `events.ts` (six pane events).
- `packages/core/src/panes.ts` -- appends the events; `terminal-port.ts` already has `openPane`.
- `packages/adapters/src/pane-launchers/index.ts` -- the list (shell only until 16.5); `terminal-memory` has `openPane`.
- Tests: `shared/test/pane-contracts.test.ts`, `core/test/panes.test.ts`, `adapters/test/terminal-pane-contract.test.ts`, `tests/architecture.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] contracts, events, core appends, launcher list, stub contract test, architecture test

**Acceptance Criteria:**
- Given the shared package, then no pane event payload has a text field and every pane event is in the union on the workspace stream.
- Given core and shared and acp-base, then no pane program is named in code.
- Given the memory stub, then it satisfies the pane contract.

## Implementation Notes

- The fake CLI fixture with permission style prompts arrives with its first user (16.5, 16.6); 16.2's fake shell stays the pane fixture until then.

## Plan Change Log

## Review Triage Log
