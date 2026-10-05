---
title: 'Refactor sweep'
type: 'refactor'
ticket: '5'
created: '2026-10-05'
status: 'built'
baseline_revision: 'cf41e2ce96b7c85e866146d53dbc97932e07072f'
route: 'oneshot'
route_source: 'pinned'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['security', 'correctness']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/deferred-work.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 11 grew `packages/server/src/start.ts` and `packages/adapters/src/vcs-git/index.ts` past 600 lines, and its reviews deferred a few small things.

**Approach:** Split the notification wiring out of `start.ts` and the saved fix's header reading out of `vcs-git/index.ts`; take the deferred items that are a few lines (two webhook adds at once cannot pass the cap; a run panel's refusal clears once the run moves on); no other behavior change; run the provenance check.

## Boundaries & Constraints

**Always:** No behavior change except those two. Every file the epic touched is at most 600 lines or was longer before. **Never:** No new feature, no change to a frozen shape.

</frozen-after-approval>

## Implementation Notes

- 2026-10-05 (build): `start-notifications.ts` and `vcs-git/patch.ts` are new; `session-page.tsx` (732 lines, over 600 before the epic and two lines longer after it) is left for its own split. The other deferred items of epic 11 stay open (see the Open items): each needs a design or a shared shape, not a sweep.

## Review Triage Log

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `pnpm test` -- all pass
