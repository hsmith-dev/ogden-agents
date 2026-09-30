---
title: 'Tracer bullet: sign in with a Claude subscription through a hidden PTY'
type: 'feature'
ticket: '1'
created: '2026-09-30'
status: 'built'
baseline_revision: '424a1bc'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-first-run-onboarding/epic-first-run-onboarding.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A user without a Claude Code login cannot chat, and the only fix today is to run `claude /login` in a terminal (AD-21). `AgentSetupPort` is still the `setup-memory` stub, and the agent routes answer 501.

**Approach:** Add a lazy `terminal-pty` loader (AD-19) and a `setup-claude-code` adapter. The adapter runs the adapter's own validated terminal auth method (`node <claude-agent-acp> --cli auth login --claudeai`) in a hidden PTY, extracts the sign-in URL from the output, and hands it to the UI in a `no-store` response. It detects completion from the exit code plus `--cli auth status --json`. A generic core service turns the outcome into `agent.auth_changed` events, and Settings: Agents shows the Claude Code card with one reusable sign-in action.

## Boundaries & Constraints

**Always:**
- Credentials stay in the CLI (AD-16). PTY output is never logged, evented or stored. The URL leaves the server only in the `POST …/sign-in` response (`Cache-Control: no-store`). Diagnostics carry only exit codes and step names.
- Validate the auth method before running it (this closes deferred F4, which was filed under the old number 9.2, because 9.1 is the first story to run one). Accept only id `claude-ai-login` with args exactly `["--cli","auth","login","--claudeai"]` and no `env`. The command is always our `process.execPath` plus the resolved adapter path. `_meta.terminal-auth.command` is ignored. Anything else fails with the plain reason "This version of Claude Code offers a sign-in Ogden Agents can't run."
- The PTY env is the agent env allowlist (`start.ts` `agentEnvironment` plus `extraAgentEnv`), plus `CLAUDE_CODE_EXECUTABLE` from `findClaudeExecutable` and `TERM`. PTY columns are ≥ 1000 so the URL never wraps.
- The URL is taken from the output with ANSI/OSC stripped (OSC 8 links included). It must be `https:` on a host in an injectable allowlist (default `claude.ai`, `claude.com`, `anthropic.com` and their subdomains).
- One sign-in per agent: a new one cancels the old. Cancel, a 10-minute timeout and server stop all kill the PTY. A node-pty load failure is a `failed` state with its reason, and the app keeps running (AD-19).
- Core names no agent (AD-1). Only core appends events (AD-11).

**Never:**
- ACP `authenticate` for Claude (terminal methods are client-run). API keys (9.2), install (9.3), sign-in-again (9.4), Welcome (9.5), the terminal toggle (epic 3).
- Editing `claude-code-agent.ts` (2.7) or showing a terminal.
- A real account in automated tests. They run a fake login program only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Sign in | Card: needs sign-in; click | `{state:'signing_in', url}`. The tab opens, the card reads "Finish signing in in the tab that just opened." with Cancel. After exit 0 and `loggedIn:true`: `signed_in` event, "Installed, signed in" | — |
| Cancel | DELETE sign-in | PTY killed. `needs_sign_in` | Idempotent 204 |
| Login fails | exit ≠ 0, or `loggedIn:false` | `failed` with "Claude Code couldn't finish signing in. Try again." | Output never logged |
| No URL | none within 30 s | `failed` with a plain reason, PTY killed | — |
| Bad method | unexpected id, args or env | `failed` with the reason above, nothing spawned | — |
| PTY unavailable | `import('node-pty')` throws | Card shows "Sign-in isn't available on this computer: <reason>". The rest of the app works | Detail goes to the log |
| Not installed | adapter or CLI missing | `install: 'not_installed'`, no Sign in button | — |
| Unknown agent | `/agents/nope/sign-in` | 404 | — |
| Paste code | Signing in; user pastes the code | Code written to the PTY; completion as for Sign in | Bad charset or length: 400; none in flight: 409; code never logged |

