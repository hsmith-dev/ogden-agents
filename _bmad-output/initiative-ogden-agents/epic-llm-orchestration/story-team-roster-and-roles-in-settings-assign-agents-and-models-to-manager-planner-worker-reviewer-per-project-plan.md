---
title: 'Team roster and roles in Settings: assign agents and models to manager, planner, worker, reviewer per project (epic 15)'
type: 'feature'
ticket: '15.5'
created: '2026-10-05'
status: 'in-review'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick-security', 'quick-correctness']
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

- [x] shared contracts, core roster, defaults and checks
- [x] app-wide default and event
- [x] server routes, settings check, wiring
- [x] manager adapter addresses only rostered workers
- [x] roster UI (project and new projects)
- [x] tests and e2e

**Acceptance Criteria:**
- Given a fresh project and a fresh install with the app-wide default changed, the roles resolve to the defaults and to the changed default.
- Given an agent that is not ready, a model that failed the test, an agent as manager, a model as worker or an agent whose terms forbid it as worker, the server refuses the assignment with its reason and writes nothing.
- Given a goal, the manager is offered only the rostered workers.
- Given the settings page, the user assigns each role and sees why a holder cannot take one.

## Implementation Notes

- Layering (AD-1): the rules are in core `team-roster.ts` and shared `roster.ts` and `team.ts`, which name no agent or model product and import no shell, file, agent or credential port (architecture test E15 now covers both). A rule reads the agent list's own data: its sign in methods, its readiness, and a new optional descriptor field `interactiveOnly` (one plain sentence, no dash) that an agent sets when its vendor allows only a person to drive it. No agent Ogden ships sets it today (Copilot CLI is not an agent here yet; it sets it when epic 8 adds it), so the "Copilot CLI is never a worker" rule is proved with a fake agent whose descriptor sets it. `ChatAgent.interactiveOnly` carries it, optional, so an older reader still parses.
- Role kinds (shared `rosterKindProblem`, also run by the settings use-case so a direct core call is refused too): the manager is a model, a worker is an agent; the planner and reviewer may be either. This is a deliberate narrowing of 14.3's `TeamAssignee`, which allowed an agent anywhere: no type change.
- Availability (`assess`): an agent not in the install, not ready (the agent list's own reason), interactive only (worker and reviewer), a subscription agent (any agent that lists a `subscription` sign in method: allowed with an "approve one by one" note and `approveEachOnly: true`, refused as worker or reviewer when the project's mode is `automatic`, with "mode" in the words); a model on a server that is gone, on another computer nobody confirmed, or, for the manager and planner, one that failed Test as a manager. Mode is the project's own (Approve each instruction for the install-wide default).
- Test as a manager (14.8): the result was not kept anywhere. `LocalModels` now remembers `{endpointId, model, pass, message}` in memory per endpoint and model (bounded to 200, oldest first, a repeated test moves a model to the end) and exposes `managerTestResult` and `managerTestResults`. Only an answer that tells about the model counts (passed, too slow, wrong shape, not JSON); a server that was down or lacked the model does not. A restart forgets them: an untested model is allowed, and the screen says "It has not been tested as a manager since Ogden Agents started" (a refusal needs a known failure). Persisting the results is not done here (deferred, see below).
- Defaults (`effectiveRoster`, a pure function): manager and planner, the first model that passed on a usable server (the install's default server first), else the model a server was set up with, never one that failed, never on a server nobody confirmed; worker, the project's default agent when it can be a worker, else the first agent that can; reviewer, the first agent that can be a reviewer other than the worker, else nobody. A subscription agent is skipped for a worker or reviewer default in automatic mode. A stored choice always wins, even when it stopped being ready (shown with its reason, never swapped); `null` in the stored roster means "use the default", so there is no way to say "nobody", which matches 14.3's type.
- One simple model for "the workers the manager may address" (no type change): the worker role is one agent, the reviewer role may be an agent; the manager is offered the effective worker and the effective reviewer when that is an agent (`workersOf`, in that order, once each). `Orchestration.startRun` filters `chatAgents` to them and marks `ready` from the roster's check; a project whose roster has no ready worker is refused (`manager_unavailable`) before anything is stored or asked. `TeamRoster` is unchanged. Wanting several workers is a list, which would extend `TeamRoster` compatibly (an optional `workers: TeamAssignee[]`); not built, see deferred.
- The manager source (15.4) follows the roster: with no chosen manager it uses the default manager (`defaultModel`), a manager that failed its test is not used (new state `test_failed`, plain words `MANAGER_STATE_WORDS.test_failed`), and one that was never tested is.
- Checks on save: the settings use-case keeps the sync kind rules and the server endpoint check (15.4). The readiness rules need the agent list, which is async, so `Team.check` runs first in the settings route (`workspace-routes.ts`), against the mode being saved with (a mode change and a roster in one request are checked together), and only for roles that changed: something that stopped being ready never blocks another change. The same function checks the install-wide default. An agent this install does not have is left to the settings use-case (`agent_unknown`), and refused by `setDefault` itself.
- Install-wide default for new projects: kept in `preferences.json` beside the pieces, default agent and default mode (`newProjects.orchestrationRoster`, read on its own so a damaged roster reads as none and never costs the pieces; a roster save keeps the others and the other way round). It follows how the default agent and mode are kept and applied: `createAddProject` passes it to `ensureWorkspace`, which writes it to the new project's `orchestration_roster` in the creating transaction with one `workspace.settings_changed` (`orchestrationRoster`, `previousOrchestrationRoster` empty); projects that exist keep their own. Changing it appends the new install-level event `settings.team_roster_default_changed {orchestrationRoster, previousOrchestrationRoster}` (not when nothing changed). `PATCH /settings/new-projects` does not set it: `GET` and `PUT /api/v1/settings/team-roster` do, so every save goes through the same check.
- Routes: `GET /api/v1/workspaces/:wsId/orchestration/roster` (behind the Orchestration guard, registered through `orchestrationRoutes`), `GET` and `PUT /api/v1/settings/team-roster` (behind the gate). Answers are `{ roster: RosterView, stored: TeamRoster }`: four roles in order, each with the chosen and the effective holder, where it came from, a problem or note, why a role is empty, and every option with `available`, `reason`, `note`, `approveEachOnly`; plus `workers` and the `mode` used. No key, address or path in any of it (a model shows as its id and "on this computer, on <server name>").
- UI: the 15.4 manager picker is replaced by `RosterEditorView` in `orchestrate/roster-editor.tsx`: per role a radio group (Use the default, then every option; an option that cannot be taken is disabled and says why; the chosen one stays enabled so it shows), "Choose another model" for the manager, planner and reviewer (the 15.4 server and model list), each choice saved at once by `PATCH` settings with the whole roster, the server's refusal shown as its own words. It sits under Orchestration in the project settings (`ProjectRoster`) and in a "Team for new projects" section on the New projects page (`DefaultRoster`). Queries refresh from `workspace.settings_changed`, `settings.local_endpoints_changed`, `settings.team_roster_default_changed` and `agent.*` events.
- Not in this story (entries 6 to 9): enforcing approve-each for a subscription agent at dispatch and at the switch to automatic (the roster only refuses the assignment and exposes `approveEachOnly`; the mode setting story gates the switch), run limits, Stop.
- Tests: shared `team-roster-contracts` (10), core `team-roster` (36), `local-models` (2 more), `new-projects` (4), `orchestration-settings` (worker kind), `agent-contracts` (2), server `team-roster` (18), web DOM (`orchestrate.dom`: the roster replaces the 15.4 picker tests), architecture E15 (the two new files), Playwright `orchestrate` (the 15.4 pick-a-manager test moved to the roster, plus assigning the four roles with reasons and direct refusals, and the team for new projects).

## Spec proposals

Written to the memlogs with `_bmad/scripts/memlog.py` (never to the frozen documents): the spec memlog gets a CAP-22 roster note (roles, kinds, defaults, reasons, the manager addressing only rostered workers, the install-wide default, the in-memory test results); the architecture memlog gets the fourteenth event `settings.team_roster_default_changed` (install level, no migration; preferences.json), the `test_failed` manager state, the descriptor field `interactiveOnly`, and the note that the readiness check runs in the settings route before the use-case. `covers` stays empty.

## Plan Change Log

None yet.

## Review Triage Log

2026-10-05, security and correctness reviewers (2 lenses), no critical findings. Patched: a switch to automatic on its own (or a roster re-sent unchanged with it) skipped the subscription agent rule (high, both reviewers), now `Team.check` runs for a mode or a roster change and checks the kept worker and reviewer against the target mode; the settings use-case's kind rule ran over every role and would block saving another role of a roster stored before the rule (medium), now only changed roles; a default manager nobody chose could send the goal to a server on another computer (medium), now only this computer's servers supply an implicit default (a model the user tested and passed still counts); the default manager took the oldest passed test, which may name a model since unloaded (low), now the newest; labels and reasons could pass the view's size limits and turn into a 500 (low), now cut; a chosen agent the install lost had no radio to show it, and a held model could fall off a long list (low), the holder is now listed first; an unmatched radio value reset a role to the default (low), now ignored; `setDefault` used `this` (low), removed; the default roster's kind rule applied only to changed roles (medium), now to every role; the roster queries refetch when the page opens, so a fresh Test as a manager shows (medium). Tests added for each. Not changed: dispatch does not re-check that a step's worker is still rostered and ready (medium low): the plan is checked against the roster when proposed and the user approves each step; dispatch and read-back is 15.7 and owns it (deferred); a race between the async check and the save (low, one local user); a damaged preferences file is overwritten by a roster save as `set` already does (low); an interactive only agent may plan (confirmed intent, nothing drives a planner); test results survive an edit of a server's address until retested (low); runs record the default mode while the roster uses the project's (existing, 15.8 owns the mode).

## Verification

**Results:** `pnpm typecheck` clean; `pnpm test` 313 files, 3901 passed, 8 skipped; Playwright `orchestrate` (5) passed; `PROVENANCE_BASE=origin/main pnpm provenance` passes.

**Commands:** `pnpm typecheck`, `pnpm test`, `npx playwright test tests/e2e/orchestrate.spec.ts` (after `pnpm run build`), `PROVENANCE_BASE=origin/main pnpm provenance`.
