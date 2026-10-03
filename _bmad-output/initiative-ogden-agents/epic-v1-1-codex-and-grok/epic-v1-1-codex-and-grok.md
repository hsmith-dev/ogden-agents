---
type: epic
title: "v1.1: Codex and Grok beside Claude Code"
parent: initiative-ogden-agents
covers: [CAP-15, CAP-3, CAP-5, CAP-16]
after: []
assignee: ""
risk: high
---

# v1.1: Codex and Grok beside Claude Code

## Description

The user asked for a v1.1 release that adds OpenAI Codex and xAI's Grok as chat agents beside Claude Code (user, 2026-10-02: "we need to add v1.1: Codex and Grok features"). v1 is Claude Code, plus Antigravity if epic 6's spike is a go. This epic builds on epic 6's agent-neutral mechanism: `Session.agentId`, the agent registry and agent list with declared permission modes (6.3), and the shared ACP client in `acp-base` (6.4). With those in place, each agent is one chat adapter, one setup adapter, one pins folder and one wiring entry (AD-1).

Both agents speak ACP today. Codex goes through the `codex-acp` adapter, and Grok through its own `grok agent stdio` (registry id `grok-build`). Each agent is installed as a pinned copy in Ogden's data folder, the way 9.3 installs Claude Code: `npm ci` from a pinned lock, with nothing installed globally. Sign-in and the API key are handled from the UI. Each agent gets permission cards, Ask, Auto and Skip all where its own modes mean the same, resume, and the terminal toggle where its CLI resumes the ACP session. The BMad skills reach each agent where Planning is on. A spike per agent ends in a go or no-go from the user before any work for that agent is built.

## Outcome

A user picks Claude Code, Codex or Grok for each chat in any project, with all of them working at the same time. CAP-15's success criterion is the signal, extended to these two agents. The demo: in one Simple project, a Claude Code chat, a Codex chat and a Grok chat run at once, and all three continue after a server restart.

## Requirements

Completed at inception from the spec capabilities in `covers`, as epic 6 did for Antigravity: chat with each agent, declared permission modes, resume, the terminal toggle, install and sign-in, BMad skills, and all three OSes. CAP-15's text says v1 is Claude Code and names Codex as v2; that changes through `bmad-spec` at inception (see Notes).

## Done when

1. Each agent's spike result is recorded, and the user has said go or no-go for Codex and for Grok. A no-go agent moves back to epic 8 (v2), and nothing below applies to it.
2. In one project with every BMad piece off, a Claude Code chat runs at the same time as a chat with each go agent. Each shows permission cards that hold a shell command until it is approved, and normalized states. After a server restart, every chat continues with its context (CAP-15, CAP-3).
3. Each go agent offers only the modes it declares (Ask, Auto, Skip all). A mode it does not declare is shown unavailable and the server refuses it.
4. On a fresh machine, a user installs each go agent from the UI and signs in with the agent's subscription sign-in (ChatGPT login for Codex, Sign in with Grok for Grok). Another user chats with only an API key (for Grok, only if the spike found a way), and no key appears in the database, the event log or the logs (CAP-16).
5. The terminal toggle appears for exactly the agents and OSes `agent-matrix.md` lists. With Planning on, a planning session with each go agent runs a BMad skill (CAP-5, CAP-6).
6. The epic's end-to-end suite passes on macOS, Windows and Linux. The epic is released as `ogden-agents` v1.1 with each agent's live check recorded.

## Boundaries

Chat with Codex and Grok beside Claude Code, on epic 6's mechanism. This epic does not rebuild the registry, the picker or the shared ACP client. They stay in epic 6 whatever Antigravity's go or no-go (user, 2026-10-02).

- Builds (unattended runs) with Codex or Grok are not in this epic (user, 2026-10-02). They come in a later release (epic 8, v2).
- Gemini CLI, GitHub Copilot CLI and builds with Antigravity stay in epic 8 (v2). Other ACP registry agents are deferred.
- No model picker and no cost or token tracking (AD-8). Core, `BuildRunnerPort`, `SandboxPort` and the dispatcher do not change.

## References

- parent — _bmad-output/initiative-ogden-agents/initiative-ogden-agents.md
- spec — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, sections Capabilities (CAP-3, CAP-5, CAP-15, CAP-16, CAP-19), Non-goals ("Planned for v2")
- agent matrix — _bmad-output/initiative-ogden-agents/spec-ogden-agents/agent-matrix.md
- architecture — _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md, AD-1, AD-4, AD-5, AD-6, AD-15, AD-16, AD-21, AD-22
- epic 6 — _bmad-output/initiative-ogden-agents/epic-every-agent/epic-every-agent.md (the mechanism, entries 3 and 4, and the Codex research under "Codex, Gemini CLI and Copilot research") and its `tickets.toml` (the entry shapes to copy per agent); the earlier 14-entry Codex and Gemini CLI draft, commit cced0a9
- install pattern — packages/adapters/src/setup-claude-code/install.ts (story 9.3) and `pins/`
- external (Codex) — https://github.com/agentclientprotocol/registry/blob/main/codex-acp/agent.json; https://github.com/agentclientprotocol/codex-acp; https://developers.openai.com/codex/windows; https://zed.dev/blog/chatgpt-subscription-in-zed
- external (Grok) — https://github.com/agentclientprotocol/registry/blob/main/grok-build/agent.json; https://docs.x.ai/build/overview.md, /build/cli/headless-scripting.md (ACP), /build/features/permissions.md, /build/features/sessions.md, /build/features/sandbox.md, /build/enterprise.md (authentication), /build/features/skills-plugins-marketplaces.md; https://github.com/xai-org/grok-build; https://x.ai/legal/terms-of-service

