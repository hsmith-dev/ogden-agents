---
type: change
title: "Desktop UX uplift: what Ogden adopts from Claude Desktop, the Codex app, other harnesses and VS Code"
created: '2026-10-31'
status: proposed
trigger: user, 2026-10-31
mode: batch
sources:
  - ../research-desktop-agent-ux/research-desktop-agent-ux.md
---

# Change proposal: desktop UX uplift

## 1. Issue summary

The user asked to study Claude Desktop and the ChatGPT Codex desktop app (and, by follow-up, VS Code) and adopt what makes Ogden better, then said: "proceed with what you think we should adopt" (2026-10-31). The research (`research-desktop-agent-ux/`) found five patterns the field has converged on, and an audit of Ogden's own screens found ten frequent frictions. Ogden lacks a fast way to start and route work, a real diff and review surface, and any way to look at the project's code beyond the per-edit hunks in chat.

## 2. Impact

- **Epics:** a new epic 26 (everyday polish); epic 8, an envelope since 2026-09-29 that already names in-app markdown and code review with comments back to the agent, is incepted as the Workbench; a new epic 27 (composer and where work runs). Epic 25 gives two stories to them: 25.6 worktree chats moves to 27, 25.7 Changes panel moves to 8, so there is one diff surface. Epic 8's VS Code extension (V3) and leftover agents (V4) move to a new envelope.
- **Spec:** two capabilities (CAP-34, CAP-35), one non-goal, one constraint.
- **Architecture:** four proposed decisions (AD-36 to AD-39); the AD-1 port list gains `WorkspaceFilesPort` and `EditorLauncherPort`.
- **UX:** EXPERIENCE.md and DESIGN.md gain the Workbench, the composer setup row, the diff viewer and the polish items; existing tokens are reused.
- **Code:** web for most of it; core and server for file reading, search, staging, project commands and opening an editor.

## 3. Recommended approach

Direct adjustment, in this order: **epic 26 first** (cheap, felt every day, mostly specified already), then **epic 8** (the Workbench), then **epic 27**, then the planned v1.3 epics 20, 24, 22, 25 and 23. Effort: 26 is about 9 stories, 8 about 10, 27 about 8. Risk is low for 26, medium for 8 (file reading and running project commands are new trust surfaces, fenced by AD-36 and AD-38) and medium for 27.

## 4. Detailed change proposals

### 4.1 Spec (`spec-ogden-agents/spec-ogden-agents.md`)

**P-S1. CAP-34 (new): Investigate and review without leaving Ogden.**
- intent: A user looks at what an agent did and why, in the project itself: browses files and reads them (markdown rendered), searches the project, reviews changes per file with views for this turn, unstaged, staged and the branch, stages or reverts a hunk, comments on lines and sends the comments to the agent as one message, runs the project's test or lint command and jumps from a failure to its line, and opens any file at a line in their own editor.
- success: From a finished turn, the user opens This turn's changes, reverts one hunk, comments on another and sends it; the agent's next turn answers the comment; a failing test from Problems opens at its line in the viewer and in VS Code.

**P-S2. CAP-35 (new): Start and route work in one place.**
- intent: The composer carries a setup row (agent, model, permission mode, and Location: This folder, Worktree or a remote machine); a chat can move between this folder and its own worktree; worktrees are kept to a number the user sets, with restore; one task can be tried with several agents side by side, each in its own worktree, and one kept; parallel worktrees get their own port.
- success: The user starts a chat in a new worktree from the composer without opening a dialog, hands it back to this folder, and tries a second task with two agents and keeps one result; a deleted worktree comes back from Restore.

**P-S3. Non-goal (new):** Ogden is not an IDE. No debugger, no extensions or language servers, no general editing; the file viewer is read-only, and editing and debugging hand off to the user's editor. Reverting or staging a hunk is allowed (it is a review action, not editing).

**P-S4. Constraint (new):** Every file Ogden reads or searches for a user is inside the project's top folder after resolving links, never a protected path, and capped in size; a project command runs only in a trusted project, as the BMad scripts do.

### 4.2 Architecture (`architecture-ogden-agents/architecture-ogden-agents.md`)

All proposed, not adopted, until the user adopts them.

**P-A1. AD-36 — Workspace files are read through one contained port.** Binds CAP-34. `WorkspaceFilesPort` lists, reads and searches files for the UI. Rule: every path is resolved (realpath) and must stay inside the workspace's top folder; protected paths (AD-17's list, credentials folders, `.git` internals) are refused; reads are capped (default 1 MB, binary shown as "binary file"); search respects `.gitignore` and caps results; no route takes an absolute path from the client, only a workspace id and a relative path. Prevents: a second, looser file-reading path appearing per feature.

**P-A2. AD-37 — Working-tree changes go through `VcsPort`, never a shell.** Binds CAP-34, CAP-35. Diff views (this turn, unstaged, staged, branch), stage, unstage and revert of a hunk are `VcsPort` operations. "This turn" is the diff between snapshots Ogden records at a turn's start and end (a tree object, no commit, no ref). A stage or revert is refused while an agent is mid-turn in the same folder. Worktree retention snapshots a worktree's uncommitted changes before removal so Restore can bring it back. Prevents: UI code running git directly, and a revert racing the agent's own write.

