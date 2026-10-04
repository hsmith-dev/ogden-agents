---
title: 'Forks bundled and locked'
type: 'chore'
ticket: '9'
created: '2026-09-29'
status: 'built'
baseline_revision: '8b92eeb95126b723708333d37145303d6554dc34'
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

**Problem:** Epics 4 and 5 will install BMad Method skills into users' repos and run bmad-loop. Nothing yet pins which versions of the forks a release ships, so different epics or machines could run different versions (AD-13).

**Approach:** Record the two forks' exact tags and commits in `forks.lock`. Vendor the pinned BMAD-METHOD skills and a built bmad-loop wheel into `vendor/` with a script, commit them, and include them in the published package. CI fails if the vendored files differ from what the lock pins. Document the fork branch model and upstream-PR process.

## Boundaries & Constraints

**Always:**
- `forks.lock` (JSON) records, for each fork: GitHub repo (`hsmith-dev/BMAD-METHOD`, `hsmith-dev/bmad-loop`), upstream repo, tag (`v6.13.0-next-ogden-agents.0`, `v0.13.0-ogden-agents.0`), full commit SHA, and a content hash of the vendored output.
- `scripts/vendor-forks.mjs` fetches each fork at the locked commit (a GitHub tarball, no git clone needed). It copies BMAD-METHOD's `skills/` to `vendor/bmad-method/skills/` and builds bmad-loop's wheel with `uv build --wheel` into `vendor/bmad-loop/`. Content hashes are computed with line endings normalized to LF, so the result is the same on every OS (the repo forces LF via `.gitattributes`, and upstream has some CRLF files).
- A `--check` mode, run in CI on every OS, re-derives the vendored skills from the lock and fails if they differ from the committed `vendor/` or the lock's hash. The wheel is checked by rebuilding and comparing its file list and each file's contents (wheels embed timestamps, so the archive bytes aren't compared).
- `vendor/` ships in the published package (`files`), and the packaging test asserts it's present in the tarball.
- `CONTRIBUTING.md` documents: the two branches per fork (`upstream` mirrors upstream; `ogden-agents` is upstream plus one patch per upstream PR), tags `v<upstream>-ogden-agents.<n>`, how to bump a pin (run the script, commit the lock and `vendor/`), and dropping a patch once upstream merges it.
- Product text says "works with BMad Method" and never uses BMad as the product brand.

**Never:**
- Don't install skills into user repos or run bmad-loop (epics 4 and 5), and don't carry any patches in the forks yet.
- Don't fetch from the network at install or run time; the published package is self-contained.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Vendor | `node scripts/vendor-forks.mjs` with the lock | `vendor/bmad-method/skills/**` and `vendor/bmad-loop/bmad_loop-0.13.0-py3-none-any.whl` written; the lock's hashes updated | Fails clearly if `uv` or the network is missing |
| Check clean | `--check` on an untouched tree | Exit 0 | — |
| Tampered | One vendored skill file edited | `--check` exits non-zero naming the file | — |
| Lock bump | The lock's commit changed without re-vendoring | `--check` fails with the hash mismatch | — |
| Line endings | Checkout with CRLF files, e.g. Windows | `--check` passes (hashes normalized) | — |
| Package | `pnpm pack` | The tarball contains `vendor/bmad-method/skills/**` and the wheel | Packaging test fails otherwise |

</frozen-after-approval>

## Code Map

Baseline `1f5baef` (worktree `../ogden-agents-wt-1.9`, branch `story/1.9-forks-bundled-and-locked`).

- Forks (created and verified): `hsmith-dev/BMAD-METHOD`, with `upstream` and `ogden-agents` branches at `1cbcfa272fe65787c06a1fa164a901f46117cca7` and tag `v6.13.0-next-ogden-agents.0`; and `hsmith-dev/bmad-loop`, with both branches at `6bbe469637e2b8ac490b1f8c085aed8e2b19ce1b` and tag `v0.13.0-ogden-agents.0`. Both are public forks with default branch `main`.
- Findings from a trial:
  - BMAD-METHOD at the pin has `skills/` (2.6 MB, 30 folders, `bmod-method` version `6.13.0-next`), identical to this repo's `.agents/skills` except `bmad-brainstorming/assets/brain-methods.csv`, which differs only in CRLF vs LF.
  - bmad-loop (hatchling, Python ≥ 3.11) builds with `uv build --wheel` into a 1.8 MB pure-Python `bmad_loop-0.13.0-py3-none-any.whl`.
- `package.json` -- `files: ["bin", "dist"]`; add `vendor`. `tests/packaging.test.ts` asserts the tarball contents.
- `.github/workflows/ci.yml` -- the matrix job (install, typecheck, test, pack, smoke) and the e2e job; add a `vendor-forks --check` step to the matrix, after installing `uv` in CI (`astral-sh/setup-uv`; verify the current major).
- `.gitattributes` -- `* text=auto eol=lf`; mark `*.whl binary` (and keep `*.tgz`).

## Tasks & Acceptance

**Execution:**
- [x] `forks.lock` -- both entries as above.
- [x] `scripts/vendor-forks.mjs` -- vendor and `--check` modes: tarball fetch at the commit, skills copy, wheel build, and LF-normalized content hashing.
- [x] `vendor/` -- the committed output of the script.
- [x] `package.json` and `tests/packaging.test.ts` -- ship `vendor/` and assert it's in the tarball.
- [x] `.github/workflows/ci.yml` -- set up uv and run `node scripts/vendor-forks.mjs --check`.
- [x] `.gitattributes` -- `*.whl binary`.
- [x] `CONTRIBUTING.md` -- the fork model and upstream-PR process.
- [x] Tests for the script's hashing and tamper detection (unit, no network: run against a fixture folder).

**Acceptance Criteria:**
- Given a clean tree, when `vendor-forks --check` runs in CI on each OS, then it passes; given one changed vendored file, then it fails naming the file.
- Given `pnpm pack`, when the tarball is listed, then it contains the vendored skills and the bmad-loop wheel.

## Implementation Notes

- The script has no dependencies: it reads GitHub tarballs (`codeload.github.com/<repo>/tar.gz/<commit>`) with a small tar parser and wheels with a small zip reader, both unit-tested. Skill files are written LF-normalized (so git stores exactly what the script wrote) and keep their executable bit.
- Hash: `sha256:` over `path\0length\0contents` per file, sorted by path. Text (no NUL byte) is CRLF→LF normalized for skills; wheel entries are hashed as-is.
- `uv build` runs with `--no-config`, `SOURCE_DATE_EPOCH` fixed, and the lock's `buildConstraints` (`hatchling==1.32.4`).
- CI: `astral-sh/setup-uv@v10` (current major, `enable-cache: false` since there is no `uv.lock`) and `node scripts/vendor-forks.mjs --check`, in the matrix job before typecheck.
- The packaging test reads the wheel path from `forks.lock` and asserts the tarball's `vendor/` paths equal the files git lists under `vendor/`.
- Review fixes: `setup-uv` pinned to `v10.2.0` (no moving `v10` tag); `--check` also compares skills' executable bits with the fork's tar modes (POSIX only), resolves each tag through the GitHub API (peeling annotated tags, `GITHUB_TOKEN` in CI) and fails if it isn't the locked commit, and reads only files `git ls-files --cached --others --exclude-standard` lists, so ignored files like `.DS_Store` don't count.
- Orchestrator audit (macOS): all 6 matrix rows covered (`tests/vendor-forks.test.ts`, 9 tests; `tests/packaging.test.ts`); `--check` clean; tamper and lock-bump failures demonstrated by the implementer. The hatchling build-backend pin is accepted: without it, a new hatchling release would fail `--check` with no fork change.

## Plan Change Log

- Added `vendored` (path of the output) and, for bmad-loop, `buildConstraints` to `forks.lock`. bmad-loop's `build-system.requires` is an unpinned `hatchling>=1.30`, and the wheel's `WHEEL` file names the hatchling version, so a new hatchling release would otherwise fail `--check` with no fork change.

- Provenance (epic 1 retrospective, A8, 2026-09-30): the stack was reordered after this plan was written (1.9 now sits on 1.7), so `baseline_revision` moved from `1f5baef` to `8b92eeb`, the parent of this story's commit `695ebcd`.

## Review Triage Log

### Pass 1 (quick lens) — 2026-09-30

Counts: high 1, medium 0, low 3.

| # | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|
| 1 | `astral-sh/setup-uv@v10` doesn't resolve (only exact `v10.x.y` tags exist) | high | patch | Verified via the GitHub API matching refs; it would fail every matrix job. Pinned `@v10.2.0`; all other actions have real moving major tags. |
| 2 | `--check` ignores the executable bit | low | patch | Compared on POSIX, skipped on Windows; the test covers both directions. |
| 3 | Nothing verifies that `tag` resolves to `commit` | low | patch | `--check` resolves tags via the GitHub API (peeling annotated tags); stubbed tests. |
| 4 | The working-tree reads count git-ignored files (`.DS_Store`); the packaging test compared counts only | low | patch | Reads are restricted to git-listed files; the packaging test compares exact path sets. |

## Verification

**Commands:**
- `node scripts/vendor-forks.mjs --check` -- expected: exit 0.
- `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test` -- expected: all pass.
- `pnpm pack && node scripts/smoke-installed.mjs` -- expected: exit 0.
