---
title: "Reviewer role: a bounded question to the reviewer about a worker's result, linked to the review page (epic 15)"
type: 'feature'
ticket: '15.10'
created: '2026-10-06'
status: 'in-review'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick-security', 'quick-correctness']
review_loop_iteration: 0
baseline_revision: '557ff6e8901d12bd4f2ee8e70ff004eb3bb50679'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-llm-orchestration/epic-llm-orchestration.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The roster has a reviewer role (15.5) but nothing uses it: a plan can only send instructions to workers, the manager has no way to ask the reviewer about what a worker just did, the reviewer would get no summary of that result, and nothing ties such a step to the page where the person looks at a build and decides.

**Approach:** A plan step may carry `review_of`, the id of an earlier step it reviews. `plan.v1` is extended compatibly (an optional field; a plan without it is valid as before). The check in code (`checkManagerPlan`) refuses a review step unless: its worker is the roster's reviewer (an agent that is ready); the reviewed step is one of its prerequisites (`depends_on`), is not itself a review, and is not the step itself; the reviewer is a different agent from the reviewed step's worker whenever another ready agent exists; the chat is `new`; and the question is at most 600 characters. The instruction the reviewer gets is built by core at dispatch, never by the manager: the manager's question, then a short framing that says the summary is data, then a capped (1500 characters), masked summary of the reviewed step's result with fenced code and diff hunks left out, the whole message at most 3000 characters. Nothing else goes: no file contents, no diffs, no attachments (the manager has no field to attach one). The reviewer is an ordinary worker chat: it starts in the project's default mode (Ask by default), keeps its own permission cards and modes, and its answer comes back through the normal read-back as a capped, masked report to the manager and to the page. The step in the UI links to epic 5's review page when the reviewed step's chat is a build run (`/w/:wsId/review/:ref`), otherwise to the worker chat that did the reviewed step. The person still approves and merges there: no orchestration code can approve, reject, merge or mark a ticket done (an architecture test names the use-cases and the code never does).

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
| Review step sent | reviewed step done | reviewer's chat gets question plus framing plus the capped, masked summary of that result; summary at most 1500, whole message at most 3000; code blocks and diffs left out | refusals as 15.7 |
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

- [x] shared contracts, limits, builder, words
- [x] core: column and migration, roster reviewer, plan check input, dispatch message, read-back match, link
- [x] web: badge, note, link
- [x] tests (shared, core, server, DOM, architecture, e2e)

**Acceptance Criteria:**
- Given a fake worker that produced a result and the roster's reviewer, the reviewer is sent a bounded question with a capped, masked summary and never file contents or diffs.
- Given the reviewer's long answer holding a secret, the manager and page get it capped and masked.
- Given a build run as the reviewed step, the step links to the review page; given a plain chat, to the chat.
- Given any orchestration code path, nothing approves, merges or marks a ticket done.

## Implementation Notes

