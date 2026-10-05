---
title: 'Each chat runs on a model the user can switch'
type: 'feature'
ticket: '11'
created: '2026-10-04'
status: 'ready-for-dev'
baseline_revision: '5c2aa5d38265a8a61ef0f3a568e2ced34269fa61'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/backlog/story-each-chat-runs-on-a-model-the-user-can-switch.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/backlog/story-each-chat-has-a-permission-mode-ask-auto-or-skip-all-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A chat always runs on whatever model its agent picks itself; the user can't see or change it per chat, per agent or per project (user request, 2026-10-04).

**Approach:** A per-chat `model` (an agent's own model id, or `null` for the agent's own choice) stored on the session, set at creation from project default → agent default → `null`, changed only by core, each change a `session.model_changed` event. Agents expose models through ACP session config options (category `model`): listed from `session/new|resume|load`, switched live with `session/set_config_option` before the next prompt. A descriptor may instead declare a static list applied at spawn (env var or argument); switching it restarts the agent (resumed) at the next idle point. The last list each agent reported is kept per install, so Settings and the picker can show it.

## Boundaries & Constraints

**Always:**
- Ticket criteria 1–7 are the acceptance bar. A switch never interrupts a running turn: core applies the stored model at the pre-prompt idle point (`runTurn`, after `modeSync`), live (`AgentSession.setModel`) or by restart (`restartPending`).
- `null` means "the agent's default": a live session told `null` goes back to the model the agent chose itself when that session started; a static agent starts without its model variable or argument.
- Model id: 1–200 chars, `^[A-Za-z0-9][A-Za-z0-9._:/@\[\]-]*$` (never starts with `-`; it may become a CLI argument). PUT with an id the chat's session (or the agent's last list) doesn't list: 409 `model_unavailable`, no event. While `driver = terminal`: 409 `driver_is_terminal`. Same model: 200, no event. Unknown list: accepted (the agent decides).
- A model the agent refuses (at the pre-prompt set) moves the chat to `null` (cause `agent`) with the agent's own words (masked, capped); the prompt still goes out on the agent's default. An agent-reported model change (`config_option_update`) on a chat with a non-null model moves the chat to the reported id (cause `agent`).
- Old `session.created` payloads and rows read `model: null` (Zod default, migration column NULL). New event and payload fields optional. Core and web name no agent or model id; the architecture test stays green.
- Defaults: install-level per agent (new table, event `settings.agent_default_model_changed`), project-level per agent (JSON column on `workspaces`, carried by `workspace.settings_changed`). Changing a default never changes an existing chat.
- Terminal: Claude CLI gets `--model <id>` when the chat's model is set.
- Tests never run real agents, keychain, network, or read the real `~/.claude`/`~/.gemini`; the fake ACP agent advertises a `model` config option; any test hook only through `testHooksAllowed`.

**Never:** Write agent settings files or set `ANTHROPIC_MODEL` for ACP agents. Upgrade pins. A reasoning-effort or fast-mode picker. Change permission modes, cards, caution, terminal locking. Touch the chat header menu the agent-handoff story adds (the picker lives in the composer footer; the header only shows the model name).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error |
|---|---|---|---|
| Create | project default `fake-large` for agent, install default `fake-small` | chat `model: fake-large`; first prompt runs on it | — |
| Create, handoff seam | POST sessions `{ agentId, model }` | chat on that model | invalid id → 400 |
| Live switch | idle or working chat, agent lists config option | event `user`; next prompt preceded by `set_config_option` | — |
| Static switch | descriptor list, no config option | event `user`; agent restarted (resumed) before next prompt with env/arg | — |
| Refused | agent rejects `set_config_option` | chat → `null`, cause `agent`, agent's reason; prompt still sent | — |
| Unlisted id | PUT model not in session's list | nothing changes | 409 `model_unavailable` |
| Terminal | model set, switch to terminal | CLI args include `--model <id>`; PUT model → 409 | `driver_is_terminal` |
| Old history | `session.created` without `model` | reads `null`, picker "Agent's default" | — |

</frozen-after-approval>

## Code Map

