---
title: 'Tracer bullet: a goal reaches a stubbed manager, a plan shows, one approved instruction reaches one worker chat, the status reads back (epic 15)'
type: 'feature'
ticket: '15.3'
created: '2026-10-05'
status: 'in-progress'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: []
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

- [ ] shared shapes and the `manager` message origin
- [ ] core use-case and the chat seam
- [ ] server routes and wiring
- [ ] web page, tab and settings switch
- [ ] tests (core, server, web DOM, e2e, architecture)

**Acceptance Criteria:**
- Given the piece on and the fake manager, a goal becomes a listed plan.
- Given an unapproved step, a direct dispatch call is refused and nothing is created.
- Given an approved first step, a worker chat exists whose transcript shows the instruction as sent by the manager at the user's approval, and the status reads back masked and capped.
- Given the piece off, the page and routes answer `feature_off` and no tab shows.

## Implementation Notes

(Filled in as built.)

## Spec proposals

None yet.

## Plan Change Log

None yet.

## Review Triage Log

Not yet reviewed.

## Verification

**Commands:** `pnpm typecheck`, `pnpm test`, `pnpm e2e` (the `orchestrate` spec), `PROVENANCE_BASE=origin/main pnpm provenance`.
