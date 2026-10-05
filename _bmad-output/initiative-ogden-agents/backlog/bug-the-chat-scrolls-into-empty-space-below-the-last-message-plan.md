---
title: 'The chat scrolls into empty space below the last message'
type: 'bugfix'
ticket: '10'
created: '2026-10-04'
status: 'in-progress'
baseline_revision: '56883363a54bcfb42b8ae698522dd02e34af5ef2'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/backlog/bug-the-chat-scrolls-into-empty-space-below-the-last-message.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Around a permission card (waiting, or answered while the approved tool still runs), scrolling past the end of a chat scrolls the whole app shell up into blank space. Reproduced: `window.scrollY` 286, document 986 px tall in a 700 px window. The overflowing element is a running tool row's visually hidden "In progress" label (`sr-only`, `position: absolute`): no ancestor up to the root is positioned, so it is laid out against the page, outside the conversation's scroll box, and stretches the document; the wheel chains to the document.

**Approach:** Make the conversation's scroll box (`PageBody`'s scrolling element) a containing block (`position: relative`), so anything absolutely positioned inside the conversation is contained and clipped by it and adds nothing beyond its content. Prove it in Playwright first.

## Boundaries & Constraints

**Always:** keep stick to bottom, Jump to latest, Show earlier anchoring and the waiting bar exactly as they are; keep the terminal peek's `absolute`/`xl:static` placement winning over the new `relative` (tailwind-merge, className last); tests use the fake ACP agent only, never a real agent, keychain, network or `~/.claude`.

**Never:** touch Markdown rendering or the composer (sibling PRs); add a virtualizer, spacer or scroll-position JS to paper over it; hide document overflow globally (`overflow: hidden` on html/body) instead of fixing containment.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Card waiting, tool running | long chat, `permission`, wheel down past end | window.scrollY 0; document height = window height; conversation scrollHeight = its content | none |
| Card answered, tool still running | answer, tool stays in progress (`quiet-tool`-like) | same; last item right above the composer | none |
| Answered from another tab | second tab answers, first tab watches, 390 px wide | same in the first tab | none |
| Terminal peek | peek open below `xl` | still `absolute` over the terminal | none |

</frozen-after-approval>

## Code Map

- `packages/web/src/ui/page.tsx` -- `PageBody`: the scroll box (`min-h-0 flex-1 overflow-y-auto`); the fix
- `packages/web/src/terminal/terminal-pane.tsx` -- `conversationProps` puts `absolute …`/`hidden` on that same scroll box; must still win
- `packages/web/src/ui/state-glyph.tsx` -- source of the hidden `sr-only` label (unchanged)
- `packages/web/src/routes/session-page.tsx` -- transcript, stick to bottom (unchanged)
- `tests/e2e/chat-server.ts`, `tests/fixtures/fake-acp-agent.mjs` -- e2e harness; `permission`, `quiet-tool`

## Tasks & Acceptance

**Execution:**
- [ ] `tests/e2e/chat-scroll.spec.ts` -- new: long chat + waiting card + running tool, wheel past the end; assert window.scrollY 0, document height = viewport, conversation scroll range = content; answer the card; repeat; second test: answered from another tab while a tool keeps running, at 390 px -- fails on the defect first
- [ ] `packages/web/src/ui/page.tsx` -- add `relative` to `PageBody`'s scroll box -- contains absolutely positioned descendants
- [ ] `packages/web/src/ui/page.test.tsx` (or the existing UI test file) -- unit: the scroll box is positioned, and the terminal peek's `absolute` still replaces it -- guards the class merge

**Acceptance Criteria:**
- Given the ticket's reproduction, when it runs on the fix, then the window never scrolls and the conversation ends at its last item at 1440 and 390 px.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: all pass
- `pnpm e2e` -- expected: all pass, including `chat-scroll.spec.ts`
- `pnpm run pack && pnpm smoke` -- expected: pass
