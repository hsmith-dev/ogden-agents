---
title: 'Refactor sweep'
type: 'refactor'
ticket: '6'
created: '2026-10-05'
status: 'built'
baseline_revision: '982a45723a6d953d54081b8fa060534583ef356c'
route: 'oneshot'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-retrospectives/epic-retrospectives.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

Clean up the code the epic grew, with no behavior change: split any file the epic grew past 600 lines and run the provenance check.

</frozen-after-approval>

## Implementation Notes

- `packages/shared/src/events.ts` was 615 lines before the epic and 625 after its two events: its WebSocket protocol messages (pong, caught up, history page, subscribe and the rest, 190 lines) moved to `events-socket.ts`, exported from the package index under the same names, leaving `events.ts` at 444 lines. No importer changed (only the two shared files that read agent vocabulary import `events.js`, and they use none of the moved names).
- Every other source file the epic touched is under 600 lines (the largest, `start.ts`, is 598 and was 597). Test files are not counted.
- Provenance: `PROVENANCE_BASE=origin/main pnpm provenance` passes. Review of the deferred items logged during the epic: the one open item (a look-back's epic folder may not exist for a nested initiative) changes behavior, so it stays in deferred-work.
- Review (quick): the move is a cut and paste of a self-contained block; typecheck and every test pass unchanged.

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `pnpm test` -- all pass
- `PROVENANCE_BASE=origin/main pnpm provenance` -- pass
