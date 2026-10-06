---
title: 'Refactor sweep'
type: 'chore'
ticket: '12'
created: '2026-10-05'
status: 'built'
baseline_revision: '84cd50e1f96e5d536d882f9d1056be8cb9bded84'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['correctness']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-desktop-app/epic-desktop-app.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/deferred-work.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 13 left the spike's reference code in the repository, two end-to-end scripts that each carry their own copy of the same helpers, and findings the stories deferred that have no Open items line.

**Approach:** No behaviour change. Delete `apps/desktop-spike/` (its findings are in the spike plan and PR #113, and its staging, shell, harness and workflow were carried into `packages/desktop/`); move the fake agent wrapper and the tab helper that `lifecycle.mjs` and `update-e2e.mjs` duplicated into `app-harness.mjs`; add the Open items lines and Log entries for what the epic deferred (Linux, the signing slots and live update checks); confirm no file the epic grew is over 600 lines.

## Boundaries & Constraints

**Always:** no behaviour change; the Open items index and the Log stay in sync (`node scripts/check-provenance.mjs`).

**Never:** touch the shell's behaviour, the server or the web UI.

</frozen-after-approval>

## Code Map

- `apps/desktop-spike/` (removed), `packages/desktop/scripts/{app-harness,lifecycle,update-e2e}.mjs`, `_bmad-output/initiative-ogden-agents/deferred-work.md`.

## Tasks & Acceptance

**Execution:**
- [x] spike code removed
- [x] shared helpers in `app-harness.mjs`
- [x] deferred-work entries and index lines
- [x] size check: the largest epic 13 source is under 600 lines (`Cargo.lock` is generated)

## Implementation Notes

- The spike's temporary workflow was already out of `.github/workflows/` (13.1); its copy under `apps/desktop-spike/ci/` goes with the folder.

## Plan Change Log

## Review Triage Log

Pass 1 (correctness): low 1.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | The shared `agentWrapper` must keep the grandchild switch the lifecycle test needs and the update test does not | low | patch | It takes `{ grandchild }`; lifecycle passes true, the update test leaves it off. CI runs both. |

## Verification

**Commands:**
- `PROVENANCE_BASE=origin/main pnpm provenance`; the Desktop workflow runs both scripts.
