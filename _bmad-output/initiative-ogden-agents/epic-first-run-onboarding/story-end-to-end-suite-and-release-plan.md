---
title: 'End-to-end suite and release (onboarding)'
type: 'feature'
ticket: '9.7'
created: '2026-09-30'
status: 'built'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/RELEASING.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-end-to-end-suite-and-release-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 9's first-run journey is proven only in the dev e2e against the workspace build, never against the installed tarball on macOS, Windows and Linux. Done when 4 (released in an npm version) has no owner, and the CHANGELOG and RELEASING stop at 9.4.

**Approach:** Add an onboarding journey to `tests/e2e-installed` from a fresh data folder, driven by the fake agent, fake login and memory keychain. Bring the CHANGELOG and RELEASING up to 9.6. Hand the release and live checks to the user.

## Boundaries & Constraints

**Always:**
- The journey runs the installed tarball through the real launcher in background mode, with its own temp data folder, home folder and project folder. Nothing goes in `onboarding.json` in advance. Steps:
  1. Launch link → `/welcome`.
  2. Install on the Claude Code card from the offline `fake-adapter` fixture. Open Question 2 decides whether this step runs.
  3. Sign in through the fake login. Route the page's `https://claude.ai/**` visit to the login's localhost callback. Welcome moves on by itself.
  4. Add the project, say Not now to the shortcut, and land in the empty Chats.
  5. First chat; the reply streams.
  6. Sign in again: remove the login state, so the chat shows Sign in. Sign in, then Try again resends.
  7. An API-key run on a second server (Open Question 2): save a key to the memory store, then chat. The key appears nowhere in the data folder, events or log.
- The fake agent's switches go in a generated wrapper whose paths are baked in, because the server passes agents an allowlisted env (2.13). The keychain is memory only (`OGDEN_AGENTS_TEST_SECRET_STORE=memory`, already set by `prepareInstall`).
- Windows-safe (`join`, `process.execPath`, existing kill and teardown helpers). Epic 1's `journey` project still runs last.
- Run in the existing `e2e-installed` CI job on all three OSes. No new job.

**Never:**
- Automate the release. Merging, making the repo public, the npm trusted publisher, tagging, publishing and the live checks are all the user's.
- Use a real agent, login, keychain or the network in CI.
- Touch terminal files (`terminal-*`, `tests/e2e/terminal.spec.ts`). Story 3.1 is still fixing Windows there.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Install | No adapter, fixture pins | Card: installing, then installed with the fixture version | Trace and screenshot |
| Subscription | Fake login, callback hit | Welcome advances; `auth status` signed in | Login process killed in teardown |
| API key | Key saved, no subscription | Chat replies; key absent from data folder, DB and log | Assertion names the file it was found in |
| Expired | Login state removed mid-session | Error notice with Sign in; after sign-in, Try again replies | — |

- Decision (2026-09-30, user, Q1): (a) fold epic 9 into 0.2.0 — version stays 0.2.0-rc.1, the 0.2.0 CHANGELOG entry gains Welcome (9.5) and the 9.6 sweep, RELEASING's merge order and live checks extend through 9.7; the release is cut BEFORE epic 3 (the terminal stories are not in this release and get no CHANGELOG line).
- Decision (2026-09-30, user, Q2): (a) add NODE_ENV=test-gated env hooks (like OGDEN_AGENTS_TEST_SECRET_STORE): an install source (fixture pins + npm CLI) and a key check that accepts; inert unless NODE_ENV=test or VITEST; security review required.
- Decision (2026-09-30): plan kept whole.

</frozen-after-approval>

## Code Map

Baseline: `story/9.6-refactor-sweep` @ `641a244` (epic 2, 2.13, 9.1–9.6, 3.1). Version is `0.2.0-rc.1` and not yet published.

- `tests/e2e-installed/` -- `installed.ts` (`ENV`, `agentEnv`, `FAKE_AGENT`, `killExtraServers`, a server per spec with `onboarding.json` pre-written at `:85`). Don't pre-write it for this spec. `global-setup.ts` installs once. `playwright.config.ts` defines the projects `gate → hold-proof → chat → journey`.
- `tests/e2e/welcome.spec.ts`, `agents-settings.spec.ts:215-245` (Install with `packFakeAdapter`, `testNpmCli`, an empty HOME) and `sign-in-again.spec.ts` (`FAKE_ACP_REQUIRE_LOGIN`) -- reuse their selectors and claude.ai routing. Their in-process `StartOptions` (`extraAgentEnv`, `claudeCliBrowser`, `claudeInstall`, `verifyApiKey`) are unreachable from an installed server: `serve.ts:89` passes none.
- `tests/fixtures/fake-adapter/pack.mjs` -- `dist/index.js` imports `fake-acp-agent.mjs` by absolute URL. Add an optional target so it runs the generated wrapper.
- `packages/server/src/start.ts` -- `testSecretStore` (`:101`, gated on `NODE_ENV=test`) is the only precedent for a test hook in shipped code. `givenClaudeAdapter` (`:454`): when `OGDEN_AGENTS_CLAUDE_ACP_PATH` is set, Install never runs, so this spec must not set it. `ANTHROPIC_VERIFY_URL` (`adapters/src/setup-claude-code/api-key.ts:20`) is a real network check.
- `CHANGELOG.md` 0.2.0 entry (has 9.1–9.4, not Welcome); `RELEASING.md` "First release (0.2.0) checklist" (says 9.1 to 9.4; step 5 live checks); root, server and web `package.json` `0.2.0-rc.1`.

