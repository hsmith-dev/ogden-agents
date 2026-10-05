---
title: 'The update notice reads GitHub Releases'
type: 'feature'
ticket: '14'
created: '2026-10-05'
status: 'built'
baseline_revision: 'e260e8ae1fe64f61638f400b6642cd083cf88ab1'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['privacy', 'edge-cases']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-desktop-app/epic-desktop-app.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-desktop-app/story-npm-users-see-that-a-newer-version-is-available-plan.md'
  - '{project-root}/RELEASING.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 13.7's notice reads only npm's dist-tags, but npm has only a 0.0.0 placeholder and releases are published on GitHub (PR #110). Nobody would ever be told a newer version exists.

**Approach:** The server also asks this project's latest GitHub release through `VersionSource` (`createGitHubReleasesSource` from `@ogden-agents/shared/release-source`), on the version's own channel (`releases/latest` for a stable version, the newest few releases for a preview). An install made by the GitHub Releases helper asks GitHub only; every other install asks GitHub and npm, and the highest newer version is offered (npm wins a tie, because its command works from any terminal). Settings, About names the sources. The notice says how to update by where the update was found.

## Boundaries & Constraints

**Always:**
- Same privacy rules as 13.7 for each source: one `GET` of a fixed URL, 5 second timeout, redirects refused, body capped, nothing identifying (the source's constant `user-agent: ogden-agents` is the only addition, which GitHub requires; no version, id, account, project, path or token), off by the switch (start check) or `OGDEN_AGENTS_OFFLINE` (all checks), failure silent (a log line with a source and a code only), tests inject a fake client and never touch the network.
- No token is sent: the repository is public. (A future private fork would need one; not built.)
- A stable version is told only of a stable release; a preview is told of the highest release newer than it.
- A source that fails does not hide the other's answer. All failed means `failed`.
- User text is plain, no dashes.

**Never:**
- Don't run `gh`, read a token, or spawn anything for the notice. Don't send anything from the browser to GitHub or npm. Don't change the installer or the release workflow.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| GitHub install | launcher under `<app dir>/versions/<v>/node_modules/ogden-agents/` | one GET, to GitHub only; banner says to start Ogden again | |
| npx, global or checkout | any other launcher | GitHub and npm, one GET each; highest wins, npm on a tie | one failing is logged, the other's answer still counts |
| Stable current | v0.5.0 | `releases/latest`; a prerelease answer is ignored | |
| Preview current | v0.5.0-rc.1 | `releases?per_page=5`; the highest newer of them | |
| Both fail | 404, 5xx, bad JSON, over the cap, redirect, timeout | no banner; Check now says it could not reach GitHub Releases and npm | |
| Answer bigger than 16 KiB | a release lists its files | read up to 256 KiB (npm stays at 16 KiB) | over the cap fails silently |
| Offline env | `OGDEN_AGENTS_OFFLINE=1` | no request; About says Ogden stays offline | |

</frozen-after-approval>

## Code Map

- Baseline: worktree `ogden-agents-wt-13.14` on `origin/main`.
- `packages/shared/src/updates.ts`, `semver.ts` -- `InstallMethod` gains `github`; `UpdateSourceName`; `sources` on the notice; `source` on the offer; `decideUpdate` labels its offer.
- `packages/server/src/update-check.ts` -- `sourcesFor`, one capped client for both sources, `askGitHub` over `VersionSource`, `askNpm`, `best`; `installMethodOf` knows the helper's folder.
- `packages/web/src/updates/update-model.ts`, `update-how-to.tsx`, `shell/update-banner.tsx`, `routes/about-page.tsx` -- words by source; the Checks row.
- `docs/share/security-and-privacy.md`, `CHANGELOG.md` -- the new outbound request.
- Tests: `packages/server/test/update-check.test.ts`, `packages/shared/test/update-offer.test.ts`, `packages/web/test/update-notice.dom.test.tsx`, `tests/e2e/update-notice.spec.ts`.

## Tasks & Acceptance

**Execution:**
- [x] shared: install method, source names, schema fields
- [x] server: both sources over one capped no-redirect client; install-method detection; tests with a fake that answers by URL
- [x] web: banner and About words by source; the Checks row
- [x] docs and changelog

**Acceptance Criteria:**
- Given a fake GitHub and npm, when the server starts, then each is asked exactly once with the request shape above, and the highest newer version is reported with its source.
- Given an install from GitHub Releases, when the server starts, then only GitHub is asked.
- Given any failure of both, then nothing shows, the log has codes only, and Check now says it could not reach them.

## Implementation Notes

Deliberate departure from 13.7's "16 KiB cap": a GitHub release answer lists its files (and the preview list has five releases), so it is read up to 256 KiB. npm keeps 16 KiB. Still a hard cap, not an unbounded read. The source follows a same-origin redirect by hand for the installer; here the client is told to fail on any redirect, so none is ever followed.

## Plan Change Log

None yet.

## Review Triage Log

Pass 1 (privacy, edge cases; fresh reviewer). Privacy held: one capped no-redirect GET per source, no token, constant user-agent only, codes-only logs, desktop shell untouched. Fixed: a failed source with nothing found said "up to date" and stamped the time (medium; now `failed`, earlier offer kept, which also stops the banner flickering away); a 404 from releases/latest before any release exists counted as a failure (medium; now "nothing newer"); copy told npm installs to "download" from the releases page (medium; now "To update, see ..."); the security page said the switch stops Check now (low; reworded); the preview URL and `perPage` were duplicated (low; one constant). Accepted: failure text names both sources even when one failed (low); 256 KiB cap is tight if a preview page of five releases grows (low, five is small); a renamed repository breaks the check silently because redirects are refused (low, by the privacy rule); `releases/latest` is the newest created, not highest, release (low, `isNewer` guards).

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm test`, `pnpm e2e` -- expected: green
