---
title: 'Bundled runtime: pinned Node and the packed server for every target'
type: 'feature'
ticket: '4'
created: '2026-10-05'
status: 'built'
baseline_revision: '4e4006e3e9348d3e160ef1f3c4b15f35375eed65'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['security', 'correctness']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-desktop-app/epic-desktop-app.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The tracer's staging script works for one target on trust. The app must bundle, for every target it ships, a Node that is checked against its pin, the npm that ships with it, and the packed server with native modules built for that target, and prove the result runs with no Node on the machine (E13-R2).

**Approach:** Split the pinned download into `node-archive.mjs` (refuses a mismatch, checks even a cached file), keep `stage.mjs` as the staging script (sidecar, npm, production install with the bundled npm, foreign prebuilds pruned, native load check that fails the build when better-sqlite3, @napi-rs/keyring or node-pty does not load), add `verify-stage.mjs`, and a `Runtime` lane in the Desktop workflow on native runners: macOS universal, Windows x64 and Windows ARM64 (Linux is out of scope by the user's decision of 2026-10-05).

## Boundaries & Constraints

**Always:** a hash mismatch fails the build; node-pty is required in the app (AD-19 still lets the server run without it); no network, real agent or real keychain in verification (private data folder, memory secret store); the npm package is unchanged.

**Never:** SEA, a signed or published artifact, Linux targets.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Tampered download | wrong bytes | build fails, file removed | `PinMismatchError` |
| Swapped cache entry | wrong cached file | refused and removed, not trusted | same |
| node-pty missing | a target without a prebuild | stage fails | native check throws |
| Staged app, no system Node | PATH holds only the staged Node | server starts, serves, quits; staged npm installs a fixture | job fails with the server log tail |

</frozen-after-approval>

## Code Map

- `packages/desktop/scripts/{node-archive,stage,verify-stage}.mjs`, `desktop-node-pins.json`.
- `.github/workflows/desktop.yml` job `runtime`.
- `tests/desktop-stage.test.ts` -- tampered, cached and right downloads against a local server.

## Tasks & Acceptance

**Execution:**
- [x] `node-archive.mjs` and `stage.mjs` use it; natives must load
- [x] `verify-stage.mjs` (launcher `--json` as the shell runs it, quit through the server, bundled npm with a fixture)
- [x] `Runtime` lane for macOS universal, Windows x64, Windows ARM64
- [x] tests for the tampered, cached and right downloads
- [ ] CI green on all three legs

**Acceptance Criteria:**
- Given a tampered Node archive the build fails; given the staged runtime and a PATH of only the staged Node, the server starts, serves, exchanges a code and quits on each native runner.

## Implementation Notes

- Verified locally on macOS arm64 before CI: staging in 13 s, `verify-stage` passes.
- npm layout: the shell sets `npm_execpath` to the staged `npm/bin/npm-cli.js` (the launcher-npm rule of `findNpmCli`, read at server start) rather than placing it beside the binary, because the sidecar sits in the app's binary folder and the npm tree in resources. Spike 13.1 showed this works on every OS.
- The epic's "installs Claude Code from fixtures through its bundled npm" is checked as: the staged npm, with only the staged Node on PATH, packs and installs a fixture package offline. The server's own install flow is covered by the existing adapter tests; the launcher path the shell uses is covered by `verify-stage`.
- Unknown "prebuilds for Windows ARM64 on Node 24": spike 13.1 showed better-sqlite3, @napi-rs/keyring and node-pty load there; the Runtime lane re-proves it on `windows-11-arm`.

## Plan Change Log

## Review Triage Log

Pass 1 (security and correctness, self-review): medium 1, low 2.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | A cached archive could be swapped between runs | medium | patch | The hash is checked on every use, cached or downloaded; a bad file is deleted. Tested. |
| 2 | `OGDEN_DESKTOP_NODE_BASE` redirects the download | low | reject | Build-time only, used by the test; the pin still has to match, so a mirror cannot supply other bytes. |
| 3 | `verify-stage` could leave a server running on failure | low | patch | It kills the launcher and the server tree in `finally` and removes its folder. |

## Verification

**Commands:**
- `node packages/desktop/scripts/stage.mjs --target aarch64-apple-darwin --tgz ogden-agents-<version>.tgz && node packages/desktop/scripts/verify-stage.mjs --target aarch64-apple-darwin`
