---
type: epic
title: "v1.2: Local models through Ollama or LM Studio, with no account"
parent: initiative-ogden-agents
covers: [CAP-15, CAP-3, CAP-4, CAP-16, CAP-19]
after: []
assignee: ""
risk: high
---

# v1.2: Local models through Ollama or LM Studio, with no account

## Description

The user asked (2026-10-05) for "a way to connect to LM Studio or Ollama for local LLM", with LLM orchestration as the long-term goal. Ogden is open source and free, an "advanced herdr setup": a multi-agent workspace UI for simple users, with herdr-style advanced functionality that can be turned off. A local model fits that: it needs no subscription, no API key and no account, and nothing leaves the machine. This epic adds one more chat agent beside Claude Code, Antigravity, Codex and Grok: a "Local model" whose model is served by Ollama (default `http://localhost:11434`) or LM Studio (default `http://localhost:1234`), both of which speak an OpenAI-compatible `/v1` API. It builds on epic 6's agent-neutral mechanism (the descriptor, `acp-base`, the picker, the generic agent card) and epic 12's additions to it (start `authenticate`, a mode fixed at chat start, a launch that receives the mode and protected paths, plain-words setup notices, the pinned installer and checked-binary installer pattern).

Ogden builds no agent runtime (spec Non-goals). The chat agent must therefore be an existing ACP-speaking harness pointed at the local server. The route is chosen by spike 1 (see Notes, "Route comparison"). The epic also leaves a hook for epic 15 (LLM orchestration, v2), whose headline is a local model acting as the manager of other agents: a small, tool-free `LocalModelPort` that can list models and answer one request in a fixed JSON shape (entry 8).

## Outcome

A user with Ollama or LM Studio already running opens Settings, Agents, presses Detect, picks a model, and chats with it in any project, in Ask mode, with every permission request a card, with no account, no key and no data leaving the computer. The demo: in one Simple project, a Local model chat runs beside a Claude Code chat, and both continue after a server restart.

## Requirements

Drafted at inception (2026-10-05, autonomous; not yet approved by the user). Each line maps to a spec capability in `covers`. CAP-21 (local models) is a proposed spec delta approved in principle on 2026-10-05 (Notes, Decisions); until the spec memlog applies it, lines cite the existing capability ids. Parts earlier epics built are not rebuilt: `Session.agentId`, the registry, `AgentDescriptor`, the agent list with declared modes and readiness refusals (6.2, 6.3), `createAcpAgent(descriptor, quirks)` in `acp-base` (6.4), the picker, project default agent and generic agent card (6.6), epic 12's contracts (12.3), the checked-binary installer (12.4's installer) and the child-process environment allowlist (`packages/adapters/src/child-env.ts`).

