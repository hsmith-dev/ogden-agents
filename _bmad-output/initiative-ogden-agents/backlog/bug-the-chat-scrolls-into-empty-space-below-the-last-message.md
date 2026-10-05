---
id: 10
type: bug
title: "The chat scrolls into empty space below the last message"
parent: none
covers: []
after: []
assignee: ""
refined: true
hitl: false
risk: low
severity: P2
estimate: ""
---

# The chat scrolls into empty space below the last message

## Description

User report, 2026-10-04 (verbatim): "There is a slight scrolling error for after approving something and then it removes it but the scroll still allows me to scroll to the bottom". In a chat, around a permission card (while it waits, and after Allow once or Deny collapses it to its record line while the approved tool runs), scrolling down past the last message keeps going: the whole app (sidebar, header, conversation and composer) moves up and leaves empty space underneath. The conversation should stop at its last item and nothing outside it should scroll.

## Reproduction

1. `pnpm e2e` build, fake ACP agent (`tests/fixtures/fake-acp-agent.mjs`), Chromium, 1440×700 (also 390×844).
2. Open a chat, send six messages so the conversation scrolls, then send `permission` (an `execute` tool call shown "In progress", then a permission card).
3. Point at the conversation and scroll down twice by 3000 px.
4. Actual: `window.scrollY` is 286, `document.documentElement.scrollHeight` is 986 for a 700 px window, and the screenshot shows the app shifted up with blank space below the composer. Expected: `window.scrollY` stays 0 and the document is exactly the window's height; only the conversation scrolls, and it ends at the last item.
5. The element past the window's bottom is the tool row's hidden "In progress" label (`span.sr-only`, `position: absolute`, bottom 986). With a real agent the approved tool keeps running after the card collapses, so the extra space is still there "after approving".

## Cause Hypothesis

Visually hidden (`sr-only`, absolutely positioned) labels inside the conversation, such as a running tool call's "In progress", have no positioned ancestor up to the root: the conversation's scroll box (`PageBody`) is not a containing block. They are laid out against the page itself, outside the conversation's scroll box, so they stretch the document; a wheel at the end of the conversation chains to the document and scrolls the whole app shell into empty space. Not a virtualizer (the list is not virtualized), spacer or stick-to-bottom issue.

## Acceptance Criteria

1. **The conversation ends at its last item, and nothing else scrolls**
   **Given** a chat long enough to scroll, with a permission card waiting or a tool call still running (before or after the card is answered, at desktop and phone widths)
   **When** the user scrolls down past the end of the conversation
   **Then** the window does not scroll (the document is exactly the window's height), the conversation's scroll range ends at its content, and the last item stays right above the composer; stick to bottom and Jump to latest behave as before
2. **Tests cover the condition found and fixed**
   **Given** the e2e suite
   **When** it runs
   **Then** a test that fails on the defect and passes on the fix covers a waiting card with a running tool call, scrolled past the end, then answered; and one covers a card answered from another tab while the tool keeps running, at a phone width
3. **Or: no change is needed, with proof**
   **Given** the reproduction
   **When** it is run on the current code
   **Then** the expected behavior already holds, or the report was mistaken, with the evidence recorded in Notes — this supersedes 1 and 2

## References

- parent — none
- `packages/web/src/ui/page.tsx` — `PageBody`, the conversation's scroll box
- `packages/web/src/routes/session-page.tsx` — the transcript, stick to bottom, Jump to latest
- `packages/web/src/ui/state-glyph.tsx` — the hidden label (`labelMode="hidden"`, `sr-only`)
- PR #87 (`story/6.9-epic6-sweep`) — the build the user was testing

## Notes

- Assumption: id 10 — backlog ids 1, 2, 6, 8 and 9 are used on sibling branches; 10 is the next one not seen on any branch or worktree.
- Assumption: the fix stays in the conversation's scroll box (siblings change Markdown rendering and the composer); other pages share `PageBody` and get the same containment.
