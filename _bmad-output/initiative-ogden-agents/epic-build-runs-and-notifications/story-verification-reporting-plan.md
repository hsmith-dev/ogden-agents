---
title: 'Verification reporting'
type: 'feature'
ticket: '2'
created: '2026-10-05'
status: 'built'
baseline_revision: '971970fd93cfee5156a64f976f198983cfcdef2d'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['security', 'correctness']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-build-runs-and-notifications/epic-build-runs-and-notifications.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-build-runs-and-notifications/story-live-run-view-and-the-runs-tab-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 5 verifies every run (plan built, tests re-run in the sandbox, a non-empty diff) and the review page lists the three checks, but the run view, the Runs tab, the board card and the detail sheet say nothing of a failed check, the test output is not shown anywhere, a fixed run cannot be checked again, and a project cannot set its own test command.

**Approach:** Show each check's detail and, behind Show details, the test command and the end of the output in the run view and the review page; name the failing check on the Runs tab row, the board card and the detail sheet; add **Check again** (a core use-case that re-runs 5.8's end checks on the run's worktree, no agent) with its route; add the project's test command to Workspace settings (5.3's override, which 5.8's re-run already uses).

## Boundaries & Constraints

**Always:** Check again is guarded by the builds piece and the script trust like every builds route, runs the tests only inside the run's sandbox (as 5.8's re-run does, never unsandboxed), and is for a failed or ready-for-review run that is not decided and is its ticket's latest. The output tail is the masked, bounded one core already keeps. UI text has no em or en dash.

**Never:** No check of its own (the checks are 5.8's). No change to approve's rules, no board build actions (11.3), no webhooks (11.4). No new port or shared shape beyond labels.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Failed tests | run failed, 3 tests fail | the failing check with "3 tests failed when re-run" in the run view, review, Runs row, card and sheet; output behind Show details | none |
| Fixed | fixture fixed, Check again | run turns ready for review, approve enabled | still failing: stays failed with the new output |
| Own command | project command set | the re-run uses it; the verification names it | invalid command: 400 with its sentence |
| Not checkable | running, blocked, stopped or decided run | Check again refused 409 run_not_active, no button | none |
| Builds off | piece off | Check again 409 feature_off | none |

</frozen-after-approval>

## Code Map

- `packages/core/src/build-dispatch.ts`, `builds.ts`, `builds-types.ts` -- `checkAgain`.
- `packages/server/src/build-routes.ts` -- `POST …/runs/:runId/check-again`.
- `packages/web/src/planning/verification-checks.tsx` (new), `build-run-panel.tsx`, `build-review.tsx`, `ticket-card.tsx`, `board-tickets.tsx`, `ticket-build-section.tsx` (new), `build-limit-fields.tsx` -- the reporting and the test command field.

## Tasks & Acceptance

**Execution:**
- [x] core, server: Check again.
- [x] web: checks and details, Check again, card and sheet, test command setting.
- [x] tests: core, DOM, e2e.

**Acceptance Criteria:**
- Given a run whose tests fail when re-run, then its failing check and output show in the run view, Runs tab, card, sheet and review; Check again after the fix makes it ready.
- Given a project test command, then the re-run uses it.
- Given builds off, then Check again is feature_off.

## Implementation Notes

- 2026-10-05 (build): 5.8 already runs the checks, keeps the output tail and the settings override, and 5.9 shows the three checks; this story adds the reporting, Check again and the settings field. A failed run's reason is already its first failing check's detail, so the Runs row, card and sheet use it. Check again reuses Update and retry's path (the run goes running, the end checks run on their own, so Stop works).

## Plan Change Log

## Review Triage Log

- 2026-10-05, pass 1 (security and correctness lenses): high 0, medium 3, low 9. Routed: patch 5, defer 4, reject 3. No intent_gap or bad_plan.
  - The test command was kept and shown unmasked while its output was masked -- low, patch: masked in `verifyRun`.
  - The review page kept the old verdict while a Check again ran (the run panel hid it) -- medium, patch: hidden while running.
  - The card's accessible name left out the failing check -- low, patch.
  - The test command's Save button shared its name with the other Save buttons -- low, patch.
  - Stop does not stop a test re-run in progress, so Check again adds an entry to a known gap -- medium, defer: already open from 5.8 ("The test re-run is not stopped by Stop or Quit").
  - A re-check that ends without a built plan or on a read failure appends no new verification, so the older checks stay shown beside the new reason -- medium, defer to 11.5 (the reason is correct; a fix needs a verification marker in the event, a shared shape 5.3 froze).
  - Check again is offered in the UI for runs the server then refuses (not the latest, already merged, never reached the checks) and takes no run slot -- low, defer to 11.5 / reject for the slot (it mirrors Resume and Update and retry).
  - Focus after Check again, and test gaps (TicketBuildSection, the settings field, a verified run failing on re-check, Stop during a re-check, route-level 409s) -- low, defer to 11.5; e2e covers the main paths.
  - XSS, unsandboxed execution, guard bypass, other workspace's or decided runs -- none found.

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `pnpm test` -- all pass
- `pnpm exec playwright test tests/e2e/verification-report.spec.ts` -- pass
