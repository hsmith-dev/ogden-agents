---
title: 'End-to-end suite and release'
type: 'feature'
ticket: '13'
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
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-foundation-and-forks/story-end-to-end-suite-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 2's journeys run only in the Linux dev e2e (the built workspace server), not against the installed package on all three OSes. Done when 6 (a release that passes the suite) has no owner, and two known flakes hide behind retries.

**Approach:** Add an epic 2 journey and a permission-hold proof to `tests/e2e-installed`, using the fake agent. Fix the two flakes, write the CHANGELOG entry and version bump, and hand the release and live checks to the user.

## Boundaries & Constraints

**Always:**
- The journey runs against the installed tarball, started by the real launcher in background mode, with a temp data folder. The agent is `tests/fixtures/fake-acp-agent.mjs` through `OGDEN_AGENTS_CLAUDE_ACP_PATH`. API keys stay in the memory store. Journey steps:
  1. Land through the launch link (per-tab token).
  2. Two workspaces: a chat in A that asks permission, and a `hold` chat in B. The sidebar shows both live states, and Needs you lists A.
  3. Under the default caution level, `npm test` does not run until Allow once.
  4. Quit, relaunch, reopen A. `context` replies `via=resumed`.
  5. Close the browser context, open a fresh launch link, and see both workspaces and A's history.
- Epic 1's journey still runs last, because it ends with Quit.
- Windows-safe: `join`, `process.execPath` (no shell), and the existing kill and cleanup helpers.

**Never:**
- Automate the release. Merging to `main`, making the repo public, the npm trusted publisher, tagging, `npm publish` and the live checks are user actions (HITL).
- Use a real agent or a network download in CI.
- Change product code for testability.

**Decisions (user, 2026-09-30):**
- The release comes after 9.3 lands. 2.13 runs after 9.3, its live checks install Claude Code through the card's Install, and the CHANGELOG includes 9.3.
- Publish `0.2.0-rc.1` to the `next` dist-tag first, then `0.2.0`. The 0.1.0 CHANGELOG entry stays, marked unpublished. Every tag and publish is a user action.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Hold | `permission` prompt, default caution | Card shown, state `waiting`, no "Ran npm test." until Allow once | Trace and screenshot on failure |
| Hold proof | The same check against an agent that runs without asking | The check fails (proof passes); any other failure fails the proof | — |
| Restart | Quit, then relaunch | New server; A resumes with `via=resumed` | Leftover server killed in teardown |
| Cleanup | End of run, either server | No process or temp folder left | Teardown lists what remained |

</frozen-after-approval>

## Code Map

