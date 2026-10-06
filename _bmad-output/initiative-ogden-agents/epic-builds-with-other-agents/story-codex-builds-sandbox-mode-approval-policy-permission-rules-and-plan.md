---
title: 'Codex builds: sandbox mode, approval policy, permission rules and skills in the worktree'
type: 'feature'
ticket: '5'
created: '2026-10-06'
status: 'built'
baseline_revision: 'a847f3fbdac7d943ab10f83f8c38d76450bec9f7'
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

**Problem:** Codex is the one agent the user cleared for unattended builds, conditional on live checks (user 2026-10-06). The tracer built its start; what remains is Codex's own words for why it builds with the user watching until the checks pass, a guard against a start with nothing to give, and proof that a build leaves Codex's config and key handling as chat has them.

**Approach:** Codex's build quirk, its gate and runner stay as the tracer made them; add the plain reason the picker shows (`AgentPort.attendedOnlyReason`, from the quirk, used by the server's per-agent sandbox answer), refuse a build start with no writable root, and test the key and config.

## Boundaries & Constraints

**Always:** `CODEX_UNATTENDED_VERIFIED` stays `false`: the user's live checks flip it, never a story. While off, an unattended Codex build is refused with Codex's own reason and an attended build is offered. Never `agent-full-access`, `danger-full-access`, Auto or a mode that skips core's rule. The key is only in Codex's process as `CODEX_API_KEY`; the config stays chat's (ephemeral credentials, plugins off, no key, no looser mode). New copy has no dashes.

**Never:** No flipping the gate. No change to the sandbox's deny lists (Codex cannot take them; the live checks decide).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unattended, unverified | any sandbox | 409 `sandbox_unavailable` with Codex's reason, attended offered | nothing written |
| Picker | unverified | Codex attended only with its reason | — |
| Build start, no writable root | empty roots | refused `agent_unavailable` | nothing started |
| Config after a build start | verified (test) | `config.toml` equals chat's, no key | — |

</frozen-after-approval>

## Code Map

- `packages/core/src/agent-port.ts`, `adapters/src/acp-base/{quirks,acp-agent}.ts` -- `attendedOnlyReason`.
- `packages/adapters/src/acp-codex/codex-agent.ts` -- reason, empty roots guard.
- `packages/server/src/start-builds.ts`, `start.ts` -- the per-agent reason in the sandbox answer.

## Tasks & Acceptance

**Execution:**
- [x] Reason plumbing and Codex's words; empty roots refused; tests.

**Acceptance Criteria:**
- Given Codex unverified, when an unattended build is asked or the picker is read, then Codex's own sentence is shown and attended is offered.

## Implementation Notes

Live check result: none yet; these are the user's, recorded in RELEASING.md by entry 11 and in the spike plan: (1) start the pinned adapter with `INITIAL_AGENT_MODE=workspace-write`, the key in the environment and the worktree as an added directory; write inside the worktree (no card), outside it, in `.git/hooks` and `AGENTS.md`, and try a network command, and record what asked, failed or succeeded; (2) confirm `$bmad-build-auto ticket <ref>` loads from a committed `.agents/skills` in a worktree; (3) `git add` and `git commit` inside the sandbox with the gitdir and the run's object store as added directories (does `.git` stay read-only?). If all hold (protected paths and the credential folders unwritable and unreadable by Codex's commands, a commit works), the user flips `CODEX_UNATTENDED_VERIFIED`; otherwise Codex stays attended only. Known limit: in workspace-write an edit inside the workspace asks nothing, so only Codex's sandbox and the run's end check (`forbiddenChanges`) stand between it and a protected file.

## Review Triage Log

One combined security and correctness review (an independent agent), loop 1; no blocking finding, fail closed holds. Fixed: Codex's reason is only set while it is unverified; a test pins the gate (an unverified Codex refuses a start with a sandbox and spawns nothing); a misplaced comment moved. Noted: `unattendedBuild !== false` in the server treats an agent that says nothing as capable (unchanged from 17.3, with the start path refusing it anyway).