**P-A3. AD-38 — Project commands are declared, trusted and contained.** Binds CAP-34 (Problems) and CAP-35 (setup scripts). A project's commands (test, lint, setup) are named in workspace settings (or detected from `package.json` scripts and offered, never run until the user confirms); they run only in a trusted project (AD-15's trust), with the allowlisted environment (never `process.env`), killed on Stop or server stop, output masked; failures are parsed into `file:line` items by a small set of known formats (TypeScript, ESLint, Vitest/Jest, pytest, Go, Rust) and shown raw otherwise. Prevents: arbitrary command execution from a page, and parser sprawl.

**P-A4. AD-39 — Opening an editor is a fixed launcher.** Binds CAP-34. `EditorLauncherPort` knows a short list of editors (VS Code `code -g`, Cursor, Zed, JetBrains launchers) found on `PATH` the same way linked commands are; it starts one with `file:line` as arguments, no shell, allowlisted environment, only for paths AD-36 allows. Prevents: a URL scheme or shell string built from user input.

**P-A5. AD-1 port list note:** add `WorkspaceFilesPort` and `EditorLauncherPort`.

### 4.3 UX (`ux-ogden-agents/EXPERIENCE.md`, `DESIGN.md`)

- **Needs you rows** show the request in two lines (what and where), and `g y` (or `]` in the Needs you group) jumps to the next one.
- **New chat:** `g n`, Cmd/Ctrl+N and a New chat button in the chat header; **Command palette** (Cmd/Ctrl+K) for projects, chats, files and actions.
- **Tool rows** read "Waiting for you" until approved; a Normal or Verbose detail toggle per chat.
- **Sidebar rows** become one line (title, status dot, agent icon); the shortcut banner shows once and lives in Help after.
- **Settings** gets grouped left navigation (Agents, Projects, Appearance, Notifications, Terminals, Remote machines, Advanced).
- **Plain titles:** build sessions are titled "Build 1.2: <ticket title>", never the skill command; Runs rows open their run; the Board shows the epic's name; Review highlights its own tab; terminal header buttons show their icons.
- **Composer setup row:** agent, model, mode and Location chips under the prompt box, each a small menu; Location shows a branch badge when Worktree.
- **Workbench** tab per project with Files, Search, Changes and Problems; one **diff viewer** component (per file, syntax colour, inline or side by side, hunk actions, line comments) used by chat, Changes and Review; paths and `file:line` in chat are links; every file has **Open in editor**.
- Tokens: existing DESIGN.md tokens; syntax colours derived from the palette's accent and status colours, checked at 4.5:1 in both themes.

### 4.4 Epics and stories (apply with `bmad-ticket`)

**Epic 26 (new, v1.3, first): "Everyday polish: what the audit found"**
1. Tracer bullet: Needs you rows show the request, and `g y` jumps to the next one.
2. New chat in one step: `g n`, Cmd/Ctrl+N, header button.
3. Command palette (Cmd/Ctrl+K): projects, chats, actions.
4. Tool rows wait in words; Normal and Verbose detail.
5. One-line sidebar rows; the shortcut banner shows once.
6. Plain titles and dead ends: build session titles, clickable Runs rows, the Board's epic name, Review's tab, terminal header icons.
7. Settings with grouped navigation.
8. Refactor sweep.
9. End-to-end suite and release part.

**Epic 8 (incept; renamed "The Workbench: look into the project and review changes without leaving Ogden")**
1. Tracer bullet: Files tab lists the project and shows one file read-only through `WorkspaceFilesPort`.
2. Epic contracts and stubs: files, search, diff views, hunk actions, project commands, editor launcher; routes and events.
3. The diff viewer component (per file, syntax colour, inline or side by side), used by Review first.
4. Changes panel: This turn, Unstaged, Staged, Branch; turn snapshots (moved from 25.7, including Commit these changes for a worktree chat).
5. Hunk stage, unstage and revert; refused mid-turn.
6. Line comments sent to the agent as one message.
7. Files and viewer: markdown rendered, links from chat paths and `file:line`.
8. Project search.
9. Problems: declared commands, trusted only, failures as `file:line`, "Ask the agent to fix this".
10. Open in editor.
11. Command palette gains files.
12. Refactor sweep.
13. End-to-end suite and release part.

**Epic 27 (new): "Start work where it should run"**
1. Tracer bullet: the composer setup row with Location This folder and Worktree.
2. Epic contracts and stubs.
3. Worktree chats (moved from 25.6) with a branch badge.
4. Hand-off between this folder and the chat's worktree.
5. Location: a remote machine from the composer.
6. Worktree retention and Restore.
7. A port per worktree.
8. Try with several agents: one task, side by side, keep one.
9. Refactor sweep.
10. End-to-end suite and release part.

**Moved:** epic 25 keeps tray, quick entry and attachments; 25.6 goes to 27.3 and 25.7 to 8.4. **New envelope:** "VS Code extension" (epic 8's V3) and epic 8's V4 agents note move to a new envelope epic, unplanned.

## 5. Implementation handoff

Scope: moderate (backlog reorganization plus two new epics and one inception). Order: 26, 8, 27, then 20, 24, 22, 25, 23. Each story follows the usual loop: plan, build, a fresh code-only review, triage, full test suite, commit. AD-36 to AD-39 need the user's adoption before epic 8's stories that use them are built (26 needs none).

Open question for the user: should Always allow be scoped to a command pattern (as Zed does)? Not proposed here, since it changes the permission model.

## 6. Approval and handoff log

- 2026-10-31: proposed.
