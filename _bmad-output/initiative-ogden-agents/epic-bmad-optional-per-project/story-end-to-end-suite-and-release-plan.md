---
title: 'End-to-end suite and release'
type: 'feature'
ticket: '9'
created: '2026-10-02'
baseline_revision: '8dde164a75d5e0c402857f85d5eeb970724a737a'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 10 (BMad Method optional per project) is checked only against the built server (`tests/e2e/*.spec.ts`) and, for the 0.2.0 upgrade, by one installed spec. Nothing runs the packed package on macOS, Windows and Linux through a simple project, the pieces, the guard, the offer and the defaults; and the epic has no version, CHANGELOG entry or release checklist. 3.10 F7 is open: an own-server installed spec that fails kills only the server, so its agent and CLI children can keep folders busy on Windows.

**Approach:** Add a BMad journey to the installed suite (`tests/e2e-installed`), using the hooks that already exist (`OGDEN_AGENTS_TEST_BMAD_AVAILABLE`, `OGDEN_AGENTS_TEST_BMAD_PROBE`), the fake ACP agent and `tests/fixtures`; extend the onboarding and upgrade specs; make own-server cleanup kill the whole process tree. Then prepare the release: `0.4.0-rc.1`, a 0.4.0 CHANGELOG entry, and an epic-10 section in RELEASING.md.

## Boundaries & Constraints

**Always:** Tests never run real `claude`, the keychain or the network beyond npm, and never read the real `~/.claude`: each server gets a temp home. Test hooks act only through `testHooksAllowed`. Every server the suite starts is quit or killed with its children, and every folder removed. Repo bytes are compared with the fixture's `hash()`.

**Never:** Add a new test hook or change product behaviour (a real bug found in CI is fixed in product code with a regression test). Commit the guard-removal proof. Merge, tag or publish. Touch story 4.1's branch.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Nothing shipped | installed server, no BMad hooks | Welcome's BMad Method radio disabled with "Coming soon"; all four pieces and the main switch greyed "Coming soon"; Settings → New projects BMad Method disabled | — |
| Simple project | plain repo with its own `.claude/skills`; two chats send `session-start` | header shows Chats only; each reply: `mcpServers` `[]`, `meta` null, `prompt` exactly `session-start`, no env name or value with "bmad"; repo hash unchanged after quit | — |
| Offer | repo with `_bmad/` | offer shown; Not now hides it after a reload and a server restart; hash unchanged | — |
| Pieces on/off | hooks `planning,board` + probe | tab 2 follows tab 1's Planning on/off; probe GET 409 `feature_off` while off, 200 once on; repo hash unchanged | guard removed: the suite fails at the 409 check |
| Default | New projects → BMad Method, Planning only | next project added starts `['planning']`; earlier project unchanged | — |
| Upgrade | 0.2.0 data folder | Projects, not Welcome; caution levels and the rule kept; all Simple; offer once | — |
| Failed spec | own server with agent/CLI children | cleanup kills the server and every descendant | — |

- Decision (2026-10-02, autonomous, to be confirmed by the user before tagging; hitl): the version is `0.4.0-rc.1` (epic 3 is `0.3.0-rc.1`; epic 10 is its own minor release after it). 0.2.0 and 0.3.0 entries are unchanged.

</frozen-after-approval>

## Code Map

