---
title: 'Set up BMad Method in a project from the UI'
type: 'feature'
ticket: '3'
created: '2026-10-02'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'security']
review_loop_iteration: 1
baseline_revision: 'eef1a2659d07b7b03d041233e1a9817a0f82fdf9'
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A project with Planning or Board on but no `_bmad/` can't plan or show tickets, and today the only way to set BMad Method up is a terminal. 4.2 froze setup's contract (`BmadSetupStatus`, `bmad.setup_*` events, `GET|POST …/bmad/setup` answering 501) and left the use-case and adapter unbuilt.

**Approach:** Build setup end to end: the `bmad-catalog` adapter copies the bundled fork's skills into the repo's `.claude/skills/` (Claude Code only) and runs the bundled `skills/bmad/scripts/setup.py` (`--list-config-questions`, setup with default answers, `--status`) through 4.2's uv runner from the neutral work folder; core's `createBmadSetup` runs one setup per workspace and streams progress events; the routes fill in; the web shows a Set up panel on Plan and Board and the status in Workspace settings, and starts setup when the first piece is turned on in a project without `_bmad/`.

**Trust decision (proved at planning, keeps setup exempt from the script trust):** `setup.py` imports only the Python standard library (no `subprocess`, `importlib`, `exec`/`eval`, `runpy`), never imports or runs the project's `_bmad/scripts` (`config_utils.py`) or any repo file, runs no git or hooks, and only reads the project as data (TOML, file copies). It runs as the bundled file, so `sys.path[0]` is the package's folder; uv runs with `--no-project` from `<dataDir>/tools/uv-work`, so no repo `.venv`, `.python-version`, `pyproject.toml` or `uv.toml` is found; the env is the one allowlist (no `PYTHONPATH`). `--status` reads each module's update source over the network (GitHub raw, 10 s timeout); Ogden ignores those upstream states and compares with the bundled version only.

**Decisions (ticket unknowns):** the bundled modules ask no config questions (verified with real uv); setup still answers any future question with its emitted default through `--module-answers` in a file in the work folder, never in the repo. `npx skills` is not needed: Ogden copies skills itself.

**Decision (caller rule for this story):** setup writes only into a project whose `_bmad/` is absent (lstat, a symlink counts as present) and only as the user's action with Planning or Board on; it never overwrites or deletes an existing `_bmad/` or an existing skill folder under `.claude/skills/`. A project with `_bmad/` gets status only; updating it (`Upgrade this project`) is entry 4.11's.

