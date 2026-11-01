---
type: research
title: "Desktop agent UX: what Claude Desktop, the Codex app and other harnesses do, and what Ogden adopts"
created: '2026-10-31'
status: final
sources:
  - claude-desktop.md
  - codex-desktop.md
  - other-harnesses.md
  - ogden-current.md
---

# Desktop agent UX research

Public sources only (docs, changelogs, reviews, screenshots described by others). No app was downloaded, decompiled or copied. Detail and links are in the four companion files; this file holds the conclusions.

## What the field has converged on

Five patterns appear in Claude Desktop, the Codex app (now a mode of the ChatGPT desktop app, since 2026-07-09) and most of Conductor, Cursor's Agents Window, Zed, Antigravity and GitHub Agent HQ:

1. **A setup row on the composer.** Agent or model, permission mode and *where it runs* (this folder, a worktree, a remote machine or cloud) sit under the prompt box and can change mid-session.
2. **One inbox of status.** Every session shows working, needs you, ready or blocked in the sidebar; one list collects what needs you across projects; a key jumps to the next one.
3. **One task, one worktree, one review.** Parallel work runs on its own branch and folder; the user reviews a diff, then merges or opens a pull request, then the worktree is archived (with restore).
4. **Review that talks back.** A changes count (`+N -M`) opens a per-file diff with fixed views (unstaged, staged, branch, *last turn*); per-hunk stage or revert; line comments go back to the agent as one revision request.
5. **Steer without stopping.** A message sent while the agent works is folded into the turn; Esc stops.

## Ogden today (from the audit)

Strong: the permission card (plain sentence, scoped Always allow, keys 1 2 3), Review's checks above the diff, the Build dialog's explained choices, steering (send now) already built.

The ten most frequent frictions, ranked: Needs you rows truncate the request; no fast new chat; a permanent shortcut banner; tools read "Running" before approval; two-line sidebar rows; in-chat diffs take two clicks and show only per-edit hunks; header overload at 1440px; no Cmd+K or `g n`; Review's diff is a raw text dump; Settings is a 12-item menu. Smaller: build sessions titled with the raw skill command, Runs rows not clickable, the Board's epic heading reads "1", terminal header buttons render empty, Review highlights the Board tab.

## Adopt (ranked)

| # | Adopt | Seen in | Ogden home |
|---|---|---|---|
| 1 | Needs you rows that show the request, and a key to jump to the next one | Codex Activity, Conductor, Claude sidebar | epic 26 |
| 2 | New chat in one step (`g n`, Cmd/Ctrl+N, header button) and a command palette (Cmd/Ctrl+K) | all | epic 26 |
| 3 | Composer setup row: agent, model, mode and Location (This folder, Worktree, Remote machine) | Claude, Codex | epic 27 |
| 4 | A real diff viewer (per file, syntax colour, inline or side by side) shared by chat, Changes and Review | all | epic 8 |
| 5 | Changes panel with views This turn, Unstaged, Staged, Branch; per-hunk stage and revert | Codex, Claude | epic 8 (moves 25.7 here) |
| 6 | Line comments on a diff sent back to the agent as one message | Claude, Codex, Conductor | epic 8 |
| 7 | Files panel and read-only viewer, markdown rendered; every path and `file:line` in chat is a link | VS Code, Claude previews | epic 8 |
| 8 | Project search (text and file name), read-only | VS Code | epic 8 |
| 9 | Problems: run the project's test or lint command, failures as clickable `file:line` with "Ask the agent to fix this" | VS Code, Codex actions | epic 8 |
| 10 | Open in your editor at the file and line (VS Code, Cursor, JetBrains, Zed) | Conductor, Cursor, Codex | epic 8 |
| 11 | Worktree hand-off (move a chat between this folder and its worktree), retention of the last N and restore | Codex | epic 27 (with 25.6 worktree chats) |
| 12 | Tool-call detail level (Normal, Verbose) and "Waiting for you" before approval | Claude | epic 26 |
| 13 | Try one task with several agents side by side, each in its own worktree, and keep one | Cursor, Conductor | epic 27 |
| 14 | A port per worktree (`PORT` offset) so parallel dev servers don't clash | Conductor | epic 27 |
| 15 | Settings with grouped navigation | Claude, Codex | epic 26 |

## Considered, not adopted now

- **Always allow scoped to a command pattern** (Zed). A security change to the permission model; listed as an open question for the user, not built.
- **Child sessions report back to a parent** (Claude). Belongs to Orchestrate's next epic; noted there.
- **Cloud execution.** Ogden has no cloud and keeps its local-only promise; Remote machine is its equivalent.
- **A full editor, debugger or extensions.** Ogden is where you look, understand and point; editing and debugging hand off to the user's editor (item 10).

## Avoid

Always allow as the default choice; approvals that silently stall unattended work; needs you signals visible on one screen only; confusing nouns (the Codex merge's main complaint); usage limits hidden in Settings; heavy memory use.