## Decisions

- PTY (user, 2026-09-30): `node-pty` 1.1.0 as an optional dependency. On Linux without build tools, subscription sign-in shows the plain reason; the API key arrives in 9.2.
- Sign-in tab (user, 2026-09-30): the UI opens it. The server suppresses the CLI's own browser open (e.g. `BROWSER` env) only if the live probe shows that works; otherwise the UI falls back to a link.
- Paste code (user, 2026-09-30): add it now. `submitCode` on the setup adapter, a new `API_ROUTES` entry `agentSignInCode` (`POST /api/v1/agents/:agentId/sign-in/code`, `{code}`, 204, `no-store`) behind the gate, and a paste field on the card. The code is validated (1 to 512 chars of `[A-Za-z0-9._#~-]`, else 400 without echoing it), written to the PTY followed by `\r`, and never logged, evented or stored (AD-16). Without a sign-in in flight it answers 409.

</frozen-after-approval>

## Code Map

- `packages/core/src/agent-setup-port.ts` -- `AgentSetupPort`, `AgentSignIn {url, done, cancel, submitCode?}`. Unchanged. `core/src/toolchain.ts` -- the pattern for a lifecycle service that appends events (1.8).
- `packages/shared/src/setup.ts` (`AgentSetupStatus`, `SignInResponse`), `events.ts:488` (`agent.auth_changed` on `AGENTS_STREAM`, states `signed_in|needs_sign_in|signing_in|failed`).
- `packages/server/src/agent-setup-routes.ts` -- 501 stubs. Its route comments carry the old numbering; fix them. Also `app.ts` (`agentSetup` option) and `start.ts:374` (memory stub default; `agentEnvironment`, `extraAgentEnv`, `CLAUDE_ACP_PATH_ENV`).
- `packages/adapters/src/acp-claude-code/` -- `resolveClaudeAgentAcp`, `findClaudeExecutable` (detect.ts), `mask.ts`, and `listAuthMethods` (unvalidated pass-through; read only).
- `packages/adapters/src/setup-memory/index.ts` -- the stub, kept for tests.
- claude-agent-acp 0.84 `dist/acp-agent.js:1171-1240`: methods `claude-ai-login` and `console-login`, plus `claude-login` (`--cli` TUI) when SSH or `NO_BROWSER` env is set. The allowlisted env never passes those. `dist/index.js`: `--cli` spawns `claudeCliPath()`, which honours `CLAUDE_CODE_EXECUTABLE`.
- Claude CLI 2.1.285: `auth login` prints "If the browser didn't open, visit: <OSC-8 URL>", then "Paste code here if prompted > ". It completes through a localhost callback and prints "Login successful.". `auth status --json` returns `{loggedIn, …}`.
- node-pty 1.1.0 (MIT, Microsoft; the Stack pin) ships N-API prebuilds for darwin x64/arm64 and win32 x64/arm64 only. On Linux it runs `node-gyp rebuild`.
- `packages/shared/src/api.ts:105` (`agentSignIn`); `packages/server/test/gate.test.ts:542` `EXPECTED_API_ROUTES` (exact enumeration) and `stub-routes.test.ts`.
- Rechecked against build base `82a7c97` (story 2.7): `claude-code-agent.ts` changed only in reopen; `listAuthMethods` unchanged. `start.ts` exports `agentEnvironment` (line 86); `agentSetup` default at line 374. `fake-acp-agent.mjs` gained `FAKE_ACP_REOPEN_FAIL` (2.7); its `FAKE_ACP_AUTH` block is at line 110.
- `packages/web/src/routes/agents-settings-page.tsx` (stub), `shell/status-sidebar.tsx` `SettingsMenu` (has no Agents item). Story 2.11 (being built now) also rewrites this file: add only the one menu item, after 2.11 lands.
- `tests/fixtures/fake-acp-agent.mjs` -- `FAKE_ACP_AUTH=terminal` advertises a `fake-login` shape.

## Tasks & Acceptance

