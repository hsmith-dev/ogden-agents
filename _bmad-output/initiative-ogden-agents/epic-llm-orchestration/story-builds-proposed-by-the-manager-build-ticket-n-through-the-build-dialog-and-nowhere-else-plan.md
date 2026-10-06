---
title: "Builds proposed by the manager: Build ticket N through the Build dialog and nowhere else (epic 15)"
type: 'feature'
ticket: '15.11'
created: '2026-10-06'
status: 'in-progress'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
baseline_revision: '993fe33751318d405ec0b44a1565145f42d3fbdd'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-llm-orchestration/epic-llm-orchestration.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A plan can only send instructions to worker chats. The manager has no way to say "this ticket should be built", and the only safe way to say it is as a proposal the person confirms in epic 5's Build dialog, where the sandbox, limits and permission choices are theirs.

**Approach:** `plan.v1` is extended compatibly with an optional `build` step kind. A build step carries only an id, `depends_on`, a short `reason` (at most 200 characters) and `build: { ticket }`, a reference to a ticket on the board. It has no worker, no chat, no instruction and no mode. The schema is strict: any field that names a build driver, agent, mode, sandbox or flag (at the step or inside `build`) is refused (`build_field_forbidden`). The ticket must be one of the board's tickets that are eligible for a build now (ready, prerequisites met, no active build, Builds on), given to the check by core (`build_ticket_unavailable`), and only once in a plan (`duplicate_build_ticket`). A build step appears in the plan as a proposal only. It is never approved or dispatched by the orchestration code: the Orchestrate page opens the existing Build dialog for the ticket, and only the dialog's own start path (`POST /builds`, the same as the board's) starts a build, in both modes. Orchestration code never calls the builds start use-case (architecture test). The page then tells Ogden which run the dialog started, through a user action route that checks the run is a build of that ticket in this project, started after this orchestration run began and not already linked. From then on the step follows that run (running, then built or failed), read from the run. An automatic run treats a build step as needing the user and pauses with the plain reason "Waiting for you to start the build". The manager gets the read-back: a capped, masked build summary (outcome and verification check counts, never a diff or file). The person still reviews and approves on epic 5's review page, which the review step of 15.10 links to for a build.

**Decisions (user, 2026-10-05 and 2026-10-06):** the manager never starts a build without the Build dialog, in either mode; builds stay Claude Code only; nothing ends a ticket as done without a person.

## Boundaries & Constraints

**Always:** the rules live in shared and core code, not the prompt or the page; every manager string is masked and capped; a build run keeps epic 5's sandbox, limits, permission policy, review and approval untouched; plain copy with no em or en dash; tests run no real agent, model, network or keychain.

**Never:** an orchestration code path that starts a build, approves, rejects, merges or marks a ticket done; a field that names a build driver, agent, mode, sandbox or flag; a diff or file content in what the manager reads; a change to the Build dialog's own choices; a change to how builds run; a hand edit of the spec or architecture.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Plan with a build step | `{id, build:{ticket:'1.1'}, reason, depends_on}`, ticket eligible | accepted, stored as a proposed build step | n/a |
| Plan without a build step | any plan from before | accepted as before | n/a |
| A field naming a driver, agent, mode, sandbox or flag | at the step or in `build` | refused `build_field_forbidden` | one repair, then plain words |
| Ticket not on the board or not eligible | any | refused `build_ticket_unavailable` | same |
| The same ticket twice | any | refused `duplicate_build_ticket` | same |
| Approve or send a build step | any route or use-case | refused (`step_not_proposed`, `step_not_approved`); nothing starts | plain words |
| Edit a build step | any | refused `step_not_changeable` | plain words |
| Automatic run reaches a build step | automatic mode | run waits: "Waiting for you to start the build"; no build starts | n/a |
| User starts the build in the dialog, the page links the run | run is a build of that ticket in this project, newer than the orchestration run, unlinked | step is dispatched with the run id; follows the run | n/a |
| Link a run of another ticket, another project, an older run, or one linked already | any | refused, nothing changes | plain words |
| Build ends | outcome verified | step done, manager read-back with outcome and check counts | n/a |
| Build fails, blocked (not a checkpoint) or stopped | outcome failed, blocked or stopped | step failed, run stops as a worker error does | n/a |
| Review step about a build step | review_of names a build step | link to `/w/:wsId/review/:ref`; the reviewer gets the capped masked build summary | as 15.10 |
| A direct API call from a run to start a build | any | no such route exists; the only start is `POST /builds` from the user | n/a |

</frozen-after-approval>

## Code Map

- `packages/shared/src/orchestration.ts`, `events-orchestration.ts`, `events.ts`, `api.ts`, `errors.ts` -- the build step schema, refusal codes and words, the step's `build`, the view's `buildRun`, the waiting kind, `orchestration.build_linked`, the link route and request.
- `packages/core/src/db/schema.ts`, `drizzle/0029_*` -- `build_ticket` and `build_run_id` on `orchestration_steps`.
- `packages/core/src/orchestration-builds.ts` -- the read of tickets eligible for a build (read only).
- `packages/core/src/orchestration.ts`, `manager-port.ts`, `manager-input.ts` -- the stored build step, no approve or send, the pause, the link, following the run, the build summary, the reviewer link, what the manager is told.
- `packages/server/src/orchestration-routes.ts`, `start.ts` -- the link route and the eligible tickets read.
- `packages/web/src/planning/build-dialog.tsx`, `packages/web/src/orchestrate/*` -- the dialog starts a build when the sandbox is ready and reports the run; the plan shows a build step and opens the dialog.
- tests: shared, core, server, web DOM, architecture, Playwright.

## Tasks & Acceptance

- [x] shared contracts, refusal words, event, route
- [x] core: columns and migration, eligible tickets, stored step, no approve or send, pause, link, follow the run, summary, review link
- [x] server and web: link route, dialog, plan page
- [x] tests (shared, core, server, DOM, architecture, e2e)

**Acceptance Criteria:**
- Given the fake manager proposing a build, nothing starts until the Build dialog is confirmed by a user action, in both modes.
- Given any orchestration route or use-case, no build is started and no ticket is approved or marked done.
- Given a schema field that names a build driver, agent, mode, sandbox or flag, the plan is refused.
- Given a confirmed build, the Runs tab lists it and the step follows it, and the manager reads a capped, masked summary.
- Given a review step about a build, the link goes to the review page.

## Implementation Notes

- **The step kind** (`ManagerBuildStep`, shared): `{ id, build: { ticket }, reason, depends_on }`, strict at both levels, so any other field (a driver, agent, mode, sandbox, flag, worker, chat or instruction) is refused as `build_field_forbidden` (a secret looking key is still `forbidden_field`). `plan.v1` is compatible both ways: a plan without a build step is exactly as valid as before, and `ManagerPlanStep` (the worker step) is unchanged. The plan's `steps` is a union of the two kinds; Zod 4 reports a lone failing branch's issues as they are, so `codeFor` decides from the step's shape (a `build` object) which kind the manager meant, and a bare `build: "x"` on a worker step stays a `forbidden_action`. Ogden's rules: the ticket must be one of the board's tickets ready to build now (`context.buildable`, `build_ticket_unavailable`) and named once (`duplicate_build_ticket`); a reason is a clean single line of at most 200 characters (`bad_text`).
- **The server's schema**: `MANAGER_PLAN_JSON_SCHEMA` is the worker step alone, as before. `MANAGER_PLAN_WITH_BUILDS_JSON_SCHEMA` holds the fields of both kinds with only `id` and `depends_on` required (the subset has no `anyOf`) and is asked with only when a ticket is ready to build, so a manager is never even offered the kind when nothing could be built. Ogden's own check is the guard either way.
- **What is ready** (`createBuildableTickets`, core, read only): the board's `ready-for-dev` tickets with their prerequisites met (the builds' own `prerequisitesMet`) and no build going, Board and Unattended builds on, at most 30. Any failure of the board's read gives none. It takes the board's read and the runs' read and no builds use-case (architecture test). The server wires it in `start.ts`; core names no agent, so the server also passes the build runner's agent id (`builder`).
- **Stored**: two nullable columns on `orchestration_steps`, `build_ref` (the ticket ref; named so no column names a ticket, AD-10's test) and `build_run_id`; migration `0029_orchestration_builds`, numbered by drizzle-kit after `0028` on the stacked base (origin/main has `0027`). A build step is a row with `worker` = the builder's agent id (or `build` when none is given), `chat` `new`, `instruction` = the manager's reason (masked), `session_id` empty. The entity has `build: { ticketRef, runId } | null`; the view adds `buildRun` (outcome, the person's decision, the end checks' counts), read from the run.
- **Never started by orchestration**: `approveStep` (`step_not_proposed`), `editStep` (`step_not_changeable`), `dispatchStep` (`step_not_approved`) and the mode's own approval all refuse a build step first, in both modes. The automatic engine, at a build step, waits for the person (`waitForUser`, one `run_paused` event) and the view says `waiting: { kind: 'build' }` with "Waiting for you to start the build". No orchestration file names a builds start (an architecture test over the use-case, the manager code, the ready tickets read, the routes and the page). There is no route to start a build under `/orchestration`.
- **The link** (`linkBuild`, `POST …/steps/:stepId/link`, the person's own call): the body is the build run's id only. Core checks, in one transaction, an open run, a waiting build step whose prerequisites are done, and that the build run is in this project, is a build of the step's ticket, began after this orchestration run began, and is the run of no other step; it then moves the step to `dispatched` (approved by the user) with the run id and appends `orchestration.build_linked`. Nothing is created: no chat, message or run.
- **Following the run** (`readBack`, `settleStep`, `buildRunOf`, `buildEndOf`): a dispatched build step reads its run: running or paused at the ticket's own checkpoint stays dispatched; `verified` settles as done (built, nothing merged); failed, stopped or blocked for any other reason settles as failed and the run stops as a worker's error does. The settle transaction that was inline in the read-back is now `settleStep`, used for both kinds. The run's own outcome change (`run.outcome_changed`) lets the plan look again, and a restart picks a linked step up from its row. The report the manager reads is `buildSummaryText`: the outcome in plain words, the end checks' counts and the person's decision once made, masked and capped (1200); never a diff, a file or the agent's output.
- **A review of a build** (15.10 with a build step): `review_of` may name a build step (its builder is the agent builds run on, so the reviewer is another agent where one is ready); the link is `build_review` for the ticket once the build was started, and the reviewer's message holds the build summary in place of a worker's words.
- **The page**: `OrchestrateView` shows a build step as "Build ticket N" with the manager's reason, the one note that only the person starts it, no worker, chat or mode, no Approve, Send or Edit, and an "Open the Build dialog" button; the page (`workspace-orchestrate-page.tsx`) holds the dialog. `BuildDialog` gained `confirm`: the same dialog and choices, a plain line that nothing starts until a button in it is pressed, and, with a sandbox ready, a **Build** button (the board's own `POST /builds`) beside Build with me watching; `onStarted` now also gives the run, which the page sends to the link route. The Orchestrate page and its API file name no start of a build.
- Tests: shared `orchestration-build-contracts` (37), core `orchestration-builds` (36), `orchestration-buildable` (5), `model-manager` (+2), server `orchestration-builds` (6, a real board, real git and the fake agent in build mode), web DOM `orchestrate-builds` (12), architecture (+5), Playwright (+3).

## Spec proposals

To go to the memlogs with `_bmad/scripts/memlog.py` when the stack is merged (never to the frozen documents): the spec memlog gets a CAP-22 note that a plan may hold a build step (a ticket and a short reason, no field naming how to build), a proposal only, started only by the person in epic 5's Build dialog in both modes, followed by the plan through the run and read back as a capped masked summary; the architecture memlog gets the `plan.v1` extension (optional build step kind), the refusal codes `build_field_forbidden`, `build_ticket_unavailable` and `duplicate_build_ticket`, the event `orchestration.build_linked`, the route `POST …/orchestration/runs/:runId/steps/:stepId/link`, the waiting kind `build`, migration 0029 (`orchestration_steps.build_ref` and `build_run_id`), and that the orchestration code reads the board's ready tickets through a read only port. `covers` stays empty.

## Plan Change Log

None yet.

## Review Triage Log

Not run yet.

## Verification

Not run yet.
