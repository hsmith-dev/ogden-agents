---
title: 'Command palette gains files'
type: 'feature'
ticket: '11'
created: '2026-11-01'
status: 'built'
baseline_revision: '9994d01593d69a32e8d17fee9c296d880aa4e121'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: ['{project-root}/AGENTS.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The command palette (26.3) finds chats, projects, tickets and actions, but not files: its reserved Files slot is empty, so opening a file by name means going to the Workbench and its Search panel (E8-R10, EXPERIENCE.md Command palette).

**Approach:** Append a Files source to `PALETTE_SOURCES`: in a project, typing asks 8.8's file-name search (`GET files/search?mode=names`) for the current project, debounced, with stale requests cancelled; the hits show in the Files group (name, folder in caption) and Enter opens the viewer (`/w/$wsId/workbench?path=`). Add the Workbench and Search the project actions named in EXPERIENCE.md.

## Boundaries & Constraints

**Always:** current project only (the palette's `wsId`; nothing outside a project, nothing in "New chat in..."); only the existing `fetchWorkspaceSearch` (names mode, no Match case, no Regex); a request only while the palette is open and the trimmed query is not empty, after a pause in typing (250 ms, 8.8's `SEARCH_DEBOUNCE_MS`); a newer query, closing the palette or leaving the project aborts the request in flight (react-query signal, `gcTime: 0`); at most one palette search in flight per tab; never retried; any error (501, 4xx, network) leaves the Files group out silently; at most 8 files shown, ranked by the palette's own matcher on the file name (path as a keyword); a file row's id is its path; results never stored (no localStorage, no recent files); the actions reuse the routes `g w` and `g s` open; existing tokens and `src/ui` components only; no em or en dashes in UI strings.

**Never:** a new route, server, shared or core change; a new file-reading path; listing folders client-side to find files; a worktree chat's tree (the project root only); Run tests (Problems, epic 8 entry 9, is not built: deferred); changing 26.3's ranking, cap or keyboard behaviour; a new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Find a file | in project W, type `palet` | after a pause one `names` request `q=palet`; Files group "palette.ts" with "src/ui" in caption, between Projects and Tickets | none |
| Open | Enter on that row | navigates `/w/W/workbench?path=src/ui/palette.ts`, palette closed | none |
| Fast typing | `p`,`pa`,`pal` within 250 ms | one request (`pal`) | none |
| Stale | `pal` in flight, type `pale` | `pal` aborted, `pale` sent | none |
| Close | palette closed with a request in flight | aborted, no further requests | none |
| Outside a project | home, any query | no Files group, no request | none |
| New chat in... | mode `new-chat-in` | no request | none |
| Empty query | open palette | no request, no Files group | none |
| Many hits | 500 names | 8 shown | none |
| Failure | 501, 400 or network error | no Files group; other groups unaffected | silent |
| Actions | in project W, type `workbench` / `search the` | "Workbench" opens `/w/W/workbench`; "Search the project" opens `?panel=search` | outside a project: absent |

</frozen-after-approval>

## Code Map

Project root: the git worktree `/Users/harrisonsmith/Library/Caches/ogden-agents-dev-worktrees/8.11`; all paths relative to it, every command run there; never edit another checkout, never `git stash`, push, switch branches or commit (the caller commits). Other stories build in parallel: keep to these files. The machine is loaded: focused tests (`pnpm exec vitest run <files>`), re-run a timing failure alone.

- `packages/web/src/palette/palette-sources.ts` -- `PaletteItem`, `PaletteContext` (`open`, `query`, `wsId`, ...), `PALETTE_SOURCES` (append Files; the group order already has `files` after `projects`), `actionItems`/`ActionInputs` (pure, unit-tested: add Workbench, keys `g w`, and Search the project, keys `g s`, only with `wsId`; icons from `@phosphor-icons/react`, e.g. `Files`/`MagnifyingGlass`). Pattern to follow: pure `ticketItems` builder plus a `useTicketItems` hook. The palette does not pass its mode to sources: add `mode` to `PaletteContext` (from `command-palette.tsx`) so the Files source stays idle in "New chat in...".
- `packages/web/src/palette/palette-match.ts` -- `rankItems(query, items, ['files'], 8)` to pick the 8 best inside the builder; `matchText` matches the label, then keywords (lower score, no marked letters).
- `packages/web/src/palette/command-palette.tsx` -- builds `ctx`; add `mode`. `PALETTE_PLACEHOLDER` becomes "Search projects, chats, files and actions" only if tests and EXPERIENCE.md agree (EXPERIENCE.md says so); update its tests.
- `packages/web/src/workbench/workbench-api.ts` -- `fetchWorkspaceSearch(wsId, {q, mode:'names', matchCase:false, regex:false}, signal)`; add `usePaletteFileSearch(wsId, q, enabled)` beside `useWorkspaceSearch` (own key `['palette-files', wsId, q]`, signal passed, `retry: false`, `gcTime: 0`, `staleTime: 0`, `refetchOnWindowFocus: false`, `placeholderData: keepPreviousData` scoped to the same `wsId`). Abort on key change works because `gcTime: 0` removes the unobserved query and react-query cancels a consumed signal.
- `packages/web/src/workbench/workbench-search.tsx` -- `SEARCH_DEBOUNCE_MS` (reuse, import it). Debounce in the hook with a small `useDebouncedValue` (state + `setTimeout`); the debounced value is `''` when closed, outside a project or in another mode, so closing changes the key and aborts.
- Router: `/w/$wsId/workbench` with `search: { path }` (Files panel, viewer), `{ panel: 'search' }` (Search); same as `shell/workspace-tabs.tsx:186`.
- Tests: `packages/web/test/palette-sources.test.ts` (pure builders), `packages/web/test/command-palette.dom.test.tsx` (mocks router, sidebar, settings and planning; add a `vi.mock('../src/workbench/workbench-api')` stand-in for `fetchWorkspaceSearch` recording `q` and the signal), `tests/e2e/command-palette.spec.ts` (`withChatServer` with `files`, `addProject` pattern from `tests/e2e/workbench-files.spec.ts:28`, axe via `@axe-core/playwright`, 390px).

## Tasks & Acceptance

**Execution:**
- [x] `packages/web/src/workbench/workbench-api.ts` -- `usePaletteFileSearch` -- names search for the palette, cancellable.
- [x] `packages/web/src/palette/palette-sources.ts` -- `fileItems(wsId, files, query, openFile)` pure builder (label = base name, context = folder or none, keywords = [path], glyph `File` icon, id `file:<path>`, best 8), `useFileItems` (debounce, idle rules), Workbench and Search the project in `actionItems`, `mode` in `PaletteContext`, append to `PALETTE_SOURCES`.
- [x] `packages/web/src/palette/command-palette.tsx` -- pass `mode`; placeholder per EXPERIENCE.md.
- [x] Tests: `palette-sources.test.ts` rows for `fileItems` (labels, folder caption, root file, cap 8, empty query, no wsId) and the two actions; `command-palette.dom.test.tsx` rows for the matrix (debounce one request, abort on newer query and on close, no request outside a project, in "New chat in..." or on an empty query, failure leaves the group out, Enter navigates to the viewer); Playwright: open the palette in a fixture project, type part of a fixture file's name, see it under Files, Enter opens the viewer with the file shown; requests counted (at most 3 for one word typed); axe on the open palette with files; 390px no sideways scroll.

**Acceptance Criteria:**
- Given a fixture project with `src/zebra-notes.md`, when the user opens the palette and types `zebra`, then a Files row "zebra-notes.md" appears and Enter opens it in the viewer.
- Given `pnpm typecheck` and `pnpm test`, then both pass with 26.3 and 8.8 tests unchanged except the placeholder text and the new action rows.

## Implementation Notes

- Base: `epic/8-workbench` did not contain 26.3; the branch merged `ca59b8eb` (26.3 into epic 26) first, resolving Help's shortcut list (both `⌘K`/`g n`/`⌘N` and `g s`).
- The DOM test stands in for `call` in `@/api/http` (only `/files/search` requests; others pass through) rather than `vi.mock('../src/workbench/workbench-api')`: `usePaletteFileSearch` calls `fetchWorkspaceSearch` inside the same module, so mocking that export would not reach it. The request's `q`, `mode` and signal are recorded as planned.
- Review fixes (pass 1): no `placeholderData` (the observer's last data outlived `gcTime: 0`, so old hits came back on reopening); the Files group waits for its answer. The palette's selection is held by item id, so files arriving after a row is highlighted never move it.
- Verified (after review fixes): `pnpm typecheck` clean; `pnpm test` at load about 8: 5801 passed, 13 skipped (445 files); after the build, command-palette, workbench-files and workbench-changes specs passed (8, axe and 390px included); provenance check passed.

## Plan Change Log


## Review Triage Log

Pass 1 (2026-11-01; lens: quick, a fresh subagent given the plan, rules and diff). Verdicts: high 0, medium 2, low 2, false 0, maybe-false 0. No intent_gap or bad_plan; patches sent to the implementer; one rejected.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | The selection is an index, so file results arriving after the debounce (ranked ahead of Tickets and Actions) move the highlighted row; Enter after typing `workbench` can open `workbench-api.ts` instead of the action | medium | patch | `selected` resets only on open, mode or typing; files are the first group whose rows arrive late. Selection now follows the item's id |
| 2 | `placeholderData` reads the observer's last data, which outlives `gcTime: 0`: after close and reopen, old file hits show while the new request loads | medium | patch | react-query's observer keeps `#lastQueryWithDefinedData`; the palette is mounted for the whole tab. `placeholderData` removed |
| 3 | `palette-sources.test.ts` "the sources" expectation changed beyond the AC's wording | low | reject | Adding a source must change that list; the fix would be editing this plan's wording |
| 4 | `app-shell.tsx:40` comment still lists the palette without files | low | patch | Comment updated |

## Design Notes

The server matches names as a contiguous substring of the path (case insensitive); the palette then ranks the returned rows with its own matcher; nothing is kept while the next answer loads, and the selection follows an item's id so late rows never move it. Folder-part matches (`ui/pal`) match the path keyword, ranked below name matches. Files come before Tickets and Actions in the order, so the cap of 8 keeps actions reachable under the 50-result cap. The server already limits 2 searches at once and stops an aborted one; the palette adds at most one in flight per tab.

## Deferred (for the sweep)

- Run tests in the palette waits for Problems (epic 8 entry 9), which is not built yet. (8.12: logged in `deferred-work.md`.)
- On a worktree chat the palette's Files searches the project root, not the chat's worktree (the Workbench passes `session`; the palette does not). (8.12: fixed (the palette names the worktree chat on screen in the search and the file it opens; `packages/web/src/workbench/chat-folder.ts`).)

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors
- `pnpm test` -- expected: all pass (wait for `uptime` load below 40; re-run timing failures alone)
- `pnpm run build && pnpm exec playwright test tests/e2e/command-palette.spec.ts tests/e2e/workbench-files.spec.ts tests/e2e/workbench-changes.spec.ts` -- expected: pass
- `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs` -- expected: pass
