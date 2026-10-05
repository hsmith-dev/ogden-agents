---
title: 'The app updates itself: check, download, verify, prompt and restart'
type: 'feature'
ticket: '10'
created: '2026-10-05'
status: 'in-progress'
baseline_revision: '4a3ab98b8bc3cb1ffe3dd926fd0171cbdf9bf53d'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-desktop-app/epic-desktop-app.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The app has the page's update prompt and the server's update service (13.3) and a pipeline that publishes signed updates (13.9), but nothing in the shell finds, downloads, verifies or installs an update (E13-R6; AD-20, AD-23).

**Approach:** Add `tauri-plugin-updater` 2.12.0 to the shell. Only on start (and when the user picks Check for Updates in the menu; never periodically, user 2026-10-04) it reads the signed `latest.json` of the user's channel (stable: the latest release; next: the permanent `desktop-channel-next` prerelease), reports a found update to the server, downloads it (the updater checks the minisign signature against the build's public key), checks the file's SHA-256 against `SHA256SUMS-desktop.txt` on the same release, and only then reports it ready. The page's Restart goes to the server; the server's one busy rule says go only when no agent turn or build runs; the shell polls for it, stops the server through its quit, installs (Windows: passive NSIS install that starts the app again), and restarts. A failed download, signature, checksum or install keeps the running version and tells the page why. A build with no committed public key (an unsigned release) does not check. A local fake release server fixture and an end-to-end script exercise it in CI.

## Boundaries & Constraints

**Always:** the page never reaches the updater (no IPC; AD-15); the user's key is never used in tests (throwaway per run); only a signed, checksummed update is ever installed; the running version survives any failure; no periodic checks; plain words, no dashes.

**Never:** a Linux `.deb` notice (Linux is out of scope, user 2026-10-05), any change to the gate.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Newer version on the channel | signed manifest | found, downloaded, verified, the page shows "Update available" | none |
| Stable channel, release only on next | stable manifest missing | nothing offered | check failure is silent |
| Restart while a turn runs | busy session | 409; "Restart when they finish" waits, then installs | none |
| Bad signature or bytes | tampered file | refused, old version runs, page says why | `failed` reported |
| Bad checksum | wrong sums file | refused the same way | same |
| Install fails | OS refuses | dialog, the old version opens again | none |
| No public key in the build | unsigned release | no check, menu says the build does not update itself | none |

</frozen-after-approval>

## Code Map

- `packages/desktop/src-tauri/src/update.rs`, `server.rs` (update calls), `ui.rs`, `main.rs`, `Cargo.toml`, `tauri.conf.json` (`plugins.updater`).
- `packages/shared/src/desktop-update.ts` (`failed`), `packages/server/src/update-notice/desktop-update.ts`, the banner and About notes.
- `tests/fixtures/fake-release-server/serve.mjs`, `packages/desktop/scripts/{update-e2e,release-manifest}.mjs`, `.github/workflows/desktop.yml`.

## Tasks & Acceptance

**Execution:**
- [x] updater module, server calls, menu check, start check
- [x] failure reasons carried to the page; release notes shown in About
- [x] fake release server, update end-to-end script, CI steps (build N+1, run it)
- [ ] CI green on macOS and Windows legs
- [ ] review and triage

## Implementation Notes

- Unknown "does the updater replace an unsigned macOS app without Gatekeeper blocking the relaunch": spike 13.1 showed it relaunches in CI; a downloaded, quarantined app is the user's live check.
- Unknown "how Windows' installer handles a running sidecar": the server is stopped through its quit before the installer runs. Spike 13.1 saw no relaunch after a passive install, so the shell passes `/R` (restart after install).
- `dangerousInsecureTransportProtocol` and the test update base are only in CI test builds (their override), and the base variable is read only when the build's config allows plain http.
- The `.deb` notice is left with Linux.

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `gh run list --workflow Desktop` -- the Update test step passes on the macOS and Windows legs.
