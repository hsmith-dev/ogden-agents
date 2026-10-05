---
id: SPEC-ogden-agents
companions:
  - architecture-diagrams.md
  - bmad-integration.md
  - ogden-carryover.md
  - prior-art.md
  - agent-matrix.md
  - delivery-phases.md
  - ../architecture-ogden-agents/architecture-ogden-agents.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Ogden Agents

## Why

A vision and a gap. Coding agents like Claude Code, Codex and Gemini are the strongest workers available, and the BMAD method gives them a disciplined process, but both live in a terminal: nothing lets a non-developer plan, dispatch, watch, and approve agent work from a browser. BMAD's own docs say `bmad-build-auto` never picks work, so something else must run the loop. The official orchestrator, bmad-loop, is terminal-only and does not read the v7 ticket tree. bmad-method-ui only monitors (see `prior-art.md`). Ogden proved the value of a browser control panel with scheduling and approval gates, but it was its own agent runtime and its planning was too thin: its agents produced incoherent code (Ogden commit `b5af7c3`). Ogden Agents is a new, single-install local app. Like herdr, it gives each project its own workspace and keeps agents running across many projects at once. The user's chosen agent does the work, the whole of BMAD (reused as much as possible) supplies the process for projects that want it, and a modern browser UI makes it manageable by anyone without a CLI, while advanced users keep one.

## Capabilities

- **CAP-1**
  - **intent:** A user installs and launches Ogden Agents with one command, and the browser UI opens.
  - **success:** On a fresh macOS, Windows, or Linux machine, `npx ogden-agents` gets the user to a first browser chat with no further commands.
- **CAP-2**
  - **intent:** A user who turns on BMad Method for a project sets it up there from the UI. A repo that already has it is detected and offered, never changed.
  - **success:** The repo gains a working `_bmad` setup that reports current, with no terminal use.
