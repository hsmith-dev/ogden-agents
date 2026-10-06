---
title: 'Contracts and stubs: manager protocol schemas, ManagerPort, orchestration run entity, events and the mode setting (epic 15)'
type: 'feature'
ticket: '15.2'
created: '2026-10-05'
status: 'in-review'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
baseline_revision: '2ae407fec67c55f776e0dc9004c85ad364c6efce'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-llm-orchestration/epic-llm-orchestration.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Entries 3 to 13 of epic 15 (tracer, adapter, roster, plan review, dispatch, mode and Stop, the loop) must build against one frozen set of manager contracts, and the reliability table from 15.1 still checks placeholder schemas.

**Approach:** Contracts and stubs only, no behaviour and no UI. In `shared`: the three protocol schemas (`ogden.manager.plan.v1`, `ogden.manager.decision.v1`, a status report) as zod with a JSON schema export for `structuredComplete`, one validator that gives every refusal a stable code and plain words, the `OrchestrationMode`, run limits, run and step entities with states, the `orchestration.*` events, and the Orchestration piece. In `core`: `ManagerPort` and the run, step and per-project settings columns (one migration). In `adapters`: a fake manager. In `server`: the one settings read route behind the piece guard. 15.1's table keeps every row true against the real schemas. The CAP-22 and AD-8 amendments are proposed through the bmad-spec and bmad-architecture memlogs, never hand-edited.

**Decisions (user, 2026-10-05; epic Notes):** the manager is a tool-free, schema-validated JSON call; the mode is `approve_each` by default and `automatic` only by the user's confirmation; limits are 20 instructions, depth 3, 30 minutes; the manager can never raise a mode above Ask, use Skip all, start a build or read a credential; Orchestration is an opt-in piece, off by default.

## Boundaries & Constraints

**Always:** every shape and plain sentence lives in `shared`, no em or en dash; string values from a manager are untrusted data (bounded, no control characters, ids and chat references in a fixed alphabet) and are never trusted as instructions; a decision's step id is checked against the plan; the rules live in code, not the prompt; back-compatible (every earlier event, setting and row still parses and reads); tests run no real model, network or keychain.

**Never:** a manager call, dispatch, approval flow, Stop, limits enforcement, loop, run store use-cases, UI, Orchestrate page, roster screens (entries 3 to 13); a hand edit of the spec or architecture; an app-wide default (entries 4 and 8); naming a model product or importing a shell, file or credential port under orchestration code.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Conforming plan or decision | the table's good, wrapped and override-text cases | accepted | n/a |
| Every refusal row of 15.1 | malformed, over the rules, adversarial | refused with the row's code and plain words | no value reaches Ogden |
| Mode above Ask, `skip_all`, unknown field | any step | refused by the schema | n/a |
| Untrusted text | control characters, odd step id or chat reference | refused (`bad_text`, `bad_reference`) | n/a |
| Decision names a step not in the plan | `dispatch` with `s9` | refused (`unknown_step`) | n/a |
| Default mode | no setting stored | `approve_each` | n/a |
| Automatic mode without confirmation | `orchestrationMode: automatic` | refused `confirmation_required`, nothing written | recorded in `workspace.settings_changed` when confirmed |
| Piece off | `GET …/orchestration` | 409 `feature_off` | n/a |
| Fresh and upgraded database | all migrations | tables and columns exist, old rows read as defaults | n/a |

</frozen-after-approval>

## Code Map

- `packages/shared/src/orchestration.ts` (new) -- protocol schemas, JSON schema export, validator, mode, limits, run and step entities and transitions, status report builder, settings and route shapes, plain sentences.
- `packages/shared/src/events-orchestration.ts` (new), `events.ts`, `bmad.ts`, `chat.ts`, `api.ts`, `ids.ts`, `errors.ts` -- the events, the `orchestration` piece, settings fields, the route, `orc_` and `ost_` ids.
- `packages/core/src/manager-port.ts` (new), `db/schema.ts`, `drizzle/0024_*`, `workspace-settings.ts`, `index.ts` -- the port, the tables and columns, the settings keys.
- `packages/adapters/src/manager-memory/` (new) -- the fake manager.
- `packages/server/src/orchestration-routes.ts` (new), `bmad-pieces.ts`, `start*.ts` -- the guarded route.
- `tests/fixtures/manager-cases.ts`, `manager-harness.ts` -- placeholders replaced by the shared validator; table rows kept or changed on purpose.
- `tests/architecture.test.ts` -- E15 rules.

