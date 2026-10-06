---
title: "The loop: next-step decisions, stop on error, Deny or limit, pause on a worker's unanswered card, resume after a restart (epic 15)"
type: 'feature'
ticket: '15.9'
created: '2026-10-06'
status: 'in-progress'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
baseline_revision: 'de5dfa2a3a31a79088ad150b24e1068e4e4cbeba'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-llm-orchestration/epic-llm-orchestration.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A run does one step and then nothing asks the manager what comes next: `decideNext` is built and tested (15.4) but nothing calls it. A Deny on a worker's permission card reads as an ordinary finished chat, an unanswered card is only a "waiting" label, a refused dispatch in an automatic run stops the run without telling the manager, the manager's `ask_user`, `done` and `stop` have nowhere to go, and a run that was going when the server stopped is driven from memory (a listener and timers), so it waits for a chance event after a restart.

**Approach:** Close the loop in core. After a step's result is read back, core asks the manager through `ManagerPort.decideNext` for the next decision, with the capped, masked status report as delimited untrusted data. A decision is checked in code: its step id must be a step of the plan and a `dispatch` may name only a step that is still waiting (`proposed`) whose needed steps are done. `dispatch` marks that step as the manager's next suggestion; in the default mode the step still waits for the user's approval, in automatic mode the engine takes that step and follows the approve-by-mode rules and the limits of 15.8. `ask_user` shows the manager's question and the run waits; the user's answer goes to the manager as data on the next decision. `done` finishes the run; `stop` stops it. A Deny of a worker's permission card (read from the worker session's `permission.resolved` events) ends that step and stops the run `permission_denied`; the manager is told what happened and its reply is kept in the log. A refused dispatch in an automatic run stops the run and tells the manager the same way. A worker chat that waits on an unanswered permission card pauses the run (`paused`, reason `permission_card`) and the page links to that chat, where the user answers on the worker's own card; the loop and the manager can never answer a card or change a mode. A run resumes after a restart from its events and rows: `Orchestration.resume()` re-arms each open run (the time limit counts from the run's start), settles what finished, asks for a decision that was owed, and never dispatches an instruction already sent.

**Decisions (user, 2026-10-05; epic Notes):** the manager is tool-free and its output is schema checked, roster checked and, in the default mode, approved by the user; the first error or Deny stops the run; an unanswered card pauses the run and the user answers on the worker's own card; workers keep their own modes and the manager never changes them; limits 20 instructions, depth 3, 30 minutes; events are the log.

## Boundaries & Constraints

**Always:** the rules live in core, not the page or the prompt; every manager string is masked and capped before it is stored or shown; a decision names only a step of the plan; plain copy with no em or en dash; tests run no real agent, model, network or keychain and use a fake clock for time.

**Never:** answering a permission card or changing a worker's mode, model, driver or agent from the loop or the manager; the manager approving, editing, skipping, reordering or stopping; a step or worker the plan does not hold (the decision schema has no field to propose one, so the manager keeps to the existing plan: it can choose among the steps, ask the user, finish or stop); re-sending an instruction already sent; a build; money or budget; a hand edit of the spec or architecture.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Step finished, steps remain | result read back | manager asked; run shows the manager's next suggestion | n/a |
| Decision `dispatch` in the default mode | names a waiting step with its needs done | that step is marked as suggested; it still waits for the user's approval | a step not waiting or with needs not done: refused as malformed, one repair |
| Decision `dispatch` in automatic mode | same | the engine approves by mode and sends that step within the limits | limits and refusals as 15.8 |
| Decision `ask_user` | a question | run waits (`awaiting_user`), the page shows the question and an answer box | n/a |
| User answers the question | text | stored masked as `orchestration.question_answered`; the manager is asked again with the answer as data | a secret in it is refused |
| Decision `done` | a reason | run `finished`, `orchestration.run_finished` carries the reason; steps never sent stay unsent | n/a |
| Decision `stop` | a reason | run `stopped`, reason `manager_stopped` | n/a |
| Manager gives no usable decision, default mode | refused or unavailable | recorded; run waits for the user, who picks the next step | plain words |
| Manager gives no usable decision, automatic mode | refused or unavailable | run `stopped`, reason `manager_refused` | plain words |
| Worker's permission card unanswered | the worker chat is `waiting` | run `paused` (`run_paused permission_card`), the page links to the chat; the run goes on once the card is answered (`run_resumed`) | n/a |
| User Denies a card | `permission.resolved` deny | the step ends failed, the worker's turn is asked to stop, run `stopped` `permission_denied`, the manager is told "denied" and its reply is logged | n/a |
| Refused dispatch in an automatic run | any 15.7 refusal | run `stopped` `dispatch_refused`, the manager is told the refusal's words as a result and its reply is logged | n/a |
| Worker error | step failed | run `failed` `worker_error` as before | n/a |
| Restart, run between steps | open run, finished steps | resumed: the owed decision is asked or the next step is sent exactly once | n/a |
| Restart, worker mid turn | dispatched step, chat now idle by the restart | not settled as finished; the run waits for the user (`interrupted`): continue in the worker's chat or Stop; never re-sent | n/a |
| Restart while the manager was planning | no plan stored | run `failed`, reason `restarted`, plain words | n/a |
| Time limit after a restart | fake clock past 30 minutes since the run's start | next dispatch not made, `time_limit` | plain words |
| The loop or the manager answers a card or changes a mode | any code path | none exists (architecture test) | n/a |

</frozen-after-approval>

## Code Map

- `packages/shared/src/orchestration.ts`, `events-orchestration.ts`, `events.ts`, `errors.ts`, `api.ts` -- stop reasons `manager_stopped` and `restarted`, the refusal code `step_not_available`, the decision, answer and resume events, the answer request and route, the run view's `waiting` and `decision`, plain words.
- `packages/core/src/orchestration.ts`, `manager-port.ts`, `manager-input.ts`, `errors.ts` -- the loop, the pause, Deny detection, the answer use-case, `resume`, the decision context and input.
- `packages/adapters/src/manager-memory/index.ts` -- the fake keeps its in order decisions.
- `packages/server/src/orchestration-routes.ts`, `start.ts` -- the answer route and the resume at start.
- `packages/web/src/orchestrate`, `routes/workspace-orchestrate-page.tsx` -- waiting reasons, the question box, the manager's suggestion, stop reasons.
- tests: shared, core, server (restart with a real core on the same data folder), web DOM, architecture, Playwright.

## Tasks & Acceptance

- [ ] shared contracts, events, routes
- [ ] core: decision loop, pause, Deny, told manager, answer, resume
- [ ] server route and resume at start
- [ ] web: waiting reasons, question, suggestion
- [ ] tests (core, server restart, DOM, architecture, e2e)

**Acceptance Criteria:**
- Given a fake manager and fake workers, each finished step is followed by a decision and a `dispatch`, `ask_user`, `done` and `stop` are each honoured; a decision naming a step not in the plan, or not waiting, is refused.
- Given a worker chat waiting on a permission card, the run is paused with a link to that chat, and once the card is answered it goes on; nothing in core or the manager can answer a card.
- Given a Deny, the step ends, the run stops `permission_denied`, and the manager was told.
- Given an automatic run stopped by a refusal, the manager was told the refusal as a result.
- Given a restart mid run (a real core reopened on the same data folder), the run resumes in the state it was in and no instruction is sent twice.

## Implementation Notes

(Written during the build.)

## Spec proposals

(Written to the memlogs when the stack is merged, never to the frozen documents.)

## Plan Change Log

None yet.

## Review Triage Log

(After the reviews.)

## Verification

(After the runs.)
