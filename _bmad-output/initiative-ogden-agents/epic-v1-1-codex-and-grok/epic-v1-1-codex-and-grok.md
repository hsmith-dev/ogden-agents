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

Written at inception (2026-10-04, autonomous draft, not yet approved), as epic 6 did for Antigravity. Each line maps to a spec capability in `covers` and names the architecture decisions it carries. It works within CAP-1, CAP-4, CAP-6, CAP-17 and CAP-19, which it does not own. Parts earlier epics built are not rebuilt: from epic 6, `Session.agentId`, the agent registry, `AgentDescriptor` and the agent list with declared modes and readiness refusals (6.2, 6.3; `packages/core/src/agent-descriptor.ts`), the shared ACP client `createAcpAgent(descriptor, quirks)` (6.4; `packages/adapters/src/acp-base`), and the picker, project default agent, generic agent card and Welcome's agent choice (6.6); from epic 4, the per-project trust store (4.2; `workspace.bmad_scripts_trusted`), BMad setup (4.3) and planning sessions (4.6); from epic 9, `AgentSetupPort`, install from pins and the keychain API key path; from epic 3, terminal availability and `AgentTerminalResume`. Epic 6's Antigravity stories (6.5, 6.7, 6.8) are the pattern for each agent's chat, setup and skills.

