---
title: 'End-to-end suite and release'
type: 'feature'
ticket: '10'
created: '2026-10-01'
baseline_revision: '6e321310e4e2004509f729962a12a7c655ffd6e6'
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

**Problem:** Epic 3's flow (CAP-5) is checked only against the built server on Linux (`tests/e2e/terminal.spec.ts`). Nothing checks the packed package on macOS, Windows and Linux, nothing in a browser shows a terminal message coming back "from terminal", and epic 3 has no release checklist.

**Approach:** Add a terminal journey to the installed-package suite (`tests/e2e-installed`, already run on all three OSes in CI), with the repo's fake ACP agent and fake CLI. Add a pty-failure check on an install without optional dependencies. Then prepare the release: `0.3.0-rc.1`, its CHANGELOG entry, and an epic-3 section in RELEASING.md with the user's live checks.

## Boundaries & Constraints

**Always:** Tests never run the real `claude`, the keychain or the network beyond npm, and never read the real `~/.claude`: the journey's server gets a temp `HOME`/`USERPROFILE`. Every server the suite starts is quit or killed, and every folder is removed. The new test hook works only under `testHooksAllowed` (a test run with a data folder in the OS temp folder), like the hooks that already exist.

**Never:** Commit the lock-removal proof. Change the AD-15 gate, the agent allowlist for real runs, or the terminal's behaviour. Merge, tag or publish. Touch 3.8's files beyond what the rebase brings.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Journey | Developer mode on, chat answered, switch, type `M`, reload, switch back | terminal reattaches showing `echo:M`; transcript shows `M` "from terminal" and the reply `echo:M`; `context` replies `session=<the --resume id> via=resumed` | — |
| Lock | chat POST while the terminal drives | composer disabled; server 409 `driver_is_terminal` | with the core lock removed, the journey fails here |
| No node-pty | install with `npm_config_omit=optional` | app runs; Terminal segment `aria-disabled`, tooltip "The terminal couldn't start on this computer..." | — |
| Hook outside a test | `OGDEN_AGENTS_TEST_CLAUDE_CLI` with no test run, a data folder outside temp, or a script outside temp | ignored | relative path: throws, as `CLAUDE_INSTALL_ENV` does |

- Decision (2026-10-01, autonomous): the version is `0.3.0-rc.1` (epic 3 is a minor feature after 0.2.0, which RELEASING.md cuts before any epic 3 merge; 2.13 set its rc the same way). The user can change it before tagging.

</frozen-after-approval>

## Code Map

- `tests/e2e-installed/playwright.config.ts` -- projects in order gate → hold-proof → chat → onboarding → journey. Insert `terminal` (matching `terminal-journey.spec.ts`) between onboarding and journey.
- `tests/e2e-installed/installed.ts` -- `ownInstall` and `onboardingServer` are the patterns: wrappers with switches baked in (the server passes agents only an allowlisted env, `start-env.ts` `agentEnvironment`), a temp home, `extraFolder`, `launch`, `stopOwnServer`. Reuse `landConnected`, `storedToken`, `startChat`, `send` and `composer` (`tests/e2e/tab.ts`, `tests/e2e/chat-server.ts`), and `requestQuit`/`waitForExit`.
- `tests/e2e/terminal.spec.ts` -- the selectors: `developer-mode` (at `/settings/appearance`), `switch-to-terminal`, `terminal[data-status]`, `.xterm-rows`, `read-only-banner`, `banner-switch-to-chat`, `message-from-terminal`, `message-origin`, and the tooltip on focus.
- Terminal CLI resolution: `adapters/src/acp-claude-code/terminal-command.ts` `resolveClaudeExecutable` uses `CLAUDE_CODE_EXECUTABLE` from the chat env, and runs a `.mjs` under Node. On Windows, `findClaudeExecutable` takes only a real `claude.exe`, so the installed server needs a hook to run the fake CLI.
- `server/src/test-hooks.ts` (`testHooksAllowed`, `insideTemp`, the `testClaudeInstall` checks) and `server/src/start.ts` l.225-252 (`extraAgentEnv`, the "test hooks in use" log line).
- Import: `core/src/terminal-import.ts` lines up on the chat's last user message, so Claude Code's record must hold the chat's own exchange. The fake ACP agent writes none. The server test seeds it by hand (`server/test/terminal-socket.test.ts` l.368).
- Record path: `adapters/.../transcript.ts` `claudeConfigDir(env)`: `CLAUDE_CONFIG_DIR`, else `.claude` under `HOME` (`USERPROFILE` on win32). The slug comes from the real path of the cwd.
- Driver lock: `core/src/chat/turns.ts` l.248 `if (session.driver === 'terminal') throw new DriverIsTerminalError()` → 409 `driver_is_terminal` (`server/src/chat-routes.ts` l.74).
- pty reason: `core/src/terminal-reasons.ts` `ptyUnavailable`. `scripts/installed-package.mjs` `prepareInstall({ omitOptional })`.
- Versions: root, `packages/server`, `packages/web` `package.json`, kept equal by `tests/packaging.test.ts`. `CHANGELOG.md`, `RELEASING.md`.

