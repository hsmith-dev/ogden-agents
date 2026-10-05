---
title: 'Pinned upstream BMad, verified, instead of bundled forks'
type: 'refactor'
ticket: '14'
created: '2026-10-02'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'security']
review_loop_iteration: 0
baseline_revision: '5fe8cc1a1468c81e3102ae29b69ba6f69bf9ba5a'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Ogden ships copies of its own BMad forks (`vendor/`, `forks.lock`, AD-13), which the user no longer wants to maintain: the BMAD-METHOD fork is exactly upstream commit `1cbcfa2` and the bmad-loop fork is upstream `v0.13.0` (`6bbe469`).

**Approach (user decision 2026-10-02, "pinned upstream, verified"):** a lock pins upstream `bmad-code-org/BMAD-METHOD` and `bmad-code-org/bmad-loop` to a commit and a content hash; Ogden downloads the upstream tarball only when the user asks (Set up, Update, or the board's Download button), verifies the hash in memory, extracts the verified files into a fresh folder in its data folder, and runs BMad's scripts only from there. `vendor/` and `forks.lock` leave the repo and the package; CI checks the lock against upstream.

**Decisions:** Board needs the downloaded BMad: without it the board answers 409 `bmad_not_downloaded` and the bare Board page offers **Download BMad Method** (an explicit action; 4.3's Set up calls the same download). Ogden never runs the project's own copy of `tickets.py`/`setup.py`. Only the exact pinned commit counts: after an Ogden upgrade that changes the pin, the board asks to download again. Labels move to Ogden's own mapping file keyed by skill name (content and reader come with 4.5's rework). bmad-loop gets a resolver (verified source, installed with uv into a venv in the data folder) that epic 5 calls; nothing calls it yet. Pins unchanged (no bump).

## Boundaries & Constraints

**Always:** Hash, tar parsing and safe selection live in one self-contained module shared by the runtime and the CI script. Verify before any byte touches disk; write only what was hashed. Only regular files under the lock's `include` prefix are extracted; any traversal, absolute or drive path, backslash, NUL, duplicate, symlink, hardlink or other non-regular entry under it refuses the whole archive. Size caps on download and decompressed size; one download at a time; a download timeout. Offline, HTTP errors and mismatch are plain errors (shared texts), never a crash. uv children keep 4.2's single allowlisted environment; scripts keep the neutral work folder.

**Never:** No network on startup, page load, or any GET; nothing downloads except `POST /api/v1/bmad/source` (and later 4.3's setup and epic 5's build action through the same port). No test touches the network, real `claude`, the keychain, or the real `~/.claude`; test hooks only through `testHooksAllowed` or programmatic `start()` options. No new dependency. No pin bump. Don't touch 4.5/4.8 branches.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error handling |
|---|---|---|---|
| Download ok | `POST /api/v1/bmad/source`, archive matches lock | 200 `{state:'ready', version, commit}`; files at `<data>/bmad/bmad-method/<commit>/skills/`; marker written last; stale commit folders removed | — |
| Mismatch | archive content differs | 502 `bmad_download_failed` (integrity text); no folder created | temp folder removed |
| Unsafe archive | `../x`, `/x`, `C:x`, symlink or hardlink under `skills/` | refused as integrity failure, nothing written | — |
| Offline / HTTP 404 / timeout / too large | fetch rejects or non-2xx | 503 `bmad_download_failed` (offline text) | state stays `missing` |
| Concurrent POSTs | two at once | one fetch; both get the result | — |
| Board, not downloaded | Board on, trusted, no cache | 409 `bmad_not_downloaded`; runner never called | web shows Download button |
| Board, downloaded | same, cache ready | tickets from the cached `tickets.py` | 4.1/4.2 behaviour |
| Status | `GET /api/v1/bmad/source` | `{state:'missing'|'ready'|'downloading', version, commit}` | no network |

</frozen-after-approval>

## Code Map

- `scripts/vendor-forks.mjs` -- source of `normalizeText`, `hashEntries`, `parseTar`, `diffEntries`, tag/compare API helpers; becomes `scripts/bmad-lock.mjs`. Hash = existing algorithm (LF-normalized). Verified: upstream `skills/` at `1cbcfa2` hashes `sha256:6a4471ad…3c7b` (= forks.lock); upstream bmad-loop whole tree at `6bbe469` hashes `sha256:6ded28951264f96bcab4084c07fbe2a13543a463b9f2b2fe0779d0d2749cf332` (270 files, no CRLF, no symlinks). The BMAD tarball has one symlink outside `skills/` (ignored) and one CRLF file in it (normalized).
- `packages/adapters/src/toolchain-uv/{release.ts,uv-release.json,archive.ts}` -- precedent: JSON pin imported `with { type: 'json' }`, CI `scripts/check-uv-pins.mjs` job `uv-pins`, fixture-server tests. Reuse the shape, not the code.
- `packages/server/src/start.ts:92-106` -- `VENDOR_ROOT_CANDIDATES`, `TICKETS_SCRIPT`, `bundledTicketsScript()` (delete); `:398-419` tickets-v7 and board wiring; `uvWorkDir`. `start-types.ts:114-131` options (add `bmadSource?`, `bmadFetch?` programmatic hook).
- `packages/adapters/src/tickets-v7/index.ts:51` -- `script: string` becomes a resolver (`() => string | undefined`); undefined → `TicketsUnavailableError('not_downloaded')`.
- `packages/core/src/{board.ts:49-70,ticket-store-port.ts:69,bmad-setup.ts,core.ts,index.ts,errors.ts}` -- board guard order: piece, trust, then source ready (`BmadNotDownloadedError`); add reason `not_downloaded`. `bmad-setup.ts` doc: 4.3 calls `BmadSourcePort.download()`/`skillsDir`.
- `packages/shared/src/{planning.ts,errors.ts,api.ts}` -- `BMAD_NOT_SET_UP_MESSAGE` l.458 pattern for texts; `API_ERROR_CODES` l.69; `API_ROUTES`; `BmadSetupStatus.bundledVersion` l.395 (keep name; now the pinned version).
- `packages/server/src/{app.ts,errors.ts,bmad-routes.ts or new bmad-source-routes.ts}` -- install-level routes behind the gate; error mapping.
- `packages/web/src/planning/board-tickets.tsx`, `api/http.ts` -- notice + button for `bmad_not_downloaded`.
- Tests touching vendor: `packages/server/test/planning-routes.test.ts:46,180,410` (real-uv `tickets.py`), `tests/packaging.test.ts:126-140,300-319`, `tests/vendor-forks.test.ts`, `packages/adapters/test/bmad-catalog-skills.test.ts` (string paths only), `server/test/gate.test.ts` route registry, `bmad-guard-coverage.test.ts` lists, `tests/e2e/plan-and-board.spec.ts` (+ its server script), `scripts/smoke-installed.mjs` (must stay offline).
- Ships/docs: `package.json` `files` (drop `vendor`), `.github/workflows/ci.yml` (drop "Check vendored forks" step; new `bmad-pins` job like `uv-pins`), `AGENTS.md:19`, `CONTRIBUTING.md:11-47`, `CHANGELOG.md`, `README.md` if it mentions forks. Architecture/spec docs are already amended by the orchestrator.
- 4.5's branch `origin/story/4.5-fork-labels` `packages/adapters/src/bmad-catalog/labels.ts` -- `readModuleLabels(module, raw: unknown, owns)` and fields `label, description, group, next`, file-level `entry`; reference only.

## Tasks & Acceptance

**Execution:**
- [x] `packages/adapters/src/bmad-source/archive.ts` -- self-contained (node builtins only, erasable TS syntax so `node` can import it): `normalizeText`, `hashEntries`, `parseTar`, `selectVerified(tarEntries, include) → Entries` (strip top folder, keep only `include`, refuse unsafe entries per Boundaries), `extractTo(entries, dir)` (containment check per path, `wx` writes, 0o700 dirs). -- one implementation for runtime and CI.
- [x] `packages/adapters/src/bmad-source/bmad-lock.json` -- `{ "sources": { "bmad-method": { repo: "bmad-code-org/BMAD-METHOD", ref: "main", commit: "1cbcfa272fe65787c06a1fa164a901f46117cca7", version: "6.13.0-next", include: "skills/", contentHash: "sha256:6a4471ad7c8861b47a881ca35e0b598b9d32aed10c1e19a78e559d005f2c3c7b" }, "bmad-loop": { repo: "bmad-code-org/bmad-loop", ref: "v0.13.0", commit: "6bbe469637e2b8ac490b1f8c085aed8e2b19ce1b", version: "0.13.0", include: "", buildConstraints: ["hatchling==1.32.4"], contentHash: "sha256:6ded28951264f96bcab4084c07fbe2a13543a463b9f2b2fe0779d0d2749cf332" } } }`, plus `lock.ts` (typed, zod-checked).
- [x] `packages/adapters/src/bmad-source/index.ts` -- `createUpstreamBmadSource({ dataDir, lock?, fetch?, timeoutMs?, maxBytes? })` implementing core's `BmadSourcePort`: `status()` (reads marker only), `download()` (deduped; codeload URL `https://codeload.github.com/<repo>/tar.gz/<commit>`; gunzip with `maxOutputLength`; verify; extract to `<data>/bmad/.tmp-<random>` then rename to `<data>/bmad/<name>/<commit>`; marker `{repo, commit, contentHash}` written before rename; remove other commits), `file(relPath)` → absolute path inside the verified tree or undefined; `bmad-loop.ts` `createBmadLoopResolver({ source, uvCommand, env, dataDir })` → `resolve()` downloads loop source via the same pipeline, then `uv venv` + `uv pip install --python <venv> --build-constraints <file> <src>` in the work folder, returns the `bmad-loop` executable (Scripts\\bmad-loop.exe on Windows); not wired to any route.
- [x] `packages/adapters/src/bmad-source-memory/index.ts` -- stub port (ready or missing, counts downloads) for server/e2e tests.
- [x] `packages/core/src/bmad-source-port.ts` + `core.ts`/`index.ts`/`errors.ts` -- port; install-level use-case `bmadSource` (`status`, `download`, errors `BmadNotDownloadedError`, `BmadDownloadError{reason:'offline'|'integrity'}`); board checks ready after trust.
- [x] `packages/shared/src/{planning.ts,errors.ts,api.ts,index.ts}` -- `BmadSourceStatus`, `BmadSourceResponse`; codes `bmad_not_downloaded` (409), `bmad_download_failed`; texts `BMAD_NOT_DOWNLOADED_MESSAGE`, `BMAD_DOWNLOAD_OFFLINE_MESSAGE`, `BMAD_DOWNLOAD_INTEGRITY_MESSAGE`, button label; routes `bmadSource`. No em/en dashes.
- [x] `packages/adapters/src/tickets-v7/index.ts`, `packages/server/src/{start.ts,start-types.ts,app.ts,errors.ts,bmad-source-routes.ts}` -- delete vendor lookup; tickets script = `source.file('bmad-ticket/scripts/tickets.py')`; `GET|POST /api/v1/bmad/source` behind the gate (not workspace-scoped, no piece guard); map errors.
- [x] `packages/adapters/src/bmad-catalog/skill-labels.json` (+ typed export) -- Ogden's label mapping `{ "entry": null, "skills": {} }`, keyed by skill name with 4.5's per-skill fields; empty until 4.5's rework fills it; a test checks its shape.
- [x] `packages/web/src/planning/board-tickets.tsx` -- on `bmad_not_downloaded`: notice + **Download BMad Method** → POST, pending state, error text, then refetch.
- [x] `scripts/bmad-lock.mjs` (replaces `vendor-forks.mjs`) -- `--check` (network, CI only): download each pinned tarball, recompute hash through `archive.ts`, compare; GitHub API compare `ref...commit` must be `identical` or `behind` (commit is in upstream's history); no write mode needed beyond `--print` of computed hashes for maintainers.
- [x] Delete `vendor/`, `forks.lock`, `scripts/vendor-forks.mjs`, `tests/vendor-forks.test.ts`; `package.json` `files` = `bin`, `dist`; CI: remove the vendored-forks step, add `bmad-pins` job (ubuntu, Node 24, `GITHUB_TOKEN`); docs `AGENTS.md`, `CONTRIBUTING.md` (pinned-upstream section, how to bump), `CHANGELOG.md`.
- [x] `tests/fixtures/bmad-upstream/skills/bmad-ticket/scripts/tickets.py` (copy of the pinned file, provenance comment in a README) and `tests/fixtures/tar.ts` (tiny in-memory tar.gz writer, incl. pax paths, symlink, hardlink entries).
- [x] Tests -- archive: hash parity with the old algorithm on a fixture, every unsafe-entry case, size caps; source: download/verify/extract/marker/stale removal, mismatch leaves nothing, offline/HTTP/timeout errors, dedupe, status never fetches; loop resolver with fake uv (argv, env = allowlist, venv path per OS); server: no fetch on startup and on every GET (counting fetch), POST downloads, board 409 `bmad_not_downloaded` with zero runner calls, real-uv board test via fixture tarball → POST → tickets; gate/guard-coverage lists; packaging (no `vendor/`, no `forks.lock`); web DOM test for the button; e2e: board missing → Download → tickets (memory source); `bmad-lock.mjs` pure functions.

**Acceptance Criteria:**
- Given a fresh data folder and no network, when the server starts, the UI loads and every GET is served, then no download is attempted.
- Given the packed package, then it contains no `vendor/` and `pnpm smoke` passes offline.
- Given `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm run pack && pnpm smoke`, then all pass.

## Implementation Notes

- The lock's zod schema (`BmadLock`, `BmadLockSource`) lives in `packages/shared/src/planning.ts` with the other BMad contracts: adapters has no `zod` dependency of its own, and adding one would be a new dependency. `lock.ts` parses the JSON with it at load.
- The install-level use-case is `createBmadSource(port)` in `packages/core/src/bmad-source-port.ts` (`status`, `download`, `requireReady`), wired in `start.ts` beside `createBoard`/`createPlanning`; it is not a member of `Core`, so `core.ts` is unchanged. `BoardDeps.source` is required.
- `BmadSourceResponse` is the status itself (`{state, version, commit}`, as the I/O matrix shows), not wrapped.
- Errors: a download that is too large (declared or streamed past `maxBytes`) is `offline` (503) as the matrix says; an archive that unpacks past `maxUnpackedBytes` is `integrity` (502), as it can't be the pinned content. The adapter is the same pipeline for both sources; "one download at a time" is per source (BMad Method and bmad-loop each share one in-flight download; nothing calls the loop yet).
- `selectVerified` applies the path checks (absolute, drive, backslash, NUL, `..`, `.`/empty segment, a second top folder) to every entry of the archive, not only under `include`; type checks (symlink, hardlink, device) and duplicates (also case-only) only under `include`. Both real pinned tarballs pass (`node scripts/bmad-lock.mjs --check`, 296 and 270 files, hashes equal to the lock).
- Folders: `<data>/bmad/<name>/<commit>/` with files under `<include>` and the marker `.ogden-verified.json` at the commit folder's top; temp folders are `<data>/bmad/.tmp-<name>-<random>` (leftovers of the same source are swept at the next download). An `include: ''` tree containing a file named like the marker is refused.
- `skill-labels.json` is typed in `skill-labels.ts` (no zod); its shape test is in `packages/adapters/test/bmad-source.test.ts`.
- `tests/fixtures/fake-uv.mjs` gained an `install` mode (and its env lines carry `argv` and `cwd`) for the bmad-loop resolver test. `start()` gained `bmadSource` and `bmadFetch`; the server tests' `startTestServer` defaults to a ready memory source unless a test passes either.
- `packages/server/src/index.ts` re-exports `createMemoryBmadSource` for the e2e suite.

## Plan Change Log

## Review Triage Log

### Pass 1 (2026-10-02; lenses: quick, security)

Verdicts: high 0, medium 2, low 12, false 1, maybe-false 0 (quick Q1-Q5, security S1-S11; Q5 and S7 share a root cause).

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| Q1 | `bmad-source/archive.ts` repeats `toolchain-uv/archive.ts`'s tar reader; already drifted (pax bounds, `K` headers) | medium | patch | AGENTS.md pitfall names exactly this. Fix: `readTarGz` builds on the shared `parseTar`. |
| Q2 | `scripts/bmad-lock.mjs` copies `tarballUrl` and the size caps | low | patch | Both defined twice. Fix: exported from `archive.ts`, imported by both. |
| Q3 | `extractTo` writes every file 0600, dropping upstream exec bits (`resolve_customization.py` is 100755) that 4.3 copies into projects | low | patch | `TarEntry.mode` unused. Fix: 0700 when executable upstream. |
| Q4 | Marker valid but a file missing: 503 `tickets_unavailable` with "download first" text, no button, and POST returns early | low | patch | `download()` short-circuits on `ready()`. Fix: explicit download re-hashes the on-disk tree and re-downloads on mismatch; `not_downloaded` maps to 409 `bmad_not_downloaded`. |
| Q5+S7 | Lock schema `include` accepts `../` and `./`; `file()` would resolve outside the commit folder | low | patch | Regex class includes `.`; maintainer-only input, defense in depth. Fix: reject `.`/`..` segments. |
| S1 | bmad-loop's runtime deps and hatchling's deps float from PyPI at install (no hashes, `[tool.uv.sources]` honored) | medium | defer | Same as the bundled wheel before (deps were never pinned); resolver unused until epic 5. Deferred to epic 5 with a hash-locked install (`uv.lock`/`--require-hashes`, `--no-sources`). |
| S2 | `resolve()` downloads as a side effect; nothing enforces explicit user action | low | patch | Doc comment only (no caller yet); epic 5 must call it from Build. |
| S3 | Build backend runs with the verified source folder writable | low | defer | Pinned hatchling builds out of tree; epic 5 can build from a temp copy. |
| S4 | Tmp sweep and `rmSync(folder)` assume one source instance per name | low | defer | `start.ts` creates exactly one; 4.3/epic 5 must reuse it. Recorded for them. |
| S5 | File-vs-folder or NFC/NFD collisions throw raw EEXIST: 500 that logs the data path | low | patch | Reproduced by the lens; not a bypass (tmp removed). Fix: extraction errors map to `integrity`; NFC+case fold and prefix check. |
| S6 | Windows names (ADS `ab:c`, `CON`, trailing dot/space) not refused | low | reject | Content is fixed by the pinned hash; hardening adds guards for a case upstream can't reach without CI's drift check failing. |
| S8 | Pax `size`/`linkpath` ignored (parser differential with `tar`) | low | reject | CI and runtime share the parser, so verify and write agree; no bypass. |
| S9 | Sync gunzip/hash block the event loop up to the 256 MB cap | low | reject | Real tarball is 1.7 MB; bounded by caps; only on an explicit click. |
| S10 | Pinned commits are the old fork-tag commits; codeload serves fork-network commits under the upstream URL | false | reject | Checked: `bmad-lock.mjs --check` against GitHub placed both commits in upstream history (`main`, `v0.13.0`) and the content matched; the CI `bmad-pins` job keeps checking (should be a required check, in the PR's Needs you). |
| S11 | Readers trust the marker and never re-hash | low | reject | By design (Design Notes): the data folder is the user's own (0700). Explicit download now re-hashes (Q4). |

After the patches (2026-10-02): `pnpm typecheck`, `pnpm test` (1399 passed, 4 skipped), `pnpm e2e` (92 passed; one run hit a flake in the untouched `sign-in-again.spec.ts:143`, which passed 3 of 3 alone and in a full rerun), `pnpm run pack && pnpm smoke` (no `vendor/`, `forks.lock` or `tickets.py` in the tarball; startup downloads nothing).

## Design Notes

Verify-then-write: the archive is held in memory, hashed over exactly the entries that will be written (normalized), and only then written into a new temp folder that is renamed into place; a later reader trusts the marker, not a re-hash, because the data folder is the user's own (0700) and anything that can write there can already change the database. Codeload tarball bytes aren't stable, so the hash is over contents, not the archive.

Follow-ups recorded for siblings: 4.3 runs `setup.py` from `source.file('bmad/scripts/setup.py')` after `download()` and copies skills from the verified `skills/`; 4.4 compares installed versions with the lock's `version`; 4.5 drops its fork patch and upstream PR, fills `skill-labels.json`, and reads it with `readModuleLabels(raw)`; epic 5 calls the bmad-loop resolver from the Build action, and its v7 dispatch patch must land upstream (or be done in Ogden) before the pin moves.

Plan size ~2,900 tokens, over the 1,600 guide; kept whole because the user approved this as one story and the pieces (lock, verified cache, script paths, deletion) only work together.

## Verification

**Commands:**
- `pnpm typecheck && pnpm test` -- pass
- `pnpm e2e` -- pass
- `pnpm run pack && pnpm smoke` -- pass, no network used
- `node scripts/bmad-lock.mjs --check` -- pass (maintainer/CI, network)