- `packages/shared/src/entities.ts` -- `Session` gains `model: ModelId.nullable().default(null)`; `ModelId` schema + `AgentModel {id,name,description?}`.
- `packages/shared/src/events-session.ts`, `events-settings.ts`, `events.ts` -- `session.model_changed` {sessionId, model, previous, cause: user|agent, reason?}; `settings.agent_default_model_changed` {agentId, model, previous}; register both in the unions (mirror `SessionPermissionModeChangedEvent`). `workspace.settings_changed` payload gains optional `defaultModels`.
- `packages/shared/src/chat.ts`, `api.ts` -- `ChatAgent.models?: AgentModel[]`, `ChatAgent.defaultModel?: ModelId`; `SessionResponse.models?: { available: AgentModel[] | null, live: boolean }`; `CreateSessionRequest.model?: ModelId|null`; `WorkspaceSettings.defaultModels?: Record<AgentId, ModelId>`, update `{ defaultModels?: Record<AgentId, ModelId|null> }`; routes `sessionModel` (PUT) and `chatAgentDefaultModel` (PUT `/chat-agents/:agentId/default-model`).
- `packages/core/src/agent-port.ts` -- `AgentEvent` `{type:'model', model}`; `AgentSession.models?` getter `{available, current}`, `setModel?(model: string|null)`; `StartAgentSession.model?: string`; `AgentTerminalOptions.model?`.
- `packages/core/src/agent-descriptor.ts` -- optional `models?: { list: AgentModel[]; apply: {kind:'env'; name} | {kind:'arg'; flag} }` + problems check.
- `packages/core/src/db/schema.ts`, `packages/core/drizzle/0012_*.sql` + meta -- `sessions.model` text NULL; `workspaces.default_models` text NOT NULL DEFAULT '{}'; table `agent_settings(agent_id PK, default_model, models_json)`.
- `packages/core/src/entities.ts` -- `createSession` takes `model`; `setSessionModel(id, model, cause, reason?)` appends the event (mirror `setSessionPermissionMode`).
- `packages/core/src/agent-models.ts` (new) -- install store: `defaultModel(agentId)`, `setDefaultModel`, `lastModels(agentId)`, `rememberModels(agentId, list)` (in-memory + row).
- `packages/core/src/workspace-settings.ts` -- read/write `defaultModels`.
- `packages/core/src/chat/model.ts` (new) -- `syncModel` (pre-prompt), `onReportedModel`, `setModel`, `modelOptions`; `chat/agents.ts` passes `model` to start for static agents and records `entry.appliedModel`; `chat/turns.ts` calls `syncModel` after `modeSync`, handles `model` events; `chat/workspaces.ts` resolves the creation default and adds models/defaultModel to `chatAgentOf`; `chat/types.ts`, `chat.ts`, `chat/terminal.ts` (pass model to terminal options).
- `packages/adapters/src/acp-base/acp-agent.ts` -- parse `configOptions` (category `model` select, flatten groups) from new/resume/load and `config_option_update`; `models` getter; `setModel` via `session/set_config_option`; static descriptor list applied in `spawnAgent`.
- `packages/adapters/src/acp-claude-code/terminal-command.ts` -- `--model`.
- `packages/server/src/chat-routes.ts` (+ agent-settings route) -- PUT model, PUT default model, POST session `model`, GET session `models`; `start.ts`/`start-agents.ts` wire the store.
- `packages/web/src/chat/model-picker.tsx` (new) -- composer-footer chip "Model: <name>" dropdown (Agent's default + list, current checked, disabled reason in terminal); `routes/session-page.tsx` (footer slot, header caption shows model, error notice "Choose another model"); `chat-api.ts`; `routes/agents-settings-page.tsx` + `agents/agent-card.tsx` default-model select; `routes/workspace-settings-page.tsx` per-agent override; `shell/sidebar-model.ts` + `ui/sidebar.tsx` tooltip adds the model.
- `tests/fixtures/fake-acp-agent.mjs` -- `configOptions` model (`fake-default`, `fake-large`, `fake-small`, `fake-locked` refuses), `session/set_config_option`, keyword `model` replies `model=<current>`.

## Tasks & Acceptance

**Execution:**
- [ ] shared schemas, routes, events -- contract first; parse old payloads.
- [ ] core: descriptor, port, migration, entities, agent-models store, workspace settings, chat model module, creation defaults, terminal option -- unit tests incl. matrix rows.
- [ ] adapters: ACP config-option models + static fallback + Claude `--model` -- adapter tests on the fake agent.
- [ ] server routes + wiring -- route tests (409s, 400, default precedence, events).
- [ ] web: model picker, session page, settings (agents, workspace), sidebar tooltip -- dom tests.
- [ ] fake agent + e2e `tests/e2e/model-picker.spec.ts` (switch, next reply runs on it, reload keeps it, defaults).
- [ ] docs: agent-matrix (models per agent), EXPERIENCE.md (model picker), architecture memlog + spine note (new event, table).

**Acceptance Criteria:**
- Given a server restart, when a chat with a model is reopened, then its next prompt runs on that model (resume path applies it).
- Given two tabs, when one sets a default or a chat's model, then the other shows it without reload.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Design Notes

Live vs restart lives in one place: `syncModel(entry, started)` before each prompt compares the stored model to `entry.appliedModel`; with `setModel` it tells the agent (bounded by the permission-mode timeout) and records `appliedModel`; without it, a difference sets `restartPending`, and the next `agentFor` starts the agent with `model` in its input. Agent overlap: the sibling handoff story creates chats from the header menu; it passes `model` to `createChatSession` (the seam), and this story stays out of the header menu.

## Verification

**Commands:**
- `pnpm typecheck` -- clean
- `pnpm test` -- green (architecture test included)
- `pnpm e2e` -- green
- `pnpm run pack && pnpm smoke` -- green
