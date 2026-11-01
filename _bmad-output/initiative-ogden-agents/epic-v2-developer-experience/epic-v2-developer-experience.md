---
type: epic
title: "The Workbench: look into the project and review changes without leaving Ogden"
parent: initiative-ogden-agents
covers: [CAP-34, CAP-12, CAP-33]
after: []
assignee: ""
risk: medium
---

# The Workbench: look into the project and review changes without leaving Ogden

## Description

v1.3, built second of the desktop UX uplift (change-desktop-ux-uplift, approved 2026-10-31), after epic 26. Requested for v2 on 2026-09-29 as in-app markdown reading and code review with comments back to the agent; incepted on 2026-10-31 as spec CAP-34. Each project gets a Workbench tab with Files, Search, Changes and Problems. The user reads the project's files (markdown rendered, read-only), searches it, reviews changes per file in one diff viewer (This turn, Unstaged, Staged, Branch), stages or reverts a hunk, comments on lines and sends the comments to the agent as one message, runs the project's declared test or lint command and jumps from a failure to its line, and opens any file at a line in their own editor. It takes the Changes panel and Commit these changes from epic 25 (25.7), so there is one diff surface. It is fenced by AD-36 to AD-39: one contained file port, working-tree changes only through `VcsPort`, declared and trusted project commands, and a fixed editor launcher. Ogden stays not an IDE (spec Non-goals). The VS Code extension and the leftover agents (this epic's V3 and V4 before 2026-10-31) moved to epic 28 (`epic-vscode-extension`).

## Outcome

A user reviews what an agent did, in the project itself, and answers it without switching tools; the CAP-34 success line (revert one hunk, comment on another, the agent answers; a failing test opens at its line in the viewer and in VS Code) is the signal.

## Requirements

Drafted at inception (2026-10-31, autonomous) from change proposal sections 4.1 to 4.4; the user approved the plan and adopted AD-36 to AD-39 the same day. Each line maps to a spec capability in `covers`. The candidate lines V1 and V2 (2026-09-29) grew into E8-R1 to E8-R10; V3 and V4 moved to epic 28.

- E8-R1: `WorkspaceFilesPort` is the only way the UI lists, reads and searches files: routes take a workspace id (and a worktree chat's session id) and a relative path, never an absolute one; every path is resolved and stays inside the root; credential folders and `.git` internals are refused; secret-bearing files are shown masked; reads cap at 1 MB and a binary file shows as "binary file"; content is served by GET only and never logged. (CAP-34; AD-36, AD-1 port list note, spec Constraints)
- E8-R2: A Workbench tab per project with Files, Search, Changes and Problems; the file viewer is read-only with syntax colour and markdown rendered; paths and `file:line` in chat are links that open it. (CAP-34; spec Non-goals "Ogden is not an IDE"; EXPERIENCE.md Workbench)
- E8-R3: One diff viewer component (per file, syntax colour, inline or side by side, file jump, hunk actions, line comments) is used by chat, Changes and Review; Review's raw `git diff` text is replaced; syntax colours come from the palette and pass 4.5:1 in both themes. (CAP-34, CAP-12; DESIGN.md diff viewer)
- E8-R4: Changes shows This turn, Unstaged, Staged and Branch through `VcsPort`; This turn is the diff between tree snapshots Ogden records at a turn's start and end (no commit, no ref, kept in the data directory). For a worktree chat it also offers Commit these changes: a user-clicked local commit to the chat's branch with hooks off, serialized with the repo's git work, never pushed, with the plain line about merging (moved from E25-R5 with 25.7). (CAP-34, CAP-33; AD-37, AD-17 CAP-33 note, AD-8 CAP-33 note)
- E8-R5: Stage, unstage and revert of a hunk are `VcsPort` operations, refused while an agent is mid-turn in the same folder. (CAP-34; AD-37)
- E8-R6: Line comments on any diff are collected and sent to the chat's agent as one message, each with its file and line. (CAP-34)
- E8-R7: Project search over the files `.gitignore` keeps, with capped results that open in the viewer at their line. (CAP-34; AD-36)
- E8-R8: Problems runs a project's declared test or lint command: named in workspace settings or detected from `package.json` scripts and offered, run only after the user confirms and only in a trusted project, bound to its text, with the allowlisted environment, killed on Stop or server stop, output masked and kept out of the event log; failures from TypeScript, ESLint, Vitest/Jest, pytest, Go and Rust become `file:line` items with fixtures, others are shown raw; an item opens at its line and offers "Ask the agent to fix this". (CAP-34; AD-38, AD-22 trust, AD-16)
- E8-R9: Open in editor on every file, diff and Problems item: `EditorLauncherPort` with a fixed list (VS Code `code -g`, Cursor, Zed, JetBrains launchers) found on `PATH` like linked commands, started with `file:line` as arguments, no shell, allowlisted environment, only for paths E8-R1 allows. (CAP-34; AD-39)
- E8-R10: The command palette (26.3) also finds files by name. (CAP-34)
- E8-R11: Works on macOS, Windows and Linux, in the desktop app and the npm route; the user's live checks (a real agent answering comments, VS Code opening at a line) are recorded; ships in the v1.3 release. (CAP-34)

## Done when

1. From a finished fake-agent turn, This turn's changes opens, one hunk is reverted, a comment on another is sent, and the agent's next turn receives it as one message with its file and line (CAP-34).
2. A path outside the project through a link, an absolute path, `.git` internals and a credential folder are refused by the server; a 2 MB file is capped and a `.env` value is masked.
3. A failing fixture test in Problems opens at its line in the viewer and, in the user's live check, in VS Code; no project command runs in an untrusted project or before the user confirms it.
4. Chat, Changes and Review show the same diff viewer; a stage or revert is refused mid-turn; a fixture worktree chat's Commit these changes lands only on its branch with hooks off, nothing is pushed and the main checkout is untouched (CAP-33).
5. The end-to-end suite passes on all three OSes with fakes only, the user's live checks are recorded, and the epic ships in the v1.3 release.

## Boundaries

Reading, reviewing and checking the project inside Ogden. Not here: editing files, a debugger, extensions or language servers (spec Non-goals, Ogden is not an IDE; editing hands off to the user's editor); creating worktree chats, hand-off and retention (epic 27); merging from Ogden; a VS Code extension and more agents (epic 28).

## References

- spec — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, CAP-34, CAP-12, CAP-33, Constraints (CAP-34, CAP-35 containment), Non-goals (Ogden is not an IDE)
- architecture — _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md, AD-36, AD-37, AD-38, AD-39, AD-1 (CAP-34 and CAP-35 note), AD-8 and AD-17 (CAP-33 notes), AD-16, AD-22
- parent — _bmad-output/initiative-ogden-agents/initiative-ogden-agents.md
- change — _bmad-output/initiative-ogden-agents/change-desktop-ux-uplift/change-desktop-ux-uplift.md, sections 4.1 to 4.4 and 6
- research — _bmad-output/initiative-ogden-agents/research-desktop-agent-ux/research-desktop-agent-ux.md (patterns 5 and onward); claude-desktop.md, codex-desktop.md, other-harnesses.md beside it
- audit — _bmad-output/initiative-ogden-agents/research-desktop-agent-ux/ogden-current.md, Finished turn and diff, Runs run view and Review, top 10 #6 and #9
- experience — _bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md, Component Patterns (Workbench, Files and viewer, Project search, Diff viewer, Line comments, Changes, Problems) and Flows 6 and 7
- design — _bmad-output/initiative-ogden-agents/ux-ogden-agents/DESIGN.md, Components (diff viewer, syntax colours)
- epic 25 — _bmad-output/initiative-ogden-agents/epic-desktop-conveniences/epic-desktop-conveniences.md (25.7 moved here)
- code — packages/web/src/planning/build-review.tsx (Review's raw diff), packages/web/src/chat/tool-call-row.tsx (per-edit hunks)

## Notes

- Decision: planned for v2, after epic 7; the user wants markdown viewing, code-change review and an elevated development experience, or a VS Code extension as a separate epic (user, 2026-09-29).
- Open question: one epic for the in-app viewer and review, plus a separate epic for the VS Code extension, or one combined epic? Decide at inception. (Settled 2026-10-31: two epics; see below.)
- Decision (2026-10-02, user): more agents move here from v1's epic 6: Codex, Gemini CLI and GitHub Copilot CLI for chat and builds, and builds with Antigravity (or Antigravity chat too, if epic 6's spike is a no-go; epic 6 keeps the agent-choice groundwork either way, user 2026-10-02). The research, the draft's 14-entry plan for Codex and Gemini CLI (commit cced0a9) and the open questions are kept in epic 6's Notes as input. Whether they are part of this epic or a v2 epic of their own is decided at inception.
- Decision (2026-10-02, user: "we need to add v1.1: Codex and Grok features"): Codex for chat moves out of V4 to epic 12 (v1.1, "Codex and Grok beside Claude Code"). V4 keeps Gemini CLI, GitHub Copilot CLI, builds with Antigravity, and builds with Codex and Grok unless epic 12's inception takes them into v1.1.
- Decision (2026-10-05, user): V4's builds with Codex, Grok and Antigravity move into version 1 as epic 17 (`epic-builds-with-other-agents`). GitHub Copilot CLI builds are not planned at all (autonomous background Copilot CLI use violates GitHub's terms; Copilot stays interactive in epic 16's terminal). V4 keeps Gemini CLI chat and builds and Copilot chat.
- Decision (2026-10-31, user, change-desktop-ux-uplift approved): incepted as the Workbench for CAP-34 in v1.3 under AD-36 to AD-39 (adopted), retitled from "Developers review and navigate their project without leaving Ogden Agents (v2)"; folder and slug kept. Built after epic 26 and before epic 27. V1 and V2 became E8-R1 to E8-R10; V3 (the VS Code extension) and V4 (Gemini CLI chat and builds, Copilot chat) moved to the new envelope epic 28 (`epic-vscode-extension`), which carries the V4 decision history above; the open question is settled as two epics. 25.7 (the Changes panel and Commit these changes) moved here as entry 4. Its agent dependency on epic 6 moved to epic 28.
- Decision (2026-10-31, autonomous): tracer bullet is entry 1 (the Files tab lists the project and shows one file through `WorkspaceFilesPort`), the thinnest path through the new port, route and tab.
- Decision (2026-10-31, autonomous): 13 entries, past the typical eight to twelve; they are one web lane (3 to 6) and one files lane (7, 8, 11) over one contracts entry, and the change proposal's list was approved as is.
- Decision (2026-10-31, autonomous): entry 2 owns the chat `worktreePath` and branch fields with their events (moved from 25.2), since entry 4 is the first to need them and epic 27 builds after this epic; 27.3 creates worktree chats on them. Entry 4 tests Commit these changes on a fixture chat worktree.
- Decision (2026-10-31, autonomous): sequencing: entries 3 to 6 are one lane over the diff viewer and run in order; entries 7 and 8 run beside them (the syntax tokens they share are entry 2's); 9 follows 7; 10 follows 6 and 9, since it adds a button to both; 11 follows 8 and 26.3.
- Decision (2026-10-31, autonomous after the set check): entry 1 owns path containment and its refusals; entry 7 owns caps, binary and masking in the viewer; the search and output caps are entry 2's `unknown`.
- Assumption: entry 9 offers the detected `package.json` scripts named `test` and `lint` only; other detectors are later work. The user may overrule.
- Waits on epic 2 because: workspaces and the session view (2.5, 2.10). Waits on epic 4 because: per-project trust (4.2). Waits on epic 5 because: worktrees through `VcsPort` and the review page (5.5, 5.9). Waits on epic 12 because: the linked-command resolver (12.12). Waits on epic 26 because: the command palette (26.3).
