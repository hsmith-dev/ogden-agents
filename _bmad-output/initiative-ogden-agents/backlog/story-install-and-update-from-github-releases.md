---
id: 3
type: story
title: "Install and update from GitHub Releases"
parent: none
covers: []
after: [2]
assignee: ""
refined: true
hitl: false
risk: high
estimate: ""
---

# Install and update from GitHub Releases

## Description

Every version tag creates a GitHub Release that carries the packed npm tarball, the start scripts, `SHA256SUMS.txt` and notes from `CHANGELOG.md`, with or without npm publishing set up. The start scripts can install and update Ogden Agents from that release instead of the npm registry (`OGDEN_AGENTS_SOURCE=github` or `--github`), keeping the previous version for rollback. A small shared version-source interface lets the upcoming "newer version" notice (13.7) and the scripts read the same releases with the same semantics. Epic 13's Tauri updater will publish `latest.json` to the same release, so there stays one release pipeline.

## Acceptance Criteria

1. **A tag makes a release without npm**
   **Given** a `v*.*.*` tag on main and no `NPM_PUBLISH` repository variable
   **When** the release workflow runs
   **Then** CI and the guard run, the npm publish job is skipped, and a GitHub Release exists (prerelease for `-rc`/`-next`) with `ogden-agents-<version>.tgz`, the three start scripts, the install helper, `SHA256SUMS.txt` listing every asset, and notes from the matching `CHANGELOG.md` section
   **And** with `NPM_PUBLISH=true` the npm job, its `npm-release` environment and its protections run exactly as before, and the release is created only after verify passes

2. **Dry run**
   **Given** `workflow_dispatch`
   **When** the workflow runs
   **Then** it builds every release asset and uploads them as workflow artifacts, and creates no release, tag or npm publish

3. **Install from the release**
   **Given** `OGDEN_AGENTS_SOURCE=github` (or `--github`) and a release of the user's repo
   **When** a start script runs
   **Then** it downloads the latest release's tarball and `SHA256SUMS.txt`, refuses to install on any checksum problem (missing sums, missing entry, mismatch; there is no way to skip), installs it with npm into a per-user app folder (never global, no admin), and starts it
   **And** the previous version stays installed for `rollback`, older ones are removed, and an offline start runs the installed version

4. **Update source**
   **Given** the stable channel (a stable current version) or the next channel (a prerelease, or `OGDEN_AGENTS_CHANNEL=next`)
   **When** the newest release is looked up
   **Then** stable uses `releases/latest` (never a prerelease) and next uses the highest version among all published releases; a downgrade is never offered; both the scripts and 13.7 use the one `VersionSource` module in `@ogden-agents/shared`

5. **Private repository**
   **Given** a private repository
   **When** no token is available
   **Then** the script says plainly that GitHub answers 404 to signed-out users and what to do (`gh auth login`, or a token in `OGDEN_AGENTS_GITHUB_TOKEN`/`GITHUB_TOKEN`)
   **And** a token is read from those variables or `gh auth token`, sent only to the GitHub API host, never to a redirect target, never written to disk, and masked in every message

6. **Tests**
   **Given** CI
   **When** tests run
   **Then** none touches the real network (a fake release client and a loopback fake API with fixture tarballs), the notes extractor and the shared module are unit tested, and the existing start-script, typecheck, e2e, pack and smoke checks pass

## Boundaries

- Must not change: the npm publish job's steps, environment, permissions and idempotence; the `ogden` launcher; the npm tarball's file list (the installer is not shipped inside it); repository visibility; no tag, publish or merge by an agent.
- npm still serves the package's dependencies on an install from a release (better-sqlite3 and the others), so this removes the need for an `ogden-agents` release on npm, not the registry itself.

## References

- release — RELEASING.md; .github/workflows/release.yml; .github/workflows/ci.yml
- start scripts — start/; tests/start-scripts.test.ts; backlog story 2
- epic 13 — origin/docs/epic-desktop-app (E13-R6, E13-R7, E13-R8; 13.7 on story/13.7-new-version-notice)

## Notes

- Decision (2026-10-04, user): GitHub Releases as a distribution and update source, one pipeline shared with epic 13's `latest.json`.
- Decision (2026-10-04, autonomous): the npm publish job runs only when the repository variable `NPM_PUBLISH` is `true`. Default off, so a tag never names the `npm-release` environment unless the owner opted in (a missing environment would be created unprotected). Anyone releasing to npm sets the variable once; RELEASING.md says so.
- Decision (2026-10-04, autonomous): install logic is one Node program (`ogden-install.mjs`, bundled from `packages/server/src/installer/`) that the scripts run, because the scripts already require Node 24 and sh/cmd cannot verify or parse JSON safely. It ships as a release asset, in the macOS zip, and is listed in `SHA256SUMS.txt`; the scripts never download it.
- Assumption: `SHA256SUMS.txt` comes from the same release as the tarball, so it catches corruption, truncation and a swapped single asset, not a compromised release or account. Stated in the docs.
- Assumption: risk high: workflow permissions and a download-and-run path.
