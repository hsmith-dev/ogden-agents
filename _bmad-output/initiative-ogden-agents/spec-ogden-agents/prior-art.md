# Prior art (checked 2026-09-29; license/v1.2-ideas sweep added 2026-10-07)

| Project | Has | Lacks relative to Ogden Agents | Role in Ogden Agents |
|---|---|---|---|
| BMAD method v7 (MIT) | Process skills; file-based ticket tree; `tickets.py`; `bmad-build-auto`; setup scripts | Any UI or server; a dispatch loop; chat persistence | The process, reused as is |
| [bmad-loop](https://github.com/bmad-code-org/bmad-loop) (official, MIT, Python/uv) | Deterministic loop (pick → implement → adversarial review → verify → commit); profiles for Claude Code, Codex, Gemini, Copilot, Antigravity; HITL gates; token totals; terminal (TUI) dashboard | A browser UI, chat sessions, permission cards, and a terminal toggle; the planning phase; it reads v6 `sprint-status.yaml` or `stories.yaml`, not v7 `tickets.toml` | Forked: dispatcher and agent profiles, with v7 support added in the fork and sent upstream |
| [bmad-method-ui](https://github.com/lorenzogm/bmad-ui) (npm `bmad-method-ui` 0.2.0, MIT, 17 stars, no releases) | React 19/Vite/TanStack/Tailwind dashboard for monitoring workflows and sprints; installs into a BMAD project | Agent control and chat sessions; appears to target the v6 `_bmad-output/planning-artifacts` layout | Reference for the board UI (not forked) |
| [acp-ui](https://github.com/formulahendry/acp-ui) | A cross-platform ACP client (desktop, mobile, web) for Claude, Codex, Copilot, Gemini and more | Any BMAD awareness, ticket board, or dispatch | Reference for the multi-agent chat layer |
| [claudecodeui](https://github.com/Samadaeus/claudecodeui), Claude-Code-Web-GUI | Browser UIs for Claude Code sessions | Any BMAD awareness; Claude only | Reference for the chat and terminal patterns |
| AgentProto (open source, MIT code / CC-BY-4.0 spec docs) | One open-source runtime managing roughly 14 named agent adapters under one interface, exposing roughly 175 MCP tools | Any BMAD awareness, ticket board, browser chat persistence, or a terminal toggle | Safe to study and reuse code from, with attribution (MIT, no copyleft) — a reference for multi-adapter agent management |
| [`@runtypelabs/persona`](https://www.npmjs.com/package/@runtypelabs/persona) (npm, open source, MIT) | A full agentic chat-widget UI library: streaming, voice I/O, reasoning display, artifacts | Any BMAD awareness, ticket board, or multi-agent dispatch | Safe to study and reuse code from, with attribution — a reference for the chat widget layer, not just layout patterns |
| [Moltis](https://github.com/moltis-org) (open source, MIT) | A personal AI gateway written in Rust | Any BMAD awareness, ticket board, persona/CRUD UI, or memory workspaces (an earlier summary mis-described it as persona CRUD with "souls" and memory workspaces — corrected here: it is a gateway, not that) | Safe to study and reuse code from, with attribution — a reference for a local gateway architecture |

Nothing found combines guided BMAD planning, a choice of agents, browser chat persistence, permission cards, a terminal toggle on the same session, and a board over the v7 ticket tree in one local install.

## Inspiration-only and unconfirmed (v1.2 ideas sweep, 2026-10-07)

Checked while studying persona/role presets, explicit agent handoff artifacts, and visible pipeline UX for v1.2. These are not MIT and are not available to borrow from or fork; only publicly-described UX/behavior can inform design, same as studying any closed competitor.

| Project | License status | What can be used |
|---|---|---|
| [AgentsRoom](https://agentsroom.dev) | NOT open source — closed commercial freemium product (a desktop Kanban board that spawns Claude agents on drag) | Only its publicly-described UX/behavior as design inspiration; never its code |
| Honeycomb Agent Timeline (Honeycomb.io, Early Access) | NOT open source — a proprietary SaaS feature | Only the publicly-described UX pattern conceptually: unifying LLM calls, tool calls, and agent handoffs by conversation ID in one trace view; never code |

**Unconfirmed — do not cite as a source.** [AgentCenter](https://agentcenter.cloud) was checked twice and remains unverified both times: no homepage, repo, or pricing found independently of the original claim about it. Treat it as claimed but unconfirmed; do not rely on it or cite it until it can be independently verified.
