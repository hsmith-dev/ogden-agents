---
title: 'Reduced mode on plain upstream BMAD'
type: 'feature'
ticket: '11'
created: '2026-10-02'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'security', 'ux']
review_loop_iteration: 0
baseline_revision: '66b2f218dc5195b89d7b10202aa24d654266cf19'
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A project whose BMad Method was installed outside Ogden (by the user or another tool, possibly an older upstream, another layout, no `bmod.toml` records or no v7 ticket config) gets no explanation today: the catalog reports its two capabilities (4.4) but nothing reads them, the Board runs `tickets.py` and fails with a generic error, "Start from an idea" shows a placeholder sentence (4.6), and Set up answers 409 for any project with `_bmad/` (4.3), so there is no way to bring it up to the pinned version from the UI.

**Approach:** Gate each surface whose piece is on by the capabilities read from the repo's files (AD-14, never a version string): Plan (`plain_labels`, and the entry action), Board (`ticket_tree`, refused in core before any script runs) and Workspace settings (each missing capability of an on piece). Each shows the inline reduced-mode notice with one sentence and **Upgrade this project**, which, after a confirmation, runs 4.3's setup in an *upgrade* mode from the verified pinned copy with the same progress list; when it ends, the capabilities are present and the notices go.

**Reinterpretation note (2026-10-02, orchestrator context change after 4.14):** Ogden has no fork any more, so "plain upstream BMAD" means "a BMad install Ogden didn't make", and "the bundled fork" means the verified pinned copy (AD-13). Read-only detection, enabling what works and explaining what doesn't are unchanged from the entry. "Never modify the user's BMad" is kept as: detection and reduced mode write nothing; only the user's confirmed **Upgrade** writes, and only additively plus BMad's own repair of `_bmad/` (below). This narrows the entry's "runs setup" but keeps its intent (verify: notices gone after Upgrade), so the plan proceeds.

