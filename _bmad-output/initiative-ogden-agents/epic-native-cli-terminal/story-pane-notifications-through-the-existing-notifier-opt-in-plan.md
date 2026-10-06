---
title: 'Pane notifications through the existing notifier, opt-in'
type: 'feature'
ticket: '8'
created: '2026-10-05'
status: 'built'
baseline_revision: '138c2976d21c74c03f4654976296a09aa6cb6aec'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['security', 'correctness']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-native-cli-terminal/epic-native-cli-terminal.md'
---

<frozen-after-approval reason="human-owned intent: do not modify unless human renegotiates">

## Intent

**Problem:** A pane that needs the user shows in Needs you and the tab title, but a user in another window gets no sound or notice, and the epic wants that only for panes they chose.

**Approach:** An opt in per pane (and, once story 16.9 stores the setting, per launcher), off by default and kept with the pane: a pane's status event says whether its notifications are on, and the page's existing attention notifier (the sound, the desktop notice, only when Ogden is not in front, from the leader tab) acts only on a pane that is opted in, with the project and the pane's name and nothing else. The webhook part (through `NotifierPort`, epic 11's webhooks) waits for epic 11's webhook story to be on main and is recorded as a follow up.

## Boundaries & Constraints

**Always:** Off by default; state and the pane's name only, never terminal text; the same away, desktop and sound settings as chats; a stored opt in survives a restart; Developer mode enforced; plain words, no dashes.

**Never:** Notifying a pane that is not opted in, sending anything to a webhook in this story (the webhook store is epic 11's and is not on main), notifying for an ended program (a later change if wanted), anything stored of what a pane printed.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error handling |
|---|---|---|---|
| Pane not opted in goes to needs attention | status event notify false | Needs you row and tab title only; no sound, no notice | n/a |
| Pane opted in, Ogden not in front | status event notify true | one notice and one chime (as the settings say) with project and pane name | n/a |
| Opted in, Ogden in front | same | none (the default away setting) | n/a |
| Opt in changed | PATCH notify | saved, kept after a restart | 400 for a bad body, 403 without Developer mode |

</frozen-after-approval>

## Code Map

- `shared/src/panes.ts` (`Pane.notify`, `UpdatePaneRequest`), `events-panes.ts` (`notify` on the status event).
- `core/src/db/schema.ts`, `drizzle/0023_pane_notify.sql`, `pane-store.ts`, `panes.ts` (`setNotify`, `notifyLaunchers`).
- `server/src/pane-routes.ts` (PATCH takes a name and/or notify); `web/src/shell/sidebar-model.ts` (`notify` on a pane need), `notifications/notifier.ts`, `attention-notifier.tsx`, `terminal/pane-view.tsx` (Notify me).
- Tests: `web/test/notifier.test.ts`, `pane-needs.test.tsx`, `terminals.dom.test.tsx`, `core/test/panes.test.ts`, `pane-persistence.test.ts`, `server/test/panes.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] opt in column and API, status event flag, notifier gate and click through, Notify me switch, tests
- [ ] webhook send through `NotifierPort` (waits for epic 11's webhook story; see deferred work)

**Acceptance Criteria:**
- Given a pane that did not opt in, then it makes no sound and no notice; given one that did, it makes one, with its name only.
- Given a notice, then its payload has no terminal text.

## Implementation Notes

- Epic 11's webhooks (11.4, #153) are not on main, and the webhook payload type is strict and epic 11's, so the send is left out rather than built on a moving base. The status event already carries what the send needs (the pane's name, the states, and the opt in).

## Plan Change Log

## Review Triage Log

Two reviews ran (one security, one correctness); the opt in held up in both.

| Finding | Verdict | Route |
|---|---|---|
| Opting in while a pane is still starting was lost on restart (S, C) | low, real | patch: the pane must be announced first |
| A flip showed in no other window (S, C) | low, real | patch: `pane_renamed` carries `notify`; the sidebar fold follows it |
| Title and notify were not applied atomically (S, C) | low | patch: the call without an event runs first |
| Checkbox had no accessible name; a stray indent (C) | low | patch |
| Opting in while a pane already waits gives no notice for that wait (C) | by design | the notice is for the next wait; the checkbox says what it shows |
| A user who unticked every kind still gets sounds for an opted in pane (C) | by design | the pane's own opt in is the choice |
| `notifyLaunchers` is not wired until 16.9 stores the setting (C) | known | 16.9 |
