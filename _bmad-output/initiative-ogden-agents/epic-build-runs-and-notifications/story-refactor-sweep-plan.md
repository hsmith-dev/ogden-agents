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

- 2026-10-05, pass 1 (one reviewer ran the security and the correctness pass over this small diff): high 0, medium 0, low 2. Routed: reject 2. No intent_gap or bad_plan.
  - A keychain write that hangs would hold up later adds, and the add lock covers one `Notifications` instance -- low, reject: the keyring adapter times out and the server makes one instance.
  - The loosened deadline assertion could flake if the lookup stalled over a second -- low, reject: the fake resolver answers at once.
  - The moves change no behavior, the serialisation cannot deadlock or lose an error, and no URL leaks -- none found.

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `pnpm test` -- all pass