**Decisions (planning, autonomous):**
- Upgrade = upstream `setup.py`'s own repair (create what is missing, repair stale `_bmad/scripts` and module scripts, keep existing config values, `custom/` and leftovers), run from the verified copy with `--skill` the verified `bmad` folder and no `--root` (4.3 S1), plus copying each pinned skill the project lacks. A skill folder the project already has, in `.claude/skills` or `.agents/skills`, is never overwritten or deleted. So Upgrade fixes missing capabilities; replacing a project's outdated skill folders (an `update_available` version) is deferred (it overwrites the user's files and needs a user decision).
- Plan: the skill list still shows (unlabelled skills fall back to their `SKILL.md` description) and starts sessions; only the idea action is replaced by the notice, when `plain_labels` is false (its existing sentence) or the entry action isn't installed (a new sentence). Board: with `ticket_tree` missing, `GET …/tickets`, `GET …/tickets/:ref` and `PUT …/status` answer 409 `reduced_mode` and the page shows the notice instead of the board (no card menu); the ticket watcher doesn't start for it.
- Which piece needs which capability lives in `shared`: planning → `plain_labels`, board → `ticket_tree`; builds and retrospectives → none until epics 5 and 7.

## Boundaries & Constraints

**Always:** Capability reads are read-only, inside the repo, through `BmadCatalogPort` (lstat, regular files, bounded reads, never throwing for the repo's state), with no process and no network, and only for pieces that are on (no skill scan for a Planning-off project). Upgrade is the user's explicit, confirmed action through `POST …/bmad/setup` (`projectScripts: false`, `requireAnyBmadFeature(['planning','board'])`), downloads through the server's one `BmadSourcePort`, runs only the verified `setup.py` from the work folder, and refuses (nothing written) when `_bmad` is a link or file, `.claude`/`.claude/skills` is a link, or the existing config's output folder is not a repo-relative path reached through real folders. Shapes, codes and texts in `packages/shared`, append-only and backward compatible (old `bmad.setup_completed` payloads still parse); no em/en dashes. Notice per DESIGN.md: `info` variant, muted, info glyph, one sentence, outline "Upgrade this project", never a toast or red; accessible confirmation dialog (keyboard, screen reader).

**Never:** No version-string gating. No run of any repo file, no network on a page load or any GET. No overwrite or deletion of an existing skill folder; no write without the confirmed Upgrade. No new dependency, no new route. Tests never run real `claude`, the keychain or the network, never read the real `~/.claude`; test hooks only via `testHooksAllowed`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error handling |
|---|---|---|---|
| Board, no v7 config | Board on, trusted, downloaded; `_bmad/scripts/config_utils.py` missing or without `load_central_config` | 409 `reduced_mode`, store never called; Board shows notice (`ticket_tree` sentence) + Upgrade; no menu | — |
| Plan, unknown skills | Planning on; no installed skill in the mapping | notice (`plain_labels` sentence) where the idea prompt was; skills listed with descriptions and startable | — |
| Plan, entry missing | `plain_labels` true, `entryAction` null | notice with the entry sentence + Upgrade | — |
| Settings | Planning+Board on, both missing | status line plus one notice per missing capability, one Upgrade | Board off: only `plain_labels` shown |
| Upgrade | confirm → `POST {upgrade:true}`, `_bmad/` a real folder | 202; `bmad.setup_*` progress; missing skills copied, `_bmad/scripts` repaired, config values kept; completed → capabilities present, notices gone | failure: plain reason, Upgrade again |
| Upgrade refused | `_bmad` link/file, output folder outside or through a link | 409 / `bmad.setup_failed` plain reason, nothing written | — |
| Set up without upgrade | `_bmad/` present | 409 `bmad_already_set_up` (unchanged) | — |
| Current pinned | fixture of the pinned upstream | no notice anywhere | — |
| Piece off | Board off | no capability read, no notice for it | — |

</frozen-after-approval>

## Code Map

- `packages/shared/src/planning.ts:127-146` -- `BMAD_CAPABILITIES`, `BMAD_CAPABILITY_REDUCED_TEXT`, `BmadCapabilities`; `:400-430` `BmadSetupStatus` (append optional `missingCapabilities: BmadCapability[]`), `BmadSetupStartedResponse`; `:557` `REDUCED_MODE_MESSAGE`; `:582` `PLAN_IDEA_UNAVAILABLE_TEXT` (replace its use); `:765` `BMAD_UPGRADE_LABEL`; `bmad.ts` `BmadPiece`. `errors.ts:75` `reduced_mode` exists.
- `packages/core/src/bmad-catalog-port.ts` -- add `missingCapabilities(repoPath, wanted: readonly BmadCapability[]): Promise<BmadCapability[]>`; `setup(repoPath, onProgress, options?: { upgrade?: boolean })` (doc already says "or upgrades").
- `packages/core/src/errors.ts` -- add `ReducedModeError` (code `reduced_mode`, `REDUCED_MODE_MESSAGE`, `capability`); server `bmad-pieces.ts:112` already maps the code to 409.
- `packages/core/src/bmad-setup.ts` -- `status` adds `missingCapabilities` for on pieces (not for `not_set_up`); `start(workspaceId, { upgrade })`: without, unchanged; with, requires `detect().hasBmad` and passes `upgrade` to the port.
- `packages/core/src/board.ts:guarded` -- after `source.requireReady()`, `missingCapabilities(repo, ['ticket_tree'])` non-empty → `ReducedModeError` (also inside the serialized mark). `BoardDeps.catalog`. `ticket-watcher.ts:115` -- skip the watch when `ticket_tree` is missing (re-decided on `bmad.setup_completed`, already relevant).
- `packages/adapters/src/bmad-catalog/catalog.ts` -- `hasTicketTree`, `applyLabels` usage: export a `missingCapabilities` that computes only the wanted ones (labels need `scanSkillsAt`); `index.ts` wires it (keep its `lstat`-only import test).
- `packages/adapters/src/bmad-catalog/setup.ts` -- `setup(…, { upgrade })`: upgrade requires a real `_bmad/` folder, checks the existing `config.toml` output folder (`outputFolderOf` + lstat each existing segment, no link), skips skills present in either `SKILL_FOLDERS` folder, then the same runs. Not-upgrade path unchanged.
- `packages/adapters/src/catalog-memory/index.ts:102-130` -- `missingCapabilities` from an option (default none missing, so existing tests keep their board), `setup` with `upgrade` that clears the repo's missing capabilities and sets `plain_labels`/`entryAction` as configured.
- `packages/server/src/planning-routes.ts:232-243` -- POST reads an optional small body `BmadSetupStartRequest {upgrade?: boolean}` (`bodyLimit`, empty body = `{}`), 400 on a bad one; update header comment. `server/test/{bmad-setup-routes,planning-routes,gate,bmad-guard-coverage}.test.ts`.
- Web: `planning/plan-home.tsx:229` (idea area), `planning/board-tickets.tsx:51-52` (prompt pattern: add `reduced_mode`), `planning/bmad-setup-panel.tsx` (`useBmadSetup.start`, `BmadSetupView` progress), `planning/bmad-setup-api.ts:38` `startBmadSetup` (body), `workspaces/bmad-method-section.tsx:211-245` (status line; `setup_owed` with `_bmad/` offers Upgrade instead of Set up), `ui/notice.tsx` (`info`), `ui/alert-dialog`.
- Fixtures: `tests/fixtures/bmad-upstream/skills/` (pinned baseline), `tests/fixtures/fake-uv.mjs` mode `bmad-setup`, `packages/server/test/helpers.ts` `fixtureUpstream()`, `TEST_UV_PYTHON_ENV`, `realUvMissing`; e2e `tests/e2e/plan-and-board.spec.ts`, `tests/support.ts` `stubSetupCatalog`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/planning.ts` (+ `index.ts`, contract tests) -- `BMAD_PIECE_CAPABILITIES`, `BmadSetupStartRequest`, optional `missingCapabilities`, texts: `PLAN_ENTRY_REDUCED_TEXT`, `BMAD_UPGRADE_CONFIRM_TITLE`/`_TEXT`/`_CONFIRM`/`_CANCEL`, `BMAD_UPGRADE_DONE_TEXT`, `BMAD_UPGRADE_REFUSED_TEXT` (link or outside output folder).
- [x] `packages/core/src/{errors.ts,bmad-catalog-port.ts,bmad-setup.ts,board.ts,ticket-watcher.ts,index.ts}` + `server/src/start.ts` wiring -- as Code Map.
- [x] `packages/adapters/src/bmad-catalog/{catalog.ts,index.ts,setup.ts}`, `catalog-memory/index.ts` -- as Code Map.
- [x] `packages/server/src/planning-routes.ts` -- upgrade body.
- [x] `packages/web/src/planning/reduced-mode-notice.tsx` (new) -- notice + Upgrade → confirm dialog → `startBmadSetup(wsId, {upgrade:true})`, progress via `BmadSetupView`, done line, invalidates setup, catalog and tickets queries; used by `plan-home.tsx`, `board-tickets.tsx`, `bmad-method-section.tsx`.
- [x] `tests/fixtures/bmad-plain/` -- two read-only "plain" repos built in tests: (a) older layout: `_bmad/_config/manifest.yaml`, `_bmad/bmm/config.yaml`, one unmapped skill, no records, no `_bmad/scripts`; (b) bmod layout whose `config_utils.py` lacks `load_central_config`. README with provenance.
- [x] Tests -- adapter: `missingCapabilities` per fixture and per wanted list (Planning-off never scans skills); upgrade with fake uv (argv verified script, cwd work folder, skips existing skill in `.agents/skills`, refuses link `_bmad`, outside/linked output folder, nothing written); **real uv** (skipped like 4.3's): fixture (b) and (a) → upgrade → `config.toml` values kept, `custom/` kept, both capabilities true, existing skill bytes unchanged. Core: board 409 before store, status lists only on pieces' capabilities, start upgrade guards. Server: route body cases, 409 `reduced_mode` mapping. Web DOM: Plan, Board, Settings notices, confirm dialog keyboard/cancel, progress, notices gone after completed. E2E (memory catalog): Board+Planning on, reduced → notices on Plan, Board, Settings, no board menu → Upgrade → confirm → progress → notices gone and tickets shown. Update existing tests that relied on default `plain_labels: false`.
- [x] `_bmad-output/initiative-ogden-agents/deferred-work.md` -- append: updating an outdated project's existing skill folders (`update_available`) needs a user decision on overwriting.

**Acceptance Criteria:**
- Given a fixture repo with plain (older) upstream BMad and Planning and Board on, when Plan, Board and Workspace settings open, then each shows the reduced-mode notice where the missing feature would be, the board menu is unavailable, nothing errors silently, and Upgrade this project ends with the capabilities present and the notices gone.
- Given the full suite, `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm run pack && pnpm smoke` pass.

## Implementation Notes

- Upgrade refused before it starts (a `_bmad` link or file) answers 409 with a new appended code `bmad_upgrade_refused` (`BmadUpgradeRefusedError`); an upgrade without `_bmad/` answers 409 `bmad_not_set_up` (new `BmadNotSetUpError`). The adapter's own refusals (linked `.claude`/`.claude/skills`, linked config, output folder outside, unreadable here or through a link) fail the run as `bmad.setup_failed` with `BMAD_UPGRADE_REFUSED_TEXT` (`BMAD_SETUP_FAILURE_REASONS.upgrade_refused`), nothing written or downloaded.
- An `output_folder` the adapter's one-line TOML reader can't see (dotted key, inline table, multi-line) is refused, since `setup.py` might use it.
- Review fixes: the upgrade reads `_bmad/config.toml` only in a strict TOML subset (`strictOutputFolder`, bounded `O_NOFOLLOW` read) and refuses Windows-normalised output segments and any `_bmad/` holding a link, a special entry, more than 5000 entries or 50 MB; the board answers `bmad_not_set_up` without `_bmad/` before reading capabilities; the setup route uses `readBody(..., { optional: true })`; the web keeps the upgrade's progress and done line mounted (Board too), announces the end in a persistent polite region, moves focus to the done line, returns focus to Upgrade after the confirmation, shows one notice per surface, and in Settings retries an unfinished setup as an upgrade.
- The ticket watcher checks `ticket_tree` after the output folder (a not-set-up project still reports `no_output_folder`), told once as `reduced_mode`.
- The memory catalog now lacks no capability by default (its catalog's `capabilities` default to both `true`); `missing` and `afterUpgrade` options drive reduced mode and Upgrade. `stubSetupCatalog` (e2e) answers no missing capability, so the existing board browser tests are unchanged; the reduced-mode browser test uses the memory catalog.
- Web: `BmadSetupGate` no longer takes over the page for an upgrade (a run in a project with `_bmad/`), and shows "Ready to plan." only after a setup it showed; the notice shows the upgrade's progress. A start refused after a failed run now shows the refusal instead of that run's failure.
- `Notice` gained `infoGlyph` (the Reduced-mode notice's info glyph). `PLAN_IDEA_UNAVAILABLE_TEXT` stays exported, unused.

## Plan Change Log

## Review Triage Log

### Pass 1 (2026-10-02; lenses: quick, security, ux)

Verdicts: high 1, medium 9, low 13, false 0, maybe-false 0 (quick Q1-Q5, security S1-S8, UX U1-U17; Q1 = S1, Q2 = S5, Q5 = U4). No intent_gap or bad_plan; patches sent to the implementer.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| Q1+S1 | `checkUpgradeTarget` reads `output_folder` line by line; tomllib reads a decoy in a `'''` string or an escaped quoted key differently, so setup.py `ensure_dir` creates folders outside the repo | high | patch | Reproduced by the security lens with Python 3.12 against the pinned `setup.py`. Fix: refuse unless config.toml is in a strict line subset where both readings agree. |
| S2 | Windows: output segments ending in `.`/space or holding `:` pass the lstat walk but Win32 normalises them in Python | medium | patch | Inferred (no Windows host). Fix: refuse such segments. |
| S3+S4 | setup.py copytrees the existing `_bmad` (junctions followed on Windows; `custom/` link read) with no bound | medium | patch | CPython `_copytree` treats mount points as folders; `existing_user_config` follows links. Fix: lstat-walk `_bmad`, refuse links and non-regular entries, cap entries and bytes. |
| Q2+S5 | `readFile(config.toml)` unbounded and follows a swapped link | low | patch | Reuse the bounded no-follow reader. `plainFileText`'s unbounded status read is 4.3's: deferred. |
| Q3 | POST body parsed by hand, duplicating `readBody(..., {optional:true})` | low | patch | AGENTS.md reuse rule. |
| Q4 | Board in a project with no `_bmad/` answers `reduced_mode`, so Upgrade would be offered and refused | medium | patch | `board.ts guarded`. Fix: `bmad_not_set_up` when `detect().hasBmad` is false. |
| Q5+U4 | Board unmounts the notice on completion: no done line, focus lost | medium | patch | Keep the run's progress/done mounted, focus it, announce through a persistent live region. |
| U1 | Confirm dialog returns focus to body | medium | patch | No trigger; use `onCloseAutoFocus` (pattern `ticket-status-menu.tsx`). |
| U2 | Focus lost when the notice unmounts after completion (Plan) | low | patch | With Q5. |
| U3 | Progress steps and done not announced | low | patch | Persistent polite live region, with Q5. |
| U5 | Disabled Upgrade has no reason | low | reject | With U6 the progress list always shows beside it. |
| U6 | Mode and liveness kept in component state: tab switch mid-run hides steps and swallows failure | medium | patch | Probe by the lens. Fix: show progress for any running setup; a run seen running is live. |
| U7 | Settings retry after another tab's failed upgrade sends Set up: 409 dead end | medium | patch | Retry with `upgrade: true` when `_bmad/` exists. |
| U8 | Two "Upgrade this project" buttons after a failure | low | patch | No separate retry in upgrade mode. |
| U9 | "Upgraded" shown while capabilities are still missing; Settings `done` hides the notices | medium | patch | Done line only when the completed status lacks nothing; Settings keeps status and notices. |
| U10 | `setup_owed` line says "Set it up again" beside an Upgrade button | low | patch | New line pointing at Upgrade. |
| U11 | Two capability panels, the button on the second | low | patch | One notice, both sentences, one button. |
| U12 | Gate can flash "Ready to plan." after an upgrade | low | patch | Set `showedPanel` only with detection loaded. |
| U13 | "older version" isn't true for every install Ogden didn't make; Plan notice doesn't say the idea action is unavailable; "skills" jargon | medium | patch | Copy rewritten (shared texts). |
| U14 | Confirmation copy contradicts the "Writing settings" step, omits the download, two sentences | low | patch | One accurate sentence. |
| U15 | Refused text dense with no next step; `BMAD_UPGRADE_LABEL` doc stale | low | patch | Copy and comment. |
| U16 | Upgrade leaves `update_available` text with no action | low | reject | Deliberate, deferred at planning (overwriting skill folders needs a user decision). |
| U17 | Upgrade failures use setup wording; refusal shown in two treatments by timing | low | reject | Same pattern as 4.3's panel; plain and accurate enough. |
| S6 | TOCTOU between path checks and writes | low | defer | Needs a concurrent writer; as 4.3 S4. |
| S7 | 30 s kill mid `replace_dir` leaves `_bmad.old-*` | medium | defer | Mitigated by S3's size cap; data kept. deferred-work.md. |
| S8 | One setup per workspace, not per repo path | low | defer | Pre-existing from 4.3. |

After the patches (2026-10-02): `pnpm typecheck`, `pnpm test` (1686 passed, 4 skipped), `pnpm e2e` (102 passed), `pnpm run pack && pnpm smoke` (OK).

## Design Notes

Unknown resolved: no list of upstream versions is kept. Capabilities are judged from files against what the verified pinned scripts need (AD-14 note): `ticket_tree` is what the pinned `tickets.py` imports; `plain_labels` is whether the project's skills are ones Ogden's mapping knows. The pinned fixture is the baseline (both present); the two plain fixtures cover a pre-`bmod` layout and a `bmod` layout with an older `config_utils.py`.

Plan size ~2,400 tokens, over the 1,600 guide; kept whole: one user goal (reduced mode with its upgrade) across shared, core, adapter, route and three surfaces, as the entry defines it.

## Verification

**Commands:**
- `pnpm typecheck && pnpm test` -- pass
- `pnpm e2e` -- pass
- `pnpm run pack && pnpm smoke` -- pass
