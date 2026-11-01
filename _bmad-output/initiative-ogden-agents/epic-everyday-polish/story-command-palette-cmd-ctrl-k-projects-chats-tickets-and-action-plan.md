---
title: 'Command palette (Cmd/Ctrl+K): projects, chats, tickets and actions'
type: 'feature'
ticket: '3'
created: '2026-10-31'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
baseline_revision: 'b74d5d35d8094702d5f58a2c3e5878bc262c8333'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-everyday-polish/epic-everyday-polish.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** There is no way to jump anywhere from the keyboard: reaching a chat in another project, a ticket or a settings page takes several clicks, and `g n` outside a project does nothing (audit Keyboard, top 10 #8; E26-R3).

**Approach:** A command palette per EXPERIENCE.md Command palette and DESIGN.md `command-palette`: Cmd/Ctrl+K opens it anywhere (also from the composer); the empty query shows Recent chats, Actions and Projects; typing matches Chats, Projects, Tickets (current project, Board on) and Actions; Enter runs the chosen item. Results come from a fixed, ordered list of sources (a Files group slot reserved), so 8.11 adds files and its Workbench, Search and Run tests actions by adding sources. `g n` and the desktop's NEW_CHAT_EVENT outside a project open it on "New chat in...".

## Boundaries & Constraints

**Always:** combobox field with a listbox of grouped options, `aria-activedescendant`, the result count announced politely; `↑` `↓` move (wrapping), Enter runs, Esc closes and focus returns to where it was (a run that navigates leaves focus to the destination); matching ignores case and gaps, groups in order Chats, Projects, Files, Tickets, Actions, at most 50 results; no match reads `Nothing matches “<query>”.`; kbd hints only in Developer mode; visual styling only in `src/ui` (design-tokens test); existing tokens only; no em or en dashes in UI strings; actions reuse the existing openers (`useOpenNewChat`, `needsYouTarget`/`nextNeedsYou`/`markNeedsYouOpened`, `setChatDetail`, `SETTINGS_GROUPS`/`visibleSettingsGroups`, `useAppearance().update`); recent chats kept in guarded `localStorage`, never sent to the server.

**Never:** files, Workbench, Search the project or Run tests (8.11); a server, shared or core change; a new dependency (no cmdk); tickets of projects other than the current one; Cmd/Ctrl+K taken from a focused terminal (xterm) with Ctrl; a second modal over an open dialog.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open | Cmd/Ctrl+K anywhere, focus in the composer too | palette open, field focused, empty-query groups | No error expected |
| Toggle | Cmd/Ctrl+K while open | closes, focus back | No error expected |
| Other dialog open | focus in a dialog or alert dialog | nothing | No error expected |
| Chat in another project | "invoice" matches a chat title in project B | Chats row: title, project B, state glyph; Enter opens `/w/B/s/S` | No error expected |
| Ticket by ref | in a project with the Board on, "1.2" | Tickets row "1.2 Build the second thing"; Enter opens `/w/W/board/1.2` | tickets fail to load: no Tickets group |
| Board off / outside a project | any query | no Tickets group, no tickets request | No error expected |
| New chat in a project | "New chat" | draft `/w/W/new`, composer focused | No error expected |
| New chat outside a project | `g n`, NEW_CHAT_EVENT, or "New chat in..." | palette on "New chat in..." listing projects; Enter opens that project's draft; Esc or Backspace on empty field returns to the full palette | no projects: "Nothing matches" |
| Show every step | on a chat in Normal | action "Show every step"; runs `setChatDetail(sesId,'verbose')`; next time reads "Show less detail" | not on a chat: action absent |
| Go to Needs you | Needs you has items | opens the next item as `g y` does | empty: action absent |
| Recent chats | 7 chats opened | the last 5 opened, newest first, existing ones only | storage throws: group empty |
| No match | "zzzz" | `Nothing matches “zzzz”.` | No error expected |

</frozen-after-approval>

## Code Map

- Work only in this plan's git worktree (`/Users/harrisonsmith/Library/Caches/ogden-agents-dev-worktrees/26.3`), running every command there; do not commit, push, switch branches or touch `deferred-work.md` (deferred items go in this plan under "Deferred (for the sweep)"). The machine is heavily loaded: run `pnpm typecheck`, the unit tests you touch (`pnpm exec vitest run <files>`) and `tests/design-tokens.test.ts`; run the new Playwright spec after `pnpm run build` (`pnpm exec playwright test tests/e2e/command-palette.spec.ts`). The caller runs the full suite.
- `packages/web/src/shell/app-shell.tsx` -- mounts shell-wide pieces (`NeedsYouKeys`, `NewChatKeys`) inside `SidebarDataProvider`; mount the palette here once.
- `packages/web/src/shell/new-chat-keys.tsx` -- `g n` binding only with `wsId`; the NEW_CHAT_EVENT listener no-ops outside a project. Outside a project both open the palette on "New chat in...".
- `packages/web/src/shell/use-go-shortcuts.ts` -- `useGoKeys`, `isTypingTarget`; `shell/keyboard-guard.ts` `isInsideOverlay` (already counts `listbox` and `dialog`, so `g` keys stay off while the palette is open).
- `packages/web/src/shell/sidebar-data.tsx` -- `useSidebarData().model`: `groups[]` (`wsId`, `name`, `rows` + `earlier`: `SidebarRow` with `sesId`, `title`, `state`, `agentName`) and `needsYou`. Chats and projects come from here (no new requests).
- `packages/web/src/shell/needs-you-keys.tsx` -- the `g y` run to reuse for Go to Needs you.
- `packages/web/src/chat/new-chat.ts` -- `useOpenNewChat()(wsId)`.
- `packages/web/src/chat/detail-level.ts` -- `useChatDetail(sesId, developerMode)`, `setChatDetail`, `DETAIL_MENU_WORDS`.
- `packages/web/src/settings/settings-groups.ts` -- `visibleSettingsGroups(pathname, developerMode)`, each group's first page `to`.
- `packages/web/src/appearance/appearance-provider.tsx` -- `useAppearance()` (`theme: 'light'|'dark'|'system'`, `developerMode`); Appearance page labels Light, Dark, System.
- `packages/web/src/planning/planning-api.ts` -- `fetchTickets(wsId)`, query key `['tickets', wsId]` (share it); `TicketRow.ref`, `.title`. Board on = `visibleWorkspaceTabs(...)` in `shell/workspace-tabs.tsx` includes `board` (`useWorkspaceSettings`, `useBmadPieces` from `workspaces/workspace-settings-api`).
- `packages/web/src/ui/dialog.tsx` -- Radix Dialog pattern (overlay, `shadow-float`, `DialogPrimitive.Title`); `ui/state-glyph.tsx` `StateGlyph`; `ui/kbd.tsx` `Kbd`. DESIGN.md `command-palette`: 640px, 20% from top, popover bg, `rounded-lg`, 48px field with MagnifyingGlass and bottom border, sentence-case caption group headings, rows at `--row-height`, selected `bg-accent`, matched letters weight 600, max 60vh scroll.
- `packages/web/src/shell/keyboard-shortcuts.ts` -- Help's table; `driverShortcutLabel(platform)` in `terminal/driver-toggle.tsx` is the platform spelling pattern.
- Router paths: `/w/$wsId`, `/w/$wsId/s/$sesId`, `/w/$wsId/board/$ref`, `/settings/...`.
- e2e: `tests/e2e/chat-server.ts` (`withChatServer`, `startChat`, `send`, `setDeveloperMode`), `tests/e2e/tab.ts`; `plan-and-board.spec.ts` `stubTicketStore()` and how it turns Board on and trusts the project; `@axe-core/playwright` (see `one-line-sidebar.spec.ts`).

## Tasks & Acceptance

**Execution:**
- [x] `packages/web/src/palette/palette-match.ts` (new) -- `matchText(query, text)`: case-insensitive, contiguous substring first (word start scores best), else subsequence; returns score and matched indices; `rankItems` keeps group order, sorts by score within a group, caps at 50.
- [x] `packages/web/src/palette/palette-sources.ts` (new) -- `PaletteItem` (`id`, `group`, `label`, `context?`, `glyph`, `keys?`, `keywords?`, `run` or `mode`), `PALETTE_GROUP_ORDER` (`chats`, `projects`, `files`, `tickets`, `actions`) with labels, `PaletteSource` (`group`, `useItems(ctx)`), and `PALETTE_SOURCES` (chats, projects, tickets, actions): a constant list, so hooks run in one order and 8.11 appends.
- [x] `packages/web/src/palette/recent-chats.ts` (new) -- guarded bounded list (`ogden-agents.recent-chats.v1`, 20 kept), `recordRecentChat(wsId, sesId)`, `recentChats()`.
- [x] `packages/web/src/palette/palette-store.ts` (new) -- `openCommandPalette(mode?: 'all' | 'new-chat-in')`, `closeCommandPalette()`, `usePaletteState()` (`useSyncExternalStore`).
- [x] `packages/web/src/ui/command-palette.tsx` (new) -- presentational: Radix dialog shell, field, grouped listbox, option row (glyph, label with matched letters, context, kbd), empty text, sr-only live count.
- [x] `packages/web/src/palette/command-palette.tsx` (new) -- `CommandPalette` (Cmd/Ctrl+K listener, query and selection, modes, run and close, focus handling) and recording recent chats on `/w/:wsId/s/:sesId`; mount in `app-shell.tsx`.
- [x] `packages/web/src/shell/new-chat-keys.tsx` -- outside a project, `g n` and NEW_CHAT_EVENT call `openCommandPalette('new-chat-in')`.
- [x] `packages/web/src/shell/keyboard-shortcuts.ts` -- rows: Cmd/Ctrl+K "Command palette"; `g n` "New chat" ("In a project; elsewhere opens the palette"); Cmd/Ctrl+N "New chat" ("In the desktop app; a browser tab keeps it"), platform spelled.
- [x] `packages/web/test/palette-match.test.ts`, `palette-sources.test.ts`, `recent-chats.test.ts`, `command-palette.dom.test.tsx` (new) -- the matrix: matching and order, cap, sources per context, recent bound and throwing storage, keyboard flow, modes.
- [x] `tests/e2e/command-palette.spec.ts` (new) -- the verify: Cmd/Ctrl+K opens; a chat in another project found by a title word and opened; a ticket found by its ref and opened; New chat and Show every step run; `g n` on home opens "New chat in..."; Esc returns focus; axe on the open palette; 390px screenshot under `test-results/`.

**Acceptance Criteria:**
- Given focus in the composer, when the user presses Cmd/Ctrl+K, then the palette opens with its field focused, and Esc closes it with focus back in the composer.
- Given the palette open, when a screen reader reads it, then the field is a combobox controlling a listbox of grouped options and the result count is announced.
- Given the Help menu's Keyboard shortcuts, then Cmd/Ctrl+K, `g n` and Cmd/Ctrl+N are listed.

## Implementation Notes

- Radix Dialog with no trigger sends focus to the body on close, so the store records what had focus when the palette opened (`paletteReturnTarget`) and `onCloseAutoFocus` puts it back, unless the run navigates (items mark `returnFocus` when they stay: the detail level and the themes).
- An unnamed chat ("New chat", no user title) is left out of typed Chats results: otherwise every unnamed chat outranks the New chat action (Chats come first) and typing "New chat" opens an old empty chat. It can still show under Recent chats.
- "New chat in..." is an action in every context (beside New chat in a project); Esc in that mode goes back to everything first, a second Esc closes.
- The Cmd/Ctrl+K listener is on `window` in the capture phase, so it wins over the composer's keys; it does nothing while focus is in another dialog, alert dialog, menu or listbox (`isInsideOverlay`), and Ctrl+K inside `.xterm` is left to the shell.
- Help lists Cmd/Ctrl+K, `g n` and Cmd/Ctrl+N first under Go to (`modifierShortcutLabel`, spelled like `driverShortcutLabel`); `SETTINGS_GLYPHS` is now exported from `settings-layout.tsx` for the Settings actions.
- `tests/e2e/new-chat.spec.ts`'s outside-a-project test now expects the palette on "New chat in..." for `g n` and NEW_CHAT_EVENT (it expected nothing before).

- Verification after review patches: `pnpm typecheck` clean; `pnpm test` 417 files, 5449 passed, 10 skipped; `pnpm run build` then Playwright command-palette, new-chat, one-line-sidebar, needs-you-rows, terminal, tool-row-detail, settings-nav, layout: all passed, except `new-chat.spec.ts:78` (first send navigates to the chat), which timed out 4 times under load and also failed with this story's web sources reverted to the baseline (so not caused here), then passed in the next full run of four specs (47 passed); provenance passes; the 390px screenshot (`test-results/command-palette-390.png`) shows the field, "New chat in..." chip and rows inside the viewport, nothing clipped.

## Deferred (for the sweep)

- On a Mac, Ctrl+K also opens the palette, so text fields lose the system's Ctrl+K (delete to end of line); the palette key could be Cmd only on Apple devices.
- `new-chat.spec.ts` "the draft first message makes exactly one chat" is flaky under load at the baseline too (the draft stays on `/new` after the send).

## Plan Change Log

## Review Triage Log

Pass 1 (quick lens, fresh subagent given the plan, rules, diff and code): 6 findings; medium 2, low 4, false 0, maybe-false 0.

| # | Finding | Verdict | Route |
|---|---------|---------|-------|
| 1 | Outside a project, NEW_CHAT_EVENT (desktop Cmd/Ctrl+N) opens the palette over an open dialog; only `g n` goes through `isShortcutKey`'s overlay guard | medium | patch: the event path skips when focus is inside an overlay, as Cmd/Ctrl+K does |
| 2 | No match puts a `<p>` as the listbox's only child (axe `aria-required-children`) and the combobox stays `aria-expanded` | medium | patch: the empty line sits outside the listbox; `aria-expanded` follows the results; the e2e axe check covers the no-match state |
| 3 | `modifierShortcutLabel` copies `driverShortcutLabel`'s platform test (AGENTS.md reuse rule) | low | patch: one helper, the other delegates |
| 4 | `matchText` lowercases the whole string, so characters whose lowercase has another length (`İ`) shift the marked letters | low | reject: needs such characters in a name, only the bold letters move, and the fix needs a position map |
| 5 | Non-Latin layouts (Cyrillic, Greek) give `event.key` other than `k`, so Cmd/Ctrl+K never opens | low | patch: `event.code === 'KeyK'` also counts when the key is not a Latin letter |
| 6 | A navigating item whose target is the page already shown leaves focus on the body | low | patch: after such a run, focus still on the body goes back to where it was |

## Design Notes

Sources are hooks in a constant array, called in order every render, each returning items for one group; the palette ranks and slices. A Files source in 8.11 is one more array entry for the reserved `files` group; nothing else changes. Tickets read only the current project (one `tickets.py` read, cached under the Board's own key and only while the palette is open), since the ref is per project and EXPERIENCE.md scopes files the same way. Theme is three actions ("Theme: Light", "Theme: Dark", "Theme: System"), the current one left out. Settings groups are actions "Settings: <group>". Ctrl+K inside xterm is left to the shell (kill line); Cmd+K on Apple devices always opens.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors
- `pnpm test` -- expected: full suite passes
- `pnpm run build && pnpm exec playwright test tests/e2e/command-palette.spec.ts tests/e2e/new-chat.spec.ts tests/e2e/one-line-sidebar.spec.ts tests/e2e/needs-you-rows.spec.ts` -- expected: pass
- `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs` -- expected: pass

**Manual checks:**
- 390px screenshot of the open palette: field and rows inside the viewport, nothing clipped.
