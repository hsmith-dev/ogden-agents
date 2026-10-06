---
title: 'Tracer bullet: a goal reaches a stubbed manager, a plan shows, one approved instruction reaches one worker chat, the status reads back (epic 15)'
type: 'feature'
ticket: '15.3'
created: '2026-10-05'
status: 'in-review'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick-security', 'quick-correctness']
review_loop_iteration: 0
baseline_revision: 'a6e585f3d00fd1659b0ad02dbe379997ff0b53ca'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-llm-orchestration/epic-llm-orchestration.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 15 has contracts (15.2) but nothing runs. The riskiest joints, a goal reaching a manager, a plan the user can read, one instruction going through the existing chat into a worker chat only after approval, and the status coming back, are unproven.

**Approach:** The thinnest end-to-end path. `SHIPPED_ORCHESTRATION` becomes true, so a project can turn the piece on (still off by default; with it off nothing is served and no tab shows). A minimal core `Orchestration` use-case starts a run from a goal through `ManagerPort.proposePlan`, stores the plan steps, approves a step, dispatches an approved step through the existing chat `sendMessage` into a new worker chat (the chat is created with the worker's own default mode and the manager never changes it), reads back the worker's normalized state and a `makeStatusReport` summary, and emits the `orchestration.*` events. Server routes behind the piece guard, and a bare Orchestrate page reachable only with the piece on. The manager here is the manager-memory fake under test hooks; a real install with no configured manager answers a plain "no manager yet" (the real adapter is 15.4). Roster, mode and limits are fixed in code.

**Decisions (user, 2026-10-05; epic Notes):** dispatch is refused in code for a step the user has not approved; the instruction is visible in the worker chat as sent by the manager at the user's approval; Orchestration stays opt-in and off by default; a Simple project is unchanged.

## Boundaries & Constraints

**Always:** the rules live in core, not in the page or the prompt; every manager string is masked before it is stored, evented or sent; the worker chat keeps its own permission cards and mode; plain copy, no em or en dash; tests run no real model, agent, network or keychain.

**Never:** a real manager call, the roster UI, automatic mode, Stop, limits enforcement, the loop (entries 4 to 9); a build started from here; a change to a worker's mode; a hand edit of the spec or architecture.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Start a run | piece on, manager present, goal | run `awaiting_user`, plan steps `proposed`, events appended | n/a |
| No manager configured | piece on, no manager | 409 `manager_unavailable` with plain words, nothing stored | page shows "no manager yet" |
| Manager fails or refuses | failure value | 409 `manager_failed` with its plain reason, run `failed` (`manager_refused`) | no step exists |
| Approve a step | proposed step whose dependencies are done | `approved`, `approvedBy: user`, event | refused when not proposed or a dependency is not done |
| Dispatch unapproved | step `proposed` or `skipped` | refused (409 `step_not_approved`), no chat created, nothing sent | n/a |
| Dispatch approved | step `approved` | new worker chat, instruction sent marked as from the manager, step `dispatched`, event | a chat failure leaves the step `approved` |
| Read back | dispatched step | normalized state and a capped, masked report; when the chat is idle the step is `done` and `result_read` is appended once | an errored chat is `failed` |
| Piece off | any orchestration route | 409 `feature_off` | n/a |

</frozen-after-approval>

## Code Map

- `packages/shared/src/orchestration.ts`, `api.ts`, `events-session.ts` -- run and step views, request and response shapes, route paths, plain sentences; the `manager` origin of a message.
- `packages/core/src/orchestration.ts` (new), `core.ts`, `chat/types.ts`, `chat/turns.ts`, `session-events.ts` -- the use-case, its factory on core, the one chat seam (`sendMessage` option `origin`).
- `packages/server/src/orchestration-routes.ts`, `start.ts`, `start-types.ts`, `test-hooks.ts`, `app.ts` -- the routes, the manager wiring, the test hook, `SHIPPED_ORCHESTRATION = true`.
- `packages/web/src` -- Orchestrate page and tab, the settings switch, the transcript caption.
- `tests/e2e/orchestrate.spec.ts` (new), core, server and web tests, architecture test.

## Tasks & Acceptance

- [x] shared shapes and the `manager` message origin
- [x] core use-case and the chat seam
- [x] server routes and wiring
- [x] web page, tab and settings switch
- [x] tests (core, server, web DOM, e2e, architecture)

**Acceptance Criteria:**
- Given the piece on and the fake manager, a goal becomes a listed plan.
- Given an unapproved step, a direct dispatch call is refused and nothing is created.
- Given an approved first step, a worker chat exists whose transcript shows the instruction as sent by the manager at the user's approval, and the status reads back masked and capped.
- Given the piece off, the page and routes answer `feature_off` and no tab shows.

## Implementation Notes

- `SHIPPED_ORCHESTRATION = true`: a project can turn the piece on (settings section "Orchestration", a switch; default off). With it off every orchestration route answers 409 `feature_off`, the Orchestrate tab does not show and the page shows the off notice.
- Core `createOrchestration` (`core.createOrchestration({ chat, manager })`, like notifications): `startRun`, `listRuns`, `getRun`, `approveStep`, `dispatchStep`. Roster = the agents the install reports ready, mode fixed to approve each, limits `RUN_LIMITS` (not enforced; entries 5 to 9). Only `new` chats are planned (the manager is given no existing chats). Approval is the user's only (`approvedBy: user`). `dispatchStep` refuses in code (`StepNotApprovedError`, 409 `step_not_approved`) for any step not approved or a run not open, before a chat is created, and a second send of one step is refused. Read back is by `getRun` and `listRuns`: the chat's state and a `makeStatusReport` of its last agent reply; the first read that finds the chat idle or done settles the step (`done`), one `orchestration.result_read` once; an errored chat fails the step and the run (`worker_error`); all steps done finishes the run (the manager's own `done` decision is 15.8).
- Chat seam (the smallest one): `Chat.sendMessage` takes `options.origin: 'manager'`, stored as the `origin` of the user `session.message_completed` (the enum gains `manager`; additive). The HTTP chat route never passes it, so a user cannot forge it (tested). Only the immediately stored message is marked; the orchestration sends only into a new, idle chat. The transcript shows the caption "Sent by the manager, approved by you". The agent itself receives the plain instruction.
- Server: five routes under `/workspaces/:wsId/orchestration/runs` through `orchestrationRoutes`; `GET …/orchestration` gains `managerReady`; new codes `manager_unavailable`, `manager_failed`, `step_not_approved`, `step_not_proposed`. `StartOptions.manager` and the test hook `OGDEN_AGENTS_TEST_MANAGER=memory` give the fake; without them a real install answers "no manager yet" (409 `manager_unavailable`, page notice). `createMemoryManager` is exported from the server bundle for e2e.
- Web: Orchestrate tab (key `o`) only with the project's switch on, page `/w/:wsId/orchestrate`, settings switch. `deleteWorkspaceHistory` also removes the project's orchestration rows.
- Tests: core use-case (14), server REST (6) and hook, web DOM (10), tab tests, Playwright `tests/e2e/orchestrate.spec.ts` (2).

## Spec proposals

None.

## Plan Change Log

None yet.

## Review Triage Log

2026-10-05, security and correctness reviewers, no critical or high findings. Patched: a failed worker step left the run `running` forever (medium), now the run fails with `worker_error` and `run_stopped`; a run whose steps were all done never finished (medium), now `finished` with `run_finished`; dispatch ignored the run's state and could send after the run closed (medium), now checked before and again after the chat is made; a `sendMessage` failure after the chat was made could orphan it and allow a second send (low), now the step is marked failed with the chat id; `proposePlan` throwing left the run `planning` (low), now closed as failed; the manager's failure reason went to the HTTP body unmasked (low), now masked and cut to 300; chat errors from `sendMessage` (stopping, busy) became 500 (low), now 409; `dependsOn` was read without the schema in approve (low), now through `stepOf`; the run list read the agents once per run (low), now once. Not changed: the worker chat starts in the project's own default permission mode, which a project may have set above Ask (the user asked for "the worker's own default mode"; the plan's `mode: ask` is a ceiling on the manager's request, not applied to a chat; the roster story 15.5 and mode story 15.8 decide whether a manager-started chat is forced to Ask); the roster is every ready agent (15.5); GET reads settle steps and so write (idempotent, once); the run list reads the last reply per dispatched step (bounded to 20 runs); a worker `error` is final for the step (retry is 15.8); no cap on runs per project; the reply window of 200 events can miss the final reply after a very long tool tail (summary then empty).

## Verification

**Results:** `pnpm typecheck` clean; `pnpm test` all passed; `pnpm e2e` 169 passed (includes the new spec).

**Commands:** `pnpm typecheck`, `pnpm test`, `pnpm e2e` (the `orchestrate` spec), `PROVENANCE_BASE=origin/main pnpm provenance`.
