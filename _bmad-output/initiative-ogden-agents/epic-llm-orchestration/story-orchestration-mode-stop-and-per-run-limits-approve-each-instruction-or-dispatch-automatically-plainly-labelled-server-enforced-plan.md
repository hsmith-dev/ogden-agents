---
title: 'Orchestration mode, Stop and per-run limits: Approve each instruction or Dispatch automatically, plainly labelled, server-enforced (epic 15)'
type: 'feature'
ticket: '15.8'
created: '2026-10-06'
status: 'in-review'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick-security', 'quick-correctness']
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

- [x] shared contracts, events, routes
- [x] core: once per project confirmation, defaults store, mode sync, automatic engine, limits, refusal events, Stop, activity
- [x] server routes and wiring
- [x] web: mode toggle and confirmation, defaults and limits, activity log, stop reasons
- [x] tests (core, server, DOM, architecture, e2e)

**Acceptance Criteria:**
- Given a project that never confirmed, switching to automatic without `confirm` is refused and writes nothing; with it the project is automatic and the event records the confirmation; later switches ask nothing.
- Given the default mode, a dispatch of a step not approved by the user is refused in code.
- Given an automatic run with the fake manager and fake workers, core dispatches each step in turn and stops at 20 instructions, at depth 3 and at 30 minutes (fake clock), at the first refusal and at the first error, each with its plain reason and event.
- Given a subscription agent in an automatic run, the step waits for the user instead of being sent.
- Given the mode switched back mid-run, the next step needs approval.
- Given the piece off, Stop still ends the run and cancels the worker's turn.
- Given sent and refused instructions, the activity log lists each from the events.

## Implementation Notes

