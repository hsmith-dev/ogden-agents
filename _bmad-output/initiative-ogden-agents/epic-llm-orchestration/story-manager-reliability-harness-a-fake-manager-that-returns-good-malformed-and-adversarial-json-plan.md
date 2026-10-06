---
title: 'Manager reliability harness: a fake manager that returns good, malformed and adversarial JSON (epic 15)'
type: 'feature'
ticket: '15.1'
created: '2026-10-05'
status: 'in-progress'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
baseline_revision: 'd299e75e6efe6a43ba86a60fbd1d3238acbdfb67'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-llm-orchestration/epic-llm-orchestration.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every later entry of epic 15 (contracts, adapter, dispatch, the loop) must be tested against a manager that misbehaves in known ways, and a user must be able to measure whether a real model is dependable enough to manage. Neither exists, and real models can never run in CI.

**Approach:** Test support only, no product code. A table of scripted manager replies (good, wrapped, malformed, over the rules, adversarial, slow) with the expected outcome of each as data; a fake manager as a `LocalModelPort` stub and a scripted mode of the fake OpenAI-compatible server that play the table on cue; a reference rule checker that states what the protocol must refuse (entry 2 replaces it with its schemas and must agree with the table); a small report function that runs the table against any `LocalModelPort` and tallies a model's valid-JSON rate over three sample goals; and a live-check checklist in RELEASING.md for the user's real-model run.

**Decisions (user, 2026-10-05; epic Notes):** the manager is a tool-free, schema-validated JSON call; the real-model measurement (Mac and Windows, several model sizes) is the user's live check, never CI; the quality floor stays a setting and a recorded Decision until the user's run answers it.

## Boundaries & Constraints

**Always:** no test calls a real model or a real network (loopback fake server or in-memory stub only); the harness names no model product; user-facing checklist copy is plain language with no dashes.

**Never:** product code, schemas or routes (entry 2); a change to the fake server's existing rules; running the report against a real endpoint from CI.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Good | conforming plan or decision | accepted | n/a |
| Wrapped | JSON in a code fence or after prose | accepted | n/a |
| Repairable | first reply not JSON, second good | repaired | n/a |
| Malformed | truncated, empty, wrong version, unknown fields, oversize reply | refused with a plain reason | no value reaches Ogden |
| Over the rules | off-roster agent, mode above Ask, `skip_all`, credential field, build or shell request, duplicate, cyclic or unknown step links, too many steps | refused with a plain reason | n/a |
| Override text | an instruction telling Ogden to drop its rules | accepted as text only, mode stays Ask | rules live in code, not the prompt |
| Hang | no reply | refused as too slow | timeout |

</frozen-after-approval>

## Code Map

- `tests/fixtures/manager-cases.ts` -- the cases, the expected-outcome table, the harness schemas and the reference rule checker.
- `tests/fixtures/manager-harness.ts` -- the fake manager `LocalModelPort`, the table runner and the model measurement report.
- `tests/fixtures/fake-openai-server.{mjs,d.mts}` -- a `managerCases` scripted mode (`MANAGER_CASE:<id>` in the prompt).
- `tests/manager-harness.test.ts` -- the tests. `RELEASING.md` -- the live-check checklist.

## Tasks & Acceptance

- [ ] cases and table, reference rules
- [ ] fake manager stub, fake server mode, runner and report
- [ ] tests, RELEASING.md checklist

**Acceptance Criteria:**
- Given the table, each case yields its scripted reply on cue from the stub and the fake server, the reference rules give each case its listed outcome, the same table holds through the real adapter against the fake server, the report over the fake returns the expected tally, and RELEASING.md holds the live-check checklist.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Verification

**Commands:** `pnpm typecheck`, `pnpm test`, `PROVENANCE_BASE=origin/main pnpm provenance`.
