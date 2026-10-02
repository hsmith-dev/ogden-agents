---
id: 1
type: story
title: "Each chat has a permission mode: Ask, Auto, or Skip all"
parent: none
covers: [CAP-4, CAP-5]
after: []
assignee: ""
refined: false
hitl: false
risk: high
estimate: ""
---

# Each chat has a permission mode: Ask, Auto, or Skip all

## Description

Each chat has a permission mode the user can change while it runs. Ask is today's permission cards and is where every chat starts. Auto lets Claude Code's own auto mode approve safe actions and ask, through the cards, about the rest. Skip all runs the agent with its permission checks skipped (`--dangerously-skip-permissions`); it is offered only in Developer mode, needs a red confirmation, and shows a red banner in the chat while it is on. An agent declares which modes it supports, so Codex and Gemini (epic 6) plug into the same contract.

## Acceptance Criteria

1. **New chats start in Ask**
   **Given** any workspace, any caution level, and any permission mode set in the user's or the project's agent settings
   **When** a chat is created, or reopened after a server restart
   **Then** the chat's mode is Ask, the agent is running in its asking mode, and permission requests show cards under the workspace's caution level and Always-allow rules exactly as before

2. **The user switches a chat to Auto**
   **Given** a chat in Ask whose agent offers Auto
   **When** the user chooses Auto
   **Then** the chat's mode is Auto before the agent's next tool call, and a request the agent still sends shows a card under the caution level and rules as in Ask

3. **A mode the chat didn't choose never sticks**
   **Given** a chat in any mode
   **When** the agent reports that it now runs in another mode (Auto falling back to accepting edits for a model without Auto, or the agent entering or leaving plan mode itself)
   **Then** the chat moves to Ask with a plain reason, and the agent is told Ask whenever the mode it reported asks less than Ask
   **And** a permission card never selects an option that changes the agent's mode

4. **A mode the agent can't offer is shown as unavailable**
   **Given** an agent that does not declare Auto or Skip all, or a session whose agent did not list it
   **When** the user opens the mode picker, or anything asks the server for that mode
   **Then** the picker shows the mode disabled with a one-sentence reason, and the server refuses the request with a plain error and records no event

5. **Skip all is offered only in Developer mode, and the server enforces it**
   **Given** Developer mode is off
   **When** anything asks the server to set a chat to Skip all, through the UI or straight to the API
   **Then** the server refuses it with a plain error, records no event, and the agent's mode is unchanged
   **And** with Developer mode on, Skip all is set only after the user confirms a red warning that says what it does; the server refuses a request that does not carry that confirmation

6. **A Skip-all chat is unmistakable**
   **Given** a chat in Skip all, driven from the chat or the terminal
   **When** the user views it at any scroll position and screen width
   **Then** a red banner naming the mode, with a way back to Ask, is visible

7. **A Skip-all chat never writes rules**
   **Given** a chat in Skip all
   **When** the agent asks permission for something its own safety checks will not skip
   **Then** the request shows a card with Allow once and Deny only; no caution level and no Always-allow rule answers it, and the server refuses an Always allow on it

8. **Turning Developer mode off drops every Skip-all chat to Ask**
   **Given** one or more chats in Skip all, in any workspace, driven from the chat or the terminal
   **When** Developer mode is turned off in any tab
   **Then** each of those chats moves to Ask with a reason, its agent (or its terminal) is told or stopped, never left skipping checks, and every open tab shows Developer mode off

9. **The terminal runs in the chat's mode**
   **Given** Developer mode on and a chat whose agent supports the terminal toggle
   **When** the user switches the chat to the terminal
   **Then** the agent's own CLI starts in the chat's mode: Ask in its asking mode, Auto in its auto mode, Skip all with its skip-permissions flag
   **And** while the terminal drives the chat the server refuses a mode change, with a reason telling the user to switch back first

10. **Mode changes are events and old history still reads**
    **Given** a chat, and history recorded before this change
    **When** the mode changes for any reason (the user, Developer mode off, a restart, the agent)
    **Then** one schematized event carries the new mode, the previous one and the cause; the live UI follows it; a page reload shows the stored mode; and sessions and events from before this change read as Ask with nothing migrated by hand

## Boundaries

- Must not change: the caution ladder, protected paths and Always-allow rule matching for chats in Ask or Auto; the card's buttons, keys and record line; how the agent is told only "once" for an Always allow; the terminal handoff's locking and import; AD-15's gate.
- Codex and Gemini modes are not built here (epic 6); only the agent-neutral contract they will fill.
- No change to Claude Code's own settings files: Ogden sets the mode on its own session, never by writing `.claude/settings*.json`.