## Tasks & Acceptance

**Execution:**
- [x] `server/src/test-hooks.ts`, `server/src/start.ts`, `server/test/test-hooks.test.ts` -- `OGDEN_AGENTS_TEST_CLAUDE_CLI`: an absolute path to a file inside temp, honoured only when hooks are allowed, becomes the agents' `CLAUDE_CODE_EXECUTABLE`. An explicit `extraAgentEnv` value wins. Add it to the "test hooks in use" line. Unit-test the matrix rows.
- [x] `tests/fixtures/fake-acp-agent.mjs` -- `FAKE_ACP_CLAUDE_RECORD=1` (with `CLAUDE_CONFIG_DIR` set) appends each default-reply exchange to `<CLAUDE_CONFIG_DIR>/projects/<slug of cwd>/<session id>.jsonl`, chained by `parentUuid`, as the real Agent SDK does. Off by default, so existing tests are unchanged.
- [x] `tests/e2e-installed/installed.ts` -- `terminalServer(name, { omitOptional? })`: a temp real-path home, a project, and agent and CLI wrappers baked with `CLAUDE_CONFIG_DIR=<home>/.claude` (the agent wrapper also gets `FAKE_ACP_RESUME=resume` and `FAKE_ACP_CLAUDE_RECORD=1`). The env carries HOME/USERPROFILE, the ACP path and the CLI hook. `omitOptional` uses a fresh install (a fresh cache seeded from the shared `_cacache`).
- [x] `tests/e2e-installed/terminal-journey.spec.ts` -- two tests: the journey (matrix rows 1-2, ending with Quit) and no node-pty (row 3). Wire the `terminal` project into the config, and update the config and global-setup comments.
- [x] `package.json`, `packages/server/package.json`, `packages/web/package.json`, `CHANGELOG.md` -- `0.3.0-rc.1`, and a 0.3.0 entry for the terminal toggle.
- [x] `RELEASING.md` -- epic 3 (0.3.0) section: merge order, the rc tag, then live checks with `npx ogden-agents@next`: Done when 1, 2 and 4 on macOS and on Windows, plus ConPTY paste, resize, `Ctrl+.` and colours; then 0.3.0.
- [x] Local proof -- remove the lock line, pack, run the `terminal` project, and record that it fails at the 409 check. Restore and do not commit.

**Acceptance Criteria:**
- Given the packed tarball, when `pnpm e2e:installed` runs on macOS, Windows and Linux in CI, then every project passes and no server or folder is left.
- Given the driver lock removed from `turns.ts`, when the terminal project runs, then it fails at the refused-input check.
- Given the user's live session (hitl, not automated), when they run RELEASING.md's epic-3 checks on `npx ogden-agents@next` including Windows, then epic 3's Done when 1, 5 and 6 are met.

## Implementation Notes

- Implemented directly (no implementation subagent).
- Rebased onto `story/3.8-terminal-windows` @ 6e32131 (3.8 sits on the restacked 3.9), so `baseline_revision` is that parent. The journey uses 3.8's fake CLI, which reads raw input.
- Hook: `testClaudeCli` in `server/src/test-hooks.ts`. `start.ts` puts it first in `extraAgentEnv`, so an option's `CLAUDE_CODE_EXECUTABLE` wins, and the "test hooks in use" line gains `claudeCli`. A missing file or a folder throws, like `CLAUDE_INSTALL_ENV`.
- Fixture: `FAKE_ACP_CLAUDE_RECORD=1` in `fake-acp-agent.mjs` records only default-reply exchanges, keyed by `process.cwd()` as the fake CLI is.
- `launch(install, { fresh })` runs npx for an install of its own. The no-pty install takes a fresh cache seeded from the shared `_cacache`, and installs in seconds locally.
- Agent replies render with the "Claude Code" name label, so the spec matches them with `toContainText`, as chat-journey does. The `--resume` id is read row by row, because the xterm rows' text runs together.
- Local proof (not committed): with `if (session.driver === 'terminal') throw new DriverIsTerminalError();` removed from `core/src/chat/turns.ts`, repacked, `pnpm e2e:installed --project terminal --no-deps` failed at step 3: "the server took a chat message while the terminal drives: the driver lock is gone (status 202)". The line was restored and repacked.
- Local macOS: typecheck; vitest 75 files, 1013 passed (4 skipped); `pnpm e2e` 82 passed; smoke OK; `pnpm e2e:installed` 36 passed (33 s).

