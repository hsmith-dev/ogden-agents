# Prior art (checked 2026-09-29)

| Project | Has | Lacks relative to Ogden Agents | Role in Ogden Agents |
|---|---|---|---|
| BMAD method v7 (MIT) | Process skills; file-based ticket tree; `tickets.py`; `bmad-build-auto`; setup scripts | Any UI or server; a dispatch loop; chat persistence | The process, reused as is |
| [bmad-loop](https://github.com/bmad-code-org/bmad-loop) (official, MIT, Python/uv) | Deterministic loop (pick → implement → adversarial review → verify → commit); profiles for Claude Code, Codex, Gemini, Copilot, Antigravity; HITL gates; token totals; terminal (TUI) dashboard | A browser UI, chat sessions, permission cards, and a terminal toggle; the planning phase; it reads v6 `sprint-status.yaml` or `stories.yaml`, not v7 `tickets.toml` | Forked: dispatcher and agent profiles, with v7 support added in the fork and sent upstream |
| [bmad-method-ui](https://github.com/lorenzogm/bmad-ui) (npm `bmad-method-ui` 0.2.0, MIT, 17 stars, no releases) | React 19/Vite/TanStack/Tailwind dashboard for monitoring workflows and sprints; installs into a BMAD project | Agent control and chat sessions; appears to target the v6 `_bmad-output/planning-artifacts` layout | Reference for the board UI (not forked) |
| [acp-ui](https://github.com/formulahendry/acp-ui) | A cross-platform ACP client (desktop, mobile, web) for Claude, Codex, Copilot, Gemini and more | Any BMAD awareness, ticket board, or dispatch | Reference for the multi-agent chat layer |
| [claudecodeui](https://github.com/Samadaeus/claudecodeui), Claude-Code-Web-GUI | Browser UIs for Claude Code sessions | Any BMAD awareness; Claude only | Reference for the chat and terminal patterns |

Nothing found combines guided BMAD planning, a choice of agents, browser chat persistence, permission cards, a terminal toggle on the same session, and a board over the v7 ticket tree in one local install.
