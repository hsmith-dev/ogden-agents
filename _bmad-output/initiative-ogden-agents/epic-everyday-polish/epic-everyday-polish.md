---
type: epic
title: "Everyday polish: what the audit found"
parent: initiative-ogden-agents
covers: [CAP-17, CAP-3, CAP-4, CAP-7, CAP-9, CAP-12, CAP-23, CAP-20]
after: []
assignee: ""
risk: medium
---

# Everyday polish: what the audit found

## Description

v1.3, built first of the desktop UX uplift (change-desktop-ux-uplift, approved 2026-10-31). An audit of Ogden's own screens (research-desktop-agent-ux/ogden-current.md, 2026-10-31) ranked the frictions a user hits most: Needs you rows that cut off the request, no fast way to start a chat, a tool row that says Running before approval, two-line sidebar rows, a permanent shortcut banner, no Cmd/Ctrl+K, raw skill commands as titles, dead-end rows and tabs, and Settings as a 12-item menu. This epic fixes them with the existing design tokens, and adds Always allow scoped to a command prefix (AD-40) with a security review. Most of it is web work on screens epics 2, 4, 5, 11 and 16 built.

## Outcome

A user sees what each waiting item needs without opening it, starts a chat or jumps anywhere from the keyboard, and never meets a raw skill command or a dead end on the audited screens; the audit's top ten list, re-run on the same screens, is the signal.

## Requirements

Drafted at inception (2026-10-31, autonomous) from change proposal section 4.4 and the UX items in section 4.3; the user approved the plan and order the same day. Each line maps to a spec capability in `covers` where one exists; a line with no capability cites the UX spine and the audit instead.