## Plan Change Log

- 2026-10-01: Windows CI run 36910454951 failed once at step 7 (the reply after switching back). The trace's event socket shows the import was on time (the terminal turns came before `driver_changed` to ui); `context` was accepted at 19:07:02 and the restarted agent's `session.resumed` and reply came at 19:07:42, 40 s later, while the runner was stalled (a key press in the page took 12 s). Not a lost or mis-matched reply. Step 7 now waits as long as the adapter lets an agent start (`START_TIMEOUT_MS`, 60 s), and a failed journey attaches the server's log (`server.log`, codes and timings only) to the report so the next stall can be timed from the server side.

## Review Triage Log

- 2026-10-01 quick review (one lens, with a security brief on AD-15 and AD-16). Verdicts: 0 high, 2 medium, 7 low, 0 false, 0 maybe-false, 1 rejected. No intent_gap or bad_plan findings.
  - F1 (medium, patch): the no-pty install had no streamed progress and no retry (AGENTS.md pitfall). It now uses `startWithRetry` with `echoLines()` and fresh folders on retry (`terminalServer().launch()`).
  - F2 (low, patch): `testClaudeCli` stat'ed the file before the temp check, so a missing script outside temp threw instead of being ignored. The temp check now comes first, and a test covers a missing script outside temp.
  - F3 (medium, patch): the hook gave the path as passed, so a symlink repointed after start could lead out of temp. It now returns the real path, checks it again, and has a link test.
  - F4 (low, patch): the JSDoc overstated "inside temp". It now says the hook picks only which file starts.
  - F5 (low, patch): the hook let a `.cmd` through on win32, skipping 3.8's no-shell rule. Now only `.js`, `.mjs` or `.cjs` (run under Node), with a test.
  - F6 (low, patch): `terminalServer` didn't redirect APPDATA, LOCALAPPDATA or the XDG folders. They are now under the temp home, as in `onboardingServer`.
  - F7 (medium, defer): a test that fails partway SIGKILLs only the server. Its agent and CLI children can outlive it and hold the project folder on Windows. The same applies to every own-server spec (chat-journey, onboarding), so it goes to deferred-work.
  - F8 (low, patch): the global-setup header didn't mention the spec's own install. Updated.
  - F9 (low, patch): RELEASING's Done when 4 wording. It now names the CI-covered node-pty half and live check 1 for Developer mode off.
  - F10 (rejected): the plan's tasks were unticked. The fix edits the plan (bookkeeping, ticked at `built`).
  - F11 (low, patch): the fake agent's `recordExchange` could fail a prompt. Now in try/catch, as in the fake CLI.
  - Rerun after the patches: typecheck, vitest (1013 passed), smoke OK, `pnpm e2e:installed` 36 passed.

## Design Notes

- Why a hook, not `PATH`: on POSIX a `claude` script in the temp home would do, but on Windows only a real `claude.exe` counts. The hook adds no new power: `OGDEN_AGENTS_CLAUDE_ACP_PATH` already picks the agent script, and this hook is narrower than that (tests only, temp files only).
- Hitl checklist (the user's, also in RELEASING.md): after the rc is tagged, run `npx ogden-agents@next` with real Claude Code on macOS and on Windows. Turn on Developer mode, switch a chat mid-session, send a message in `claude`, switch back, see it "from terminal" with its reply, and continue. Check that the chat input is refused while the terminal drives. On Windows, also check paste, resize, `Ctrl+.` and colours. Then tag 0.3.0.

## Verification

**Commands:**
- `pnpm typecheck && pnpm test` -- expected: green.
- `pnpm e2e` -- expected: green, with `terminal.spec.ts` unchanged.
- `pnpm run pack && pnpm smoke && pnpm e2e:installed` -- expected: green on macOS locally.
- CI on the draft PR -- expected: `End-to-end, installed` green on all three OSes.
