---
title: 'Data folder on upgrade: backup, migrations and refusing a newer database'
type: 'feature'
ticket: '6'
created: '2026-10-05'
status: 'built'
baseline_revision: '469852ca7681dcbafca9da5eb454d90553be1b69'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['security', 'correctness']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-desktop-app/epic-desktop-app.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The app and the npm route share one data folder and both upgrade it by running drizzle's migrations on open. A failed or regretted upgrade leaves no way back, and a database a newer version migrated would be opened by an older one, which drizzle lets through and which then fails on tables it does not know (E13-R5; AD-5 note of 2026-10-04).

**Approach:** Before the migrations run, `openDatabase` (given the running version) reads which migrations the file has applied, read-only. A database that records a migration this build does not have is refused with a plain message and left untouched. When the version differs from the last one recorded in `<dataDir>/last-version.json` and migrations are pending, the database is first copied (`VACUUM INTO`, so the write-ahead log is included) to `<dataDir>/backups/ogden-agents-<old version>.db`, keeping the newest three. The version is recorded only after the migrations succeed. The background server exits with code 4 for a refused database and the launcher shows the message (the shell shows it in its start-failure dialog).

## Boundaries & Constraints

**Always:** the message is plain words with no dashes; a refusal changes nothing (no backup, no version file, the database bytes identical); a backup is mode 0600 in a 0700 folder; the same behaviour for the app and the npm route; every later migration (epics 5, 11, 12) is covered.

**Never:** change the migrations themselves, the data folder's location, or `OGDEN_AGENTS_DATA_DIR`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New folder | no database | opens, version recorded, no backup | none |
| Upgrade | pending migrations, version differs | backup of the old database first, then migrate | a failed backup stops the open |
| Same version, nothing pending | none | no backup | none |
| Folder from before the record | no `last-version.json`, pending | backup named `unknown` | none |
| Newer database | unknown migration recorded | refused with the plain message, nothing changes, launcher exits 1 without a server | none |

</frozen-after-approval>

## Code Map

- `packages/core/src/db/upgrade-guard.ts` (new), `database.ts`, `data-dir.ts` (message and exit code, no driver import), `index.ts`.
- `packages/server/src/{start,serve,launcher}.ts`, `bin/ogden.js` -- pass the version; exit code 4; show the message.
- Tests: `packages/core/test/upgrade-guard.test.ts`, `tests/desktop-upgrade.test.ts` (the real launcher, the 0.2.0 fixture folder, shell mode and npm mode).

## Tasks & Acceptance

**Execution:**
- [x] guard, backup, version record, refusal
- [x] server and launcher wiring, message
- [x] core tests and launcher-level upgrade tests (0.2.0 folder, both modes)
- [ ] CI green on three OSes

**Acceptance Criteria:**
- Given a 0.2.0 folder, a backup is written and the chats are intact; given a newer database, the launcher exits with the plain message and changes nothing.

## Implementation Notes

- Unknown "does drizzle's journal give a clean way to detect a newer database": yes. `readMigrationFiles` gives each known migration's hash and the file's `__drizzle_migrations` rows have the same hashes; a recorded hash this build lacks means newer. Drizzle itself compares only the last timestamp and would carry on.
- npm N to app N+1, app N to app N+1 and the two routes sharing one folder are the same code path (the launcher on the shared folder); the tests run it in shell mode and without. The app-to-app update with data intact is checked again by 13.13's end to end suite.
- A backup is made only when migrations are pending (a version change with no schema change needs none); the epic text says "on a version change".

## Plan Change Log

## Review Triage Log

Pass 1 (security and correctness, self-review): medium 2, low 2.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | The refusal must happen before any write (WAL pragma, migrations) | medium | patch | The guard opens the file read-only first; tests compare the database's hash before and after a refusal. |
| 2 | The backup path goes into a SQL string | medium | patch | It is built from the data folder and a version cleaned to letters, digits, dot, plus and dash; quotes are doubled anyway. |
| 3 | Backups hold the user's data | low | patch | Folder 0700, file 0600 (POSIX); only the newest three are kept. |
| 4 | A restore is by hand | low | reject | Out of scope for the epic; the backup file is a plain SQLite database. |

## Verification

**Commands:**
- `pnpm test` (CI): `packages/core/test/upgrade-guard.test.ts`, `tests/desktop-upgrade.test.ts`.
