---
title: 'Spike: can a Tauri app run Ogden''s packed server on a bundled Node on all three OSes?'
type: 'chore'
ticket: '1'
created: '2026-10-04'
status: 'in-progress'
baseline_revision: 'c0437e18cf323348770d1abab5cde98c8babc426'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
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
- [ ] `apps/desktop-spike/src-tauri/*` -- minimal shell (Cargo.toml, tauri.conf.json, build.rs, src/main.rs, entitlements, placeholder frontend): spawn sidecar, handshake, window on launch URL, navigation lock, no capabilities, kill modes, Windows job object, webview probe via blocked same-origin navigation, updater dry run, JSON-lines report -- the thing under test.
- [ ] `apps/desktop-spike/scripts/stage.mjs` -- pinned Node table (version + sha256 per target), download/verify/extract, sidecar + npm placement, production install of the tarball with the bundled npm, native-module load check, SEA re-check, icon PNG -- reproducible staging.
- [ ] `apps/desktop-spike/scripts/harness.mjs` -- install/launch per OS, cold start, memory, runs A (tree kill) / B (direct kill) / C (crash), updater bad+good, WebView2 / webkit2gtk versions, sizes; writes `findings-<leg>.json` and the job summary.
- [ ] `.github/workflows/desktop-spike.yml` -- TEMPORARY matrix; uploads test builds and findings as artifacts; removed (moved under `apps/desktop-spike/ci/`) before the final commit.
- [ ] this plan -- findings, numbers, GO/NO-GO, Needs you.

**Acceptance Criteria:**
- Given the spike branch is pushed, when the workflow runs, then every leg's log and findings JSON answer each question in the ticket (or record why a leg could not).
- Given the final commit, when `.github/workflows/` is listed, then no desktop-spike job remains.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Design Notes

The webview has no IPC, so the shell learns probe results through a same-origin navigation to `/__spike_probe?d=<json>` that `on_navigation` records and cancels. All spike behaviour is behind `OGDEN_SPIKE_*` environment variables; without them the build behaves as a plain app (own data folder under the app data dir, closing the window quits and stops the server).

## Verification

**Commands:**
- `gh run list --branch spike/13.1-tauri-desktop --workflow desktop-spike.yml` -- expected: a completed run with findings artifacts for every leg.

**Manual checks (if no CLI):**
- The user opens the unsigned macOS / Windows / Linux test build, gets past Gatekeeper / SmartScreen, signs in, chats, quits (see Needs you).

## Findings

(pending CI)
