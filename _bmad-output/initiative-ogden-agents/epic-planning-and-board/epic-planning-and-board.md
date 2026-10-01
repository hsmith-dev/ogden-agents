---
type: epic
title: "Plan with every BMAD skill and track it on a live board"
parent: initiative-ogden-agents
covers: [CAP-2, CAP-6, CAP-7, CAP-18]
after: []
assignee: ""
risk: high
---

# Plan with every BMAD skill and track it on a live board

## Description

A user sets up the BMad Method in a project from the UI, then plans in plain language: the Plan tab lists every installed skill and module from a catalog discovered in the project, and each action starts a planning session, an ordinary agent conversation of kind `planning` in the session view, with the skill invoked. The Board tab shows the project's v7 ticket tree live, read from the BMAD files through `tickets.py`, and sets a ticket's status through `tickets.py mark`. A project with plain upstream BMAD opens in reduced mode with an upgrade offer.

## Outcome

A user goes from an idea to a spec and a ticketed epic using only the UI; CAP-6's success criterion is the signal, and CAP-7's (an agent's status write shows on the board within seconds) is the second.

## Requirements

Each line maps to a spec capability in `covers` and names the architecture decisions and UX sections it carries. Parts earlier epics built are named so no ticket rebuilds them: session `kind` already allows `planning` (`packages/shared/src/entities.ts`), the session view, permission cards and persistence (epic 2), the uv toolchain that finds or installs uv (`packages/adapters/src/toolchain-uv`, story 1.8), the bundled `bmad-method` and `bmad-loop` forks and `forks.lock` (story 1.9), workspaces with their repo `path` and `realPath` (story 2.5), and the Developer mode preference (story 1.6).

- E4-R1: The server runs BMAD's Python scripts through uv: one runner in an adapter runs a script from the bundled fork (or the repo's installed copy) against a workspace folder with an allowlisted environment, a time limit, streamed output and parsed JSON results, and reports a missing uv or a failed script as a plain error, never a crash. (CAP-2, CAP-7; AD-1, AD-13, AD-21; spec Constraints, "Reuse BMAD before building")
- E4-R2: A project without BMad Method shows "Set up BMad Method in this project" on Plan and Board; **Set up** runs the bundled fork's `bmad` setup (`skills/bmad/scripts/setup.py`) through the server, copying skills from the package, with a progress list and errors in the UI, and ends with the project reporting current. Workspace settings shows the setup status and an update when the bundled fork is newer. Chats keep working without BMAD. (CAP-2; AD-12, AD-13, AD-21; EXPERIENCE.md State Patterns "Workspace without BMad Method", Key Flows Flow 1 step 4)
- E4-R3: `BmadCatalogPort` and the `bmad-catalog` adapter build the workspace's catalog of modules, skills, agents and help from installed metadata (`bmod.toml`, `SKILL.md` frontmatter, `roster.toml`, help files) and refresh it when the installed skills change, without a restart. Core and web name no skill; skill names appear only as catalog data and inside `tickets-v7`. A module installed after an Ogden Agents release appears and runs with no code change. (CAP-18, CAP-6; AD-1, AD-12)
- E4-R4: Plain-language labels, one-sentence descriptions, a UI group, and the entry action behind "Start from an idea" live in fork metadata as a patch carried in `vendor/bmad-method` (tagged per AD-13, `forks.lock` updated) and opened as an upstream PR. The catalog falls back to the `SKILL.md` description when a skill has no label. (CAP-6, CAP-18; AD-12, AD-13; bmad-integration.md Fork extensions)
- E4-R5: The Plan tab shows "Start from an idea" with a one-line prompt as the one primary action, then catalog groups in the UX order; each action shows its plain label and one sentence, Developer mode adds the skill name in mono, and modules installed in the last 7 days carry "New". An action starts a session of kind `planning` in the workspace whose first message invokes the skill (with the user's idea when given), rendered in the same session view with permission cards. Workspace tabs Chats, Plan, Board with `g c` / `g p` / `g b`. (CAP-6, CAP-18; AD-8, AD-12, AD-18; EXPERIENCE.md Information Architecture, Component Patterns "Plan home", "Planning session")
- E4-R6: When a planning session writes a BMAD document, a document card appears in the transcript with **Open** and the next suggested step as a button (for example "Turn this spec into tickets") that starts the next planning session. (CAP-6; AD-5, AD-12; EXPERIENCE.md Component Patterns "Planning session", Key Flows Flow 1 steps 6-7)
- E4-R7: `TicketStorePort` and the `tickets-v7` adapter read the ticket tree through `tickets.py status` into an index that can be thrown away, rebuilt from watching the workspace's `_bmad-output` in the main checkout (never worktrees). A change an agent writes to a plan file or `tickets.toml` emits `ticket.changed` carrying only `workspaceId` and the ticket ref within seconds; the UI reads tickets over REST with TanStack Query and refetches on the event. The database stores ticket refs only. (CAP-7; AD-5, AD-7, AD-10, AD-11)
- E4-R8: The Board tab shows the tree grouped by epic with status columns (Draft, Ready, In progress, In review, Built, Done, Blocked), each card with its ref, title and one status line, "Waits for 1.2" when a prerequisite is unmet, the blocked reason, and a 1.2s highlight on a changed card; ticket detail opens as a side sheet at `/w/:wsId/board/:ref`; below `md` epics stack as lists. Ticket status is shown as the files give it, never worked out from a session or run. (CAP-7; AD-7, AD-8, AD-18; EXPERIENCE.md Board, Ticket detail, Responsive; DESIGN.md Ticket card)
- E4-R9: A status set from a card menu ("Move to Ready") goes through a core use-case and `TicketStorePort` to `tickets.py mark` and lands in the plan file; "Done" is never offered (only epic 5's approve writes `done`); there is no drag in v1. (CAP-7; AD-10, AD-11; EXPERIENCE.md Board)
- E4-R10: Features are gated on capabilities detected from the project's installed metadata, not on version strings. A project with plain upstream BMAD opens in reduced mode: each surface whose fork capability is missing shows the inline reduced-mode notice with one sentence and **Upgrade this project**, which runs setup with the bundled fork through the server. Nothing fails silently. (CAP-2, CAP-6, CAP-7; AD-14, AD-21; EXPERIENCE.md Reduced-mode notice; DESIGN.md Reduced-mode notice)

## Done when

1. A repo gains a working `_bmad` setup from the UI that reports current, with no terminal (CAP-2; E4-R1, E4-R2).
2. A user produces a spec and a ticketed epic using only UI chat and buttons, run live with Claude Code (CAP-6; E4-R5, E4-R6).
3. A status an agent writes to a plan file appears on the board within seconds, and a status set in the UI lands in the plan file via `tickets.py` (CAP-7, AD-7, AD-10; E4-R7, E4-R8, E4-R9).
4. A BMAD module installed after the release appears in the UI and runs (CAP-18, AD-12; E4-R3).
5. A repo with plain upstream BMAD opens in reduced mode with an upgrade offer (AD-14; E4-R10).
6. The epic's end-to-end suite passes on macOS, Windows and Linux, and it is released in an `ogden-agents` npm version.

## Boundaries

Planning and the board, with Claude Code as the agent that runs planning sessions. No dispatch of builds, Build buttons, Runs tab, review or approve (epic 5): the board shows "Waits for" but no Build action. No other agents (epic 6): the catalog, planning sessions and setup stay agent-neutral behind ports, so epic 6 adds adapters only. No tracker stores (spec Non-goals) and no in-app markdown viewer or editor (epic 8, v2). The fork patches it needs, such as plain-language labels, are carried and sent upstream from here; bmad-loop's v7 patch belongs to epic 5.

## References

- parent — _bmad-output/initiative-ogden-agents/initiative-ogden-agents.md
- spec — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, sections Capabilities (CAP-2, CAP-6, CAP-7, CAP-18), Constraints, Non-goals, Success signal
- bmad integration — _bmad-output/initiative-ogden-agents/spec-ogden-agents/bmad-integration.md (Files Ogden Agents reads, Writes, Reuse first, Fork extensions, Skills surfaced in the UI)
- architecture — _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md, AD-1, AD-5, AD-7, AD-8, AD-9, AD-10, AD-11, AD-12, AD-13, AD-14, AD-15, AD-18, AD-21, Consistency Conventions (Config and data), Capability map
- ux — _bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md, Information Architecture (Workspace: Plan, Workspace: Board, Ticket detail, Workspace settings), Voice and Tone, Component Patterns (Plan home, Planning session, Board, Reduced-mode notice), State Patterns, Interaction Primitives, Responsive, Key Flows (Flow 1 steps 4-7)
- ux — _bmad-output/initiative-ogden-agents/ux-ogden-agents/DESIGN.md, Components (Ticket card, Reduced-mode notice), Typography, Layout & Spacing; mockup _bmad-output/initiative-ogden-agents/ux-ogden-agents/mockups/key-workspace.html
- fork — vendor/bmad-method/skills/bmad-ticket/scripts/tickets.py (`status`, `find`, `next`, `pull`, `mark`; prints JSON), vendor/bmad-method/skills/bmad/scripts/setup.py and setup_check.py (setup, `--status`), vendor/bmad-method/skills/bmod-method/bmod.toml and roster.toml, forks.lock
- code — packages/core/src/agent-port.ts, packages/core/src/chat/workspaces.ts (`createChatSession`), packages/server/src/chat-routes.ts, packages/shared/src/chat.ts (`CreateSessionRequest`), packages/shared/src/events.ts, packages/adapters/src/toolchain-uv/uv-toolchain.ts, packages/adapters/src/index.ts, packages/web/src/router.tsx, packages/web/src/shell/app-shell.tsx

## Notes

- Decision (2026-10-01, inception, autonomous draft): the tracer bullet is entry 1, one planning session started from a bare Plan page in a repo that already has BMAD, which invokes a skill in Claude Code, plus a bare Board page that lists the repo's tickets read through `tickets.py status` via uv, through a minimal uv runner, catalog and ticket adapters, core, REST and web. Entry 2 then freezes contracts and stubs so the lanes open at once.
- Decision (2026-10-01, inception, autonomous draft): after entry 2, setup (3), the fork label patch (5) and the ticket index (8) run at once; setup owns the Set up panel on the Plan and Board pages and the setup code in the catalog adapter, so the catalog (4, after 3 and 5), Plan home (6), then document cards (7, also after the catalog 4), and the board UI (9) follow it; entry 2 pre-registers every route and adapter wiring slot so the lanes only fill them; status changes from the board (10) wait on 8 and 9; reduced mode (11) waits on the catalog, Plan home and board actions (and so on setup) because it gates all of them. Entry 2 owns every shared shape. The least certain piece, how a skill is invoked in an agent session and how a written document is detected, sits in the tracer and entry 7. A refactor sweep (12) and an end-to-end suite with release (13) close the epic. Live Claude Code checks sit on the hitl entries 1 and 13; entry 5 is hitl for opening the upstream PR.
- Decision (2026-10-01, inception): Build actions, the Runs tab and approve are epic 5's; this board shows status and prerequisites only.
- Source conflict: Boundaries and bmad-integration.md Fork extensions — the envelope lists a `tickets.py --json` fork patch vs the vendored `tickets.py`, which already prints JSON for every subcommand and errors as `{"error": ...}` on stderr. No `--json` patch is planned; entry 2 freezes the JSON shapes Ogden reads.
- Source conflict: EXPERIENCE.md Board — the columns (Draft, Ready, In progress, In review, Built, Done, Blocked) vs `tickets.py`, whose states include `planned` for an entry with no plan file and `dropped`. Assumption below; confirm at entry 2.
- Assumption: planning sessions are agent conversations (session kind `planning`, EXPERIENCE.md Planning session) whose first message invokes the skill, not a structured wizard; the agent adapter formats the invocation (for Claude Code, the skill's slash command), so core names no skill (AD-1, AD-12). See open question.
- Assumption: planning documents and tickets are written into the user's repo under its configured `output_folder` (`_bmad-output/` by default) by the agent, behind permission cards, as the spine's Config and data convention allows ("nothing is written to user repos except BMAD's own files and worktrees"); Ogden itself writes only through BMAD's scripts (`setup.py`, `tickets.py mark`). See open question.
- Assumption: the board watches the workspace's output folder with Node's `fs.watch` (recursive), debounced, and reruns `tickets.py status` via uv to rebuild the index, rather than parsing `tickets.toml` and plans in TypeScript; no file-watching dependency is added. See open question.
- Assumption: the board writes status only through core (a use-case calling `TicketStorePort.mark`, which runs `tickets.py mark`), per AD-10 and AD-11; the web never runs scripts and no route writes a file directly.
- Assumption: a planned entry (no plan file) shows in the Draft column, and `dropped` tickets are hidden behind a filter; "Move to Ready" on a planned entry runs `tickets.py mark <ref> ready-for-dev`, which writes its plan.
- Assumption: setup installs skills for Claude Code only in this epic (the skill folders setup.py writes for that agent); epic 6 adds the other agents' skill folders through the same setup call.
- Assumption: the "Start from an idea" entry action and each skill's UI group come from the fork label patch (entry 5), so the web never chooses a skill by name.
- Assumption: entry 7 finds written documents from the planning session's write tool calls into the output folder, which core learns from the setup status `BmadCatalogPort` returns, so core reads no BMAD config (AD-1) and entry 7 does not share entry 8's watcher code.
- Assumption: the board shows the `problems` `tickets.py status` reports (for example an unknown plan status) as a one-line notice instead of dropping them (AD-14, nothing fails silently).
- Open question: AD-12 allows skill names only inside `buildrunner-bmad-loop` and `tickets-v7`, but entry 3 runs the `bmad` skill's `setup.py` from the `bmad-catalog` adapter. Should AD-12 gain a note allowing `bmad-catalog` to name the `bmad` setup skill (amended in place per the spine's convention)? Entry 3 waits on it.
- Open question: How are BMad skills run from the UI: an agent chat in a planning session with the skill invoked in the first message (EXPERIENCE.md's planning session), or a structured wizard that collects answers in forms and then runs the skill? The draft assumes the chat; entries 1, 6 and 7 wait on it.
- Open question: Where do planning artifacts live: the user's repo `_bmad-output/` (BMAD's own output folder) or Ogden's data directory, and may Ogden write into the user's repo beyond BMAD's own scripts (setup, `tickets.py mark`) and the agent's permitted writes? The draft assumes the repo; entries 1, 3 and 7 wait on it.
- Open question: How does the board read `tickets.toml` and plan files: watch files and rerun the vendored `tickets.py status` via uv, or parse the files in TypeScript? And may the board change ticket state, given that only core writes and every status change goes through `tickets.py mark` (AD-10, AD-11)? The draft assumes watch plus `tickets.py`, and board writes through core; entries 8, 9 and 10 wait on it.
- Open question: How is BMad set up in a user's project: the bundled fork's `bmad` skill `setup.py` run through uv (the uv toolchain from epic 1), the `npx skills` installer the `bmad` skill uses for updates, or BMAD's npm installer? Which config questions does setup ask, and does the UI answer them with defaults? Entry 3 waits on it.
- Open question: Multi-agent boundaries with epic 6: does this epic run planning sessions with Claude Code only and install skills only for Claude Code, leaving other agents' skill folders and skill-invocation formats to epic 6's adapters? The draft assumes yes.
- Open question: What does **Open** on a document card do in v1, when viewing the project's markdown files in the app is planned for v2 (epic 8)? Options: open the file with the OS default app, show it read-only in a sheet, or open the folder. Entry 7 waits on it.
- Open question: Where does "the next suggested step" come from: BMAD's help metadata (the `bmad` skill's knowledge and help files) or the fork label patch? Entries 5 and 7 wait on it.
- Waits on epic 1 because: the bundled forks and `forks.lock` (1.9) and the uv bootstrap (1.8).
- Waits on epic 2 because: planning runs in chat sessions, the session view and permission cards (2.10).