- E12-R1: Codex and Grok are each one descriptor, one `acp-<agent>` adapter of small hooks on acp-base, one `setup-<agent>` adapter and one wiring slot. Core, shared and acp-base name neither (architecture test). What acp-base and the setup contract lack for them is added agent-neutrally first: `authenticate` at start, Deny's option chosen by id when several are `reject_once`, a permission mode fixed at chat start and given in `_meta`, a launch that gets the chat's mode and protected paths, sign-out, plain-words setup notices, and the project trust action. (CAP-15; AD-1, AD-9, AD-11)
- E12-R2: Codex chats through `codex-acp` with permission cards (Allow once is `allow_once`; Deny is the `decline` option, never `cancel`, `allow_always` or an amendment), normalized states and resume (resume, then load, then the stored-transcript fallback). Ask is `read-only`, set explicitly because Codex starts in Auto; Skip all is `agent-full-access` under the Developer mode gate; Auto is `agent` only if Codex can keep Ogden's protected paths guarded, else not offered; `workspace-write` is never offered. Its files live in `CODEX_HOME` in the data folder; `CODEX_PATH` is never set. (CAP-15, CAP-3, CAP-4; AD-4, AD-5)
- E12-R3: Grok chats through its native `grok agent stdio`, spawned from Ogden's own verified binary with `GROK_HOME` in the data folder and self-update off. Its mode is set once at chat start in `_meta`: Ask by default, Skip all `yoloMode` under the Developer mode gate, Auto `autoMode` only if protected paths stay guarded. Ogden's mode wins over a project's `.claude/settings.json`. Because Grok runs the project's hooks and `.mcp.json`, a Grok chat starts only in a project the user trusted (4.2's trust). Cards, states and resume as E12-R2. (CAP-15, CAP-3, CAP-4; AD-4, AD-5, AD-22)
- E12-R4: Codex is installed (pinned `npm ci` into `<dataDir>/agents/codex/`), signed into with ChatGPT login, or given an API key (`agent-api-key/codex`, reaching only Codex's process), from the UI. The card shows that Codex keeps its sign-in in a plain `auth.json` in the data folder, removed on sign-out, and that it downloads OpenAI's plugins repository at start. (CAP-16; AD-15, AD-16, AD-21)
- E12-R5: Grok is installed (pinned download, binary decompressed and SHA-256-checked by Ogden into `<dataDir>/agents/grok/`, never `~/.grok`), signed into with Sign in with Grok, or given an API key (`agent-api-key/grok`, through the unadvertised `xai.api_key`, offered only while the pinned version accepts it), from the UI. (CAP-16; AD-15, AD-16, AD-21)
- E12-R6: With Planning on, BMad's skills reach each go agent: Codex through `.agents/skills`, Grok through `.claude/skills`, each adapter formatting the invocation; with every piece off, no agent gets BMad text and nothing is written to the repo. (CAP-15, CAP-19, CAP-6; AD-12, AD-22)
- E12-R7: The terminal toggle is offered for an agent only where its CLI (`codex resume`, `grok --resume`, with its home variable) resumes the ACP session id, per OS; otherwise `agent_unsupported`. `agent-matrix.md` records it. (CAP-5; AD-6, AD-19)
- E12-R8: Each go agent works on macOS, Windows and Linux; pinned versions are bumped only by a reviewed change; each agent's live checks are recorded; the epic ships as `ogden-agents` v1.1. (CAP-15, within CAP-1; AD-13, AD-19, AD-21)

## Done when

1. Each agent's spike result is recorded, and the user has said go or no-go for Codex and for Grok. A no-go agent moves back to epic 8 (v2), and nothing below applies to it.
2. In one project with every BMad piece off, a Claude Code chat runs at the same time as a chat with each go agent. Each shows permission cards that hold a shell command until it is approved, and normalized states. After a server restart, every chat continues with its context (CAP-15, CAP-3).
3. Each go agent offers only the modes it declares (Ask, Auto, Skip all). A mode it does not declare is shown unavailable and the server refuses it.
4. On a fresh machine, a user installs each go agent from the UI and signs in with the agent's subscription sign-in (ChatGPT login for Codex, Sign in with Grok for Grok). Another user chats with only an API key (for Grok, through `xai.api_key`, found by spike 12.2), and no key appears in the database, the event log or the logs (CAP-16).
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

Status: envelope drafted autonomously 2026-10-02; the user said go for Codex and Grok the same day (conditions below). Full inception drafted autonomously 2026-10-04 (entries 3 to 11 in `tickets.toml`, Requirements above): not yet approved by the user, not published. See "Inception draft (2026-10-04)" below for its decisions, proposed deltas, assumptions and open questions.

- Decision (2026-10-02, user): "we need to add v1.1: Codex and Grok features". Codex moves here from epic 8 (v2). Grok is new to the plan.
- Decision (2026-10-02, user; was open question 1, Grok route): Grok's subscription "Sign in with Grok" over ACP (`grok agent stdio`) is the main route. An xAI API key is added only if the spike finds a way to give one over ACP. No custom Ogden adapter around the Grok CLI or API.
- Decision (2026-10-02, user; was open question 2, sign-in versus terms): same rules as Antigravity. Subscription sign-in is allowed for Codex (ChatGPT login) and Grok, with API keys where the agent supports them.
- Decision (2026-10-02, user; was open question 3, OSes): macOS, Windows and Linux are all required. Each agent's spike probes all three, Windows first, and ends with a go or no-go for that agent.
- Decision (2026-10-02, user; was open question 4, builds): v1.1 is chats only: chat, install, sign-in, agent picker integration and BMad skills. Builds with Codex and Grok come in a later release (epic 8, v2, unless re-planned).
- Decision (2026-10-02, user; was open question 5): the shared agent-choice groundwork (contracts, the shared ACP client, the picker) stays in epic 6 whatever Antigravity's go or no-go; only epic 6's Antigravity-specific stories depend on it. This epic therefore always waits on epic 6's groundwork and never rebuilds it.
- Inception: the full inception (stories in `tickets.toml`) happens later, after epic 6. (Done as a draft 2026-10-04, after 6.2, 6.3, 6.4 and 6.6 were built.)
- Decision (2026-10-02): `tickets.toml` holds only the two spikes, 12.1 (Codex) and 12.2 (Grok). They probe the agents alone and do not wait on epic 6, so neither carries the epic's `after`; the stories added at inception will. Results and recommendations are in each spike's plan beside this file; the go or no-go per agent is the user's and is recorded here when given.
- Decision (2026-10-02, user; spike 12.1): GO for Codex, pending the user's live checks on all three OSes (ChatGPT login and API key, permission choices, mode switching, resume, skills in `.agents/skills`, the Windows sandbox). Both sign-in routes stay. Codex's files live in Ogden's data folder (`CODEX_HOME`), not `~/.codex`. Its plain-file `auth.json` key storage is shown to the user as a known limitation, and the file is removed on sign-out. The plugins-repo download at start is network behaviour Ogden discloses.
- Decision (2026-10-02, user; spike 12.2): GO for Grok after the user reads xAI's current terms (the page blocked automated reading) and the live checks pass. The API key through the unadvertised `xai.api_key` method is allowed. Ogden unpacks the pinned binary and runs it with its own `GROK_HOME`. Because Grok follows the project's `.claude/settings.json`, hooks and `.mcp.json`, a Grok chat in a project starts only after the user has trusted that project (the same per-project trust as the board, story 4.2's gate).
- Decision (2026-10-02, user): the rest of this epic's inception (the stories after the spikes) happens after epic 6's groundwork lands.
- Assumption: release target is `ogden-agents` v1.1, after v1 (epics 1 to 7) ships. This epic is placed after epic 7 in the initiative's build order, under its own v1.1 heading.
- Assumption: agent ids `codex` and `grok`; product names "Codex" and "Grok"; adapters `acp-codex`, `setup-codex`, `acp-grok`, `setup-grok`.
- Waits on epic 6 because: the agents-as-a-choice contracts (6.3), the shared ACP client in `acp-base` (6.4), the picker and default agent (6.6), epic 6's sweep (6.9, which survives Antigravity's no-go and orders this epic after 6.5, 6.7 and 6.8) and v1's release (6.10). Waits on epic 4 because: the trust store (4.2), BMad setup (4.3), planning sessions (4.6) and its release (4.13). Through epic 6 it also waits on epics 2, 3, 9 and 10. (Updated 2026-10-04.)
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

### Proposed story outline (2026-10-02; superseded by the 2026-10-04 inception draft)

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

Open items after the go decisions (2026-10-02):

- Codex: the user's live checks on Windows, Linux and macOS (spike 12.1's list).
- Grok: the user reads xAI's current terms, then runs the live checks (spike 12.2's list).
- Inception of the remaining stories, after epic 6's groundwork lands.

