---
type: epic
title: "Projects start as simple multi-agent chats, and each turns on the BMad pieces it wants"
parent: initiative-ogden-agents
covers: [CAP-19, CAP-17]
after: []
assignee: ""
risk: medium
---

# Projects start as simple multi-agent chats, and each turns on the BMad pieces it wants

## Description

Ogden Agents stays a herdr-like UI for everyone: the multi-workspace sidebar, several agents and several chats per project are always on. BMad Method becomes optional per project. A new project starts simple, a plain multi-chat wrapper over Claude Code (or another agent): Ogden installs nothing into the repo, shows no BMad screen, and adds no BMad skill or prompt to its sessions. In a project's settings the user turns on the BMad pieces they want: Planning, Board, Unattended builds and Retrospectives. An app-wide default decides how new projects start, and it is Simple until the user changes it; Welcome asks once, for the first project, "Simple chats or BMad Method?". A repo that already has `_bmad/` is detected and offered BMad, and its files are never changed or deleted. This epic builds the switch and the one shared contract (the per-project feature flags, a core guard, and the list of pieces this install ships), so epics 4 to 7 are built switchable from the start. It ships none of those pieces itself.

## Outcome

Users who only want chats never see or carry BMad, and users who want it turn on only the pieces they use. The signal is CAP-19's success line: a new project chats with two agents in two chats with nothing BMad written or shown, and turning a piece on, then off, shows and hides it without touching the project's files.

## Requirements

Each line maps to a parent id in `covers` (CAP-19, CAP-17) and to AD-22, and names what it carries. Parts earlier epics built are reused, not rebuilt: per-workspace settings with `GET`/`PATCH /api/v1/workspaces/:wsId/settings` and `workspace.settings_changed` (story 2.5, caution level 2.8; `packages/shared/src/chat.ts` `WorkspaceSettings`, `packages/core/src/db/schema.ts` `workspaces`), the add-project dialog (2.5), the install-level preference file pattern (`packages/core/src/onboarding.ts`, `onboarding.json`, 9.5), Welcome's project step (9.5), the Tools page and uv found or installed only on request (1.8), Developer mode (1.6), and the terminal toggle (epic 3).

