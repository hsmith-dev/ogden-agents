---
title: 'Orchestration mode, Stop and per-run limits: Approve each instruction or Dispatch automatically, plainly labelled, server-enforced (epic 15)'
type: 'feature'
ticket: '15.8'
created: '2026-10-06'
status: 'in-progress'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
baseline_revision: '3d535e0d443e78885b685bdeddfd39730edc1682'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-llm-orchestration/epic-llm-orchestration.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The mode setting exists (15.2) but nothing reads it: every run is fixed to Approve each instruction, the switch to automatic asks for `confirm` every time and is not remembered per project, there is no app-wide default and no way to change the run limits, the limits are never enforced, an automatic run cannot dispatch, Stop is refused while the Orchestration piece is off, a refused dispatch leaves no event, and the Orchestrate page has no activity log.

**Approach:** Make the mode real and server-enforced. A project has a mode (Approve each instruction by default, Dispatch automatically) changeable any time in its settings, plainly labelled. Switching to automatic is confirmed once per project: the confirmation is the existing `orchestrationAutomaticConfirmed` mark on `workspace.settings_changed`, read back from the event log, so a project that confirmed before does not ask again and a project that never did is refused without `confirm: true`. An app-wide default mode and the run limits (20 instructions, depth 3, 30 minutes; adjustable within bounds) are install settings kept beside the new project defaults and changed through `settings.orchestration_defaults_changed`. In the default mode a dispatch without the user's approval is refused in code. In automatic mode core itself dispatches the plan's steps one at a time, within the run's limits, and stops at the first refusal, error or limit with a plain reason and a `run_stopped` event. A subscription agent (a sign in with the user's account) is never dispatched by the mode: that step waits for the user's own approval. Switching the mode back mid-run returns the next step to needing approval. Stop is never blockable: it works with the piece off and cancels the worker's current turn. A refused dispatch is now recorded (`orchestration.dispatch_refused`). The Orchestrate page lists every dispatched or refused instruction, read from the events, and shows an instruction counter and no money.

**Decisions (user, 2026-10-05; epic Notes):** per team mode, "Approve each instruction" default, "Dispatch automatically", plainly labelled, changeable any time, server-enforced; switching to automatic confirmed once per project and recorded in the event log; limits 20 instructions, depth 3, 30 minutes, adjustable; a visible Stop and an activity log; subscription agents approve each only until terms are re-checked; workers keep their own permission cards and modes; the manager never changes the mode or the confirmation; no cost or budget.

## Boundaries & Constraints

**Always:** the rules live in core, not the page or the prompt; plain copy with no em or en dash; every refusal and stop has plain words; automatic dispatch keeps worker permission cards and modes untouched; tests run no real agent, model, network or keychain and use a fake clock for time.

