---
type: epic
title: "v1.3: The desktop app feels like a desktop app"
parent: initiative-ogden-agents
covers: [CAP-33, CAP-20, CAP-3]
after: []
assignee: ""
risk: medium
---

# v1.3: The desktop app feels like a desktop app

## Description

What people expect from Claude Desktop or the Codex app, on Ogden's own desktop shell (spec CAP-33): a tray or menu-bar icon with the Needs you count, a global shortcut for quick entry, and attachments in messages. The tray and quick entry authenticate as ordinary tabs through the shell's own launch code (AD-15 CAP-33 note). CAP-33's chats in their own worktree, with their diff and local commit, moved on 2026-10-31 to epic 27 (27.3) and epic 8 (8.4), so there is one diff surface.

## Outcome

A desktop-app user sees what needs them from the tray, sends a message from anywhere with the shortcut, and attaches a screenshot; the CAP-33 success line, less its worktree part (epics 27 and 8), is the signal.

## Requirements

Drafted at inception (2026-10-31, autonomous) and approved by the user the same day. Each line maps to a spec capability in `covers`.

- E25-R1: The shell exchanges its own launch code for a tab token kept only in Rust memory and reads the Needs you model with it; no Tauri IPC is added and the launcher token's reach is unchanged. (CAP-33; AD-15 CAP-33 note)
- E25-R2: The tray or menu-bar icon (Tauri `tray-icon`) with the count and its menu; on Linux it opens from the menu. (CAP-33; AD-3 CAP-33 note)
- E25-R3: One global shortcut (`tauri-plugin-global-shortcut` 2.4.1), changeable, opening Quick entry, a same-origin window on its own launch code; Wayland's limit is stated. (CAP-33; AD-3, AD-15 notes)
- E25-R4: Attachments in chat messages are files under the session in the data directory with a per-file cap; events carry metadata only; deleted with history; sent as ACP image or resource only when advertised, else as a resource link. (CAP-33, CAP-3; AD-8 CAP-33 note)
- E25-R5 (moved 2026-10-31: worktree chats to epic 27 as E27-R2 and 27.3; the diff and Commit these changes to epic 8 as E8-R4 and 8.4; kept here for the record, no entry covers it): A chat may work in its own worktree on `ogden/chat/<ses>` with AD-17's git protections; its diff and a user-clicked local commit, never pushed, serialized with the repo's git work; no merge from Ogden; removed with the chat after confirmation. (CAP-33; AD-17 CAP-33 note)
- E25-R6: The UI: tray menu, Quick entry and attachment chips, per EXPERIENCE.md and DESIGN.md. Work in a separate copy and the branch badge moved to epic 27 (E27-R1, E27-R2), the Changes panel to epic 8 (E8-R4), 2026-10-31. (CAP-33)
- E25-R7: Works in the desktop app on macOS, Windows and Linux (the npm route lacks only the tray and shortcut); installer checks on each OS recorded by the user; ships in the v1.3 release. (CAP-33, CAP-20)

## Done when

1. In the desktop app on each OS, the tray shows the Needs you count from the core model and its menu opens a Needs you row's chat (CAP-33).
2. The global shortcut opens Quick entry, which sends a message to the last chat or a new one and brings the window to it.
3. An image attached to a chat reaches an agent that advertises images, a file link reaches one that does not, and no attachment bytes enter the event log.
4. The end-to-end suite passes on all three OSes, the user's installer checks are recorded, and the epic ships in the v1.3 release.

## Boundaries

Desktop conveniences on the existing Tauri shell and chats. Not here: start at login (Deferred), worktree chats (epic 27), the Changes panel and Commit these changes (epic 8), merging a worktree chat from Ogden, a file browser (epic 8) or VS Code (epic 28), MCP connectors (spec Non-goals).

## References

- spec — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, CAP-33, CAP-20
- architecture — _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md, AD-3, AD-8 and AD-15 (CAP-33 notes), Stack
- parent — _bmad-output/initiative-ogden-agents/initiative-ogden-agents.md
- change — _bmad-output/initiative-ogden-agents/change-desktop-agent-harness/change-desktop-agent-harness.md, sections 4.4 and 5
- change — _bmad-output/initiative-ogden-agents/change-desktop-ux-uplift/change-desktop-ux-uplift.md, sections 2, 4.4 and 6 (25.6 and 25.7 moved)
- lessons — _bmad-output/initiative-ogden-agents/change-desktop-agent-harness/the-mob-lessons.md (ideas only; the-mob's code is unlicensed and is never copied)
- agent matrix — _bmad-output/initiative-ogden-agents/spec-ogden-agents/agent-matrix.md
- experience — _bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md
- design — _bmad-output/initiative-ogden-agents/ux-ogden-agents/DESIGN.md, Components
- epic 13 — _bmad-output/initiative-ogden-agents/epic-desktop-app/epic-desktop-app.md and tickets.toml (shell, menu, updater)
- external (Tauri) — https://v2.tauri.app/learn/system-tray/ ; https://v2.tauri.app/release/global-shortcut/

## Notes

- Status: APPROVED by the user 2026-10-31 (inception, with the autonomous decisions below kept).
- Assumption: the default shortcut Cmd or Ctrl+Shift+Space and a 10 MB per-file attachment cap, both changeable in their stories.
- Decision (2026-10-31, autonomous): tracer bullet is entry 1 (the tray reads the count through the shell's own tab).
- Waits on epic 13 because: the shell, single instance and menu (13.3, 13.5). Waits on epic 20 because: the core Needs you model (20.9). Waits on epic 27 because: the composer setup row the attachment chips sit beside (27.1). (Until 2026-10-31 it also waited on epic 5 for worktrees (5.5); that moved with 25.6.)
- Decision (2026-10-31, autonomous after the set check): Quick entry has no attachments and no separate-copy switch in v1.3; the tray's New chat opens Quick entry. The user may overrule.
- Dropped: entry 6 (worktree chats: a separate copy on its own branch) and entry 7 (the Changes panel and Commit these changes), 2026-10-31, moved by the user's approved change (change-desktop-ux-uplift sections 2 and 4.4) to 27.3 and 8.4 so there is one diff surface. Neither had a file or a plan, so both entries were deleted from `tickets.toml`; ids 6 and 7 are retired and never reused. The Done when check for a worktree chat's diff and commit moved with them (epic 8's Done when 4, epic 27's Done when 1).
- Decision (2026-10-31, user): build order moves this epic after 26, 8, 27, 20, 24 and 22. Follow-on changes (autonomous): entry 2 no longer adds the chat `worktreePath` and branch fields (now 8.2); entries 8 and 9 no longer include worktree chats; entry 5 waits on 27.1's composer setup row.
