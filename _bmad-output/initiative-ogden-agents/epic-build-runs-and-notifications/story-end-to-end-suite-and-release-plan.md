---
title: 'End-to-end suite and release'
type: 'chore'
ticket: '6'
created: '2026-10-05'
status: 'in-review'
baseline_revision: '37f1909d8e0567f658cc5f681f08b4b9f9c3ac1e'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['security', 'correctness']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-build-runs-and-notifications/epic-build-runs-and-notifications.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 11's builds, verification reporting and notifications are proven in the development end-to-end suite but not against the packed package on all three operating systems, and the release is not written down. This story is human in the loop: the user runs the live checks with Claude Code and tags the release.

**Approach:** Add the installed suite's builds journey (a project of its own, the installed launcher, the real `tickets.py` through uv offline, the test sandbox hook, a recording notifier hook and an agent that halts on an intent gap), a real `tickets.py` build test in the server tests, the CHANGELOG entry; stop before the live checks and the tag.

## Boundaries & Constraints

**Always:** No real agent, account, keychain or network in a test (the webhook sender is the recording hook, honoured only in a test run on a temp data folder). The live checks use the user's Claude Code login or an API key saved through Settings, in a scratch repository, never Ogden Agents' own. **Never:** No tag, no npm publish, no release workflow run: those are the user's. No change to behavior.

</frozen-after-approval>

## Implementation Notes

- 2026-10-05 (build): `tests/e2e-installed/builds-journey.spec.ts` (project `builds`, before `journey`) runs on the three operating systems in CI; `packages/server/test/build-real-uv.test.ts` is the same flow at the server level (skipped without uv). The hook `OGDEN_AGENTS_TEST_NOTIFIER` records each webhook send in a temp file; `fake-acp-agent-installed-gap.mjs` halts a build on an intent gap. Both passed locally against the packed package.

## Live checks for the user (not run by this story)

With Claude Code on macOS, in a scratch repository with a few ready stories, the version number decided by the user, after epic 5's release:

1. Build all ready builds two independent ready stories in parallel and leaves one that waits; the run view streams each, shows the time left and Stop works (Flow 1 step 8).
2. A blocked run shows its plain reason with Show details and Retry (Apply the saved fix and retry for an intent gap).
3. A story whose tests fail when re-run shows "3 tests failed when re-run" (or the real count) with the output in the run view, the Runs tab, the card and the detail sheet; Check again after the fix; the project's own test command is used when set.
4. A blocked run and a run ready for review each reach Needs you (the tab title count) and a webhook you add to a service you own; the notification reaches you with the tab in the background (Flow 1 steps 9 to 11).
5. The same on Windows and Linux for the parts the suite cannot show (the sandbox on a real machine).

Each result is written here before the ticket moves to done.

## Review Triage Log

- 2026-10-05, pass 1: this story adds tests, one test hook, a fixture agent and the CHANGELOG entry; the test hook is read only beside `testHooksAllowed` (its audit test passes), writes only inside the OS temp folder, and answers a fixed 204. high 0, medium 0, low 0. Nothing for the user's decision.

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `pnpm test` -- all pass
- `pnpm run pack` then `pnpm exec playwright test --config tests/e2e-installed/playwright.config.ts --project=builds --no-deps` -- pass
