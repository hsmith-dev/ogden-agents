---
id: 11
type: story
title: "Each chat runs on a model the user can switch"
parent: none
covers: [CAP-3]
after: []
assignee: ""
refined: false
hitl: false
risk: high
estimate: ""
---

# Each chat runs on a model the user can switch

## Description

Each chat shows which model its agent runs on, and the user can switch it from a picker beside the agent's name. The picker lists the models the agent itself offers, with the current one marked. A switch applies to the next message: at once when the agent can switch a running session, else by restarting the agent (resumed) at the next idle point, as a move into or out of Auto does. Settings → Agents holds a default model per agent, and a project's Workspace settings can override it; a new chat starts on the project's default, else the agent's default, else the agent's own choice. Each change is recorded on the chat and shown in its header and in the sidebar's tooltip. An agent declares how it offers models, so Codex and Grok (epic 12) fill the same contract.

## Acceptance Criteria

1. **A new chat starts on the right model**
   **Given** a project with or without a default model for an agent, and Settings with or without a default model for that agent
   **When** a chat with that agent is created
   **Then** its model is the project's default when set, else the agent's default from Settings when set, else none (the agent's own choice), and the agent runs on that model before it takes the first message

2. **The picker shows the agent's models**
   **Given** a chat whose agent lists its models (in this run, from this chat or any chat with the same agent)
   **When** the user opens the model picker beside the agent's name
   **Then** it lists those models by the agent's names for them, marks the one the chat runs on, and offers "Agent's default"; with no list known yet it says the list appears once the agent has started

3. **A switch applies to the next message**
   **Given** a chat, idle or working, driven from the chat
   **When** the user picks another model
   **Then** the chat's model changes at once, and the agent's next turn runs on it: told the model live when it can switch a running session, else restarted and resumed at the next idle point with the model
   **And** a running turn is never interrupted by the switch

4. **A model the agent refuses is explained**
   **Given** a chat set to a model the agent refuses (unknown to it, or not in the user's plan)
   **When** the agent is told the model or runs a turn on it
   **Then** the chat shows the agent's own reason in plain words and a way to pick another model, and the chat keeps working on the agent's default meanwhile
   **And** the server refuses a model id the chat's agent session doesn't list, with a plain error and no event

5. **Defaults are kept per agent and per project**
   **Given** Settings → Agents and a project's Workspace settings
   **When** the user sets or clears a default model for an agent
   **Then** it is kept across restarts, shown where it was set, and used only by chats created afterwards; existing chats keep their model

6. **Model changes are events, and old history still reads**
   **Given** a chat, and history recorded before this change
   **When** the model changes for any reason (the user, a default at creation, the agent refusing a model)
   **Then** one schematized event carries the new model, the previous one, and the cause; the chat header and the sidebar tooltip follow it live and after a reload; and sessions and events from before this change read as "Agent's default" with nothing migrated by hand

7. **The terminal and a handoff keep the chat's model**
   **Given** Developer mode on and a chat with a chosen model whose agent supports the terminal toggle
   **When** the user switches the chat to the terminal
   **Then** the agent's own CLI starts on the chat's model
   **And** while the terminal drives the chat the server refuses a model change, with a reason telling the user to switch back first
   **And** a new chat created from another (an agent handoff) can be given a model

## Boundaries

- Must not change: permission modes, the caution ladder, permission cards, the terminal handoff's locking and import, how agents sign in, AD-15's gate.
- Core names no agent and no model id: models are the agent's data, and the architecture test stays green.
- No change to an agent's own settings files: Ogden sets the model on its own session (or the agent's start), never by writing `.claude/settings*.json` or `~/.gemini`.
- No cost or token tracking, no reasoning-effort or fast-mode picker.
- The agent handoff feature (header menu and session switching) is a separate story; this one keeps its UI in the composer's agent chip and a Settings section, and leaves the handoff a way to pass the target model.

## References

- parent — none (standalone story in `backlog/`)
- source — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, CAP-3
- agent matrix — _bmad-output/initiative-ogden-agents/spec-ogden-agents/agent-matrix.md
- architecture — _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md, AD-1, AD-5, AD-9, AD-16
- permission modes (the same live-or-restart shape) — _bmad-output/initiative-ogden-agents/backlog/story-each-chat-has-a-permission-mode-ask-auto-or-skip-all-plan.md
- agent descriptor — _bmad-output/initiative-ogden-agents/epic-every-agent/story-epic-contracts-and-stubs-agents-as-a-choice-plan.md
- Antigravity grounding — _bmad-output/initiative-ogden-agents/epic-every-agent/spike-can-ogden-drive-antigravity-over-acp-probe-it-and-decide-go-plan.md, Capabilities
- Codex and Grok grounding — _bmad-output/initiative-ogden-agents/epic-v1-1-codex-and-grok/ (spikes 12.1, 12.2; on branch `spike/12-codex-grok`)
- design — _bmad-output/initiative-ogden-agents/ux-ogden-agents/DESIGN.md and EXPERIENCE.md (composer, chat header, Settings)

## Notes

- Decision (user, 2026-10-04): "Also we should be able to easily switch which model each agent is using." The defaults handed with it are the criteria above: per-chat picker beside the agent name; live switch when the agent supports it, else restart-and-resume when idle; default per agent in Settings → Agents and optionally per project (project wins); unavailable model shows the agent's error and offers another; changes recorded as back-compatible AD-5 events and shown in header and sidebar tooltip; the handoff can pick the target model.
- Grounding (2026-10-04, pinned `@agentclientprotocol/claude-agent-acp` 0.84.0 on `@agentclientprotocol/sdk` 1.5.1): the adapter lists models as an ACP session config option (`configOptions`, id `model`, category `model`, `type: select`, `currentValue`) in `session/new`, `session/resume` and `session/load`, and switches a running session with `session/set_config_option { configId: "model", value }` (it calls the SDK's `query.setModel`). The list includes `default` ("Default (recommended)") and aliases such as `opus`, `sonnet`, `haiku` and `[1m]` context variants, filtered by the user's `availableModels`/managed `deniedModels`. An unknown value is refused ("Invalid value for config option model"). Its initial model is `ANTHROPIC_MODEL`, then `settings.model`, then a resumed session's model. It may publish `config_option_update`. The SDK 1.5.1 types carry no `session/set_model` or `unstable_setSessionModel`; the stable config-option path is the one used. The CLI takes `--model <id>` for the terminal.
- Grounding (spike 6.1, Antigravity `antigravity-acp` 1.3.0): `session/new` returns `configOptions` with `model` (14 Gemini models) and `mode`, plus the older `models` field. That `session/set_config_option` switches its model is not yet seen live: live check.
- Grounding (spikes 12.1 and 12.2): Codex's ACP adapter lists config options `model`, `reasoning_effort`, `mode`, …; Grok advertises a model list in `_meta` x.ai extensions. Both fit the config-option path; the descriptor fallback (a static list applied at start) covers an agent that lists none.
- Assumption: an agent that lists no models over ACP may declare a static list in its descriptor and how it takes one at start (an environment variable or a CLI argument); a switch then restarts the agent at the next idle point. No current agent needs it.
- Assumption: the models Settings and Workspace settings offer are those the agent last listed in this install (kept across restarts), since listing them would otherwise mean starting the agent; before any chat has started, the default can be left as "Agent's default".
- Assumption: a model the agent refuses at start or on a switch moves the chat back to "Agent's default" (cause `agent`) with the agent's reason, as a refused permission mode moves a chat to Ask.
- Overlap: the sibling agent-handoff story (story/agent-handoff, chat header menu and session switching) touches the chat header and chat creation. This story keeps its control in the composer's agent chip, adds a `model` field to chat creation the handoff can pass, and touches the header only to show the model name.
- High risk check: a person picks a model in the running app with a real Claude Code sign-in (and Antigravity where set up) and confirms the next reply runs on it before the PR leaves draft.
