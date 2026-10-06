---
title: 'Per-agent failure words with Retry: rejected key, usage limit, auth expired'
type: 'feature'
ticket: '9'
created: '2026-10-06'
status: 'built'
baseline_revision: 'bc2b102442bb2433bd3f6a3e02d91905461a698f'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'pinned'
lenses_ran: ['security', 'correctness']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-builds-with-other-agents/epic-builds-with-other-agents.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** When an agent cannot go on mid build (a rejected key, an expired sign in, its usage limit), the run ended `failed` with a generic sentence. Each agent says this its own way, and the person needs that agent's plain words and a way on.

**Approach:** A build's agent error that is a sign in or key problem (`auth_required`) or a usage limit (`usage_limit`) ends the run `blocked` with a new code each and the agent's own plain reason (its name and the key or limit it names, from its adapter's words, masked), never its raw error. Retry is the person's: nothing retries by itself, so a rejected key or a limit never loops. After a usage limit the run offers **Build again with** each other agent that can build, which is Reject and retry with that agent (a fresh copy, the first discarded).

## Boundaries & Constraints

**Always:** Plain words per agent, no raw error text in the UI, events or logs, no dashes. Retry keeps the run's agent. The other agent named must have a build runner. No token or cost is stored.

**Never:** No automatic retry or switch. No new way to carry a worktree to another agent (a session's agent is fixed for its life), so building again with another agent starts in a fresh copy.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Rejected key or expired sign in | agent fails -32000 | run blocked `auth_required`, the agent's reason, Retry | asked once |
| Usage limit | agent says its limit | blocked `usage_limit`, its reason, Retry, Build again with others | — |
| Build again with Codex | Reject and retry with agent | new run with it in a new copy, first rejected | an agent that cannot build: 400 |
| Other agent error | any other failure | failed, as before | — |

</frozen-after-approval>

## Code Map

- `packages/shared/src/build-runs.ts`, `builds.ts` -- the two blocked codes and words, `RejectBuildRequest.agent`.
- `packages/core/src/build-outcome.ts`, `builds.ts` -- the outcome from the session's error code and reason; reject with an agent.
- `packages/web/src/planning/build-run-panel.tsx`, `builds-api.ts` -- the words and Build again with.
- `tests/fixtures/fake-acp-agent.mjs` -- `FAKE_ACP_BUILD_FAIL`.
- `packages/server/test/build-conformance.test.ts`, `packages/web/test/build-run-controls.dom.test.tsx` -- the proofs, per agent.

## Tasks & Acceptance

**Execution:**
- [x] Codes, outcome mapping, reject with agent, UI, fake switches, per-agent tests.

**Acceptance Criteria:**
- Given each agent that builds, when it fails with a rejected key or a usage limit, then the run is blocked with that agent's words, asked once, Retry offered, and after a limit another agent can be chosen.

## Implementation Notes

Assumption change (Notes, question 10): the recommended default said building with another agent resumes in the same worktree; a session's agent is fixed for its life, so it is Reject and retry with that agent (a fresh copy). A model that does not exist and a sandbox that failed to start have no code of their own: they stay `failed` with the generic reason (the agents report them as ordinary errors, unverified until the live checks, which list each agent's exact failure words).

## Review Triage Log

One combined security and correctness review (an independent agent), loop 1; no blocker. Confirmed: the reason shown is the adapter's one fixed sentence (the agent's name and key label), never its raw error, masked and bounded again on the run; nothing retries by itself; the reject path goes through the same sandbox and plan checks. Fixed: building again with another agent is checked (the sandbox, the skill) before anything is discarded, so a refusal leaves the blocked run, its copy and its work as they were (tested); the usage limit sentence ends with the build's offer in a build, not the chat's (one sentence, two tails, in `build-runs.ts`; tested for every agent). Kept and documented: a plan that says built or blocked wins over an agent error code (a built plan is still verified, a halt carries the skill's own code). Noted: the sign in sentence has an arrow ("Settings → Agents"), which is not a dash.
