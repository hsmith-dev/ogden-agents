---
title: 'Install and update from GitHub Releases'
type: 'feature'
ticket: '3'
created: '2026-10-04'
status: 'built'
baseline_revision: 'ec5eb7d'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/backlog/story-install-and-update-from-github-releases.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Releasing needs npm set up first; installs and updates can only come from the registry (user, 2026-10-04: "can we do GitHub releases and be able to update from that?").

**Approach:** One release pipeline. A tag builds assets once and creates a GitHub Release (tarball, start scripts, install helper, SHA256SUMS.txt, changelog notes); npm publishing becomes an opt-in gated job (`NPM_PUBLISH`). A shared `VersionSource` interface (`@ogden-agents/shared/release-source`) with a GitHub Releases implementation is used by the install helper and, later, by 13.7's notice. The start scripts delegate `--github`/`OGDEN_AGENTS_SOURCE=github` to the helper.

## Boundaries & Constraints

**Always:** ticket criteria 1-6; checksum verification cannot be skipped; token only to the API host, never stored, always masked; no network in tests; npm job protections untouched.
**Never:** curl|sh; scripts downloading the helper; global installs or admin; tag/publish/merge; change repo visibility.

</frozen-after-approval>

## Design

- `packages/shared/src/release-source.ts`: `ReleaseInfo`, `Channel`, `VersionSource { name; latest(channel) }`, `channelFor`, `isNewer`, `pickRelease`, `parseSha256Sums`, `maskSecrets`, `createGitHubReleasesSource({ repo, fetch, token, apiBase })`, `ReleaseSourceError` (kinds: not-found, unauthorized, rate-limited, network, bad-response).
  13.7 coordination: its npm registry source implements the same `VersionSource` (assets empty); it imports `@ogden-agents/shared/release-source` (new export) and may add `createGitHubReleasesSource` as a second source. This story edits no 13.7 file.
- `packages/server/src/installer/*`: token lookup, safe download (manual redirects, https only, host allowlist, token dropped on a cross-origin hop, size caps), sums verification, `npm install --prefix versions/<v> <tgz>` (npm extracts; no tar code of ours), `state.json` (current/previous), rollback, start. Bundled to `packages/server/dist-installer/ogden-install.mjs`.
- Scripts: `--github` / `OGDEN_AGENTS_SOURCE=github`, helper found next to the script, plain message if missing.
- Workflow: guard handles dispatch; `assets` job; `npm-publish` gated by `vars.NPM_PUBLISH`; `github-release` replaces `start-scripts`.
- `scripts/release-notes.mjs` extracts CHANGELOG notes.

## Tasks

- [x] shared module + tests
- [x] installer + tests (in-process fake GitHub, real npm pack fixture tarballs; no loopback server was needed)
- [x] release-notes script + tests
- [x] start scripts source mode + tests
- [x] release.yml (assets job, opt-in npm, github-release job, dry run), RELEASING.md, README, CHANGELOG, installer bundle test
- [ ] review, triage, verify, PR, dry-run dispatch on the PR

## Triage log

- Review (security lens, own pass): fixed — a version with build metadata or odd characters is refused before it names a folder (`isSafeVersion`); `OGDEN_AGENTS_GITHUB_API` must be https or loopback because the token goes there. Accepted — `gh` is found by Node's normal executable search (cwd-first on Windows; the scripts run from the user's home folder).
- Review (independent security agent): fixed — token stripped from npm and launcher child environments; `gh auth token` only for the default API address; `+build` versions rejected; prune skips in-progress installs; tarball opened `wx`. Declined — `--ignore-scripts` (better-sqlite3 needs its install script). Left to the owner — a protected environment for the GitHub Release job and tag protection for `v*` (a tag now makes the release that installed copies update to); `publish` and `assets` run in parallel; `--clobber` on re-run.
- Decision: npm publish is opt-in through the `NPM_PUBLISH` repository variable (default off). A tag then always makes a GitHub Release; the owner sets the variable once to resume npm releases.
- Decision: `ogden-install.mjs` is a release asset (and in the macOS zip), never fetched by the scripts; Windows and Linux users keep it beside their script.
- 13.7 coordination: import `@ogden-agents/shared/release-source`; implement `VersionSource` for the npm registry (assets empty) and optionally reuse `createGitHubReleasesSource`. Channel semantics: stable = `latest` (no prerelease), next = highest of all releases. This story edits none of 13.7's files.
- Epic 13: `latest.json` and the app installers join the same `release-assets` artifact and the `github-release` job (13.9 adds their build jobs ahead of it).