- E26-R1: Needs you rows show the request in two lines (what, then where: project and chat), a kind glyph tells permission, question, review and blocked-run rows apart, `g y` opens the next row's target (after the one last opened, wrapping), and `]` and `[` move between rows inside the group. The rows read today's browser-side Needs you list (11.4); their shape is what AD-31's core Needs you model (20.9) must keep. (CAP-17; AD-31 Needs you model; audit Cross-cutting "Needs you across projects", top 10 #1)
- E26-R2: New chat in one step from anywhere in a project: `g n`, Cmd/Ctrl+N and a New chat button in the chat header, each opening the new-chat draft with the composer focused; Cmd/Ctrl+N is the desktop app's (a browser tab keeps it), and outside a project `g n` opens the palette on "New chat in...". (CAP-3; audit Project and chat list, Keyboard, top 10 #2)
- E26-R3: A command palette (Cmd/Ctrl+K) finds projects, chats, tickets (when the Board is on) and actions and runs the chosen one, per EXPERIENCE.md; files and the Workbench actions join it in epic 8 (8.11). (CAP-17; EXPERIENCE.md Interaction Primitives; audit Keyboard, top 10 #8)
- E26-R4: A tool row reads "Waiting for you" while its permission card is open, never "Running"; each chat has a Normal or Verbose detail choice for its tool rows. (CAP-4, CAP-3; audit Chat mid-turn, Finished turn, top 10 #4)
- E26-R5: Sidebar rows are one line (title, status dot, agent icon); the app-shortcut banner shows once and lives in Help after it is dismissed or seen. (CAP-17; audit First run and home, Project and chat list, top 10 #3 and #5)
- E26-R6: Plain titles and no dead ends: build sessions are titled "Build 1.2: <ticket title>", never the skill command; a Runs row opens its run; the Board's epic heading shows the epic's name; Review highlights its own tab; terminal pane header buttons show their icons and accessible names. (CAP-9, CAP-7, CAP-12, CAP-23; EXPERIENCE.md Voice and Tone; audit Board, Runs, Terminals)
- E26-R7: Settings has grouped left navigation (Agents, Projects, Appearance, Notifications, Terminals, Remote machines, Advanced) that stays on every settings page; every existing page keeps its route. (No capability; EXPERIENCE.md Information Architecture; audit Settings, top 10 #10)
- E26-R8: For a command request, Always allow also offers "Always allow commands starting with `<prefix>`", the first one or two words of the parsed command, never free text; such a rule never matches a command with a shell control character or naming a protected path, is saved as a `rule_` rule shown and removable in Settings, and is never offered to custom agents (21.5), attended builds or a device, and Skip all writes no rule. It brings the existing `command_prefix` scope in `packages/core/src/permission-matching.ts` to AD-40, with a security review recorded. (CAP-4; AD-40, AD-9, AD-34; audit Chat mid-turn)
- E26-R9: Works on macOS, Windows and Linux, in the desktop app and the npm route, and at phone width (390px) without new clipping; uses only existing DESIGN.md tokens; ships in the v1.3 release. (CAP-17, CAP-20)

## Done when

1. With two waiting chats in different projects, each Needs you row shows what it needs and where without truncating the request at the sidebar's width, and `g y` opens the next one's card, wrapping (CAP-17).
2. From inside an existing chat, `g n` and the header button (and Cmd/Ctrl+N in the desktop app) each open a new-chat draft with the composer focused; Cmd/Ctrl+K opens the palette and runs a chosen project, chat or action.
3. A pending command's tool row reads "Waiting for you" until the card is answered; build sessions never show a skill command as their title; Runs rows, the Board's epic heading, Review's tab and the terminal header buttons behave as E26-R6 says.
4. A prefix rule for `npm test` allows `npm test -- --watch` and refuses `npm test && rm -rf x`, `npm test > out` and a command naming a protected path, server-side; the security review's findings are fixed or recorded (CAP-4).
5. The end-to-end suite passes on all three OSes with fakes only, the user's check in the desktop app and at phone width is recorded, and the epic ships in the v1.3 release.

## Boundaries

Fixes to screens that exist, with existing tokens, plus AD-40. Not here: the Workbench, file viewing and the diff viewer (epic 8), the composer setup row and worktree chats (epic 27), the core Needs you model (epic 20, 20.9), the tray and quick entry (epic 25), header and Orchestrate copy fixes the audit lists outside the change proposal's items (later polish).

## References

- spec — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, CAP-3, CAP-4 (AD-40 approval), CAP-7, CAP-9, CAP-12, CAP-17, CAP-23
- architecture — _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md, AD-31 (Needs you model), AD-40, AD-9, AD-34
- parent — _bmad-output/initiative-ogden-agents/initiative-ogden-agents.md
- change — _bmad-output/initiative-ogden-agents/change-desktop-ux-uplift/change-desktop-ux-uplift.md, sections 4.3, 4.4 and 6
- audit — _bmad-output/initiative-ogden-agents/research-desktop-agent-ux/ogden-current.md (screen-by-screen frictions, top 10, planned versus built; screenshots in screens/)
- research — _bmad-output/initiative-ogden-agents/research-desktop-agent-ux/research-desktop-agent-ux.md
- experience — _bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md, Information Architecture, Voice and Tone, Component Patterns (Needs you group, Tool-call row, Detail level, New chat, Command palette), Interaction Primitives, Flow 6
- design — _bmad-output/initiative-ogden-agents/ux-ogden-agents/DESIGN.md, Components
- code — packages/core/src/permission-matching.ts (`alwaysAllowScope`, `ruleMatches`), packages/web/src/shell/needs-you-group.tsx, packages/web/src/ui/sidebar.tsx, packages/web/src/chat/tool-call-row.tsx

## Notes

- Status: APPROVED by the user 2026-10-31 (change-desktop-ux-uplift section 6: the plan and order, and AD-40 adopted with this epic); inception drafted autonomously the same day.
- Decision (2026-10-31, user): built first of v1.3's remaining epics, then 8, 27, 20, 24, 22, 25, 23.
- Decision (2026-10-31, user): Always allow scoped to a command prefix is entry 8, under AD-40, with a security review.
- Decision (2026-10-31, autonomous): tracer bullet is entry 1 (two-line Needs you rows and `g y`), the most-hit friction, through the sidebar and the keyboard handler entries 2 and 3 extend.
- Decision (2026-10-31, autonomous): no contracts-and-stubs entry; the epic is web work on existing contracts except entry 8, which owns its own core change. Entries 1, 2 and 3 share the keyboard handler and run in that order; entries 4, 6 and 7 can run beside them.
- Decision (2026-10-31, autonomous after the set check): table order is 1, 7, 8, 2, 4, 3, 5, 6, 9, 10; entry 8 is the least certain slice, so it comes right after the tracer bullet (it waits only on 7). Entry 3 waits on 4 for the Show every step action; its tickets and actions follow EXPERIENCE.md's Command palette row, and the Workbench, Search and Run tests actions are 8.11's. Entries 4 (tool row) and 8 (card scope) touch different components and may run side by side.
- Decision (2026-10-31, autonomous): entry 8's card keeps today's scope first and offers the prefix second, as EXPERIENCE.md Flow 6 shows; what today's scope becomes is the entry's `unknown`.
- Decision (2026-10-31, autonomous): E26-R7 has no spec capability; it cites the UX spine and the audit, as an epic with empty covers would.
- Assumption: entry 8 is hitl so the user reads the security review before it is called done; the user may overrule.
- Assumption: the row shape from entry 1 (what, where, kind) is the one 20.9's core model serves; 20.9 now names 26.1 in its `after`.
- Waits on epic 2 because: the sidebar and Needs you, permission cards and the session view (2.6, 2.10, 2.11). Waits on epic 11 because: the Runs tab and Needs you (11.1, 11.4). Waits on epic 4 because: the Board (4.9). Waits on epic 5 because: build sessions and the review page (5.4, 5.9). Waits on epic 16 because: the pane header (16.4). Waits on epic 21 because: custom-agent chat parity, whose cards offer no Always allow (21.5). All are built.
