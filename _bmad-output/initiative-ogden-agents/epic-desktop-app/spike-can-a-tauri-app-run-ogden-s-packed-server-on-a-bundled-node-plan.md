---
title: 'Spike: can a Tauri app run Ogden''s packed server on a bundled Node on all three OSes?'
type: 'chore'
ticket: '1'
created: '2026-10-04'
status: 'built'
baseline_revision: '0c61df5430f05567c544c13202e657c4ad818295'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-desktop-app/epic-desktop-app.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 13 (Ogden as a Tauri 2 desktop app with a bundled Node) rests on unknowns: whether Node 24's native modules (better-sqlite3, @napi-rs/keyring, node-pty) load from app resources on every target, whether the sidecar's children survive a kill (especially on Windows), whether the bundled npm is found for agent installs, whether AD-15 holds inside the webview, and whether the updater works on an unsigned app. Nothing else in the epic is built until the user says go or no-go on measured answers.

**Approach:** A TEMPORARY minimal Tauri 2.12.1 shell (`apps/desktop-spike/`) and a TEMPORARY CI workflow matrix (macOS arm64, Intel and universal; Windows x64 and ARM64; Linux x64 and arm64 on Ubuntu 22.04) that stages the pinned, SHA-256-checked official Node 24.21.0 as the `externalBin` sidecar plus the packed `ogden-agents` tarball's production install as resources, builds every bundle format, installs and launches it, and records the answers as JSON, a job summary and downloadable test builds (workflow artifacts). Findings, numbers and a GO/NO-GO recommendation go into this plan.

## Boundaries & Constraints

**Always:** user decisions of 2026-10-04: Tauri 2 (2.12.1, updater plugin 2.12.0), official Node 24 LTS binary as sidecar, npm and node-pty bundled, unsigned (ad-hoc on macOS) builds, quit stops only the app's own server, no tray, universal macOS dmg tried, npm route untouched. AD-15 in the webview: no Tauri capability or IPC granted to web content, navigation locked to the server origin, window opens on the one-time code URL from `/launcher/hello?launch=1` with the launcher token. Updater dry run uses a THROWAWAY key generated inside the job, never a user key. Spike builds use their own data folder by default, never the user's real one.

**Never:** secrets, real agents, publishing, releases, tags, merges; changes to the server, web UI or npm package; Node SEA as the runtime (re-checked only).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Cold launch | installed app, empty data dir | server up, window loads `/#c=<code>`, tab token minted, WS opens | timings recorded; failure recorded, job continues |
| Off-origin navigation | webview `location.href = https://example.com` | blocked by the shell, page stays | recorded |
| Quit, tree kill | grandchild under the server | no node or grandchild left | survivors listed, then cleaned |
| Quit, direct kill | same | survivors recorded (finding) | cleaned |
| Shell crash | shell hard-killed | Windows job object kills tree; POSIX survivors recorded | cleaned |
| Tampered update | `latest.json` with a wrong signature | refused, N still runs | recorded |
| Good update | N=0.0.1 → N+1=0.0.2 | installs, relaunches as 0.0.2 | recorded |

</frozen-after-approval>

## Code Map

- `packages/server/src/serve.ts` -- background server entry `dist/serve.js [--port] [--web-root]`; data dir from `OGDEN_AGENTS_DATA_DIR`. Spawned by the shell exactly as `launcher.ts` `startServer` does (no changes).
- `packages/server/src/launcher.ts`, `launcher-token.ts` -- handshake: read `<dataDir>/server.json` (`{port,pid}`) and `<dataDir>/launcher.token`, `GET /launcher/hello?launch=1` with header `x-ogden-launcher-token` → `launchUrl`.
- `packages/server/src/app.ts` -- `/api/v1/tab` (204 with `Authorization: Bearer <tab token>`), WS `/ws` subprotocols `ogden.v1` + `ogden.auth.<token>`; tab token in `sessionStorage['ogden-agents.tab-token']`.
- `packages/adapters/src/setup-claude-code/install.ts` `findNpmCli` -- beside execPath, then `npm_execpath` (read at server start, `start.ts:292`), then PATH. The shell sets `npm_execpath` to the bundled `npm-cli.js`.
- `packages/adapters/src/process-tree.ts` -- `killProcessTree` semantics (taskkill /T /F; SIGKILL to process group) mirrored in Rust.
- `.github/workflows/ci.yml` -- setup pattern reused (pnpm/action-setup@v6, setup-node@v7, checkout@v7); `pnpm run build && pnpm pack` makes the tarball.
- `scripts/check-provenance.mjs` -- this plan's `baseline_revision` must stay an ancestor of HEAD.

