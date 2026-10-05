---
title: 'Ask-only modes, safe defaults and the terminal toggle only if the route supports it (epic 14)'
type: 'feature'
ticket: '14.7'
created: '2026-10-05'
status: 'in-review'
route: 'oneshot'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick-security', 'quick-correctness']
review_loop_iteration: 0
baseline_revision: '5227b128ff596e92ac46357873068e2953dc811b'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-local-models/epic-local-models.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Local model must offer Ask only, and the picker must say why Auto and Skip all are unavailable in plain words; the terminal toggle must appear only where the route's own CLI is known to resume the session.

**Approach:** The descriptor declares Ask as its only mode and fixes it at start (14.2), so the server refuses Auto and Skip all, even with Developer mode on. A new optional descriptor sentence, `modesNote`, is appended to "<agent> doesn't offer <mode>." so the picker says why. A project and a new chat default to Ask (every agent's start). The terminal toggle stays `agent_unsupported`: spike 14.1 saw the harness CLI list the ACP sessions (one shared database) but did not run `opencode --session <id>` (it needs a terminal), so it is a live check and the matrix row records it.

## Boundaries & Constraints

**Always:** the reason is plain words with no dash; a Claude Code chat in the same project keeps its own modes.

**Never:** offering Auto or Skip all for the Local model; a terminal toggle before the live check passes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Direct API, Auto or Skip all | Developer mode on | 409 `mode_unavailable` | n/a |
| Picker | Local model chat | both unavailable, reason with the note | n/a |
| Claude Code chat, same project | n/a | its own modes | n/a |
| Terminal | Local model chat | `agent_unsupported` | n/a |

</frozen-after-approval>

## Code Map

- `packages/core/src/agent-descriptor.ts`, `packages/core/src/chat/permission-mode.ts` -- `modesNote` and its use in the reason.
- `packages/adapters/src/setup-local/descriptor.ts` -- the Local model's note.
- Tests: `packages/server/test/local.test.ts` (picker reasons, Claude Code's modes, refusals, terminal), `packages/adapters/test/local-descriptor.test.ts`.

## Tasks & Acceptance

- [x] descriptor note and the reason
- [x] tests: refusal, picker reason, Claude Code unchanged, terminal

**Acceptance Criteria:**
- Given a direct API call asking for Auto or Skip all on a Local model chat, it is refused with the declared-mode error; the picker shows both unavailable with the reason; a Claude Code chat in the same project keeps its modes; the terminal toggle is unsupported, as the matrix proposal says.

## Implementation Notes

Oneshot on 14.2's declared modes. The matrix row (a memlog proposal, merged with the go decision) says the terminal toggle is offered only where `opencode --session <id>` works, a live check listed for the user.

## Plan Change Log

## Review Triage Log

## Verification

**Commands:** `pnpm typecheck`, `pnpm test`.
