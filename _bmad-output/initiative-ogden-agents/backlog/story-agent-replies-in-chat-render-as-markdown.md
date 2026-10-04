---
id: 2
type: story
title: "Agent replies in chat render as Markdown"
parent: none
covers: []
after: []
assignee: ""
refined: false
hitl: false
risk: medium
estimate: ""
---

# Agent replies in chat render as Markdown

## Description

An agent's reply in a chat shows as formatted text: headings, emphasis, lists and task lists, links, inline code, fenced code blocks with a Copy button, tables, quotes and rules. Today the reply shows its Markdown markers as plain text (user feedback, 2026-10-04: "The response it gave when testing the app provided me with markdown like response but the markdown is not formatted that way in the browser"). The chat uses the same safe renderer as the document sheet (story 4.7), extended, so there is one renderer. Replies brought back from the terminal (story 3.3) render the same way.

## Acceptance Criteria

1. **A reply's Markdown shows formatted**
   **Given** an agent reply with headings, emphasis, bullet, numbered and task lists, inline code, a fenced code block, a table, a quote and a rule
   **When** it shows in the chat, live or reloaded, typed in the chat or brought back from the terminal
   **Then** each shows as its element (heading, list, table, code), with no Markdown markers left in the text
   **And** headings and lists are semantic elements a screen reader announces as such

2. **No HTML from an agent ever runs or renders**
   **Given** a reply containing raw HTML, a `<script>`, event-handler attributes or an HTML entity trick
   **When** it shows
   **Then** it shows as the text it is, and no element the agent wrote is created

3. **Only web and mail links are followable**
   **Given** a reply with links to http, https and mailto addresses, and links with any other protocol, a relative path or a file path
   **When** it shows
   **Then** the http, https and mailto links open in a new tab with no access to the opener, and show their full address on hover and on keyboard focus
   **And** every other link shows as its text, with nothing to follow, and a file path stays text

4. **Images are never loaded**
   **Given** a reply with an image
   **When** it shows
   **Then** nothing is fetched; the image shows as a labelled link to its address when that address is http or https, otherwise as its alt text

5. **Code blocks can be read and copied by keyboard**
   **Given** a reply with a fenced code block, with or without a language
   **When** it shows
   **Then** the code is monospace on the muted surface, a long line scrolls sideways rather than widening the chat, the language shows when given, and a Copy button reachable by keyboard copies exactly the block's text and says it was copied or that it couldn't

6. **Streaming stays fast and stable**
   **Given** a reply that is still arriving
   **When** a code fence has opened but not closed
   **Then** the rest shows as code until it closes, without the text jumping between code and prose
   **And** rendering is throttled while streaming, and a very large or hostile reply renders without freezing the tab

7. **User messages stay as typed**
   **Given** a message the user wrote, in the composer or in the terminal
   **When** it shows
   **Then** it shows as plain text with its line breaks, exactly as typed

## Boundaries

- Must not change: the document sheet's behavior from story 4.7 (links there stay text only, frontmatter hidden), tool-call rows, permission cards, the composer.

## References

- source — user feedback 2026-10-04, quoted in the Description
- design — _bmad-output/initiative-ogden-agents/ux-ogden-agents/DESIGN.md, Components: Message, agent ("Markdown rendered with mono code blocks on muted")
- prior renderer — _bmad-output/initiative-ogden-agents/epic-planning-and-board/story-document-cards-and-the-next-suggested-step-plan.md, Markdown decisions and review S2

## Notes

- Decision: user messages stay plain text (2026-10-04, builder's call recorded in the plan): what the user typed is shown exactly.
- Assumption: no syntax highlighting; no cheap, safe option without a new dependency.
- Assumption: the 3.6 screen-reader setting governs the terminal panel only; the chat is semantic HTML in both settings.
