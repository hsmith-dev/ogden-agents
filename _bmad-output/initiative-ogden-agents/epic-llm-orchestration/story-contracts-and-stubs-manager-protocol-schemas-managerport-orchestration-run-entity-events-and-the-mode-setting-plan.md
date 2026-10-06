---
title: 'Contracts and stubs: manager protocol schemas, ManagerPort, orchestration run entity, events and the mode setting (epic 15)'
type: 'feature'
ticket: '15.2'
created: '2026-10-05'
status: 'in-progress'
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

- [ ] shared contracts, validator, events, piece, settings keys, route, ids
- [ ] core port, migration, settings use-case
- [ ] fake manager, route, wiring
- [ ] harness rewired to the shared schemas; architecture and contract tests
- [ ] memlog proposals (spec CAP-22, architecture AD-8 and AD-22)

**Acceptance Criteria:**
- Given the 15.1 table, each row yields its listed outcome through the shared validator and through the real adapter against the fake server.
- Given a mode above Ask, `skip_all` or an unknown field, the schema refuses it.
- Given the migration on a fresh database and on one with every earlier migration, it applies.
- Given the fake manager, it satisfies the port's contract tests and refuses off-roster output.
- Given the Orchestration piece off, the new route answers `feature_off`.

## Implementation Notes

## Spec proposals

## Plan Change Log

## Review Triage Log

## Verification

**Commands:** `pnpm typecheck`, `pnpm test`, `PROVENANCE_BASE=origin/main pnpm provenance`.
