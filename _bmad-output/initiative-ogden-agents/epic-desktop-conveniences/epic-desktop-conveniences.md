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

What people expect from Claude Desktop or the Codex app, on Ogden's own desktop shell (spec CAP-33): a tray or menu-bar icon with the Needs you count, a global shortcut for quick entry, attachments in messages, and chats that work in their own worktree with a diff and a local commit. The tray and quick entry authenticate as ordinary tabs through the shell's own launch code (AD-15 CAP-33 note); worktree commits are a third commit kind (AD-17 CAP-33 note).

## Outcome

A desktop-app user sees what needs them from the tray, sends a message from anywhere with the shortcut, attaches a screenshot, and reviews and commits a worktree chat's changes; the CAP-33 success line is the signal.

## Requirements

Drafted at inception (2026-10-31, autonomous, awaiting the user's approval). Each line maps to a spec capability in `covers`.

- E25-R1: The shell exchanges its own launch code for a tab token kept only in Rust memory and reads the Needs you model with it; no Tauri IPC is added and the launcher token's reach is unchanged. (CAP-33; AD-15 CAP-33 note)
- E25-R2: The tray or menu-bar icon (Tauri `tray-icon`) with the count and its menu; on Linux it opens from the menu. (CAP-33; AD-3 CAP-33 note)
- E25-R3: One global shortcut (`tauri-plugin-global-shortcut` 2.4.1), changeable, opening Quick entry, a same-origin window on its own launch code; Wayland's limit is stated. (CAP-33; AD-3, AD-15 notes)
- E25-R4: Attachments in chat messages are files under the session in the data directory with a per-file cap; events carry metadata only; deleted with history; sent as ACP image or resource only when advertised, else as a resource link. (CAP-33, CAP-3; AD-8 CAP-33 note)
- E25-R5: A chat may work in its own worktree on `ogden/chat/<ses>` with AD-17's git protections; its diff and a user-clicked local commit, never pushed, serialized with the repo's git work; no merge from Ogden; removed with the chat after confirmation. (CAP-33; AD-17 CAP-33 note)
- E25-R6: The UI: tray menu, Quick entry, attachment chips, Work in a separate copy, branch badge and Changes panel, per EXPERIENCE.md and DESIGN.md. (CAP-33)
- E25-R7: Works in the desktop app on macOS, Windows and Linux (the npm route lacks only the tray and shortcut); installer checks on each OS recorded by the user; ships in the v1.3 release. (CAP-33, CAP-20)

## Done when

1. In the desktop app on each OS, the tray shows the Needs you count from the core model and its menu opens a Needs you row's chat (CAP-33).
2. The global shortcut opens Quick entry, which sends a message to the last chat or a new one and brings the window to it.
3. An image attached to a chat reaches an agent that advertises images, a file link reaches one that does not, and no attachment bytes enter the event log.
4. A worktree chat's diff shows its changes, Commit these changes commits only to its branch with hooks off, nothing is pushed, and the main checkout is untouched.
5. The end-to-end suite passes on all three OSes, the user's installer checks are recorded, and the epic ships in the v1.3 release.

## Boundaries

Desktop conveniences on the existing Tauri shell and chats. Not here: start at login (Deferred), merging a worktree chat from Ogden, an editor-style file browser or VS Code (epic 8), MCP connectors (spec Non-goals).

## References

- spec — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, CAP-33, CAP-20
- architecture — _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md, AD-3, AD-8, AD-15 and AD-17 (CAP-33 notes), Stack
- parent — _bmad-output/initiative-ogden-agents/initiative-ogden-agents.md
- change — _bmad-output/initiative-ogden-agents/change-desktop-agent-harness/change-desktop-agent-harness.md, sections 4.4 and 5
- lessons — _bmad-output/initiative-ogden-agents/change-desktop-agent-harness/the-mob-lessons.md (ideas only; the-mob's code is unlicensed and is never copied)
- agent matrix — _bmad-output/initiative-ogden-agents/spec-ogden-agents/agent-matrix.md
- experience — _bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md
- design — _bmad-output/initiative-ogden-agents/ux-ogden-agents/DESIGN.md, Components
- epic 13 — _bmad-output/initiative-ogden-agents/epic-desktop-app/epic-desktop-app.md and tickets.toml (shell, menu, updater)
- external (Tauri) — https://v2.tauri.app/learn/system-tray/ ; https://v2.tauri.app/release/global-shortcut/

## Notes

- Status: drafted autonomously 2026-10-31; awaiting the user's approval of the inception.
- Assumption: the default shortcut Cmd or Ctrl+Shift+Space and a 10 MB per-file attachment cap, both changeable in their stories.
- Decision (2026-10-31, autonomous): tracer bullet is entry 1 (the tray reads the count through the shell's own tab).
- Waits on epic 13 because: the shell, single instance and menu (13.3, 13.5). Waits on epic 20 because: the core Needs you model (20.9). Waits on epic 5 because: worktrees through VcsPort (5.5).
- Decision (2026-10-31, autonomous after the set check): Quick entry has no attachments and no separate-copy switch in v1.3; the tray's New chat opens Quick entry. The user may overrule.
