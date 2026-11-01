---
title: 'Tracer bullet: Needs you rows show the request, and g y jumps to the next one'
type: 'feature'
ticket: '1'
created: '2026-10-31'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
baseline_revision: '50af0f2a0e97e88d2d46a194b1cb8617d1ba6c1f'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-everyday-polish/epic-everyday-polish.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Each Needs you row is one truncated line ("clay-and-kiln, permission npm in..."), so the request is always cut off at the sidebar's width, permission and review rows look alike, the list grows without limit, and there is no key to the next waiting item (audit top 10 #1; E26-R1).

**Approach:** Render each row as two lines (what, in full words; then project and chat) with a kind glyph, show five rows then "Show N more", and add `g y` (open the next row's target after the one last opened, wrapping) plus `]` and `[` inside the group, reading today's browser-side Needs you list. A permission row opens its chat on its card.

## Boundaries & Constraints

**Always:** the row's fields stay kind, what (`text`), where (`workspaceName`, `chatName`): the shape 20.9 keeps; existing DESIGN.md tokens only; no em or en dashes in UI strings; single-letter keys never fire while typing, in a dialog or a menu (`isShortcutKey`); each row's accessible name reads both lines ("<what>, in <project>, <chat>").

**Never:** a core or server change; new Needs you kinds or new texts for runs; `g n`, Cmd/Ctrl+N or the palette (entries 2 and 3); workspace switching with `[`/`]` outside the group.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Next after last opened | rows A, B; last opened A | `g y` opens B | No error expected |
| Wrap | rows A, B; last opened B | `g y` opens A | No error expected |
| Nothing opened yet, or last opened row gone | rows A, B; last opened X not in list | `g y` opens A | No error expected |
| Empty list | no rows | `g y` does nothing | No error expected |
| Many rows | 8 rows | 5 show, then "Show 3 more"; pressed, all 8 and "Show fewer" | No error expected |
| Bracket keys | focus on row 2 of 3 | `]` focuses row 3, `[` row 1; at the ends nothing moves | No error expected |
| Permission row target | permission request `req_x` in chat S | link to `/w/W/s/S#permission-req_x`; the session page scrolls to and focuses that card | card gone: plain session open |

</frozen-after-approval>

## Code Map

- `packages/web/src/shell/needs-you-group.tsx` -- `NeedsYouItem`, `NeedsYouRow`, `NeedsYouGroup` (rail button + panel). Rewrite the row; add optional `kind?: NeedKind` to the item (entries from `sidebar-model.ts` already carry it).
- `packages/web/src/shell/sidebar-model.ts` -- `NeedKind`, `NeedsYouEntry` (permission entries: `id` is the requestId), `buildSidebar` already sorts oldest first. Do not change.
- `packages/web/src/shell/status-sidebar.tsx` -- passes `model.needsYou` (held while pointer or focus is inside) and an inline `onOpenFirst` navigate; replace with the shared target helper.
- `packages/web/src/shell/use-go-shortcuts.ts` -- the `g` sequence handler (`isShortcutKey`, `GO_SHORTCUT_WINDOW_MS`); used only by `workspace-tabs.tsx` (inside a project). Generalise the listener into `useGoKeys(bindings: {key, run}[])`; `useGoShortcuts` becomes a thin caller.
- `packages/web/src/shell/app-shell.tsx` -- mounts once per tab inside `SidebarDataProvider`; mount the `g y` binding here (the sidebar body renders twice: column and sheet).
- `packages/web/src/shell/sidebar-data.tsx` -- `useSidebarData().model.needsYou` is the live list.
- `packages/web/src/routes/session-page.tsx` -- `showCard` (lines ~361-366) scrolls to and focuses `#permission-<requestId>`; cards have that id (`permission-card.tsx:107`). Add: on the location hash naming a pending card, focus it once (not while the terminal drives).
- `packages/web/src/ui/sidebar.tsx` -- `SidebarMenuButton` (fixed `h-(--row-height)`; override with `h-auto py-1` as `SidebarStatusRow` does), `SidebarAttentionGroup`.
- Tests: `packages/web/test/needs-you-group.test.tsx`, `pane-needs.test.tsx` (static render); e2e `tests/e2e/sidebar.spec.ts` lines 54, 56, 96 assert the old one-line text and a href ending at the session; helpers `withChatServer`, `startChat`, `send`, `sidebarOf` in `tests/e2e/chat-server.ts` and `tab.ts`; the fake agent's `permission <command>` asks for that command.

## Tasks & Acceptance

**Execution:**
- [x] `packages/web/src/shell/needs-you-target.ts` (new) -- `needsYouTarget(item)` (terminals, review page, or session with `#permission-<id>` for a permission), `nextNeedsYou(items, lastId)`, and a module-level last-opened id (`markNeedsYouOpened`, `lastNeedsYouOpened`) -- one rule for click, rail and `g y`.
- [x] `packages/web/src/shell/needs-you-group.tsx` -- two-line row with kind glyph (permission, question for waiting/check_in/sign_in/pane, review, blocked), what clamped to two lines and cut only at its end, where on one line, `aria-label` "<what>, in <project>, <chat>"; five rows then "Show N more" / "Show fewer"; `]`/`[` move focus between visible rows; clicks mark opened.
- [x] `packages/web/src/shell/use-go-shortcuts.ts` -- extract `useGoKeys`; keep `useGoShortcuts` behaviour.
- [x] `packages/web/src/shell/needs-you-keys.tsx` (new) + `app-shell.tsx` -- `g y` binding over the live list: navigate to `needsYouTarget(nextNeedsYou(...))`, mark opened.
- [x] `packages/web/src/shell/status-sidebar.tsx` -- rail `onOpenFirst` via the helper.
- [x] `packages/web/src/routes/session-page.tsx` -- hash names a pending card: scroll to and focus it once.
- [x] `packages/web/test/needs-you-target.test.ts` (new), `needs-you-group.test.tsx`, `pane-needs.test.tsx` -- matrix cases, two lines, glyph per kind, accessible name, Show N more, permission hash href.
- [x] `tests/e2e/needs-you-rows.spec.ts` (new) -- the ticket's verify; update `sidebar.spec.ts` assertions for the new row text and href.

**Acceptance Criteria:**
- Given two waiting chats in two projects, when the sidebar is at its full width (1440 wide window), then each row shows its whole request on line one (not clipped) and "project, chat" on line two, and its accessible name reads both lines.
- Given those rows and nothing opened, when the user presses `g y` three times from the home page, then the first chat opens with its card focused, then the second, then the first again.
- Given focus on the first row, when the user presses `]` then `[`, then focus moves to the second row and back.

## Implementation Notes

- The row's styling lives in `ui/sidebar.tsx` (`SidebarNeedsRow`, `SidebarMoreButton`): `tests/design-tokens.test.ts` refuses visual utilities in `src/shell`.
- Glyphs: Phosphor `Shield` (permission), `ChatCircleDots` (question: waiting, check_in, sign_in, pane; Phosphor 2.1 has no chat-question icon), `CheckSquare` (review), `WarningDiamond` (blocked), at `--icon-size-compact`.
- The row last opened (click, rail or `g y`) keeps the signal rail per DESIGN.md needs-you-row (`data-last-opened`); the module store notifies the group through `useSyncExternalStore`.
- The rail button still opens the first row (now through `needsYouTarget`, so a permission opens on its card) and marks it opened.
- The session page focuses the hashed card once per history entry (`__TSR_key`) and per open (review 1: `needsYouOpenCount`, since the router pushes nothing for the same URL), so `g y` wrapping back to the same card focuses it again.
- `]`/`[` are the group's own handler, not a global shortcut: they act only with focus on a row link, so they skip `isShortcutKey` (review 4) and work with AltGr or Shift layouts and in the phone drawer; Cmd chords are ignored. The Boundaries rule on single-letter keys governs the global `g` sequences, which still use it.
- `tests/e2e-installed/chat-journey.spec.ts` asserted the old row text and href too; updated alongside `sidebar.spec.ts`, not run here (needs the packed tarball).
- `tests/design-tokens.test.ts` "tokens.css matches every token in DESIGN.md" failed at the baseline (syntax and diff-gutter tokens added to DESIGN.md for epic 8, values only); `tokens.css` now carries those six tokens in light and both dark blocks, copied from DESIGN.md, so the full suite passes. Nothing uses them yet.
- Verification: `pnpm typecheck` clean; `pnpm test` 5134 passed, 10 skipped after the token fix; full e2e 207 of 208 then `empty-project.spec.ts` (Start a chat, not Needs you) passed on 2 reruns with `needs-you-rows.spec.ts`; provenance passes.

## Plan Change Log

## Review Triage Log

Pass 1 (quick lens, fresh subagent): 4 findings; medium 2, low 2, false 0, maybe-false 0.

| # | Finding | Verdict | Route |
|---|---------|---------|-------|
| 1 | Reopening the card for the URL already shown (one row, `g y` wraps to it) never refocuses it: the router pushes no new entry for the same location, so the effect's key is unchanged | medium | patch: an open counter in `needs-you-target.ts`, bumped by every open, is part of the session page's dedupe key |
| 2 | The last-opened rail widens the left border from 1px to 2px, shifting the row 1px as the mark moves | low | patch: every row has the 2px left border; only its colour toggles |
| 3 | The last-opened mark can sit on a row hidden behind "Show N more" after `g y` opens row 6 or later | low | reject: needs more than five waiting items, and the fix adds an expand branch; `g y` still opens the right target |
| 4 | `]`/`[` require no modifier, so layouts that type brackets with AltGr or Shift never move, and the phone drawer (a dialog) blocks them | medium | patch: the group's handler drops `isShortcutKey`; it already requires focus on a row link |

## Design Notes

"Two lines" is read as two parts: what may wrap to a second visual line (line-clamp-2) because "Claude Code wants to run npm test" alone is wider than the 270px sidebar's text column; the verify asks for the request in full at that width. Where stays one truncated line. Last opened lives in a module variable (one per tab), so clicking a row and `g y` share it, and a page reload starts at the first row. Two `g` listeners (tabs, `g y`) each keep their own pending `g`; neither prevents the other's key.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors
- `pnpm test` -- expected: full suite passes
- `pnpm e2e -- tests/e2e/needs-you-rows.spec.ts tests/e2e/sidebar.spec.ts tests/e2e/needs-you-and-webhooks.spec.ts tests/e2e/panes.spec.ts tests/e2e/notifications.spec.ts` -- expected: pass
- `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs` -- expected: pass