- `tests/e2e-installed/playwright.config.ts` -- projects gate → hold-proof → chat → onboarding → terminal → upgrade → journey. Insert `bmad` (`bmad-journey.spec.ts`) after `terminal`; `upgrade` depends on it. Update the header comments.
- `tests/e2e-installed/installed.ts` -- `ownInstall`, `upgradeServer`, `terminalServer` are the patterns (temp home: HOME, USERPROFILE, APPDATA, LOCALAPPDATA, XDG_*; `extraFolder`; `launch`; `stopOwnServer`). `launch(install)` again on the same data folder is a restart.
- Hooks (exist, `packages/server/src/test-hooks.ts`): `OGDEN_AGENTS_TEST_BMAD_AVAILABLE` (comma list), `OGDEN_AGENTS_TEST_BMAD_PROBE=1` → `TEST_ROUTES.bmadProbe` (`packages/shared/src/api.ts`, GET, guarded by `planning`, 409 `feature_off`).
- Guard: `packages/core/src/bmad-features.ts` `requireBmadFeature` (l.101).
- Dev specs to mirror (selectors, shared constants from `packages/shared/src/bmad.ts`): `tests/e2e/simple-project.spec.ts`, `bmad-pieces.spec.ts` (switches by label, `bmad-<piece>-coming-soon`, `bmad-use`), `bmad-offer.spec.ts` (`addProject` via REST, `openChats` waiting on `/bmad/detection`, DELETE `/bmad/offer` 204), `new-projects.spec.ts` (`new-projects-section`, menuitem `NEW_PROJECTS_SETTINGS_LABEL`, radio/checkbox), `welcome.spec.ts` (`first-project-question`, `first-project-bmad-coming-soon`).
- Session check: `packages/server/test/simple-project.test.ts` (fake agent `session-start` → JSON reply `{via,cwd,mcpServers,meta,prompt,env}`, `tests/fixtures/fake-acp-agent.mjs` l.48).
- Fixtures: `tests/fixtures/fake-bmad-repo.ts` `createFakeBmadRepo({ bmad, files, parent, prefix })` with `hash()`; `tests/fixtures/data-folder-0.2.0.ts` (bmad workspace `ask_for_commands` + rule `npm install`; plain `ask_every_time`).
- `tests/e2e-installed/onboarding-journey.spec.ts` `addProjectAndFinish` -- add the greyed BMad Method check; after step 4, Settings → Welcome → Continue shows no question.
- `tests/e2e-installed/upgrade-journey.spec.ts` -- step 2 adds caution levels and the rule (as `tests/e2e/upgrade-0.2.0.spec.ts` l.74-87).
- F7: `scripts/installed-package.mjs` `killBackgroundServer` (l.302) SIGKILLs only the server; agents run in their own process group (`claude-code-agent.ts` l.176), the CLI in a PTY. `packages/adapters/src/process-tree.ts` is the product pattern (taskkill by absolute path). Unit tests: `tests/installed-package.test.ts`.
- Release: versions in `package.json`, `packages/server/package.json`, `packages/web/package.json` (equal, `tests/packaging.test.ts`); `CHANGELOG.md` "Unreleased" (10.4/10.7 lines); `RELEASING.md` "Epic 3 release" section is the model.

## Tasks & Acceptance

