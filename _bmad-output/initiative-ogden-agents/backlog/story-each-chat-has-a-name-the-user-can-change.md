---
id: 2
type: story
title: "Each chat has a name the user can change"
parent: none
covers: []
after: []
assignee: ""
refined: false
hitl: false
risk: medium
estimate: ""
---

# Each chat has a name the user can change

## Description

Today every chat is called "Chat" in the sidebar, the project's chat list and the chat's own header, so a project with several chats can't be followed (user feedback, 2026-10-04). Every chat gets a name. A new chat is named automatically: a planning chat after the planning action that started it, any other chat after its first message, trimmed and shortened. The user can rename a chat from its header and from the sidebar or the chat list; an empty name puts the automatic one back. Names are kept by the server as events, so every open tab follows a rename and chats from before this change show their automatic name. This works the same for every agent and while the terminal drives the chat.

## Acceptance Criteria

1. **A new chat names itself**
   **Given** a new chat with no name
   **When** its first message is sent from the composer, typed in the agent's terminal and imported, or sent by a planning action
   **Then** the chat's automatic name is that planning action's label, or else the message's text on one line, trimmed and shortened to at most 60 characters, and it shows in the chat header, the sidebar row, the chat list and Needs you
   **And** a Deny reason never names a chat, and a chat with no message yet is called "New chat"

2. **The user renames a chat from its header**
   **Given** a chat open in any state, driven from the chat or the terminal
   **When** the user chooses Rename beside the chat's name, types a name and presses Enter (or leaves the field)
   **Then** the name is saved and shown everywhere, and a screen reader hears "Chat renamed to <name>"
   **And** Esc closes the field with the name unchanged and focus back on Rename

3. **The user renames a chat from the sidebar and the chat list**
   **Given** a chat's row in the sidebar or in the project's chat list
   **When** the user double clicks the sidebar row or presses F2 on it, or presses F2 on a chat list row or chooses Rename from its menu
   **Then** the row becomes a name field with the same Enter, Esc and announcement rules as criterion 2, and focus returns to the row afterwards

4. **An empty name falls back**
   **Given** a chat with a name the user gave it
   **When** the user saves an empty or blank name
   **Then** the chat shows its automatic name again (or "New chat"), and the automatic name keeps following the rules of criterion 1

5. **A name is plain, short text**
   **Given** any name sent to the server, from the UI or straight to the API
   **When** it is saved
   **Then** control and invisible formatting characters are removed, runs of white space become one space, the ends are trimmed, and a name longer than 80 characters is refused with a plain error and no event
   **And** a name is shown everywhere as text, never as markup

6. **Renames are events and every tab follows**
   **Given** two tabs open on the same install
   **When** a chat is renamed or named automatically in one
   **Then** one schematized event carries the new name and the automatic name, the other tab's sidebar, chat list, header and Needs you show it without a reload, and a reload shows the stored name

7. **Older chats read as before, with a name**
   **Given** sessions and events stored before this change
   **When** the server starts and a tab opens
   **Then** every older chat with a message shows its automatic name from its first message, nothing is migrated by hand, and an older `session.created` event without the new field still reads

## Boundaries

- Must not change: the order of sidebar rows (a rename does not move a chat), session states, the permission mode and driver rules, the transcript.
- No search box is added; "searchable" means the name is in the sidebar, the chat list and Needs you as text the browser's find and a screen reader reach.
- A rename never reaches the agent: it is Ogden's name for the chat, not the agent's session title.

## References

- parent — none (standalone story in `backlog/`)
- architecture — _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md, AD-4, AD-5
- design — _bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md, Status sidebar, Needs you group; DESIGN.md, Status row
- sibling pattern — _bmad-output/initiative-ogden-agents/backlog/story-each-chat-has-a-permission-mode-ask-auto-or-skip-all-plan.md (a session field changed only by core, with its own event)

## Notes

- Decision (user, 2026-10-04, verbatim): "We should be able to name the UI chats in each project so we can follow that". The brief that came with it: automatic name from the first message or the planning action's label until the user renames; rename inline from the header and the chat list or sidebar (double click or a Rename menu item); Enter saves, Esc cancels; empty falls back; length cap; stored as a back-compatible AD-5 event; live across tabs; plain text; visible in the sidebar and Needs you; every agent and terminal-driven chats; keyboard and screen reader, rename announced.
- Grounding: sessions already carry a `title` column and field, always empty today, which the UI shows as "Chat". The build uses it for the user's name and adds the automatic name beside it.
- Assumption: leaving the field (blur) saves, like Enter, so a rename isn't lost by clicking away; Esc is the only cancel.
- Assumption: the automatic name is set once, from the first message, and never changes after; older chats get theirs from their first stored user message at server start.
- Assumption: a chat with no name and no message is called "New chat" (was "Chat").
- Assumption: Needs you rows name the chat after the project ("Project, Chat name: Claude Code wants to run npm test").
- Decision (build, 2026-10-04): a double click doesn't rename in the chat list, because its first click opens the chat and leaves the list; the list has F2 and the row menu, the sidebar (which stays) has F2 and a double click.
- Risk medium: the name is user input shown in several places and stored in the event log; the review's security lens checks criterion 5 against the server.
