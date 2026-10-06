---
title: "The manager adapter: build the input from core's data, call structuredComplete, validate, repair once, honour the roster (epic 15)"
type: 'feature'
ticket: '15.4'
created: '2026-10-05'
status: 'in-review'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick-security', 'quick-correctness']
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

- [x] input builder and the real manager in core
- [x] manager source, roster rule, settings and status route
- [x] event record
- [x] server wiring, web states and the manager model setting
- [x] tests (15.1 table through the real adapter, contract, adversarial, architecture, e2e)

**Acceptance Criteria:**
- Given the fake server and the 15.1 table, the real manager yields each row's outcome.
- Given worker output saying to ignore the rules, no step changes; the input holds no key, file body or outside path; an oversize input is cut; a non-loopback endpoint without confirmation is refused before a call.
- Given a project whose manager role is a ready model, a goal becomes a plan from it; otherwise Orchestrate says which of the real states it is in.

## Implementation Notes

- Layering (AD-1): the real manager lives in core beside `LocalModels`, which already calls `LocalModelPort.structuredComplete`; core names no vendor and the architecture test E15 now covers `manager-input.ts`, `manager-source.ts` and `model-manager.ts` (no shell, file, agent or credential port, no Node module). Adapters hold only the port's OpenAI-compatible implementation, so `ManagerPort`'s contract (`packages/adapters/test/manager-port.test.ts`) runs on `createModelManager` over `createOpenAiLocalModel` and the fake server, with the memory fake kept for test hooks.
- Input (`manager-input.ts`, pure): reads only the named fields of `ManagerContext` (goal, project summary, ready workers and their chats, the plan so far, the last report), so file contents, diffs and credentials cannot reach it; every string is stripped of hidden characters, masked, scrubbed of absolute paths (`[path]`; with no project root given every absolute path goes, which is stricter than "outside the project") and has its `<<<` and `>>>` runs shortened; the goal, project text and worker output sit between `<<<DATA name` and `>>>` and the system text says they are never instructions (guidance only: the rules are checked in code). Budget: half of the endpoint's reported context in tokens, three characters per token, counting the system text, the prompt and the schema sent with it; default context 4096 tokens when the server reports none. Over budget, five levels cut the worker report first, then project text, plan instructions and the chat lists; if the least level does not fit the call is refused `context_too_small` before anything is sent. The answer's own token cap is the other half, up to 4096 for a plan and 512 for a decision.
- Call (`model-manager.ts`): `LocalEndpoints.target(id)` first (an unconfirmed host is `host_not_confirmed`, a removed or absent endpoint `endpoint_missing`, anything else `unavailable`), then the reported context (`createContextReader`, `listModels` cached five minutes per endpoint and model; a server that does not say counts as unknown), then `structuredComplete` with the shared JSON schema, schema names `manager_plan` and `manager_decision`, no tools. One deadline (90 s) covers the call and its repair.
- Repair, with no doubling: `structuredComplete` already walks json_schema, json_object, prompt and repairs once when the answer is not JSON or breaks the schema subset, so a `bad_answer` from it is final here. After a shape the schema accepted, `validatePlanFor` and `validateDecisionFor` check what a schema cannot say (a ready worker, step and chat references, links, text rules, secrets, a step of the plan). A broken rule gets exactly one more ask whose prompt is the same prompt plus "Your last answer was not accepted. <plain reason of the rule> Reply again with only the corrected JSON."; the model's own text is never echoed back. So the worst case is two asks inside `structuredComplete` plus one more call with up to four requests (bounded by the shared deadline).
- Failure words: `MANAGER_FAILURE_WORDS` in core (malformed, off roster, too large, too slow, context too small, host not confirmed, endpoint missing, unavailable) are ours; the server's own reason text and address are never passed on. `endpoint_missing` is new (`MANAGER_FAILURE_KINDS` moved to shared). A refusal by the JSON schema subset (an extra field, a mode above Ask) has no rule code because `structuredComplete` does not give the reply back; it is `malformed` with the shape sentence. The rule codes are exact for what the schema cannot say. Both are tested against the 15.1 table.
- Reply cap: the adapter reads at most 256 KiB (`STRUCTURED_MAX_BYTES`), tested equal to `MANAGER_LIMITS.maxReplyBytes`; larger is `too_large`.
- The record: `ManagerResult` carries an optional `ManagerRecord` (call, outcome, how the server was asked, whether it was repaired, failure kind, rule code, the answer as masked JSON text capped at 4000 characters). Core's `startRun` appends it as the new `orchestration.manager_replied` event for the run (masked again), on success and on refusal, in the same transaction as the plan or the failed run. The prompt, key and address are never recorded. The memory fake leaves no record.
- Per project (`manager-source.ts`): the manager is the roster's `manager` assignee read each time. It must be a model (`kind: model`); the settings use-case now refuses an agent as the manager (400, "The manager must be a model on one of your servers, not an agent.") and any model on a server that does not exist ("Choose a model on a server you have set up."), which is the roster endpoint check deferred from 15.2. Status is `ready` (the endpoint exists and is confirmed or on this computer; whether the model passed "Test as a manager" is the roster story's, 15.5), `not_chosen`, `endpoint_missing` or `host_not_confirmed`, in plain words, and `GET …/orchestration` carries it as `manager` beside `managerReady`. `Orchestration.managerStatus(workspaceId)` replaces `managerReady()`; a start with a manager that is not ready stores nothing and answers 409 `manager_unavailable` with that state's words. A test-hook or test `manager` still wins for every project (the memory fake).
- Minimal manager model setting (the roster story 15.5 had not landed): the existing roster key `orchestrationRoster.manager` is the setting (a `TeamAssignee` of kind `model`), kept compatible with `TeamRoster`; the project's settings page, under Orchestration, lists the user's servers with where each runs, reads a server's models on request and saves the choice without touching the other roles. 15.5 replaces it with the full roster screen.
- Orchestrate page: the tracer's "no manager yet" is replaced by the three real states and, when ready, a caption saying which model runs where (this computer or another one). The page reads the manager state again when the project's settings or the servers change.
- `decideNext` is built and tested (the table's decision rows pass) but nothing calls it until the loop (15.8 and 15.9).
- Tests: core `manager-input` (10), `model-manager` (28), `manager-source` (10), settings (manager role), adapters `manager-port` (the contract on the real adapter, the 15.1 table through it, the adversarial cases through a spying fetch), server `orchestration-manager` (7), web DOM (manager states and picker), Playwright (a model chosen in settings makes a plan).

## Spec proposals

Written to the memlogs with `_bmad/scripts/memlog.py` (never to the frozen documents): the spec memlog gets a CAP-22 protocol note (the manager's input, caps, repair and failure kinds), the architecture memlog gets the thirteenth `orchestration.*` event (`orchestration.manager_replied`, no migration) and the AD-1 note for the real manager. `covers` stays empty.

## Plan Change Log

None yet.

## Review Triage Log

2026-10-05, security and correctness reviewers (2 lenses), no critical or high findings. Patched: absolute paths in URL form (`file:///...`, `vscode://...`), after a colon (`cwd:/...`) and home folders with spaces or non-ASCII names reached the prompt (medium), now scrubbed (a home folder goes to the end of the line), with tests; the endpoint's reported context was cached five minutes so a retry after "load a larger context" failed again (medium), now forgotten when a call ends `context_too_small`, and a failed read is remembered only briefly; one server reports a model's trained maximum, so "half the context" never applied (medium), no reported context is believed beyond 16384 tokens; the budget covered only the first request, while the adapter's repair and ours add text (medium), 1500 characters are now kept free; the budget counted one character as one third of a token for every script (low), a character outside ASCII now costs a whole token; the context read ignored the call's cancel and deadline (low), now bounded to 10 seconds and cancellable; the plan so far was not fenced in a decision prompt (low), now a data block with instructions on one line; the recorded answer was masked after JSON escaping, which could hide a multi line secret (low), now each string value is masked first; choosing a manager before the settings loaded could overwrite the other roles with none (low), the buttons wait for the settings; the new endpoint check blocked a manager change when another role held a model on a removed server (low), now only changed roles are checked; a stray empty file `orkspace-settings.ts` removed. Not changed: a deadline that passes after a rule failure reports the rule failure, not too slow (low, the user's action is the same); a bare slash route in a goal such as `/api/v1/users` is read as a path and masked (low, harmless); local endpoints are install wide so any project may name any of them, with the confirmation per endpoint, so no bypass (info).

## Verification

**Results:** `pnpm typecheck` clean; `pnpm test` 310 files, 3823 passed, 8 skipped; Playwright `orchestrate` (3) and `local-endpoints` passed; `pnpm provenance` passes.

**Commands:** `pnpm typecheck`, `pnpm test`, `pnpm e2e` (the `orchestrate` spec), `PROVENANCE_BASE=origin/main pnpm provenance`.