## Tasks & Acceptance

**Execution:**
- [x] `tests/fixtures/fake-adapter/pack.mjs` -- optional `agent` path for `dist/index.js` -- the installed fixture adapter runs the onboarding wrapper.
- [x] `tests/e2e-installed/installed.ts` -- `onboardingServer({ signIn: 'subscription' | 'apiKey' })`: fresh data folder, HOME, and project folder; a generated wrapper (`FAKE_ACP_AUTH=claude-terminal`, `FAKE_LOGIN_STATE`, `FAKE_ACP_REQUIRE_LOGIN` or `FAKE_ACP_REQUIRE_API_KEY`); the packed fixture adapter; launches and quits.
- [x] Install-source and key-check hooks, per Open Question 2.
- [x] `tests/e2e-installed/onboarding-journey.spec.ts` (new) -- steps 1–6, then step 7 on its own server.
- [x] `tests/e2e-installed/playwright.config.ts` -- an `onboarding` project after `chat`, with `journey` last.
- [x] `CHANGELOG.md`, `RELEASING.md` and the versions, per Open Question 1. Either way: add Welcome (9.5) and the release-relevant 9.6 fixes to the notes, and add live checks for epic 9's Done when 1–3 to the checklist, with the steps marked as the user's.
- [x] `_bmad-output/initiative-ogden-agents/deferred-work.md` -- append new findings only.

**Acceptance Criteria:**
- Given the packed tarball, when `pnpm e2e:installed` runs on macOS, Windows and Linux, then every project passes, with nothing left behind.
- Given the API-key run, when the data folder, DB and log are searched for the key, then it is not found.

## Design Notes

User (HITL) steps, never automated: (1) merge to `main`; (2) make the repo public; (3) set the trusted publisher; (4) tag the rc, watch Release; (5) live on a fresh machine with `npx ogden-agents@next`: Welcome → Install → subscription → chat; a second user with only an API key (real keychain); Sign in again after expiry; (6) bump PR, stable tag, watch Release.


## Verification

**Commands:**
- `pnpm typecheck && pnpm test && pnpm e2e` -- expected: green.
- `pnpm run pack && pnpm e2e:installed` -- expected: all projects pass on macOS; CI proves Windows and Linux.

**Manual checks:** the user's live checks (Design Notes step 5).

## Review Triage Log

Security review (2026-09-30), nothing blocking:

| # | Finding | Decision | Change |
|---|---------|----------|--------|
| F1 | The test hooks rest on `NODE_ENV=test`/`VITEST` alone. | Fixed | One gate, `testHooksAllowed(env, dataDir)` in `packages/server/src/test-hooks.ts`: a test run AND a data folder whose real path is inside the real path of `os.tmpdir()` (macOS `/var` → `/private/var`). Used by the install hook, the key check and the existing `OGDEN_AGENTS_TEST_SECRET_STORE`. |
| F2 | The install hook could point Install at any source. | Fixed | The JSON file must be inside the temp folder, and every locked package must be `resolved` to a `file:` fixture with a `sha512-` integrity; otherwise the hook is ignored (or, malformed, the test fails loudly). |
| F3 | A user's environment could switch the hooks on. | Fixed by F1 | A user's data folder is never inside the temp folder. |
| F4 | The hooks were exported from the server package. | Fixed | Export removed from `packages/server/src/index.ts`; only `start.ts` and the unit tests use them. |
| Minor | The API-key run proved a key reached the agent, not that it was this key. | Fixed | The fake agent replies `key received …<last 4>`; the installed spec expects `…WXYZ`. |

Tests: `packages/server/test/test-hooks.test.ts` (each hook ignored outside a test run, on a data folder outside the temp folder, for a file outside it, for remote `resolved`; real-path links), `agent-setup-routes.test.ts` F5 (secret store outside the temp folder).
