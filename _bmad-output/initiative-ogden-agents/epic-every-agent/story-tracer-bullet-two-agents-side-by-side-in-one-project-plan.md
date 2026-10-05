---
title: 'Tracer: a second agent chat beside a Claude Code chat in one project'
type: 'feature'
ticket: '2'
created: '2026-10-03'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
baseline_revision: '9daf6eae1c88a36dde32470c815c39ab7e00f09d'
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-every-agent/epic-every-agent.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Ogden wires exactly one `AgentPort`, a session has no agent, and the web names Claude Code by constant, so a project cannot hold chats with two different agents (E6-R1, E6-R2).

**Approach:** A session carries `agentId` (set at creation, never changed; rows and `session.created` events from before read as the install's original agent, Claude Code), server wiring builds a registry of `AgentPort` by `AgentId` that core looks up per session, and a bare picker on a project's Chats page starts a chat with either agent. The second agent is the fake ACP agent, registered only by tests (user, 2026-10-02: no Antigravity code here; that is entry 5).

## Boundaries & Constraints

**Always:** core and shared name no agent id outside tests (an architecture test enforces it); the agent id is fixed at creation; each agent's declared permission modes bound its chats' mode options and the server refuses others; each agent's process gets only its own API key (`agentEnv(agentId)`); the picker shows only when more than one agent is registered, so a shipped install (Claude Code only) looks unchanged; tests never run real claude/antigravity, the keychain, the network, or the real `~/.claude`.

**Never:** no Antigravity adapter, wiring slot or pins; no per-project default agent (entry 6); no change to `AgentPort`'s methods or to the shared ACP client (entry 4); no new environment test hook (the second agent comes only through `start()` options); no sweep of every Claude-specific UI string (entry 9).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New chat, agent chosen | `POST sessions { kind:'chat', agentId:'fake-agent' }` | 201, session `agentId` stored, in `session.created` | — |
| New chat, no agent | `POST sessions {}` | session gets the registry default (Claude Code) | — |
| Unknown agent | `agentId` not registered | 400 `agent_unknown`, nothing created | plain reason |
| Legacy row/event | `agent_id` NULL, event without `agentId` | reads as the registry's legacy agent (Claude Code) | — |
| Agent gone | stored agent not registered this run | message refused as `agent_unavailable` error state | plain reason |
| Mode not declared | fake agent declares Ask + Skip all; `PUT mode auto` | 409 `mode_unavailable`; option listed unavailable with reason | — |
| Two agents at once | one chat each, both prompted | each reaches its own agent, both `working` together | — |

</frozen-after-approval>

## Code Map

- `packages/shared/src/entities.ts` -- `Session` gains `agentId: AgentId.optional()` (absent only in pre-epic events).
- `packages/shared/src/chat.ts` -- `CreateSessionRequest` gains optional `agentId`; new `ChatAgent` / `ChatAgentsResponse` (`agentId`, `displayName`, `permissionModes`; `defaultAgentId`).
- `packages/shared/src/api.ts`, `errors.ts` -- route `chatAgents` (`GET /api/v1/chat-agents`), code `agent_unknown`.
- `packages/core/src/db/schema.ts` + `drizzle/0007_session_agent.sql` + meta -- nullable `agent_id` (no SQL default: core names no agent).
- `packages/core/src/entities.ts` -- `NewSession.agentId`, `toSession` adds it when set.
- `packages/core/src/agent-port.ts` -- `AgentRegistry { agentIds; get(id); defaultAgentId; legacyAgentId }` + `createAgentRegistry(entries, opts)`.
- `packages/core/src/chat/{types,context,agents,turns,permission-mode,terminal,workspaces}.ts` -- `ChatOptions.agents` replaces `agent`; `ctx.agentOf(sessionId)` resolves (throws `AgentError('agent_unavailable')`); every `agent.` use goes through it; `lastSessionModes` keyed by agent; Chat returns sessions with `agentId` filled (legacy); `createChatSession(wsId, { agentId? })`; `chatAgents()` list.
- `packages/server/src/start.ts`, `start-types.ts`, `index.ts` -- `StartOptions.extraAgents`; registry built from Claude Code + extras, each wrapped with its own env; re-export `createClaudeCodeAgent` for tests.
- `packages/server/src/chat-routes.ts`, `terminal-availability.ts` -- create body `agentId`, `GET chat-agents`, availability per session's agent.
- `packages/web/src/chat/chat-api.ts` (+ `useChatAgents`), `routes/workspace-chats-page.tsx` (picker), `shell/sidebar-model.ts` + `status-sidebar.tsx` (caption names the chat's agent), `routes/session-page.tsx` (composer label/header name the chat's agent).
- `tests/fixtures/fake-acp-agent.mjs` -- `whoami` prompt replies `agent=<FAKE_ACP_AGENT_NAME|default>`.
- `tests/architecture.test.ts` -- core/shared name no agent id.
- Reuse: `CLAUDE_CODE_AGENT_ID` (adapters), `agentSetup.agentEnv/refreshIfStale`, `withChatEnv`, `startServer`/`withChatServer`, `server/test/helpers.ts`.

## Tasks & Acceptance

**Execution:**
- [x] shared -- Session.agentId, CreateSessionRequest.agentId, ChatAgent(s) schemas, route, error code.
- [x] core db -- column + generated migration 0007; entities NewSession/toSession.
- [x] core registry + chat modules -- per-session agent lookup; unknown → `UnknownAgentError` (400 `agent_unknown`); unregistered at prompt → `agent_unavailable` error state; modes per agent.
- [x] server -- registry wiring, per-agent env, extraAgents, routes, terminal availability per agent.
- [x] web -- chat-agents query, picker (only with >1 agent), sidebar caption and session view name per chat.
- [x] tests -- core (registry, legacy read, unknown agent, modes per agent, two agents concurrently), server routes, arch test, e2e `agent-choice.spec.ts`; update existing `createChat({ agent })` call sites.

**Acceptance Criteria:**
- Given a server with Claude Code and the fake second agent, when a user starts one chat with each in one project and prompts both, then both stream at once and each reply comes from its own agent.
- Given a database from before this story, when the server starts, then old chats list and reopen as Claude Code.
- Given the fake agent's chat, when the mode picker opens, then Auto is shown unavailable with a reason and the server refuses it.
- Given any project, when the sidebar shows a chat, then its caption names that chat's agent.
- Given `packages/core/src` or `packages/shared/src` code naming an agent id, when tests run, then the architecture test fails.

## Implementation Notes

- Implemented directly in this session (it already held the investigation; earlier attempts stalled), not by a fresh subagent.
- Core: `AgentRegistry`/`createAgentRegistry`/`unregisteredAgent` in `agent-port.ts`; `ChatOptions.agents` replaces `agent`, and `agentEnv` now takes the agent id; `ctx.agentOf`/`agentIdOf`/`withAgentId`; `lastSessionModes` is per agent; `UnknownAgentError` (`agent_unknown`). Every Chat method that answers a session fills `agentId` (legacy agent for NULL rows).
- DB: `0007_session_agent.sql` adds nullable `agent_id` (no SQL default, so core names no agent).
- Server: `StartOptions.extraAgents`; registry = Claude Code (default and legacy) + extras, each wrapped by `forChat(agentId, …)` with its own `agentSetup.agentEnv(agentId)`; terminal availability per session's agent; `GET /api/v1/chat-agents`; `createClaudeCodeAgent` re-exported for tests.
- Web: `useChatAgents`, `agentNameOf`, `AgentPicker` (hidden with one agent) on the Chats page body; session view, sidebar rows, Needs you and Chats rows name the chat's agent. Claude-only words (sign-in again, terminal, mode descriptions) still say Claude Code: entry 9's sweep.
- Fake agent: `whoami` prompt; tests' second agent = Claude Code ACP adapter on the fake script, `fake-agent`/"Fake Agent", Ask + Skip all, no terminal (`tests/support.ts` `fakeSecondAgent`, server test `secondAgent`).
- `useChatAgents` lives in `packages/web/src/chat/use-chat-agents.ts` (not `chat-api.ts`).
- Tests: `packages/core/test/agent-choice.test.ts`, `packages/server/test/agent-choice.test.ts`, `packages/web/test/agent-choice.dom.test.tsx`, `tests/e2e/agent-choice.spec.ts`, architecture test `findAgentIdViolations`; gate route list gains `chat-agents`.

## Plan Change Log

## Review Triage Log

Pass 1 (quick lens, security + correctness): high 0, medium 2, low 1, false 0, maybe-false 0, rejected 1.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | Session view named a second agent's chat "Claude Code" until `GET session` loaded (composer, hint, message names, one-shot aria-live announcement) | medium | patch | `agentNameOf(_, undefined)` returns the legacy name; patched: "The agent" until the session has loaded. |
| 2 | Sign in again (hard-coded `claude-code`) offered on a second agent's `auth_required` error, signing in to the wrong agent | medium | patch | Reachable once a chat can have another agent; patched: shown only for a Claude Code (or legacy) chat, else the plain error notice. Per-agent sign-in stays with entries 6/7. |
| 3 | "Old database" AC proven only with rows made by today's code | low | patch | `upgrade-0.2.0.test.ts` (real 0.2.0 data folder, migrations to 0007) now asserts sessions read `claude-code` and the row keeps no agent id. |
| 4 | Plan checklist unchecked; Code Map says `useChatAgents` is in `chat-api.ts` | rejected | — | Fix edits this build's plan (boxes ticked as bookkeeping; notes were written after the diff was staged). |

## Design Notes

Legacy reads: core cannot name `claude-code`, so the column is nullable and the registry's `legacyAgentId` (server wiring: Claude Code) fills `agentId` on every session Chat returns; new rows always store it. The second agent is built in tests from the Claude Code ACP adapter pointed at the fake script with `displayName: 'Fake Agent'`, `permissionModes: ['ask','skip_all']` and no terminal (6.4 extracts the shared client).

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `pnpm test` -- all pass (run in background, poll)
- `pnpm e2e` -- all pass
- `pnpm run pack && pnpm smoke` -- pass
