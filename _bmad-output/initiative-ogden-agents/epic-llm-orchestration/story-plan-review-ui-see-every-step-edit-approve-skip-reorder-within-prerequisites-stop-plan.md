---
title: 'Plan review UI: see every step, edit, approve, skip, reorder within prerequisites, stop (epic 15)'
type: 'feature'
ticket: '15.6'
created: '2026-10-05'
status: 'in-progress'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
baseline_revision: 'bdd742c77d14eb879929ed24277ad4967e3cee14'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-llm-orchestration/epic-llm-orchestration.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The tracer (15.3) shows a plan but offers one button, Approve and send. The user cannot change an instruction, leave a step out, put steps in a better order, or halt a run, and the page does not say plainly what the manager is doing or where it runs.

**Approach:** The plan review. Every step is shown with its worker, chat, instruction, requested mode (always Ask), prerequisites, and the page says where the manager runs. Core's `Orchestration` gains four user actions, each a use-case behind its own route: edit an instruction (the new text passes the same text rules as manager text and any secret in it is refused; an edit of an approved step puts it back to waiting, so it needs a fresh approval), skip a step (a skipped step is never dispatched and the steps that need it wait), reorder the steps (a full new order that keeps every step after its prerequisites and keeps sent steps where they are, else refused), and Stop (the run ends, `stopped` with reason `user`, and nothing more is approved, edited or sent). Dispatch in the default mode re-checks that the user approved that step and that its text is the text approved. The manager and dispatch code have no way to call these: an architecture test proves the manager files and the dispatch function never name the approve, edit, skip, reorder or stop use-cases. While the manager works the page says so in plain words and nothing about the workers' chats is held.

**Decisions (user, 2026-10-05; epic Notes):** approvals are per step and enforced by the server in the default mode; approval comes only from a user action; the manager never approves, changes a worker's mode or uses Skip all; a visible Stop halts the run; the manager runs on a model the user chose and the page says where (this computer or another, with the server's name).

## Boundaries & Constraints

**Always:** the rules live in core, not in the page; every edited string goes through the manager text rules (`ManagerInstruction`) and is refused if it holds a secret; plain copy, no em or en dash; tests run no real model, agent, network or keychain.

**Never:** automatic mode, limits enforcement or the loop (entries 8 and 9); a build; a change to a worker's mode; a route or call the manager's code can reach that approves, edits, skips, reorders or stops; a hand edit of the spec or architecture.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Edit a waiting step | new text passing the rules | text replaced, still waiting, `step_edited` | n/a |
| Edit an approved, unsent step | new text | text replaced, back to waiting (approval cleared), `step_edited` | the old approval cannot send the new text |
| Edit with bad text | control characters, empty, over the cap, a secret | refused 400 with plain words, nothing changes | n/a |
| Edit a sent, skipped, done or failed step, or in a closed run | any | refused 409 `step_not_changeable` | n/a |
| Skip a step | waiting or approved | `skipped`, `step_skipped`; it never dispatches; steps that need it stay waiting | a sent step: 409 `step_not_changeable` |
| Skip the last open step | every other step done or skipped | run `finished` | n/a |
| Reorder | a permutation that keeps prerequisites first and sent steps in place | new positions, `steps_reordered` | n/a |
| Bad reorder | a step before its prerequisite, a missing or extra id, a sent step moved | refused 409 `bad_order` with the plain reason, nothing changes | n/a |
| Stop | run planning, waiting, running or paused | run `stopped` (user), `run_stopped`; nothing further approved, edited or sent; a worker turn in flight is cancelled | an ended run: 409 `run_not_open` |
| Approve or send after Stop | any step | refused | 409 |
| Approval without a user action | a call with no tab token; a body claiming another approver | 401 from the gate; the stored approver is `user` whatever is sent | n/a |
| Send an approved step whose text changed meanwhile | edit during the send | refused, nothing sent | 409 `step_not_approved` |
| Manager thinking | run `planning` | the page says the manager is working and that chats stay usable | n/a |

</frozen-after-approval>

## Code Map

- `packages/shared/src/orchestration.ts`, `events-orchestration.ts`, `events.ts`, `api.ts`, `errors.ts` -- the edit and reorder requests, step transition (approved back to proposed), the `steps_reordered` event, routes, plain sentences, error codes.
- `packages/core/src/orchestration.ts`, `errors.ts` -- `editStep`, `skipStep`, `reorderSteps`, `stopRun`; dispatch re-checks.
- `packages/server/src/orchestration-routes.ts` -- the four routes.
- `packages/web/src/orchestrate`, `routes/workspace-orchestrate-page.tsx` -- the review UI.
- tests: shared, core, server (and the gate and guard coverage lists), web DOM, architecture (manager and dispatch never call the user actions), Playwright.

## Tasks & Acceptance

- [ ] shared contracts, event and routes
- [ ] core use-cases and dispatch re-checks
- [ ] server routes
- [ ] web review UI
- [ ] tests (core, server, DOM, architecture, e2e)

**Acceptance Criteria:**
- Given a three step plan, editing an approved step makes it need a fresh approval and a direct send is refused until then.
- Given a skipped step, it never dispatches, and a step that needs it waits.
- Given a reorder that puts a step before its prerequisite, it is refused and the order is unchanged.
- Given Stop, the run is stopped and nothing more can be approved or sent.
- Given a call to approve without the tab's token, the gate refuses it, and the manager and dispatch code never name the user actions.

## Implementation Notes

(Filled in when built.)

## Spec proposals

(Filled in when built.)

## Plan Change Log

None yet.

## Review Triage Log

(After review.)

## Verification

(After the runs.)
