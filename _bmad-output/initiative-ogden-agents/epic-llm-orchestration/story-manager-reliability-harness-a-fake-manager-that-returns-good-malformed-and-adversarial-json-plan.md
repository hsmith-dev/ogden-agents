---
title: 'Manager reliability harness: a fake manager that returns good, malformed and adversarial JSON (epic 15)'
type: 'feature'
ticket: '15.1'
created: '2026-10-05'
status: 'in-review'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick-security', 'quick-correctness']
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

- [x] cases and table, reference rules
- [x] fake manager stub, fake server mode, runner and report
- [x] tests, RELEASING.md checklist

**Acceptance Criteria:**
- Given the table, each case yields its scripted reply on cue from the stub and the fake server, the reference rules give each case its listed outcome, the same table holds through the real adapter against the fake server, the report over the fake returns the expected tally, and RELEASING.md holds the live-check checklist.

## Implementation Notes

- Entry 2 imports `MANAGER_CASES`, `REFUSAL_CODES`, `HARNESS_LIMITS`, `checkManagerReply` (replace it with the real schemas, keep the table), `createFakeManager`, `runCaseTable` and `measureModel` from `tests/fixtures/manager-cases.ts` and `tests/fixtures/manager-harness.ts`. Root tests and package tests already import from `tests/fixtures`, so core's AD-1 edges are untouched (type-only import of `LocalModelPort`).
- The harness's schemas, size caps (4000 character instruction, 20 steps, 256 KiB reply) and field names (`version`, `goal`, `steps[id, worker, chat, instruction, mode, depends_on]`; decision `action`, `reason`, `step_id`, `question`) are placeholders for the table's sake. Entry 2 owns the real ones and must keep every row's expected outcome true, or change the row on purpose.
- An override attempt in an instruction is accepted as text: the defence is that mode, roster and limits are enforced in code, not that a filter spots the words.
- The fake server's `managerCases` option is new and inert unless given; no existing rule changed.
- Entry 2 must also treat string values (goal, instruction, chat, reason, question) as untrusted data, and check a decision's step id against the plan.
- Real model measurement is not run in CI; the checklist is in RELEASING.md under "Epic 15 live check".

## Live check result

Not run yet (the user's check; see RELEASING.md).

## Plan Change Log

## Review Triage Log

Security and correctness reviewers (2 lenses), no critical findings. Patched: `matches` accepted any refusal when no code was observed (high/medium), so a refusal now needs the expected code, and a schema refusal stands only for a rule code, never a port code (timeout, not_json, too_large), with a test; the real adapter table test used one 400 ms deadline for up to four requests and could flake under load (medium), now 10 s per case and 300 ms only for a hang; the reply cap counted characters, now bytes (low); a hang with no timeout waited a minute, now one second (low); the fake server's hang could wait forever on an already closed response (low); added decision in prose and ask_user without a question cases (low); the RELEASING.md slow threshold matches the test and says the rate is counted by hand (low). Not changed: the fake server's per-case counter is per server, so a repeated multi reply case on one server gets its last reply (low, documented; tests start a server per run); the fake's reader omits the adapter's think block stripping and array fallback and schema check is opt in (low, the table is run against the real adapter too); string values are not scanned for secret shaped text and a decision's step id is not checked against a plan (low, for entry 2's real schemas and ManagerPort, noted in Implementation Notes); the key patterns can report a forbidden code for an innocent unknown key like `type` (low, harmless); measureModel counts valid JSON as the final answer being JSON (low). No intent_gap or bad_plan.

## Verification

**Commands:** `pnpm typecheck`, `pnpm test`, `PROVENANCE_BASE=origin/main pnpm provenance`.