## Tasks & Acceptance

- [x] shared contracts, validator, events, piece, settings keys, route, ids
- [x] core port, migration, settings use-case
- [x] fake manager, route, wiring
- [x] harness rewired to the shared schemas; architecture and contract tests
- [x] memlog proposals (spec CAP-22, architecture AD-8 and AD-22)

**Acceptance Criteria:**
- Given the 15.1 table, each row yields its listed outcome through the shared validator and through the real adapter against the fake server.
- Given a mode above Ask, `skip_all` or an unknown field, the schema refuses it.
- Given the migration on a fresh database and on one with every earlier migration, it applies.
- Given the fake manager, it satisfies the port's contract tests and refuses off-roster output.
- Given the Orchestration piece off, the new route answers `feature_off`.

## Implementation Notes

- Shared (`packages/shared/src/orchestration.ts`, `events-orchestration.ts`): strict zod schemas `ManagerPlan`, `ManagerDecision`, `ManagerStatusReport` (versions `ogden.manager.plan.v1`, `decision.v1`, `status.v1`), a JSON schema export of each in the subset `structuredComplete` checks (`pattern` and `anyOf` are dropped from the export; zod is the guard), and two pure checks, `checkManagerPlan(value, { roster })` and `checkManagerDecision(value, { planStepIds })`. A refusal is one of 19 stable codes with plain words (`MANAGER_REFUSAL_CODES`, `MANAGER_REFUSAL_REASONS`); `codeFor` picks the code from zod's issues (extra keys first, then the version, then the rest). Mode is `z.literal('ask')`, so a mode above Ask, `skip_all` or anything else is `mode_above_ask`; extra keys are `forbidden_field` (skip all, key, secret, token, password, credential, authorization), `forbidden_action` (command, shell, build, tool, kind) or `unknown_field`.
- Untrusted strings: goal, reason and question are one line; an instruction may use tabs and line feeds; no control, bidirectional or zero width characters anywhere (`bad_text`); a step id is `[A-Za-z0-9][A-Za-z0-9_-]{0,39}` and a `chat` is `new` or a `ses_` id (`bad_reference`); the worker is an agent id checked against the roster (`off_roster_worker`). A decision's `step_id` must be a step of the plan (`unknown_step`). A manager's override text in an instruction stays plain text: the defence is in code (mode, roster, limits), not in a filter.
- `makeStatusReport` masks with `redactSecrets`, strips control characters and caps at 4000 characters (`truncated`).
- 15.1's table now plays through these. Rows kept as they were: all of them. Changed on purpose: the good plan's `chat-7` became a real `ses_` id (a chat reference is `new` or one of the project's chats); added ten rows (bad chat reference, bad step id, bad dependency reference, control characters, direction override in a goal, multi line goal, non text instruction, missing mode, unknown step, bad step id in a decision). `REFUSAL_CODES`, `REFUSAL_REASONS`, `PLAN_SCHEMA`, `DECISION_SCHEMA` and `checkManagerReply` in `tests/fixtures/manager-cases.ts` are now thin aliases of the shared ones, so the table cannot drift. The same table also holds through the real adapter against the fake server (15.1's test, unchanged).
- Mode, limits, run and step: `OrchestrationMode` (`approve_each` default, `automatic`), `RUN_LIMITS` (20 instructions, depth 3, 30 minutes; meaning and enforcement are 15.8's), run states (`planning`, `awaiting_user`, `running`, `paused`, `stopped`, `finished`, `failed`) and step states (`proposed`, `approved`, `skipped`, `dispatched`, `done`, `failed`) with transition tables and `canMoveRun`/`canMoveStep`, approver `user` or `mode` (never the manager), stop and pause reasons.
- Events: the twelve `orchestration.*` events of the entry on the workspace stream, registered in `CoreEvent` and `NewCoreEvent`. `workspace.settings_changed` gains optional `orchestrationEnabled`, `orchestrationMode`, `orchestrationRoster`, their previous values and `orchestrationAutomaticConfirmed`. `orchestration.mode_changed` is the mode of a running run changing; the project's own mode changes through `workspace.settings_changed`.
- Core: `ManagerPort` (`proposePlan`, `decideNext`, never throws, a value has passed the rules for the context, `ManagerFailure` kinds malformed, off roster, too large, too slow, context too small, host not confirmed, unavailable) with `validatePlanFor`/`validateDecisionFor` as the one check an answer passes through. Settings: `orchestrationEnabled`, `orchestrationMode`, `orchestrationRoster` in `updateSettings`; switching to automatic needs `confirm: true` every time it is set (the server is the gate; "confirmed once per project" is 15.8's); a roster naming an agent this install lacks is `agent_unknown`; a roster model's endpoint is not checked here (15.4, with the roster UI). The app-wide default for new projects is not built (entries 4 and 8).
- Migration `0024_orchestration_contracts` (generated by drizzle-kit after 0023, which is also the highest on origin/main): tables `orchestration_runs` and `orchestration_steps`, columns `workspaces.orchestration_enabled` (default false), `orchestration_mode`, `orchestration_roster`. No use-case writes the run tables yet.
- The fake: `createMemoryManager` in `packages/adapters/src/manager-memory`, scripted replies pass through the same check, an unscripted run plans one step per ready worker and dispatches them in turn. `packages/adapters/test/manager-port.test.ts` holds a reusable `ManagerPort` contract (15.4 runs it on the real adapter) and plays the 15.1 table through the fake.
- Orchestration is a piece but not a BMad Method piece (deviation from the entry's wording, see the Plan Change Log): `orchestrationEnabled` has its own column and settings key, `core.orchestration.requireOrchestration` is the guard (409 `feature_off`, own words), turning it on is refused (`feature_unavailable`) where the install does not ship it (`SHIPPED_ORCHESTRATION = false` until the tracer, 15.3; `start({ orchestrationAvailable: true })` for tests), and every orchestration route is registered through `orchestrationRoutes` (a test fails otherwise). The one route is `GET /api/v1/workspaces/:wsId/orchestration` (mode, limits, roster).
- Architecture test E15: orchestration and manager files in core, shared and the fake name no model product and import no shell, file, agent or credential port or Node module.

## Spec proposals

Written to the memlogs with `_bmad/scripts/memlog.py`, never to the frozen documents: `spec-ogden-agents/.memlog.md` (CAP-22 and its protocol note) and `architecture-ogden-agents/.memlog.md` (the AD-8 `orchestration.*` events and settings keys, migration 0024, the AD-22 note that Orchestration is an opt-in piece outside the BMad piece list, and the AD-1 note on `ManagerPort`). They are applied later by bmad-spec and bmad-architecture; `covers` stays empty on every epic 15 entry until then.

## Plan Change Log

- 2026-10-05 (build): the entry says the `workspace.settings_changed` keys cover "the Orchestration piece". Adding `orchestration` to `BMAD_PIECES` would list it in BMad Method's settings, the main switch, the new project defaults and the welcome question, all of which are about BMad, and would break every test that counts four pieces. Chosen instead: the same shape (opt-in, off by default, one core guard, one route helper, turned on only where shipped) as its own `orchestrationEnabled` key. Frozen intent unchanged; the AD-22 note is in the memlog proposal.

## Review Triage Log

## Verification

**Commands:** `pnpm typecheck`, `pnpm test`, `PROVENANCE_BASE=origin/main pnpm provenance`.