- E14-R1: The Local model is one descriptor, one `acp-<route>` adapter of small hooks on acp-base, one `setup-local` adapter and one wiring slot. Core, shared and acp-base name neither Ollama, LM Studio nor the route's harness (architecture test). What the contracts lack is added agent-neutrally first: a descriptor field for "needs no account and no key" (so the readiness card shows endpoint state, not sign-in), a launch hook that writes the harness's config from Ogden's own data (endpoint and model) into the data folder, and a per-endpoint health probe. (CAP-15, CAP-16; AD-1, AD-9, AD-11)
- E14-R2: The user connects an endpoint from Settings, Agents: Ollama or LM Studio or custom, host and port prefilled with the default, a Detect button that probes only `127.0.0.1` and `localhost` on the two default ports with a short timeout (never another host, never a scan), and a Test action. No key field exists. Every host other than loopback (`127.0.0.1`, `localhost`, `::1`) is refused (user decision 2026-10-05). (CAP-16, CAP-19; AD-15, AD-16, AD-21)
- E14-R3: The model list comes from the server (`GET /api/tags` for Ollama, `GET /v1/models` for LM Studio and custom), shown with size and, where the server reports them, context length and tool capability; the user picks the model per project, overridable per chat. A model the server no longer lists is shown as missing with a plain reason, never silently replaced. (CAP-15; AD-8)
- E14-R4: A Local model chat has permission cards (Allow once, Deny, always allow where the harness offers it), normalized states, cancel, and resume (resume, then load, then the stored-transcript fallback). The failures local servers have are plain-words states: server not running, model not loaded or still loading (long first reply), request timed out, context full. (CAP-15, CAP-3, CAP-4; AD-4, AD-5)
- E14-R5: The Local model offers Ask only. Auto and Skip all are not declared by its descriptor, the server refuses them for it, and the picker shows them unavailable with the reason (small local models make more mistakes with tools, so an unattended or unchecked mode is not justified; open question 5). The terminal toggle is offered only if the route's own CLI resumes the ACP session id, else `agent_unsupported`. (CAP-4, CAP-5; AD-4, AD-6, AD-15)
- E14-R6: Nothing leaves the machine. The child process gets the environment allowlist and no key; its endpoint is loopback; the harness's own update checks, telemetry, model-catalog downloads and sharing are switched off by the generated config where the harness has a switch, and the spike's probe records every outbound connection attempt it makes. The card says in plain words that prompts and files stay on this computer, and states the one exception if the spike finds one that cannot be switched off. (CAP-16; AD-15, AD-16)
- E14-R7: The card and the model picker state honestly what small local models are: they follow tool-use instructions less reliably than hosted ones, their context window is set by the server (Ollama's default is small and varies by version; the harness's docs recommend 16k to 32k or more for tool use), and speed depends on the computer. No guarantee is made and no model is recommended as certain. (CAP-15)
- E14-R8: With Planning on, BMad's skills reach the Local model through the route's skill folder, with the invocation formatted by its adapter; with every piece off, no BMad text reaches it and nothing is written to the repo. A caution on the card says BMad skills are long and need a large context. (CAP-15, CAP-19, CAP-6; AD-12, AD-22)
- E14-R9: `LocalModelPort` (core) and its adapter can probe an endpoint, list models, and answer one non-streaming request constrained to a caller-supplied JSON schema, with a "Test as a manager" action on the model picker that runs a fixed small schema prompt and reports pass or fail in plain words. No manager role exists in this epic; this is the hook epic 15 builds on. (CAP-15; AD-1)
- E14-R10: The Local model works on macOS, Windows and Linux; the pinned harness is bumped only by a reviewed change; CI never uses a real model or the real network (a fake OpenAI-compatible server on loopback); live checks with real Ollama and LM Studio on Mac and Windows are recorded by the user; the epic ships as `ogden-agents` v1.2. (CAP-15, within CAP-1; AD-13, AD-19, AD-21)

## Done when

1. Spike 1's result is recorded and the user has said which route is built and go or no-go. A route that fails drops out and the next route in Notes is probed (or the epic stops).
2. In one project with every BMad piece off, a Local model chat against the fake server runs beside a Claude Code chat, shows a permission card that holds a shell command until approved, and continues after a server restart (CAP-15, CAP-3, CAP-4); the same flow is recorded live by the user against real Ollama and real LM Studio.
3. Settings, Agents lets a user with no terminal Detect a running Ollama or LM Studio on localhost, see its models, pick one, and chat, with no key, account or sign-in; no non-loopback connection is made by Ogden or the harness in CI's recorded run, and a non-loopback host is refused with a plain reason (CAP-16).
4. The Local model declares Ask only; the server refuses Auto and Skip all for it (CAP-4).
5. "Test as a manager" runs against the fake server and reports pass for a conforming reply and a plain-words fail for a malformed one, and `LocalModelPort` names no route harness.
6. The end-to-end suite passes on macOS, Windows and Linux with only fakes. The epic is released as `ogden-agents` v1.2 with the live checks recorded.

## Boundaries

Chat with one local model through one ACP harness, on epic 6 and epic 12's mechanism. This epic does not rebuild the registry, picker or shared ACP client.

- Not here: the manager role, routing between agents and models, planner/worker/reviewer (epic 15, v2). Only `LocalModelPort` and the fitness test (entry 8) are here.
- Not here: installing Ollama or LM Studio for the user. The card links to their official download pages and says when none is detected. Starting LM Studio's server or pulling a model is the user's step, explained in plain words (a model download is large; Ogden does not start one).
- Not here: model downloading or deleting, model fine-tuning, embeddings, image models, remote or LAN endpoints, hosted OpenAI-compatible APIs (those need keys and are not "local").
- Not here: builds (unattended runs) with the Local model; epic 5 builds are Claude Code only and a small local model is not trusted to run unchecked.
- Not here: cost, token or usage tracking (spec Non-goals). Local models cost no tokens; nothing is tracked.
- Core, `BuildRunnerPort`, `SandboxPort` and the dispatcher do not change.

## References