## Tasks & Acceptance

**Execution:**
- [x] `apps/desktop-spike/src-tauri/*` -- minimal shell (Cargo.toml, tauri.conf.json, build.rs, src/main.rs, entitlements, placeholder frontend): spawn sidecar, handshake, window on launch URL, navigation lock, no capabilities, kill modes, Windows job object, webview probe via blocked same-origin navigation, updater dry run, JSON-lines report -- the thing under test.
- [x] `apps/desktop-spike/scripts/stage.mjs` -- pinned Node table (version + sha256 per target), download/verify/extract, sidecar + npm placement, production install of the tarball with the bundled npm, native-module load check, SEA re-check, icon PNG -- reproducible staging.
- [x] `apps/desktop-spike/scripts/harness.mjs` -- install/launch per OS, cold start, memory, runs A (tree kill) / B (direct kill) / C (crash), updater bad+good, WebView2 / webkit2gtk versions, sizes; writes `findings-<leg>.json` and the job summary.
- [x] `.github/workflows/desktop-spike.yml` -- TEMPORARY matrix; uploads test builds and findings as artifacts; removed (moved under `apps/desktop-spike/ci/`) before the final commit.
- [x] this plan -- findings, numbers, GO/NO-GO, Needs you.

**Acceptance Criteria:**
- Given the spike branch is pushed, when the workflow runs, then every leg's log and findings JSON answer each question in the ticket (or record why a leg could not).
- Given the final commit, when `.github/workflows/` is listed, then no desktop-spike job remains.

## Implementation Notes

