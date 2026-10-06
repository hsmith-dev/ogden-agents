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

- [ ] shared contracts, refusal words, event, route
- [ ] core: columns and migration, eligible tickets, stored step, no approve or send, pause, link, follow the run, summary, review link
- [ ] server and web: link route, dialog, plan page
- [ ] tests (shared, core, server, DOM, architecture, e2e)

**Acceptance Criteria:**
- Given the fake manager proposing a build, nothing starts until the Build dialog is confirmed by a user action, in both modes.
- Given any orchestration route or use-case, no build is started and no ticket is approved or marked done.
- Given a schema field that names a build driver, agent, mode, sandbox or flag, the plan is refused.
- Given a confirmed build, the Runs tab lists it and the step follows it, and the manager reads a capped, masked summary.
- Given a review step about a build, the link goes to the review page.

## Implementation Notes

(Filled in as built.)

## Spec proposals

(To go to the memlogs when the stack is merged, never to the frozen documents.)

## Plan Change Log

None yet.

## Review Triage Log

Not run yet.

## Verification

Not run yet.