- E10-R1: Each workspace holds its BMad pieces: `planning` (Plan, the catalog, planning sessions; CAP-6, CAP-18), `board` (the ticket board and status changes; CAP-7), `builds` (unattended builds, the run view, verification, review and approve, notifications; CAP-8, CAP-9, CAP-10, CAP-12, CAP-14) and `retrospectives` (CAP-13). "BMad off" is every piece off; there is no separate master flag. The list, the plain label and sentence of each piece, and the dependency rule (`builds` needs `board`; `retrospectives` needs `builds`, changed to `retrospectives` needs `board` by epic 7, user 2026-10-02) live once in `packages/shared`. Core stores the pieces on the workspace row and changes them only through a use-case that emits `workspace.settings_changed`. (CAP-19, CAP-17; AD-22; AD-2, AD-5, AD-11)
- E10-R2: One guard is the only on/off check. Every core use-case that serves a piece calls `requireBmadFeature(workspaceId, piece)`, which refuses with the error code `feature_off` and a plain message; every server route that serves a piece is registered through one helper that applies the guard, and an architecture test fails on a BMad route registered without it. The install reports which pieces it ships (`available`, with a reason when not), so a piece is offered only once the epic that builds it has registered it. Epics 4 to 7 consume this contract and add no check of their own. (CAP-19; AD-22; spec Constraints "Guardrails are enforced in code")
- E10-R3: A project with every piece off is a plain multi-agent, multi-chat workspace: the sidebar, several chats, several agents, permission cards, caution level, resume and the Developer-mode terminal toggle behave exactly as in 0.2.0; it shows no Plan, Board or Runs tab and no BMad notice, Ogden writes nothing BMad into the repo, and no BMad skill or text is added to its sessions; files the repo already has, including its own `.claude/skills`, are left alone, never hidden or rewritten (user, 2026-10-01). With no project using BMad, the Tools page says uv is needed only for BMad features and nothing installs it. (CAP-19, CAP-17, CAP-3; AD-21, AD-22)
- E10-R4: An app-wide default decides the pieces a newly added project starts with: Simple (every piece off) until the user changes it in Settings. It is an install-level preference kept by core in the data folder, not a browser preference, so every tab and the Welcome flow agree. Adding a project from the dialog applies it. For the first project only, Welcome asks once "Simple chats or BMad Method?" (Simple chats preselected) and applies the answer to that project; the app-wide default is not changed by it (user, 2026-10-01). (CAP-19; AD-22; EXPERIENCE.md Information Architecture Welcome and Key Flows Flow 1 step 4, dated notes 2026-10-01)
- E10-R5: Detection never changes the repo. When a project is added or opened, the `bmad-catalog` adapter checks, read-only, whether the repo already has `_bmad/` (and `_bmad-output/`). If it does and the project's pieces are off, the project shows one offer, "This project already uses BMad Method. Turn on its features?", with **Choose features** (opening the project's BMad settings) and **Not now** (remembered per project). Turning pieces off never deletes or edits `_bmad/`, `_bmad-output/`, skills or any other file. (CAP-19, CAP-2 detection part; AD-22; AD-1, AD-12, AD-14 unchanged)
- E10-R6: Workspace settings has a "BMad Method" section: one switch "Use BMad Method in this project" and, under it, the pieces with their plain label and one sentence; the dependency rule is applied as the user picks (turning on Unattended builds turns on Board; turning off Board turns off what needs it, said in one line); all four pieces are always listed, and one this install doesn't ship yet is greyed, cannot be turned on and is marked "Coming soon" (user, 2026-10-01); turning BMad off says "Your BMad files stay in this project". The workspace header's tab slots (Chats always; Plan, Board, Runs) render from the pieces, so the epics that build those tabs only fill a slot. (CAP-19, CAP-17; AD-18, AD-22; EXPERIENCE.md Information Architecture Workspace settings, dated note 2026-10-01)
- E10-R7: Existing users keep what they have. Upgrading a 0.2.0 data folder adds the pieces to every workspace, all off, which matches what 0.2.0 does; the app-wide default starts Simple; every stored `workspace.settings_changed` event from 0.2.0 still parses and replays; projects whose repo already has `_bmad/` get the R5 offer once. (CAP-19, CAP-17; AD-5 "All events are retained")
- E10-R8: The switch is independent of Developer mode: the terminal toggle stays governed only by Developer mode (epic 3, user decision), and Developer mode shows nothing BMad in a project with BMad off. No standard flow in this epic needs a terminal; turning a piece on that needs BMad installed hands off to epic 4's setup through the server. (CAP-19, CAP-5 unchanged; AD-21, AD-22)

## Done when

1. A new project, with the default untouched (and Simple chats chosen in Welcome for the first project), holds several chats with Claude Code at once, shows no Plan, Board or BMad notice, has nothing written under `_bmad/`, and its sessions carry no BMad skill or text (E10-R3, E10-R4).
2. A project's BMad pieces are chosen in Workspace settings with the dependency rule applied, persist across a server restart, reach another open tab through `workspace.settings_changed`, and a guarded use-case for a piece that is off is refused with `feature_off` (E10-R1, E10-R2, E10-R6).
3. Adding a repo that already has `_bmad/` shows the offer, and turning its pieces on and then off leaves every file in the repo byte-for-byte unchanged (E10-R5).
4. A data folder from 0.2.0 upgrades with its projects, chats, caution levels and rules intact, every project Simple, and its old events replaying (E10-R7).
5. In a simple project the Developer-mode terminal toggle works as in epic 3 (E10-R8).
6. The epic's end-to-end suite passes on macOS, Windows and Linux, and it is released in its own `ogden-agents` npm version after epic 3's (assumed 0.4.0, confirmed at 10.9); the 0.2.0 release is unchanged.

## Boundaries

