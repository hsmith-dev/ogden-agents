---
id: 13
type: story
title: "The sidebar is the one place to see, switch, add and manage projects"
parent: none
covers: [CAP-17]
after: []
assignee: ""
refined: true
hitl: false
risk: medium
estimate: ""
---

# The sidebar is the one place to see, switch, add and manage projects

## Description

The sidebar header today has a project drop-down (the workspace switcher) that repeats what the sidebar's project list already shows. The drop-down goes away and the sidebar's project list does everything it did: each project opens from its name, the current project is marked, each project reaches its settings, and Add project stays at the end of the list. Below `md` the same sidebar opens as a drawer from a menu button in every page header, so a narrow window keeps project switching.

## Acceptance Criteria

1. **No drop-down**
   **Given** any page at any width
   **When** the sidebar shows (column, rail or drawer)
   **Then** there is no project drop-down in its header; the header shows the wordmark only

2. **A project opens from its name**
   **Given** a sidebar with several projects, some with no chats
   **When** the user clicks a project's name, or tabs to it and presses Enter
   **Then** that project's Chats list opens, and a project with no chats can be opened the same way

3. **The current project is marked**
   **Given** the user is on any page inside a project (Chats, a chat, Plan, Board, settings)
   **When** they look at the sidebar
   **Then** that project's name is marked as current, visually and for screen readers, and no other project is

4. **Collapsing stays separate from opening**
   **Given** a project group in the full sidebar or the drawer
   **When** the user uses its chevron button
   **Then** the group collapses or expands (remembered per browser, as today) without opening the project; the chevron button's accessible name says which project's chats it shows or hides and its state is announced as expanded or collapsed

5. **Each project reaches its settings**
   **Given** a project in the full sidebar or the drawer
   **When** the user uses the settings button beside its name (always visible, not on hover only)
   **Then** that project's settings open; its accessible name names the project

6. **Add project stays in the sidebar**
   **Given** the full sidebar, the rail or the drawer
   **When** the user uses Add project
   **Then** the Add project dialog opens, and the new project opens when it is added (as today)

7. **The rail switches projects too**
   **Given** the rail (`md` to `lg`)
   **When** the user moves through the rail
   **Then** each project has an icon button with its name as accessible name and tooltip, which opens it, marked when current

8. **Many projects can be filtered**
   **Given** eight or more projects, in the full sidebar or the drawer
   **When** the user types in the labelled filter field above the project list
   **Then** only projects whose name contains the text (ignoring case) show, a line says when none match, Escape clears the field, and Needs you is never filtered; with fewer than eight projects there is no filter field

9. **Narrow windows: a drawer with a clear menu button**
   **Given** a window narrower than `md`
   **When** the user presses the menu button in the page header
   **Then** the sidebar opens as a drawer with its own accessible name; focus moves into it and stays there; Escape or choosing a project, chat or settings closes it; closing with Escape returns focus to the menu button

10. **Landmarks and keyboard**
    **Given** the sidebar at any width
    **When** a keyboard or screen reader user moves through it
    **Then** it is one landmark named "Projects and sessions" (the column beside the page, or the drawer's navigation), the project list sits under a "Projects" heading, every control is reachable with Tab in visual order, and no id repeats when the drawer and the column are both mounted

## Boundaries

- Must not change: session rows, their order and the hold-while-hovered rule; Needs you; the footer (Settings menu, New tab, Quit, server status); the Add project dialog itself; workspace tabs and their `g` shortcuts; collapsed groups' saved state.
- No new keyboard shortcut. `[` / `]` (previous / next project) stays a documented future shortcut; the drop-down never had one.

## References

- parent — none (standalone story in `backlog/`)
- source — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, CAP-17
- design — _bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md, Information Architecture, Component Patterns (Status sidebar, Workspace switcher), Accessibility Floor, Responsive & Platform
- design — _bmad-output/initiative-ogden-agents/ux-ogden-agents/DESIGN.md, Workspace group, Status row

## Notes

- Decision (user, 2026-10-04): "We don't need two things for projects a drop down and a side bar, I prefer the side bar."
- Inventory of the drop-down before removal (2026-10-04): it lists every project by name (sorted A to Z, current one checked), opens a project's Chats list, and offers Add project. It has no search, no status, no settings link and no keyboard shortcut, and is hidden in the rail. The sidebar already has the project list with status, Add project, and a drawer below `md`; it lacks a way to open a project (the name only collapses the group, so a project with no chats can't be reached from the sidebar), a current marker, a settings entry and a rail entry. This story adds those, plus the filter the user asked about for many projects.
- Assumption: the filter shows from eight projects up (about one screen of collapsed groups at 900 px height); the number is a constant the builder names.
- Assumption: the sidebar keeps its creation-order project list (the drop-down sorted A to Z); creation order is what the sidebar has always shown.
- Overlap: sibling stories built in parallel on the same base also touch the sidebar's project group (an empty project's "Start a chat" entry, renaming a chat from its row). This story changes only the group's heading line and the sidebar header, so those merge beside it.
- Assumption: the column keeps its complementary landmark (`aside`) rather than becoming `nav`: the drawer already is a `nav`, and many existing tests and the parallel sibling stories select the column by it.
- Assumption: backlog id 2 is the next unused id on this base; a sibling backlog story made in parallel may need renumbering at merge. Renumbered to 13 when merged with its siblings (preview/feedback).