**Execution:**
- [x] `package.json`, `packages/adapters/package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` -- add `node-pty` 1.1.0 as a root `optionalDependencies` entry plus an adapters dependency. Allow its build in `allowBuilds`.
- [x] `packages/adapters/src/terminal-pty/index.ts` (new) -- `loadPty()` (a memoized dynamic import that returns `{ok, reason}`) and `spawnHidden(file, args, {env, cwd, cols, rows})` → `{onData, onExit, write, kill}`. It attaches every error handler, and `kill` takes no signal on Windows. Epic 3 reuses it.
- [x] `packages/adapters/src/setup-claude-code/` (new) -- `auth-method.ts` (the validation), `sign-in-output.ts` (strip escape sequences, find the allowlisted URL), `index.ts` (`submitCode` writes to the PTY) `createClaudeCodeSetup({adapterPath, nodePath, env, listAuthMethods, loadPty, allowedHosts, timeouts})`. `status()` runs `--cli auth status --json` through `execFile`, with no shell and a 5 s limit. `install()` rejects "not yet" (9.3).
- [x] `packages/shared/src/api.ts`, `setup.ts` -- `agentSignInCode` route and `SignInCodeRequest` (charset and length as in Decisions).
- [x] `packages/core/src/agent-setup.ts` (new) -- `createAgentSetup(events, ports)`: `list()`, `signIn(id)`, `submitCode(id, code)`, `cancelSignIn(id)`, `dispose()`. It appends `agent.auth_changed` with no URL and allows one sign-in in flight per agent.
- [x] `packages/server/src/agent-setup-routes.ts`, `app.ts`, `start.ts` -- GET agents, POST sign-in (no-store), DELETE sign-in, POST sign-in code (no-store; body limit; never logged). Wire the real adapter when an adapter path resolves, else the memory stub. Call `dispose()` on stop.
- [x] `packages/web/src/agents/agent-setup-api.ts`, `agent-card.tsx` (new), `routes/agents-settings-page.tsx`, `shell/status-sidebar.tsx` (the Agents menu item) -- the card, and `useSignIn(agentId)` for 9.4 and 9.5. The click opens `window.open('', '_blank')` synchronously, then sets `opener = null` and the location. If the popup is blocked, show a link with `rel="noopener noreferrer"`. While signing in, a labelled "Paste the code" field with Send. The card refreshes on `agent.auth_changed`. The `shell/status-sidebar.tsx` Agents menu item followed once story 2.11 landed (next item).
- [x] `shell/status-sidebar.tsx` -- the Agents item in the Settings menu (added after story 2.11 landed, on `424a1bc`).
- [x] `tests/fixtures/fake-claude-login.mjs` (new) -- handles `--cli auth login` (prints ANSI and an OSC-8 URL containing a localhost callback, then serves `/callback`, writes a state file and exits 0) and `--cli auth status --json`. `FAKE_LOGIN_MODE=fail|hang|nourl|code` (`code` completes only when the expected code arrives on stdin).
- [x] `tests/fixtures/fake-acp-agent.mjs` -- additive: `FAKE_ACP_AUTH=claude-terminal` advertises the real method shape, and `--cli` delegates to the fake login program.
- [x] Tests:
  - `packages/adapters/test/setup-claude-code.test.ts`: validation, URL parsing, and every matrix row through an injected fake PTY. One real-PTY run of the fake program is required when `CI` is set.
  - `packages/core/test/agent-setup.test.ts`: events never contain the URL.
  - `packages/server/test/agent-setup-routes.test.ts`: no-store, 401/403, 404, code 400/409, `gate.test.ts` enumeration updated, and a log capture free of URL and output.
  - `tests/e2e/agents-settings.spec.ts`: `context.route('https://claude.ai/**')` redirects to the fake callback; asserts the card reaches "Installed, signed in"; the load-failure path.