- Implemented directly in this session rather than by a context-free subagent: the work was a CI iteration loop (push, read logs, fix), which needs pushes that step 3 forbids a subagent, and the design lived in this session.
- Seven CI iterations. Fixes found on the way: Windows needs `System32\tar.exe` for the Node zip (Git Bash's tar fails); a universal macOS build needs the per-arch sidecars too (`ogden-node-aarch64-apple-darwin`, `-x86_64-apple-darwin`) beside the lipo'd one; linuxdeploy fails on musl `.node` files, so foreign prebuilds are pruned (better-sqlite3 13 ships every OS's binary, node-pty ships macOS and Windows ones); the N+1 build must start from an empty bundle folder; Linux runners need a session D-Bus (`dbus-run-session`) or GTK waits 25 s at start; `tasklist` fallback for process listing on the Windows ARM64 runner.
- Decision (keep or remove): the spike code stays in `apps/desktop-spike/`, every file marked SPIKE 13.1, as 13.2's reference (staging, pinned Node table, sidecar spawn, navigation lock, job object, updater dry run, harness). The temporary workflow is moved out of `.github/workflows/` to `apps/desktop-spike/ci/desktop-spike.yml`, so no job runs; 13.2 copies what it needs into `packages/desktop/` and the real CI jobs, then deletes `apps/desktop-spike/` (13.12's sweep at the latest).

## Plan Change Log

## Review Triage Log

Pass 1 (quick lens, before the last CI run): high 3, medium 5, low 5, false 0, maybe-false 0. Patches applied in `Spike 13.1: review fixes`; findings below in report order.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | Plan has no findings yet | medium | patch | Written below after the final run. |
| 2 | Workflow still in `.github/workflows/` | medium | patch | Moved to `apps/desktop-spike/ci/` in the final commit. |
| 3 | N+1 bundle dir keeps N's files, so N can be served as N+1 | high | patch | Confirmed on Windows run 37260779253 (updater refused "signed for 0.0.1 but announced 0.0.2"). Bundle folder now emptied before the N+1 build. |
| 4 | Windows good update can't report `update_installed` | medium | patch | Harness now takes the first app's outcome or a relaunch; the exe version is the fallback evidence. |
| 5 | Tree kill can't show agents surviving (agents are `detached` on POSIX) | high | patch | Stand-in now spawned like `claude-code-agent.ts`; final run shows it survives a group kill on macOS and Linux (a finding for 13.5). |
| 6 | Natives never loaded from the installed bundle | medium | patch | `nativesFromInstall` loads all three with the installed sidecar from the installed resources while the app runs. |
| 7 | npm check copies rule 2 only; rule 1 may find a distro npm beside `/usr/bin` on the `.deb` | medium | defer | Recorded as a finding for 13.4 (stage npm where rule 1 finds it, or put the sidecar outside `/usr/bin`). |
| 8 | Server not spawned with `cwd: dataDir` | medium | patch | `current_dir(&data_dir)` added. |
| 9 | Spike honours an inherited `OGDEN_AGENTS_DATA_DIR` | low | patch | Only spike runs (report set) read it now. |
| 10 | Quit only after a successful probe | low | reject | A failed probe shows as an empty `serverStopped` and a missing probe in the findings; no run hit it. |
| 11 | `APPIMAGE_EXTRACT_AND_RUN` exported job-wide | medium | patch | Removed (the bundler passes `--appimage-extract-and-run` to linuxdeploy itself). |
| 12 | Quarantine can't be tested in CI | low | defer | Recorded under Needs you (the user's own Mac). |
| 13 | Missing `error` handlers | low | patch | Added to the grandchild, the harness's child streams, file stream and HTTP server. |
| 14 | Retry not in the shared helper | low | reject | Temporary spike code outside the product; 13.4's real staging uses the shared helper. |
| 15 | Cargo pins incomplete, lock ignored | low | defer | Each run uploads `Cargo.lock`; 13.2 pins the toolchain and commits the lock. |

## Design Notes

The webview has no IPC, so the shell learns probe results through a same-origin navigation to `/__spike_probe?d=<json>` that `on_navigation` records and cancels. All spike behaviour is behind `OGDEN_SPIKE_*` environment variables; without them the build behaves as a plain app (own data folder under the app data dir, closing the window quits and stops the server).

## Verification

**Commands:**
- `gh run view 37262481915 -R hsmith-dev/ogden-agents` -- expected: seven green legs, each with `findings-<leg>` and `ogden-desktop-spike-<leg>` artifacts (done).

**Manual checks (if no CLI):**
- The user opens the unsigned macOS / Windows / Linux test build, gets past Gatekeeper / SmartScreen, signs in, chats, quits (see Needs you).

## Findings

