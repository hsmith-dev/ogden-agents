---
title: 'Release pipeline: app builds, checksums and update manifests on GitHub Releases'
type: 'feature'
ticket: '9'
created: '2026-10-05'
status: 'in-progress'
baseline_revision: '849ff358779ff0f47a80687269ffc4c5afe5ec40'
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

**Problem:** A tagged release builds only the npm package. The desktop apps need to be built from the tagged commit, checked, and attached to the GitHub Release with checksums and, once the user has an updater key, a signed `latest.json` per channel (E13-R8, E13-R6; AD-23). The user's updater key and any code-signing certificate are theirs and exist only as secrets.

**Approach:** Extend `release.yml` without touching the npm publish job: `desktop-signed` (only when the repository variable `DESKTOP_SIGNING` is `true`, in the `desktop-release` environment, signing update files with the user's key) or `desktop-unsigned` (no environment, no secret, installers only) build the macOS universal and Windows x64 and ARM64 apps through one composite action; `desktop-assets` gives the files space-free names and writes `SHA256SUMS-desktop.txt` and `latest.json`; the GitHub Release job waits for them and attaches them; and a signed release also replaces the `latest.json` of the permanent `desktop-channel-next` prerelease (the stable channel is the release's own `latest.json`). Apple and Windows code signing are slots that turn on only when their secrets exist. RELEASING.md says exactly what the user must do. The Desktop workflow reuses the composite action with a throwaway key. By the user's decision of 2026-10-05, no Linux build.

## Boundaries & Constraints

**Always:** no agent generates, sees or stores the updater key or any certificate; the key and certificate secrets are read only by the `desktop-signed` job; the npm publish job's inputs and outputs are unchanged; the release is published only after every desktop file is attached; the guard also checks the desktop versions; a release build refuses an empty or malformed committed public key and says what to do.

**Never:** create or push a tag, publish to npm, change repository settings, use the user's key in tests (CI test builds use a per-run throwaway key).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Tag, no key set up | `DESKTOP_SIGNING` unset | installers and `SHA256SUMS-desktop.txt` attached; no `latest.json` | none |
| Tag, key set up | `DESKTOP_SIGNING=true`, secrets in `desktop-release` | signed update files, `latest.json` on the release, and on `desktop-channel-next` | no secret: a plain error naming RELEASING.md; empty public key: same |
| Signing secrets absent | no APPLE or WINDOWS secrets | steps skip with a notice; builds stay unsigned | none |
| Dry run | `workflow_dispatch` | desktop files kept as `desktop-release-assets`; no release | none |

</frozen-after-approval>

## Code Map

- `.github/workflows/release.yml` (jobs `desktop-signed`, `desktop-unsigned`, `desktop-assets`, and `github-release`), `.github/actions/desktop-build/action.yml`, `.github/workflows/desktop.yml`.
- `packages/desktop/scripts/{release-manifest,make-build-config}.mjs`; `scripts/release-notes.mjs` (desktop paragraph); `RELEASING.md` (the user's steps).
- Tests: `tests/desktop-release.test.ts`, `tests/desktop-build-config.test.ts`, `tests/desktop-release-workflow.test.ts`, `tests/release-notes.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] manifest and checksum script, build config script, composite action
- [x] release.yml jobs, guard versions, github-release attaches, next channel manifest
- [x] RELEASING.md: the user's steps for the key, the environment, the variable, optional signing secrets
- [ ] CI green; a release dry run on this branch produces the desktop files
- [ ] the user's hitl steps (key, environment, variable) are theirs and are listed in the report

**Acceptance Criteria:**
- Given a dry run, the desktop files are built and collected with matching checksums; given a tag with the key set up, the release carries signed update files and `latest.json`; the signing slots skip cleanly without secrets; the npm publish path is unchanged.

## Implementation Notes

- Deviation from the epic text: `tauri-apps/tauri-action` is not used. It runs its own build and cannot run the staging of the pinned Node and the packed server; the composite action runs `tauri build` directly and `release-manifest.mjs` writes `latest.json` (tested), which keeps one build path for CI and releases.
- The Windows updater artifact is the NSIS installer itself (Tauri v2 format); the macOS one is `Ogden Agents.app.tar.gz`. Release file names have no spaces because GitHub turns them into dots.
- `SHA256SUMS-desktop.txt` is separate from the npm assets' `SHA256SUMS.txt` (same release, two files of that name cannot coexist).
- The `desktop-release` environment is only named by `desktop-signed`, which runs only when `DESKTOP_SIGNING` is `true`, as `NPM_PUBLISH` gates `npm-release`.
- The Apple and Windows signing slots are written from Tauri's documented environment and have not run with real secrets.

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `gh workflow run release.yml --ref <branch>` (dry run), then download `desktop-release-assets`.
