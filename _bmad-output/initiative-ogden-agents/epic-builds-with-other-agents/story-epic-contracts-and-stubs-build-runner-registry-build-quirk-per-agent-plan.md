---
title: 'Epic contracts and stubs: build runner registry, build quirk, per-agent sandbox check, wiring slots and build personalities'
type: 'feature'
ticket: '3'
created: '2026-10-06'
status: 'built'
baseline_revision: 'b0881af98295baa4467144116de9113c83e8ba95'
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

**Problem:** The tracer (17.2) proved the seam with Codex only. The lanes (Codex, Grok, Antigravity) and the picker need the shared shapes frozen so each touches only its own files.

**Approach:** Freeze what is shared: the picker's contract (`GET build-agents`: each agent that can build, and unattended, attended only or unavailable, with a plain reason), a guard that no build start may name a switch that skips a permission decision, a runner for each of the three agents wired by default (only registered agents are offered; Grok and Antigravity build attended only because neither takes a sandbox at start), and the run's agent carried everywhere (done in 17.2).

## Boundaries & Constraints

**Always:** Core and shared name no agent (the new shapes are agent-neutral). Only agents registered in the server are listed or accepted. An agent that cannot take the build's sandbox at start, or is unverified, is `attended_only` and its unattended start is refused. A build start naming Skip all, always-approve, yolo, full access, Auto, `auto_edit` or folder trust off is refused. Claude Code's flows and tests are unchanged.

**Never:** No picker UI, project default or failure words (entries 8, 9). No new modes for any agent.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| List, sandbox here | Claude Code and Codex wired | Claude unattended; Codex attended only with its reason | — |
| List, Codex verified | test switch on | Codex unattended | — |
| List, no sandbox | none | every agent attended only, the machine's reason | — |
| List, no key | Codex without key | Codex unavailable, says what to do | — |
| Forbidden switch | a build start naming `yoloMode` | refused `agent_unavailable` | nothing spawned |
| Feature off | builds piece off | 409 `feature_off` | — |

</frozen-after-approval>

## Code Map

- `packages/shared/src/builds.ts`, `api.ts` -- `BuildAgentChoice`, `BuildAgentsResponse`, route.
- `packages/core/src/builds.ts`, `builds-types.ts` -- `buildAgents`.
- `packages/server/src/build-routes.ts`, `start-builds.ts` -- route; the three runners.
- `packages/adapters/src/buildrunner-acp/index.ts` -- Grok and Antigravity runners.
- `packages/adapters/src/acp-base/fixed-mode.ts`, `acp-agent.ts` -- forbidden switch guard.

## Tasks & Acceptance

**Execution:**
- [x] Shared contract and route; core use-case; server route.
- [x] Runners for Grok and Antigravity, registered by default.
- [x] Forbidden switch guard and tests.

**Acceptance Criteria:**
- Given agents wired here, when the picker's list is read, then each says unattended, attended only or unavailable with its reason, and unregistered agents are absent.
- Given a build start naming a forbidden switch, when a session starts, then it is refused.

## Implementation Notes

Most of entry 3's description (registry, build quirk, per-agent sandbox check, the run's agent through Retry and Quit) landed in 17.2's tracer because the tracer needed it; this entry adds the rest. The fake personalities' failure switches (rejected key, usage limit, expired sign-in) are entry 9's, and the conformance table is entry 4's.

## Review Triage Log

One security review and one correctness review (independent agents), loop 1. Fixed:

- Both: the forbidden-switch guard matched substrings of the whole start, so a project path such as `yolo-app` failed every unattended Codex build, and it missed variants (`auto-edit`, `dangerFullAccess`, `full_access`, `acceptEdits`). It now compares words with punctuation and case removed, skips `additionalDirectories` (paths), checks keys only when they are turned on (`yoloMode: false` passes), and has tests for each.
- Correctness: the route tables in `gate.test.ts` and `bmad-guard-coverage.test.ts` listed no `build-agents`; added. A feature off test was added.
- Declined (low): `unattendedBuild !== false` in the server stays fail-open for a port that says nothing (a test's own Claude Code agent), because the start path refuses an agent that cannot take the sandbox anyway (two independent layers, checked); one machine probe per listed agent is light and the machine answer is cheap.
- Noted: `needsProjectTrust` agents show as unavailable in the picker under the chat trust rule; builds apply the same trust, so this is as intended.