Measured in CI run [37262481915](https://github.com/hsmith-dev/ogden-agents/actions/runs/37262481915) (commit `fb4bf6e`, all seven legs green), with earlier runs for the history. Per-leg JSON: the `findings-<leg>` artifacts. Test builds: the `ogden-desktop-spike-<leg>` artifacts (30-day retention). Tauri 2.12.1, updater plugin 2.12.0, Node 24.21.0 (SHA-256 checked per target, table in `stage.mjs`), npm 11.19.0, Rust stable.

**Recommendation: GO**, with two things the later entries must handle (both below): on macOS and Linux, Quit must stop agents through the server or a descendant walk, because a process-group kill leaves them running; and on Windows the app must relaunch itself after an update. Every question in the ticket has an answer and none of them is a blocker.

### Per OS

| Leg (runner) | Download | Installed | Cold start to first page | Warm | Memory (shell + server + webview) | Webview |
|---|---|---|---|---|---|---|
| macOS arm64 (macos-latest, 26.6) | dmg 53 MB | 178 MB | 2.7 s | 1.8 s | 538 MB (99 + 280 + 159) | WebKit 21624 |
| macOS universal (same) | dmg 96 MB | 306 MB | 2.8 s arm64; 19.8 s for the Intel slice under Rosetta | 1.9 s | 535 MB | WebKit 21624 |
| macOS x64 (macos-15-intel, 15.7) | dmg 55 MB | 182 MB | 14.3 s first launch | 2.5 s | 388 MB | WebKit 20621 |
| Windows x64 (windows-latest) | NSIS 36 MB, MSI 59 MB | 184 MB | 6.7 s first launch | 2.4 s | 461 MB (27 + 122 + 312) | WebView2 153 present |
| Windows ARM64 (windows-11-arm) | NSIS 32 MB, MSI 54 MB | 170 MB | 3.8 s | 1.9 s | 493 MB | WebView2 154 present |
| Linux x64 (ubuntu-22.04) | AppImage 129 MB, deb 61 MB | AppImage 129 MB, deb 187 MB | 2.6 s | 1.1 s | 764 MB (142 + 275 + 347) | webkit2gtk-4.1 2.50.4 |
| Linux arm64 (ubuntu-22.04-arm) | AppImage 126 MB, deb 60 MB | AppImage 126 MB, deb 183 MB | 3.0 s | 1.5 s | 804 MB | webkit2gtk-4.1 2.50.4 |

Cold start is launch to the first page loaded on `/#c=<code>`; the server part is 0.5 to 1.7 s of it (4.4 s on the Intel runner's first launch). Memory is resident set at idle on Welcome, so shared pages are counted twice; the Linux webview is the heaviest. The bundled Node binary is most of the size (82 to 127 MB unpacked, 247 MB as the universal fat binary). The server with production dependencies is 45 to 78 MB after pruning (it was 120 MB before: better-sqlite3 13 and node-pty ship every OS's binaries, and node-pty still ships Windows `OpenConsole.exe` copies on every OS).

### The ticket's questions

- **Native modules from the app's resources**: better-sqlite3, @napi-rs/keyring and node-pty load with the bundled Node from the installed app on all seven legs (checked from the installed bundle while the app runs, and the server starts, opens SQLite and picks the keychain backend). Universal macOS: the x64 install's keyring package is merged in; better-sqlite3 and node-pty already ship both Mach-O slices, so nothing needed lipo. The Intel slice runs under Rosetta.
- **Bundled npm** (`findNpmCli`): the shell sets `npm_execpath` to the bundled `npm-cli.js` (rule 2). It runs with the bundled Node and installs a small package on every leg (0.4 to 4.8 s), so installing Claude Code from Welcome works with no system Node. Caveat for 13.4: rule 1 (npm beside `execPath`) runs first, and on the `.deb` the sidecar is `/usr/bin/ogden-node`, so a distro npm in `/usr/lib/node_modules/npm` would win.
- **Children after a kill**: an agent stand-in spawned exactly as the Claude Code adapter does (`detached` on POSIX, so it leads its own process group).
  - macOS and Linux: killing the server's process group stops the server but **leaves the agent running** (runs A and D). Killing only the server pid leaves it too (B). A crashed shell leaves the server and the agent (C).
  - Windows: with a kill-on-close **job object**, quitting and a crashed shell both leave nothing (A, C). Without the job, a crashed shell leaves the server and the agent (C-nojob). A direct kill without the job also left nothing on both Windows legs (B), which the spike could not explain; the job object is the reliable answer.
  - So the job object fixes Windows. On POSIX the shell must stop the server through its own Quit (which stops its agents) and fall back to a descendant walk that kills each child's group, as `scripts/installed-package.mjs` does. Killing the server's group alone is not enough. That is 13.5's job, and the epic's "server exits when the shell disappears" is also needed on POSIX.
- **AD-15 inside the webview** (all legs): the window opens on the launch code; the tab gets a token; `/api/v1/tab` is 204 with it and 401 without; the WebSocket opens with `ogden.v1` and the token subprotocol and fails without; `location.href = https://example.com` and `window.open` are blocked by the shell, and the page stays on `http://127.0.0.1:<port>`. Tauri still injects `window.__TAURI_INTERNALS__` into the page (`window.__TAURI__` is absent), but every IPC call is denied by the ACL ("not allowed by ACL"), because no capability is granted. The spike reached the webview only through the shell's `eval` and a cancelled same-origin navigation.
- **WebView2 / webkit2gtk**: WebView2 is preinstalled on both Windows runners (153 and 154). webkit2gtk-4.1 2.50.4 builds and runs on Ubuntu 22.04 x64 and arm64.
- **MSI on ARM64**: WiX builds the ARM64 MSI, and it installs and uninstalls silently. Both MSIs install per-user into `%LOCALAPPDATA%\<product>` (the same folder as NSIS), and installing or uninstalling one removes the other, so 13.8 should ship one Windows installer per architecture (NSIS, which the updater uses) and drop the MSI or keep it for admins only.
- **Updater dry run N to N+1** (throwaway minisign key generated in each job, `latest.json` served locally): on all seven legs a manifest with a wrong signature is refused ("The signature verification failed") and N keeps running; the updater also refuses a file signed for another version than the manifest announces. The good update installs: macOS (arm64, Intel, universal) and the Linux AppImage relaunch as 0.0.2 by themselves. On Windows the NSIS installer runs in passive mode and the installed exe is 0.0.2 afterwards, but the spike saw no relaunch within two minutes, so 13.10 must relaunch the app itself or confirm the installer does. The `.deb` cannot self-update (as expected).
- **Unsigned macOS app after an update**: the ad-hoc signed app (`flags=adhoc,runtime`, entitlements allow JIT and unsigned libraries for Node) relaunches after the updater replaces it, with no quarantine attribute. CI copies the app locally, so it cannot show what Gatekeeper does to a downloaded app: that is the user's check below.
- **Node SEA re-check**: `--build-sea` is absent in 24.21.0 (`node:sea` loads); the native-addon limitation stands. The sidecar stays the right choice.

### Other findings for the next entries

- Windows `resource_dir()` returns a verbatim `\\?\C:\...` path; the shell must strip it before passing paths to Node and npm (`plain_path` in `main.rs`).
- Universal macOS builds need `ogden-node-aarch64-apple-darwin` and `ogden-node-x86_64-apple-darwin` beside `ogden-node-universal-apple-darwin`.
- linuxdeploy (AppImage) fails on musl native modules, so the staging must prune foreign prebuilds; `NO_STRIP=true` is also set.
- Linux CI needs a session D-Bus (`dbus-run-session`), or GTK waits 25 s at start. A desktop session has one.
- The Windows ARM64 runner's PowerShell `Get-CimInstance` returned nothing to the harness; `tasklist` worked.
- Build time per leg (two Tauri builds) was 10 to 25 minutes; the Intel macOS runner is the slowest.

### Needs you (the go or no-go)

1. Read the results above and say **go** or **no-go**; it is recorded as a dated Decision in the epic's Notes.
2. Optionally try a test build from the run's artifacts (log in to GitHub, open the run, scroll to Artifacts):
   - macOS: `ogden-desktop-spike-macos-universal` (or `-macos-arm64`). Open the `.dmg`, drag the app to Applications, open it. macOS will refuse: System Settings > Privacy & Security > Open Anyway. Say whether that worked, and whether it asks again after a relaunch.
   - Windows: `ogden-desktop-spike-windows-x64` (or `-arm64`). Run the `-setup.exe`; SmartScreen: More info > Run anyway.
   - Linux: `ogden-desktop-spike-linux-x64` (or `-arm64`). `chmod +x` the AppImage and run it, or `sudo apt install ./…deb`.
   - Then install Claude Code from Welcome (this checks the bundled npm), sign in, chat once, and quit. Afterwards no `ogden-node` or `claude` process should be left (Activity Monitor, Task Manager or `ps`); on macOS and Linux one may be left (the finding above), so please say what you see.
   - The test build keeps its data in its own folder (Application Support / AppData / `~/.local/share` under `dev.ogden-agents.spike/spike-data`), never your Ogden data. Delete that folder and the app afterwards. It does not update itself (its update address is a local test one).