## References

- parent — none (standalone story in `backlog/`)
- source — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, CAP-4 and CAP-5
- agent matrix — _bmad-output/initiative-ogden-agents/spec-ogden-agents/agent-matrix.md, Permission cards and Terminal toggle
- architecture — _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md, AD-1, AD-5, AD-6, AD-15, AD-16, AD-21
- permission cards — _bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-permission-cards-plan.md
- caution ladder — _bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-caution-level-per-project-plan.md, Decisions
- terminal toggle — _bmad-output/initiative-ogden-agents/epic-terminal-toggle/epic-terminal-toggle.md
- design — _bmad-output/initiative-ogden-agents/ux-ogden-agents/DESIGN.md (destructive colour, permission card, read-only banner) and EXPERIENCE.md (Permission card, Driver toggle, Developer mode)

## Notes

- Decision (user, 2026-10-02): "Let's do the permission cards, but have a way to switch to auto mode and also to enable --dangerously-skip-permissions." Then: the mode is per chat; Ask (cards, the default), Auto (Claude Code's auto mode approves safe actions and asks about the rest), Skip all (`--dangerously-skip-permissions`); Skip all only in Developer mode, with a red warning to confirm and a red banner while active; new chats always start in Ask. Codex and Gemini equivalents come with epic 6, so the contract is agent-neutral: an agent declares which modes it supports.
- Decision (from the user's brief, 2026-10-02): this is a security-relevant change the user asked for; the build records it as a dated decision in the architecture `.memlog.md` and an architecture note in the spine, like earlier approvals.
- Grounding (2026-10-02, pinned `@agentclientprotocol/claude-agent-acp` 0.84.0): the adapter advertises session modes `default` (Manual), `acceptEdits`, `plan`, `auto`, and `bypassPermissions` (only when not running as root outside a sandbox, and not disabled by settings) and supports `session/set_mode`. `auto` is supported in this version, so Auto is built, not shown as unavailable. When the model lacks Auto the adapter falls back to `acceptEdits` and reports it; criterion 3 turns that into Ask. The plan-mode exit card offers mode-raising options as `allow_always` kinds; Ogden only ever selects `allow_once` (criterion 3). In `bypassPermissions` Claude Code skips its checks before asking; a request that still reaches the client is one of its own safety checks, which criterion 7 keeps as a card. No pin changes.
- Grounding: a new ACP session starts in the mode from the user's or project's Claude settings (`permissions.defaultMode`), which today could start an Ogden chat in `auto` or `bypassPermissions` without a word. Criterion 1 closes that by setting Ask on every start and reopen.
- Grounding: Developer mode is today a browser-only appearance preference, so the server can't enforce criteria 5 and 8. Assumption: it becomes an install setting the server keeps in its database (so turning it off and dropping chats to Ask is one transaction), its changes are install-level events every tab follows, and a browser that already had it on carries that over once.
- Assumption: persistence. A chat's mode survives a page reload and a reopen of its agent within one server run. A server restart (or any start that finds the agent's process gone, AD-3) sets every chat back to Ask with a `restart` cause, so Skip all and Auto never outlive the run they were chosen in.
- Assumption: in Auto, Ogden's caution level and Always-allow rules still answer the requests Claude Code asks about, as in Ask, and Always allow is offered. In Skip all, no caution level or rule answers a request; each shows a card.
- Assumption: in Auto and Skip all, an action Claude Code approves itself never reaches Ogden. So the caution ladder and the protected-path rule (2.8: an edit to `.claude/`, `.git/`, `.mcp.json`, `CLAUDE.md` and the like always shows a card) hold only in Ask. In Auto, Claude Code's own checks decide those. This follows from the user's definition of Auto; the mode picker's Auto description says so.
- Decision (2026-10-02, from grounding): every Claude Code session is started with skipping permitted (the adapter's default), so a chat can move to Skip all without restarting its agent. Ogden's server is the gate (criteria 4, 5, 8), not the agent's start options.
- Assumption: the user's own mode switch inside the terminal CLI (for example its Shift+Tab) isn't tracked; when the chat switches back, Ogden sets the agent to the chat's stored mode again.
- Docs: the build updates EXPERIENCE.md (Developer mode kept by the server; the mode picker, warning and banner) and the agent matrix (Claude Code's modes), and records the change in the architecture `.memlog.md` and a spine note.
- High risk check: the security lens of the build's review must confirm criteria 5, 7 and 8 against the server, not only the UI; and a person confirms the Skip all warning and banner in the running app before the PR leaves draft.