**Acceptance Criteria:**
- Given `pnpm run pack && pnpm smoke` on each OS, when node-pty is absent or fails to load, then the app starts and the card shows the reason.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm e2e` -- expected: all pass on macOS, Windows and Linux CI.
- `pnpm run pack && pnpm smoke` -- expected: exit 0, including with the optional dependency omitted.

**Manual checks (hitl, the person with approval):** On their machine, with approval, the user runs `claude auth logout`, then clicks Sign in with your account in Settings: Agents and finishes on the provider's page. Expected: no terminal opens, the card reads signed in, and a chat works. Record which tab opened, whether the CLI opened its own tab, and whether `BROWSER` suppressed it. The agent never runs the real login.

## Implementation Notes

- **Sign-in tab.** `createClaudeCodeSetup({ cliBrowser })` / `start({ claudeCliBrowser })` sets `BROWSER` for the CLI only when given; it is unset by default because no live probe has proven it. `AgentSetupStatus` gained `signInTab: 'page' | 'agent'`: with `page` the card opens `window.open('', '_blank')` in the click, cuts `opener` and sets the location; with `agent` (the default) the CLI opens its own tab and the card shows "Open the sign-in page" (`rel="noopener noreferrer"`). A blocked popup also falls back to the link. Static reading of CLI 2.1.285 shows it reads `BROWSER` and treats `"true"` specially; the human check decides.
- **Failure reasons.** The port is unchanged: `signIn()` rejects with core's `AgentSetupError` (plain message) when it can't start (no PTY, bad method, no URL in 30 s, spawn error); core turns it into `failed` with that reason. Failures after the URL (exit ≠ 0, `loggedIn:false`, 10-minute timeout) use core's "<agent> couldn't finish signing in. Try again." `list()` overlays `signing_in` and the last failure.
- **Additions.** API error code `sign_in_not_pending` (409); core `SignInNotPendingError`. `node-pty` is an `optionalDependencies` entry in both the root and `packages/adapters` (a packaging test pins it and forbids it in `dependencies`). `allowBuilds: node-pty: true` is required (pnpm 12 fails with `ERR_PNPM_IGNORED_BUILDS` otherwise).
- **node-pty 1.1.0 packaging bug.** Its macOS prebuilt `spawn-helper` ships without the execute bit ("posix_spawnp failed"); `loadPty` sets it on first load when missing.
- **Tests never reach the real adapter.** The server test helper and `tests/support.ts` `startServer` now default `claudeAdapterPath` to the fake agent, since a dev install resolves the real claude-agent-acp from `node_modules`.
- **Smoke.** `scripts/smoke-installed.mjs --omit-optional` installs with `npm_config_omit=optional`; CI runs it after the normal smoke.
- **Rebased** onto `424a1bc` (2.10a, with 2.11); the Settings menu's Agents item was added then.

## Review Triage Log

- **F1 (medium), fixed.** Two sign-ins started close together could orphan a PTY. Each sign-in now claims a generation before its first await, and one superseded after an await spawns nothing. Every live terminal is kept in a set that `close()` kills. Cancel and the 10-minute timeout always stop their own terminal (killed once), whether or not it is still the running one. Test: "two sign-ins started together orphan no terminal".
- **F2, fixed.** A sign-in URL with an explicit port is refused (`url.port === ''`). Tests in "reading the sign-in URL".
- **F3, fixed.** The POSIX group kill and `taskkill` run only for `Number.isInteger(pid) && pid > 0`. Test: "never signals a process group for a pid that is not a positive integer".
- **F4, fixed.** `taskkill` runs by absolute path, `%SystemRoot%\System32\taskkill.exe` (fallback `C:\Windows`).
- **F5, fixed.** The `list_auth_methods` diagnostic logs only the error's code, never its message. `check_auth_method` logs only ids matching `/^[a-z-]{1,40}$/` and counts the rest. Test: "a failed listing logs a code…".
- **F6, fixed.** A failed `spawn-helper` chmod is reported as `helperRepairFailed` (the error code only) and logged as a `load_pty` diagnostic. Test: "…logged by its code only".
