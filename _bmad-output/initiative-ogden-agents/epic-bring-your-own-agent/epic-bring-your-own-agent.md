---
type: epic
title: "v1.3: Plug in any ACP agent, including your own"
parent: initiative-ogden-agents
covers: [CAP-27, CAP-15, CAP-16]
after: []
assignee: ""
risk: medium
---

# v1.3: Plug in any ACP agent, including your own

## Description

Ogden hosts any agent the user brings without becoming a runtime of its own (spec Why, 2026-10-31). A user names an ACP agent's command in Settings, Agents, and it chats like the built-in agents in Ask: permission cards, cancel, and resume where it supports it. The user's own harness, or an open-source one such as OpenCode or Goose aimed at their model, plugs in this way. The epic also lets the Local model (epic 14, OpenCode route) build attended, with every tool call a card. It builds on epic 6's agent-neutral registry and acp-base, epic 12's linked command, epic 14's OpenCode route and epic 17's attended runners.

## Outcome

An advanced user registers their own ACP agent by its command, tests it, and chats with it in any project in Ask, and builds a ticket attended with the Local model; the spec's third success bullet ("registers their own ACP agent and chats with it") is the signal.

## Requirements

Drafted at inception (2026-10-31, autonomous, awaiting the user's approval). Each line maps to a spec capability in `covers`.

- E21-R1: A custom agent is a user-defined `AgentDescriptor` on `acp-base`, `agentId` `custom-<slug>`, kept as a core-owned install-level row (AD-11) and added to the agent registry live, without a restart; core and shared still name no agent. (CAP-27; AD-1 note)
- E21-R2: Its command is resolved like epic 12's linked command (absolute, runnable, never through a shell) at save and at every chat start; **Test** starts it once and shows what `initialize` advertises (resume, modes, models, prompt capabilities) or the agent's own error in one sentence. (CAP-27; AD-1 note; EXPERIENCE.md Add your own agent)
- E21-R3: An optional API key is kept as `agent-api-key/custom-<slug>` (AD-16) and reaches only that agent's process in a variable whose name matches `^[A-Z][A-Z0-9_]*_API_KEY$` and is neither on the child-env allowlist nor a loader variable; it is redacted like every key. (CAP-27, CAP-16; AD-16)
- E21-R4: A custom agent offers Ask only, needs project trust, is `interactiveOnly` so orchestration refuses it as a worker, never declares `unattendedBuild`, and the card says each in plain words; removing it keeps its chats, which open read-only with "This agent was removed." (CAP-27; AD-1 note, AD-17)
- E21-R5: Chat parity with the built-in agents through the shared ACP client: permission cards, normalized states, cancel, resume then load then the stored-transcript fallback, and models where advertised. (CAP-27, CAP-15; AD-4, AD-5)
- E21-R6: Attended builds (every tool call a card, no unattended path) are offered for the Local model through epic 17's agent-neutral runner; BMad's build skill reaches it through `.agents/skills` where Planning is on. Custom agents chat only in v1.3. (CAP-15 amended 2026-10-31, CAP-27; AD-17)
- E21-R7: Works on macOS, Windows and Linux; live checks with OpenCode and Goose registered as custom agents are recorded by the user; ships in the v1.3 release. (CAP-27)

## Done when

1. A fake ACP agent registered by command through Settings, Agents completes a chat with a permission card that holds a shell command until approved, and reopens after a server restart (CAP-27).
2. Test reports a fake agent's advertised capabilities, and a missing, non-runnable or shell-string command is refused with a plain reason before anything is saved.
3. A custom agent's key never appears in the database, event log or logs; a variable name such as `NODE_OPTIONS` or `PATH` is refused; Auto, Skip all, unattended builds and orchestration dispatch are refused for it by the server.
4. A ticket builds attended with the Local model against the fake OpenAI-compatible server, every tool call reaching a card, and the review page shows its diff.
5. The end-to-end suite passes on all three OSes with fakes only, the user's live checks with OpenCode and Goose are recorded, and the epic ships in the v1.3 release.

## Boundaries

Registering and using ACP agents the user brings. Not here: agents without ACP (epic 20), unattended builds for any custom or local agent (a non-goal for them), an agent catalog or registry browser, installing the user's harness for them (they install it; Ogden resolves the command).

## References

- spec — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, CAP-27, CAP-15, Constraints (CAP-27 attended only), Non-goals (an agent runtime of its own)
- architecture — _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md, AD-1 (CAP-27 note), AD-11, AD-16, AD-17
- parent — _bmad-output/initiative-ogden-agents/initiative-ogden-agents.md
- change — _bmad-output/initiative-ogden-agents/change-desktop-agent-harness/change-desktop-agent-harness.md, sections 4.4 and 5
- lessons — _bmad-output/initiative-ogden-agents/change-desktop-agent-harness/the-mob-lessons.md (ideas only; the-mob's code is unlicensed and is never copied)
- agent matrix — _bmad-output/initiative-ogden-agents/spec-ogden-agents/agent-matrix.md
- experience — _bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md
- design — _bmad-output/initiative-ogden-agents/ux-ogden-agents/DESIGN.md, Components
- epic 12 — _bmad-output/initiative-ogden-agents/epic-v1-1-codex-and-grok/tickets.toml, entry 12 (linked command)
- epic 14 — _bmad-output/initiative-ogden-agents/epic-local-models/spike-which-route-can-drive-a-local-model-over-acp-on-all-three-oses-and-does-it-stay-on-the-machine-plan.md (OpenCode environment and config)

## Notes

- Status: drafted autonomously 2026-10-31; awaiting the user's approval of the inception.
- Decision (2026-10-31, user): attended local-model builds come with this epic; unattended local-model and custom-agent builds stay out (spec CAP-15, CAP-27).
- Decision (2026-10-31, autonomous after the set check): custom agents chat only in v1.3; epic 17's runner needs a per-agent build quirk (skill invocation, halt wording) an arbitrary agent cannot supply. The user may overrule.
- Decision (2026-10-31, autonomous): tracer bullet is entry 1 (a fake ACP agent registered through the API and chatted with); no spike, because the ACP client is proven by five agents.
- Waits on epic 6 because: the registry, acp-base and the picker (6.3, 6.4, 6.6). Waits on epic 12 because: the linked-command resolver (12.12). Waits on epic 14 because: the OpenCode route, fake server, chat and skills (14.2, 14.3, 14.6, 14.9). Epic 15's dispatch already refuses `interactiveOnly` agents (15.7, on main); entry 4 only sets the flag. Waits on epic 17 because: the agent-neutral runner and attended fallback (17.3, 17.8).
