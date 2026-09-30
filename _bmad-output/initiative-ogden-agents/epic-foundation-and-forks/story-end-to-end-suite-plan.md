---
title: 'End-to-end suite'
type: 'feature'
ticket: '12'
created: '2026-09-30'
status: 'draft'
baseline_revision: ''
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The browser tests (Playwright) run only on Linux against the workspace build, and the clean-install smoke test checks the installed package without a browser. Nothing drives a real browser against the **installed** package on macOS, Windows and Linux, which is what epic 1's Done when promises (R1, R2, R8).

**Approach:** An end-to-end suite that installs the packed tarball in an empty folder, launches it through the installed `ogden` launcher, and drives Chromium through the whole epic 1 journey: sign in through the launch link, the app shell, Settings, New tab, Quit. It runs in CI on all three OSes. It also includes negative checks that fail if the security gate is weakened.

## Boundaries & Constraints

**Always:**
- The suite runs against the **installed tarball** (not the workspace), through the real launcher in background mode, with a temporary data folder, and quits the server at the end, leaving no process.
- Journey:
  1. Launch.
  2. Land connected through the launch link.
  3. See the shell.
  4. Change theme and density.
  5. Open Settings > Tools (status shown; no download in CI).
  6. Open a New tab.
  7. A bookmark-style tab shows the launch state.
  8. Quit with confirmation, and every tab shows stopped.
- Gate checks: API and WebSocket requests without the tab token are refused; with a foreign Origin they're refused; the launcher endpoint without the launcher token is refused. A test proves the suite fails when the gate is bypassed (the gate disabled through a test-only build flag, or a fixture).
- CI: a new job matrix on macOS, Windows and Linux (Node 24) runs the suite after pack; Playwright installs only Chromium.

**Never:**
- No real agent, no network downloads, and no changes to user-facing behavior.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Journey | Installed tarball on each OS | All 8 steps pass | Screenshots and trace uploaded on failure |
| Gate | Requests without a token or with a foreign Origin | Refused | — |
| Bypass | The gate disabled in a fixture | The gate checks fail (the suite really detects it) | — |
| Cleanup | End of the suite | No server process left; data folder removed | — |

</frozen-after-approval>

## Code Map

Baseline: set when the story starts (after 1.11).

- `scripts/smoke-installed.mjs` -- installs the tarball with `npx` in an empty folder; reuse its install and cleanup logic.
- `tests/e2e/` -- the Linux Playwright suite against the workspace build (`global-setup.ts`, `server.ts`); the new suite lives beside it (e.g. `tests/e2e-installed/`) with its own config.
- `.github/workflows/ci.yml` -- add an `e2e-installed` matrix job (macOS, Windows, Linux); `actions/upload-artifact@v7` for traces (a verified moving tag).

## Tasks & Acceptance

**Execution:**
- [ ] `tests/e2e-installed/` -- config, install fixture, the journey spec and the gate spec, plus the bypass proof.
- [ ] `ci.yml` -- the 3-OS job.
- [ ] README -- how to run it locally (`pnpm e2e:installed`).

**Acceptance Criteria:**
- Given CI, when the suite runs on macOS, Windows and Linux, then the journey and gate checks pass, and the bypass fixture proves the gate checks fail without the gate.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `pnpm pack && pnpm e2e:installed` -- expected: all pass locally, leaving no process.
