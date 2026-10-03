# BMAD integration contract

Targets BMAD method v7 (the modules installed here report version 6.13.0-next).

## Files Ogden Agents reads

For a project with the matching piece on (CAP-19): Ogden Agents reads none of these in a project with every BMad piece off.

| Item | Where | Used for |
|---|---|---|
| Ticket tree | `{output_folder}/{active_initiative}/…/tickets.toml` (epic entries: id, prerequisites, verification) | Board, prerequisite ordering (CAP-7, CAP-8) |
| Plan status | `*-plan.md` frontmatter beside `tickets.toml`, or in `backlog/` | Board status, resume point |
| Blocked detail | Plan frontmatter `blocked_at`, `blocked_reason`, and the `Auto Run Result` section | CAP-9 reason display |
| Run outcome | Plan `status`, `followup_review_recommended`, `deferred`, `Auto Run Result`; `bmad-build-auto-result-*.md` for runs that are not tickets | CAP-9, CAP-12 |
| Retrospective | `epic-<slug>-retrospective.md` in the epic folder | CAP-13 |
| Pitfalls | Project `AGENTS.md` block (`bmad-project-context`) | CAP-13 |

## Plan statuses and resume behavior

`draft` → plans; `ready-for-dev` / `in-progress` → implements; `in-review` → reviews; `built` / `done` → fresh follow-up review; `blocked` → halts immediately.

## Writes

Every status change goes through `tickets.py mark <ref> <status>`. Marking with a resume status clears the blocked fields. Only a human approval sets `done`.

## Reuse first

- Dispatch: Ogden Agents chooses each ticket and runs `bmad-build-auto` for that one ticket in an Ogden-managed headless ACP session in the run's worktree (user decision 2026-10-02, after spike 5.1 found bmad-loop 0.13.0 needs a user-installed multiplexer and reads no v7 ticket). bmad-loop is not used in v1; it stays an option for agents without ACP (v2).
- Ticket writes: `tickets.py`.
- Installing into a project: BMAD's `bmad` setup scripts, run from the UI wizard.
- All of these run through `uv`, which Ogden Agents installs if it is missing.

## build-auto preconditions the dispatcher must satisfy

- Name exactly one ticket per invocation. The skill never picks work itself.
- Provide a clean working tree on a branch that fits the ticket's epic, which is why each ticket gets its own worktree.
- Make subagents available.
- Treat halts (`unclear intent`, `intent gap`, `no subagents`, `ticket not resolved`, `implementation verification failed`, `review repair loop exceeded 5 iterations`, `blocked plan supplied`, a dirty tree or mismatched branch) as blocked, with the reason shown.
- On an `intent gap` halt, a patch is saved beside the plan. The UI should offer to apply it (`git apply`, set `in-review`, redispatch).
- The run commits locally and never pushes. Merging is Ogden Agents's approve action.

## Fork extensions

- `tickets.py … --json` for machine-readable output.
- A per-run JSON result file for each build (Ogden's own since 2026-10-02, written in the run's folder in the data folder, epic 5 entry 4).
- A setup wizard in the UI that replaces running `bmad` setup in a terminal.
- Running one named v7 ticket headless in a given worktree, with its run folder outside the repo and a machine-readable event stream: Ogden's headless ACP build session since 2026-10-02 (epic 5 entry 4); the bmad-loop patches for it are a v2 or upstream note in epic 5.
- Plain-language labels and descriptions per skill ("Describe your idea", "Build next story").
- Pause hooks for UI approval via `plan_checkpoint` and `done_checkpoint` in `tickets.toml` (Ogden's build session pauses and resumes, epic 5 entry 4).

All of these are carried in the forks of BMAD-METHOD and bmad-loop and opened as upstream PRs. A patch is dropped once upstream accepts it.

## Skills surfaced in the UI

Every installed skill and module is surfaced through a catalog discovered from installed metadata (architecture AD-12, CAP-18). The groups below are defaults for the UI layout, not a limit.

- **Planning:** `bmad-product-brief`, `bmad-prd`, `bmad-ux`, `bmad-architecture`, `bmad-spec`, `bmad-ticket`.
- **Building:** `bmad-build` (interactive), `bmad-build-auto` (unattended).
- **Validation:** `bmad-code-review`, `bmad-retrospective`, `bmad-project-context`.
- **Analysis and ideation:** `bmad-prfaq`, `bmad-brainstorming`, `bmad-forge-idea`, `bmad-deep-recon`, `bmad-advanced-elicitation`.
- **Agents and groups:** the `bmad-agent-*` personas and `bmad-party-mode`.
- **Course and setup:** `bmad-correct-course`, `bmad-customize`, `bmad`.
