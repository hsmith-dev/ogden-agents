---
title: 'Plan review UI: see every step, edit, approve, skip, reorder within prerequisites, stop (epic 15)'
type: 'feature'
ticket: '15.6'
created: '2026-10-05'
status: 'in-review'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick-security', 'quick-correctness']
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

- [x] shared contracts, event and routes
- [x] core use-cases and dispatch re-checks
- [x] server routes
- [x] web review UI
- [x] tests (core, server, DOM, architecture, e2e)

**Acceptance Criteria:**
- Given a three step plan, editing an approved step makes it need a fresh approval and a direct send is refused until then.
- Given a skipped step, it never dispatches, and a step that needs it waits.
- Given a reorder that puts a step before its prerequisite, it is refused and the order is unchanged.
- Given Stop, the run is stopped and nothing more can be approved or sent.
- Given a call to approve without the tab's token, the gate refuses it, and the manager and dispatch code never name the user actions.

## Implementation Notes

- Core (`orchestration.ts`): `editStep` (text through `EditOrchestrationStepRequest`, which is the manager's `ManagerInstruction` rules after folding line breaks and trimming; a secret is refused with plain words, not masked; an edit of a waiting or approved step sets it to `proposed` with no approver, the same text is no change), `skipStep` (waiting or approved to `skipped`; the run finishes when every step is done or skipped and the run can move there), `reorderSteps` (the whole order; permutation, sent steps keep their index, every step after its prerequisites; `BadOrderError` with the step names), `stopRun` (run `stopped` with reason `user`, in the same transaction a step whose worker turn was in flight becomes `failed`; then the manager call in flight is aborted and `chat.cancel` is asked for each worker turn, best effort). Stop therefore does cancel worker turns here, not only in 15.8, because a dispatch can be in flight. `startRun` passes an abort signal and, if the run was stopped meanwhile, keeps the manager's reply in the log only and makes no step. `readBack` still settles steps of an ended run but never moves it again.
- Dispatch in the default mode also refuses a step whose approver is not the user, whose prerequisites are not done, or whose text changed since the approval, and sends the stored text. `approveStep` takes an optional text the page read and refuses a step edited since.
- Step transitions gain `approved` to `proposed`. New event `orchestration.steps_reordered`; error codes `step_not_changeable`, `bad_order`, `run_not_open`.
- Routes (all through `orchestrationRoutes`, behind the tab token): `POST .../steps/:stepId/edit`, `.../skip`, `.../runs/:runId/reorder`, `.../stop`. No body names an approver.
- Web: each step shows worker, chat, instruction, mode (Ask), prerequisites; Edit (inline editor), Skip, Move up and Move down, Approve and send, Send; Stop while the run is live; plain "The manager is thinking" status (with Stop) that holds nothing; a line saying where the manager runs (this computer or another computer, with the server's name).
- Architecture test E15 (15.6): the manager files and the `startRun`, `readBack` and `dispatchStep` code never name approve, edit, skip, reorder or stop; only `orchestration-routes.ts` calls them in the server.
- Tests: shared (4), core (+19), server `orchestration-review` (9), web DOM (+8), architecture (2), Playwright (1: three step review).

## Spec proposals

Written to the memlogs with `_bmad/scripts/memlog.py`: the architecture memlog gets the `orchestration.steps_reordered` event, the step transition, the new error codes and an AD-15 note (approval only from a user action); the spec memlog gets a CAP-22 plan review note. `covers` stays empty.

(Filled in when built.)

## Plan Change Log

None yet.

## Review Triage Log

2026-10-05, security and correctness reviewers, no critical or high findings. Patched: skipping the last open step of a paused run logged `run_finished` while the run could not move (medium), now only when it can; the edit form stayed open after the step stopped being changeable (medium), now closes; Approve bound to the step id, not the text read, so a step edited from another tab could be approved unseen (medium), now the page sends the text it showed and a mismatch is refused; a start could briefly show and Stop the previous run (low), now the newer run wins; a step failed by its own worker error read "Stopped before it finished" in a stopped run (low), now keeps its own words; edit and reorder checked the request before the run (low), now the run first; approve re-reads the run inside the transaction (low). Tests added for each, including an edit during a send. Not changed: Stop is refused when the piece is switched off (low, the guard is uniform; a decision for the user); an orphan empty worker chat remains when a dispatch is refused after the chat was made (low, as in 15.3); a cancel that fails (other than not busy) is swallowed and the page does not warn that a worker may still be finishing (low); an oversized chunked body with no length answers 400 instead of 413 (low, memory is bounded); skipping a step leaves its dependents waiting and only Stop ends the run, by design (info); a move button next to a sent step looks enabled and the server refuses with plain words (low).

## Verification

**Commands:** `pnpm typecheck`, `pnpm test`, `npx playwright test tests/e2e/orchestrate.spec.ts` (after `pnpm run build`), `PROVENANCE_BASE=origin/main pnpm provenance`.
