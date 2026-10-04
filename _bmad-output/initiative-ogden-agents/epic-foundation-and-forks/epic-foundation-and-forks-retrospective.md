---
epic: epic-foundation-and-forks
date: 2026-09-30T01:54:47-0600
verdict: rejected
criteria: declared
headless: true
---

# Retrospective: Ogden Agents installs, opens and stays up to date on every OS (epic 1)

## Epic summary

**Epic:** `epic-foundation-and-forks` (epic 1), resolved from the folder `_bmad-output/initiative-ogden-agents/epic-foundation-and-forks` given in the invocation. `tickets.py status` ran and returned 12 tickets.

**Tickets, in build order** (from `tickets.py status`):

| Ref | Title | status / state | Plan baseline | Independent review |
|---|---|---|---|---|
| 1.1 | Tracer bullet: launcher to live page | built / review | `cad6fa9` | quick lens, 1 medium, 5 low |
| 1.2 | CI matrix and single-package bundling | built / review | `be4eda7` | quick lens, 1 medium, 6 low |
| 1.3 | Event log and entity model | built / review | `2e4dd2b` | quick lens, 3 medium, 4 low |
| 1.4 | Security gate | built / review | `c4d8741` | quick lens, 1 medium, 3 low |
| 1.5 | Design direction | built / review | none (Build Record only) | **none**: "The optional reviewer gate was not run" |
| 1.6 | Design system and app shell | built / review | `41ba57d` | quick lens, 2 medium, 11 low |
| 1.7 | Background server lifecycle and version handshake | built / review | `c0614a8` | quick lens, 3 medium, 6 low |
| 1.8 | uv bootstrap | built / review | `8b92eeb` | quick lens (security focus), 1 high, 2 medium, 5 low |
| 1.9 | Forks bundled and locked | built / review | `1f5baef` | quick lens, 1 high, 3 low |
| 1.10 | First npm release | built / review | `695ebcd` | quick lens, 1 high, 1 medium, 4 low |
| 1.11 | Refactor sweep | built / review | `bf4dbb2` | quick lens, 4 low |
| 1.12 | End-to-end suite | built / review | `fa60410` | quick lens, 2 medium, 3 low |

- **Unfinished tickets (`pending_tickets`):** none. Every ticket is `built`.
- **Tickets still at `built`, not yet `done`:** all 12 (1.1 to 1.12). All sit in state `review`, and every PR is still open (PRs #1 to #14, none merged; `gh pr list`).

**Ranges, from each plan's `baseline_revision`** (oldest first; history is linear, 0 merges; `git_evidence.py` run once per range):

| Plan | Range | Commits in range (by subject) |
|---|---|---|
| 1.1 | `cad6fa9..be4eda7` | `be4eda7` (1.1) |
| 1.2 | `be4eda7..2e4dd2b` | `bb4451b` (1.2), `0c7a4a7`, `c66955d` (Windows fixes), `2e4dd2b` (CI note) |
| 1.3 | `2e4dd2b..c4d8741` | `e89d591` (1.3), `fb8d2c4` (rename), `b93b335` (Windows fix), `c4d8741` |
| 1.4 | `c4d8741..41ba57d` | `f01e14c` (1.4), `41ba57d` (1.5) |
| 1.5 | no baseline recorded | none; its commit `41ba57d` falls in 1.4's range |
| 1.6 | `41ba57d..1f5baef` | `1f5baef` (1.6) |
| 1.9 | `1f5baef..c0614a8` | `c0614a8` only (v2-epic planning doc). **Not 1.9's work** (see finding P1). |
| 1.7 | `c0614a8..8b92eeb` | `8b92eeb` (1.7) |
| 1.8 | `8b92eeb..695ebcd` | `695ebcd`, which is **story 1.9's** commit |
| 1.10 | `695ebcd..bf4dbb2` | `8209469` (1.8), `9ca222d` (1.10), `e326508`, three epic-2 planning commits, `bf4dbb2` (**story 2.1**, epic 2) |
| 1.11 | `bf4dbb2..fa60410` | `0972368` (spec docs), `a4fef75`..`d2692cb` (items 1 to 7), `fa60410` (review fixes) |
| 1.12 | `fa60410..HEAD` (inferred: HEAD = `2df2e5a`) | `2df2e5a` (1.12) |

The recorded baselines for 1.8, 1.9 and 1.10 no longer bound their own work, so the aggregate views attribute commits by subject (`story 1.x` in every commit message) as well as by range. The whole-epic range is `cad6fa9..2df2e5a`: 32 commits, 0 merges, 162 code files (packages, bin, scripts, tests, .github), 16,563 insertions. It includes one epic-2 story (2.1, `bf4dbb2`) and five planning or docs commits.

**Evidence inventory**

- Available and read: the epic file, the initiative file, `tickets.toml`, all 12 plans, `deferred-work.md`, the architecture spine (AD-15 and AD-20), the story 2.1 plan (the AD-15 amendment), `CHANGELOG.md`, `README.md`, `CONTRIBUTING.md`, `forks.lock`, both workflows, git history, and `gh pr checks` for PRs 1 to 14. Also the CI run history (24 runs, 7 non-green or retried), npm (`npm view ogden-agents`) and repo visibility (`gh repo view`).
- Missing: **session logs.** None were available, so the process-lesson analysis draws only on the plans' Implementation Notes, Plan Change Logs and Review Triage Logs. A reader can't tell from this retro *why* a session took a turn that the plans don't record.
- Missing: **story files.** No ticket was refined (`refined: false` for all), which is expected.
- Missing: **a previous retrospective.** This is the first epic.

## Findings

Each finding has a source and two dispositions: what to do about this instance, and what would prevent the next one.

### Spec-to-implementation reconciliation

**S1. Done when 1 is not met: nothing is on npm.**
- Evidence: `npm view ogden-agents versions` returns only `["0.0.0"]` (the 1.1 name-reservation placeholder). `git ls-remote --tags origin` shows no tags. `gh repo view` reports `visibility: PRIVATE`. No PR is merged to `main`.
- The 1.10 plan's hitl task is unticked: "configure the trusted publisher on npmjs.com …; make `hsmith-dev/ogden-agents` public; approve pushing the `v0.1.0` tag" (`story-first-npm-release-plan.md`, Tasks). Its audit note adds: "Release, CI red, No trusted publisher and Registry verify can only run on a real tag (the user's steps)."
- The closest evidence is PR #14's `End-to-end, installed` job, green on macOS, Ubuntu and Windows. It installs the *packed tarball*, not the registry package.
- **Instance:** fix now (a user hitl step, action A1). **Prevention:** a hitl step that gates a Done-when criterion should be a visible blocker on the ticket, not a checkbox inside a plan whose status already reads `built`.

