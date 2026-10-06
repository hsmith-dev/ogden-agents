---
title: "Reviewer role: a bounded question to the reviewer about a worker's result, linked to the review page (epic 15)"
type: 'feature'
ticket: '15.10'
created: '2026-10-06'
status: 'in-progress'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
baseline_revision: '557ff6e8901d12bd4f2ee8e70ff004eb3bb50679'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-llm-orchestration/epic-llm-orchestration.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The roster has a reviewer role (15.5) but nothing uses it: a plan can only send instructions to workers, the manager has no way to ask the reviewer about what a worker just did, the reviewer would get no summary of that result, and nothing ties such a step to the page where the person looks at a build and decides.

**Approach:** A plan step may carry `review_of`, the id of an earlier step it reviews. `plan.v1` is extended compatibly (an optional field; a plan without it is valid as before). The check in code (`checkManagerPlan`) refuses a review step unless: its worker is the roster's reviewer (an agent that is ready); the reviewed step is one of its prerequisites (`depends_on`), is not itself a review, and is not the step itself; the reviewer is a different agent from the reviewed step's worker whenever another ready agent exists; the chat is `new`; and the question is at most 600 characters. The instruction the reviewer gets is built by core at dispatch, never by the manager: the manager's question, then a short framing that says the summary is data, then a capped (1500 characters), masked summary of the reviewed step's result with fenced code and diff hunks left out, the whole message at most 2500 characters. Nothing else goes: no file contents, no diffs, no attachments (the manager has no field to attach one). The reviewer is an ordinary worker chat: it starts in the project's default mode (Ask by default), keeps its own permission cards and modes, and its answer comes back through the normal read-back as a capped, masked report to the manager and to the page. The step in the UI links to epic 5's review page when the reviewed step's chat is a build run (`/w/:wsId/review/:ref`), otherwise to the worker chat that did the reviewed step. The person still approves and merges there: no orchestration code can approve, reject, merge or mark a ticket done (an architecture test names the use-cases and the code never does).

**Decisions (user, 2026-10-05; epic Notes):** the reviewer is a different agent from the worker where one is ready, a stronger worker, and the local manager only chooses who reviews and what to ask; the manager and reviewer have no route to approve or merge; no ticket reaches done without a person (epic 5); workers keep their own permission cards and modes; subscription agents (Claude Code, Antigravity) are sent only instructions the user approved one by one.

## Boundaries & Constraints

**Always:** the rules live in core and shared code, not the prompt or the page; the question and every summary are masked and capped before they are stored, shown or sent; the reviewer is named only by the roster; plain copy with no em or en dash; tests run no real agent, model, network or keychain.

**Never:** the manager or reviewer approving, rejecting, merging, retrying or marking a ticket done; file contents or diffs in the reviewer's message; a change to any worker's mode, model, driver or agent; a review step that adds a way to start a build (entry 11 owns builds); money or budget; a hand edit of the spec or architecture.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Plan with a review step | `review_of: s1`, worker = rostered reviewer, `s1` in `depends_on`, chat new, question within 600 | accepted, stored with `reviewOf` | n/a |
| Plan without `review_of` | any plan from before | accepted as before | n/a |
| Worker is not the rostered reviewer, or no reviewer is ready | `review_of` set | refused `reviewer_not_rostered` | one repair, then plain words |
| `review_of` names no step, itself, a review step, or the chat is not new | any | refused `bad_review` | same |
| Reviewed step not in `depends_on` | any | refused `review_not_prerequisite` | same |
| Reviewer is the reviewed step's worker while another ready agent exists | any | refused `reviewer_is_worker` | same |
| Question over 600 characters | review step | refused `review_question_too_long` | same |
| Review step sent | reviewed step done | reviewer's chat gets question plus framing plus the capped, masked summary of that result; summary at most 1500, whole message at most 2500; code blocks and diffs left out | refusals as 15.7 |
| Reviewer changed since the plan | roster reviewer is another agent now | `dispatch_refused` `not_the_reviewer`, nothing created | plain words |
| Reviewer's answer | reviewer chat finishes | read-back report, capped to 4000, secrets masked, to the manager and the page | as any step |
| Reviewed step is a build run | the reviewed chat has a run | step view links to `/w/:wsId/review/:ref` | n/a |
| Reviewed step is a plain chat | no run | step view links to that chat | n/a |
| Manager or reviewer tries to approve, merge, mark done | any code path | none exists (architecture test); `run.decided` and `ticket.changed` are never appended | n/a |

</frozen-after-approval>

## Code Map

- `packages/shared/src/orchestration.ts`, `events-orchestration.ts` -- `review_of`, review limits, the refusal codes and words, the review message builder, the step's `reviewOf` and the view's `review` link, the dispatch refusal `not_the_reviewer`.
- `packages/core/src/db/schema.ts`, `drizzle/0028_*` -- one nullable `review_of` column on `orchestration_steps`.
- `packages/core/src/team-roster.ts`, `manager-port.ts`, `manager-input.ts`, `orchestration.ts` -- the roster's reviewer, the context, the plan check input, the manager's wording, the message built at dispatch, the answer matched in read-back, the link.
- `packages/web/src/orchestrate/orchestrate-view.tsx` -- a review step's badge, the sent summary note, the review link.
- tests: shared, core, adapters (fake manager keeps the field), server with fake agents, web DOM, architecture, Playwright.

## Tasks & Acceptance

- [ ] shared contracts, limits, builder, words
- [ ] core: column and migration, roster reviewer, plan check input, dispatch message, read-back match, link
- [ ] web: badge, note, link
- [ ] tests (shared, core, server, DOM, architecture, e2e)

**Acceptance Criteria:**
- Given a fake worker that produced a result and the roster's reviewer, the reviewer is sent a bounded question with a capped, masked summary and never file contents or diffs.
- Given the reviewer's long answer holding a secret, the manager and page get it capped and masked.
- Given a build run as the reviewed step, the step links to the review page; given a plain chat, to the chat.
- Given any orchestration code path, nothing approves, merges or marks a ticket done.

## Implementation Notes

To be filled in as built.

## Spec proposals

To be filled in as built.

## Plan Change Log

None yet.

## Review Triage Log

Not run yet.

## Verification

Not run yet.
