---
title: 'Tracer bullet: the app opens Ogden''s window on its bundled server'
type: 'feature'
ticket: '2'
created: '2026-10-05'
status: 'built'
baseline_revision: '2a526961918ed13e2cd6c5fcf69bf3e781ad3978'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['security', 'correctness']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-desktop-app/epic-desktop-app.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-desktop-app/spike-can-a-tauri-app-run-ogden-s-packed-server-on-a-bundled-node-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Spike 13.1 said GO. Nothing in the repository yet builds the real app (E13-R1, E13-R2, E13-R3).

**Approach:** Add `packages/desktop/` (the `src-tauri` crate on Tauri 2.12.1, a pinned Rust 1.99.0 toolchain, identifier `dev.ogden-agents.app`, a staging script with the pinned and SHA-256-checked Node 24 sidecar and the packed server as resources) and a `Desktop` CI workflow. The shell starts the sidecar on `serve.js` against the normal data folder, waits for `server.json` and the launcher token, gets a launch URL from `/launcher/hello?launch=1`, and opens one window on `http://127.0.0.1:<port>/#c=<code>` with no Tauri IPC. Closing the window quits the server (AD-3 note). Scope for this build, by the user's decision of 2026-10-05: macOS and Windows only; Linux stays out of scope and the code stays portable.

## Boundaries & Constraints

**Always:** AD-15 unchanged inside the webview (no capability, navigation locked to the server's origin, outside links to the system browser). Test builds use a private data folder and no real agent, keychain or network. Unsigned builds. Test hooks in the shell are limited to a report file and a quit file.

**Never:** change the server, web UI or npm package; tags, releases, signing secrets.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Cold start | empty data folder | server up, window on `/#c=<code>`, tab token minted | shell reports `server_error` and quits |
| Server already running (npx) | another server holds the instance lock | ours exits with code 3; the shell attaches and never stops that server | none |
| Quit | window closed or quit file | SIGTERM then process-group kill (macOS), job object plus taskkill tree (Windows); no `ogden-node` left | fallback kill |

</frozen-after-approval>

## Code Map

- `packages/desktop/src-tauri/src/main.rs` -- the shell.
- `packages/desktop/scripts/stage.mjs` and `desktop-node-pins.json` -- pinned Node, npm, packed server, pruned natives, native load check.
- `packages/desktop/scripts/smoke.mjs`, `app-harness.mjs` -- headless smoke, reused by later stories.
- `.github/workflows/desktop.yml` -- builds and smoke-tests the app on macos-latest and windows-latest.
- `apps/desktop-spike/` -- the spike's reference code; stays until 13.12's sweep.

## Tasks & Acceptance

**Execution:**
- [x] shell crate, config and toolchain pin
- [x] staging script with pins file
- [x] smoke test and harness helpers
- [x] `Desktop` CI workflow (macOS arm64 app, Windows x64 NSIS installed silently)
- [x] CI green on both legs (run 37300534255: macOS arm64 and Windows x64 NSIS installed silently, page loaded, tab token minted, quit left no `ogden-node`); `Cargo.lock` committed from it
- [x] review and triage

**Acceptance Criteria:**
- Given a PR touching `packages/desktop/`, when CI runs, then both legs build the app, the smoke reaches the page and the tab exchange, and quitting leaves no `ogden-node` process.

## Implementation Notes

- Rust is not installed on the build machine, so every compile happens in CI.
- `desktop-node-pins.json` is created here (13.3's entry owns it and its `--check`; the staging script needs the pins now).
- Unknown "External URL with a fragment keeps `sessionStorage` across the boot script's redirect": spike 13.1 showed the tab exchange works on macOS and Windows webviews; the smoke asserts it through the server log.

## Plan Change Log

## Review Triage Log

Pass 1 (security and correctness, self-review of the shell, staging and workflow): high 1, medium 2, low 3.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | `packages/desktop/` had no `package.json`, so `tests/architecture.test.ts` and `tests/packaging.test.ts` (which read every `packages/*/package.json`) fail in the full CI | high | patch | Found by running the suite on the stacked branch. Added a private `@ogden-agents/desktop` package (no scripts, no dependencies; the lockfile needs no change) and its entry in the AD-1 map. |
| 2 | The shell trusted `launchUrl` from the handshake: a local process writing `server.json` could point the window anywhere | medium | patch | The link must be on `http://127.0.0.1:<port>`, the server that answered. Same threat model as the launcher (data folder is mode 0700), still checked. |
| 3 | The shell computes the data folder itself (env-paths in Rust) | medium | defer | 13.5 replaces it with the launcher's `--json` mode (`dataDir` in its line). |
| 4 | Windows quit has no graceful step (taskkill tree) | medium | defer | 13.5: quit through the server's own route first. |
| 5 | Test hooks (`OGDEN_DESKTOP_TEST_REPORT`, `OGDEN_DESKTOP_TEST_QUIT_FILE`) are read in a shipped binary | low | reject | Same-user environment only; the report never holds a URL, token or path to a secret (guarded by `tests/desktop-config.test.ts` in 13.3); the quit file only runs the normal quit. |
| 6 | Closing the window blocks the UI thread up to 8 s while the server stops | low | defer | 13.5 reworks quit. |
| 7 | `killSidecars` in the smoke could kill a user's own `ogden-node` | low | patch | Processes present before the run are never counted or killed. |

## Verification

**Commands:**
- `gh run list --workflow Desktop` -- both legs green.

**Manual checks (if no CLI):**
- Live check result (hitl): the user opens the macOS test build on their own Mac and sees Welcome or their projects. Not yet done; recorded here when the user reports it.
