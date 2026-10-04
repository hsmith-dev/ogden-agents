---
title: 'First npm release'
type: 'chore'
ticket: '10'
created: '2026-09-30'
status: 'built'
baseline_revision: '82094694635973f62a8e38ce5990e3eb25ef9fa0'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `ogden-agents` on npm is an empty `0.0.0` placeholder. Nothing publishes a real build, and nothing proves that `npx ogden-agents` from the registry works on every OS (CAP-1, R1, R8).

**Approach:** A tag-triggered GitHub Actions release publishes the `ogden-agents` package to npm through **trusted publishing** (GitHub OIDC, no stored npm token). It publishes only after the full CI matrix passes for that commit. A follow-up job on macOS, Windows and Linux runs the published version with `npx` and must reach the page. The first release is `0.1.0`. The GitHub repo becomes public at this release so npm shows verified provenance (user decision, 2026-09-30).

## Boundaries & Constraints

**Always:**
- One version everywhere: the root, server and web `package.json` versions are equal (the packaging test enforces this) and match the tag (`v0.1.0` for `0.1.0`); the workflow fails otherwise.
- The release workflow runs on tag push `v*.*.*` from `main` only. It first reruns the full CI matrix (`workflow_call` of ci.yml), then publishes from Linux with `permissions: id-token: write`, npm ≥ 11.5.1, and `npm publish --access public` on the packed tarball, never `pnpm publish` from the workspace.
- No long-lived npm token in the repo or GitHub secrets. Trusted publishing is configured on npmjs.com for `hsmith-dev/ogden-agents`, workflow `release.yml`, and environment `npm-release`.
- The root package is published with `private: false`; the workspace packages stay private.
- After publishing, a verify job on all three OSes runs `npx --yes ogden-agents@<version>` (the smoke script in registry mode), reaching the page and `server.started`, then quits the server.
- Provenance is published when the repo is public. The workflow doesn't fail on the private repo, but the release checklist makes the repo public first.

**Never:**
- Don't publish from a developer machine, a branch other than `main`, or with a hand-edited version.
- Don't unpublish; a bad release is fixed forward with a new patch version (npm forbids reusing versions).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Release | Tag `v0.1.0` on `main` with versions 0.1.0 | CI matrix, then publish, then 3-OS registry verify: all green; `npm view ogden-agents version` → 0.1.0 | — |
| Version mismatch | Tag `v0.1.1`, packages at 0.1.0 | Fails before publishing, naming the mismatch | — |
| Not main | Tag on a non-main commit | Fails before publishing | — |
| CI red | Matrix fails for the tagged commit | Nothing published | — |
| No trusted publisher | OIDC publish rejected by npm | Clear failure with a link to the setup steps; nothing half-published | — |
| Registry verify | Published package broken on one OS | The verify job fails on that OS (the release is already public; fix forward) | — |

</frozen-after-approval>

## Code Map

Baseline: worktree `../ogden-agents-wt-1.10`, branch `story/1.10-first-npm-release`, on top of 1.9 (`695ebcd`), which is on top of 1.7. Story 1.8 is being built in parallel on 1.7 and will be rebased under this branch; keep changes to `ci.yml`, `package.json` and `scripts/smoke-installed.mjs` minimal and additive so that rebase is easy.


- `.github/workflows/ci.yml` -- the matrix, e2e and vendor-check jobs. Add `workflow_call` so the release can reuse it.
- `package.json` (root, `private: true`, `0.0.0`), `packages/server/package.json`, `packages/web/package.json` -- bump to `0.1.0` together; root `private: false`.
- `scripts/smoke-installed.mjs` -- takes a tarball path. Add a registry mode (`--registry-spec ogden-agents@<version>`).
- `tests/packaging.test.ts` -- asserts the versions are equal.
- npm facts: trusted publishing (OIDC) is generally available and needs npm CLI ≥ 11.5.1, `id-token: write`, and a trusted publisher configured per package (org or user, repo, workflow file, optional environment); provenance is automatic with trusted publishing and unavailable from private repos (GitHub changelog, 2025-07-31; docs.npmjs.com/trusted-publishers).

## Implementation Notes