**Execution:**
- [x] `scripts/installed-package.mjs`, `tests/installed-package.test.ts` -- `killProcessTree(pid)`: Windows `taskkill /pid /T /F` (absolute path); POSIX lists `ps -A -o pid=,ppid=`, collects every descendant before killing, then SIGKILLs the root and each descendant (and its group). `killBackgroundServer` uses it. Test: a node parent with a detached grandchild; both gone after the call.
- [x] `tests/e2e-installed/installed.ts` -- `bmadServer(name, { available?: string[], probe?: boolean })`: own data folder (Welcome done), temp home, fake agent (`FAKE_AGENT`), hooks in env when given, `launch()`/`restart()` on the same folder, `addRepo(options)` (fake repo under the extra folder), `remove()`.
- [x] `tests/e2e-installed/bmad-journey.spec.ts` -- test 1 (no hooks): matrix rows "Nothing shipped" (settings and New projects), "Simple project", "Offer" (incl. restart), then quit and compare hashes. Test 2 (`planning,board` + probe): "Pieces on/off" with a second browser context, "Default"; quit; hashes unchanged. Wire the `bmad` project into the config.
- [x] `tests/e2e-installed/onboarding-journey.spec.ts`, `upgrade-journey.spec.ts` -- the additions in the Code Map.
- [x] `package.json`, `packages/server/package.json`, `packages/web/package.json`, `CHANGELOG.md` -- `0.4.0-rc.1`; "## 0.4.0 — BMad Method optional per project" with the Unreleased lines moved under it plus pieces/section, offer and simple-project lines; no Unreleased section left.
- [x] `RELEASING.md` -- "Epic 10 release (0.4.0) checklist": merge order (10.1 … 10.9 after 0.3.0), the rc tag, live checks on `npx ogden-agents@next` with real Claude Code in a scratch repo (Done when 1, 3, 4 with a 0.3.0 data folder, 5; Welcome's question), each result written into this plan; then 0.4.0.
- [x] Local proof (not committed) -- remove the `requireBmadFeature` check, pack, run `--project bmad`, record that it fails at the 409; restore and repack.

**Acceptance Criteria:**
- Given the packed tarball, when `pnpm e2e:installed` runs on macOS, Windows and Linux in CI, then every project passes and no server, child process or folder is left.
- Given the guard removed from `requireBmadFeature`, when the `bmad` project runs, then it fails at the `feature_off` check.
- Given the user's live session (hitl, not automated), when they run RELEASING.md's epic-10 checks on `npx ogden-agents@next`, then each result is written under "Live check result" here before the ticket moves to done.

## Implementation Notes

- F7: `killProcessTree(pid)` and `descendantsOf(pid)` in `scripts/installed-package.mjs`; `killBackgroundServer` (so `stopOwnServer`, every own server's `remove()` and the global setup's retry) and the teardown's `killExtraServers` use it. The unit test spawns a Node parent with a detached grandchild and checks both are gone after one call.
- `bmadServer` restarts by killing whatever still runs (with its tree) and launching again; the spec quits through the API first, so its restart is clean.
- The simple-project env check reads the reply from the page (the agent message's text paragraph, rendered as plain text) and requires no env name or value matching `/bmad/i`. Folder names avoid "bmad" (`journey-simple`, `simple-repo-`) so nothing matches by accident; unlike the server unit test, the installed server's env isn't this process's, so inherited values are not filtered out.
- Onboarding: the greyed BMad Method check sits in `addProjectAndFinish` (both tests); step 4b (test 1) does Settings → Welcome → Continue, waits for the agent card to show signed in, checks no question, then returns to the project's empty Chats for step 5.
- Local guard proof (2026-10-02, macOS, not committed): `requireBmadFeature`'s check replaced by a no-op, `pnpm run pack`, `pnpm e2e:installed --project bmad --no-deps`: test 1 passed, test 2 failed at the first probe check (`bmad-journey.spec.ts:270`, expected 409 `feature_off`, received 200 `{ piece: 'planning' }`). Restored (`git checkout`), repacked, and the `bmad` project passes again.
- Local runs (macOS): `pnpm typecheck`, `pnpm test` (103 files, 1225 passed, 4 skipped), `pnpm e2e` (90 passed), `pnpm run pack && pnpm smoke` (OK), `pnpm e2e:installed` (39 passed, no cleanup problem reported). CI on Windows and Linux not yet run (no PR pushed).

## Plan Change Log

## Review Triage Log

- 2026-10-02 quick review (one lens, with a security brief on the test hooks and the tree kill). Verdicts: 0 high, 2 medium, 4 low, 1 false, 0 maybe-false. No intent_gap or bad_plan findings.
  - F1 (false): "AC 1 not met, CI not run". CI runs on the draft PR after review (the Verification section); not a defect in the diff.
  - F2 (medium, patch): `killProcessTree` on a stale `server.json` pid (a SIGKILLed server leaves it; pids are reused) could hit an ancestor of the test runner, and the tree and group kill would take the runner with it. It now skips `process.pid` and its ancestors, as root or descendant, with a unit test on `process.ppid`. Reuse by an unrelated process stays as before 10.9 (the old single kill had it too).
  - F3 (low, patch): `bmadServer`'s no-hook server inherited `OGDEN_AGENTS_TEST_BMAD_*` from the runner's environment. Both are now set to empty when not asked for.
  - F4 (medium, patch): the installed server hands the runner's `ANTHROPIC_API_KEY` to agents (`agentKeysOf(process.env)`, start.ts), and `session-start` echoes the agent's env into the page, the event log and failure traces. `bmadServer` now blanks it.
  - F5 (low, defer): "no child process left" is enforced only while the server's pid is alive; an orphan of a server that already died is not looked for. Deferred (deferred-work.md).
  - F6 (low, patch): RELEASING's Done when 2 coverage line now cites the dev spec for restart persistence.
  - F7 (low, patch): upgrade spec header rewrapped.
  - Rerun after the patches (macOS): typecheck; vitest 1226 passed (4 skipped); `pnpm e2e` 90 passed; pack and smoke OK; `pnpm e2e:installed` 39 passed (38 s); provenance OK.

## Design Notes

- No new hook: the two BMad hooks already exist and are honoured in the installed package (`prepareInstall` sets `NODE_ENV=test`, data folders are in temp). Test 1 runs with none, so "Coming soon" is what a user sees.
- Live check result: pending (the user runs RELEASING.md's epic-10 checks after tagging `v0.4.0-rc.1`).

## Verification

**Commands:**
- `pnpm typecheck && pnpm test` -- expected: green.
- `pnpm e2e` -- expected: green.
- `pnpm run pack && pnpm smoke && pnpm e2e:installed` -- expected: green on macOS locally.
- CI on the draft PR -- expected: every job green on all three OSes.
