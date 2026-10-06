---
title: 'Persistence: layouts survive a restart; stopped panes start on demand'
type: 'feature'
ticket: '7'
created: '2026-10-05'
status: 'in-review'
baseline_revision: 'c55170f1520418320ec5bdc7a693e3fff77ec4fd'
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

**Problem:** Panes and their layout live only in memory, so a restart (or Developer mode off) loses the workspace, and a server killed hard can leave a pane's program running (spike 16.1 finding 8).

**Approach:** Store each pane (id, project, launcher, name) and each project's layout in SQLite through core, never output, typed arguments or secrets; after a restart every stored pane comes back `stopped` in its layout with a Start button (the CLI's own resume offered in words); Developer mode off now keeps panes as stopped instead of forgetting them; panes with no viewer keep running and reattach with their screen; and the pids Ogden itself started are recorded in the data folder and swept at the next start, only if still the same process, never by name.

## Boundaries & Constraints

**Always:** The database holds the shape only; a pane that came back runs nothing until the user presses Start; Start looks the program up again and uses the arguments typed now, never old ones; the sweep touches only recorded pids whose process started at the recorded time; migrations through drizzle-kit renumbered after main; plain words, no dashes.

**Never:** Surviving a server stop (a multiplexer backend is out), storing output or typed arguments, killing by name, auto starting a pane, subfolder panes (a later change if the user wants them).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error handling |
|---|---|---|---|
| Restart with three panes | stored layout | same tabs, split and names, all stopped | a layout that no longer matches is rebuilt, one tab each |
| Start on a stopped pane | restart route | fresh program in the same pane and socket | a missing program is refused in words |
| User closes a pane | DELETE | gone after a restart too | n/a |
| Developer mode off then on | settings | programs stopped, panes and layout kept, stopped | n/a |
| Tab closed, pane running | socket closes | program runs on; a new viewer gets the screen | n/a |
| Server killed hard | pid file | next start stops recorded programs that are the same process | a reused pid or a gone process is only dropped |
| Anything printed or typed | output | in no table, file or log | n/a |

</frozen-after-approval>

## Code Map

- `core/src/db/schema.ts` and `drizzle/0022_terminal_panes.sql` (`terminal_panes`, `terminal_layouts`), `pane-store.ts`, `core.ts` (`paneStore`), `panes.ts` (restore, persist, `stopAll`, pids, Start with arguments).
- `adapters/src/pane-pids/index.ts` (records, sweep, `ps` and PowerShell start times).
- `server/src/start-panes.ts` (store, pids, sweep at start), `pane-routes.ts`; `web/src/terminal/pane-view.tsx` (Stopped, Start, resume words, arguments).
- Tests: `core/test/pane-persistence.test.ts`, `panes.test.ts`, `adapters/test/pane-pids.test.ts`, `server/test/panes.test.ts`, `web/test/terminals.dom.test.tsx`.

## Tasks & Acceptance

**Execution:**
- [x] store and migration, restore and persist, stopped state and Start, pid records and sweep, tests

**Acceptance Criteria:**
- Given a three pane layout and a restart, then the same layout returns with stopped panes, Start gives a fresh shell, and the database holds no output.
- Given a pane left with its tab closed, then it reattaches with its screen.
- Given a recorded pid of a left over program, then the next start stops it and nothing else.

## Implementation Notes

- Developer mode off used to forget panes; it now stops their programs and keeps them (story 16.9 will ask the user whether to stop or keep them running).
- The Windows start time check uses PowerShell (about half a second); it runs once at start and only when a record exists.

## Plan Change Log

## Review Triage Log