The switch, its contract, its settings UI, detection and migration. It installs nothing: setting up BMad in a project (CAP-2's install), the catalog, Plan, the board, builds and retrospectives are epics 4 to 7, which consume the contract. The sidebar, chats, agents and the terminal toggle are not changed, only kept working in simple projects. No per-chat or per-session BMad choice; the unit is the project. Terminal toggle gating (Developer mode only) and release 0.2.0 are untouched (user, 2026-10-01).

## References

- parent — _bmad-output/initiative-ogden-agents/initiative-ogden-agents.md
- spec — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, sections Why, Capabilities (CAP-2, CAP-3, CAP-5, CAP-6, CAP-7, CAP-17, CAP-18, CAP-19), Constraints, Success signal
- bmad integration — _bmad-output/initiative-ogden-agents/spec-ogden-agents/bmad-integration.md, Files Ogden Agents reads, Skills surfaced in the UI
- architecture — _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md, AD-1, AD-2, AD-5, AD-11, AD-12, AD-14, AD-18, AD-21, AD-22, Consistency Conventions (Errors, Config and data), Capability map
- ux — _bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md, Foundation, Information Architecture (Welcome, Workspace settings), Voice and Tone, State Patterns ("Workspace without BMad Method"), Key Flows (Flow 1 step 4, Flow 2)
- ux — _bmad-output/initiative-ogden-agents/ux-ogden-agents/DESIGN.md, Components
- epic — _bmad-output/initiative-ogden-agents/epic-planning-and-board/epic-planning-and-board.md (the first consumer; edits applied 2026-10-01)
- code — packages/core/src/db/schema.ts (`workspaces`), packages/core/drizzle/ (migrations; 0003_caution_level.sql is the pattern), packages/shared/src/chat.ts (`WorkspaceSettings`, `UpdateWorkspaceSettingsRequest`), packages/shared/src/events.ts (`workspace.settings_changed`), packages/shared/src/api.ts (`API_ROUTES.workspaceSettings`), packages/server/src/workspace-routes.ts, packages/core/src/onboarding.ts (install-level preference file pattern), packages/web/src/routes/workspace-settings-page.tsx, packages/web/src/workspaces/add-project-dialog.tsx, packages/web/src/workspaces/workspace-settings-api.ts, packages/web/src/routes/welcome-page.tsx, packages/web/src/routes/tools-page.tsx, packages/web/src/shell/workspace-header.tsx, packages/web/src/shell/status-sidebar.tsx, tests/architecture.test.ts

## Notes

- Decision (2026-10-01, user): keep the herdr-like UI for everyone: the multi-workspace sidebar, several agents and several chats per project stay always on. BMad becomes optional per project, with a choice of each piece.
- Decision (2026-10-01, user): new users start simple (BMad off) and opt in to more.
- Decision (2026-10-01, user): this is a new epic after epic 3 and before epic 4 in build order.
- Decision (2026-10-01, user): the terminal toggle stays governed by Developer mode only, not by this switch.
- Decision (2026-10-01, user): release 0.2.0 is unchanged; this epic ships in a later version.
- Decision (2026-10-01, inception, autonomous draft, approved by the user 2026-10-01): epic id 10 (the next unused id), slug `epic-bmad-optional-per-project`, placed between epics 3 and 4 in the initiative's `tickets.toml`.
- Decision (2026-10-01, inception, autonomous draft, approved by the user 2026-10-01): the tracer bullet is entry 1, one piece flag stored on a workspace, changed from a bare switch in Workspace settings through core, REST and `workspace.settings_changed`, with the core guard refusing a test-only guarded route while it is off. Entry 2 then freezes the whole contract (pieces, dependency rule, guard, route helper, `available` registry, `feature_off`, app default, detection, the event's back-compatible payload) so epic 4 can depend on 10.2 alone and the lanes open at once.
- Decision (2026-10-01, inception, autonomous draft, approved by the user 2026-10-01): lanes after entry 2 are detection and the offer (3), the app-wide default with Settings and Welcome (4), the Workspace settings section (5), and simple-project guarantees with the header tab slots and the guard-coverage test (6); they touch separate files (3 the `bmad-catalog` adapter and the chats page, 4 preferences, Settings and Welcome, 5 the Workspace settings page, 6 the workspace header, the Tools page and tests). Migration (7) waits on 3 and 4 because it seeds the offer and the default. A refactor sweep (8) and an end-to-end suite with release (9) close the epic. The least certain piece, what "no BMad text in sessions" means once Claude Code itself loads a repo's `.claude/skills`, sits in entry 6.
- Decision (2026-10-01, user): epic 10 approved as drafted: four pieces (Planning, Board, Unattended builds, Retrospectives), new projects start Simple, stories 10.1 to 10.9. CAP-19 and its constraint, the CAP-2, CAP-6, CAP-7, CAP-8, CAP-13, CAP-14 and CAP-18 "only where its piece is on" amendments, the Why and Success signal lines, AD-22, and the dated notes on AD-2, AD-12, AD-21, Consistency Conventions, the capability map and the UX docs are applied. `covers` is now [CAP-19, CAP-17] (CAP-2's install stays epic 4's).
- Decision (2026-10-01, user): a simple project leaves the repo's own `.claude/skills` alone. Ogden adds nothing BMad and never hides or rewrites the user's files. Entry 6.
- Decision (2026-10-01, user): Welcome asks once, for the first project, "Simple chats or BMad Method?" (overrides the draft, which said nothing). Entry 4.
- Decision (2026-10-01, user): the BMad Method section in Workspace settings shows all four pieces now; pieces this install does not ship yet are greyed and marked "Coming soon". Entries 2 and 5.
- Decision (2026-10-01, user): epic 4's entry edits below are applied (4.1, 4.2, 4.3, 4.6, 4.8, 4.9, 4.11, 4.13), and epic 4 now waits on 10.2.
- Decision (2026-10-02, user, epic 7 approval): the Retrospectives piece needs Board, not Unattended builds, so a project that builds by hand can look back. Story 7.2 changes `BMAD_PIECE_INFO.retrospectives.needs` and 10.2's dependency table test; this epic's shipped code is not reopened.
- From the epic 9/3 retros (2026-10-01, user approved: apply all proposed ticket changes): 10.2 adds that every shared shape, including user-facing reasons and close codes, lives in `shared`, that it is a reviewed story with `lenses_ran` recorded, and that it owns the epic's fakes, which behave like the real program (epic 3 retro A2, A9, L1, L3). 10.8 adds the provenance check, any remaining `OGDEN_AGENTS_TEST_*` switch behind `testHooksAllowed`, and splitting files the epic grew past 600 lines (epic 3 retro A5; epic 9 retro A5, A6). 10.9 adds to `verify` that each live check's result is written into the plan before `done`, and takes 3.10 F7 (own-server specs kill their agent and CLI children on failure) because it runs before 4.13 (epic 9 retro A3; epic 3 retro A10). 10.1 is already built, stacked on #49: its change is a note only, that it rebases onto `main` once the user merges the stack through epic 3, with no change to its code, so nothing moved to 10.2 as a follow-up. In `tickets.toml` as description, `verify` and `notes` edits.
- Decision (2026-10-01, orchestrator, accepted as defaults from 10.7; recorded by 10.8): an "existing user" is a data folder with projects, so a 0.2.0 install with no projects is asked Welcome's first-project question once. `@types/better-sqlite3` as a root devDependency is fine.

### Spec deltas (approved by the user 2026-10-01; applied through `bmad-spec`'s memlog and the kernel)

- New **CAP-19**
  - **intent:** Each project chooses whether to use BMad Method and which of its pieces (planning, board, unattended builds, retrospectives). A project without it is a plain multi-agent, multi-chat workspace over the user's agent. New projects start without it unless the user changes the default.
  - **success:** A new project holds chats with two agents in two chats with nothing written under `_bmad/` and no Plan or Board shown; turning on Planning in its settings sets BMad up and shows Plan, and turning BMad off hides Plan again and leaves every file in the repo.
- Amend **CAP-2** intent: "A user who turns on BMad Method for a project sets it up there from the UI; a repo that already has it is detected and offered, never changed."
- Amend **CAP-6, CAP-7, CAP-8, CAP-13, CAP-14, CAP-18**: each applies "in a project with that piece turned on" (CAP-6 and CAP-18: Planning; CAP-7: Board; CAP-8, CAP-9, CAP-10, CAP-12, CAP-14: Unattended builds; CAP-13: Retrospectives).
- New **Constraint**: "BMad Method is optional per project. Ogden Agents writes nothing BMad into a repo, and adds no BMad skill or prompt to a session, unless that project turned a BMad piece on. Turning it off never deletes files."
- Amend **Why** last sentences: "…the whole of BMAD (reused as much as possible) supplies the process for projects that want it, and a modern browser UI makes it manageable by anyone…"
- Amend **Success signal**: add "A user who only wants chats runs several agents in several projects and never sees BMad."
- bmad-integration.md, Files Ogden Agents reads: prefix "For a project with the matching piece on:".

### Architecture delta (approved by the user 2026-10-01; applied to the spine and its memlog)

- New **AD-22 — BMad Method is opt-in per workspace**
  - **Binds:** CAP-2, CAP-6, CAP-7, CAP-8, CAP-9, CAP-10, CAP-12, CAP-13, CAP-14, CAP-18, CAP-19
  - **Prevents:** each epic inventing its own on/off check, BMad work (scans, watchers, installs, injected skills) leaking into projects that did not choose it, and a guard that lives only in prompts or the UI.
  - **Rule:**
    - A workspace holds a set of BMad pieces (`planning`, `board`, `builds`, `retrospectives`), stored by core on the workspace row (AD-11) and changed only through a core use-case that emits `workspace.settings_changed`. The piece list, labels and dependency rule live in `packages/shared`.
    - Every core use-case that serves a piece calls one guard, which refuses with `feature_off`. Every route serving a piece is registered through one helper that applies the guard, and a test fails otherwise. The UI hides what is off but is never the guard.
    - Adapters for a piece do no work for a workspace with it off: no catalog scan, no ticket watcher, no dispatch, no retrospective. With every piece off, Ogden Agents writes nothing BMad into the repo and adds no BMad skill or text to the workspace's sessions.
    - Turning a piece off never deletes or edits repo files. Detecting an existing `_bmad/` is read-only, through `BmadCatalogPort`.
    - The default pieces for new projects are an install-level preference kept by core in the data directory; it starts empty (Simple).
    - The install reports which pieces it ships; a piece is turned on only when available, and one not yet shipped shows greyed as coming soon. AD-22 (the user's choice) and AD-14 (the project's installed capabilities) both gate a surface: it shows only when its piece is on, and then shows the reduced-mode notice if a capability is missing.
    - Developer mode and the terminal toggle (AD-6) are independent of the pieces.
- AD-2 dated note: "A workspace also carries its BMad pieces (AD-22)."
- AD-12 dated note: "The catalog is built only for workspaces with Planning on (AD-22)." AD-1's port list is unchanged (`BmadCatalogPort` exists; epic 10 adds its read-only `detect`).
- AD-21 dated note: "A project with BMad off needs no uv; turning a piece on that needs BMad installed runs setup through the server (epic 4)."
- Consistency Conventions, Config and data: "Nothing is written to user repos except BMAD's own files (only in projects that turned a BMad piece on) and worktrees."
- Capability map: add "CAP-19 BMad optional per project | core workspace settings, `bmad-catalog` detect, shared piece list | AD-2, AD-11, AD-22".
- UX deltas (approved 2026-10-01; applied to EXPERIENCE.md as dated notes, with Flow 1 step 4 carrying Welcome's question instead of turning Planning on in settings): EXPERIENCE.md Information Architecture "Workspace settings" adds "BMad Method pieces"; Settings gains "New projects" (the app-wide default); State Patterns "Workspace without BMad Method" becomes "Plan and Board tabs are absent; Workspace settings offers the pieces"; Key Flows Flow 1 step 4 becomes "…adds a project; it opens as chats. She turns on Planning in the project's settings, which sets up BMad Method with a progress list."; Foundation adds "Projects start simple; BMad is opt-in per project."

### Edits to epic 4 (approved by the user 2026-10-01; applied)

- Initiative `tickets.toml`, epic 4 `after`: add `{ epic = 10, needs = "the per-project BMad pieces contract, guard, route helper and BmadCatalogPort.detect (10.2)" }`. Epics 5 and 7 gain the same at their inception (they guard `builds` and `retrospectives`); epic 6's builds use the `builds` guard.
- Envelope Description and E4-R2: Plan and Board appear only in a project with Planning or Board on; "Set up BMad Method in this project" runs when the user turns on the first piece in a project without `_bmad/` (from 10.5's section), not from a panel shown in every project. "Chats keep working without BMAD" stays.
- E4-R3: the catalog is scanned only for workspaces with Planning on; `BmadCatalogPort` already exists from 10.2 with `detect`, and epic 4 extends it.
- E4-R5: the Plan tab and `g p` exist only with Planning on; Board and `g b` only with Board on; they fill 10.6's tab slots.
- E4-R7: the ticket watcher runs only for workspaces with Board on, started and stopped on `workspace.settings_changed`.
- E4-R9 and E4-R10: guarded by `board` and the relevant piece; reduced mode applies only to pieces that are on.
- Done when 1: "…from the UI after the user turns on a BMad piece…"; add a check: "With every piece off, a project shows no Plan or Board and has nothing written under `_bmad/`."
- Entry 4.1: `after` gains "10.2"; the tracer's scratch repo has Planning and Board on.
- Entry 4.2: extends 10.2's `BmadCatalogPort` and shared shapes rather than creating them; registers `planning` and `board` as available; its routes use 10.2's helper; `feature_off` is 10.2's code and drops from 4.2's list.
- Entry 4.3: setup is started from turning on a piece (10.5's section) and also shown when a piece is on but `_bmad/` is missing; the Set up panel sits only on Plan and Board when they are on.
- Entries 4.6 and 4.9: render in 10.6's tab slots; no Set up panel in a project with the piece off.
- Entry 4.8: the watcher starts and stops with the `board` piece.
- Entry 4.11: reduced mode gates only pieces that are on.
- Entry 4.13: the suite adds a project with BMad off that shows no Plan or Board and gets no `_bmad/`.

### Assumptions and open questions

- Assumption: the pieces are `planning`, `board`, `builds`, `retrospectives`, and project setup (CAP-2's install) is not a piece of its own: turning on any piece in a repo without `_bmad/` runs setup. Entries 2 and 5.
- Assumption: `builds` needs `board` (dispatch reads the ticket tree and the Build action sits on the board) and `retrospectives` needs `builds` (a retrospective reads finished runs' build records); `planning` and `board` are independent. Entry 2 freezes it.
- Assumption: the "Use BMad Method in this project" switch, when turned on, preselects Planning and Board; it is derived from the pieces, not stored.
- Assumption: the e2e suite registers a test-only available piece, since every real piece shows as coming soon until epic 4 ships.
- Assumption: picking BMad Method in Welcome turns on Planning and Board for the first project (the same preselection as the switch); until a piece is available, the BMad Method choice is greyed and marked "Coming soon", like the settings section. Entry 4.
- Assumption: 10.9 tags its own release after epic 3's, likely 0.4.0; confirmed by the user at 10.9 (hitl).
- Assumption: the app-wide default lives in a new `<dataDir>/preferences.json` kept by core like `onboarding.json`, not in SQLite.
- Assumption: detection checks only that `_bmad/` (and `_bmad-output/`) exist; reading the BMad config is epic 4's.
- Assumption: "no BMad text in sessions" means Ogden adds none. Claude Code still loads skills a repo already has in `.claude/skills` on its own; Ogden does not hide them. Entry 6 records what Claude Code does in a simple project with an existing BMad repo, and Ogden does not hide them (user, 2026-10-01).
- Open question: When a repo already has `_bmad/`, should the offer preselect the pieces whose files it has (for example Board when `tickets.toml` exists), or always Planning and Board? Entry 3.
- Waits on epic 2 because: workspace settings, the caution-level pattern and `workspace.settings_changed` (2.5, 2.8), and the add-project dialog.
- Waits on epic 9 because: Welcome's project step (9.5), which applies the default.
- Waits on epic 3 because: its refactor sweep (3.9) may touch the same workspace and settings code, and its suite and release (3.10) come first; nothing of the terminal is changed.
