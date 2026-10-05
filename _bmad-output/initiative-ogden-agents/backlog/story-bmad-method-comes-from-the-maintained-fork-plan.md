---
title: "BMad Method comes from Ogden's maintained fork, and Board runs a checked snapshot of the project's config script"
type: 'feature'
ticket: '2'
created: '2026-10-04'
status: 'built'
baseline_revision: 'a6e6c12a6636d9957fa134320be5cd8a4bfd670c'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'auto'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/backlog/story-bmad-method-comes-from-the-maintained-fork.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Ogden pins upstream `bmad-code-org/BMAD-METHOD`, so a change it needs in BMad waits on upstream; the user decided (2026-10-04) to maintain a fork instead and never push upstream. Meanwhile Board's script trust checks `_bmad/scripts/` right before each run, but the verified `tickets.py` then imports the project's own `config_utils.py` by path, so a change landing between the check and the import still runs once (deferred: "between the content check and Python's import of `config_utils.py`").

**Approach:** Pin `hsmith-dev/BMAD-METHOD` at the `ogden-agents` commit (upstream `1cbcfa2` + the `--config-utils` patch, tag `ogden-agents/2026-10-04`), with the upstream base recorded and checked in CI; verified download unchanged. Each `tickets.py` run reads the trusted project's `_bmad/scripts/` once into memory, hashes those bytes by the trust's rule, compares with the trusted fingerprint core hands the store, writes the same bytes into a fresh owner-only run folder, and passes its `config_utils.py` as `--config-utils`.

## Boundaries & Constraints

**Always:** upstream is fetch-only (no push, PR, issue or comment on `bmad-code-org`); pushes go only to `hsmith-dev/BMAD-METHOD`. The snapshot is written from the bytes that were hashed, never re-read from the project. Every `tickets.py` run passes `--config-utils`. Fork tags are never deleted (old releases download by commit). Smoke stays offline.

**Never:** change the download/verify path, setup/Upgrade, or the trust prompt; run anything from the project's `_bmad/scripts/` in place.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unchanged scripts | trusted fingerprint F, folder hashes F | snapshot run folder (0700) with the same files; `--config-utils <run>/config_utils.py`; folder removed after | none |
| Swap after check | file replaced after the snapshot read | run uses snapshot; planted code never runs | none |
| Changed before snapshot | folder hashes G ≠ F | nothing runs | `ScriptsChangedError` (409 `scripts_changed`; watch keeps last tree) |
| No `_bmad/scripts/` | F = `none`, folder missing | empty run folder; `tickets.py` reports the config missing | `tickets_unavailable` as today |
| Unhashable | link/special file/past bounds | nothing runs | `ScriptsChangedError` |

</frozen-after-approval>

## Code Map

- `packages/adapters/src/bmad-source/folder-hash.ts` -- `hashFolderWithCounts`; add `readFolder` returning the normalized `Entries` it hashed (reuse, no second walker).
- `packages/adapters/src/bmad-catalog/scripts-fingerprint.ts` -- `scriptsFingerprint`; share the `_bmad`/`scripts` kind checks with the new snapshot.
- new `packages/adapters/src/bmad-catalog/scripts-snapshot.ts` -- `createScriptsSnapshotter(root)`: read once, hash, compare, write 0700/0600, dispose.
- `packages/adapters/src/tickets-v7/index.ts` -- `run` takes the guard, snapshots, prepends `--config-utils`; in-flight key includes the fingerprint; `watch` uses `beforeRun`'s returned guard.
- `packages/core/src/ticket-store-port.ts` -- `TicketRunGuard { scripts }` on `tree`/`find`/`mark`; `beforeRun` returns it.
- `packages/core/src/bmad-script-trust.ts` -- `requireScriptsUnchanged` resolves to the trusted fingerprint.
- `packages/core/src/board.ts`, `ticket-watcher.ts` -- pass the fingerprint through.
- `packages/adapters/src/tickets-memory/index.ts` -- accepts and ignores the guard.
- `packages/server/src/start-planning.ts` -- snapshot root `<data>/tools/bmad-script-runs`.
- `packages/adapters/src/bmad-source/bmad-lock.json`, `packages/shared/src/planning-setup.ts` (`BmadLockSource.base`), `scripts/bmad-lock.mjs` (base checks), `tests/bmad-lock.test.ts`.
- `tests/fixtures/bmad-upstream/` -- `tickets.py` from the fork commit; README; `tests/fixtures/bmad-upstream-source.ts` lock repo.
- `.github/workflows/ci.yml` bmad-pins; `CONTRIBUTING.md`; new `docs/bmad-fork.md`, `scripts/bmad-fork-sync.mjs`; architecture AD-13 (+AD-22 note) and `.memlog.md`; `deferred-work.md`; `CHANGELOG.md`.

## Tasks & Acceptance

**Execution:**
- [x] fork (scratch clone) -- `ogden-agents` = `1cbcfa2` + `--config-utils`, tag, push to fork only -- done before planning Ogden changes
- [x] adapters snapshot + tickets-v7 + core guard plumbing -- closes the check-then-load window
- [x] tests: adapter snapshot unit tests (match, mismatch, missing, swap-after-check, perms, cleanup), tickets-v7 args, core trust returns fingerprint
- [x] lock, schema, check script, fixture, CI, docs, AD-13 memlog, deferred-work, changelog

**Acceptance Criteria:**
- Given the ticket's criteria 1–5, when the verification commands run, then each holds.

## Implementation Notes

- Fork: `upstream` stays `1cbcfa2`; `ogden-agents` = `1cbcfa2` + `642c4e5` (the `--config-utils` commit cherry-picked from `fcc07a3`, conflict in `_folder` resolved for the older base, its test's relative-folder case adjusted to `initiative-checkout/epic-cart`); upstream's `pre-commit run --all-files` (ruff, validators, pytest) green. Tag `ogden-agents/2026-10-04` pushed with the branch to `hsmith-dev/BMAD-METHOD` only; the scratch clone's upstream remote has pushing disabled.
- Lock `ref` is the tag, not the branch: a sync rebases `ogden-agents`, and CI's history check must keep holding for released pins. `base` is a new optional lock field (schema in `shared`), checked by `scripts/bmad-lock.mjs` `checkBase` with read-only compares.
- Snapshot: the whole `_bmad/scripts/` folder (the trust's fingerprint covers it all, and `config_utils.py` could import a sibling), written as the LF-normalized bytes the hash covers. `none` gets an empty folder so a config script that appears later is never read. Run folders live in `<data>/tools/bmad-script-runs/`, cleared by each server's first snapshot.
- Port: `tree`/`find`/`mark` take a required `TicketRunGuard`; `beforeRun` resolves to it; `requireScriptsUnchanged` resolves to the trusted fingerprint.
- Fixture `tickets.py` is the fork's; the fixture lock names the fork.

## Plan Change Log

## Review Triage Log

- Pass 1 (quick, self-review of the diff): 0 high, 0 medium, 1 low patched. Low: the snapshot root was created once per server, so a root removed while running would fail every later run; now created before each snapshot.

## Verification

**Commands:**
- `pnpm typecheck && pnpm test` -- expected: green
- `pnpm e2e` -- expected: green
- `pnpm run pack && pnpm smoke` -- expected: green, offline
- `node scripts/bmad-lock.mjs --check` -- expected: the fork pin holds, base in upstream history
