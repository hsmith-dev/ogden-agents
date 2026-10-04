---
title: 'The sidebar is the one place to see, switch, add and manage projects'
type: 'feature'
ticket: '2'
created: '2026-10-04'
status: 'ready-for-dev'
baseline_revision: '485ac934afda671f1561fdaaf947ef1ae102b694'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/backlog/story-the-sidebar-is-the-one-place-to-see-switch-add-and-manage-projects.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The sidebar header carries a project drop-down (the workspace switcher) beside a sidebar that already lists every project; the user wants one (user, 2026-10-04: "I prefer the side bar"). The drop-down is also the only way to open a project with no chats, the only "current project" marker, and the sidebar has no per-project settings entry.

**Approach:** Delete the drop-down. Make each project group's heading do what it did: the name is a link to the project's Chats list (marked current), a separate chevron collapses, a gear opens the project's settings; the rail gets a per-project icon link; a filter field appears from eight projects. Below `md` the existing drawer stays the way in, with a clearer menu button.

## Boundaries & Constraints

**Always:**
- Ticket criteria 1–10 are the bar.
- Edits stay in the group heading line, the sidebar header and the trigger, so sibling stories on the same base (empty-project "Start a chat" row, chat rename on a row, 6.10, chat Markdown) merge beside them.
- Every control: visible (no hover-only), 24/32 px targets, focus ring, accessible name naming the project.
- No id repeats while the column and drawer are both mounted (`useId`).
- Tests never run real agents, keychain, network, or read the real `~/.claude`; any test hook only via `testHooksAllowed`.

**Never:** a new keyboard shortcut; a change to session rows, Needs you, the footer, the Add project dialog, workspace tabs, or the collapsed-groups storage key; turning the column `aside` into `nav`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open empty project | project with 0 chats | name link opens `/w/:wsId` | — |
| Current marker | on `/w/:wsId/s/:sesId` or `/settings` | that heading `aria-current="true"` + active fill; on `/w/:wsId` exactly `page` | — |
| Collapse | chevron click | toggles group, no navigation | storage failure keeps tab-local state (as today) |
| Filter shown | ≥ 8 projects | labelled field; case-insensitive substring | — |
| Filter none | text matches nothing | "No projects match" line | Escape clears |
| Filter hidden | < 8 projects, or rail | no field, all groups | — |
| Drawer | < md, menu button | opens drawer, focus inside; Esc closes, focus back to button; link closes | — |

</frozen-after-approval>

## Code Map

- `packages/web/src/shell/workspace-switcher.tsx` -- the drop-down; delete. Only user: `status-sidebar.tsx:155`.
- `packages/web/test/workspace-switcher.test.tsx` -- delete; move its `workspaceName` case into the new sidebar DOM test.
- `packages/web/src/shell/status-sidebar.tsx` -- `StatusSidebarBody`: header (remove switcher), group map (pass link, settings link, current), filter field. Reads `wsId` via `useParams({ strict: false })` like `SessionRows`.
- `packages/web/src/ui/sidebar.tsx` -- `SidebarWorkspaceGroup` (heading row), `DisclosureButton`, `SidebarMenuButton` (rail tooltip + sheet close), `SidebarTrigger` (label). Router-free: links come in as children elements, like `SidebarStatusRow`.
- `packages/web/src/shell/sidebar-model.ts` -- `SidebarWorkspace` shape (wsId, name); no change.
- `tests/e2e/workspaces.spec.ts:120-160` -- switcher e2e; rewrite to the sidebar.
- `tests/e2e/layout.spec.ts` (rail and 390 px cases), `tests/e2e/sidebar.spec.ts` -- extend.
- TanStack `Link` sets `aria-current="page"` only when active; our explicit `aria-current` survives otherwise.
- `_bmad-output/.../ux-ogden-agents/EXPERIENCE.md` -- IA table (Status sidebar, Workspace settings), Component Patterns (Workspace switcher row), Interaction Primitives, Responsive `< md`.
- `architecture-ogden-agents.md:241` mentions the switcher as shared UI; amend in place and log in `.memlog.md`.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/web/src/ui/sidebar.tsx` -- `SidebarWorkspaceGroup` takes `link` (router Link, no children), optional `settingsLink`, `current`; renders chevron-only disclosure (`aria-label` "Show chats in X"/"Hide…" via `aria-expanded`), name link (SidebarMenuButton asChild, tooltip = name for rail, folder icon in rail only), gear link; `SidebarTrigger` label "Open projects and sessions", `aria-haspopup="dialog"`.
- [ ] `packages/web/src/shell/project-filter.ts` -- `PROJECT_FILTER_MIN = 8`, `filterProjects(groups, text)`.
- [ ] `packages/web/src/shell/status-sidebar.tsx` -- remove switcher; wire link/settings/current; filter field (visible label, Escape clears, sr status of count) above groups when ≥ 8.
- [ ] delete `workspace-switcher.tsx` and its test.
- [ ] `packages/web/test/status-sidebar.dom.test.tsx` -- heading link/current/settings/chevron, filter threshold & matching & Escape, no switcher.
- [ ] `packages/web/test/project-filter.test.ts` -- unit cases.
- [ ] e2e: workspaces switcher test → sidebar names; layout rail project link; 390 px drawer focus/Escape returns focus.
- [ ] Docs: EXPERIENCE.md dated note (2026-10-04) + rows; architecture line + memlog.

**Acceptance Criteria:**
- Given the ticket's ten criteria, when `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm run pack && pnpm smoke` run, then all pass.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Design Notes

Heading row (full and drawer): `[›] name ……… [summary when collapsed] [⚙]`. The chevron is its own 24/32 px button so opening and collapsing never collide. Rail: the chevron and gear hide; the name link shows a folder icon with the name as tooltip, so every project is reachable in the rail (the drop-down was hidden there).

## Verification

**Commands:**
- `pnpm typecheck` -- clean
- `pnpm test` -- all pass
- `pnpm e2e` -- all pass
- `pnpm run pack && pnpm smoke` -- passes
