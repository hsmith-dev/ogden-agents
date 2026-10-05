---
title: 'Lessons and action items flow back'
type: 'feature'
ticket: '5'
created: '2026-10-05'
status: 'built'
baseline_revision: '45dc142cf68ef309e18dd40822223a0722376f74'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['security', 'correctness']
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

- 2026-10-05, pass 1 (security and correctness lenses): high 0, medium 6, low 6. Routed: patch 10, defer 0, reject 2 and one process slip fixed. No intent_gap or bad_plan.
  - A project inside another repository got a spurious nothing_to_save or a git error (status paths are the top level's) -- medium, patch: refused like builds are, with their message; test.
  - The retrospective's file name (repo-controlled) reached an agent message and a commit unchecked -- medium, patch: every path part must be one plain name, else the epic has no usable retrospective; test.
  - A deleted AGENTS.md or retrospective showed as "changed" and would be committed as a lesson -- medium, patch: only files on disk count, a missing AGENTS.md is agents_file_missing; test.
  - Git failures and the board's refusals answered 500 on the two new routes -- medium, patch: mapped (409 vcs_unavailable with git's plain message, 409 or 503 for the tickets); an epic with no retrospective yet has its own 404 message; test.
  - My rewrite of the 7.2 test dropped the 7.3 catalog tests from the same file -- medium (process), patch: restored.
  - The saved line was not announced to a screen reader and an unmessaged failure showed nothing -- low, patch: role status and a fallback line.
  - The "no AGENTS.md" message described git tracking the code does not check -- low, patch: reworded.
  - Epic 5's text said approve ignores only the output folder -- low, patch: dated note added there.
  - An AGENTS.md left unmerged by a stash conflict would be committed, and a live agent session can edit between status and add -- low, reject: the user clicked Save on what they see, only the two paths are committed, and no state of them is hidden from the user.
  - The card acts on the board's retrospective for the folder's epic, not on the file shown, if a stray older file exists -- low, reject: the server uses the board's one retrospective for that epic.

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `pnpm test` -- all pass
- `pnpm e2e` -- touched specs pass
- `PROVENANCE_BASE=origin/main pnpm provenance` -- pass
