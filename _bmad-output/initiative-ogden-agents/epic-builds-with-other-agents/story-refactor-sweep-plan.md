---
title: 'Refactor sweep'
type: 'refactor'
ticket: '10'
created: '2026-10-06'
status: 'built'
baseline_revision: '06cee448ce74754f54bdb4f415c31d1326870a72'
route: 'oneshot'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['security', 'correctness']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-builds-with-other-agents/epic-builds-with-other-agents.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 17 grew two files that mix concerns: the shared ACP client's `open()` (the fail closed checks of an unattended build start sat inline in a file near 800 lines) and the server's builds wiring (the per-agent sandbox answer sat inside it).

**Approach:** Behaviour-preserving moves, no requirement covered: the build start preparation into `acp-base/build-start.ts` (`prepareBuildStart`, same checks in the same order) and the per-agent sandbox into `server/src/build-agent-sandbox.ts`. The epic's open review items are indexed in deferred-work.

## Boundaries & Constraints

**Always:** No behaviour test changes; the full suite, the conformance suite and the typecheck pass unchanged. Fail closed order is kept: no way to take the sandbox, then not verified, then the start, then the forbidden switch check, all before anything is spawned.

**Never:** No new behaviour, no new rule, no copy change.

## Code Map

- `packages/adapters/src/acp-base/build-start.ts`, `acp-agent.ts` -- `prepareBuildStart`.
- `packages/server/src/build-agent-sandbox.ts`, `start-builds.ts` -- `createPerAgentSandbox`.
- `_bmad-output/initiative-ogden-agents/deferred-work.md` -- the epic's open items.

## Tasks & Acceptance

**Execution:**
- [x] Move the two pieces; index the epic's open review items.

**Acceptance Criteria:**
- Given the suite as it was, when it runs, then it passes with no behaviour test changed.

## Implementation Notes

Open review items carried (deferred-work): Codex's sandbox is not given the run's deny lists and is unverified (17.2; the live checks decide); a build queued behind a limit is accepted and fails at dispatch if the other agent's skill is missing (17.4); the server treats an agent whose port says nothing about unattended builds as able (the start path still refuses it). The default build agent falling back to the chat default is in 17.8's notes for the release.

## Review Triage Log

(filled after the review)
