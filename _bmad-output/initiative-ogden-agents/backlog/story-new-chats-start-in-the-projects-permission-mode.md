---
id: 9
type: story
title: "New chats start in the project's permission mode"
parent: none
covers: [CAP-4, CAP-5]
after: []
assignee: ""
refined: false
hitl: false
risk: high
estimate: ""
---

# New chats start in the project's permission mode

## Description

Each project has a default permission mode that new chats start in: Ask, Auto, or Skip all. The user sets it in Workspace settings ("New chats start in"), and sets the app-wide default for new projects in Settings → New projects. So agents can just work without approving each command. Each chat can still switch its own mode as today. Skip all as a default needs Developer mode, a red confirmation once per project, and keeps every Skip-all chat's red banner. A chat whose agent doesn't offer the project's mode starts in Ask with a visible note. Unattended builds keep their own rule-based policy and are not affected.

## Acceptance Criteria

1. **A project's default sets a new chat's mode**
   **Given** a project whose default is Auto or Skip all, and a chat agent that offers that mode
   **When** a chat (or a planning session) is created in that project
   **Then** it starts in that mode, before its agent takes a prompt, with a note saying it started in the project's default
   **And** a project with no default chosen starts new chats in Ask, as before

2. **A mode the agent doesn't offer falls back to Ask with a note**
   **Given** a project default the chat's agent does not declare (for example Auto for Antigravity), or one its session on this computer did not list
   **When** a chat is created
   **Then** it starts in Ask, and the chat shows a note naming the agent and the mode it doesn't offer

3. **Skip all as a default is server-enforced**
   **Given** Developer mode off, or a request that does not carry the user's confirmation
   **When** anything asks the server to make Skip all a project's default or the app-wide default, through the UI or straight to the API
   **Then** the server refuses it with a plain error and records nothing
   **And** with Developer mode on, the user confirms a red warning once for that project, and the confirmation is recorded as an event

4. **Skip all from the app-wide default still needs this project's confirmation**
   **Given** the app-wide default for new projects is Skip all
   **When** a project is added
   **Then** its new chats start in Ask, and its settings say Skip all is waiting for confirmation for this project, with a way to confirm it

5. **Turning Developer mode off drops Skip-all defaults to Ask**
   **Given** projects whose default is Skip all, and an app-wide default of Skip all
   **When** Developer mode is turned off
   **Then** in the same change every such project default becomes Ask with a notice in its settings, the app-wide default becomes Ask, and existing Skip-all chats drop to Ask as before
   **And** a chat created while Developer mode is off never starts in Skip all

6. **Every chat started in Skip all shows the red banner**
   **Given** a chat that started in Skip all from its project's default
   **When** the user views it at any scroll position and screen width
   **Then** the red banner naming the mode, with a way back to Ask, is visible

7. **Restarts and builds keep their own rules**
   **Given** a server restart
   **When** it starts
   **Then** every existing chat is back in Ask as before, and a chat created after it starts in the project's default
   **And** unattended builds' permission policy is unchanged by any default

8. **History still reads**
   **Given** events and settings from before this change
   **When** they are read
   **Then** projects read as default Ask, and old `workspace.settings_changed` and `session.created` events parse unchanged

## Boundaries

- Must not change: a chat's own mode switching and its checks; the caution ladder, protected paths and rule matching; the Skip-all banner and card behaviour; the terminal's mode handling; unattended builds' policy.
- No change to Claude Code's own settings files.

## References

- parent — none (standalone story in `backlog/`)
- permission modes — _bmad-output/initiative-ogden-agents/backlog/story-each-chat-has-a-permission-mode-ask-auto-or-skip-all.md
- permission modes plan — _bmad-output/initiative-ogden-agents/backlog/story-each-chat-has-a-permission-mode-ask-auto-or-skip-all-plan.md
- source — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, CAP-4 and CAP-5
- architecture — _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md, AD-5, AD-6, AD-15
- design — _bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md (Developer mode, permission modes, Workspace settings, Settings → New projects)

## Notes

- Decision (user, 2026-10-04): "I also want to be able to have the agents be set to no need to approve each command and just have them working." Then: a default permission mode per project in Workspace settings ("New chats start in: Ask / Auto / Skip all") and an app-wide default under Settings → New projects; Skip all as a default still requires Developer mode, asks the user to confirm once per project, and every Skip-all chat keeps the red banner; each chat can still switch.
- Decision (user, 2026-10-04): unattended builds keep their own rule-based policy; this setting does not touch them.
- Decision (user brief, 2026-10-04): turning Developer mode off also drops a project's Skip-all default to Ask with a notice; Antigravity (Ask and Skip all only) falls back to Ask for an Auto default with a visible note; the per-project Skip-all confirmation is recorded as an event; recorded as a dated decision in the architecture `.memlog.md` and an AD-6/AD-15 spine note.
- Decision (2026-10-04, recorded per the brief): after a server restart, existing chats keep the reset-to-Ask behaviour; a chat created after the restart starts in the project's default.
- Assumption: a new project copies the app-wide default when it is created, as the default agent does (6.6); changing the app-wide default later doesn't change existing projects. An app-wide Skip all reaches a new project as "waiting for confirmation" (criterion 4), so confirmation is always per project.
- Assumption: planning sessions are chats and start in the project's default; build sessions don't use it.
- Assumption: the server checks Developer mode and the agent's modes when the chat is created, in the same synchronous step that creates it, so Developer mode turned off in between can't leave a new Skip-all chat.
- High risk check: the build's review runs a security lens over criteria 3, 5 and 6 against the server, not only the UI.
