---
title: 'Detect and install Claude Code from the UI'
type: 'feature'
ticket: '3'
created: '2026-09-30'
status: 'built'
baseline_revision: '48f1902eca8e4441386eb95c09da5ec9f99dbeb6'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-foundation-and-forks/story-uv-bootstrap-plan.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-first-run-onboarding/story-use-an-api-key-instead-kept-in-the-keychain-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An installed `ogden-agents` has no Claude Agent ACP adapter, which is a devDependency by the 2.2 decision. So Settings: Agents shows the memory stub, Install answers 501, and npm users can't chat.

**Approach:** `setup-claude-code` detects the adapter and a usable `claude`, and reports versions. On Install, the server runs a pinned, integrity-checked `npm ci` into a temp folder inside Ogden's data folder and renames it into place. Progress and errors stream to the card as `agent.install_*` events, reusing 1.8's pattern.

## Boundaries & Constraints

**Always:**
- Install only under `<dataDir>/agents/claude-code/`, with npm's cache inside the temp folder. Run `process.execPath` plus `npm-cli.js` found beside Node (no shell, no `.cmd`), with `--ignore-scripts --no-audit --no-fund` and inherited `npm_*` variables dropped.
- Pinned `package.json` and `package-lock.json` (every package has `integrity`). A mismatch fails with nothing installed.
- One install at a time. Stale `.install-*` folders are removed at start. Server stop kills the npm process and removes its work folder.
- Adapter path order: `OGDEN_AGENTS_CLAUDE_ACP_PATH`, then the dev `node_modules`, then the data-folder install. It is read at each agent start and each status call, so a new install works without a restart.

**Never:**
- A global or system-wide install, a `PATH` or profile change, admin rights, or any write outside the data folder.
- Real downloads in unit or e2e tests.
- Uninstall or update flows.
- A real install on the user's machine during the build. That is the HITL live check.

