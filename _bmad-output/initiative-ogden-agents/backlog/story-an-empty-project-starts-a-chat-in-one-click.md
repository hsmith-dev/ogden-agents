---
id: 2
type: story
title: "An empty project starts a chat in one click"
parent: none
covers: [CAP-3, CAP-19]
after: []
assignee: ""
refined: false
hitl: false
risk: low
estimate: ""
---

# An empty project starts a chat in one click

## Description

A project with no chats shows a clear empty state on its Chats page whose one primary action, **Start a chat**, starts a chat in that project with one click, with the project's default agent (6.6, pick the agent per chat and the default per project) and in Ask (every new chat's mode). When more than one agent is installed, a secondary **Use another agent** menu starts the chat with a different one, showing each agent's readiness and the existing "Open Settings → Agents" link as the agent picker does; it replaces the agent picker in the empty state's composer footer, so the empty state has one agent chooser. The project's entry in the sidebar offers the same Start a chat while it has no chats. A Simple project (every BMad piece off) gets this the same way; there the Chats page is the project's only page.

## Acceptance Criteria

1. **One click starts a chat with the project's default agent**
   **Given** a project with no chats whose default agent can start a chat
   **When** the user chooses Start a chat on its Chats page
   **Then** a chat with that agent opens in that project, in Ask, with its composer focused
   **And** a second click while the first start is in flight starts no second chat

2. **The empty state names the agent and has one primary action**
   **Given** a project with no chats
   **When** its Chats page shows
   **Then** it says there are no conversations yet, says which agent a new chat uses, and Start a chat is the only primary button on the page; the header's New chat stays but is not styled as primary while the list is empty

3. **Another ready agent is one choice away**
   **Given** an install with more than one agent
   **When** the user opens Use another agent in the empty state and chooses an agent that can start a chat
   **Then** a chat with that agent opens in that project, in Ask; an agent that can't start a chat stays in the menu, marked unavailable with its reason, choosing it starts nothing, and "Open Settings → Agents" is linked when installing or signing in fixes it
   **And** with one agent installed the menu is not shown, and the composer footer no longer has its own agent picker

4. **A default agent that can't start a chat says why before trying**
   **Given** an install with more than one agent and a project whose default agent can't start a chat now
   **When** its empty Chats page shows, or the user chooses Start a chat there
   **Then** the reason and, when it applies, the "Open Settings → Agents" link are shown and tied to the button, and no chat is created

5. **The sidebar offers Start a chat for an empty project**
   **Given** a project with no chats, listed in the sidebar (full width, rail, or the phone sheet)
   **When** the user chooses its Start a chat entry
   **Then** a chat with the project's default agent opens in that project in Ask (and the sheet closes); when the default agent can't start a chat, the project's Chats page opens instead, showing why
   **And** once the project has a chat the entry is gone and its chat rows show as before

6. **A failed start is said plainly and can be tried again**
   **Given** the server refuses or fails to create the chat
   **When** the user chooses Start a chat, in the page or the sidebar
   **Then** a plain one-sentence reason is announced where the user clicked, no empty chat is left behind by the attempt, and choosing it again tries again

7. **Keyboard and screen reader**
   **Given** a keyboard or screen reader user
   **When** they move through the empty state and the sidebar entry
   **Then** every action is reachable and operable by keyboard, and each has an accessible name; the sidebar entry's name includes the project, since several can be on screen at once

## Boundaries

- Must not change: the Chats list, its header New chat and agent picker when the project has chats; the empty state's composer sending (typing a first message still starts the chat with the agent the empty state names, and a failed send still retries in the same chat, 2.5 F6); the session page; how a chat's agent and permission mode are stored or chosen on the server.
- No server or API change: creating a chat already takes an agent and starts in Ask.
- Projects with chats show their sidebar rows as before; no new entry is added to them.

## References

- parent: none (standalone story in `backlog/`)
- source: _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, CAP-3 and CAP-19
- default agent and readiness: _bmad-output/initiative-ogden-agents/epic-every-agent/story-pick-the-agent-per-chat-and-the-default-per-project-plan.md
- permission modes: _bmad-output/initiative-ogden-agents/backlog/story-each-chat-has-a-permission-mode-ask-auto-or-skip-all.md (new chats start in Ask)
- design: _bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md (State Patterns: Empty chats; Component Patterns: Status sidebar, Composer; Voice and Tone) and DESIGN.md (Components; no em or en dashes in UI copy)

## Notes

- Decision (user feedback, 2026-10-04, verbatim): "When there are no chats in a project it should be easy to start a new chat with that project".
- Decision (brief, 2026-10-04): one obvious primary action, Start a chat, with the project's default agent and Ask; a secondary way to pick another agent when more than one is ready; the sidebar entry for an empty project offers the same action; the new-chat flow when chats exist is unchanged; plain copy with no dashes.
- Assumption: the empty state keeps its composer under the new action (EXPERIENCE.md Empty chats keeps "Composer focused"), so typing a first message still works and keeps keyboard focus on arrival. Start a chat is the visual primary action; the composer is the second way in.
- Assumption: like the agent picker (6.6), a reason before trying is shown only while there is a choice of agents; with one agent the server's reason is shown after the click, as the header's New chat does today.
- Assumption: the sidebar entry is a row under the project's name labelled "Start a chat", with the project in its accessible name; it shows only for a project whose chats have loaded and are none.
- Assumption: the header's New chat stays while the list is empty (one place for it on every Chats page, and existing journeys use it) but uses the outline style, so Start a chat is the one primary button.
- Docs: the build updates EXPERIENCE.md (Empty chats state, which today says "agent picker visible", and the Status sidebar row).
- Risk low: web-only, a mistake shows at once and reverts cleanly.
