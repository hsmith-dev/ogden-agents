---
title: 'Agent replies in chat render as Markdown'
type: 'feature'
ticket: '2'
created: '2026-10-04'
status: 'in-progress'
baseline_revision: 'e5f633143cc06406aa9df32ccf3d13302d0b3cb6'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/backlog/story-agent-replies-in-chat-render-as-markdown.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-planning-and-board/story-document-cards-and-the-next-suggested-step-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Agent replies in the chat show raw Markdown markers (`**`, `#`, fences, pipes) as text (user feedback 2026-10-04). The app already has one safe Markdown renderer (story 4.7, document sheet) but the chat never uses it, and that renderer lacks links, tables, task lists and code-block copy.

**Approach:** Extend `ui/markdown.tsx` (the one renderer) with tables, task lists, a code-block header (language label, Copy) and a `variant`: `document` (default, 4.7 behavior unchanged: links and images as text, soft breaks as spaces) and `chat` (safe links, images as links, soft breaks as line breaks). The chat's agent message renders `<Markdown variant="chat" streaming>`; re-parsing is throttled while a reply streams. User messages stay plain text.

## Boundaries & Constraints

**Always:**
- Ticket criteria 1–7 are the acceptance bar.
- React elements only; never `dangerouslySetInnerHTML`, never an HTML parser; raw HTML and entities show as their literal text.
- Links (chat): href only when the destination parses with `new URL` to `http:`, `https:` or `mailto:` and holds no whitespace or control characters; `target="_blank"`, `rel="noopener noreferrer"`, `title` = the full URL, and a visible URL hint on hover and `:focus-visible`. Anything else (relative, `file:`, `javascript:`, `data:`, paths) is the link's text only. Bare `http(s)://` URLs in text become links the same way; trailing `.,;:!?'")` stays text. Paths are never linked.
- Images: never an `<img>`, nothing fetched. Chat: a link labelled "Image: <alt>" when the URL is http(s), else alt text. Document: alt text (as 4.7).
- All 4.7 protections stay: line cap 4,000 for block/inline patterns, nesting cap 8, linear code-span scan, no backtracking patterns. New patterns (table rows, task markers, URLs) run only on capped lines and are linear.
- Code block: `pre` in `font-mono` on `bg-muted`, `overflow-x-auto`, `tabIndex=0` with an accessible name (keyboard scroll); language label from the info string's first word (letters, digits, `+#.-_`, at most 32 chars, else none); Copy button copies the block text exactly, says "Copied" or "Couldn't copy" (EXPERIENCE microcopy, no dashes).
- Unclosed fence while streaming renders the rest as code (no flip back and forth). Streaming throttle: at most one re-parse per 100 ms while `streaming`, final text rendered at once when it ends.
- Huge input: a message over 200,000 characters renders its first 200,000 as Markdown and the rest as plain pre-wrapped text.
- Theme: only existing tokens (`muted`, `border`, `foreground`, `muted-foreground`); links underlined in foreground (DESIGN: signal is never a link colour).
- Tests never run real agents, keychain, network or real `~/.claude`.

**Never:** syntax highlighting or a new dependency; Markdown in user messages; changing tool-call rows, permission cards, the composer or the document sheet's link policy.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Rich reply | headings, emphasis, lists, task list, code, table, quote, rule | semantic elements, no markers | none |
| XSS | `<script>`, `<img onerror>`, `&lt;` entities, `[x](javascript:..)`, `[x](JaVaScRiPt:..)`, `[x](data:..)` | literal text; no script/img/iframe; no href except safe ones | none |
| Safe links | `[a](https://x)`, `<https://x>`, bare `https://x.`, `[m](mailto:a@b)` | `a[href]` with target, rel, title; trailing `.` outside | none |
| Paths | `[f](src/a.ts)`, `/Users/x/a.md`, `file:///etc` | text only | none |
| Image | `![alt](https://x/p.png)`, `![alt](x.png)` | link "Image: alt" / text "alt"; no img | none |
| Code copy | fenced block with language | label + Copy; clipboard gets exact text | rejected write → "Couldn't copy" |
| Streaming fence | text ending inside an open fence | rest is code | none |
| Hostile/huge | 4.7 hostile lines, pipe-heavy lines, 1 MB reply | renders within existing time bounds | tail beyond cap as plain text |
| Document sheet | 4.7 tests | unchanged | none |
| User message | Markdown typed by user | literal text with line breaks | none |

</frozen-after-approval>

## Code Map

- `packages/web/src/ui/markdown.tsx` -- the 4.7 renderer: `parseBlocks`, `splitCodeSpans`, `INLINE`, `renderBlocks`, `Markdown`. Extend here; keep exports and 4.7 behavior for `variant="document"`.
- `packages/web/src/ui/message.tsx` -- `AgentMessage` wraps children in a `<p>` with `whitespace-pre-wrap`; must become a `div` (block children). `UserMessage` unchanged.
- `packages/web/src/chat/transcript-parts.tsx` -- `Message`: agent branch passes `message.text`; switch to `<Markdown variant="chat" streaming={message.streaming}>`. Terminal-imported agent turns use the same branch.
- `packages/web/src/planning/document-sheet.tsx` -- only other `Markdown` user; untouched.
- `packages/web/src/shell/open-ogden-agents.tsx` -- clipboard Copy pattern (`navigator.clipboard.writeText` in try, copied/failed state).
- `packages/web/src/ui/button.tsx` -- Button variants for Copy.
- `packages/web/test/document-cards.dom.test.tsx` -- 4.7 Markdown tests incl. timing bounds; must still pass.
- `packages/web/test/session-page.dom.test.tsx` -- chat DOM tests; message text assertions must still pass.
- `tests/fixtures/fake-acp-agent.mjs` -- add a `markdown` prompt that streams a Markdown reply in chunks (fence split across chunks, a hostile line).
- `tests/e2e/chat.spec.ts` -- add the e2e.
- `packages/web/src/appearance/appearance.ts` -- `terminalScreenReader` (3.6) applies to xterm only; chat needs nothing from it.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/web/src/ui/markdown.tsx` -- tables, task lists, code header + Copy, `variant`, safe links/autolinks/images (chat), soft breaks, streaming throttle, length cap -- one renderer.
- [ ] `packages/web/src/ui/message.tsx` -- `AgentMessage` body as `div`.
- [ ] `packages/web/src/chat/transcript-parts.tsx` -- agent messages through `Markdown`.
- [ ] `packages/web/test/chat-markdown.dom.test.tsx` -- every matrix row, plus throttle and hostile timing.
- [ ] `tests/fixtures/fake-acp-agent.mjs`, `tests/e2e/chat.spec.ts` -- streamed Markdown reply renders formatted, safe link attributes, Copy reachable.

**Acceptance Criteria:**
- Given a streamed reply, when it completes, then the DOM equals the rendering of the full text and no element the agent wrote exists.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Design Notes

- One renderer, two variants: the document sheet's 4.7 decision (links as text) stays; the chat needs followable links, so the difference is a prop, not a second renderer.
- User messages plain: they are the user's own words; rendering would change what they see they typed (and `*` in prose is common).
- No highlighting: no dependency-free, safe, cheap option; the language label carries the useful part.
- Soft breaks as line breaks in chat: agents use single newlines as line breaks; the old `whitespace-pre-wrap` showed them, so keeping them avoids a regression.

## Verification

**Commands:**
- `pnpm typecheck` -- clean
- `pnpm test` -- all pass, incl. 4.7 Markdown timing tests
- `pnpm e2e` -- all pass
- `pnpm run pack && pnpm smoke` -- pass