## Notes

Status: envelope, drafted autonomously 2026-10-02 from the user's request; the user answered its open questions the same day. Not yet incepted.

- Decision (2026-10-02, user): "we need to add v1.1: Codex and Grok features". Codex moves here from epic 8 (v2). Grok is new to the plan.
- Decision (2026-10-02, user; was open question 1, Grok route): Grok's subscription "Sign in with Grok" over ACP (`grok agent stdio`) is the main route. An xAI API key is added only if the spike finds a way to give one over ACP. No custom Ogden adapter around the Grok CLI or API.
- Decision (2026-10-02, user; was open question 2, sign-in versus terms): same rules as Antigravity. Subscription sign-in is allowed for Codex (ChatGPT login) and Grok, with API keys where the agent supports them.
- Decision (2026-10-02, user; was open question 3, OSes): macOS, Windows and Linux are all required. Each agent's spike probes all three, Windows first, and ends with a go or no-go for that agent.
- Decision (2026-10-02, user; was open question 4, builds): v1.1 is chats only: chat, install, sign-in, agent picker integration and BMad skills. Builds with Codex and Grok come in a later release (epic 8, v2, unless re-planned).
- Decision (2026-10-02, user; was open question 5): the shared agent-choice groundwork (contracts, the shared ACP client, the picker) stays in epic 6 whatever Antigravity's go or no-go; only epic 6's Antigravity-specific stories depend on it. This epic therefore always waits on epic 6's groundwork and never rebuilds it.
- Inception: the full inception (stories in `tickets.toml`) happens later, after epic 6.
- Decision (2026-10-02): `tickets.toml` holds only the two spikes, 12.1 (Codex) and 12.2 (Grok). They probe the agents alone and do not wait on epic 6, so neither carries the epic's `after`; the stories added at inception will. Results and recommendations are in each spike's plan beside this file; the go or no-go per agent is the user's and is recorded here when given.
- Assumption: release target is `ogden-agents` v1.1, after v1 (epics 1 to 7) ships. This epic is placed after epic 7 in the initiative's build order, under its own v1.1 heading.
- Assumption: agent ids `codex` and `grok`; product names "Codex" and "Grok"; adapters `acp-codex`, `setup-codex`, `acp-grok`, `setup-grok`.
- Waits on epic 6 because: the agents-as-a-choice contracts (6.3) and the shared ACP client in `acp-base` (6.4). Through epic 6 it also waits on epics 2, 3, 4, 9 and 10.
- Handoff (not applied): the spec's CAP-15 and Non-goals, the agent matrix, and the initiative's Notes and Done when name Codex as v2. At inception, record v1.1 through `bmad-spec` and add a dated initiative note. The initiative was not edited here because the epic 6 branch is editing it.

### What the research found (2026-10-02; the spikes re-check)

Corrected by spikes 12.1 and 12.2 (2026-10-02, CI on all three OSes; details in the spike plans beside this file): the registry now pins Grok 1.0.49 (not 1.0.48) and Codex `@agentclientprotocol/codex-acp` 2.1.1 with Codex 0.159.3. Codex's Windows sandbox is no longer labelled experimental (its feature flags are removed; OpenAI's page prefers `elevated`), and its `shell: true` spawn applies only when `CODEX_PATH` is set. Grok has no ACP session modes; `session/new` takes `_meta.autoMode` and `_meta.yoloMode`. Grok accepts an API key over ACP through the unadvertised `authenticate` method `xai.api_key`. `npm ci` fits Grok only for the download: Ogden must decompress and spawn the platform binary itself, with `GROK_HOME` in its data folder, because npm's launcher prefers `~/.grok/bin/grok`. The lines below are kept as written.

"Verified" means seen first-hand: npm metadata, the ACP registry, vendor docs, or an `initialize` call run locally on macOS arm64 against an empty home folder. "Reported" means from third-party pages only.

