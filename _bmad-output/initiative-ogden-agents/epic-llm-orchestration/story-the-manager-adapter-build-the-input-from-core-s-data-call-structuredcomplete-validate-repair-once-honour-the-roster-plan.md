---
title: "The manager adapter: build the input from core's data, call structuredComplete, validate, repair once, honour the roster (epic 15)"
type: 'feature'
ticket: '15.4'
created: '2026-10-05'
status: 'in-progress'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
baseline_revision: '6c8a201e6821f01f327f74934981728cb9a0bbd7'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-llm-orchestration/epic-llm-orchestration.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The tracer (15.3) can only plan with a test stub: a real install answers "no manager yet". The manager has to be a real, tool-free call to the endpoint and model the user chose, safe against the model's own text and against worker text.

**Approach:** The real `ManagerPort` on `LocalModelPort.structuredComplete`, in core (the same layer as `LocalModels`, naming no vendor): a pure input builder that caps the prompt to half of the endpoint's reported context (a conservative default when unknown), masks it and carries worker text only as delimited untrusted data; the call through `LocalEndpoints.target` (the one place that enforces the non-loopback confirmation); validation through `validatePlanFor` and `validateDecisionFor`; one repair retry that names only the rule that failed (and never after a failure `structuredComplete` already repaired); plain failure kinds (malformed, off roster, too large, too slow, context too small, remote host not confirmed, endpoint missing); and an event-log record of the masked output. The server uses it as the manager of a project whose roster `manager` role is a model on an endpoint that is set up and confirmed, and says which of those states it is in; the memory fake stays for test hooks.

**Decisions (user, 2026-10-05; epic Notes):** the manager is any configured OpenAI-compatible endpoint, local first and not forced; no tool, shell, file or credential; a remote manager needs the endpoint's confirmation and its key never enters the prompt or the logs; worker text is data, never instructions; the manager role is filled by a model, never an agent.

## Boundaries & Constraints

**Always:** the rules live in code (validation, roster, mode, limits), not in the prompt; every string sent or recorded is masked first; no file contents, diffs, keys or paths outside the project in the input; failure words are plain, no em or en dash; core and shared name no vendor or model product; tests run no real model, network or keychain.

**Never:** a dispatch, approval flow, Stop, limits enforcement or loop (entries 6 to 9); the roster UI or "Test as a manager" gating (entry 5); a hand edit of the spec or architecture; a call that skips `LocalEndpoints.target`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Good reply | conforming plan or decision | accepted, masked output recorded | n/a |
| Repairable | JSON or shape fixed by `structuredComplete`'s own retry | accepted, no second repair | n/a |
| Rule broken after a valid shape | off roster worker, bad link, bad text | one repair naming the rule only, then accepted or refused | `malformed` or `off_roster`, nothing dispatched |
| Worker text says to ignore the rules | report with injected instructions | sent only as delimited data; the plan is still checked by code | n/a |
| Secret, file body, outside path | in the goal, project text or worker report | masked or removed before the call | n/a |
| Input over the cap | long report, plan or project text | cut to the cap; refused `context_too_small` if even the cut input does not fit | n/a |
| Reply over the byte cap | huge reply | `too_large` | n/a |
| No answer in time | hang | `too_slow` | n/a |
| Remote host not confirmed | non-loopback, no confirmation | refused `host_not_confirmed` before any call | n/a |
| Endpoint removed | roster names a removed endpoint | `endpoint_missing` | n/a |
| Agent as manager | roster `manager` is an agent | refused when saved | 400 |

</frozen-after-approval>

## Code Map

- `packages/core/src/manager-input.ts` (new) -- the pure input builder, masking, path scrub, budget.
- `packages/core/src/model-manager.ts` (new) -- `createModelManager`, the real `ManagerPort`.
- `packages/core/src/manager-source.ts` (new) -- the per-project manager from the roster, and its plain status.
- `packages/core/src/manager-port.ts`, `orchestration.ts`, `workspace-settings.ts`, `errors.ts`, `index.ts` -- `endpoint_missing`, the record, the source, the manager role rule.
- `packages/shared/src/orchestration.ts`, `events-orchestration.ts`, `events.ts`, `api.ts` -- the manager status, the `orchestration.manager_replied` event.
- `packages/server/src/start.ts`, `start-agents.ts`, `orchestration-routes.ts` -- wiring and the status in the settings route.
- `packages/web/src` -- Orchestrate states, the manager model setting.
- tests: core, adapters (`manager-port.test.ts` on the real adapter), server, web DOM, architecture, e2e.

## Tasks & Acceptance

- [ ] input builder and the real manager in core
- [ ] manager source, roster rule, settings and status route
- [ ] event record
- [ ] server wiring, web states and the manager model setting
- [ ] tests (15.1 table through the real adapter, contract, adversarial, architecture, e2e)

**Acceptance Criteria:**
- Given the fake server and the 15.1 table, the real manager yields each row's outcome.
- Given worker output saying to ignore the rules, no step changes; the input holds no key, file body or outside path; an oversize input is cut; a non-loopback endpoint without confirmation is refused before a call.
- Given a project whose manager role is a ready model, a goal becomes a plan from it; otherwise Orchestrate says which of the real states it is in.

## Implementation Notes

(filled in at the end)

## Spec proposals

(filled in at the end)

## Plan Change Log

None yet.

## Review Triage Log

(filled in after review)

## Verification

**Commands:** `pnpm typecheck`, `pnpm test`, `pnpm e2e` (the `orchestrate` spec), `PROVENANCE_BASE=origin/main pnpm provenance`.
