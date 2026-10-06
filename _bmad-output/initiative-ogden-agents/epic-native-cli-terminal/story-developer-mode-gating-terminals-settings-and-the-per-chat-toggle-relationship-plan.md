---
title: 'Developer-mode gating, Terminals settings and the per-chat toggle relationship'
type: 'feature'
ticket: '9'
created: '2026-10-05'
status: 'in-review'
baseline_revision: '3beaf5b7c478f35561a9d47a2a54e00315a6cd4e'
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

**Problem:** The Terminals surface is gated and its pieces work, but the user has no place to choose what a terminal is given, which programs notify, each program's own arguments or to hide the surface; turning Developer mode off just stops running terminals without asking; and nothing says how a pane relates to a chat's own Terminal switch.

**Approach:** The install's Terminals settings, kept by core and enforced by the server (Developer mode only), with a Settings page: hide the surface, notifications per program, each program's arguments, and the two environment opt ins (proxies and the SSH agent, off by default, read at each start). Turning Developer mode off with terminals running asks (409 `panes_running`): stop them, or keep them running in the background until Ogden Agents stops (unreachable, back when it is turned on again). The Terminals page and Settings say plainly that a chat's own Terminal switch is separate.

## Boundaries & Constraints

**Always:** Every settings route and pane route is refused 403 without Developer mode by the server; a simple user sees no Terminals entry anywhere (tab, settings menu); the opt ins are off by default and read at each start; a launcher's arguments are the user's own text and are never logged or put in an event; keeping running panes never makes them reachable without Developer mode and the server stopping ends them; a missing `node-pty` shows its reason in plain words with a path filtered out; plain words, no dashes.

**Never:** Changing the chat Chat | Terminal toggle or epic 3's handoff; a button that opens a chat's session in a pane (left to the user's decision, see Notes); per project hiding; adding any flag of Ogden's own to a program.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error handling |
|---|---|---|---|
| Settings without Developer mode | GET or PUT | 403 `developer_mode_required` | n/a |
| Developer mode off, terminals running | PUT developer-mode | 409 `panes_running` with the count; nothing changed | the page asks Stop, Keep or Cancel |
| Stop | `panes: 'stop'` | programs and children end; panes kept stopped | n/a |
| Keep | `panes: 'keep'` | programs run on unseen; back when turned on again | the server stopping ends them |
| Proxy or SSH agent opt in | settings | reaches the next pane's environment only | off by default |
| node-pty failed to load | list, open | plain reason; 409 `terminal_unavailable`; the rest of the app runs | n/a |

</frozen-after-approval>

## Code Map

- `shared/src/panes.ts` (`TerminalsSettingsResponse`, `UpdateTerminalsSettingsRequest`), `chat.ts` (`SetDeveloperModeRequest.panes`), `errors.ts` (`panes_running`), `api.ts` (`terminalSettings`), `events-settings.ts` (`settings.terminals_changed`).
- `core/src/terminals-settings.ts`, `db/schema.ts` and `drizzle/0024_terminals_settings.sql`, `core.ts`, `panes.ts` (`runningCount`, `keepRunningOnNextDeveloperModeOff`).
- `server/src/terminals-settings-routes.ts`, `settings-routes.ts` (the question), `start-panes.ts` (settings into the environment and notifications), `pane-routes.ts` (plain reason).
- `web/src/terminal/terminals-settings.ts`, `routes/terminals-settings-page.tsx`, `appearance/developer-mode.tsx` and `routes/appearance-page.tsx` (the dialog), `shell/workspace-tabs.tsx`, `status-sidebar.tsx`, `terminals-view.tsx`, `launcher-list.tsx`.

## Tasks & Acceptance

**Execution:**
- [x] settings store, routes and page; the Developer mode question; hidden surface; opt ins into the environment; plain node-pty reason; tests
- [ ] "open this chat's session here" through epic 3's handoff (an intent question: see Notes)

**Acceptance Criteria:**
- Given Developer mode off, then no Terminals surface shows and every pane and settings request is refused 403.
- Given running terminals, then turning Developer mode off asks; Stop ends them, Keep leaves them until the server stops.
- Given node-pty failing to load, then the surface shows why and the rest works.

## Implementation Notes

- The epic asks for a button that opens a chat's session in a pane through epic 3's handoff. A pane and the chat's own terminal would then run the same CLI session twice, and the handoff's one driver rule does not cover a second process: how it should behave is a product decision, so this story ships the plain conflict note on the Terminals page and in Settings and records the button as an open question for the user (deferred work, 16.9b).
- Per project hiding of the surface is not built; the setting is install wide.

## Plan Change Log

## Review Triage Log

Security review and correctness review, both read only.

- Fixed: a viewer that attached just after a keep was fed live output (Developer mode now checked in `attach`).
- Fixed: a stale keep choice (failed save) could override a later Stop (the choice is set per request and always cleared afterward; test added).
- Fixed: viewers stayed connected but unfed after a keep and after Developer mode came back (open sockets are closed on keep; the page reconnects; test added).
- Fixed: `launcherArgs` replaced the whole map (now merges per program, an empty text removes one, key order no longer causes a write); the page sends only the changed program and clears its typed text after a save; notify checkboxes are disabled while a save is pending.
- Fixed: Terminals tab flicker while settings load.
- Accepted: a pane still starting when Developer mode goes off is counted as running but is stopped when it finishes starting; kept panes cannot be closed while Developer mode is off (the dialog says they stay until Ogden Agents stops); kept panes still emit status events (state only).
- Deferred: unused `notifyLaunchers` siblings `notifyNeedsAttention` and `notifyExited` in the schema; launcher id keys not checked against the registry; Cf characters in arguments; `saveDeveloperMode` ref guard; `as '/settings/tools'` cast; a Stop and Cancel dialog DOM test.
