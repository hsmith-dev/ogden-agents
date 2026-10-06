---
title: 'Tracer bullet: one ticket built by a second agent against its fake personality, end to end'
type: 'feature'
ticket: '2'
created: '2026-10-06'
status: 'built'
baseline_revision: '0b57462d2357df4127ee3b939d1cb50331981b65'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'pinned'
lenses_ran: ['security', 'correctness']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-builds-with-other-agents/epic-builds-with-other-agents.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-builds-with-other-agents/spike-can-ogden-run-a-safe-headless-build-over-acp-with-codex-grok-and-antigravity-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Builds are Claude Code only behind the run's `agent` field: one runner, the session's agent fixed to the runner's, and a start that refuses any other agent. Spike 17.1 showed every other agent refuses a sandboxed build today (fail closed) and that core's one permission policy already handles their request shapes.

**Approach:** The thinnest agent-neutral path with Codex (the spike's go agent): a runner per agent found by the run's agent, the build session started with the run's agent and Codex's own `$` skill syntax, and an unattended start for agents that take their sandbox through their own start (`buildSession` quirk), refused until verified. Attended Codex builds work now; unattended Codex stays off until the user's live checks.

## Boundaries & Constraints

**Always:** Core names no agent. A request's agent with no runner is refused (`UNKNOWN_BUILD_AGENT_MESSAGE`). A session without a verified build quirk and with a sandbox is refused (`agent_unavailable`): fail closed. An unattended Codex build starts only when its `unattendedVerified` is on (default off, `CODEX_UNATTENDED_VERIFIED`). A build start's session is Ask to core and takes no other mode; no Skip all, `agent-full-access` or `danger-full-access` is ever set. Core's policy answers every request that reaches it. Claude Code's flows and tests are unchanged. Tests use fakes: no real agent, keychain, network or `~/.codex`.

**Never:** No Grok, Antigravity, picker, default build agent or failure words (entries 3 to 9). No weakening of protected paths, no network, or locked settings.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Attended Codex | `agent: codex, mode: attended` | session agentId codex, `$bmad-build-auto ticket 1.1`, a card per write, ends verified | — |
| Unattended Codex, unverified | sandbox available | start refused, nothing built | run not verified |
| Unattended Codex, verified (test) | fake sandbox | workspace-write at start, run roots as added directories, rule refuses the write outside, ends verified | — |
| Agent with no runner | `agent: grok` | 400, `UNKNOWN_BUILD_AGENT_MESSAGE` | nothing written |
| No agent named | old request | Claude Code, as before | — |
| Reject and retry | rejected Codex run | builds again with Codex | — |

</frozen-after-approval>

## Code Map

- `packages/core/src/build-context.ts` -- `runnerFor`, `runnerOf` (the registry lookup).
- `packages/core/src/build-start.ts`, `build-dispatch.ts`, `build-outcome.ts`, `builds.ts` -- the session agent, invocation, halt codes and result read by the run's agent; reject and retry keeps the agent.
- `packages/adapters/src/buildrunner-acp/index.ts` -- `createAcpBuildRunner({agent, command})`, `createCodexBuildRunner`.
- `packages/adapters/src/acp-base/{quirks,acp-agent,fixed-mode}.ts` -- `AcpBuildSessionQuirk`, the build start.
- `packages/adapters/src/acp-codex/codex-agent.ts` -- Codex's build quirk and the gate.
- `packages/server/src/start-builds.ts`, `start-types.ts` -- the runners wiring slot.
- `tests/fixtures/fake-acp-agent.mjs` -- `$bmad-build-auto`, Codex workspace-write behaviour.

## Tasks & Acceptance

**Execution:**
- [x] Core: runner registry lookup by agent; session, invocation, halts and result by run agent; reject keeps agent.
- [x] Adapters: parametrized runner, Codex runner; `buildSession` quirk and fixed build start; Codex quirk, gated.
- [x] Server wiring slot; fake agent additions.
- [x] Tests: `build-codex.test.ts` (attended, unattended verified, fail closed, unknown agent), `acp-codex.test.ts`, `build-adapters.test.ts`.

**Acceptance Criteria:**
- Given Codex, when an attended build is started with `agent: codex`, then the run and session name Codex, the prompt uses `$`, and the run ends verified.
- Given Codex unverified, when an unattended build starts, then no Codex work happens; given verified (a test), it starts in workspace-write with the run roots and core's rule refuses the outside write.
- Given an agent with no runner, when started, then it is refused and nothing is written.

## Implementation Notes

Live check result: none yet. The unattended Codex gate stays off until the user's live checks 1 to 3 (RELEASING.md, entry 11). In `workspace-write` an edit in the workspace asks nothing, so core's rule never sees it: the sandbox must keep the protected paths, which only a real Codex can show. The run's end check `forbiddenChanges` (protected files changed in the branch) stays the detective backstop.

## Review Triage Log

One security review and one correctness review (independent agents), loop 1. Fixed:

- Security, high: an attended build of an agent with no attended tier could start in the project's default mode (Auto, Skip all): a build session is now always created in Ask (`chat/workspaces.ts`), for every agent.
- Security and correctness: the unattended session's real mode was hidden behind the reported Ask. Now the session must open in the build's mode (checked on new, resume and load, and fail closed when the agent lists none), and an agent that moves itself out of it is stopped (`acp-agent.ts`). The build start's variable now wins over core's environment.
- Security: the sandbox check ignored the agent. The server's sandbox answer is per agent (`AgentPort.unattendedBuild`): an agent that cannot take the sandbox at start, or is not verified, is refused `sandbox_unavailable` with attended offered, before anything is written.
- Correctness: Build all ready ignored the requested agent (now kept with the workspace's drain); a run whose agent has no runner fell back to Claude Code's runner (now refused, `NO_BUILD_RUNNER_MESSAGE`).
- Carried (deferred-work): Codex's sandbox is not given the deny lists and is unverified, so unattended Codex stays off until the live checks; the sandbox status route is the default agent's (entry 8).
- Declined as low: the dead check in `open()` (harmless), the fake's prefix slice (same length, commented).