Codex:
- Verified: registry `codex-acp` 2.1.1 (Apache-2.0; authors OpenAI, JetBrains, Zed; published 2026-10-01; preview 2.1.2-preview.1, 2026-10-02). It bundles `@openai/codex` ^0.159.1, which resolves to 0.159.3 (`@openai/codex` latest is 0.160.0, outside that range). It ships platform binaries for macOS, Linux and Windows on x64 and arm64. It fits 9.3's `npm ci` pattern. `CODEX_PATH` overrides the binary, and `CODEX_HOME` must already exist.
- Verified (`initialize`): `loadSession`, plus resume, list, close, delete and fork. Auth methods are `chat-gpt` and `api-key` (`CODEX_API_KEY`, then `OPENAI_API_KEY`). The code also has `chat-gpt-device-code`, and `NO_BROWSER=1` hides the browser login.
- Verified (source): there are four session modes. `read-only` asks before edits and network use (Ask). `agent` ("Auto review": only asks about actions it detects as unsafe; the adapter's default) maps to Auto. `agent-full-access` (approval `never`, sandbox `danger-full-access`) maps to Skip all. `workspace-write` edits workspace files without asking and has no Ogden match. Because the default is Auto, Ogden must set Ask explicitly. Its permission options include `allow_always` and amendment options, which Ogden never picks.
- Verified (docs): there is a native Windows sandbox with `elevated` and `unelevated` modes, Seatbelt on macOS, and bubblewrap on Linux and WSL2. Reported: Windows support is still labelled experimental (March 2026). On Windows the adapter spawns `codex app-server` with `shell: true`, which needs a process-tree stop check.
- Reported, not verified against OpenAI's terms: ChatGPT sign-in in third-party clients is offered by Zed and JetBrains, and OpenAI co-authors the adapter. The user should still read OpenAI's terms.
- Assumed: `codex resume <id>` resumes an ACP session (the epic 6 draft's finding, not re-checked). Codex reads skills from `.agents/skills`.

Grok:
- Verified: "Grok Build" is xAI's coding agent CLI (`grok`). Its harness is Apache-2.0 at github.com/xai-org/grok-build (created 2026-07-14). It speaks ACP natively with `grok agent stdio`. Registry `grok-build` 1.0.48 is listed as licence "proprietary", with the xAI terms of service, and is distributed through `npx @xai-official/grok@1.0.48 agent stdio`. That version is npm's `alpha` tag; npm `latest` is 1.0.46. Releases come almost daily (1.0.43 to 1.0.48 in six days), and the registry has listed it since at least 0.2.61 (2026-06-23). The npm package has platform binaries for macOS, Linux and Windows on x64 and arm64 (node 20 or later), so 9.3's `npm ci` pattern fits. xAI's own installer is `curl … | bash` or `irm … | iex`, which Ogden does not use.
- Verified (`initialize`, 1.0.48): `loadSession`, plus resume, list and close. The only auth method advertised is `grok.com` ("Sign in with Grok"), even with `XAI_API_KEY` set. xAI's ACP sample checks for `xai.api_key` and `cached_token`, so how an API key is given over ACP needs the spike. The docs list browser OIDC, device code (`grok login --device-auth`) and `XAI_API_KEY`. Credentials live in `~/.grok/` (`GROK_HOME`), and `grok --no-auto-update` stops self-updates.
- Verified (docs): the permission modes are Ask (the default), Auto (a classifier approves safe tools) and Always-approve (`--always-approve`). They map one to one onto Ask, Auto and Skip all, but whether ACP exposes them as session modes is unknown. Sessions are "the same in the TUI, headless mode, and over ACP", and `grok --resume <id>` exists, so the terminal toggle is likely. The sandbox (off by default) is Seatbelt on macOS and Landlock on Linux; no Windows sandbox is documented. Grok reads `.claude/skills`, `CLAUDE.md` and `AGENTS.md` as well as `.grok/skills`, so BMad skills may reach it with no new folder.
- Reported, not verified: the CLI is in beta for SuperGrok and X Premium+ subscribers, and an API key is billed at token rates. xAI's terms page could not be fetched (HTTP 403), so the terms for third-party clients are unchecked.
- So: Grok can be driven over ACP. No Ogden-written adapter around its CLI or API is needed, unless the spike finds sign-in or the API key unusable over ACP.

### Proposed story outline (for inception; not agreed)

1. Spike: Codex over ACP. Probe on all three OSes, Windows first: install from pins, sign-in, modes, resume, toggle, process-tree stop. Ends with the user's go or no-go (hitl).
2. Spike: Grok over ACP. Same probes, plus how the API key and subscription gating work, and the terms. Ends with the user's go or no-go (hitl).
3. Codex chat: `acp-codex` on `acp-base`, with cards, modes, resume and the toggle.
4. Codex install and sign-in: `setup-codex` (pinned `npm ci`, ChatGPT login or device code, and the API key).
5. Grok chat: `acp-grok`, with cards, modes, resume and the toggle. No custom adapter (user, 2026-10-02).
6. Grok install and sign-in: `setup-grok` (pinned `npm ci` and Sign in with Grok; the API key only if spike 2 found a way).
7. Picker integration: both agents in the picker, Welcome, Settings: Agents and the agent matrix.
8. BMad skills reach Codex and Grok where Planning is on.
9. Refactor sweep.
10. End-to-end suite on three OSes and the v1.1 release.

Lanes after the spikes: Codex (3, 4) and Grok (5, 6) run in parallel. Entry 7 joins them.

### Open questions (for the user)

All five were answered by the user on 2026-10-02; see the Decision lines above. None are open.