- Mode is the project's setting, read at each use (`readOrchestrationMode`). A run is stored with the mode and limits in force at its start, and `syncMode` brings its mode to the project's at every read, dispatch and engine pass, appending `orchestration.mode_changed` when they differ. Back to Approve each instruction, a step the mode approved and did not send goes back to `proposed` (also whatever else left one so in that mode), and `dispatchStep` re-reads the mode after the worker is checked, so a switch while a chat is being made still refuses. Switching a run that began under approve each to automatic starts the engine on it (a `workspace.settings_changed` listener).
- Once per project (E15-R3, AD-15): `readAutomaticConfirmed` finds a `workspace.settings_changed` with `orchestrationAutomaticConfirmed` on the project's own stream (the `events_stream_idx` index, so its chats are not scanned). A project with the mark switches without `confirm`; one without is refused `confirmation_required` and nothing is written; the mark is written when the confirmation is given (even if the mode did not change), never twice. `getSettings` carries `orchestrationAutomaticConfirmed: true` when present. Delete history takes the record with it, so the user is asked again, never the other way. No migration.
- App-wide default (follows 15.5's roster default): `preferences.json` `newProjects.orchestrationMode` and `orchestrationLimits` (read on their own, a damaged one reads as the default; every save of the file keeps them), `GET` and `PUT /api/v1/settings/orchestration`, `settings.orchestration_defaults_changed` when something changed, the page in Settings for new projects. Making automatic the default needs `confirm: true` every time it is set. **Decision, recorded:** the default is never copied into a project. A new project starts on Approve each instruction and the settings page says the default is automatic and waits for the project's own confirmation. This is the safe equivalent of "a new project copying an automatic default stays on approve each until confirmed" with no state that could hold a project in automatic without a confirmation.
- Limits: 20 instructions, depth 3, 30 minutes by default, adjustable in Settings for new projects within 1 to 20, 1 to 5 and 1 to 120 (`ORCHESTRATION_LIMIT_BOUNDS`, `BoundedRunLimits`; the run's stored shape stays wider so older rows read). A new run takes the limits as they are then. **Depth is defined** as the longest `depends_on` chain: a step with no prerequisite is depth 1, any other one deeper than the deepest step it needs (`stepDepths`); until the loop (entry 9) nothing else nests, and the loop will count a decision that follows a result as one more level. Limits apply to what the mode sends (the user's own approvals are the control in the default mode). The instruction count is the steps that have a chat (`sessionId`), checked before each send: the run stops with `instruction_limit` instead of sending one more; depth is checked against the next step (`depth_limit`); time is `clock() - createdAt` (`time_limit`), also while a worker is busy (an unref'd timer and the worker chat's state changes re-check; a busy worker's turn is asked to stop).
- The engine (`scheduleAdvance`, `advanceOnce`, in `orchestration.ts`): per run one pass at a time; each pass re-reads the piece, the project's mode, the run and its steps, so a late or repeated pass is harmless. It settles finished steps, then takes the first step that is not done or skipped: a dispatched step or a failed one means wait or stop; a step the user approved is the user's to send; limits; prerequisites that are not done (a skipped one) make the run wait for the user; a subscription agent's step makes the run wait (`awaiting_user`, one `run_paused` per step); otherwise the mode approves (`by: mode`) and `dispatchStep` sends it, marked `manager_auto`. The first refusal stops the run (`dispatch_refused`), the first other error fails it (`worker_error`), a refusal for `approve_each_only` hands the step back to the user. Triggers: `startRun` (awaited, so the first step is sent when the run starts), a worker chat leaving `working`, a settings change of the mode, a read that settled a step, the time limit timer. `whenIdle()` lets a test wait for the passes. The engine names none of the user's own actions and no settings mutator (architecture test, with a guarded slice for it).
- Vendor terms (15.7 rule changed on purpose): a subscription agent takes an instruction the user approved, in either mode (`approvedBy === 'user'`); what the mode approved is refused `approve_each_only`. The 15.7 text "never in a run under the automatic mode" is replaced by the pause: the user approves that step and sends it, then the run goes on by itself. The roster (15.5) still refuses to switch a project to automatic while its worker or reviewer is such an agent, so the pause is reached only through a reviewer or a team changed after, a direct row, or a later relaxation of the roster rule (deferred as a decision for the user).
- Stop: `stopRun` no longer calls the Orchestration guard, and its route is registered through `orchestrationRoutes` with `guarded: false` (the project must exist and the run must be its own; the gate still applies). It closes the run in one transaction (`closeRun`), cancels the manager call and each worker turn in flight. With the piece off, the engine sends nothing and Stop still works; turned on again, the run reads as stopped.
- Refused dispatch: `orchestration.dispatch_refused {runId, stepId, worker, reason, message}` is appended whenever `dispatchStep` throws a `DispatchRefusedError`, in both modes (resolves the 15.7 deferral; the manager is not yet told, see Deferred).
- Activity log (`activity`, `GET .../orchestration/activity`): the newest 400 approval, dispatch and refusal events of the project's stream, folded into at most 100 entries (when, worker, chat new or existing, who approved, the start of the instruction masked and cut to 200, result `working`, `finished`, `failed`, `stopped` or `refused`, the refusal's words); the Orchestrate page lists them. The counter on a run is "N of M instructions sent", no money anywhere (a test looks for money words).
- Honest transcript: a new message origin `manager_auto` ("Sent by the manager automatically") for what the mode sent; `manager` keeps "approved by you".
- New project layout: `orchestrate/mode-api.ts`, `orchestrate/mode-section.tsx` (`ModeChoiceView`, `ProjectMode`, `DefaultsView`, `OrchestrationDefaultsSection`), the mode and limits under Orchestration in the project settings and in Settings for new projects, the Orchestrate page's mode line, counter, stop reasons, wait note and `ActivityLog`.
- Tests: shared (+11), core `orchestration-mode` (25) plus changes to the 15.7 tests, server `orchestration-mode` (9), web DOM `orchestrate-mode` (21), architecture (+3), Playwright (+3).

## Spec proposals

Written to the memlogs with `_bmad/scripts/memlog.py` (never to the frozen documents): the architecture memlog gets the fifteenth `orchestration.dispatch_refused` event, the install level `settings.orchestration_defaults_changed`, the stop reason `dispatch_refused`, the message origin `manager_auto`, the run's mode following the project's, an AD-15 note (the once per project confirmation is the mark on `workspace.settings_changed`, read from the project's stream; the default is never copied), an AD-22 note (Stop is outside the piece guard) and the routes; the spec memlog gets a CAP-22 mode and limits note. `covers` stays empty.

## Plan Change Log

- 2026-10-06 (build): the 15.7 refusal `approve_each_only` applied to every subscription agent whenever the run was automatic. The user's instruction for this story is that such a step waits for the user's approval rather than being dispatched, so the rule now refuses only what the mode approved (`approvedBy` not `user`); the user's own approval of that instruction is allowed in either mode. The 15.7 test was changed to match. Frozen intent unchanged (the vendor rule is "approve each only").
- 2026-10-06 (build): the app-wide default is stored but never copied into a project (a project asks for its own confirmation), the safe equivalent the user allowed, instead of copying and holding a project on approve each.

## Review Triage Log

2026-10-06, security and correctness reviewers, no critical findings. Patched: an automatic run stalled after the user skipped, edited or reordered a step, or approved one (high), now each lets the run look again; a project switched to automatic while the manager was thinking, or synced by a read, never advanced (medium), now the start uses the synced mode and a read that made a run automatic lets it go on; a run past its time limit waiting on a user approved step re-armed a one second timer for good and never halted (medium), now the time check comes first and no timer is armed once past; an unexpected error in a pass left the run open silently (low), now it fails the run as `worker_error`; deleting a project's history removed the confirmation record but left the mode, and the engine trusted the mode alone (medium), now the engine honours automatic only while the confirmation is on record; the mode sent into a chat that runs without asking (Auto or Skip all) although the confirmation says agents still ask (medium), now the run waits for the user at such a step (a named chat's mode, or the project's default for a new chat), and the wait note and confirmation say so; turning the piece off mid-run failed the run as `worker_error` (low), now the pass leaves it; a step cut off by a limit read as failed in the activity log (low), now stopped. Tests added for the skip, the missing confirmation, and the non Ask chat. Not changed: the activity log reads the newest 400 events, so an old instruction's approver can read as unknown beyond that (low, audit only); re-enabling the piece or switching the mode lets open runs go on, including a step just edited (low, by design, the confirmation is about dispatching on its own); the in memory set of steps already asked about grows with runs and repeats a `run_paused` after a restart (low, entry 9); a refusal on a freshly made chat records `worker_error` rather than `dispatch_refused` (low, 15.7 behaviour, the run still stops); a rare `approve_each_only` refusal leaves a "Not sent" activity line for a run that waits (low); the needs approval note keys on run state, not the step's agent (low); the limits form snaps back after a refused save and keeps "Saved." (low); the time limit counts planning time and the user's own Send is not held by the limits (low, by design); `cancelTurns` can cancel a turn the user later starts in a named chat (low, as 15.6).

## Verification

**Results:** `pnpm typecheck` clean; `pnpm test` 335 files, 4183 passed, 8 skipped; Playwright `orchestrate` (9) passed; `PROVENANCE_BASE=origin/main pnpm provenance` passes.

**Commands:** `pnpm typecheck`, `pnpm test`, `npx playwright test tests/e2e/orchestrate.spec.ts` (after `pnpm run build`), `PROVENANCE_BASE=origin/main pnpm provenance`.
