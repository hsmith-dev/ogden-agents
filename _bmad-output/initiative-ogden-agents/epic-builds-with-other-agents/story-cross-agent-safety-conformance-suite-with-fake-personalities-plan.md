---
title: 'Cross-agent safety conformance suite with fake personalities'
type: 'feature'
ticket: '4'
created: '2026-10-06'
status: 'built'
baseline_revision: 'c97da2ee7b40b5a31775fc4cbb551a16a2d95f12'
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

**Problem:** Each agent that builds needs the same safety guarantees, and nothing yet proves them for all agents with one set of cases, or notices an agent that builds with no row in it. Also E17-R5: a build whose skill cannot reach the agent in the worktree must be refused, not run without it.

**Approach:** One table-driven server test: a row per agent (Claude Code, Codex, Grok, Antigravity, each its fake personality) runs the same cases, and a test fails when an agent the server lists as able to build has no row. Add the missing behaviour the cases need: the build skill must be in the agent's own skill folder in the worktree (a plain refusal naming it), for every agent but the default.

## Boundaries & Constraints

**Always:** Every row runs: an attended build (a card per write, Ask only, the agent's skill syntax, only its own key), an unattended start (agents that take a sandbox build by core's rule with no card and the outside write refused; the others are refused and offered attended), a protected file never reaches a verified run, no sandbox means refused, a halt maps to its code, Stop kills the agent and its command, a missing skill is refused naming it. Limits count all agents together. Tests use fakes only.

**Never:** No weakening of any rule to pass a case. No real agent, keychain or network.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Skill missing | project lacks the skill in the agent's folder | 409 `plan_uncommitted`, message names `bmad-build-auto` | nothing written |
| Protected file | agent writes AGENTS.md | refused by the rule, or the end check fails the run | never verified with it |
| Two agents, limit 1 | Claude building, Codex asked | Codex queued | — |
| Unlisted agent | a new agent that builds, no row | the table test fails | — |

</frozen-after-approval>

## Code Map

- `packages/server/test/build-conformance.test.ts` -- the table and cases.
- `packages/core/src/build-start.ts`, `builds-types.ts` -- `skillReach` refusal.
- `packages/server/src/start-builds.ts`, `start.ts` -- the skill check from each agent's descriptor.
- `tests/fixtures/fake-acp-agent.mjs` -- `FAKE_ACP_BUILD_PROTECTED`.

## Tasks & Acceptance

**Execution:**
- [x] Skill reach refusal for the other agents; fixtures carry the skill.
- [x] The conformance table and the completeness test.

**Acceptance Criteria:**
- Given any agent that builds, when the cases run, then each passes; given a registered agent with no row, then the completeness test fails.

## Implementation Notes

Codex in `workspace-write` writes a protected file inside the worktree without asking (as the real sandbox), so the rule never sees it; the run's end check (`forbiddenChanges`) fails the run, which the suite pins as the backstop until the live checks show Codex's sandbox holds.

## Review Triage Log

One combined security and correctness review (an independent agent), loop 1. Fixed:

- High (the suite): the protected-file, halt, Stop and unattended cases returned early for the attended-only agents, so Grok and Antigravity got green with no coverage. Every row now runs each case, attended rows with their cards answered; the protected-file case asserts the call was refused (or, for Codex, which asks nothing in its workspace mode, that the run fails and cannot be approved); a timeout is set for the suite; the skill case asserts the code.
- Medium: the skill check failed open for an agent with no descriptor (now refused); a retry, resume or queued run with a worktree skipped it (`prepareContinue` checks again).
- Low: the check followed symlinks (now a regular file, `lstat`).
- Declined: a queued run is accepted and fails at dispatch if the skill is missing (the run says so in its reason; checking git's tree at enqueue is later); an agent editing the skill file in a kept worktree is stopped by the protected-name rule (`.agents`, `.claude`) and the end check.
