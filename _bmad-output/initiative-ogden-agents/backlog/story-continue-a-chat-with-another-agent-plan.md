---
title: 'A chat continues with another agent when its agent hits a usage limit'
type: 'feature'
ticket: '2'
created: '2026-10-04'
status: 'in-review'
baseline_revision: '2e4d68f8befaae014c336abffc3e7f5b1fc7d984'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'security']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/backlog/story-continue-a-chat-with-another-agent.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** When a chat's agent hits its usage limit the chat is stuck until the cooldown ends; the user can't carry the conversation to another installed agent (user request, 2026-10-04). A session's agent is fixed at creation (E6-R1), and a limit is just a generic error.

**Approach:** Each descriptor lists usage-limit patterns; the shared ACP client turns a failed prompt matching them into the error code `usage_limit`. A new core use-case hands a chat to another agent: it builds a bounded, masked brief from the stored events with no model call, the user previews and edits it in a dialog that names the receiving provider, and on confirm core switches the session's agent in place (`session.agent_changed`, with the brief), carries the permission mode when the target declares it (else Ask, cause `handoff`), keeps each agent's own session ref so switching back resumes it, and sends the user's first message primed with the brief.

## Boundaries & Constraints

**Always:**
- Ticket criteria 1–8 are the acceptance bar. Refusals append nothing: terminal drives (409 `driver_is_terminal`), working / waiting / switching / busy (409 `session_not_idle`), same or unknown agent (400), not trusted / not installed / signed out (409 `AgentNotReadyError` codes), brief over the target's budget or empty message (400).
- Brief: built only from the session's stored events; project path, first user message as the goal, messages newest-first within the budget (older ones cut to a first line, then counted), completed tool-call titles and changed file paths (names only), no pending or unanswered permission request; `redactApiKeys` plus generic token patterns on the preview and again on the submitted brief and message. Budget = target descriptor's `handoffBudgetChars`, default 60 000, hard cap 200 000.
- Events back-compatible (AD-5): new `session.agent_changed` type; new optional values (`usage_limit` error code, `handoff` mode cause); old sessions read unchanged. Core and shared name no agent; acp-base names no agent or provider.
- Tests never run real agents, the keychain, the network, or read the real `~/.claude`/`~/.gemini`; the fake ACP agent simulates the limit; any test hook only through `testHooksAllowed`.

**Never:** no automatic switch or send without the user's confirmation; no model call to summarize; no file contents or diffs in a brief; no change to how a chat picks its agent at creation, the default agent, permission cards, Skip all's gate, the terminal toggle, or the child-env allowlist.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Limit hit | prompt fails, text matches a descriptor pattern | state `error`, `errorCode: usage_limit`, notice offers handoff | other failures unchanged |
| Preview | idle/error chat, target agent | brief ≤ budget, masked, provider named, resulting mode + note | refusals as above |
| Handoff | brief (edited), message | `agent_changed` + optional mode change; first prompt = brief + message | brief too long / empty message → 400 |
| Mode fallback | chat in Auto → agent without Auto | Ask, cause `handoff`, reason stated in dialog | — |
| Switch back | A→B→A | A reopens its own session; brief only since A left | resume fails → transcript primer + brief |
| Restart before first prompt | pending brief | next message still carries brief | — |

</frozen-after-approval>

## Code Map

