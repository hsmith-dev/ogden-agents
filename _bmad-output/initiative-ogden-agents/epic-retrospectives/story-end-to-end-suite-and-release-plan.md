---
title: 'End-to-end suite and release'
type: 'chore'
ticket: '7'
created: '2026-10-05'
status: 'in-review'
baseline_revision: 'bfab2e8a1c0bb3dfc3df2eeb1025a37423c786d2'
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

**Problem:** Epic 7 is built and tested in pieces; nothing runs the whole journey against the packed package, and the live checks with the real retrospective skill are not written down for the user.

**Approach:** An installed-package journey (run in CI on macOS, Windows and Linux through the installed suite) for the whole epic against the fake agent, the changelog entry, and RELEASING's live checks. The live checks, the version number and the tag are the user's.

## Boundaries & Constraints

**Always:** Fakes only (the fake agent, the fixture BMad Method source, a fixture git repo); no real agent, account, network or keychain; the live checks are written for the user and not run.

**Never:** No tag, no npm publish, no version change, no repo setting.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Journey | The installed package, a Simple project, a finished epic, a plain upstream repo | Every step of the epic's Done when that a fake can show passes | A step that fails fails the suite |
| Off | Simple project, Retrospectives off | Nothing shown, routes refuse, nothing written | |
| Live | Real Claude Code on a real epic | Written steps in RELEASING.md | The user runs them |

</frozen-after-approval>

## Code Map

- `tests/e2e-installed/retrospectives-journey.spec.ts`, `playwright.config.ts`, `installed.ts` -- the journey and its fixture skills.
- `CHANGELOG.md`, `RELEASING.md` -- the entry and the live checks.

## Tasks & Acceptance

**Execution:**
- [x] the installed journey: Simple project, set up, finished epic offer and Not now, look-back, card and chip, lessons, action item as a ticket the agent writes, Save the lessons (one commit, the next worktree carries it, a repeat has nothing to save), Retrospectives off, plain upstream in reduced mode, Quit
- [x] CHANGELOG entry; RELEASING live checks for the user
- [ ] the user's live checks, the version and the tag (hitl)

**Acceptance Criteria:**
- Given the packed package, then the journey passes on a machine with uv and its Python (CI provisions both on all three OSes).
- Given the live checks, then each Done-when item that needs the real skill has a written step.

## Implementation Notes

- Run locally on macOS: `pnpm run pack && pnpm e2e:installed retrospectives-journey` (the suite also runs every journey before it).
- The journey adds two test-only skill files (the retrospective and the project context) to the fixture BMad Method tarball so the real catalog verifies them and gives the look-back its epic scope; no other journey counts skills.
- The off and guard checks are proved in unit and route tests (the route's guard and the use-case's own); the journey shows them in the installed package.
- Nothing here changes the version (0.5.0-rc.1) or tags.
- **Live check result:** pending, the user's (RELEASING.md, "Retrospectives live checks (epic 7)").

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `pnpm test` -- all pass
- `pnpm run pack && pnpm e2e:installed` -- passes
- `PROVENANCE_BASE=origin/main pnpm provenance` -- pass