- parent — _bmad-output/initiative-ogden-agents/initiative-ogden-agents.md
- spec — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, sections Capabilities (CAP-3, CAP-4, CAP-5, CAP-15, CAP-16, CAP-19), Constraints (ACP, no CLI, guardrails in code, "does not reimplement agent coding"), Non-goals ("An agent runtime of its own", cost tracking)
- agent matrix — _bmad-output/initiative-ogden-agents/spec-ogden-agents/agent-matrix.md
- architecture — _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md, AD-1, AD-4, AD-5, AD-8 (handoff note), AD-15, AD-16 (child environment allowlist), AD-21, AD-22
- epic 6 — _bmad-output/initiative-ogden-agents/epic-every-agent/epic-every-agent.md and its `tickets.toml` (entry shapes to copy)
- epic 12 — _bmad-output/initiative-ogden-agents/epic-v1-1-codex-and-grok/epic-v1-1-codex-and-grok.md and its `tickets.toml` (descriptors with a mode fixed at start, API key cards, the checked-binary installer, Codex's `oss` question)
- external (Ollama) — https://docs.ollama.com/api/openai-compatibility (OpenAI-compatible `/v1`, `/v1/models`, `/v1/responses`, any dummy key; `tool_choice` unsupported)
- external (LM Studio) — https://lmstudio.ai/docs/developer/openai-compat (`http://localhost:1234/v1`, `/v1/models`, `/v1/chat/completions`, `/v1/responses`)
- external (Codex) — https://learn.chatgpt.com/docs/config-file/config-advanced (`--oss`, `--local-provider`, `oss_provider`); https://github.com/agentclientprotocol/codex-acp
- external (OpenCode) — https://opencode.ai/docs/providers/ (Ollama and LM Studio as `@ai-sdk/openai-compatible` providers); https://opencode.ai/docs/acp; https://github.com/anomalyco/opencode (MIT)
- external (Goose) — https://github.com/block/goose (Apache-2.0); https://goose-docs.ai/docs/getting-started/providers
- external (ACP registry) — https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json (checked 2026-10-05: `opencode` v1.18.34, MIT, binary per OS with sha256, `opencode acp`; `goose` v1.53.0, Apache-2.0, binary per OS with sha256, `goose acp`; `codex-acp` v2.1.1, Apache-2.0, npx)

## Notes

### Route comparison (researched 2026-10-05; spike 1 verifies everything marked unverified)

1. **Codex CLI in its local mode, through the merged Codex adapter.** Verified: Codex has `--oss`, `--local-provider ollama|lmstudio` and `oss_provider` in `config.toml`; without a provider `codex exec` errors, the interactive CLI prompts. LM Studio and Ollama both expose `/v1/responses`, which Codex's Responses wire needs. Unverified, and the deciding question: whether `codex-acp` (the ACP adapter, which documents `CODEX_API_KEY` or `OPENAI_API_KEY`, `CODEX_CONFIG` as a JSON config merge and `MODEL_PROVIDER`, and nothing about `--oss`) honours `oss_provider` or a `model_provider` with a loopback `base_url`, and whether it still demands a key or ChatGPT login at `authenticate`. Pros: no new binary, pin, installer or licence; reuses epic 12's adapter, `CODEX_HOME` and cards. Cons: the Codex harness and prompts are tuned for OpenAI's hosted models, with heavy tool schemas that small models handle badly; epic 12 made Codex "API key only" and a local provider that needs no key is a new state of the Codex card; Windows sandbox behaviour stays Codex's (experimental per 12.1); risk that Codex phones OpenAI (plugins, update checks) even in `--oss`.
2. **An open ACP harness with Ollama and LM Studio providers: OpenCode (primary candidate) or Goose (reserve).** Verified: OpenCode is MIT, in the ACP registry as a per-OS binary with sha256 (`opencode acp`), and its docs configure Ollama and LM Studio as `@ai-sdk/openai-compatible` providers with `baseURL` `http://localhost:11434/v1` and `http://127.0.0.1:1234/v1`, a per-model context `limit`, and advice to raise Ollama's `num_ctx` to 16k to 32k when tool calls fail and to choose tool-capable models for LM Studio. Goose is Apache-2.0, in the registry as a per-OS binary with sha256 (`goose acp`), with Ollama (`OLLAMA_HOST`, `GOOSE_INPUT_LIMIT`) and LM Studio providers. Pros: both treat local servers as a first-class case, the harness is designed for model-agnostic tool use, config is data Ogden can generate into its own data folder, and the binary install is the same checked-binary pattern as Grok (12.4). Cons: a new pinned binary, installer entry, descriptor and per-OS checks (a second agent's worth of work); a harness Ogden does not own and must re-verify per bump; unverified for OpenCode: its non-loopback traffic (model catalog fetch, auto-update, share, telemetry) and whether each can be switched off by config or environment; unverified: how its `acp` mode reports permission requests (option kinds), supports `session/load` and `session/resume`, and which skill folders it reads; unverified for Goose: LM Studio provider detail, permission model (Goose has its own modes), ACP resume.
3. **Claude Code pointed at a local gateway** (`ANTHROPIC_BASE_URL`; Ollama 0.14 and later and LM Studio now expose an Anthropic-style `/v1/messages`, which community guides use with Claude Code, recommending 64k or more context). Recommended out. It conflicts with the user's rule that Claude Code is a subscription sign-in agent (using it as a local-model shell is a different, unsupported configuration of someone else's product), the terms for running Claude Code against non-Anthropic models are not something Ogden should assert, the harness prompt and tool set are tuned for Claude and degrade on small models, and Ogden's own AD-16 allowlist would need to carry a base-URL override into Claude Code's environment. Not probed.
4. **An Ogden-built thin local-chat agent speaking ACP.** Recommended out: it is an agent runtime of Ogden's own (spec Non-goal), and the "don't build a fully different solution" rule applies. The only Ogden-owned model code in this epic is the tool-free `LocalModelPort` (entry 8), which does one JSON-shaped request and runs no tools and touches no files.