- The publish job rebuilds and packs on Linux Node 24 from the tagged commit (the CI matrix's tarballs are not uploaded, to keep `ci.yml` unchanged apart from `workflow_call`), and smoke-tests that exact tarball before `npm publish`.
- No `--provenance` flag: trusted publishing adds provenance automatically from a public repo, and the explicit flag would fail from a private one. A post-publish step fails if a public-repo release lacks `dist.attestations` and only warns when the repo is private.
- `setup-node` gets no `registry-url`, so it writes no token-based `.npmrc`; npm's default registry is npmjs.org.
- The publish job refuses a version already on npm (fix forward), and the failure message on a rejected publish links `RELEASING.md#2-configure-the-npm-trusted-publisher`.
- Verify runs on the three OSes for Node 24 and 26 (the architecture's delivery line), after waiting up to 5 minutes for the version to be visible from each runner.
- Registry mode runs `npx --yes <spec> --no-open --port 0`; npx picks the package's only bin (`ogden`). Checked locally with `--registry-spec file:<tarball>`.
- `tests/packaging.test.ts` also asserts the root package is not private and every workspace package is.
- Review fixes: root `repository`/`homepage`/`bugs` (trusted publishing checks `repository.url`, asserted in the packaging test); E422 explained; post-publish checks moved to a `registry` job that verify doesn't need; publish is idempotent by `gitHead` (set with `npm pkg set` before packing); prereleases publish to the `next` dist-tag; the main guard requires first-parent history; README links to unshipped files are absolute.
- `CHANGELOG.md` is not in the tarball (only `bin`, `dist`, `vendor`, README, LICENSE ship), which the packaging test enforces.
- Orchestrator audit (macOS): the matrix rows Version mismatch and Not main were checked by running the extracted guard logic; Release, CI red, No trusted publisher and Registry verify can only run on a real tag (the user's steps). 160 tests pass; tarball and `file:` registry-mode smoke pass. Ticket 10's entry text was updated from the npm token to trusted publishing.

## Plan Change Log

- Provenance (epic 1 retrospective, A8, 2026-09-30): story 1.8 was rebased under this branch, so `baseline_revision` moved from `695ebcd` to `8209469`, the parent of this story's commit `9ca222d`.

## Review Triage Log

### Pass 1 (quick lens) — 2026-09-30

Counts: high 1, medium 1, low 4.

| # | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|
| 1 | No `repository` field; trusted publishing with provenance requires `repository.url` to match the repo, so the publish would be rejected (E422) | high | patch | Added `repository`, `homepage` and `bugs`; the packaging test asserts them. |
| 2 | E422 unexplained in the error text and RELEASING.md | low | patch | Cause and fix documented in both. |
| 3 | A post-publish check failure skips `verify`, and a re-run stops at "Already published" | medium | patch | A separate `registry` job; publish is idempotent by `gitHead` (set before pack); verify needs only publish. |
| 4 | README's relative CHANGELOG link breaks on npm | low | patch | Absolute GitHub URLs. |
| 5 | Prerelease tags publish without `--tag` | low | patch | `dist-tag` `next` for prereleases. |
| 6 | The main check accepts merged feature-branch commits | low | patch | First-parent history only. |

## Tasks & Acceptance

**Execution:**
- [x] `.github/workflows/release.yml` -- tag trigger; guards (main, version equals tag); call ci.yml; publish with OIDC; 3-OS registry verify.
- [x] `ci.yml` -- add `workflow_call`.
- [x] Versions 0.1.0 and root `private: false`; `CHANGELOG.md` with a 0.1.0 entry.
- [x] `scripts/smoke-installed.mjs` -- registry mode.
- [x] `RELEASING.md` -- the checklist: make the repo public; configure the npm trusted publisher (exact fields); merge the epic 1 stack to `main`; tag; watch the release.
- [ ] hitl (user): configure the trusted publisher on npmjs.com for `ogden-agents`; make `hsmith-dev/ogden-agents` public; approve pushing the `v0.1.0` tag.

**Acceptance Criteria:**
- Given the tag `v0.1.0` on `main`, when the release workflow runs, then `ogden-agents@0.1.0` is on npm with provenance, and `npx ogden-agents@0.1.0` reaches the page on macOS, Windows and Linux.
- Given a tag whose version doesn't match the packages, when the workflow runs, then nothing is published.
