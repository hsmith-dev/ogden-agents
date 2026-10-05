---
title: 'Tracer bullet: one plain-shell pane in Developer mode, end to end'
type: 'feature'
ticket: '2'
created: '2026-10-05'
status: 'in-review'
baseline_revision: 'e6453545742935b05b812f3d83d8ae3a7ac7a5e1'
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

**Problem:** Epic 16 (a herdr style terminal workspace in Developer mode) has had its go (spike 16.1, the user's decision of 2026-10-05) but nothing exists yet: no pane, no route, no socket, no page. Every later story (contracts, layout, launchers, status, persistence, notifications) needs one real path through core, the `terminal-pty` adapter, a gated per pane socket and xterm to hang on.

**Approach:** The thinnest end to end path with the spike's design conditions that belong to a pane's life designed in: with Developer mode on, a project's Terminals page opens a pane that runs the user's own shell in the project folder; core owns the pane (`Panes`, in memory), the adapter gives each pane a headless screen mirror so a reload replays the screen exactly, the server serves `/ws/pane/:paneId` behind the one gate with Developer mode enforced by core, and the page shows it with xterm and the Unicode 11 addon (also added to the existing chat terminal panel).

## Boundaries & Constraints

**Always:** Developer mode is enforced by core on every pane operation and by the socket (403 `developer_mode_required`; close 4403). A pane's child gets `paneEnvironment()` (the AD-16 allowlist plus `COLORTERM` and, on Windows, the program folders; never a key, a token or an `OGDEN_AGENTS_*` switch; proxies and `SSH_AUTH_SOCK` only as an opt in no story has turned on yet). The shell is found by absolute path. A pane's text is never logged, evented or stored. A pane is separate from a chat session. Caps of 8 panes per project and 16 per install, taken and checked in one tick. Closing a pane, Developer mode turning off and the server stopping each stop the program and what it started. Plain language, no dashes, in everything the user reads.

**Never:** A CLI named anywhere in core or shared; launchers, detection, status, persistence, notifications, layout (stories 16.3 to 16.9); a start up sweep of recorded pids (16.7); auto approving, injecting flags or scripting a pane; installing anything; any gate, CSP or migration change; touching the chat Chat | Terminal toggle.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error handling |
|---|---|---|---|
| Open, Developer mode on | `POST panes {cols, rows}` | 201 `pane` (`starting`, then `running` on first output), shell running in the project folder | n/a |
| Any pane route, Developer mode off | GET, POST, DELETE, restart | 403 `developer_mode_required`; nothing started | the page shows one sentence |
| Pane socket without the tab token, wrong Origin, wrong Host | upgrade | refused by the gate (401, 403) | n/a |
| Pane socket, Developer mode off | upgrade passes the gate | closed 4403 | page says Developer mode only |
| Server's secrets in its environment | sentinel keys, token, proxy, SSH agent, `LC_*` carrier | none reaches the pane or a shell in it; `COLORTERM` does | n/a |
| Reload while a full screen program shows | second viewer attaches | `reset`, then the mirror's snapshot, then live output; the screen is rebuilt | n/a |
| 9th pane in a project, 17th in the install, or a burst | open | 409 `pane_limit_reached`, nothing started | plain message |
| Program exits | by itself | `state` exited, exit code, pane stays; Restart pane starts it again in the same pane and socket | a failed restart leaves it stopped |
| Close | DELETE | 204; program and its children stop; viewers closed 4001 | other project's pane id 404 |
| Developer mode turned off with panes running | settings event | every pane and its tree stops | n/a |
| `node-pty` cannot load | open | 409 `terminal_unavailable` with a plain reason; nothing left open | the page says why and disables New terminal |

</frozen-after-approval>

## Code Map

- `packages/shared/src/panes.ts`, `ids.ts` (`pan`), `api.ts` (`workspacePanes`, `workspacePane`, `workspacePaneRestart`, `PANE_SOCKET_ROUTE`), `errors.ts` (`pane_limit_reached`) -- the contract; story 16.3 freezes the rest.
- `packages/core/src/terminal-port.ts` (`openPane?`, `PaneProcess`), `panes.ts` (`createPanes`), `errors.ts` (`PANES_NEED_DEVELOPER_MODE`, `PaneLimitError`) -- core's use-cases. Reuses `TerminalAvailability`, `terminalUnavailableReason`, `DeveloperModeRequiredError`.
- `packages/adapters/src/terminal-pty/pane-mirror.ts`, `terminal-port.ts` (`openPane`), `shell.ts`; `child-env.ts` (`paneEnvironment`); `terminal-memory` (`openPane`) -- reuses `hiddenPtySpawner`, the 3.8 retry and the tree kill unchanged.
- `packages/server/src/pane-routes.ts`, `pane-socket.ts` (reuses `createInputBudget` and the slow viewer rule of `terminal-socket.ts`), `start-panes.ts`, `app.ts`, `start.ts`, `test-hooks.ts` (`OGDEN_AGENTS_TEST_PANE_SHELL`).
- `packages/web/src/terminal/pane-view.tsx`, `pane-socket.ts`, `panes-api.ts`, `terminals-view.tsx`, `xterm-setup.ts` (Unicode 11, also in `terminal-panel.tsx`), `routes/workspace-terminals-page.tsx`, `shell/workspace-tabs.tsx` (`developerOnly` Terminals tab, `g t`), `router.tsx`.
- Tests: `core/test/panes.test.ts`, `adapters/test/terminal-pane.test.ts`, `server/test/panes.test.ts`, `gate.test.ts`, `web/test/terminals.dom.test.tsx`, `tests/e2e/panes.spec.ts`, `tests/fixtures/fake-pane-shell.mjs`.
- Dependencies pinned exactly: `@xterm/headless` 6.0.0 and `@xterm/addon-serialize` 0.14.0 (root and adapters), `@xterm/addon-unicode11` 0.9.0 (web).
- Left alone: `packages/adapters/src/terminal-pty/index.ts` spawn code, `terminal-socket.ts`, the chat toggle.

## Tasks & Acceptance

**Execution:**
- [x] shared contract, core `Panes`, adapter pane (mirror, shell, `paneEnvironment`), server routes, socket and wiring, the page and its tab -- one path end to end
- [x] tests at every layer plus the e2e, with a fake shell and no real shell or CLI

**Acceptance Criteria:**
- Given Developer mode on, when a pane opens and a command is typed, then its output shows and the program runs in the project folder with `COLORTERM` and no server secret.
- Given a full screen picture painted once, when the page reloads, then the screen is rebuilt from the server's mirror.
- Given Developer mode off, then every pane route answers 403 and the socket closes 4403; the Terminals tab is not shown.
- Given a closed pane, Developer mode turned off or the server stopping, then the program and its child are gone.
- Given the chat terminal panel, then emoji use the Unicode 11 width table.

## Implementation Notes

- Replay: the mirror is parsed before any viewer hears a chunk, and a viewer attaches with an empty write as a marker in the parser's queue, so its snapshot is exactly what came before and the queued output follows in order.
- Developer mode off stops every pane in this story (the safe default); story 16.9 replaces it with the user's choice to stop or keep them running.
- Closing a pane asks nothing in this story; story 16.4's layout work adds the confirmation.
- The restart and "slow to start" parts of E16-R11 are here (a `starting` state, Restart pane after 10 s of silence); resize nudge on Windows waits for the user's live check of the held first output.
- Two of the spike's open items are resolved here (`paneEnvironment`, Unicode 11); the start up sweep stays with 16.7.

## Plan Change Log

## Review Triage Log
