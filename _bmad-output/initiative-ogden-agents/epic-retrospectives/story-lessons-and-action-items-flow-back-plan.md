---
title: 'Lessons and action items flow back'
type: 'feature'
ticket: '5'
created: '2026-10-05'
status: 'in-review'
baseline_revision: '45dc142cf68ef309e18dd40822223a0722376f74'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-retrospectives/epic-retrospectives.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A finished look-back ends in a file; its lessons never reach a later build, and its action items never reach the board.

**Approach:** The retrospective's document card offers the look-back action's further next steps (the lessons into AGENTS.md, the action items into tickets), each an agent conversation the user approves, then **Save the lessons for later builds**, which commits exactly AGENTS.md and the retrospective locally so every later build's worktree carries them.

## Boundaries & Constraints

**Always:** Every use-case calls `requireBmadFeature(workspaceId, 'retrospectives')` first and runs behind the trust; only a step the catalog's look-back action names starts; the commit is exactly the two paths that have a change, local, never pushed, serialized with the repo's other git work; the agent edits AGENTS.md and tickets, Ogden writes neither; copy has no dashes.

**Never:** No push, no other path, no ticket written by Ogden, no change of approve's other checks; no automatic save.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Step | A skill the look-back action names, an epic with a retrospective | 201 planning session on the retrospective file | 404 for a skill not offered or an epic with none |
| Save | Both or either of AGENTS.md and the retrospective changed | One local commit of exactly those | |
| Nothing | Neither changed | 409 `nothing_to_save` | Nothing committed |
| Busy | Merge, rebase, cherry-pick or revert in progress | 409 `checkout_busy` | Nothing committed |
| No file | No AGENTS.md on disk and none changed | 409 `agents_file_missing` | |
| No git | No repo, branch or commit | 409 `vcs_unavailable` | |
| Approve | An uncommitted root AGENTS.md | Not a reason to refuse | Another AGENTS.md still is |
| Off | Retrospectives off | 409 `feature_off` first | |

</frozen-after-approval>

## Code Map

- `packages/core/src/retrospectives.ts`, `build-context.ts`, `build-names.ts` -- `startStep`, `saveLessons`, approve tolerance.
- `packages/server/src/retrospective-routes.ts`, `start-builds.ts`, `start-planning.ts`, `start.ts` -- error mapping, one shared git.
- `packages/web/src/planning/retrospective-actions.tsx`, `document-card.tsx`, `planning-api.ts` -- the card's steps and Save.

## Tasks & Acceptance

**Execution:**
- [x] `startStep` from the catalog's next steps; `saveLessons` through `VcsPort.commitPaths`
- [x] approve tolerates the root AGENTS.md (dated AD-17 note)
- [x] routes' refusals; one git for builds and the lessons
- [x] the card: next steps, Save with its line, refusals in plain words
- [x] tests on a real git repo with the fake agent, DOM, one e2e

**Acceptance Criteria:**
- Given a retrospective with a pitfall written into AGENTS.md, when Save the lessons is clicked, then one local commit holds only those two paths, other changes stay, and a worktree made after it carries the pitfall.
- Given a repeat, then nothing_to_save; given a merge in progress, then checkout_busy.
- Given Retrospectives off, then the routes refuse with feature_off and nothing is committed.

## Implementation Notes

- `commitPaths` (5.5) uses `--only` with literal pathspecs, so other staged changes stay staged; an untracked retrospective is added by it.
- `agents_file_missing` is "no AGENTS.md on disk and none changed"; a git-ignored AGENTS.md reads as unchanged, so it falls under nothing_to_save when present (answers the plan's unknown).
- Save always shows on a retrospective card with Retrospectives on (the epic text shows it after the first step; the user may have added lessons in another session).
- The catalog nexts come from Ogden's mapping (7.3); this story adds no skill name anywhere.

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `pnpm test` -- all pass
- `pnpm e2e` -- touched specs pass
- `PROVENANCE_BASE=origin/main pnpm provenance` -- pass