**Recommendation (autonomous draft; user decision 2026-10-05: route 2 with OpenCode, Codex local mode probed alongside, Goose reserve):** build route 2 with OpenCode as the primary, probing route 1 in the same spike because it is nearly free if `codex-acp` honours a local provider. Why OpenCode: licence and ACP support are verified, config-as-data fits Ogden's descriptor-plus-launch-hook mechanism, a local server is a documented first-class case, and it reuses the checked-binary installer. Why not Codex first: its ACP adapter documents nothing about local providers, and its hosted-model tuning is the wrong fit for 7B to 30B local models. If OpenCode fails on privacy (cannot be kept off the network) or ACP permissions, Goose is the next probe, then route 1.

### Hardware, speed and tool-calling expectations (what is verifiable and what is not)

- Verified from the harness docs: tool calls with Ollama often fail until `num_ctx` is raised to roughly 16k to 32k; Ollama's `/v1` does not support `tool_choice`; LM Studio users should pick models whose card says tool use is supported.
- Not verified here and not promised: tokens per second and memory per model size. Rules of thumb for the card's copy, to be checked by the user's live checks: 7B to 8B models run on 16 GB laptops and are weak at multi-step tool use; coding agents need 30B-class models and 32k context or more to be dependable, which means 24 GB or more of unified memory on a Mac or a recent GPU with 16 GB or more VRAM on Windows; a model loading for the first time can take tens of seconds before the first token.
- Context is the server's setting, not Ogden's: Ogden shows the context length the server reports and warns when it is below a floor chosen by spike 1 (proposed 16k). Long BMad skills and large repos will not fit small contexts; the adapter must surface a "context full" state, not a silent truncation.
- A small local model may emit malformed tool calls. The harness decides how to recover; Ogden's contribution is that permission cards still gate every command and that the chat shows a plain error rather than a hang.

### CI and live checks

