---
title: 'Settings with grouped navigation'
type: 'feature'
ticket: '7'
created: '2026-10-31'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
baseline_revision: '3743a5375b8284fbbc31330c1d9fbf765f5b0570'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-everyday-polish/epic-everyday-polish.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Settings is a 12-item pop-up menu in the sidebar footer; every settings page loses it, so Agents to Appearance takes three clicks, and the items mix overlapping tools pages and Welcome (audit Settings, top 10 #10; E26-R7).

**Approach:** A settings layout with a persistent left nav in seven groups (Agents, Projects, Appearance, Notifications, Terminals, Remote machines, Advanced) wraps every `/settings/*` page; the current group's other pages show as sub-links under it; below `md` the nav becomes a select at the top of the page. The footer's Settings becomes a plain link. Every existing route keeps its URL and page.

## Boundaries & Constraints

**Always:** every route in `router.tsx` under `/settings` (appearance, tools, mcp, agents, agents/new, builds, dev-tools, remote-machines, notifications, terminals, about, new-projects, and `/settings` redirecting to appearance) still opens its page by URL; existing DESIGN.md tokens only, styling in `src/ui` (the token test refuses visual utilities in `src/shell`, `src/routes`); no em or en dashes in UI strings; the current item is marked `aria-current="page"`; `↑` `↓` move focus between nav links; the Terminals group shows only in Developer mode (AD-21), or while its page is open.

**Never:** merging or rewriting the settings pages themselves; new routes (`/settings/:group` stays the group's existing page); Phone, Always allow rules or other unbuilt pages (entry 8 adds its list later); a Help menu (entry 5); server changes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| One click between groups | on `/settings/agents` | click Appearance in the nav opens `/settings/appearance`; nav still shown, Appearance current | No error expected |
| Sub-page | on `/settings/mcp` | Advanced is current; its sub-links Tools, Developer tools, MCP servers, About, Welcome show, MCP servers current | No error expected |
| Add your own agent | on `/settings/agents/new` | Agents group current | No error expected |
| Terminals, simple mode | Developer mode off, on `/settings/appearance` | no Terminals group | No error expected |
| Terminals by URL, simple mode | Developer mode off, on `/settings/terminals` | Terminals group shown and current | No error expected |
| Phone width | 390px on `/settings/agents` | no left column; a labelled select "Settings page" under the header shows the current page; choosing Appearance navigates; no horizontal overflow | No error expected |
| Not a settings path | `/w/x/settings` | not wrapped (workspace settings is its own route) | No error expected |

</frozen-after-approval>

## Code Map

- `packages/web/src/router.tsx` -- `settingsRoute` (path `/settings`, `beforeLoad` redirect to appearance, no component; children render straight into AppShell's `<Outlet/>`). Give it a component (the layout, lazy or eager) rendering the nav plus `<Outlet/>`; keep every child route and the redirect.
- `packages/web/src/shell/status-sidebar.tsx` -- `SettingsMenu` (lines ~336-420): the dropdown with the 12 items, `useDeveloperModeOn()` gating Terminals. Replace with one `SidebarMenuButton asChild isActive={on /settings}` wrapping `<Link to="/settings">` with GearSix, tooltip "Settings" (it closes the sheet on click already). Drop now-unused icon and DropdownMenu imports.
- `packages/web/src/shell/app-shell.tsx` -- `SidebarInset` (flex-col, overflow-hidden) holds the Outlet; pages return a fragment `<WorkspaceHeader/>` + `<PageBody/>`, so they are direct flex children of whatever wraps the Outlet.
- `packages/web/src/ui/page.tsx` -- `PageHeader` (`data-slot="page-header"`, `--header-height`), `PageBody` (flex-1, scrolls).
- `packages/web/src/ui/sidebar.tsx` -- row styling reference (`SidebarMenuButton`: `--row-height`, `text-label`, selected `bg-card` + `border-border`).
- `packages/shared/src/bmad.ts:208` -- `NEW_PROJECTS_SETTINGS_LABEL` ("New projects") for the Projects page label.
- Tests clicking the old menu (`getByRole('button', { name: 'Settings' })` then `menuitem`): `tests/e2e/layout.spec.ts` (lines ~47, 144, 162, 197), `agents-settings.spec.ts:60`, `tools.spec.ts:66`, `dev-tools.spec.ts:55`, `new-projects.spec.ts:69`, `welcome.spec.ts:120`, `welcome-tour.spec.ts:181`, `upgrade-0.2.0.spec.ts:119`; installed journeys (not run here) `tests/e2e-installed/journey.spec.ts:70,90`, `bmad-journey.spec.ts:155`, `onboarding-journey.spec.ts:196`. Helpers `openConnected`, `sidebarColumn`, `expectNoHorizontalOverflow` in `tests/e2e/layout.spec.ts`'s imports.

## Tasks & Acceptance

**Execution:**
- [x] `packages/web/src/settings/settings-groups.ts` (new) -- the group table: id, label, Phosphor glyph name, pages `{ label, to }` (first page is the group's link), and `settingsGroupFor(pathname)` / `currentSettingsPage(pathname)` (longest prefix match, so `/settings/agents/new` is Agents) -- one source for nav, select and later the palette (entry 3).
- [x] `packages/web/src/ui/settings-nav.tsx` (new) -- presentational pieces: the 220px column (background, header-height top row reading "Settings", border right), group rows as status-row-like links with 16px glyph and selected card fill, indented sub-links, the phone select row, and the layout frame (row at `md+`; below `md` column only content).
- [x] `packages/web/src/settings/settings-layout.tsx` (new) -- `SettingsLayout`: nav (`<nav aria-label="Settings">`, list of links, `aria-current`, `↑`/`↓` focus handling, Terminals gating) plus a right column holding the select and `<Outlet/>`; the right column orders the page header first, then the select (`md:hidden`), then the page body.
- [x] `packages/web/src/router.tsx` -- `settingsRoute.component = SettingsLayout`.
- [x] `packages/web/src/shell/status-sidebar.tsx` -- footer Settings becomes a link (above).
- [x] `packages/web/test/settings-groups.test.ts` (new) -- matrix rows for the mapping: every router settings path maps to exactly one group, sub-page current, `agents/new`, Terminals gating, non-settings path returns none.
- [x] `tests/e2e/settings-nav.spec.ts` (new) -- the verify: Agents to Appearance in one click; each old route opens its page with the nav present and its item current; 390px select navigates with no horizontal overflow (save a screenshot under `test-results/`).
- [x] Old-menu specs listed in the Code Map -- click the Settings link and the nav link instead of the menu items; the rail test asserts the Settings link.

**Acceptance Criteria:**
- Given any settings page at 1440px, when the user clicks another group in the left nav, then that group's page opens and the nav stays with the new group marked current.
- Given the sidebar footer, when the user clicks Settings, then `/settings/appearance` opens with the nav, and the footer Settings row is marked current.
- Given focus on a nav link, when the user presses `↓` then `↑`, then focus moves to the next link and back, without leaving the nav at the ends.

## Implementation Notes

- Width: DESIGN.md `settings-nav.width` (220px) added to `tokens.css` as `--settings-nav-width`, beside the other component sizes; no new token values.
- TanStack `Link` sets `aria-current="page"` itself on any active link, so a current group with sub-pages renders its row as selected text, not a link: only the sub-link is the current page (one item current on `/settings/tools`). The sidebar Settings link gets `aria-current` the same way on every settings page, plus `data-active` for the card fill.
- e2e helpers in `tests/e2e/tab.ts`: `settingsLinkOf`, `settingsNavOf`, `openFromSettings(page, ...navLinks)`, and `expectNoHorizontalOverflow` (moved from layout.spec.ts); pages behind a group (Tools, Developer tools, Welcome, New projects) are reached group first, then sub-link.
- `status-sidebar.dom.test.tsx`'s router mock gained `useRouterState`.
- Deferred-work entry added for Welcome moving to Help (26.5).
- Verification after review patches: `pnpm typecheck` clean; `pnpm test` 5140 passed, 10 skipped (an earlier run had a timing failure in `packages/adapters/test/local-failures.test.ts` and `packages/server/test/cancel.test.ts`, untouched here; both pass alone and the re-run passed in full); the nine Playwright specs in Verification 63 passed; provenance passes; the 390px screenshot shows header, select, then page, nothing clipped.

## Plan Change Log

## Review Triage Log

Pass 1 (quick lens, fresh subagent): 4 findings; medium 1, low 3, false 0, maybe-false 0.

| # | Finding | Verdict | Route |
|---|---------|---------|-------|
| 1 | On `/settings/tools` and `/settings/new-projects` the group row and its first sub-link both carry `aria-current="page"`: TanStack's `applyLinkState` sets it on any active link after passed props, so the row's `current={false}` is ignored | medium | patch: a current group with sub-pages renders its row as plain selected text, not a link; the sub-links are the pages |
| 2 | `expectNoHorizontalOverflow` copied word for word from `layout.spec.ts` into `settings-nav.spec.ts`, against AGENTS.md's no-copy rule | low | patch: move it to `tests/e2e/tab.ts`, import it in both specs |
| 3 | `sidebarOf` imports left unused in `welcome.spec.ts`, `onboarding-journey.spec.ts`, `bmad-journey.spec.ts` | low | patch: delete the imports |
| 4 | "a workspace settings path is not wrapped" opens `/w/x/settings` (no such project) and only checks the nav is absent, so it passes even if nothing renders | low | patch: add a real project and assert its settings page heading shows without the nav |

## Design Notes

Phone width: the ticket says "a drawer"; EXPERIENCE.md Navigation rules and DESIGN.md `settings-nav` both say "below `md` it becomes a select at the top of the page". The UX spine wins; a native `<select>` with an `<optgroup>` per group keeps it one control and the sidebar drawer already exists. Ordering trick: pages are fragments, so the right column is `flex flex-col` with `*:data-[slot=page-header]:order-first`; the select (rendered before the Outlet) then sits between header and body with no page edits.

Groups and pages (existing routes only): Agents (Agents `/settings/agents`); Projects (New projects `/settings/new-projects`, Builds `/settings/builds`); Appearance; Notifications; Terminals (Developer mode); Remote machines; Advanced (Tools, Developer tools, MCP servers, About, Welcome). Builds sits in Projects because it limits builds the projects run. Welcome stays as Advanced's last sub-link until Help exists (entry 5 moves it; a deferred-work entry records this). Group glyphs per DESIGN.md: Robot, Folders, Palette, Bell, TerminalWindow, Desktop tower (`DesktopTower`), Sliders.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors
- `pnpm test` -- expected: full suite passes
- `pnpm exec playwright test tests/e2e/settings-nav.spec.ts tests/e2e/layout.spec.ts tests/e2e/agents-settings.spec.ts tests/e2e/tools.spec.ts tests/e2e/dev-tools.spec.ts tests/e2e/new-projects.spec.ts tests/e2e/welcome.spec.ts tests/e2e/welcome-tour.spec.ts tests/e2e/upgrade-0.2.0.spec.ts` -- expected: pass
- `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs` -- expected: pass

**Manual checks:**
- 390px screenshot of `/settings/agents`: header, then the select, then the page; nothing clipped.