Baseline: `story/2.12-refactor-sweep` @ `0978860` (2.12 on 9.2 `5d7fb1a`, PR #28), plus 9.3 once built.

- `tests/e2e-installed/` -- `installed.ts` hands state over through `ENV`. `global-setup.ts` installs and starts the tarball. `playwright.config.ts` defines the `gate` → `journey` projects with retries 0. `gate-bypass.ts` and `bypass.spec.ts` are the model for the hold proof. Journey step helpers: `tests/e2e/tab.ts` (`landConnected`, `storedToken`, `sidebarOf`).
- `tests/e2e/chat-server.ts` (2.12) -- reuse `startChat`, `send`, `composer`. Don't use `withChatServer`, which runs the workspace build.
- `scripts/installed-package.mjs` `prepareInstall` -- builds `env` (9.2 adds `OGDEN_AGENTS_TEST_SECRET_STORE`). Add an `env` override. `runInstalledLauncher` relaunches.
- `packages/server/src/start.ts` `CLAUDE_ACP_PATH_ENV`. The agent's environment is an allowlist (`AGENT_ENV_KEYS`), so a `FAKE_ACP_*` switch never reaches the agent from the server's environment. Use a wrapper fixture.
- `tests/fixtures/fake-acp-agent.mjs` -- prompts `permission`, `hold` and `context` (9.2 edits it; 9.3 may too).
- Selectors: `permission-card`, `session-state[data-state]`, `message-agent`, Allow once (`tests/e2e/permissions.spec.ts`).
- Flakes:
  - deferred-work: "One e2e test failed once locally on a toHaveAttribute check…". It is `tests/e2e/session-behaviour.spec.ts:65`, "a message sent while the agent works shows Queued…". The fake agent's three chunks can finish before the second `send`, so `data-status="queued"` never appears. `retries: 1` in CI hides it.
  - `tests/launcher.test.ts:118` `--foreground` (not in deferred-work): the inner wait is 10 s (`:131`), but vitest's default test timeout is 5 s.
- Release: `CHANGELOG.md` (0.1.0 only), `RELEASING.md`, `.github/workflows/{ci,release}.yml`. Prereleases are already supported: `release.yml:73` maps a `-` version to dist-tag `next`, and `:170` runs `npm publish … --tag "$DIST_TAG"` through trusted publishing. Versions are in the root, `packages/server` and `packages/web` `package.json`; `tests/packaging.test.ts` keeps them equal. npm has only `ogden-agents@0.0.0`, with no tags, and `origin/main` is still the initial commit.

## Tasks & Acceptance

**Execution:**
- [x] `scripts/installed-package.mjs` -- `prepareInstall({ env })` merges extra variables into every launcher run -- lets the fake agent and a second data folder in.
- [x] `tests/fixtures/fake-acp-agent-no-hold.mjs` (new) -- sets the skip switch, then imports the fake agent. `fake-acp-agent.mjs` gets `FAKE_ACP_SKIP_PERMISSION`: run and reply "Ran …" without `requestPermission` -- the hold proof's agent.
- [x] `tests/e2e-installed/{global-setup,installed}.ts` -- pass the fake agent path, the repo folders and `E2E_INSTALLED_*` for them.
- [x] `tests/e2e-installed/permission-hold.ts` (new) -- `expectHeld(page)`, shared by the journey and the proof.
- [x] `tests/e2e-installed/chat-journey.spec.ts` (new) -- steps 1–5.
- [x] `tests/e2e-installed/hold-proof.spec.ts` (new) -- a second background server (its own data folder, the no-hold wrapper, the same install) expects `expectHeld` to reject with the "ran without a decision" message, then quits the server.
- [x] `tests/e2e-installed/playwright.config.ts` -- projects `gate` → `hold-proof` → `chat` → `journey`.
- [x] `tests/launcher.test.ts` -- per-suite timeout (60 s) above its inner waits.
- [x] `tests/e2e/session-behaviour.spec.ts` -- in the Queued test, keep the first turn working until the queue is checked (`chunkDelayMs` via `withChat`/`withChatServer`, or the `hold` prompt plus Stop), then prove it with `--repeat-each=30`. `playwright.config.ts`: `failOnFlakyTests` in CI.
- [x] `.github/workflows/ci.yml` `e2e-installed` -- raise `timeout-minutes` if the run needs it. No new job.
- [x] Versions (root, server, web) → `0.2.0-rc.1`. `CHANGELOG.md`:
  - A `0.2.0` entry: workspaces, chats that persist and resume, permission cards and caution levels, the status sidebar, the app shortcut, the per-tab token hardening, Claude Code sign-in (9.1), the API key (9.2), and Install from the UI (9.3).
  - Mark 0.1.0 "not published".
- [x] `RELEASING.md` -- the checklist for this first release: rc to `next`, then `0.2.0` after a version-bump PR. Tests don't need `release.yml` changes; the guard already handles `-rc`.
- [x] `_bmad-output/.../deferred-work.md` -- append Resolved entries for both flakes.

**Acceptance Criteria:**
- Given the packed tarball, when `pnpm e2e:installed` runs on macOS, Windows and Linux, then every project passes and no process or folder is left.
- Given `expectHeld` edited to skip its no-run assertion, when the proof runs, then it fails.
- Given 20 repeats of the dev e2e and the launcher tests, then no failure.

## Implementation Notes

- Rebased Code Map (2026-09-30): built on `story/9.4-sign-in-again` @ `e2dfd1b` (epic 2, 9.1–9.4, with 9.3's `dca005e` test fix and 9.4's close/reopen fix). The refs still hold: `start.ts` `CLAUDE_ACP_PATH_ENV` (:83) now takes precedence over 9.3's located install (`givenClaudeAdapter`, :444), so the fake agent is used and Install is never needed; `AGENT_ENV_KEYS` (:134) and the allowlist still keep `FAKE_ACP_*` from reaching the agent. `launcher.test.ts` `--foreground` suite is now at :131, and its 10 s wait at :144. 9.4 made no change the suite depends on. The CHANGELOG covers 9.4 too (the user's release decision names 9.3; 9.4 landed before the release, so it's in).
- `via=resumed` needs `FAKE_ACP_RESUME=resume`, which can't reach the agent from the server's environment either, so the suite's agent is a second wrapper, `tests/fixtures/fake-acp-agent-installed.mjs` (sets it, then imports the fake). `fake-acp-agent-no-hold.mjs` sets `FAKE_ACP_SKIP_PERMISSION` and imports that wrapper. Every server in the suite (the global setup's too) gets the fake through `OGDEN_AGENTS_CLAUDE_ACP_PATH`.
- The chat journey runs on a server of its own (own data folder, same install, its launcher run by path), not the global setup's: step 4 quits and relaunches, and epic 1's journey still needs the first server, unchanged, with no projects. The global setup makes an extra folder (`E2E_INSTALLED_EXTRA_DIR`) for these servers' data folders and the project folders; the specs quit their servers, and the teardown kills any server left in it, removes it, and lists what remained.
- `expectHeld` fails with `RAN_WITHOUT_DECISION` when "Ran npm test." shows before (or instead of) the card, or during the 1.5 s unanswered wait. Checked the acceptance criterion by hand: with the no-run check removed, the hold proof fails ("the hold check failed, but not because the command ran").
- Queued flake: used neither `chunkDelayMs` nor `hold` + Stop (Stop leaves the queue "Not sent", which changes what the test proves). A new fake-agent prompt, `wait <file>`, keeps the first turn working until the test writes the file, after the queue check; then the turn ends by itself and the queued message is sent as before.
- The prerelease version broke two launcher tests: their "older server" was `${VERSION}-old`, which is newer than `0.2.0-rc.1` under semver (a non-numeric identifier sorts after a numeric one). They now use `0.0.0-old`. Product code unchanged.
- `RELEASING.md`'s checklist gained a step (merge first), so the trusted-publisher section is now step 3; `release.yml`'s publish-failure message links the new anchor (`#3-configure-the-npm-trusted-publisher`). No other workflow change.
- Added at the coordinator's request (flakes and CI are this story's): Windows CI runners, Node 26 especially, pushed ordinary tests past Vitest's 5 s default (core chat, workspaces network path, the .lnk test, the caution matrix). The root `vitest.config.ts` gives win32 a 20 s test and hook timeout and keeps 5 s (hooks 10 s, Vitest's defaults) elsewhere, so slow tests still show on macOS and Linux; `AGENTS.md` records it as a pitfall.
- CI `e2e-installed` timeout left at 30 min: the whole installed suite takes about 22 s locally after the install.

## Plan Change Log

## Review Triage Log

## Design Notes

The hold proof mirrors `bypass.spec.ts`. The fixture removes the hold from the outside, and the proof passes only when the check fails for that reason. Relaunch after Quit may get a new port, so the old tab can't follow, and step 5's fresh context covers it.

User (HITL) steps, never automated:
1. Merge the stack to `main` in order.
2. Make the repo public.
3. Set the npm trusted publisher.
4. Tag `v0.2.0-rc.1` and watch Release.
5. On `npx ogden-agents@next`, click Install, then run the live Done when 1–4 checks.
6. Merge the `0.2.0` bump PR, tag `v0.2.0`, and watch Release.

## Verification

**Commands:**
- `pnpm typecheck && pnpm test` -- expected: green.
- `pnpm e2e --repeat-each=20` -- expected: 0 failed, 0 flaky.
- `pnpm run pack && pnpm e2e:installed` -- expected: all projects pass locally (macOS). CI proves Windows and Linux.
