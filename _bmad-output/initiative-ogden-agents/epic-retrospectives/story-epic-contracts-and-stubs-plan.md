---
title: 'Epic contracts and stubs'
type: 'feature'
ticket: '2'
created: '2026-10-05'
status: 'built'
baseline_revision: '8b96c49870310adc6271605eb30de4d1d00a9ab2'
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

**Problem:** Entries 3 to 5 of epic 7 need one set of shapes, routes, codes, fakes and a fixture before they can be built without colliding.

**Approach:** Freeze in shared the retrospective on an epic row, the build summary, the finished-epic offer, the next-step and Save the lessons shapes and codes, the catalog's epic scope and further next steps and two events; keep the offer's Not now in core; pre-register every route through `bmadPieceRoutes` (trust included); change the rule to Retrospectives needs Board; own the fixture repo and the fake agent's retrospective and AGENTS.md writes.

## Boundaries & Constraints

**Always:** Every use-case calls `requireBmadFeature(workspaceId, 'retrospectives')` first; every route is registered through `bmadPieceRoutes` with the trust; user-facing copy has no dashes and every shape lives in shared; the fake agent and fixture behave as the real program writes.

**Never:** No verdict read, build-summary reader, finished-epic UI, label mapping change, step start or commit (entries 3 to 5); no new fork; no transcript field in a summary.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Not now | Retrospectives on, a plain epic name | One event the first time, stored per project and epic, 204 | Repeat changes nothing |
| Piece off | Any new route, Retrospectives off | 409 feature_off before the body is read | |
| Untrusted | Any new route, on, no trust | 409 scripts_not_trusted | |
| Bad epic or body | Malformed epic or step body | 400 | Nothing stored |
| Not yet served | Step start, Save the lessons | 501 not_implemented after the guards | |
| Rule | Retrospectives with Board only | Allowed; without Board refused | Unchanged errors |

</frozen-after-approval>

## Code Map

- `packages/shared/src/retrospectives.ts`, `planning-board.ts`, `planning-catalog.ts`, `events-planning.ts`, `events.ts`, `errors.ts`, `api.ts`, `bmad.ts` -- contract.
- `packages/core/src/look-back-offers.ts`, `retrospectives.ts`, `errors.ts`, `core.ts`, `db/schema.ts`, `drizzle/0021_look_back_offers.sql` -- Not now and the use-case surface.
- `packages/server/src/retrospective-routes.ts`, `start-types.ts`, `start.ts` -- routes, `shippedBmadPieces` test option.
- `tests/fixtures/retrospective-repo.ts`, `fake-acp-agent.mjs` -- fixture and fake writes.

## Tasks & Acceptance

**Execution:**
- [x] shared contract, copy, codes, events, route constants
- [x] core Not now with migration and event; use-case surface (step and save not yet served)
- [x] routes behind guard and trust; dependency rule to Board; memory ticket store carries epics
- [x] fixture repo, fake agent writes, tests across shared, core, adapters, server, DOM, e2e

**Acceptance Criteria:**
- Given the contract, then every new shape parses, defaults keep 4.2 fixtures parsing, and the registry and guard-coverage tests list each new route behind the guard and trust.
- Given Retrospectives with Board only, then it turns on; without Board it is refused.
- Given the fixture repo, then the fake agent writes the retrospective (a card with Planning off) and the lessons, leaving exactly those two paths changed.

## Implementation Notes

- **Migration:** `0021_look_back_offers.sql` (one column on workspaces). Epic 11's notifications branch also numbers 0021; whichever merges second renumbers with drizzle-kit (noted for the merge).
- `VcsPort.commitPaths` already exists from 5.5 (so nothing added); the verdict read is the `retrospective` field on `TicketEpic`, filled by `tickets-v7` in 7.4 (`tickets.py` does not report it); the build-summary reader is entry 4's, over run records; no memory stub is needed for it.
- The unfinished-epic offer state is derived from the ticket index in the web (entry 4); only the dismissal is stored.
- `shippedBmadPieces` start option lets tests and specs start an install that ships fewer pieces (Retrospectives now ships).
- Answers the plan's unknowns: the dismissal is kept by epic folder name, so a renamed epic shows its offer again (accepted); Save the lessons' missing AGENTS.md message is `agents_file_missing` (git-ignored counts the same).

## Plan Change Log

## Review Triage Log

- 2026-10-05, pass 1 (security and correctness lenses): high 0, medium 3, low 8. Routed: patch 8, defer 1, reject 2. No intent_gap or bad_plan.
  - A malformed epic on the step and save routes answered 501, not 400 -- medium, patch: both stubs validate the epic (and the skill) after the guard; route test.
  - Shared paths (retrospective path, saved paths) were unconstrained strings that reach an agent argument and a commit -- medium, patch: \`RepoRelativePath\`; the date and the summary's ticket ref got patterns.
  - A skill that is not a next step would answer the epic's 404 text -- medium, patch: its own shared message.
  - \`tests/e2e-installed\` still assumed Retrospectives is coming soon (CI failure on PR 158) -- medium, patch (also applied to 7.1's branch).
  - Undeclared \`zod\` type import in an adapter -- low, patch: \`CatalogSkillInput\` exported from shared.
  - Over-long stored dismissal list would 500 the offers route -- low, patch: the parse keeps the newest 1000.
  - Dashes test covered four strings; a test asserted the fixture helper; stale comments; fixture header said baselines were the first commit -- low, patch.
  - A summary's \`blockedReason\` is agent-authored text that will reach a first message -- low, defer to 7.4, which builds the message (plain text, bounded, one line each).
  - Re-dismissing an evicted epic after 1000 others appends another event -- low, reject: local and authenticated, the row stays bounded.
  - Use-cases and routes of 7.4 and 7.5 share two files, and the build-summary port is not here -- low, reject: stories are built in order; the reader is entry 4's, over run records, no port needed.

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `pnpm test` -- all pass
- `pnpm e2e` -- touched specs pass
- `PROVENANCE_BASE=origin/main pnpm provenance` -- pass
