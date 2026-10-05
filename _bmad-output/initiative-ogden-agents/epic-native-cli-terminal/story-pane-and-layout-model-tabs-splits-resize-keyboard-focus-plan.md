---
title: 'Pane and layout model: tabs, splits, resize, keyboard focus'
type: 'feature'
ticket: '4'
created: '2026-10-05'
status: 'in-review'
baseline_revision: 'af0c44386ec22f48c89fd2e9fb8f8202c3f4326d'
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

**Problem:** Story 16.2 shows panes in a plain list. A herdr style workspace needs tabs of split panes the user arranges, with a terminal that takes the size of the box it is shown in.

**Approach:** Core owns each project's layout (tabs of split trees, in memory until 16.7 stores it) and changes it only through use-cases that emit events: a new pane gets a tab or a split beside or under another pane, closing collapses, rename, and an arrangement change that must be the same panes each once. The page draws the active tab's tree with draggable and arrow key dividers, a tab strip, rename, split and close, keyboard focus movement, and the plain refusal at the pane cap.

## Boundaries & Constraints

**Always:** Every layout change goes through a core use-case and Developer mode is enforced there; the layout holds ids, titles and shapes only; only the shown tab's panes are connected, so each terminal follows its box (the server replays the screen when a tab is shown again); the cap of 8 panes per project and 16 per install is refused with its reason; plain words, no dashes.

**Never:** Persistence (16.7), launchers (16.5), status (16.6), moving a pane between tabs by dragging, browser shortcuts that clash (Alt and Shift with an arrow moves focus).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error handling |
|---|---|---|---|
| New terminal | POST panes, no placement | a tab of its own, made active | cap: 409 `pane_limit_reached` and the button says why |
| Split | placement split of a pane in the project | beside or under it, same tab; a missing target falls back to a tab | n/a |
| Close | DELETE | its sibling takes the space; an empty tab goes; the active tab moves | n/a |
| Arrange | PUT layout | ratios, tab names and order, active tab saved | 400 unless the same panes each once |
| Rename | PATCH pane, tab by double click | name saved; Enter saves, Escape does not | 400 for no name or control characters |
| Divider | drag, or arrow keys | ratio 10 to 90 percent, 5 per key, saved | n/a |
| Focus | Alt+Shift+Arrow | the pane on that side that overlaps most; never reaches the program | stays when none |
| Developer mode off | any layout route | 403 `developer_mode_required` | n/a |

</frozen-after-approval>

## Code Map

- `core/src/pane-layout.ts` (pure tree operations), `panes.ts` (`layout`, `arrange`, `rename`, placement, `layout_changed` and `pane_renamed` events).
- `shared/src/panes.ts` (`PanePlacement`, `ArrangePanesRequest`, `RenamePaneRequest`, layout in `PanesResponse`), `api.ts` (`workspacePaneLayout`, `PATCH workspacePane`).
- `server/src/pane-routes.ts`; `web/src/terminal/layout-edit.ts`, `layout-tree.tsx`, `terminals-view.tsx`, `pane-view.tsx`, `panes-api.ts`.
- Tests: `core/test/pane-layout.test.ts`, `panes.test.ts`, `server/test/panes.test.ts`, `web/test/layout-edit.test.ts`, `terminals.dom.test.tsx`, `tests/e2e/panes.spec.ts`.

## Tasks & Acceptance

**Execution:**
- [x] layout model and use-cases in core, routes, the page with tabs, splits, dividers, rename and focus keys, tests

**Acceptance Criteria:**
- Given three panes, when the user splits, resizes, moves focus, closes one and renames a tab, then the layout in core matches and survives a reload.
- Given 8 panes in a project, then opening another is refused with its reason.

## Implementation Notes

- Dragging a pane between tabs and drag to reorder tabs are not here. Tab order changes only by the API.

## Plan Change Log

## Review Triage Log