**S2. The 0.1.0 changelog and README describe a release that the tagged code won't match.**
- `CHANGELOG.md` "0.1.0 — first release" says the gate exchanges the code "for an `HttpOnly`, `SameSite=Strict` cookie".
- `README.md:68` says "Version 0.1.0 used a session cookie (`ogden_session_<port>`) … it has been replaced by the per-tab token".
- `package.json` on HEAD is still `0.1.0`, and HEAD already contains story 2.1's per-tab token (`bf4dbb2`).
- `RELEASING.md` says to merge the epic 1 stack to `main` and then tag. The stack now includes 2.1 (PR #11 sits under #13 and #14), so the first published `0.1.0` would ship the token while its changelog describes a cookie.
- **Instance:** fix now, before tagging (A2). **Prevention:** a story that changes shipped behavior after the release story was written must move the CHANGELOG entry and version too. Epic 2's 2.1 landed between 1.10 and the release.

**S3. Done when 2 and R2 still describe the retired cookie.**
- The epic's R2 says "exchanged for a cookie", and Done when 2 says "A request without the session cookie … is refused".
- AD-15 was amended (architecture lines 187 and 195; user renegotiation 2026-09-30) to a per-tab token, with no cookie.
- The criterion's *intent* holds, observed directly (see Behavior verification). The wording doesn't.
- **Instance:** accept the deviation and reconcile the spec (A6). **Prevention:** when an architecture decision is amended, sweep the epics that cite it.

**S4. AD-20 as built differs from its rule text, and the difference isn't recorded.**
- AD-20 (architecture line 242–243) says "the launcher *offers* a restart once all sessions are idle or done" and "The server rejects UI assets from another version."
- As built:
  - The launcher asks an older, idle server to restart, and it stops without asking the user (`packages/server/src/launcher.ts:8-11`, `:353-387`).
  - The server doesn't reject UI assets from another version. A grep of `packages/server/src` finds no such check. The UI shows a non-blocking "Reload" banner instead (`packages/web/src/shell/version-banner.tsx:13`), which the 1.7 plan chose (plan line 36, "Version drift in UI" row).
- Neither deviation is in the architecture memlog or the 1.7 plan's Plan Change Log.
- **Instance:** accept both deviations and reconcile AD-20's rule text (A6). They are reasonable and tested (handshake and lifecycle e2e tests, 1.7 audit). **Prevention:** a plan that substitutes behavior for an AD rule records it as a spec change, as 1.3 did for AD-5 and 1.6 did for the `ui/` convention.

**S5. `deferred-work.md` carries two entries that are already resolved.**
- "Confirm the 6-job CI matrix is green" was settled by `2e4dd2b` (1.2 plan: "GitHub Actions run 36665078789: 6/6 jobs green").
- "Move API and WebSocket auth from the loopback session cookie to a per-tab token" was resolved by story 2.1 (`bf4dbb2`).
- The file is append-only, so neither entry has a resolution line.
- **Instance:** fix now, by appending resolution entries (A7). **Prevention:** an entry's resolving commit appends a closing line.

**Carried decisions landed correctly (no action).** 1.3's deferred items (the session-event `workspaceId` helper and paged subscriptions) appear as epic 2's E2-R7 and E2-R8 (`epic-chat-and-workspaces.md:31-32`). The per-tab token (AD-15 amendment) shipped as story 2.1 before epic 2 exposes agent control, as deferred-work.md required.

### Aggregate views

**A1. Duplication: two independent in-house tar and zip readers, only one of them hardened.**
- 1.8 wrote `packages/adapters/src/toolchain-uv/archive.ts` (`readTarGz`, `readZip`). 1.9 separately wrote `scripts/vendor-forks.mjs:238` (`parseTar`) and `:272` (`readZip`). Both plans claim "a small tar parser and a small zip reader" as their own design.
- After 1.8's security review, `archive.ts` checks entry bounds, CRC-32, sizes, encryption and zip64.
- `vendor-forks.mjs` checks none of these: `readZip` trusts `compressedSize` and `localOffset`, and `parseTar` silently truncates an entry that runs past the buffer.
- The 1.11 sweep scope (seven items, `story-refactor-sweep-plan.md`) didn't include it.
- Consequence is low: `--check` hashes the result, so corruption fails the check rather than passing it. But the next session will copy whichever reader it finds first.
- **Instance:** defer (A4). **Prevention:** search for an existing helper before writing a parser (proposed pitfall 7).

**A2. Size growth: no god class.**
- The largest production files after the epic: `scripts/vendor-forks.mjs` 496 lines, `packages/server/src/start.ts` 445 (net +445 over the epic), `packages/server/src/launcher.ts` 415, `packages/adapters/src/toolchain-uv/uv-toolchain.ts` 401.
- The largest churn is test code: `packages/server/test/gate.test.ts`, +932/−311, rewritten twice by 1.4 and 2.1.
- Nothing needs splitting. `start.ts` is the one to watch, since every lifecycle story (1.1, 1.3, 1.4, 1.7, 1.11) touched it.
- **Instance:** accept.

**A3. Pattern divergence: mostly caught by the 1.11 sweep.**
- 1.11 moved every API route under `/api/v1` through `API_ROUTES`, unified the error shape, consolidated test helpers and unified the version source (`a4fef75`, `c3944a5`, `d2692cb`, `fda60a5`).
- 1.8 knowingly broke the `/api/v1` convention to match 1.7's `/api/server/quit` ("Routes follow the plan's paths … not the `/api/v1` convention"). That is the "agents copy what they see" effect the sweep plan names, and the sweep repaired it.
- `/launcher/restart-when-idle`'s ad hoc 409 body is a deliberate, recorded exclusion (1.11 triage #1).
- **Instance:** accept. **Prevention:** run the sweep's convention checks as tests. `tests/route-literals.test.ts` already does this for routes.

**A4. Architecture delta: AD-1 held.**
- `tests/architecture.test.ts` enforces the dependency edges. After 1.1's review it also scans `src` import specifiers.
- 1.11 split `dist/launcher.js` so the launcher never loads `better-sqlite3`. `tests/packaging.test.ts` inspects the launcher's import graph for this.
- Core gained its third-party dependencies (SQLite, Drizzle, env-paths, ulid) under AD-11, and the 1.3 plan's Design Notes justify it.
- No cycles or layering violations were found in the changed files I read. This was derived from the changed files and the tests, not a dependency-graph tool (narrowed).

### Diff-scope review (`bmad-review`: adversarial, edge-case-hunter, verification-gap)

`bmad-review` ran headless on `git diff cad6fa9..2df2e5a` for packages, bin, scripts, tests and .github: 17,141 lines. The lenses ran **inline and sequentially, on a narrowed scope**, because subagents weren't used in this run. The files read in full were the ticket-boundary files:
- `gate.ts`, `launcher.ts` (header and version rule)
- `release.yml`, `ci.yml`
- `smoke-installed.mjs`, `installed-package.mjs`
- `archive.ts`, the `vendor-forks.mjs` archive section
- `version.ts`, `tsdown.config.ts`, `version-banner.tsx`

Everything else in the diff was checked only through the plans' audit notes and CI, so it counts as never checked. Findings by lens (overlap with S and A findings is noted):

**Adversarial**

- **R1.** `CHANGELOG.md` / `README.md:68` vs `package.json` 0.1.0: the published 0.1.0 would contradict its own changelog. *Same as S2.* Fix now.
- **R2.** The 1.10 plan says `release.yml` never ran ("can only run on a real tag"), so all four release paths — guard, CI call, OIDC publish and registry verify — are unexercised. The first real run is also the first release. **Instance:** fix now, as part of A1. A dry-run prerelease tag (for example `v0.1.0-rc.0` to the `next` dist-tag, which the workflow already supports) exercises the path without taking `latest`.
- **R3.** `release.yml`, "Is this version on npm already": a transient `npm view` failure reads as "not published". The publish then fails with an error text that blames the trusted publisher. It is re-runnable. Defer.
- **R4.** Merging the epic now means merging epic 2's work. The PR stack runs #1 → … → #10 (epic 2 planning) → #11 (story 2.1) → #12 (spec docs) → #13 (1.11) → #14 (1.12), so epic 1 can't reach `main` without epic 2's 2.1. Accept for this epic (2.1 is the security fix that deferred-work.md required). See prevention lesson L3.
- **R5.** `installed-package.mjs` `prepareInstall` sets no npm log level. When npx stalls on the registry, nothing is captured: run 36684926253 attempt 1, `macos-latest / Node 26`, "smoke: FAILED: timed out after 240000 ms … --- captured output --- (none)". The empty npm cache also forces a full registry download of every runtime dependency on each of the 6 matrix jobs, plus the 3 e2e-installed jobs, plus 6 release-verify jobs. Fix now (A3).
- **R6.** The 1.4 gate order changed under 2.1. A WebSocket upgrade with a foreign Origin and *no* token now gets 401, not 403 (observed; see Behavior verification), because the token check runs before the Origin check (`gate.ts` rules 4 and 5). It is still refused, so Done when 2 holds. Accept, and record so later runs stop re-flagging it.
- **R7.** Duplicate archive readers. *Same as A1.* Defer.
- **R8.** `launcher.ts:239` `killTree` (1.7 triage #5, "untested path") has no reference in any test. A search of packages, tests and scripts finds it only in `src/launcher.ts` and its build output. Defer (A5).
- **R9.** uv install on Windows and Linux was never run end to end against a real release:
  - The 1.8 plan says "macOS tarball installed and run end to end; the x86_64 Windows zip read".
  - The `uv pins` job only re-hashes the archives.
  - The e2e Settings > Tools test runs on Linux Chromium against a fixture.
  - R6 of the epic ("with no terminal") is therefore proven on macOS only.

  Defer (A11).
- **R10.** Plan hygiene: tickets marked `built` carry unticked tasks.
  - 1.4 "Update the existing server tests …": done per its notes; the triage rejected it as a plan edit.
  - 1.10 hitl: genuinely open (S1).
  - 1.11 "Items 1–7": done.

  A reader can't tell done from open without reading every Implementation Note. Prevention (L4).
- **R11.** Plans cite SHAs that no longer exist on the branch:
  - 1.11's audit note cites `98f8f84`..`91ba682` and `4b1419c`. `git merge-base --is-ancestor` says none is on HEAD. They exist only as pre-restack objects; the branch holds `a4fef75`..`d2692cb` and `fa60410`.
  - 1.8, 1.9 and 1.10's `baseline_revision` values no longer bound their work (P1).

  Fix now (A8).

**Edge-case hunter** (path tracing over the boundary files)

- **E1.** `scripts/vendor-forks.mjs:272-300` `readZip`: no check that `dataStart + compressedSize` ≤ `buf.length`, no zip64 sentinel check, no CRC. Guard: reuse the checks at `archive.ts:116-176`. A truncated wheel reads short and fails as a hash mismatch rather than a clear error.
- **E2.** `scripts/vendor-forks.mjs:238-268` `parseTar`: an entry `size` past the end of the buffer is silently truncated by `subarray`. Guard: `if (offset + 512 + size > buf.length) throw …` (as at `archive.ts:75`).
- **E3.** `scripts/installed-package.mjs` `runLauncher`: an npx install stall has no progress signal and no retry. Guard: `env.npm_config_loglevel = 'http'`, plus one retry of the install phase on timeout. Otherwise a registry stall fails the job with "(none)" as output.
- **E4.** `.github/workflows/release.yml` "Is this version on npm already": `npm view` network failure → `already=false`. Guard: tell E404 apart from other errors and retry the view. Otherwise the publish error misleads the reader.

Claims check against `git log` subjects: "build dist/launcher.js on its own so `ogden` never loads better-sqlite3" (`128f8cd`) holds, since the launcher imports only `@ogden-agents/core/data-dir` (`launcher.ts:19`) and a packaging test pins it. "issue launch codes only on request" (`b32e4c5`) holds: a second launch printed a fresh link, and the first one's code was single-use (code reuse → 401). No claim was falsified.

**Verification gap**

- **V1** (broken-verification gap). *Consumer:* the tag-push path of `.github/workflows/release.yml`. *Evidence:* the 1.10 plan's audit note says the rows Release, CI red, No trusted publisher and Registry verify "can only run on a real tag". The guard logic was checked only by running an extracted copy. No CI job runs `release.yml`. *Consequence:* a broken OIDC or trusted-publisher setup surfaces only on the real release.
- **V2** (regression gap). *Consumer:* the timeout path, `launcher.ts:305` → `killTree`. *Evidence:* a repo-wide search for `killTree` finds no test reference. *Consequence:* a spawned server that never becomes ready would be orphaned, and nothing would fail.
- **V3** (regression gap). *Consumer:* R6 on Windows and Linux, `uv-toolchain.ts` install against real archives. *Evidence:* see R9. The adapter tests use a local fixture server, and the real install ran on macOS only. *Consequence:* a Windows extraction or rename (`moveIntoPlace` EPERM/EBUSY retries) regression ships unseen.
- **Checked and clean:**
  - Forks tamper → `--check` fails: `tests/vendor-forks.test.ts:100`, "names an edited, a missing and an added file", runs in the normal suite.
  - Gate refusals: `tests/e2e-installed/{gate,bypass}.spec.ts`, where the bypass proves each refusal is the gate's (1.12 triage #1). Green on 3 OSes in PR #14.

### Process and CI findings

**P1. Restacking left baselines and SHAs stale.**
- The orchestrator moved `baseline_revision` after rebasing 1.3 and 1.4 ("`baseline_revision` moved with it").
- It didn't do so for 1.8, 1.9 and 1.10 after the stack was reordered. 1.9's range holds only `c0614a8`, 1.8's holds 1.9's commit, and 1.10's holds 1.8's commit and story 2.1 (range table above).
- The PR bases show the same reordering: PR #6 (1.9) is based on 1.7, PR #9 (1.8) on 1.9, and PR #8 (1.10) on 1.8.
- **Instance:** fix now (A8). **Prevention:** proposed pitfall 6.

**P2. Review depth was "quick" everywhere, and one story had no review at all.**
- Every code plan records `review: 'quick'`, `review_source: 'pinned'`, `lenses_ran: ['quick']`, including the three `risk = "high"` tickets (1.2, 1.4, 1.7 in `tickets.toml`).
- Even the single quick lens found real defects in every code story, three of them high:
  - 1.8: disk error crashes the server.
  - 1.9: `setup-uv@v10` doesn't resolve.
  - 1.10: missing `repository` field, which would fail with E422.
- Mediums included 1.4's cookie leaking to other loopback ports, which led to the AD-15 amendment, and 2.1's token recorded in browser history.
- 1.5 ran no reviewer ("The optional reviewer gate was not run"), so the claim "every story went through an independent review" holds for the 11 code stories, not for 1.5.
- **Prevention:** L1.

**P3. Windows CI caught three defects that no macOS check could.**
- CRLF shebang: `ERR_PNPM_BIN_CRLF`, fixed in `0c7a4a7` (run 36664605668).
- Quoted `npx` resolving `%~dp0` to the work dir: fixed in `c66955d` (run 36664854472).
- env-paths' `\Data` suffix: fixed in `b93b335` (run 36666954750).

All three were found only after the user pushed. 1.2 had deferred the push, and its "maybe-false" triage verdict turned out to be a real failure. **Prevention:** L2, and proposed pitfalls 2 to 4.

**P4. A transient macOS / Node 26 smoke failure needed a rerun.**
- Run 36684926253 (PR #14) attempt 1 failed the smoke step after 240 s with no output. Attempt 2 passed.
- It's a flake, not a defect, but the empty capture made the diagnosis guesswork (R5, E3).
- **Instance:** fix now (A3).

**P5. Parallel and stacked work was otherwise well controlled.**
- Every plan has a matrix-test audit note.
- Every CI-dependent claim was later settled with a run ID (1.2, 1.3).
- Source conflicts were settled in favor of the spines (1.6, 1.7).
- **Instance:** accept, and keep doing this.

## Behavior verification

Run on macOS (Node 24.21.0, pnpm 12.8.1) in this worktree at `2df2e5a`. The only files written are git-ignored build outputs: `node_modules/`, `dist/`, `ogden-agents-0.1.0.tgz`.

- `pnpm install --frozen-lockfile` and `pnpm run pack`: both exit 0, producing `ogden-agents-0.1.0.tgz`.
- `node scripts/smoke-installed.mjs`: **OK** in 13 s. It saw each of these:
  - a clean npx install
  - the launcher exited 0 and the server kept running
  - the page returned with its CSP, and the API refused a tokenless request
  - the launch link gave the tab a token, and the API accepted it
  - `server.started` arrived as seq 1
  - Quit removed `server.json` and `launcher.token`
- `node bin/ogden.js --no-open --port 0` with a temp `OGDEN_AGENTS_DATA_DIR`: it printed "Starting Ogden Agents in the background…", the URL and a `/#c=` one-time link, then exited 0. `server.json` held `{port, pid, version: "0.1.0", startedAt}`.
- A second `node bin/ogden.js --no-open` printed "Ogden Agents is already running (version 0.1.0)" and a fresh link. `server.json` was unchanged (same pid), so it attached and didn't start a second server.
- Gate probes with `curl`:

  | Request | Result |
  |---|---|
  | `/api/v1/tab`, no token | 401 |
  | foreign `Host` | 403 |
  | WebSocket upgrade, foreign Origin, no token | 401 |
  | WebSocket upgrade, correct Origin, no token | 401 |
  | WebSocket with a valid token, foreign Origin | **403** |
  | WebSocket with a valid token, no Origin | **403** |
  | WebSocket with a valid token, correct Origin | 101 |
  | API with the token | 204 |
  | reusing the spent launch code | 401 |
  | `POST /api/v1/server/quit` with `force: true` | 202 `{"stopping":true,"busySessions":0}`, server stopped, `server.json` removed |

- `node scripts/vendor-forks.mjs --check`: "vendor/ matches forks.lock (v6.13.0-next-ogden-agents.0, v0.13.0-ogden-agents.0)", exit 0.

Not exercised here:
- the older-server restart offer, which relied on `handshake.test.ts`, `tests/launcher.test.ts` (fake older server) and the lifecycle e2e, all green in CI
- a real uv install
- Windows and Linux, which relied on CI: PRs 1 to 14 are all green on the latest runs, including `End-to-end, installed` on macOS, Ubuntu and Windows in PR #14
- publishing to or installing from the npm registry, which isn't possible: nothing is published (S1)

## Previous-retro follow-through

Nothing to follow through on: **no previous retrospective file exists**. Epic 1 is the first epic in the initiative, and no `*-retrospective.md` exists in any epic folder. The folder `epic-retrospectives` is a product epic, not a retro.

## Action items

All items are proposed. None was applied by this run. "Remediation" goes to the normal dev loop. "Spec reconciliation" waits for a human to apply it.

| # | Action | Owner | Kind | Source |
|---|---|---|---|---|
| A1 | Complete the 1.10 hitl release, in this order: merge the PR stack to `main`, make `hsmith-dev/ogden-agents` public, configure the npm trusted publisher, then settle A2. Consider a `v0.1.0-rc.0` prerelease tag first, to exercise `release.yml` on the `next` dist-tag. Then tag `v0.1.0` and confirm the registry `verify` job passes on all 6 OS/Node jobs. This closes Done when 1. | User (Harrison) | Remediation (hitl) | S1, R2, V1 |
| A2 | Before tagging, align the 0.1.0 text with the code: fold CHANGELOG's "Unreleased" per-tab-token entry into 0.1.0, rewrite its "Security gate" bullet, and fix `README.md:68`. The alternative is to bump the version so 0.1.0 isn't claimed by two behaviors. | Dev loop (`bmad-build`), user decides which | Remediation | S2, R1 |
| A3 | Make the clean-install smoke diagnosable: set `npm_config_loglevel=http` (or stream npx progress) in `scripts/installed-package.mjs`, and retry the install phase once on timeout. | Dev loop | Remediation | R5, E3, P4 |
| A4 | Harden or unify the archive readers in `scripts/vendor-forks.mjs` (bounds, CRC, zip64 sentinel), for example by porting the checks from `packages/adapters/src/toolchain-uv/archive.ts`. | Dev loop (defer; add to the next sweep) | Remediation | A1, E1, E2 |
| A5 | Add a test for `launcher.ts` `killTree` on the spawn-timeout path (spawned server that never becomes ready). | Dev loop (defer) | Remediation | R8, V2 |
| A6 | Reconcile the spec: (a) the epic's R2 and Done when 2 wording to the per-tab token; (b) AD-20's rule text, where the launcher asks an idle older server to restart and the UI shows a reload banner instead of the server rejecting UI assets from another version; record both in the architecture memlog. | User via `bmad-architecture` / `bmad-ticket` | Spec reconciliation | S3, S4 |
| A7 | Append resolution entries to `deferred-work.md` for the "6-job CI matrix" item (`2e4dd2b`, run 36665078789) and the "per-tab token" item (`bf4dbb2`, story 2.1). | Planning (`bmad-ticket`) | Record | S5 |
| A8 | Correct stale provenance: set `baseline_revision` for 1.8, 1.9 and 1.10 to the parents of `8209469`, `695ebcd` and `9ca222d`, and replace 1.11's cited `98f8f84`/`91ba682`/`4b1419c` with `a4fef75`..`d2692cb`/`fa60410`. From now on, update both after every restack. | Orchestrator | Remediation (records) | P1, R11 |
| A9 | Run a real uv install through the UI on Windows and Linux: a manual check, or a CI job gated to the `uv pins` schedule. | Dev loop (defer) | Verification | R9, V3 |
| A10 | Record the proposed AGENTS.md pitfalls below. The repo has no `AGENTS.md` yet; create it with `bmad-project-context`. | User via `bmad-project-context` | Process | P2, P3, R11 |
| A11 | After A1 lands, move tickets 1.1 to 1.12 to `done` (user-confirmed). | User via `bmad-ticket` | Close-out | Epic summary |

**Process lessons**, for epic 2's inception and later epics:

- **L1.** Match review depth to risk. `risk = "high"` tickets, and any ticket touching auth, publishing, installers or CI actions, should get more than the pinned `quick` lens (adversarial plus edge-case at least). Every quick review in this epic still found real defects. Doc-only stories (1.5) should run the reviewer gate rather than skip it.
- **L2.** Push early. Any story with an OS-specific unknown should push to CI before triage closes. Windows-only defects were found only after pushing (P3), and a "maybe-false" deferral turned out true.
- **L3.** Don't build another epic's story inside this epic's PR stack unless the user decides it explicitly. 2.1 under 1.11 and 1.12 now couples the two epics' merges (R4).
- **L4.** A plan marked `built` shouldn't carry unticked tasks. Either tick them, or name the open hitl step as a blocker (R10, S1).

## Proposed AGENTS.md pitfalls

Proposed for the project's `AGENTS.md` pitfalls section, each observed in this epic. Not applied: the file doesn't exist in the repo, and adding it is `bmad-project-context`'s job (A10).

1. **GitHub Action refs:** check that a version tag exists before you use it. `astral-sh/setup-uv@v10` doesn't resolve, because only exact `v10.x.y` tags exist (1.9 triage #1). Check with `gh api repos/<owner>/<repo>/git/matching-refs/tags/<tag>`.
2. **Line endings:** keep executable scripts and shebang files LF via `.gitattributes`. Windows checkouts otherwise fail with `ERR_PNPM_BIN_CRLF` (`0c7a4a7`).
3. **npx on Windows:** don't spawn `npx`/`npx.cmd` through a shell by a quoted name, because `%~dp0` resolves to the cwd. Run `node_modules/npm/bin/npx-cli.js` with `process.execPath` (`c66955d`).
4. **Per-user paths:** don't assume `env-paths` folders end in the app name. Windows appends `\Data` (`b93b335`).
5. **Loopback auth:** never authenticate with cookies on `127.0.0.1`, because browsers send them to every port. Never put a token in a URL, including the fragment, because it lands in browser history. Exchange a single-use code in a same-origin POST and return the token in the body (AD-15 as amended; 1.4 triage #2; 2.1 triage #3).
6. **Streams and child processes:** every write stream, socket and child process needs an `error` handler. An unhandled disk error in the uv download crashed the server (1.8 triage #1).
7. **npm trusted publishing:** `package.json` `repository.url` must match the GitHub repo exactly, or the publish is rejected with E422 (1.10 triage #1).
8. **Before writing a parser or helper:** search `scripts/` and `packages/` for an existing one. Two unrelated tar and zip readers now exist (A1).
9. **After a rebase or restack:** update the plan's `baseline_revision` and any commit SHAs it cites. Otherwise ranges and audit notes point at the wrong or missing commits (P1, R11).

## Acceptance verdict

**Machine verdict: rejected**, from declared criteria (the epic file's Done when). The completeness check ran and found no unfinished tickets, so the verdict rests on the criteria, not on pending work.

| # | Done when | Result | Evidence |
|---|---|---|---|
| 1 | On a fresh macOS, Windows and Linux machine, `npx ogden-agents` **from npm** starts the background server and opens the browser | **Not met** | npm has only `0.0.0`; no tag; repo private; no PR merged (S1). The packed-tarball install works on all three OSes (PR #14 `End-to-end, installed` ×3; smoke green on 6 jobs; local smoke OK), so what remains is the release step itself. |
| 2 | A request without the session cookie, with a foreign `Host`, or with a foreign `Origin` on a WebSocket is refused | Met (in intent; wording stale, S3) | Observed: no token → 401; foreign Host → 403; foreign Origin WebSocket → 403 with a token, 401 without. `gate.spec.ts` and `bypass.spec.ts` green on 3 OSes. |
| 3 | A newer launcher finding an older running server offers a restart and does not stop it | Met with a recorded interpretation (S4) | Idle older server is asked to restart; busy one is kept ("kept-older"); `tests/launcher.test.ts` fake-older-server cases and `handshake.test.ts`, green in CI. |
| 4 | CI proves a clean install on all three OSes for Node 24 and 26, and fails when the bundled forks differ from `forks.lock` | Met | 6 matrix jobs with the smoke step, green on PRs 1 to 14; `vendor-forks.mjs --check` runs in every matrix job; `tests/vendor-forks.test.ts:100`; local `--check` clean. |
| 5 | `DESIGN.md` and `EXPERIENCE.md` exist, and the first screens use only `packages/web/ui` components and tokens | Met | Both files exist under `ux-ogden-agents/`; `tests/design-tokens.test.ts` (raw-value lint and token drift) and the feature-styling lint pass (1.6 audit). |

**Why rejected:** criterion 1 is not met in the evidence, and it's the epic's stated Outcome signal ("A user runs `npx ogden-agents`"). There was no human decision in this headless run, so the epic is recorded as **not accepted**.

The gap is narrow and owned by the user: A1 and A2. Once `ogden-agents@0.1.0` is on npm and the release workflow's registry `verify` job passes on all six jobs, the evidence supports **accepted-with-open-items**, with open items A3 to A9. A human may override this verdict at any time.

## Open questions

- **Q1.** Which behavior should the first published `0.1.0` have: the cookie (tag at 1.10's commit, which isn't on `main`'s first-parent history, so the guard would refuse it) or the per-tab token (HEAD)? This decides A2 and the CHANGELOG and README text.
- **Q2.** Should epic 1 merge to `main` together with epic 2's story 2.1 (PR #11) and the planning PRs #10 and #12, or should the stack be split? This affects how "epic 1 done" is recorded.
- **Q3.** Is AD-20's "server rejects UI assets from another version" still wanted, or does the reload banner replace it for good? This decides A6(b).
- **Q4.** Session logs weren't available. Were any process turns (such as the 1.8/1.9/1.10 reorder) deliberate? The plans don't say why the stack was reordered.

## Assumptions

Headless run: each of these was decided without the user.

- **Epic resolution:** the folder `_bmad-output/initiative-ogden-agents/epic-foundation-and-forks` was given explicitly, and `tickets.py status <folder>` resolved it to `epic-foundation-and-forks` with 12 tickets.
- **`pending_tickets`:** empty. All 12 tickets are `built` (state `review`), and all are listed in the Epic summary as still at `built`.
- **Machine verdict:** **rejected**, rendered with no human decision, because Done when 1 isn't met. It isn't forced by unfinished tickets.
- **Range attribution:** the recorded baselines for 1.8, 1.9 and 1.10 don't bound their own commits, so commits were attributed by the `story 1.x` subject as well as by range. The last range (1.12) runs to HEAD `2df2e5a`, inferred. Story 2.1 (`bf4dbb2`, epic 2) and the planning and spec commits fall inside the epic's range. They were reviewed only at their boundary with epic 1 tickets, not as epic 1 work.
- **Review scope:** `bmad-review` ran its three code lenses inline and sequentially over a narrowed scope (the ticket-boundary files listed under Diff-scope review), not over all 17,141 diff lines. The rest of the diff was never checked by this run beyond the plans' own reviews and CI.
- **Behavior check:** run on macOS only, with git-ignored build outputs left in the worktree (`node_modules/`, `dist/`, `*.tgz`). Windows and Linux behavior is taken from CI.
- **Missing inputs:** no session logs, so process lessons come from plan records only. No previous retrospective, so there was nothing to follow through on.
- **Proposed items:** every action item (A1 to A11), process lesson (L1 to L4) and AGENTS.md pitfall (1 to 9) is a proposal. None was applied: no code, plan, epic file, ticket status or `AGENTS.md` was changed.
