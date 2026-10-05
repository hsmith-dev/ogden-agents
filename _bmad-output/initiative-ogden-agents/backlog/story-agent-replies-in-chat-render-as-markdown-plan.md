---
title: 'Agent replies in chat render as Markdown'
type: 'feature'
ticket: '14'
created: '2026-10-04'
status: 'built'
baseline_revision: 'e5f633143cc06406aa9df32ccf3d13302d0b3cb6'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'security']
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

- Implemented directly by the build session (no separate implementer subagent). Files: `ui/markdown.tsx` (component, variants, streaming throttle, length and line cap), new `ui/markdown-parse.ts` (4.7 block parser moved, plus tables, task items, fence language), new `ui/markdown-inline.tsx` (inline, `safeHref`, `SafeLink`, bare-address links, per-message line cache), new `ui/code-block.tsx` (language label, Copy, focusable `pre`); `ui/message.tsx` (agent body is a `div`); `chat/transcript-parts.tsx`; tests `packages/web/test/chat-markdown.dom.test.tsx`, `tests/e2e/chat.spec.ts`, fake agent `markdown` prompt.
- Split into four files to keep each under 600 lines (AGENTS deferred-work rule).
- Link text excludes `[` so a run of brackets is linear; a per-message line cache (5,000 lines, 1M characters) means a streaming reply only renders its new lines.
- The address hint is a sibling of the link, positioned against the Markdown block, so it never widens the chat at phone width (checked in a 375px screenshot) and is never part of the link's name.
- Added after review: Markdown stops at 5,000 lines as well as 200,000 characters; frontmatter hidden only in the document variant; `__` and `_` emphasis need non-word neighbours; emphasis that starts inside a bare address is skipped; addresses with bidi, zero-width or other invisible characters, or with a user name or password, are not followed.
- Full e2e run showed one failure in `upgrade-0.2.0.spec.ts` whose trace path pointed at a sibling worktree (`ogden-agents-wt-chat-names`, a `session.renamed` event this branch doesn't have): runs collided; the spec passes alone here.

## Plan Change Log

## Review Triage Log

Pass 1 (lenses quick, security): high 0, medium 6, low 8, false 1, maybe-false 0.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | Safe links have no `title` (plan Always) | low | patch | `SafeLink` had none; added `title={href}`. |
| 2 | Address hint inside `<a>` joins its accessible name on focus | medium | patch | Hint shown on focus-visible was a child; moved beside the link (`group-has-focus-visible`), `aria-hidden`, still `aria-describedby`. e2e checks name and description. |
| 3 | Chat reply opening with `---` loses text as "frontmatter" | medium | patch | `withoutFrontmatter` ran for every variant; now document only. Test added. |
| 4 | `pre` with `aria-label` has generic role | low | patch | Added `role="group"`. |
| 5 | Task checkboxes unnamed | medium | patch | `aria-label` Done / Not done. |
| 6 | Emphasis inside bare URLs truncates them (`__init__.py`, `_x_`); `__` intraword bold | medium | patch | Emphasis whose opener lies inside a bare address is skipped; `__`/`_` need non-word neighbours; `_` dropped from trailing trim. Tests added. |
| 7 | Underline colour muted, plan says foreground | low | patch | Underline now currentColor (foreground). |
| 8 | Popover tokens outside the four named | false | reject | Plan rule is "only existing tokens"; `popover` is one, design-tokens test passes. |
| 9 | Huge-input test hits the line cache | low | patch | Test now uses 4,000 distinct lines and asserts the plain-text tail. |
| 10 | Copy mid-stream adds a trailing newline | low | patch | Unclosed fence drops a final empty line. Test added. |
| 11 | Bidi / zero-width characters in an address | medium | patch | `safeHref` refuses them. Tests added. |
| 12 | Credentials and deceptive labels | medium | patch (credentials) | Addresses with user name or password are text. Deceptive link labels are inherent to Markdown links; title and hint show the address; rejected for the label part. |
| 13 | `|` inside a link in a table cell splits the cell | low | reject | Matches GFM, which requires `\|`; rare. |
| 14 | 25k tiny blocks render slowly (happy-dom 5 s) | medium | patch | Markdown also stops at 5,000 lines; rest plain text. Test added. |
| 15 | Line cache grows with one long streaming line | low | patch | Long lines not cached; 1M character budget. |
| 16 | Extra tab stops on non-overflowing `pre`/table | low | reject | Needed for keyboard scrolling (plan Always); fix would add overflow detection. |
| 17 | Mixed task/plain list loses bullet room | low | patch | Lists keep `pl-6`; task checkbox pulled into the marker gutter. |
| 18 | `#` maps to h3 in every message | low | reject | Same mapping as 4.7 by design; semantic. |

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