- `packages/core/src/agent-descriptor.ts` -- add `usageLimitPatterns?: readonly RegExp[]` (no `g`/`y` flag, checked in `agentDescriptorProblems`) and `handoffBudgetChars?`.
- `packages/core/src/agent-port.ts` -- `AgentErrorCode` gains `usage_limit`.
- `packages/adapters/src/acp-base/acp-agent.ts` (`prompt` catch ~L519) -- match raw error message/data against the descriptor's patterns → `AgentError('usage_limit', reasons.usageLimit)` and `setState('error', …, 'usage_limit')`; `quirks.ts` `acpReasons` gains `usageLimit`.
- `packages/adapters/src/setup-claude-code/descriptor.ts`, `setup-antigravity/descriptor.ts` -- patterns and budgets.
- `packages/shared/src/events-common.ts` (`SESSION_ERROR_CODES`), `events-session.ts` (`PERMISSION_MODE_CHANGE_CAUSES` + `session.agent_changed` schema), `events.ts` (unions), `entities.ts` (Session.agentId doc), `secret-patterns.ts` (`redactSecrets`: API keys + generic tokens), `chat.ts` (handoff request/response schemas), `api.ts` (`sessionHandoff` route).
- `packages/core/src/entities.ts` -- `setSessionAgent` (one transaction: agent_id, refs, event; returns event seq) and `listSessionEvents(sessionId, types)`.
- `packages/core/src/handoff-brief.ts` (new) -- pure `buildHandoffBrief`.
- `packages/core/src/chat/handoff.ts` (new) -- `handoffPreview`, `handOff`; reuse `unavailableReason`, trust/readiness from `chat/workspaces.ts` (export the helpers), `releaseAgent` from `chat/agents.ts`, `turns.sendMessage`.
- `packages/core/src/chat/agents.ts` `promptFor` + `chat/turns.ts` `runTurn` -- prepend a pending brief (`HANDOFF_PENDING_REF`), clear it once a prompt succeeded; `turns.fail` passes `usage_limit` as `errorCode`.
- `packages/core/src/chat/constants.ts` -- per-agent ref keys, pending ref.
- `packages/core/src/chat.ts`, `chat/types.ts` -- expose `handoffPreview`, `handOff`.
- `packages/server/src/chat-routes.ts` -- `GET`/`POST` `API_ROUTES.sessionHandoff`.
- `packages/web/src/chat/transcript.ts` -- `agent_changed` item, per-message `agentId`; `transcript-parts.tsx` divider; `chat/handoff-dialog.tsx`, `chat/handoff-api.ts`, `chat/session-menu.tsx` (new); `routes/session-page.tsx` wiring; `workspaces/workspace-api.ts` folds `agent_changed`.
- `tests/fixtures/fake-acp-agent.mjs` -- `usage-limit` keyword.

## Tasks & Acceptance

**Execution:**
- [ ] shared + core contract: schemas, descriptor fields, error code, entities methods -- the frozen shapes the rest builds on.
- [ ] `packages/core/src/handoff-brief.ts` + `packages/core/test/handoff-brief.test.ts` -- budget, ordering, masking, names only, pending permissions dropped, since-seq.
- [ ] `packages/core/src/chat/handoff.ts` + prime in `agents.ts`/`turns.ts` + `packages/core/test/agent-handoff.test.ts` -- switch, refusals append nothing, mode carry/fallback, trust, switch back resumes, restart keeps pending brief, usage_limit code.
- [ ] acp-base detection + descriptors + fake keyword + adapter test.
- [ ] server routes + `packages/server/test/handoff.test.ts`.
- [ ] web: fold, divider, labels, menu, dialog, notice action + dom/unit tests.
- [ ] `tests/e2e/handoff.spec.ts` -- limit → offer → dialog discloses provider → confirm → divider, second agent answers with the brief; switch back.
- [ ] docs: EXPERIENCE.md handoff, agent-matrix limits, architecture AD-8 note + `.memlog.md`, CHANGELOG.

**Acceptance Criteria:**
- Given the full suite, when `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm run pack && pnpm smoke` run, then all pass and `tests/architecture.test.ts` stays green.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Design Notes

Brief shape (plain text, the target reads it as context, then the message):

```
[Ogden Agents] Handoff: this chat was with Claude Code until now; you are continuing it.
Project folder: /repo
Original goal: <first user message, ≤1 000 chars>
Files changed: src/a.ts, src/b.ts
Actions taken: Edit src/a.ts; Run npm test; …
Conversation (oldest first; 4 earlier messages left out):
User: …
Claude Code: …
[Ogden Agents] New message:
<message>
```

Agent names come from the registry at build time (core names none). Per-agent refs `agentSessionId@<agentId>` and `handoffLeftAt@<agentId>` keep each agent's own session and where it left; `AGENT_SESSION_REF` always holds the current agent's.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors
- `pnpm test` -- expected: all pass, architecture test green
- `pnpm e2e` -- expected: all pass, `handoff.spec.ts` included
- `pnpm run pack && pnpm smoke` -- expected: pass