**User decisions (2026-10-02, review S1 and S2; they supersede the bundled-fork wording above, story 4.14 replaced the forks with pinned upstream, verified):**
- S1: setup takes every script, skill and payload from the verified pinned copy only. The user's Set up (or turning the first piece on) is the explicit action that calls the server's one `BmadSourcePort.download()` (reuse the server's single source instance, never build another); then it runs `source.file('bmad/scripts/setup.py')`, copies skills from the verified `skills/` folder, and passes `--skill` = the verified copy's `bmad` folder with no `--root` into the repo, so the payload, config template and module records never come from the repo's `.claude/skills` (a repo copy of `bmad` with a hostile `output_folder` or a symlink at `skills/bmad` has no effect: test).
- S2: the setup status is read from files only, in TypeScript: never `setup.py --status`, no subprocess and no network on `GET …/bmad/setup` or any page load (test); setup's `verifying` step maps from the same file read. The installed version comes from the repo's installed `bmod-method/bmod.toml` read as data (lstat, no link followed), compared with the pinned version.

## Boundaries & Constraints

**Always:** Setup routes keep `projectScripts: false` with `requireAnyBmadFeature(['planning','board'])`. Every uv run: bundled script path, cwd = the work folder, repo named only by `--project-root`/`--skill`. Skills are copied file by file from the package into a staging folder beside the target, then renamed into place; `.claude` and `.claude/skills` must be real folders inside the repo's `realPath` (a symlink is refused). Shapes, codes and texts in `packages/shared` (no em/en dashes in UI strings). Failures reach the UI as plain words without paths; chats keep working.

**Never:** No run of any file inside the repo. No write to an existing `_bmad/` or skill folder, no deletion in the repo. No setup without a user action. No new dependency. Tests never run real `claude`, the keychain or the network (real-uv tests block HTTP through a refused local proxy), never read the real `~/.claude`; test hooks only via `testHooksAllowed`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error handling |
|---|---|---|---|
| First setup | Planning on, no `_bmad/`, `POST …/bmad/setup` | 202 `{started:true, setup:{state:not_set_up}}`; events started, progress ×4 (checking, copying_skills, writing_config, verifying), completed `{status: current}`; `_bmad/` and `.claude/skills/*` written | — |
| Already set up | `_bmad/` exists (dir or symlink) | 409 `bmad_already_set_up`, nothing written | — |
| Second POST while running | same workspace | 202 `{started:false}` | — |
| uv missing / setup.py exits 1 / unwritable folder | — | `bmad.setup_failed {reason}` plain text; GET still answers | staging removed |
| Existing skill folder | `.claude/skills/bmad-spec` present | left untouched, others copied | — |
| `.claude/skills` is a symlink | — | failed, nothing copied | — |
| Status | `_bmad/` absent | `not_set_up`, no script run | — |
| Status | installed older than pinned | `update_available` (+ `bmadUpdateAvailableText`), read from files, no subprocess | unreadable → `unusable` with problem |
| Pieces off | both off | 409 `feature_off` | — |

</frozen-after-approval>

## Code Map

- `skills/bmad/scripts/setup.py` of the pinned upstream (verified copy `<data>/bmad/bmad-method/<commit>/skills/`, reached through `BmadSourcePort.file`; a test copy in `tests/fixtures/bmad-upstream/skills/bmad/`) -- `main` l.170 (modes), `setup` l.235 (no answers needed when no questions; pending without answers raises), `status_report` l.1689, `discover_installation` l.1111 (root = `--skill`'s parent), `materialize_bmad` l.2189 (stages `_bmad.setup-*`, renames when absent), `read_source_file` l.1834 (network; no longer run: status is read from files). Read-only reference.
- `packages/shared/src/planning.ts:366-426,512-525` -- frozen setup shapes, steps, labels, texts; append new texts in this section only. `errors.ts` codes; `events.ts:199-233` `bmad.setup_*` on `onWorkspaceStream`.
- `packages/core/src/bmad-setup.ts` -- `BmadSetupUseCases`, `BmadSetupDeps` (add `detect` to the catalog Pick); pattern: `bmad-script-trust.ts:75` (`events.transaction`/`append`), `bmad-detection.ts:44`; `bmad-features.ts:61-82` `requireAnyBmadFeature`; `core.ts:49-67` wiring; `OpenCoreOptions.bmadCatalog`.
- `packages/adapters/src/bmad-catalog/index.ts:65-70` -- `createBmadCatalog()` stubs; a test pins this file's fs imports to lstat, so put setup in `bmad-catalog/setup.ts`. `catalog-memory/index.ts:102-118` setup stub (`MEMORY_BUNDLED_BMAD_VERSION`, `setupFails`). `toolchain-uv/script-runner.ts` `run({script,args,cwd,onLine})`, `ScriptRunError` codes; `tickets-v7/index.ts:60,120` `workDir` pattern.
- `packages/server/src/planning-routes.ts:102-103` -- the two 501 setup routes; `start.ts:97-113` `VENDOR_ROOT_CANDIDATES`, `uvWorkDir`, `:186` `createBmadCatalog()` (built before `scriptRunner` at :401, reorder or pass lazily), `:535-539` shutdown (add `bmadSetup.settled()` before `scriptRunner.close()`); `errors.ts` mapping.
- Tests to update: `server/test/planning-routes.test.ts:161-164` (501 → real), `:317-349` real-uv pattern (`TEST_UV_PYTHON_ENV`, `extraUvEnv`), `bmad-guard-coverage.test.ts:115-144`, `gate.test.ts:620,675`; `adapters/test/bmad-catalog-skills.test.ts:299-315` (cwd assertion pattern); `tests/fixtures/fake-uv.mjs` (`FAKE_UV_MODE`), `fake-bmad-repo.ts:120`.
- Web: `routes/workspace-plan-page.tsx`, `routes/workspace-board-page.tsx`, `planning/planning-api.ts`, `workspaces/bmad-method-section.tsx:229,282-288` (`choose`/`save`), `workspaces/bmad-detection-api.ts` (cheap `_bmad/` check for the pages), `events/event-stream.tsx:467` `useEventStream`, `events/use-event-invalidation.ts`, `ui/{notice,button,row-list,progress}.tsx`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/{planning.ts,errors.ts}` -- code `bmad_already_set_up` (409) + `BMAD_ALREADY_SET_UP_MESSAGE`; `BMAD_SETUP_FAILURE_REASONS` texts for `uv_missing`, `not_writable`, `timeout`, `failed`; status-line texts for `current`/`setup_owed`/`unusable`; contract tests.
- [x] `packages/adapters/src/bmad-catalog/setup.ts` (+ `index.ts` options `{ runner, workDir, bundledSkillsDir }`) -- `setupStatus`: lstat `_bmad` → `not_set_up` with no run; else `setup.py --status`, map: script error → `unusable`; `next` starting `bmad setup` → `setup_owed`; installed (`method` module version) semver-older than bundled (bundled `bmod-method/bmod.toml` `[bmod] version`) → `update_available`; else `current`; `outputFolder` from `_bmad/config.toml` `output_folder` (`{project-root}/` stripped, validated `RepoRelativePath`, else null + problem). `setup`: refuse when `_bmad` present (`BmadAlreadySetUpError`), check `.claude/skills` safety, copy each missing bundled skill (skip `__pycache__`) via staging + rename, run `--list-config-questions` (defaults file in work folder when any, removed after), run setup, then `--status`; map errors to the reason codes. Every run passes the bundled script path, cwd = workDir.
- [x] `packages/adapters/src/catalog-memory/index.ts` -- refuse setup when already set up, so e2e covers 409.
- [x] `packages/core/src/{bmad-setup.ts,core.ts,errors.ts,index.ts}` -- `createBmadSetup(deps)`: guard, `realPath`, one in-flight setup per workspace, `start` refuses `BmadAlreadySetUpError` via `detect`, background run appending `bmad.setup_started`, `_progress`, `_completed {status}` or `_failed {reason}` (plain reason, unknown errors → `failed` text); `settled()`.
- [x] `packages/server/src/{planning-routes.ts,start.ts,errors.ts}` -- GET → 200 `BmadSetupStatusResponse`; POST → 202 `BmadSetupStartedResponse`, 409 `bmad_already_set_up`; wire the real adapter with the runner, work folder and the server's one `BmadSourcePort` (was: vendor skills folder, before 4.14); await `settled()` on stop.
- [x] `tests/fixtures/fake-uv.mjs` -- mode `bmad-setup` emulating the three setup.py modes against `--project-root` (creates `_bmad/config.toml`), plus an argv/cwd log file option.
- [x] `packages/web/src/planning/{bmad-setup-panel.tsx,bmad-setup-api.ts}` -- panel: not-set-up text + Set up; progress list from `bmad.setup_progress` events for the workspace; failure notice with reason and Set up again; on completed, `BMAD_SETUP_DONE_TEXT` and invalidate detection, setup, catalog and tickets queries. Plan and Board pages show the panel instead of their content when detection says no `_bmad/` (or a setup is running).
- [x] `packages/web/src/workspaces/bmad-method-section.tsx` -- with Planning or Board on, a status line from `GET …/bmad/setup` (update text when `update_available`, problems when `unusable`, Set up when `not_set_up`); after a save turns on the first of Planning/Board in a project without `_bmad/`, start setup and show the panel's progress inline.
- [x] Tests -- adapter (fake uv): argv uses the bundled script, cwd is the work folder for every run, skip existing skill, symlinked `.claude/skills` refused, staging cleaned on failure, state mapping, questions defaults file outside the repo; **real uv** (skipped like `planning-routes.test.ts` when uv or the managed Python is missing; HTTP(S)_PROXY to a refused local port via `extraUvEnv`): POST on an empty fixture repo → `_bmad/` written, events in order, GET `current`; and the **no-project-code test**: the repo holds `.claude/skills/bmad` as a copy of the bundled skill whose `scripts/{setup.py,resolve_config.py,config_utils.py}` are replaced by marker writers, `sitecustomize.py`, `usercustomize.py`, `.venv/`, `.python-version` `3.1`, `pyproject.toml`, `uv.toml` — setup succeeds and no marker exists; core use-case tests (memory catalog); server route + guard/gate registry updates; web DOM tests (panel, section); e2e with the memory catalog: turn on Planning → setup progress → Ready; failure → plain error and a chat still opens.
- [x] `_bmad-output/initiative-ogden-agents/deferred-work.md` -- append: Upgrade/repair of an existing `_bmad/` (4.11); `--status` network fetch of update sources (fork `--offline` flag).

**Acceptance Criteria:**
- Given an empty fixture repo with Planning turned on in Workspace settings, when setup runs (CI, all three OSes via the real-uv vitest), then `setup.py --status` reports current, the progress list showed each step, and nothing inside the repo was executed.
- Given every BMad piece off, then no setup route runs and nothing is written under `_bmad/`.
- Given the full suite, `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm run pack && pnpm smoke` pass.

## Implementation Notes

- Every `setup.py` run passes `--skill <repo>/.claude/skills/bmad` (its parent is the root setup reads the installed modules from), so the repo's own `bmad` skill folder, when present and kept, is read as data (copied into `_bmad/scripts`), never run; the no-project-code test covers it.
- Core's `start` refuses through `detect` (a real `_bmad/` folder) and then through the status: the adapter's `setupStatus` answers `unusable` with no run for a link or file named `_bmad`, so that is a 409 too. The adapter's `setup` refuses any `_bmad` entry again (lstat).
- `BmadSetupError` (`bmad_setup_failed`, reasons `uv_missing`, `not_writable`, `timeout`, `failed`) and `BmadAlreadySetUpError` live in core's `errors.ts`; the plain texts in `planning.ts` (`BMAD_SETUP_FAILURE_REASONS`, `bmadSetupCurrentText`, `BMAD_SETUP_OWED_TEXT`, `BMAD_SETUP_UNUSABLE_TEXT`, panel labels).
- `--status` problems from the script are not forwarded (they name paths); `problems` carries only Ogden's plain lines.
- A stopping server waits up to 30 s for a setup in progress (`settled()`) before closing the runner.
- The e2e `startServer` (`tests/support.ts`) now defaults to `stubSetupCatalog` (real read-only catalog, stub setup), so turning Planning or Board on in any browser test never runs uv; `TEST_UV_PYTHON_ENV` and `realUvMissing` moved to `packages/server/test/helpers.ts` for both real-uv suites.

- After the review and the rebase onto 4.14 (S1, S2, Q1 to Q9, N3):
  - S1: `start.ts` builds the one `BmadSourcePort` in `startLocked` (moved up from `listenAndAnnounce`) and passes it both to `createBmadCatalog({ runner, workDir, source })` and to tickets-v7 and `createBmadSource`. Setup calls `source.download()` in its `checking` step, runs `source.file('bmad/scripts/setup.py')`, copies skills from that verified `skills/` folder and passes `--skill <verified>/bmad` with no `--root`. A `BmadDownloadError` fails the setup with its own plain message (core's `bmadSetupFailureReason` passes `bmad_download_failed` through). `bundledSkillsDir` is gone.
  - S2: `setupStatus` reads files only (`_bmad`, `_bmad/scripts`, `_bmad/config.toml`, the output folder, the repo's `.claude/skills/bmod-method/bmod.toml` through real folders only) against `source.status().version` (the lock's pinned version); no `--status` run at status or at `verifying`. A set-up repo whose version can't be read is `unusable` (`BMAD_SETUP_VERSION_UNKNOWN_TEXT`). fake-uv's `--status` emulation is removed.
  - Q5: `compareVersions` lives in `packages/shared/src/semver.ts` (`@ogden-agents/shared/semver`, import-free for the launcher); `launcher.ts` re-exports it.
  - Q6: `.claude` and `.claude/skills` are lstat-checked before the download or any folder is created.
  - Q3/Q4/Q7 (web): a done or failed line shows only for a setup this view started or saw start after the stream's backlog arrived (`liveAfter`); Settings shows the fetched status unless a setup runs or ended live, with a refused Set up's message under it; on Plan and Board a 409 `bmad_already_set_up` shows the unusable notice instead of Set up.
  - Tests: `tests/fixtures/bmad-upstream/skills/` now also holds `bmad/` (without `scripts/tests/`), `bmod-method/` and `bmod-core-tools/` from the pinned commit; `fixtureUpstream()` moved to `packages/server/test/helpers.ts`, used by the board's and setup's real-uv tests. New: GET status spawns no process and fetches nothing; a repo-owned `bmad` with a hostile `output_folder` (absolute outside, `../..`) or a linked one changes nothing outside the repo. The e2e `stubSetupCatalog` downloads through the server's source when given.

## Plan Change Log

## Review Triage Log

### Pass 1 (2026-10-02; lenses: quick, security)

Verdicts: high 2, medium 4, low 9, false 0, maybe-false 0. Routing: 2 intent_gap entries stopped the loop; the user answered both on 2026-10-02 (decisions in the frozen block), the branch was rebased onto story 4.14, and the queued patches are applied with the rework.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| S1+S3+S5 | `--skill <repo>/.claude/skills/bmad`: a project's own (or symlinked) `bmad` skill supplies setup's payload and config template; `output_folder = "/abs"` or `../..` makes `setup.py` `ensure_dir` create folders outside the repo; a link at `skills/bmad` copies outside files into `_bmad/scripts`; the repo's bmod.toml questions' defaults are auto-accepted | high | intent_gap | Reproduced by the security lens with real uv (folder created outside the repo; `SECRET` file copied in). No code runs, so the trust proof holds, but the frozen intent ("repo named by `--skill`", "never touch an existing skill folder") lets project data steer writes. Options were put to the user. **Resolved (user decision 2026-10-02, on 4.14):** setup downloads through the server's one pinned source, runs the verified `setup.py` with `--skill` = the verified `bmad`, no `--root`; real-uv tests show a hostile repo `bmad` (outside `output_folder`, symlink) has no effect. |
| S2+Q2 | `setup.py --status` (on the trust-exempt `GET …/bmad/setup` and setup's `verifying` step) fetches every module's `update_source` from the repo's `bmod.toml`, so a repo can make Ogden contact any URL (internal probe/beacon) or read `file:` paths, with no trust or explicit action; slow networks can time out a setup after `_bmad/` is written | high | intent_gap | Reproduced (listener got a TLS ClientHello). The frozen intent accepted the network read assuming GitHub sources. **Resolved (user decision 2026-10-02):** status is read from files in TypeScript; `--status` is never run; a test shows GET spawns nothing and fetches nothing. |
| Q1 | (obsolete after S2: status from files) `statusFrom` keys `setup_owed` only on `next` starting `bmad setup`; `next` is `npx skills update` first when upstream is newer, so unfinished setups read `current` | medium | patch | `setup.py` `next_step` l.1068; use `shared_scripts`, `pending_questions`, `bmad_exists`. |
| Q4 | An old `bmad.setup_failed` in the event window masks the real status in Settings; a 409 from "Set up again" is never shown | medium | patch | `bmad-setup-panel.tsx` `useBmadSetup` phase from window, `reason` prefers `failedReason`. |
| Q3 | "Ready to plan." reappears after reload (`mountedAt` ~0 on an empty store) | low | patch | `bmad-setup-api.ts` `useBmadSetupProgress`. |
| Q5 | `compareSemver` copies `server/src/launcher.ts:104` `compareVersions` (AGENTS.md: move, don't copy) | low | patch | Move to `packages/shared`. |
| Q6 | A refused setup leaves a new empty `.claude/` | low | patch | `ensureRealFolder` creates `.claude` before checking `skills`; check both first. |
| Q7 | `_bmad` as a link/file: detection says absent, setup answers 409, the gate loops on Set up | low | patch | Gate should show `unusable` from the 409/status. |
| Q8 | `bundledVersion` caches a rejected read (500s until restart; raw error may carry the vendor path) | low | patch | Reset the cache on rejection; map to `unusable`. |
| Q9 | `bundledSkillsDir` doc comment names the wrong fallback | low | patch | Fix the comment. |
| S4 | `.claude/skills` swapped for a link between the check and the renames writes outside the repo | low | defer | Needs a concurrent writer in the repo during setup; not reproduced. |
| N1 | `setup.py` puts the folder name into `project_name` unescaped | low | reject | Upstream fork behaviour; the user names the folder. |
| N2 | `uvWorkDir` `mkdirSync(mode)` doesn't fix an existing folder's mode | low | reject | Pre-existing (4.2); answers file is 0600 `wx` with a random name. |
| N3 | `setup.ts` header overstates "update sources are ignored" | low | patch | Part of S2's fix. |

## Design Notes

The Plan/Board pages decide on the panel from 10.3's lstat-only detection, not `GET …/bmad/setup`, so a page view never runs `--status` (which reads update sources over the network). Settings is the one place that runs status.

Plan size: ~2,600 tokens, above the 1,600 guide; kept whole because setup is one user goal across adapter, core, routes and two UI placements, and the trust proof must travel with it.

## Verification

**Commands:**
- `pnpm typecheck && pnpm test` -- pass (real-uv setup tests run where uv and the managed Python 3.12 exist, as in CI)
- `pnpm e2e` -- pass
- `pnpm run pack && pnpm smoke` -- pass