**Never:** a change to a worker's mode, model, driver or agent; the manager (or code it can reach) naming a settings mutator, the confirmation or the mode; Skip all; a build; the next-decision loop, a pause on an unanswered worker card or a resume after a restart (entry 9); money or budget; a hand edit of the spec or architecture.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Switch a project to automatic, first time | `orchestrationMode: automatic` without `confirm` | refused 400 `confirmation_required`, nothing written | n/a |
| Same, with `confirm: true` | confirmed | mode saved, `workspace.settings_changed` carries `orchestrationAutomaticConfirmed: true` | n/a |
| Switch back and to automatic again | project confirmed before | allowed without `confirm`; no second confirmation mark | n/a |
| App-wide default is automatic | a project is added | it starts on Approve each instruction; the project settings say the default is automatic and wait for the project's own confirmation | n/a |
| Default mode dispatch | step approved by nobody or by `mode` | refused 409 `step_not_approved`, nothing created | n/a |
| Automatic run, plan of three | project automatic | core approves (`by: mode`) and dispatches each step when the one before finished; run finishes | n/a |
| Instruction limit | limit 2, plan of three | two sent, third not; run `stopped` reason `instruction_limit` | plain words |
| Depth limit | chain of four steps, depth 3 | three sent, fourth not; `depth_limit` | plain words |
| Time limit | fake clock past 30 minutes | next dispatch not made; `time_limit` | plain words |
| Refusal in an automatic run | worker not ready, chat busy | nothing sent; `orchestration.dispatch_refused`; run `stopped` reason `dispatch_refused` | plain words |
| Worker error in an automatic run | step failed | run `failed` `worker_error`, nothing more is sent | plain words |
| Subscription agent step in an automatic run | worker signs in with the user's account | not dispatched by the mode; the step waits for the user's approval; once the user approves and sends it, the run goes on | `approve_each_only` words |
| Switch back to approve each mid-run | a step the mode approved, not sent | it is waiting for the user again | `orchestration.mode_changed` |
| Stop with the piece off | any run | run stopped, worker turn cancelled | n/a |
| Refused dispatch, any mode | any refusal of 15.7 | `orchestration.dispatch_refused` event | n/a |
| Activity log | runs with sent and refused instructions | one line each: when, worker, chat, who approved, result | n/a |
| Limits out of bounds | 0 instructions, depth 9 | refused 400, nothing written | n/a |

</frozen-after-approval>

## Code Map

- `packages/shared/src/orchestration.ts`, `events-orchestration.ts`, `events-settings.ts`, `events.ts`, `bmad.ts`, `chat.ts`, `api.ts` -- bounds, depth, stop reason `dispatch_refused` and its words, defaults and activity shapes, the two new events, routes.
- `packages/core/src/orchestration.ts` -- mode read and sync, automatic engine (`advance`), limits, refusal events, Stop unguarded, activity.
- `packages/core/src/orchestration-defaults.ts` (new) -- the install's default mode and limits; `new-projects.ts`, `workspace-settings.ts`, `core.ts`, `index.ts`.
- `packages/server/src/orchestration-routes.ts`, `orchestration-defaults-routes.ts` (new), `app.ts`, `start.ts` -- the activity route, defaults route, Stop outside the piece guard.
- `packages/web/src/orchestrate`, `workspaces/orchestration-section.tsx`, `routes/new-projects-page.tsx` -- the mode toggle with its confirmation, the defaults, the limits, the activity log, the stop reason.
- tests: shared, core, server, web DOM, architecture, Playwright.

## Tasks & Acceptance

- [ ] shared contracts, events, routes
- [ ] core: once per project confirmation, defaults store, mode sync, automatic engine, limits, refusal events, Stop, activity
- [ ] server routes and wiring
- [ ] web: mode toggle and confirmation, defaults and limits, activity log, stop reasons
- [ ] tests (core, server, DOM, architecture, e2e)

**Acceptance Criteria:**
- Given a project that never confirmed, switching to automatic without `confirm` is refused and writes nothing; with it the project is automatic and the event records the confirmation; later switches ask nothing.
- Given the default mode, a dispatch of a step not approved by the user is refused in code.
- Given an automatic run with the fake manager and fake workers, core dispatches each step in turn and stops at 20 instructions, at depth 3 and at 30 minutes (fake clock), at the first refusal and at the first error, each with its plain reason and event.
- Given a subscription agent in an automatic run, the step waits for the user instead of being sent.
- Given the mode switched back mid-run, the next step needs approval.
- Given the piece off, Stop still ends the run and cancels the worker's turn.
- Given sent and refused instructions, the activity log lists each from the events.

## Implementation Notes

(Filled in when built.)

## Spec proposals

(Filled in when built.)

## Plan Change Log

None yet.

## Review Triage Log

(Filled in after review.)

## Verification

**Commands:** `pnpm typecheck`, `pnpm test`, `npx playwright test tests/e2e/orchestrate.spec.ts` (after `pnpm run build`), `PROVENANCE_BASE=origin/main pnpm provenance`.
