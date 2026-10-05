---
id: 6
type: story
title: "The composer keeps unsent text per chat"
parent: none
covers: []
after: []
assignee: ""
refined: false
hitl: false
risk: medium
estimate: ""
---

# The composer keeps unsent text per chat

## Description

Text typed in a chat's composer and not yet sent survives for a short time: going to another chat, project or page and back, or reloading the tab, shows it again in that chat's composer. A project's new-chat composer keeps its own draft the same way. The draft is stored only in this browser, never on the server, expires after 7 days, and is cleared once the message it holds is accepted by the server or the user empties the field. It covers every place the chat composer appears: a chat, a planning chat, a chat whose terminal is off, and a project's first-chat composer.

## Acceptance Criteria

1. **A draft survives leaving the chat**
   **Given** text typed in a chat's composer and not sent
   **When** the user opens another chat, another project or another page, then comes back to that chat
   **Then** the composer shows the same text, and the other chat's composer showed only its own draft (or nothing)

2. **A draft survives a reload**
   **Given** text typed in a chat's composer, or in a project's new-chat composer, and not sent
   **When** the tab is reloaded, or the app is opened again in a new tab of the same browser within 7 days
   **Then** that composer shows the same text

3. **A sent message clears its draft only once the server accepts it**
   **Given** a draft in a composer
   **When** the user sends it and the server accepts it
   **Then** the composer is empty and stays empty after leaving and coming back, or a reload
   **And** text typed while the message was on its way is kept as the next draft, not cleared
   **And** when the server refuses the message the text stays in the composer and in the draft, with the existing error

4. **Not-sent messages still come back to the composer**
   **Given** a message queued while the agent worked
   **When** it ends as "Not sent"
   **Then** its text is put back in the composer ahead of anything typed, as before, and that combined text is the draft

5. **Clearing the field forgets the draft**
   **Given** a draft
   **When** the user empties the field
   **Then** nothing is restored on coming back or reloading

6. **Drafts are short-term and bounded**
   **Given** a draft older than 7 days, or more stored drafts than the cap
   **When** the app next loads drafts
   **Then** the expired drafts, and the oldest drafts beyond the cap, are removed; a draft larger than the size cap is kept for the open page only and not stored

7. **Drafts stay on this device and never leave it**
   **Given** any draft, including one holding a pasted secret
   **When** the user types, navigates, reloads, or sends
   **Then** the draft is never sent to the server, never logged, and never put in a URL; only the message the user sends reaches the server, as today

8. **Blocked storage changes nothing else**
   **Given** browser storage that throws or is unavailable
   **When** the user types, navigates and sends
   **Then** the composer works as before this change, and drafts are simply not kept

## Boundaries

- Must not change: Enter sends and Shift+Enter starts a line; the composer's accessible name, description, focus on open, Send state, blocked reasons, hints and error text; the Not-sent restore; the first-chat create-then-send flow; the terminal-driving composer.
- No server API, event or stored field changes.

## References

- design — _bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md, Composer
- source — user feedback, 2026-10-04: "If I navigate away from the project chat, and back the text I typed is gone. We should be able to store that for short term."

## Notes

- Decision: drafts live in the browser's local storage, per workspace and chat, never on the server, because a draft may hold a pasted secret and the server keeps an event log (2026-10-04, from the user's brief).
- Decision: drafts expire after 7 days; size and count are capped (2026-10-04, proposed in the brief; the build sets the exact caps).
- Decision: several tabs on the same chat: the last write wins; a tab does not live-update another tab's composer (2026-10-04, from the brief).
- Assumption: local storage is per origin, which includes the port; if Ogden starts on a different port than before, earlier drafts are not shown (they expire on their own).
- Assumption: id 6 chosen to stay clear of sibling backlog tickets drafted in parallel branches, which use 2.