### Inception draft (2026-10-04, autonomous; for the user's approval)

Read: this epic and both spike plans; epic 6's file, `tickets.toml` and the 6.2, 6.3, 6.4 and 6.6 plans and code on `origin/story/6.6-agent-picker` (`AgentDescriptor`, `createAcpAgent` and its quirks, `AgentSetupPort`, `ChatOptions.projectTrusted`, `PROTECTED_PATHS`, the Claude Code descriptor and guards); epic 4's trust decision and `bmad-script-trust.ts` on `origin/story/4.13-e2e-and-release`.

What the groundwork lacks for Codex and Grok (found in the code, so entry 3 exists although 6.3 froze the contracts):
- acp-base never calls `authenticate`; Codex refuses `session/new` until it is called, and Grok refuses even with `XAI_API_KEY` set until `authenticate xai.api_key`.
- acp-base picks options by kind; Codex offers two `reject_once` options, and only `decline` keeps the turn.
- acp-base sets modes with `session/set_mode`; Grok has no session modes, only `_meta.autoMode` and `_meta.yoloMode` at `session/new`, and a slash command mid-chat.
- The Auto guard is a `sessionMeta` quirk only (Claude's ask rules in `_meta`); an agent that takes guards only at launch has no way in.
- `AgentSetupPort` has no sign-out, and the setup status has no place for plain-words notices (the `auth.json` limitation, the plugins download).
- `ChatOptions.projectTrusted` is not wired (start.ts: "No project is trusted until … story 4.2"), so every agent with `needsProjectTrust` is refused with no action; epic 4 built the store on its own branch.

- Decision (2026-10-04, inception draft): build order 1, 2, 3, 4, then two lanes, Codex (5 chat, 6 install and sign-in) and Grok (7 chat, 8 install and sign-in), then 9 skills, 10 sweep, 11 suite and v1.1 release. Entries 3 and 4 own every file both lanes would touch (acp-base, core, shared, start.ts wiring slots, the adapters index, the fake agent, protected paths, redaction, pins tooling, the shared installer), so 5 to 8 touch only their own adapter folders.
- Decision (2026-10-04, inception draft): no separate tracer bullet. Epic 6's tracer (6.2) already proved two agents in one project; 5 and 7 each end in a live chat beside Claude Code, which is this epic's demo per agent. No separate picker story: 6.6's picker, default agent, Welcome choice and generic agent card list any registered agent, so registering Codex and Grok is enough.
- Decision (2026-10-04, inception draft): 5 waits on spike 12.1 and 7 on spike 12.2 being done (live checks passed; for Grok also the user's terms read), as 6.5 waited on 6.1. Entries 3 and 4 do not wait on the spikes: 3 names no agent, and 4's descriptors come from the spikes' recorded results. A no-go drops that agent's chat and setup entries and its parts of 4, 9 and 11.
- Decision (2026-10-04, inception draft): `after` pins epic 6 at 6.4 and 6.6 (6.3 through them) and the release at 6.10; epic 4 at 4.2 (trust store), 4.3 and 4.6; 10.6; and 3.8 for the Windows terminal, as 6.5 did. 6.5, 6.7 and 6.8 are patterns only, never prerequisites, because they are dropped on Antigravity's no-go; instead 3 waits on 6.9 (epic 6's sweep, built on either path), which orders this epic after any Antigravity work that touches the same files (`.agents` in protected paths, `.agents/skills`, acp-base, the fake agent, the agent card). 3 also waits on 4.13 so epic 4's start.ts and trust prompt changes are in. The initiative's epic 12 line now names 6.3, 6.4, 6.6 and 6.10, and epic 4; this fixes the earlier `unpinned_after` notice (epic 12 on epic 6 with no entry naming it).
- Decision (2026-10-04, inception draft): a refactor sweep (10) and a closing end-to-end suite with the release (11), as every epic.
- Assumption: Codex and Grok are registered in a shipped install only once their chat entry fills the slot, and epic 12 merges to `main` after v1 ships, so no half-built agent shows in a v1 release.
- Assumption: a pinned-npm installer is extracted from `setup-claude-code/install.ts` in entry 4 and shared by Claude Code, Codex and Grok, with Claude Code's behaviour unchanged.
- Assumption: Ogden's existing per-project trust (`workspace.bmad_scripts_trusted`, 4.2) is the trust Grok needs (user, 2026-10-02: "the same per-project trust as the board"); its prompt is reworded to cover an agent's hooks and MCP servers.
- Assumption: Grok's mode is fixed for a chat's life (user brief: "per-chat Auto/Skip all at session create"); the mid-chat `/always-approve` and `/auto` commands are not used.
- Assumption: `.codex` and `.grok` are protected through a descriptor field (entry 3), because the architecture test forbids `codex` and `grok` in core; `.agents` joins core's protected paths in entry 4 unless 6.5 already added it.
- Assumption: each API key check uses a vendor call that costs nothing (OpenAI `GET /v1/models`; xAI `GET /v1/api-key` or `/v1/models`); unverified.
- Validation (2026-10-04): independent set and tree checks ran on the draft in two separate agents; `tickets.py status` is clean (no cycle, drift or `unpinned_after`). Fixed: `.codex` and `.grok` come from descriptors (architecture test); 5 and 7 say how their live checks install and sign in, and 4's installer unpacks and hash-checks Grok's binary; collisions with 6.5, 6.7 and 6.8 removed by 3 waiting on 6.9, and with epic 4 by waiting on 4.13; slot switches live in each agent's folder; key-check endpoints marked unverified; 9 says a no-go agent drops out; E12-R8 cites CAP-1 as worked within; the spike plans' old story numbers updated; this line's stale epic 6 reason updated. Left for the user: the proposed deltas and open questions 1 to 7.
- Handoff (not applied, epic 4): 12.3 wires 4.2's trust store into `ChatOptions.projectTrusted` and rewords the trust prompt for agents; epic 4's Notes should record it.
- Handoff (not applied, epic 6): its line "Codex … are v2 (epic 8)" is stale; Codex is v1.1 (epic 12).
- Handoff (not applied, epic 8): V4's builds with Codex and Grok need acp-codex and acp-grok, so epic 8's `after` should name epic 12; and a no-go agent from this epic moves back to epic 8.

Proposed deltas (not applied; for the user, through `bmad-spec` and `bmad-architecture`):
- Spec CAP-15 and Non-goals: Codex and Grok are v1.1 chat agents (not v2); their builds stay v2. Initiative: a dated note and the v1.1 heading's Done when.
- `agent-matrix.md`: Codex and Grok rows, from the spikes' proposed rows, finalized at entry 11 with no verify cell.
- AD-1 note: an agent is a descriptor plus quirks; the quirks gain start authentication, Deny by option id, a mode fixed at chat start, and a launch-time guard (entry 3).
- AD-16 note: Codex stores its credentials as a plain `auth.json` in the data folder (user-accepted limitation, shown on the card, removed on sign-out); Grok's sign-in token lives in `GROK_HOME` in the data folder.
- AD-21 note: Grok is installed by downloading the pinned npm package and decompressing and hashing the binary itself; npm's launcher is never used.
- AD-22 note: per-project trust now also gates agents that run a project's own settings, hooks and MCP servers (Grok), not only BMad scripts.
- EXPERIENCE.md: the trust prompt opened from the agent picker, a fixed-mode chat's mode picker, Sign out and notices on the agent card.

Open questions (for the user; each entry proceeds on the assumption or recommendation given):
1. Codex Auto and protected paths: Codex's `agent` mode asks only about actions it judges unsafe, and its sandbox is not known to guard `.claude`, `.mcp.json`, `CLAUDE.md` or `AGENTS.md` (unverified; not probed by 12.1). Recommendation: entry 5 offers Auto only if it can make Codex ask before writing every protected path (sandbox or rules at launch or session start) and tests it; otherwise Ask and Skip all only, as Antigravity. Same rule for Grok's `autoMode` (entry 7). Agree?
2. Codex plugins download: is disclosure on the agent card enough, or should Ogden ask consent before the first start, or turn it off by config if Codex allows? Recommendation: disclose (the user's decision), and turn it off only if a config switch exists and nothing breaks.
3. Grok honours the repo's `.mcp.json` (and hooks): is the per-project trust enough, or should Ogden stop Grok from starting repo MCP servers (if Grok has a switch)? Recommendation: trust is enough, since Claude Code also reads `.mcp.json`; say so in the trust prompt.
4. Should a project already trusted for the Board count as trusted for Grok, or should the first Grok chat ask again with the agent wording? Recommendation: one trust, asked again once if it was given before the wording changed.
5. Codex key storage: keep the plain `auth.json` (decided), or try Codex's keyring credential store first and fall back to the file? Recommendation: keep the decision; entry 6 records whether an environment-only key avoids the file.
6. If one agent is a no-go, does v1.1 ship with the other alone? Recommendation: yes.
7. Who applies the proposed spec, architecture and UX deltas, and when? Until they are applied, entries 5 to 11 contradict the spec's "Codex is v2". Recommendation: apply them through `bmad-spec` and `bmad-architecture` at approval of this inception, before entry 3 starts; entry 11 still writes the final agent-matrix rows.