- CI: a fake OpenAI-compatible server on loopback (in the repo's test fixtures, extended from the fake ACP agent pattern) serving `/v1/models`, `/api/tags`, `/v1/chat/completions` (streaming, with and without `tool_calls`, and a malformed reply), `/v1/responses`, slow-first-token, 404 model-not-found, and connection refused. No real model, no real network; a loopback-only network assertion (every connection attempt by the harness and Ogden is recorded, and any non-loopback attempt fails the test). The harness binary itself is the pinned real one installed on all three OSes (spike, tracer, e2e), talking to the fake server.
- Live checks (hitl, the user's, on a Mac and on Windows, with a small and a larger model, in a scratch repo): Ollama and LM Studio each running; Detect finds them; a model is chosen; a chat answers; a shell command shows a card; Deny works; a restart resumes; the model is unloaded mid-chat and the plain-words state shows; Ask-only is enforced; unplug the network and chat still works; a firewall or packet log shows no outbound traffic from Ogden or the harness; the "Test as a manager" action on a small and a larger model.

### Assumptions and decisions

- Assumption: the route chosen by spike 1 is one ACP harness; the descriptor id is `local` and the picker label is "Local model" with the harness named only on the card ("runs through OpenCode"). If the user prefers the harness's name or a different label, only data changes.
- Assumption (open question 1): Ask is the only mode (see E14-R5); Auto is revisited only after live evidence on a larger model and only if protected paths stay guarded, as for Codex and Grok (12 Notes, question 1).
- Assumption: Detect probes `127.0.0.1` and `localhost` on 11434 and 1234 only, and only when the user presses it (nothing probes in the background at start). No LAN scanning, ever.
- Assumption: the model name is a free string from the server's own list (the model identity is the user's, not Ogden's); no model catalogue or recommendation list ships in Ogden.
- Assumption: this epic is v1.2 and merges after v1.1 (epic 12) ships, so a half-built Local model never shows in an earlier release; it is registered only once its chat entry fills the slot.
- Assumption: the Local model needs no secret, so AD-16 gains no new key; the child gets only the allowlist (and the route's home variable pointing into the data folder). A server on loopback that the user protected with its own key (LM Studio can require one) is not supported in v1.2 (open question 2).
- Assumption: `after` on epic 12 names its release (12.11) because the pinned-binary installer, descriptor mode-at-start contract and API-key card patterns all ship there.

### Decisions (user, 2026-10-05)

- Decision (2026-10-05, user): a tool-free model call (`LocalModelPort`, and epic 15's manager) is acceptable and is not "an agent runtime of its own". Record it as an AD-1 note (proposed delta below). Add CAP-21 (local models: a user connects a locally served model and chats with it with no account, key or network use) and CAP-22 (orchestration, owned by epic 15) as proposed spec deltas, to go in through a `bmad-spec` memlog, never by hand. `covers` keeps the existing ids until the spec delta is applied, then CAP-21 is added.
- Decision (2026-10-05, user): route is OpenCode (a new pinned, hash-checked third-party binary, MIT) probed in spike 14.1 alongside Codex's local mode; Goose is the reserve.
- Decision (2026-10-05, user): endpoints are loopback only; every non-loopback host is refused (E14-R2, entry 3's validator, entry 4's card).

### Open questions (batched for the user; none blocks the drafts; each carries a recommended default, marked as an assumption the user can overrule)

1. Modes (was 5): Ask only for local models. Assumption: yes; Auto is revisited only after live evidence on a larger model and only if protected paths stay guarded.
2. A local server that requires its own key (was 6): out of v1.2. Assumption: yes.
3. Visibility and platforms (was 7): the picker lists "Local model" always, with Welcome showing it first only when an endpoint was detected, and Welcome gets a "no account needed" path for it. Linux is covered by CI with fakes; live checks are Mac and Windows (the user's stated checks). Assumption: yes.
4. Card copy (was 8): the card warns below a 16k context floor (set by spike 14.1) and says "30B-class models for dependable tool use"; Ogden only links to Ollama's and LM Studio's official pages and never pulls a model or starts a server (AD-21 stays true). Assumption: yes.
5. Other items (was 9): the model name is a free string from the server's list with no catalogue; detection runs only when the user presses Detect, never in the background; this epic merges after v1.1 ships. Assumption: yes.
6. Terms re-check (was 10): spike 14.1 re-checks OpenCode's licence and any hosted-service terms; no re-check of other vendors is needed here because no other vendor is involved. Assumption: yes.

### Deltas proposed for the spec, architecture and matrix (not applied; the user approves with the inception)

- Spec (approved in principle 2026-10-05, via `bmad-spec` memlog): CAP-21 local models and CAP-22 orchestration (epic 15); CAP-16 intent gains "or needs no account at all (a local model)"; Non-goals: "model downloading or hosting" and a clarification that a tool-free model client is not "an agent runtime".
- `agent-matrix.md`: a Local model row from spike 1's proposed row (modes: Ask only; resume; terminal; skills folder; install; licence).
- AD-1 note (approved 2026-10-05: a tool-free model client is not an agent runtime; also `TeamRoster` types in shared): `LocalModelPort`, a core port with an adapter `local-model-openai` (names no vendor). AD-15 note: Ogden's own outbound connections are to loopback only for local models. AD-16 note: no key, the generated config lives in the data folder, nothing from the user's own `~/.config` is read. AD-21 note: Ollama and LM Studio are installed by the user as apps; Ogden never runs their CLIs.
- EXPERIENCE.md: the Local model card (Detect, models, caveats) and the picker's unavailable-mode reasons.

### Waits on

- Waits on epic 12 because: the descriptor contract with a mode fixed at start, the checked-binary installer pattern and the plain-words notices are 12.3 and 12.4, and its release (12.11) is v1.1.
- Waits on epic 6 because: the registry, `acp-base`, picker and generic card are 6.3, 6.4 and 6.6.
- Waits on epic 4 because: BMad setup (4.3) and planning sessions (4.6) are what the skills entry reaches.
- Waits on epic 10 because: the pieces guard (10.2) and its simple-project test (10.6).
