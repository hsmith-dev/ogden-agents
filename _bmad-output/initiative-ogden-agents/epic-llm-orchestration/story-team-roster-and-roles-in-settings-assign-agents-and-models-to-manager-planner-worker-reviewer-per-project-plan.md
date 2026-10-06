---
title: 'Team roster and roles in Settings: assign agents and models to manager, planner, worker, reviewer per project (epic 15)'
type: 'feature'
ticket: '15.5'
created: '2026-10-05'
status: 'in-progress'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
baseline_revision: 'bd186dde9c283be20c473cf329fbde0411f8ed1d'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-llm-orchestration/epic-llm-orchestration.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The manager of a project is one setting, and the tracer lets it address every agent the install lists. The user cannot say who plans, who does the work and who reviews, nothing says why an agent cannot take a role, and nothing stops a role from being given to an agent the vendor's terms or the project's mode forbid.

**Approach:** The full roster in core and in the project's settings under Orchestration. Per project the user assigns an agent or a model to manager, planner, worker and reviewer (one holder may have several roles). A role nobody was chosen for has a default (manager and planner: the first ready model whose Test as a manager passed, else a configured server's model; worker: the project's default agent; reviewer: a different ready agent from the worker where one exists). Each agent or model shows whether it can take each role and why not in plain words (not ready, no manager test passed, vendor terms, mode). The server checks every assignment (a direct API call that breaks a rule is refused, nothing written). An install-level default roster, kept with the default for new projects, is copied to a project when it is added and changes `settings.team_roster_default_changed`. The manager addresses only the rostered workers.

**Decisions (user, 2026-10-05; epic Notes):** one holder may have several roles; the manager is a model, never an agent; Copilot CLI is never a worker; the subscription agents (Claude Code, Antigravity) take only instructions the user approves one by one until their terms are re-checked; workers keep their own permission cards and modes, and the roster never changes them.

## Boundaries & Constraints

**Always:** every rule lives in code, not the screen; every reason is plain words with no em or en dash; core and shared name no agent or model product (a rule reads the agent list's data); a role left as it was is never re-checked; back-compatible (a stored roster, an older settings row, an old preferences file and every earlier event still read); tests run no real agent, model, network or keychain.

**Never:** a dispatch, approval flow, mode enforcement for automatic runs, Stop or limits (entries 6 to 9); a hand edit of the spec or architecture; a roster that changes a worker's permission mode.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh project | nothing chosen, a server with a model, two ready agents | manager and planner are that model, worker is the project's default agent, reviewer is the other ready agent | n/a |
| Model that passed the test | a test passed on a second model | it is the default manager before the server's chosen model | n/a |
| App-wide default | roster saved for new projects | a project added later starts with it; one that exists keeps its own | event `settings.team_roster_default_changed` |
| Agent as manager | `manager: agent` | refused 400 | nothing written |
| Model as worker | `worker: model` | refused 400 | nothing written |
| Agent not ready | worker not signed in | refused with its reason | nothing written |
| Model failed the test | manager model failed Test as a manager | refused with the test's words | nothing written |
| Model not tested | manager model never tested | allowed, the screen says it was not tested | n/a |
| Never a worker | agent whose terms allow only a person | refused as worker and reviewer | nothing written |
| Subscription agent | worker in Approve each | allowed, marked "approve one by one"; in Dispatch automatically refused | nothing written |
| Manager addresses | a goal on a project | only the worker and the reviewer (when an agent) are offered | no ready worker: refused with plain words |
| Stale holder | a stored holder stopped being ready | shown with its reason; another change still saves | n/a |
| Older data | no stored roster, no preferences roster | all defaults | n/a |

</frozen-after-approval>

## Code Map

- `packages/shared/src/team.ts`, `roster.ts` (new), `api.ts`, `bmad.ts`, `chat.ts`, `events-settings.ts`, `events.ts` -- role words and kind rules, the roster view, routes, the default's field, the agent list's terms sentence, the new event.
- `packages/core/src/team-roster.ts` (new) -- assessment, defaults, view, check, the team use-case.
- `packages/core/src/local-models.ts` -- Test as a manager results remembered in memory.
- `packages/core/src/new-projects.ts`, `entities.ts`, `workspace-settings.ts`, `agent-descriptor.ts`, `chat/workspaces.ts`, `orchestration.ts`, `core.ts` -- the default roster store and copy at creation, the kind rules, the terms field, the manager's workers.
- `packages/server/src/team-roster-routes.ts` (new), `workspace-routes.ts`, `app.ts`, `start.ts` -- routes, the check on settings changes, wiring.
- `packages/web/src` -- the roster editor under Orchestration and in Settings for new projects.
- tests: shared, core, adapters, server, web DOM, architecture, e2e.

## Tasks & Acceptance

- [ ] shared contracts, core roster, defaults and checks
- [ ] app-wide default and event
- [ ] server routes, settings check, wiring
- [ ] manager adapter addresses only rostered workers
- [ ] roster UI (project and new projects)
- [ ] tests and e2e

**Acceptance Criteria:**
- Given a fresh project and a fresh install with the app-wide default changed, the roles resolve to the defaults and to the changed default.
- Given an agent that is not ready, a model that failed the test, an agent as manager, a model as worker or an agent whose terms forbid it as worker, the server refuses the assignment with its reason and writes nothing.
- Given a goal, the manager is offered only the rostered workers.
- Given the settings page, the user assigns each role and sees why a holder cannot take one.

## Implementation Notes

(Filled in as built.)

## Spec proposals

(Filled in as built.)

## Plan Change Log

None yet.

## Review Triage Log

Not yet reviewed.

## Verification

Not yet run.
