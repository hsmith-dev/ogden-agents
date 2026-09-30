---
title: 'Design system and app shell'
type: 'feature'
ticket: '6'
created: '2026-09-29'
status: 'built'
baseline_revision: '41ba57d5dc819c9d3d066c80a1d48ce131ad8f23'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/ux-ogden-agents/DESIGN.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The UI is still the unstyled tracer page. The approved design (story 1.5) exists only as documents, so each later epic would invent its own styling and layout, which AD-18 forbids.

**Approach:** Build the one design system in `packages/web/ui`: shadcn/ui components owned and restyled with DESIGN.md's tokens as CSS variables (light, dark, and compact density), Geist and Geist Mono self-hosted, and Phosphor icons. On top of it, build the always-present app shell from EXPERIENCE.md's Information Architecture: the status sidebar (with its "Needs you" group, workspace switcher, and footer server status), the workspace area in its empty states, and Settings > Appearance for theme, density and Developer mode. Layout is checked in a real browser, which signs in through the launch link.

## Boundaries & Constraints

**Always:**
- Components live only in `packages/web/ui` (shadcn/ui, owned and restyled; never left in shadcn's default look). Feature code composes them and does no ad hoc styling, and no second component library is used (AD-18).
- Every color, font, size, spacing, radius, shadow and motion value comes from a DESIGN.md token, exposed as a CSS variable. Light, dark (`prefers-color-scheme` with a Light / Dark / System override) and compact density (`data-density="compact"`) are token swaps only. Components never hard-code raw values.
- Fonts are self-hosted (no Google Fonts `<link>`), and icons are Phosphor.
- The shell follows EXPERIENCE.md: a status sidebar on the left (the "Needs you" group on top, workspaces with their session rows, Add project, and a footer with Settings and the server status), the workspace area on the right, and the Responsive & Platform breakpoints (full sidebar at ≥ lg, a 56px rail at md, a sheet at < md).
- Empty states use EXPERIENCE.md's Voice and Tone: plain language, and no skill names unless Developer mode is on.
- The existing event-log connection stays. The footer's server status reflects the live WebSocket (connected, reconnecting), and the web page keeps resubscribing after its last seq.
- The app's `/` route is served only behind the gate (story 1.4). The signed-out launch page is the gate's server-rendered page, restyled with the same tokens inline, because React can't load without a session.

**Never:**
- No real workspaces, sessions, chat, board, runs or review data (epics 2–5). The sidebar and workspace area show only their empty states.
- No Quit action (story 1.7), and no onboarding flow (epic 2).
- No drag-and-drop, and no new server routes beyond what the shell needs to render.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First load | Signed-in browser, no workspaces | Shell with the empty sidebar ("No projects yet", Add project) and the workspace area's empty state | — |
| Theme | System dark; override set to Light in Appearance | The dark token set follows the system; the override applies at once and persists across reloads | — |
| Density | Developer mode on | `data-density="compact"`; rows and body type shrink per the tokens; the layout is unchanged | — |
| Widths | 1440, 900 and 390 px | Full sidebar, rail, and header-opened sheet respectively; no horizontal overflow at any width | — |
| Server status | WebSocket drops, then returns | Footer shows reconnecting, then connected; no event repeats | — |
| Signed out | Plain URL in a fresh browser | The gate's launch page, styled with the tokens and legible in light and dark | — |
| No raw values | The built CSS and components | A lint or test fails on hex colors or px sizes in feature code outside `ui/` tokens | — |

</frozen-after-approval>

## Code Map

Baseline `41ba57d` (1.1–1.5; branch `story/1.6-design-system-and-app-shell`).

- `packages/web/` -- Vite + React 19, `src/App.tsx` (tracer event list and seq resubscribe) and `src/main.tsx`. No router, CSS or components yet.
- `_bmad-output/initiative-ogden-agents/ux-ogden-agents/DESIGN.md` -- YAML token frontmatter using shadcn variable names (`background`, `foreground`, `card`, `sidebar`, `muted`, `accent`, `primary`, `ring`, …) plus `signal`, `signal-subtle`, `state-*` and their `-subtle` variants; typography, rounded and spacing tokens, including compact values; components and Do's and Don'ts. Every CSS variable comes from here.
- `_bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md` -- Information Architecture (shell, routes, sidebar footer), Voice and Tone, State Patterns (session state glyphs: shape plus word plus color), Accessibility Floor, and Responsive & Platform.
- `_bmad-output/initiative-ogden-agents/ux-ogden-agents/mockups/key-workspace.html` -- the composition reference for sidebar and workspace (the spines win on conflict).
- `packages/server/src/gate.ts` -- `OPEN_FROM_TERMINAL_PAGE` (inline HTML) to restyle with the tokens.
- `tests/architecture.test.ts` -- web may depend only on `@ogden-agents/shared` internally; third-party UI deps are fine. `tests/packaging.test.ts` checks only bundled server-side packages; web deps are bundled by Vite into `dist/web`.
- `.github/workflows/ci.yml` -- add the Playwright layout job (Linux, Chromium).
- Verified versions: shadcn 4.21.0, tailwindcss and @tailwindcss/vite 4.3.3, @fontsource-variable/geist and geist-mono 5.3.0, @phosphor-icons/react 2.1.10, @tanstack/react-router 1.170.40 with @tanstack/router-plugin 1.168.41, @tanstack/react-query 5.104.0, radix-ui 1.6.7, class-variance-authority 0.7.1, clsx 2.1.1, tailwind-merge 3.7.0, tw-animate-css 1.4.0, @playwright/test 1.63.0.

## Tasks & Acceptance

**Execution:**
- [x] `packages/web` setup -- Tailwind 4 via `@tailwindcss/vite`, the `@/` path alias, shadcn `components.json` pointing at `src/ui`, Geist fonts, Phosphor, and TanStack Router (file or code routes) with Query. This is the foundation.
- [x] `packages/web/src/ui/tokens.css` -- every DESIGN.md token as CSS variables for light, dark (media query plus `data-theme` override) and `[data-density="compact"]`. A script or test checks the CSS against DESIGN.md's YAML, so they can't drift.
- [x] `packages/web/src/ui/` -- the shadcn components the shell needs (button, sidebar, sheet, tooltip, dropdown-menu, separator, scroll-area, switch, radio-group or toggle-group, badge), restyled to DESIGN.md Components, plus `state-glyph.tsx` (shape plus word plus color per AD-4 state).
- [x] `packages/web/src/shell/` -- `AppShell`, `StatusSidebar` (Needs you, workspaces, Add project disabled with a tooltip until epic 2, footer with Settings and live server status), and the empty workspace area, following the Responsive breakpoints.
- [x] `packages/web/src/routes/` -- `/` (empty state) and `/settings/appearance` (theme Light, Dark or System; density; Developer mode; persisted in `localStorage`, applied before first paint to avoid a flash).
- [x] `packages/web/src/events/` -- move the WebSocket and seq-resubscribe logic out of `App.tsx` into a hook the footer status uses.
- [x] `packages/server/src/gate.ts` -- restyle the launch page with DESIGN.md tokens inline (light and dark), keeping its text and 401.
- [x] A lint test (Vitest) failing on raw hex, `rgb(` or pixel literals in `packages/web/src` outside `ui/tokens.css`.
- [x] `tests/e2e/layout.spec.ts` (Playwright) plus config -- start the server on a temp data folder, sign in via `launchUrl`, check no horizontal overflow and the sidebar form at 1440, 900 and 390 px, then theme and density switching, and the signed-out launch page. Add a `pnpm e2e` script and a Linux Chromium CI job.

**Acceptance Criteria:**
- Given the app in a real browser at phone, tablet and desktop widths, when Playwright checks layout, then there's no horizontal overflow and the sidebar takes the rail or sheet form at the specified widths.
- Given the source, when tests run, then feature code uses only `packages/web/ui` components and tokens (a raw value fails the lint test).
- Given `pnpm test`, `pnpm e2e` and the clean-install smoke test, when they run, then all pass.

## Implementation Notes

- Routes are code-based (`src/router.tsx`), so `@tanstack/router-plugin` and the shadcn CLI are not dependencies; the components were written to shadcn's API and restyled by hand, with `components.json` pointing at `src/ui`.
- Token names: raw DESIGN.md values are `--<color>`, `--type-<role>-*`, `--rounded-*`, `--space-*`; components read "live" variables (`--row-height`, `--body-size`, `--control-height`, ...) that `[data-density='compact']` repoints. `src/ui/theme.css` maps them into Tailwind and removes Tailwind's default palette, fonts, type scale, radii and shadows.
- `tests/design-tokens.test.ts` holds both the token-drift check (against DESIGN.md's YAML) and the raw-value lint (hex, color functions, `px`, including in comments) over `packages/web/src`.
- Developer mode on sets Compact and off sets Comfortable; density stays independently settable.
- Server: the gate now answers any unauthenticated HTML navigation (not just `/`) with the launch page (still 401), and signed-in extensionless GETs outside `/ws` and `/api/` fall back to `index.html` so `/settings/appearance` survives a reload. No new routes.
- `mockups/key-workspace.html` does not exist in the repo; the shell follows DESIGN.md and EXPERIENCE.md only.
- Orchestrator: the reference mock was committed at `.working/key-workspace.html` in story 1.5, while the spines link to `mockups/key-workspace.html`. The promotion step's `git mv -k` skipped the then-untracked file. Moved it to `mockups/`. The CI job's `actions/upload-artifact@v5` was unverified; changed to the verified latest, `@v7` (v7.0.1).
- Matrix test audit (orchestrator, macOS): all 7 rows are covered and ran: `tests/design-tokens.test.ts` (no raw values, token drift) and `tests/e2e/layout.spec.ts` (first load, theme, density, widths 1440/900/390, reconnect with no repeats, signed-out page). 99 unit tests plus 13 Playwright tests pass; smoke OK.

## Plan Change Log

## Review Triage Log

### Pass 1 (quick lens) — 2026-09-29

Counts: high 0, medium 2, low 11, rejected 1, architecture convention 1.

| # | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|
| 1 | `shell/` feature code applies visual styling (colors, radius) itself | low | patch | Moved into `ui/` (`brand-mark`, `SidebarAttentionGroup`); `findFeatureStyling` lints visual classes in `src/shell` and `src/routes`. |
| 2 | The raw-value lint misses `*-px`, `vw`/`rem`/`em` and numeric props | low | patch | Widened; offenders read DESIGN.md tokens via `ui/tokens.ts`; hairlines use `border-*` utilities (DESIGN.md prose: borders are 1px). |
| 3 | Tailwind's default transition duration and easing aren't reset | low | patch | Mapped to `--motion-fast` and `--motion-ease`, so reduced motion applies. |
| 4 | Developer mode switch is 32×18, below the target-size floor, with invented tokens and `rounded-full` | medium | patch | Hit area of at least `--control-height`; spacing-key sizes; md/sm radius. |
| 5 | Waiting ring is 1.5px, not 2px | low | patch | Uses `--glyph-ring`. |
| 6 | Sidebar children mount twice below md, duplicating ids | medium | patch | Per-instance `useId`; an e2e test asserts no duplicate ids. |
| 7 | Wordmark tap leaves the sheet open | low | patch | The sheet closes on any route change or link click. |
| 8 | Rail server status is hover-only | low | patch | Focusable glyph with the tooltip on focus; `role=status` text; e2e test. |
| 9 | The rail's counted Needs you button isn't built | low | patch | `SidebarAttentionButton` (md–lg, hidden at 0), with a test. |
| 10 | `PageTitle` uses the heading role | low | patch | Uses the title role. |
| 11 | Theme and Density labels aren't wired to their controls | low | patch | `aria-labelledby` and `aria-describedby`; e2e test. |
| 12 | Unknown URLs show an unstyled Not Found | low | patch | `not-found-page.tsx` inside the shell. |
| 13 | "One component per file" is broken by shadcn compound files | — | architecture | Convention amended to exempt `ui/` compound components (architecture memlog). |
| 14 | The launch page's copied tokens can drift; duplicated storage key; unhandled clipboard rejection | low | patch | Drift check `findLaunchPageDrift`; `APPEARANCE_STORAGE_KEY` in shared; failure message plus select. |
| 15 | A stale Implementation Notes line about the mockup | — | reject | The fix is a plan edit (superseded by the orchestrator note). |

## Design Notes

- Source conflict, settled here: EXPERIENCE.md's IA lists the launch page as a React route `/launch`, but since story 1.4 the app's assets are gated, so React can't load for a signed-out browser. The launch page is the gate's server-rendered page, restyled with the tokens. To be reported back to the UX spine on its next update.
- EXPERIENCE.md's open question about cookie lifetime was settled by story 1.4: 30 days, surviving server restarts on the same port.
- The UI's browser persistence is appearance preferences only (`localStorage`); all product state comes from the server.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test` -- expected: all pass, including the token-drift and raw-value tests.
- `pnpm e2e` -- expected: Playwright layout, theme, density and signed-out checks pass in Chromium.
- `pnpm pack && node scripts/smoke-installed.mjs` -- expected: exit 0.

**Manual checks (if no CLI):**
- `pnpm start`: the browser lands on the styled shell; toggling Developer mode and the theme in Settings > Appearance changes density and colors instantly, and it matches `mockups/key-workspace.html` in spirit.
