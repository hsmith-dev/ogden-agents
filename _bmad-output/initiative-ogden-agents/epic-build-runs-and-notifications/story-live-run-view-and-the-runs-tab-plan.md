---
title: 'Live run view and the Runs tab'
type: 'feature'
ticket: '1'
created: '2026-10-05'
status: 'in-review'
baseline_revision: '73ec7a00b0ad0c9de387e6f32a11531de0a74da5'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['security', 'correctness']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-build-runs-and-notifications/epic-build-runs-and-notifications.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-unattended-builds/story-dispatch-limits-stop-retry-and-quit-in-core-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A build session shows only a one line header (ticket, state, Stop, Retry, a review link). There is no sandbox or agent, no time left, no blocked notice with Show details, no way to apply an intent gap's saved fix, no list of runs and no Runs tab.

**Approach:** Add a run panel to the build session (agent, sandbox used, time left, the blocked or failed notice with the plain sentence, Show details with the raw code and reason, Retry, Apply the saved fix and retry); add the core use-case behind `retry` with `mode: 'apply_fix'`; fill the Runs tab slot (`g r`) with a page listing every run and the queue, only with builds on.

## Boundaries & Constraints

**Always:** Apply the saved fix goes through `requireBmadFeature(..., 'builds')`, the piece route helper and the script trust like every builds route. The patch is the one beside the run's own plan, found by `intentGapPatchOf` (a regular file under the worktree's `_bmad-output`), applied all or nothing through `VcsPort.applyPatch` with protected paths refused, then the plan is marked in-review in the worktree and the run is redispatched through Retry's path. Show details always shows the raw code in Developer mode and behind its toggle otherwise. Run views read run state from the API; events only trigger refetches. UI text has no em or en dash.

**Never:** No new port or shared shape (5.3 froze them). No verification detail, Check again or board actions (11.2, 11.3). No webhooks (11.4). No Runs tab, `g r` or Apply with builds off.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Running | live run | header counts time left down, Stop ends it as stopped | none |
| Blocked | blocked run, code `other` | sentence, Retry, code under Show details | Retry refused: its sentence inline |
| Intent gap | blocked `intent_gap`, saved patch | Apply the saved fix and retry applies it, marks in-review, redispatches | patch missing or unsafe: 409 `run_not_active` with its sentence; does not apply: 409 `merge_conflict`, nothing changed |
| Not an intent gap | any other run | `apply_fix` refused 409 `run_not_active` | none |
| Runs tab | builds on | every run (newest first) with outcome, and the queue, each opens its run view | list fails: plain sentence |
| Builds off | piece off | no Runs tab, no `g r`; the route shows the feature-off notice; routes answer 409 `feature_off` | none |

</frozen-after-approval>

## Code Map

- `packages/core/src/builds.ts`, `build-dispatch.ts` (5.10's split) -- `retry` takes `apply_fix`.
- `packages/shared/src/builds.ts` -- the new labels and sentences.
- `packages/web/src/planning/build-run-header.tsx`, `build-run-panel.tsx` (new) -- the run view.
- `packages/web/src/routes/workspace-runs-page.tsx`, `planning/runs-list.tsx` (new), `router.tsx`, `shell/workspace-tabs.tsx` -- the Runs tab.
- `packages/web/src/planning/builds-api.ts` -- Retry with a mode.

## Tasks & Acceptance

**Execution:**
- [ ] core: Apply the saved fix and retry (`apply_fix`).
- [ ] shared, web: run panel, Runs page, tab slot, calls.
- [ ] tests: core, server, DOM, e2e.

**Acceptance Criteria:**
- Given an intent-gap run with a saved patch, when Apply the saved fix and retry runs, then the patch is applied in the worktree, the plan is in-review and the run is running again.
- Given builds off, then no Runs tab and no `g r`.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `pnpm test` -- all pass
- `pnpm e2e` (touched specs) -- pass
