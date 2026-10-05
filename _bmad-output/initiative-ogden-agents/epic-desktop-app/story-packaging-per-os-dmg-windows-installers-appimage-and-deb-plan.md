---
title: 'Packaging per OS: dmg, Windows installers, AppImage and deb'
type: 'feature'
ticket: '8'
created: '2026-10-05'
status: 'in-progress'
baseline_revision: '250a0df6d7f61831f118f1da66ee4ef96542a299'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-desktop-app/epic-desktop-app.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-desktop-app/spike-can-a-tauri-app-run-ogden-s-packed-server-on-a-bundled-node-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The app builds as a bare `.app` and a test installer. A user needs one downloadable file per OS and architecture: a universal macOS `.dmg` and a Windows installer for x64 and ARM64 (E13-R1, E13-R9). By the user's decision of 2026-10-05, Linux is out of scope for now: its AppImage and `.deb` settings stay valid but no Linux job runs.

**Approach:** Fill the bundle section of the Tauri config: ad-hoc signing and a macOS floor of 13.5 (Node 24's own), a `.dmg` layout, the NSIS installer in current-user mode with the WebView2 bootstrapper, app metadata, and the `.deb` dependency on `libwebkit2gtk-4.1-0`. Build three legs in CI (macOS universal, Windows x64, Windows ARM64): throwaway updater key (generated per run, never stored, its public key set for that build only), `createUpdaterArtifacts` on through the override, an artifact check (one installer, every updater artifact has its `.sig`, both architectures in the universal app and its Node), install the way a user does (mount the `.dmg`, silent NSIS install), run the smoke and lifecycle tests against it, run the Intel slice under Rosetta, and upload the unsigned installers and their update artifacts as workflow artifacts. The icon is drawn in code from the web UI's mark (no binary in the repository).

## Boundaries & Constraints

**Always:** unsigned builds only (ad-hoc on macOS); the committed config builds no updater artifacts (the key is the user's, AD-23); one Windows installer per architecture, NSIS only (spike 13.1: MSI and NSIS share one folder and remove each other).

**Never:** a stored key, notarization or code signing, an MSI, publishing.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| macOS universal | `universal-apple-darwin` | one `.dmg`, `.app.tar.gz` with `.sig`; app and Node hold arm64 and x86_64 | the artifact check fails the job |
| Windows | x64 and ARM64 | one NSIS installer with `.sig`, no MSI | same |
| Install | mounted `.dmg`, silent NSIS | the app starts and passes the smoke and lifecycle tests | job fails with the report |

</frozen-after-approval>

## Code Map

- `packages/desktop/src-tauri/tauri.conf.json` -- bundle section.
- `packages/desktop/scripts/{icon,test-updater-key,check-artifacts}.mjs`; `stage.mjs` uses `icon.mjs`.
- `.github/workflows/desktop.yml` job `app` (three legs).
- `tests/desktop-config.test.ts` -- bundle assertions.

## Tasks & Acceptance

**Execution:**
- [x] bundle config, icon, test key script, artifact check
- [x] three-leg `app` job with dmg mount, silent install, Rosetta smoke
- [ ] CI green on all three legs; artifacts downloadable from the run
- [ ] review and triage

**Acceptance Criteria:**
- Given a pull request touching the desktop app, each leg uploads its installer and update artifacts, and the app installed from them starts and passes the smoke and lifecycle tests.

## Implementation Notes

- Unknown "whether MSI builds on Windows ARM64 (13.1)": it does, but the epic's own unknown allows NSIS only, and the spike's installers-share-a-folder finding makes two installers harmful. NSIS only, on x64 and ARM64.
- Unknown "macOS minimum version": 13.5, because Node 24 does not run on anything older; the spike's 11.0 was a placeholder.
- The Linux AppImage and `.deb` settings are not tested here (no Linux job); the config keeps the `.deb` webkit2gtk dependency so Linux can return with the same file.

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `gh run list --workflow Desktop`; download `ogden-desktop-macos-universal` (`.dmg`), `ogden-desktop-windows-x64` and `ogden-desktop-windows-arm64` (NSIS installers) from the run.