- **The field** (`review_of`, `ManagerPlanStep`): optional and strict, so `plan.v1` stays compatible both ways (a plan without it is valid and every stored plan reads as before). It is in the JSON schema the server is asked with (not required). The rules are in `checkManagerPlan` (`reviewLinkProblem`), new refusal codes `bad_review`, `reviewer_not_rostered`, `review_not_prerequisite`, `reviewer_is_worker`, `review_question_too_long`, each with plain words. The check input gained `reviewer` (the agent id of the roster's reviewer when it is an agent that is ready now). A plain cap of 600 characters applies to the question of a review step only; ordinary steps keep 4000. A review step goes to a `new` chat only: an existing chat of the reviewer would carry older history into the question.
- **Who the reviewer is**: `Team.reviewer(workspaceId)` (new, `team-roster.ts`) reads the effective roster's reviewer when it is an agent (a model is never a worker, so a model reviewer gives no review step), with its readiness. `workerContext` sets `ManagerContext.reviewer` only when that agent is ready and addressable, so a reviewer that is not ready means no review step is valid. "A different agent from the reviewed step's worker where one exists" is read as: refused when the reviewer is the reviewed step's worker and some other agent is ready; allowed when the reviewer is the only agent. The manager input says who the reviewer is and how to ask (`manager-input.ts`), and lists a review step as "a review of s1".
- **Stored**: one nullable column `orchestration_steps.review_of` (migration `0028_orchestration_review`, numbered after `0027` on origin/main by drizzle-kit). `plan_proposed` already carries the plan, so the field is in the log.
- **The message** (`buildReviewMessage`, shared, pure): the manager's question (stored masked), a blank line, a framing that starts `Ogden review request.`, says which step and which worker it is about and that the summary is data, then `<<<RESULT` and the summary and `>>>`. The summary is the reviewed step's own read-back text (the same `lastReply` that feeds the manager's report: the tool call titles and the last reply, secret masked, capped to 4000), passed through `cleanForManager` (paths become `[path]`, secrets masked, the data delimiters neutralised), then `omitCodeAndDiffs` (fenced code blocks, an unclosed fence to the end, and diff headers and hunks are replaced by `[code left out]` and `[changes left out]`), hidden characters removed, cut to 1500 characters and masked again. The whole message is at most 3000 (tested with the widest question and result). Nothing from the manager is added after the question, and the manager has no field to attach anything.
- **At dispatch** (`reviewMessageFor`, before anything is created): the worker must still be the roster's reviewer, and still a different agent from the reviewed step's worker when another is ready (`not_the_reviewer`, a new dispatch refusal with plain words, recorded as `dispatch_refused` like the others); the reviewed step must be done and sent. Everything else is the ordinary dispatch: vendor terms, approve each only for subscription agents, the project's default mode for the new chat (Ask by default), the worker's own permission cards. In the default mode the user approves the question as for any step; in automatic mode the engine sends it by the same rules (a subscription reviewer or a chat that runs without asking still waits for the user). What the user approves and edits is the question; the page says the reviewer also gets the summary.
- **Read-back**: the reviewer's turn is found by its message, which is no longer the stored instruction: `sentAs` matches the text itself or, for a review step, the built message's start (`isReviewMessageFor`). The reply comes back as any step's: `makeStatusReport` (masked, 4000), `result_read`, the manager asked what comes next with it as delimited data (the input says it is a review of s1), and the page shows it. A Deny on the reviewer's card is read the same way (`deniedSince`).
- **The link**: `OrchestrationStepView.review` (`reviewTargetOf`, read only): `build_review` with the ticket ref when the reviewed step's chat has a run (epic 5's review page, `/w/:wsId/review/:ref`), else `worker_chat` with the reviewed step's chat; `null` until the reviewed step was sent. The page shows a plain link; it has no approve or merge control.
- **No path to done**: an architecture test (`E15 ... no path to approve, merge or mark done`) proves that the use-case, the manager code, the orchestration routes and the Orchestrate page name none of the deciding use-cases (`approve`, `reject`, `merge`, `mark`, `markDone`, `commitPlanFiles`, `isMerged`), their request types, the ticket store, or the build approve, reject, commit and ticket status routes; core and server tests check that a whole review flow appends no `run.decided`, `ticket.changed` or `run.outcome_changed` event and leaves a build run's decision empty.
- Tests: shared `orchestration-reviewer-contracts` (17), core `orchestration-reviewer` (15, with a stub team roster), server `orchestration-reviewer` (4, real chat with the fake Codex and Grok agents; two new fake agent modes `reply-with` and `review-echo`), web DOM `orchestrate-reviewer` (7), architecture (+3), Playwright (+1).

## Spec proposals

To go to the memlogs with `_bmad/scripts/memlog.py` when the stack is merged (never to the frozen documents): the spec memlog gets a CAP-22 note that a review step is a plan step with `review_of`, built and bounded by Ogden (question 600, summary 1500, message 3000, no code or diffs), sent only to the roster's reviewer, and linked to epic 5's review page where only a person approves or merges; the architecture memlog gets the `plan.v1` extension (optional `review_of`), the dispatch refusal `not_the_reviewer`, the new refusal codes, and migration 0028 (`orchestration_steps.review_of`). `covers` stays empty.

## Plan Change Log

None yet.

## Review Triage Log

2026-10-06, security and correctness reviewers, no critical or high findings. Patched: the fence tracking was a bare toggle, so a longer fence holding an inner fence, or a tilde line inside a backtick block, let code through (medium, both), now the opening character and length are tracked and only a matching close ends the block; a real patch with a blank context line let the rest of the hunk and the next hunks through (medium), now a hunk goes on through empty, space, plus and minus lines until prose; a patch with no header passed (medium), now a run of three or more plus or minus lines is left out as best effort; code and diffs were stripped after the result was already cut to 4000, so a long code block could fill the room (low), now the reviewed step's whole reply is stripped first; the agent's name was not cleaned or capped and the post-masking cut could grow the text (low), now the name is cleaned and cut to 60 and a last guard keeps the message within 3000; the dispatch re-check did not repeat the chat, review-of-review and prerequisite rules (low), now it does; an over-long stored question would not match in the read-back (low), now the match uses the question cut to its cap. Not changed: the question is sent as the manager wrote it, so it may hold `<<<RESULT` or the framing words (low, the framing is guidance only and the user approves the question; neutralising it would break the read-back match); the edit cap error is raised before the not changeable error (low, an ordering nit); a link to a deleted chat is still offered (low, the page shows the chat's own not found); the stripping is best effort for text that is not fenced and has no patch header, such as pasted file contents, which is why the page says the reviewer gets a short summary and the worker's own words are all it reads.

## Verification

**Results:** `pnpm typecheck` clean; `pnpm test` 342 files, 4283 passed, 8 skipped; Playwright `orchestrate` 14 passed; `PROVENANCE_BASE=origin/main pnpm provenance` passes.

**Commands:** `pnpm typecheck`, `pnpm test`, `npx playwright test tests/e2e/orchestrate.spec.ts` (after `pnpm run build`), `PROVENANCE_BASE=origin/main pnpm provenance`.