**Decisions (user, 2026-09-30):**
- When no usable `claude` is found, install the adapter with the SDK's bundled binary (about 230 MB). When one is found, install it without the binary (about 60 MB) and pass the user's `claude` through `CLAUDE_CODE_EXECUTABLE`. Everything goes under `<dataDir>/agents/claude-code/`.
- Pin an exact version in the lockfile, with integrity. `agent-pins --update` bumps it in a PR.
- The card shows "about 60 MB" or "about 250 MB" beside Install, whichever applies (coordinator's call, consistent with the above).
- 2026-09-30 (user): where Install finds npm, in order: (1) `npm-cli.js` beside Node; (2) the npm that launched Ogden Agents, `npm_execpath` captured at server start, accepted only as an absolute path to an existing `npm-cli.js` (or npm's `npx-cli.js`, using its sibling `npm-cli.js`); (3) an `npm` on an absolute `PATH` entry (never a relative entry or the cwd), resolved to its `npm-cli.js`. Always run with `process.execPath`, no shell.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Detect | Adapter in the data folder and a user `claude` | `installed`, with the version | — |
| Absent | No adapter anywhere | `not_installed` and Install | — |
| Install | Click Install | 202, then progress, then "Installed, needs sign-in" | — |
| No `claude` | Adapter installed without a binary, user's `claude` gone | `not_installed`, "Claude Code isn't found" | Install again |
| Integrity | A tarball doesn't match the lock | `agent.install_failed`, plain words, no folder left | The log gets the npm code only |
| No npm | `npm-cli.js` not beside Node | Failed: "Ogden Agents couldn't find npm" | — |
| Offline or stalled | No output for 60 s, or a network error | Failed, work folder removed | Try again |
| Twice | A second Install while one runs | 202 with the running status, no second npm | — |

</frozen-after-approval>

## Code Map

Baseline: `story/2.12-refactor-sweep` @ `0978860` (2.12 on 9.2 `5d7fb1a`, PR #28). 9.2 added `apiKey` to `setup-claude-code/index.ts`, core `agent-setup.ts`, `start.ts` and `agent-card.tsx`. 2.12 added `web/src/api/http.ts`.

- `packages/adapters/src/toolchain-uv/uv-toolchain.ts` -- the pattern to follow: `.install-` via `mkdtempSync`, `renameWithRetry` (`:390`, export it), stale cleanup, and the idle timeout. `check-uv-pins.mjs` and the `uv-pins` CI job are the model for pin checks.
- `packages/core/src/toolchain.ts` `createToolchain` -- single-flight install, throttled progress (`PROGRESS_INTERVAL_MS`) and the failure log. Mirror it as `AgentSetup.install(agentId)` in `packages/core/src/agent-setup.ts`.
- `packages/core/src/agent-setup-port.ts` `install(onProgress)`. `shared/src/events.ts` already has `agent.install_{started,progress,completed,failed}`. `shared/src/api.ts` has `agentInstall` (202 `AgentSetupStatus`).
- `packages/server/src/agent-setup-routes.ts:58` `notImplemented` → real route. `start.ts:435` computes `claudeAdapterPath` once, and `:452` falls back to `createMemoryAgentSetup` when it's absent. Make it a getter and always wire `createClaudeCodeSetup({ dataDir })` in real runs.
- `packages/adapters/src/setup-claude-code/index.ts` `status()` and `install()` (it throws today). `adapter()` checks `existsSync` on a fixed path.
- `packages/adapters/src/acp-claude-code/claude-code-agent.ts` `resolveClaudeAgentAcp`, `adapterPath` (spawn at `:153`). `detect.ts` `findClaudeExecutable`.
- `packages/web/src/agents/agent-card.tsx` `AgentState` (Not installed branch). `agent-setup-api.ts`: switch it to `@/api/http` (2.12 deferred item). The progress UI follows `web/src/toolchain/use-uv-status.ts`.
- Researched 2026-09-30:
  - `@agentclientprotocol/claude-agent-acp` 0.84.0 (Node ≥ 22) depends on `@anthropic-ai/claude-agent-sdk` 0.3.284. The SDK's optional platform binaries are 225–246 MB each.
  - `npm ci --omit=optional --ignore-scripts` of a 0.84.0 lock gives 105 packages, about 60 MB on disk, with every lock entry carrying `integrity`.
  - `@anthropic-ai/claude-code` 2.1.286 is a wrapper with a `postinstall` that copies its 225–245 MB platform binary. The adapter needs no install script.

## Tasks & Acceptance

**Execution:**
- [x] `packages/adapters/src/setup-claude-code/pins/{package.json,package-lock.json}` (new) and `scripts/agent-pins.mjs` (new). `--update` regenerates the lock for a version. `--check` runs a real `npm ci` into a temp folder and checks the entry exists. CI job `agent-pins` runs it on all three OSes.
- [x] `packages/adapters/src/setup-claude-code/install.ts` (new) -- `findNpmCli`, `installedAdapter(dataDir)` and `installAdapter({ dataDir, withBinary, onProgress, runNpm? })`. Steps: work folder, write the pins, `npm ci`, then check that `dist/index.js` exists and the version equals the pin. Rename into `adapter-<version>[-bundled]`. Progress counts `--loglevel http` tarball fetches against the lock's package count.
- [x] `setup-claude-code/index.ts` -- `dataDir` option. `adapterPath` becomes a getter. `status()` also requires a usable `claude` (the user's, or the bundled binary) and reports `version`. `install()` uses `install.ts`. `close()` stops a running install.
- [x] `acp-claude-code/claude-code-agent.ts` -- accept `adapterPath: string | (() => string | undefined)`.
- [x] `packages/core/src/agent-setup.ts` -- `install(agentId)`: single flight, events, the failure log, then refresh the status.
- [x] `packages/server/src/agent-setup-routes.ts` and `start.ts` -- the route and the wiring above.
- [x] `packages/web/src/agents/agent-card.tsx` and `agent-setup-api.ts` -- Install with its size ("about 60 MB" when a `claude` is found, else "about 250 MB"; from a new optional `installSize: 'small' | 'large'` in `shared/src/setup.ts` `AgentSetupStatus`, set by the port), progress, the failure reason, and Try again.
- [x] Tests:
  - Adapter unit tests with a fake `runNpm` (EINTEGRITY, stall, cleanup, no npm).
  - Stop rule: `HOME`, `USERPROFILE` and `npm_config_prefix` set to temp folders that stay empty.
  - Core single-flight, and the server route.
  - `tests/fixtures/fake-adapter/` packed at test time into a local `file:` lock. `tests/e2e/agents-settings.spec.ts` then runs the offline path: Not installed → Install → progress → "Installed, needs sign-in".
- [x] `deferred-work.md` -- close 2.12's `agent-setup-api` item.

**Acceptance Criteria:**
- Given CI on each OS with no adapter present, when Install is clicked with the fixture lock, then the card reads "Installed, needs sign-in" and a chat starts through the installed adapter.
- Given any install run, then nothing is written outside the temp data folder.

## Implementation Notes

- Pins: `@agentclientprotocol/claude-agent-acp` 0.84.0, 113 lock entries, all `integrity` + registry.npmjs.org `resolved` (generated with `agent-pins --update 0.84.0`; `--update` forces the public registry so a user mirror never lands in the lock). `--check` and `--check --with-binary` both passed locally (darwin-arm64); CI job `agent-pins` runs both on the three OSes.
- `install.ts`: `findNpmCli({ execPath, launcherNpm, pathEnv, platform, exists, realpath })` follows the 2026-09-30 decision: beside Node (as given and its real path), then `launcherNpm` (`start.ts` passes `process.env.npm_execpath` read at start; the launcher passes its full environment to the background server), then `npm`/`npm.cmd` on absolute `PATH` entries resolved through their real path to `npm-cli.js` (a symlink to it, or `<bin>/node_modules/npm` / `<bin>/../lib/node_modules/npm`). The found `npm` itself is never run. Tests use a fake file system for every step, including relative `PATH` entries being ignored. npm runs as `process.execPath npm-cli.js ci --ignore-scripts --no-audit --no-fund --no-update-notifier --no-progress --color=false --loglevel http [--omit=optional]`, no shell, `npm_*` dropped, `npm_config_cache` in the temp folder (npm's `_logs` land there too). Folders: `adapter-<v>` / `adapter-<v>-bundled`; rename via the exported `renameWithRetry` (10 attempts), the old copy moved aside and restored on failure.
- Deviation: the idle timeout also counts growth of npm's cache as progress (a 230 MB tarball prints no line until it is fully fetched, so "no output for 60 s" alone would fail slow but healthy downloads).
- Deviation: `installedAdapter` prefers the pinned version (bundled first), then falls back to the newest other installed version, so a pin bump in a release doesn't silently turn an installed agent into "Not installed".
- Contract additions (shared `AgentSetupStatus`): `installSize` (per plan) and `progress: { step, percent }` while installing, so REST shows progress the way uv's status does. Core `AgentSetupError` gained `details` (log only: step, npm code); `start.ts` logs them as `agent setup step failed` (renamed from `agent sign-in step failed`).
- Stale `.install-*` folders are removed when the setup port is created (server start) and at each install start. Server stop: `claudeSetup.close()` aborts npm, then `agentSetup.settled()` (bounded 10 s) so the work folder is gone before the server finishes stopping.
- New start options (tests): `claudeInstall` (`pins`, `npmCli`, `runNpm`, `env`, `idleTimeoutMs`, `devAdapter: false`) and `claudeExecutable`. `claudeAdapterPath` accepts `undefined` explicitly.
- Tests: adapter unit tests with a fake runner plus two real-npm offline tests on the packed fixture (the stop rule: `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `npm_config_prefix` temp folders stay empty; a tampered integrity gives EINTEGRITY). `tests/fixtures/fake-adapter/pack.mjs` has `testNpmCli()`, which, unlike the app, also follows an `npm` on `PATH` (for a Node without npm beside it).

## Plan Change Log

- 2026-09-30 (epic 2 retrospective, action A4): `baseline_revision` backfilled with `48f1902`, the parent of the story's first commit `b944a79` (story 9.3); it wasn't recorded when the build started.

## Review Triage Log

2026-09-30 review (no High or Medium findings):

- F1 (fixed): `scripts/agent-pins.mjs` fails `--update` and `--check` unless every lock entry has `integrity` and a `resolved` URL starting `https://registry.npmjs.org/`; `--update` runs npm with empty temp `--userconfig` and `--globalconfig` files, so the machine's registry, proxy or auth never shape the pins (regenerated 0.84.0: byte-identical). Unit test `the shipped pins …` asserts every entry's `resolved` host and `integrity` format.
- F2 (kept as decided): the install still honours the user's and global `.npmrc` (registry mirror, proxy, CA), which the frozen Design Notes chose so corporate networks work. It can't weaken the pins: `npm ci` checks every tarball against the lock's `integrity` whatever registry served it, and integrity checking can't be turned off by configuration.
- F3 (fixed): a spawn failure is recorded by its errno code only (`errnoCode`: `ENOENT`, else `unknown`), never `String(error)`, which can hold paths; the `prepare` and `rename` steps and npm's `code` line are read the same way (a code pattern only). Tests: adapter (real runner with a missing Node, a chatty runner, a junk code line) and server (`no path reaches the log or an event`).
- F4 (fixed): the copy moved aside during a swap goes to `<work>/previous/<folder name>`; stale-folder cleanup (server start and install start) moves it back when nothing has taken its place, and only then removes the temp folder. Test: `a crash mid-swap leaves the old copy …`.
- F5 (rejected): an attacker-controlled `npm` on an absolute `PATH` entry, a spoofed `npm_execpath`, or install folders planted in the data folder all need write access to the user's own account (their `PATH`, their launch environment or their data folder), which already lets them run code as the user. Out of scope for the local single-user threat model (AD-15, AD-16).

## Design Notes

A lockfile plus `npm ci` gives version and integrity pins for the whole tree, respects the user's `.npmrc` registry and proxy, and needs no hand-written downloader. `withBinary` (optional dependencies kept) applies only when no usable `claude` is found. With a user `claude`, the adapter always gets `CLAUDE_CODE_EXECUTABLE`.

HITL: the user clicks Install on a real machine, with and without `claude`, and then chats.

## Verification

**Commands:**
- `pnpm typecheck && pnpm test` -- expected: green.
- `pnpm e2e` -- expected: the Install test passes offline.
- `node scripts/agent-pins.mjs --check` -- expected: 0 (network).
