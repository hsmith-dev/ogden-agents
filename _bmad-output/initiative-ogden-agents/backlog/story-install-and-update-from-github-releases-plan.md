---
title: 'Install and update from GitHub Releases'
type: 'feature'
ticket: '3'
created: '2026-10-04'
status: 'in-progress'
baseline_revision: '0cacfc1'
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

- [ ] shared module + tests
- [ ] installer + tests (loopback fake API, fixture tarball)
- [ ] release-notes script + tests
- [ ] start scripts source mode + tests
- [ ] release.yml, ci.yml (installer built and checked), RELEASING.md, README, CHANGELOG
- [ ] review, triage, verify, PR

## Triage log

(none yet)
