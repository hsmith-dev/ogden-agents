---
title: 'The discovered catalog, refreshed as modules are installed'
type: 'feature'
ticket: '4'
created: '2026-10-02'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'security']
review_loop_iteration: 0
baseline_revision: 'ff15147fa785ae0f437e56dc02fac429b5180e6f'
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The real `bmad-catalog` adapter's `catalogOf` still answers 4.2's placeholder (skills with null metadata, no modules, agents, entry action or capabilities), so the Plan page can't show labels, groups, the New tag or reduced mode (E4-R3, E4-R4).

**Approach:** Build the catalog from the repo's installed metadata on every read: modules from each installed skill folder's `bmod.toml` `[bmod]` (code, version, its `skills`), agents from `roster.toml` beside it, skills from `SKILL.md` (4.1's scan) with the module record folders left out, labels, groups, `next` and the entry action from 4.5's `readModuleLabels`/`applyLabels` over `skill-labels.json` (fallback: the `SKILL.md` description), and the two capabilities. Core records when each module first appeared, per workspace, for `installedAt`. Nothing is cached, so a module copied in while the server runs shows on the next read without a restart.

**Decisions (planning, 2026-10-02):**
- `installedAt`: core keeps a per-workspace first-seen record (new table, migration). The first catalog read that finds any module is the baseline: those modules get `installedAt: null` (they were there before Ogden looked, including right after Ogden's own setup); a module first seen later gets that time. Core fills only a `null` from the port, so a memory catalog's given `installedAt` passes through (4.6's e2e). No event: the catalog is fetched data (AD-7 pattern).
- Capabilities (AD-14, never a version string): `plain_labels` = at least one installed skill has a label in the mapping; `ticket_tree` = the repo's `_bmad/scripts/config_utils.py` is a regular file reached through real folders inside the repo whose first 64 KB define `load_central_config(` (what the verified `tickets.py` loads).
- Module `name`: an optional `modules: { <code>: { label } }` in `skill-labels.json`, else the code. Agent: `name` = its skill, `label` = the skill's mapped label, else the roster `title`, else the name; only roster members whose `skill` is installed.
- Help files are not read: the frozen `Catalog` has no help field and `next` comes from the mapping (4.5).

## Boundaries & Constraints

**Always:** Read-only, inside the repo, as 4.1's scan: root must be a real folder, every file's real path inside the repo's real path, regular files only, bounded reads (64 KB per file), any error leaves that item out, never throws for the repo's state. Skill names only as data (`skill-labels.json`, test data). Only workspaces with Planning on are scanned (existing guard). `index.ts` keeps importing only `lstat` (its test).

**Never:** No shared contract change (shapes, events, codes), no new dependency (a small TOML-subset reader in the adapter), no watcher or cache, no write to the repo, no network, no project script run. Tests never run real `claude`, the keychain, the network or read the real `~/.claude`; test hooks only via `testHooksAllowed`. Stay out of 4.6/4.9's web files.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error handling |
|---|---|---|---|
| Installed upstream | `.claude/skills/` with `bmod-method`, `bmod-core-tools` records and their skills | every module skill listed with label, group, `module`; record folders not skills; agents from roster; `entryAction` the mapped entry; `plain_labels` true | — |
| Unlabelled skill | skill not in mapping | `SKILL.md` description, null label/group/next | — |
| Module copied in later | server running, baseline taken | next read lists it and its skills with `installedAt` set; planning start on its skill → 201 | — |
| First read | modules present, no records | recorded, `installedAt: null` | — |
| Bad metadata | malformed `bmod.toml`/`roster.toml`, bad code, link out of repo, FIFO | that module/agent left out | none thrown |
| `ticket_tree` | `config_utils.py` with/without `load_central_config(`, linked, missing | true / false / false / false | — |
| Port gives `installedAt` | memory catalog | kept as given | — |

</frozen-after-approval>

## Code Map

- `packages/adapters/src/bmad-catalog/index.ts` -- `catalogOf` (replace body by a call into a new file); imports only `lstat` (test `bmad-catalog.test.ts:83`).
- `packages/adapters/src/bmad-catalog/skills.ts` -- `scanSkills`, `SKILL_FOLDERS`, `inside`, `readHead` pattern, `MAX_SKILL_FILE_BYTES`; reuse (export what's needed), don't copy.
- `packages/adapters/src/bmad-catalog/labels.ts` -- `readModuleLabels(raw)`, `applyLabels(skills, labels) → {skills, entryAction, labelled}`; extend `FILE_KEYS` with optional `modules`. `skill-labels.{json,ts}` -- add `modules` labels for `method` and `core-tools`.
- `packages/adapters/src/bmad-catalog/setup.ts:107` `tomlString`, `:147` `plainFileText` -- existing helpers; the new TOML reader may replace `tomlString`'s logic only if behaviour stays.
- `tests/fixtures/bmad-upstream/skills/bmod-{method,core-tools}/` -- real `bmod.toml`, `roster.toml` at the pin; build test repos from them.
- `packages/shared/src/planning.ts:80-160` -- `CatalogModule`, `CatalogSkill`, `CatalogAgent`, `Catalog`, `BmadCapabilities`: read only.
- `packages/core/src/planning.ts` -- `createPlanning` deps; `catalog()` and `start()` both read `catalogOf`. `core.ts` (wiring, `Core` members), `db/schema.ts`, `drizzle/` (generate `0007` with `pnpm --filter @ogden-agents/core db:generate`), `bmad-script-trust.ts` (orm pattern).
- `packages/server/src/start.ts:426` -- pass core's module record to `createPlanning`.
- Tests: `packages/adapters/test/bmad-catalog*.test.ts`, `packages/server/test/planning-routes.test.ts:282` (real adapter via `startTestServer`), core tests beside `planning`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/adapters/src/bmad-catalog/toml.ts` -- lenient TOML subset: `[table]`, `[[array]]`, `key = "basic"|'literal'|[strings, multi-line, comments, trailing comma]`; anything else (inline tables, numbers, multi-line strings) skipped, never throws.
- [x] `packages/adapters/src/bmad-catalog/catalog.ts` -- `buildCatalog(repoPath)`: scan skill folders for module records (`bmod.toml` with `[bmod] code` matching a module-code pattern, first folder wins per code), `roster.toml` members, skills from `scanSkills` minus record folders, `module` per skill from `[bmod].skills`, labels via `applyLabels` (mapping read once at load), capabilities as decided; sorted output; `index.ts` calls it.
- [x] `packages/adapters/src/bmad-catalog/labels.ts`, `skill-labels.json`, `skill-labels.ts` -- optional `modules` labels.
- [x] `packages/core/src/bmad-modules-seen.ts` (+ `db/schema.ts`, migration `0007`, `core.ts`, `index.ts`) -- table `bmad_modules_seen(workspace_id FK, code, installed_at nullable, seen_at)`, unique `(workspace_id, code)`; `stamp(workspaceId, catalog) → catalog` in one transaction filling null `installedAt` on modules and their skills.
- [x] `packages/core/src/planning.ts`, `packages/server/src/start.ts` -- optional `modulesSeen` dep used by `catalog()` (and `start()`'s read); wired from core.
- [x] Tests -- toml reader cases; adapter: fixture repo built from the pinned `bmod-*` records plus a generated `SKILL.md` per listed skill → every module skill labelled and grouped, record folders absent, agents, entry action, both capability rows, unlabelled fallback, every bad-metadata row; core: baseline null, later module stamped, given value kept, per workspace; server (real adapter, fake agent): baseline read, copy a test module into `.claude/skills`, next GET lists it with `installedAt`, POST planning start on its skill → session with kind `planning`.

**Acceptance Criteria:**
- Given the full suite, when `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm run pack && pnpm smoke` run, then all pass.

## Implementation Notes

- A skill folder whose `bmod.toml` has a `[bmod]` table is a record folder (never a skill) even when the record is unusable (no or bad `code`, `skills` not a list): the bad record is left out as a module but its folder doesn't turn into a skill. A `bmod.toml` without `[bmod]` (upstream `bmad`'s own `[skill]` one) is not a record.
- Agent `description` (not decided in planning): the catalog skill's description (mapped sentence, else `SKILL.md`), never the roster `persona`.
- `skills.ts` now exports `inside`, `readHead`, `readInsideRepo` (realpath-inside-repo + bounded regular-file read, shared by the skill scan and the records), `realRepoRoot` and `scanSkillsAt`; `scanSkills` behaves as before.
- `ticket_tree` lstats `_bmad`, `_bmad/scripts` and the file from the repo's real path (real folders, regular file, no link followed), then reads 64 KB and matches `^\s*def load_central_config(`; a mention outside a `def` doesn't count.
- `setup.ts`'s `tomlString` left as it was (the plan allowed, not required, replacing it).
- Mapping problems are not surfaced at runtime (the frozen `Catalog` has no problems field); the shipped file's tests assert it has none, module labels included.
- Review fixes: the TOML reader answers `TOML_UNREADABLE` for a key that is there but unreadable, so a `[bmod]` whose `skills` is a number or a non-string list is left out; the first record naming a usable code claims it even when left out; `readHead` opens `O_RDONLY | O_NONBLOCK | O_NOFOLLOW` and checks the opened file is regular; at most `MAX_SKILL_FOLDER_ENTRIES` (1000) entries per skills folder (both scans) and `MAX_ROSTER_MEMBERS` (200) roster members are read; `planning.catalog()` checks the Planning guard again after the scan, before `stamp`.
- Verified: `pnpm typecheck`, `pnpm test` (126 files, 1502 passed), `pnpm e2e` (95 passed), `pnpm run pack && pnpm smoke` (OK).
- Verification after the review patches: a `toml.ts` doc comment quoting `from "absent"` tripped the packaging test's bundle import scan; reworded. Then `pnpm typecheck`, `pnpm test` (1507 passed, 4 skipped), `pnpm e2e` (95 passed), `pnpm run pack && pnpm smoke` pass.

## Plan Change Log

## Review Triage Log

### Pass 1 (2026-10-02; lenses: quick, security)

Verdicts: high 0, medium 1, low 10, false 0, maybe-false 0 (quick Q1-Q5, security S1-S6).

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| Q1 | A `[bmod]` with an unreadable `skills` (`3`, `[1,2]`) is still a module with no skills | low | patch | `toml.ts` drops the key, `bmod.get('skills') ?? []`. Fix: the reader marks present-but-unreadable; such a record is left out; test. |
| Q2 | An unusable first record of a code lets a later one take the code | low | patch | `records.has(code)` checked before the skills check. Fix: the first record claims the code; test. |
| Q3 | A catalog read during Ogden's own setup takes a partial baseline, so modules written later show New | low | reject | Plan and Board show the setup panel, not the catalog, while setup runs (4.3), so the web does not read it then; a guard would couple stamping to setup state. |
| Q4 | A record folder whose `bmod.toml` is unreadable (FIFO) but has a `SKILL.md` is listed as a skill | low | reject | Needs a hostile repo; the result is one extra startable entry the agent runs behind permission cards. |
| Q5 | Record folders are excluded by name across `.agents` and `.claude`, so a same-named real skill in the other folder is dropped | low | reject | Needs a record and a different skill with one name in the two folders; the fix needs per-folder origin plumbing through `scanSkillsAt`. |
| S1 | `readHead` stats then opens by path: a FIFO swapped in blocks a threadpool thread, a link swapped in is followed | medium | patch | Needs a concurrent writer in the repo (an agent session). Fix: open `O_RDONLY|O_NONBLOCK|O_NOFOLLOW`, `handle.stat().isFile()`. The containment re-check after open is deferred. |
| S2 | No cap on skill-folder entries or roster members; 5000 folders × 3000 members took ~6.7 s per read, on every GET | low | patch | Reproduced by the lens. Fix: caps per skills folder and per roster; test. |
| S3 | `bmad_modules_seen` grows with every code a repo ever declares, and history deletion keeps the rows | low | defer | Bounded per read by S2's caps; growth needs many branch switches with new codes. Deferred. |
| S4 | Repo text (`version`, roster `title`, description) reaches the UI unbounded, with control and bidi characters | low | defer | React escapes it (no injection); a length limit is a shared-schema change; the description path is 4.1's. Deferred. |
| S5 | A repo skill claiming a mapped name gets Ogden's label, group, `next` or the entry action | low | reject | By design (AD-12: labels keyed by skill name, skills discovered in the repo); the agent runs the repo's skill either way, behind permission cards. Reported. |
| S6 | `catalog()` stamps after the scan without re-checking the Planning guard | low | patch | `start()` re-checks, `catalog()` doesn't. Fix: re-check before `stamp`; test. |

## Design Notes

Rebuild per read keeps "refresh without a restart" trivially true and matches AD-10's throw-away index spirit; a scan is a few dozen bounded file reads. The open Plan page refetches on focus (4.6 owns it); a push event would be a contract change, not needed for the verify.

Migration numbering: 4.6 and 4.9 are web lanes; if either adds a migration, renumber at merge.

## Verification

**Commands:**
- `pnpm typecheck && pnpm test` -- pass
- `pnpm e2e` -- pass
- `pnpm run pack && pnpm smoke` -- pass