- **CAP-3**
  - **intent:** Users hold persistent browser chat sessions with whichever supported agent they select, listed and resumable. Agents that can't resume a session reopen from Ogden Agents's stored transcript.
  - **success:** After a server restart, a reopened chat continues with its prior context. This is demonstrated with at least two different agents (Claude Code and Antigravity; if epic 6's spike is a no-go, the several-agents part moves to v2, user 2026-10-02).
- **CAP-4**
  - **intent:** Agent permission requests appear as allow-once / always-allow / deny cards in the UI, governed by a caution level set per project.
  - **success:** A requested shell command does not run until it is approved in the UI.
- **CAP-5**
  - **intent:** An advanced user toggles to the selected agent's real interactive CLI on the same session, with only one side driving at a time. The toggle appears only for agents whose chat session can be resumed in their own CLI.
  - **success:** The user switches to the terminal mid-session, sends a message there, switches back, and the UI shows that message and continues the session.
- **CAP-6**
  - **intent:** In a project with Planning turned on (CAP-19), a user goes from an idea to a brief or spec, then to ticketed epics, through plain-language actions, without knowing skill names.
  - **success:** A user produces a spec and a ticketed epic using only UI chat and buttons.
- **CAP-7**
  - **intent:** In a project with Board turned on (CAP-19), a board shows the v7 ticket tree (initiatives, epics, stories, statuses, prerequisites, ready items) and stays in sync with the files in both directions.
  - **success:** A status change an agent writes to a file appears in the UI within seconds, and a status change made in the UI lands in the plan file.
- **CAP-8**
  - **intent:** In a project with Unattended builds turned on (CAP-19), unattended builds dispatch `bmad-build-auto` per ticket in isolation, respecting prerequisites and a concurrency limit, either for one ticket or autonomously.
  - **success:** Two ready, independent tickets build in parallel without touching each other's files, and a ticket with an unmet prerequisite is not dispatched.
- **CAP-9**
  - **intent:** In a project with Unattended builds turned on (CAP-19), each run streams live: activity, tool calls, final status, and a plain-language reason if blocked, with a Retry action.
  - **success:** A blocked run shows its reason, and Retry resumes it from the correct status.
- **CAP-10**
  - **intent:** In a project with Unattended builds turned on (CAP-19), after every run, the system itself verifies the outcome: the plan status, an independent re-run of the tests, and a non-empty diff.
  - **success:** A run that claims success but whose tests fail is shown as failed.
- **CAP-12**
  - **intent:** In a project with Unattended builds turned on (CAP-19), a user reviews a diff and its review findings, then approves (merge and mark done) or rejects and retries.
  - **success:** Approving a built ticket merges its branch and marks it done, and no ticket reaches done without approval.
- **CAP-13**
  - **intent:** In a project with Retrospectives turned on (CAP-19), when an epic completes, a retrospective records evidence-based findings and adds recurring pitfalls to the project's `AGENTS.md`.
  - **success:** After an epic completes, a retrospective file exists and later runs include the new pitfall.
- **CAP-14**
  - **intent:** In a project with Unattended builds turned on (CAP-19), users are notified when a ticket is blocked or is ready for review.
  - **success:** Each of these events reaches a configured webhook.
- **CAP-15**
  - **intent:** In v1, Claude Code is supported fully, for chat and builds. Antigravity joins it for chat, picked per chat with a default per project, if it proves possible (epic 6's spike decides). Codex, Gemini CLI and GitHub Copilot CLI, and builds with any agent but Claude Code, are v2 (epic 8); each further ACP agent is one adapter.
  - **success:** Claude Code completes a chat and a `bmad-build-auto` run through the UI. If Antigravity is supported, an Antigravity chat and a Claude Code chat run at once in one project and both continue after a restart.
- **CAP-16**
  - **intent:** On first run, onboarding finds the installed agent CLIs, installs missing ones on request, and signs the user into their own account (subscription), or takes an API key instead, all from the UI.
  - **success:** On a fresh machine, a user installs Claude Code and signs into it from the UI, then chats, with no terminal. Another user completes a chat with only an API key.
- **CAP-17**
  - **intent:** Each project is a workspace with its own chats, board and runs, and many workspaces can be worked at once. Sessions keep running when the browser closes, and one sidebar shows every session's state across workspaces.
  - **success:** Agents work in two projects at once; the browser is closed and reopened, and both show their live state.
- **CAP-18**
  - **intent:** In a project with Planning turned on (CAP-19), every installed BMAD skill and module, including ones added after an Ogden Agents release, is usable from the UI without an Ogden Agents code change.
  - **success:** A BMAD module installed after an Ogden Agents release appears in the UI and runs.
- **CAP-19**
  - **intent:** Each project chooses whether to use BMad Method and which of its pieces (planning, board, unattended builds, retrospectives). A project without it is a plain multi-agent, multi-chat workspace over the user's agent. New projects start without it unless the user changes the default.
  - **success:** A new project holds chats with two agents in two chats with nothing written under `_bmad/` and no Plan or Board shown; turning on Planning in its settings sets BMad up and shows Plan, and turning BMad off hides Plan again and leaves every file in the repo.
- **CAP-20**
  - **intent:** A user downloads and opens Ogden Agents as an app on macOS, Windows or Linux, with nothing else to install, and it keeps itself up to date. The `npx ogden-agents` route (CAP-1) stays beside it, and both share one data folder.
  - **success:** On a fresh machine with no Node, the downloaded app reaches a first chat with no terminal, and updates from N to N+1 without losing data or interrupting running work.

CAP-11 (cost caps) is retired and its number is not reused.

## Constraints

- It runs natively on macOS, Windows, and Linux, and needs no Docker to install or chat. It binds to `127.0.0.1` with a per-install access token and WebSocket origin checks, because the terminal is effectively a remote shell.
- No standard flow may require the CLI. The CLI is reachable only through the advanced toggle.
- It is a single Node process. Both frontend and backend are new builds, and no Ogden code is carried over.
- Reuse BMAD before building: `bmad-build-auto` in an Ogden-managed ACP session for builds (bmad-loop only for agents without ACP, not in v1), `tickets.py` for all ticket writes, BMAD's setup scripts for installing into a project.
- The BMAD v7 files in the repo are the source of truth for ticket and plan state. The database holds only workspaces, sessions, runs and events, and ticket references.
- Only one side drives a session at a time. While the terminal drives, the chat view is read-only.
- Guardrails are enforced in code, not in prompts. Ogden commit `b5af7c3` showed that prompted rules get skipped.
- Unattended runs are always sandboxed: a per-ticket worktree plus the agent's own sandbox. If the agent has no sandbox on that OS, they use Docker if it's already installed. Otherwise unattended mode is off for that agent, and the UI offers installing Docker or attended mode, and in v2 another agent that can build (see `agent-matrix.md`).
- `bmad-build-auto` stops at `built`. Only a human approval marks a ticket `done`.
- Every unattended run has a maximum run time that stops hung or looping agents.
- Ogden Agents does not reimplement agent coding. The selected agent does the work.
- The UI is built with the `design-taste-frontend` skill: modern, and without the look of a generic Claude/AI app.
- BMAD-METHOD and bmad-loop are used as pinned upstream versions, checked against a content hash and downloaded only when the user sets up or updates. Ogden Agents carries no forks: a change it needs in BMad is opened as an upstream PR and used once merged (user decision 2026-10-02).
- Interactive chat talks to every agent through ACP (Agent Client Protocol), so Ogden Agents needs no chat integration specific to each agent.
- BMad Method is optional per project. Ogden Agents writes nothing BMad into a repo, and adds no BMad skill or prompt to a session, unless that project turned a BMad piece on. Turning it off never deletes files.

## Non-goals

- More than one user per install, organizations, RBAC, and billing.
- Cost, token and usage tracking, or budget caps. Users check their agent's own billing.
- A hosted SaaS offering or remote access.
- An agent runtime of its own.
- Docker as a requirement for installing or chatting.
- An MCP registry, memory/RAG, a semantic cache, and cross-project tickets.
- Tracker stores (Jira, Linear, GitHub Issues, Notion, Trello) in v1. The board covers the repo store only.

- Planned for v2, not v1 (epic 8): viewing the project's markdown files in the app, code-change review, a VS Code extension, the agents Codex, Gemini CLI and GitHub Copilot CLI, and builds with any agent but Claude Code.

## Success signal

- A non-developer runs `npx ogden-agents`, picks an agent and signs in with their subscription, describes an app idea in the browser, gets a spec and a ticketed epic, clicks Build, watches stories build in parallel, and approves merges, all without opening a terminal. An advanced user flips to the agent's terminal mid-session and back without losing the session.
- A user who only wants chats runs several agents in several projects and never sees BMad.

## Assumptions

- The one install command (CAP-1) is the only CLI step of the npm route and is exempt from the no-CLI constraint. The desktop app (CAP-20) needs no command at all, and "a single Node process" stays true inside it, since it bundles its own Node (epic 13, 2026-10-04).
- Ogden Agents checks for `uv` and installs it if missing, because BMAD's scripts and bmad-loop are Python run through `uv`.
- The BMad trademark permits the name "Ogden Agents" (the user's call).
- A fresh UI is built with `design-taste-frontend` on bmad-method-ui's stack. bmad-method-ui and acp-ui (both MIT) are references to borrow from with attribution, not forks.

## Open Questions

These are to be verified during the build; none blocks starting.

- Which ACP adapters give a session ID that the agent's own CLI can resume? This decides where the CAP-5 toggle appears. Check in phase 2.
- Can Ogden Agents drive Antigravity through Google's own ACP server (`antigravity-acp`, in the ACP registry since 2026-08-20): does sign-in work without a terminal, and does it run on macOS, Linux and Windows (all three required)? Epic 6's spike answers and re-checks Google's terms, and the user decides go or no-go.
