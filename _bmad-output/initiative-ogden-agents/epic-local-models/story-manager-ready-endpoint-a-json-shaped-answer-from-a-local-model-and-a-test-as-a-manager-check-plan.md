---
title: 'Manager-ready endpoint: a JSON-shaped answer from a local model, and a Test as a manager check (epic 14)'
type: 'feature'
ticket: '14.8'
created: '2026-10-05'
status: 'in-review'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick-security', 'quick-correctness']
review_loop_iteration: 0
baseline_revision: 'efe7f044de30eb031faf11e35ffe2be7be33ba9c'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-local-models/epic-local-models.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 15's manager needs one tool-free answer from a local model in a fixed JSON shape, and a user needs to know whether a model can do that before trusting it as a manager.

**Approach:** `LocalModelPort.structuredComplete` in the OpenAI-compatible adapter: one non-streaming chat completion at temperature 0 with a hard timeout and size cap, constrained by `response_format` json_schema, falling back to json_object and then the prompt alone (a server that refuses an ask or answers off shape moves down), validated by Ogden's own schema checker, with one repair request, and at most four requests. A Test as a manager action on each model sends a fixed small plan shaped request and reports pass or a plain-words reason.

**Decisions (user, 2026-10-05; epic Notes):** `structuredComplete` is the hook for epic 15's manager with the ladder json_schema, json_object, prompt only; no manager role, session or UI exists yet; no tools and no files.

## Boundaries & Constraints

**Always:** the answer is validated by Ogden whatever the server did; the only request is the fixed one; the key is only a bearer header; core and shared name no vendor.

**Never:** tools, files, streaming, or a manager session here; a value in a problem message; more than four requests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Conforming | server enforces the schema | pass on the first request | n/a |
| Server refuses json_schema or any response_format | 400 | next rung, pass | n/a |
| Malformed | not JSON or off shape on every rung | one repair, then plain-words failure | bad_answer |
| Oversize | huge answer | refused | too_large |
| Timeout | slow model | too slow | timeout |
| Key, model, context | 401, 404, context error | stop at once | their own kinds |

</frozen-after-approval>

## Code Map

- `packages/adapters/src/local-model-openai/{structured,json-schema,http,port}.ts` -- the ladder, the checker, the server's error code.
- `packages/core/src/local-models.ts` -- `managerTest`, the fixed schema and prompt.
- `packages/shared/src/{local-endpoints,api}.ts` -- the test contracts and route.
- `packages/server/src/local-endpoint-models-route.ts`, `packages/web/src/agents/local-endpoint-models.tsx` -- the route and the button.
- Tests: `packages/adapters/test/local-structured.test.ts`, `packages/core/test/local-models.test.ts`, `packages/server/test/local-endpoint-models.test.ts`, `packages/web/test/local-endpoints.dom.test.tsx`, `tests/e2e/local-endpoints.spec.ts`.

## Tasks & Acceptance

- [x] adapter: structuredComplete, checker, ladder, repair, limits
- [x] core, server, web: Test as a manager
- [x] fixture modes: REPAIRABLE, HUGE, slow structured answers

**Acceptance Criteria:**
- Given the fake server, a conforming reply passes, malformed JSON gets one repair retry then a plain-words failure, an oversize reply is refused, a timeout is reported, the stub and the real adapter pass the same contract, and core and shared still name no vendor.

## Implementation Notes

Which structured-output option each real server honours is a live check (docs: LM Studio supports json_schema only; Ollama's /v1 lists JSON mode). The ladder is built to fall to what a server does honour. `mode` in the answer says which rung worked.

## Plan Change Log

## Review Triage Log

Security and correctness reviewers (2 lenses), no critical findings. Patched: the schema checker read the prototype chain (\`__proto__\`, \`constructor\` passed \`additionalProperties: false\`), now own keys only (high); a wrong typed answer of 130k items made the problem list overflow the stack, now at most 20 problems collected without spreads (high); the fenced block pattern was quadratic on a hostile reply (about 12 s of blocked event loop at the cap), now linear scans (high); a schema using a rule the checker ignores (\`anyOf\`, \`$ref\`, \`pattern\`) or nested too deep is refused up front (medium); a model's key names are shortened and cleaned in problems and the repair prompt is capped (medium); one deadline for the whole call, not per request (medium); a server's context error is recognised by its code, type or words (vLLM, llama.cpp and a plain string answer) and a 5xx on a response_format rung moves down the ladder (medium); content as a list of parts is read and an empty or null answer is "not JSON", not a broken server, and JSON after prose or a reasoning block is found (medium); an already stopped call sends nothing (low); the manager test message is chosen by an explicit detail token, not by matching text, and a test is shared between presses and has a body limit (medium); stale test results are cleared when the list is read again or a model is chosen (low); the circular import is gone (low). Not changed: any 404 on chat is reported as a missing model, including a wrong base path (low); the stub's contract is checked for success and unreachable only (low); the host and port appear in a failure's words (the user's own address, no path or key) (low). No intent_gap or bad_plan.

## Verification

**Commands:** `pnpm typecheck`, `pnpm test`, `pnpm e2e` for the touched spec, `PROVENANCE_BASE=origin/main pnpm provenance`.
