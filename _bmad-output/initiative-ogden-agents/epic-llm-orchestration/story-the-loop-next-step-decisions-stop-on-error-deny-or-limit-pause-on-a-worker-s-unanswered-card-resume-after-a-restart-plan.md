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

- **The loop state is the events** (`loopOf`, core): the run's `orchestration.result_read` (only a step that finished, state `idle` or `done`, owes a decision), `orchestration.decision_made` and `orchestration.question_answered` events are folded in order. A result owes a decision; a decision made clears it; an answer to the manager's question owes one again, carrying the answer. So the same state is read after a restart, and nothing about the loop lives only in memory (the in memory pieces left are the serialisation chains, the time limit timer and the "thinking" flag). Three events are new (`decision_made`, `question_answered`, `run_resumed`; no migration: the event log stores any `orchestration.*` payload as JSON), and two run stop reasons (`manager_stopped`, `restarted`), one decision refusal code (`step_not_available`), one API code (`no_question`) and one route (`POST .../runs/:runId/answer`).
- **Next-step decision** (`askForDecision`): after a result is read back and steps remain, the manager gets `decideNext` with the plan as stored (masked), each step's state, the worker roster and its own idle chats, the step's capped masked report as a delimited data block and, after a question, the user's answer as a second delimited block (`manager-input.ts`). The check is `validateDecisionFor`: the step id must be a step of the plan (`unknown_step`) and a `dispatch` may name only a step that is `proposed` with every needed step `done` (`step_not_available`, new, so the real manager's one repair names the rule). The decision is checked again after the call (the user may have skipped or edited a step meanwhile): a `dispatch` that is no longer possible is only logged and the manager is asked again. The run is not moved to `planning` during the call (the user can still approve, edit or skip, because the decision is a suggestion); the view carries `thinking` from the in memory call and Stop aborts it. Nothing is asked when no step is left (the run finishes) or when nothing is choosable (every step left is the user's to send or waits on a skipped step): the run waits for the user, as the 15.8 engine already did.
- **What each decision does**: `dispatch` records the suggestion (shown on the page, the step badged); in the default mode the step still waits for the user's approval; in automatic mode the engine takes that step and follows the 15.8 rules (approve by mode, subscription and non Ask chats wait for the user, limits, refusals). `ask_user` appends `run_paused awaiting_user`, the view's `waiting` is `question`, and the engine sends nothing; `POST .../answer` (the user's route; masked; a secret is refused like an edit) appends `question_answered` and the manager is asked again with the answer as data. `done` finishes the run (`run_finished` with its masked reason); steps never sent stay `proposed` and read as not needed. `stop` stops it, reason `manager_stopped`. **Decision, recorded: no follow-up steps.** `decision.v1` has no field for a new step (and `plan.v1` is only asked for at the start), so the manager keeps to the plan it proposed and can only choose among its steps, ask, finish or stop; it can never invent a worker or step outside the roster. A later plan version would add it (deferred, a decision for the user).
- **No usable decision**: the failure is recorded (`decision_made` action `unavailable`, with the port's plain words). In the default mode the run waits for the user, who picks the next step ("the manager could not suggest the next step"); in automatic mode the run stops `manager_refused`, because nothing is sent without a decision there. A project switched to automatic after an `unavailable` decision asks again.
- **Depth** keeps its 15.8 meaning, the longest `depends_on` chain: the manager can only choose steps of the plan, so a decision never nests deeper than the plan does, and counting each decision as one more level would stop a plan of independent steps that 15.8 allowed. (The 15.8 note that the loop would count a decision as a level is withdrawn.)
- **Pause on an unanswered card**: a dispatched step whose chat is `waiting` (core's own state for a pending permission card) moves the run to `paused` with `run_paused permission_card` once; the view's `waiting` is `permission_card` with the chat's id and the page links to that chat. Approve and Send are hidden while paused (the server already refuses them: a paused run is not open). When the chat leaves `waiting` the run goes back to `running` with `run_resumed card_answered`. The loop only reads the worker session's state and events: the architecture test (`E15 ... never answer a permission card`) proves the use-case, the manager code and the orchestration routes name no `decide`, `removeRule`, decision input or session event writer, and that `answerQuestion` is added to the user's own actions the manager code may not name. Stop still cancels a waiting card (the worker's own cancel).
- **Deny**: read in `readBack` from the worker session's own `permission.resolved` events (decision `deny`, by user, rule or caution but never `cancelled`) since the manager's instruction, so it holds after a restart and cannot be missed when the worker ends its turn right after. In one transaction the step becomes `failed`, the denied report (Ogden's words plus the tool's title, masked) is stored as `result_read`, and the run stops `permission_denied`; the worker's turn, if still going, is asked to stop; then the manager is told (`tell`: `decideNext` with that report, its answer stored as `decision_made` with `told: denied` and shown; the run has ended, so it changes nothing). **Decision, recorded:** a Deny stops the run in both modes, like a worker's error (the first error or Deny stops the run, epic Notes); the manager is told and its reply is kept for the user to read rather than acted on.
- **Refusal in an automatic run** stops the run `dispatch_refused` as in 15.8 and now also tells the manager: the refusal's plain words become the result (`told: refused`). A refusal of the user's own Send in the default mode is returned to the user and still not handed to the manager (deferred), and a worker's own error still stops without a call.
- **Resume after a restart** (`Orchestration.resume()`, called once by the server after wiring): runs that are `planning` with no steps end `failed` reason `restarted`; every other open run of a project with the piece on gets `run_resumed restart` and a pass. The pass settles what finished, reads the owed decision from the events, re-arms the time limit timer (the time limit counts from the run's `createdAt`, written in the same transaction as the `run_started` event), asks for the decision or sends the next step. An instruction already sent is never sent again: only a step still `proposed` or `approved` by the mode is dispatched, and a `dispatched` step stays so. **A worker the restart cut off mid turn** (its chat is left idle with the restart reason, `cutOffByRestart`) is not settled as finished: the run waits for the user (`interrupted`, a link to the chat); when the user lets the worker continue and its turn ends, the step settles and the run goes on. Any card pending at the restart was already cancelled by core. A run whose piece is off is not picked up until it is turned on again (the settings listener does the same as before).
- **Told, thinking and waiting in the view**: `OrchestrationRunView` gains optional `waiting` (`permission_card`, `question`, `interrupted`), `decision` (the latest since the latest result, or what the told manager said) and `thinking`. The page shows plain words for each, the suggested step, the denied step, the stop reasons and the unneeded steps of a finished run; the activity log shows a Denied result.
- **The empty chat left by a failed send** (15.7) stays: core has no per chat delete and the loop adds none; re-addressed to the sweep (15.13) in `deferred-work.md`.
- Tests: core `orchestration-loop` (25) plus changes to the 15.7 and 15.8 tests (the stub manager now decides in order, the read back test expects the decision event); server `orchestration-loop` (7, with a real core reopened on the same data folder); web DOM `orchestrate-loop` (13); architecture (+3); Playwright (+4: a shell command waits on its card and the run pauses then goes on, Deny ends the step and the manager is told, the manager's question and the answer, a restart in the middle of an automatic run).

## Spec proposals

To go to the memlogs with `_bmad/scripts/memlog.py` when the stack is merged (never to the frozen documents): the architecture memlog gets the three new `orchestration.*` events (`decision_made`, `question_answered`, `run_resumed`; eighteen in all), the stop reasons `manager_stopped` and `restarted`, the API code `no_question`, the route `POST .../runs/:runId/answer`, an AD-3 note (an open orchestration run is rebuilt from its rows and events at start; a worker cut off mid turn is not re-sent) and an AD-15 note (nothing in the loop answers a permission card). The spec memlog gets a CAP-22 note: the manager keeps to the plan it proposed (no follow-up steps until a plan version has a field for them) and a Deny or a refusal that stops a run is told to the manager as a result. `covers` stays empty.

## Plan Change Log

None yet.

## Review Triage Log

(After the reviews.)

## Verification

(After the runs.)
