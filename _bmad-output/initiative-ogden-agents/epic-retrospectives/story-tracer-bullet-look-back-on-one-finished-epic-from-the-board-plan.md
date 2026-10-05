---
title: 'Tracer bullet: look back on one finished epic from the board'
type: 'feature'
ticket: '1'
created: '2026-10-05'
status: 'in-review'
baseline_revision: 'd4c3f9d86ff5ca4cfe5ddd56ec7cdc496fdb8cc0'
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

**Problem:** A finished epic has no way to be looked back on from Ogden Agents: the user would have to start a terminal session and invoke BMad's retrospective skill by hand.

**Approach:** A bare **Look back on this epic** button on each epic header of the board, with Retrospectives on, starts a planning session through a core use-case guarded by `retrospectives` and the project's script trust, whose first message invokes the retrospective skill on the epic's folder (formatted by the agent adapter, AD-12). The skill writes `epic-<slug>-retrospective.md` itself, and epic 4's document card shows it. Entry 4 replaces the bare button with the designed action, offer and verdict.

## Boundaries & Constraints

**Always:** Core's `requireBmadFeature(workspaceId, 'retrospectives')` runs first, the route is registered through `bmadPieceRoutes` (trust included), the epic folder is built only from the board's tree plus the output folder as safe single names, and the first message is `AgentPort.skillInvocation(skill, folder)`. Core and web name no skill. Nothing is written by Ogden. A project with Retrospectives off is never read.

**Never:** No new session kind, no headless run, no automatic start, no verdict, offer or build summaries (entries 2 and 4), no change to the dependency rule (entry 2), no commit (entry 5).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | Retrospectives on, trusted, epic on the board, skill installed | 201 with a planning session whose first message is the invocation on `<output>/<initiative>/<epic>` | None |
| Piece off | Retrospectives off (Planning or Board on) | 409 `feature_off`, nothing read | Before the body is read |
| Not trusted | On, scripts not trusted | 409 `scripts_not_trusted`, nothing read | |
| Bad epic | Name fails the slug pattern | 400 `invalid_request` | Nothing created |
| Unknown epic | Not among the board's epics, or no output folder, or an unsafe folder name | 404 plain message | Nothing created |
| No skill | The catalog lacks the retrospective skill | 404 plain message | Nothing created |
| Raced off | Retrospectives turned off while the catalog is read | `feature_off` | Nothing created |

</frozen-after-approval>

## Code Map

- `packages/shared/src/retrospectives.ts`, `api.ts` -- slug pattern, copy, `workspaceEpicLookBack` route.
- `packages/core/src/retrospectives.ts` -- the use-case; `planning-documents.ts`, `planning.ts` -- document cards and the document read serve Planning or Retrospectives.
- `packages/server/src/retrospective-routes.ts`, `app.ts`, `start-planning.ts`, `start.ts`, `bmad-pieces.ts` -- the route, wiring, `retrospectives` shipped.
- `packages/adapters/src/bmad-catalog/skill-labels.ts` -- `LOOK_BACK_SKILL` (the one skill name, an adapter's data); `tickets-memory` -- epics.
- `packages/web/src/planning/board-look-back.tsx`, `board-epic.tsx`, `board-tickets.tsx`, `routes/workspace-board-page.tsx` -- the bare button.

## Tasks & Acceptance

**Execution:**
- [x] shared contract and copy -- slug pattern, labels, route
- [x] core use-case and the document guards (Planning or Retrospectives)
- [x] server route, wiring, shipped list; memory ticket store carries epics
- [x] web button on each epic header, only with Retrospectives on
- [x] tests: core, route (feature_off, trust, session, 400, 404), DOM, one e2e, guard coverage, shipped list

**Acceptance Criteria:**
- Given a project with Board and Retrospectives on and trusted, when Look back on this epic is clicked, then a planning session opens whose first message names the epic folder.
- Given Retrospectives off, then the button is absent and the route answers `feature_off` with nothing read.
- Given Retrospectives on and Planning off, then the retrospective's document card appears and its document opens.

## Implementation Notes

- The epic folder is `<output folder>/<tickets.py folder>/<epic slug>`: `tickets.py status` reports its `folder` as the initiative's folder name, not a path, so core joins it with the setup status's output folder and checks each part against the slug pattern and `RepoRelativePath`.
- Answers the plan's unknown: a planning-kind session's routes do not assume Planning; the document card detection and document read did (`requireBmadFeature('planning')`) and now accept Planning or Retrospectives. Chat and session routes have no piece guard. How the real skill behaves from an ACP first message (uv pre-pass, review subagents behind permission cards, one card or several) is the live check and is not run here.
- `retrospectives` joins `SHIPPED_BMAD_PIECES`; it still needs `builds` until entry 2 changes the rule to `board`. The bmad-contract test that asserted it was coming soon now asserts it ships; the stored-but-unavailable case it also covered cannot happen at server level and stays covered in core's `bmad-features` tests.
- **Live check result:** pending, the user's (a finished epic in a scratch repo with Claude Code). CI proves the session, its first message and the guards against the fake agent only.

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `pnpm test` -- all pass
- `pnpm e2e` -- touched specs pass
- `PROVENANCE_BASE=origin/main pnpm provenance` -- pass
