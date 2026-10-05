---
title: 'Refactor sweep (epic 4)'
type: 'refactor'
ticket: '12'
created: '2026-10-03'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'security']
review_loop_iteration: 0
baseline_revision: '24580065f91340a7afddf750bf54625c681f8b93'
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 4 left: a security gap (Ogden's labels, groups, the "Start from an idea" entry action and next-step buttons apply to any repo skill that uses a mapped name, 4.6 S1), a `sign-in-again.spec.ts:143` failure (reproduced: 2 of 20 with `--repeat-each=20 --retries=0`), a provenance check that can't see a stale index line or an unindexed new Log entry (it missed 3.10 F7), 4.14's unused bmad-loop pin and resolver, Log entries with no Open items line, and files over 600 lines, duplicates and dead exports in the epic's diff.

**Approach:** Fix the two bugs (label trust, the spec race), extend the provenance check, remove bmad-loop, bring `deferred-work.md` up to date, and apply mechanical cleanups with no other behaviour change.

**Decisions (planning, autonomous, from the brief and the entry):**
- Label trust: a mapped skill gets its label, group, `next` and may be the entry action only when its installed folder's content equals the verified pinned copy's folder for that name (same rule as 4.14's content hash: regular files only, LF-normalised, sorted paths). With no verified copy on disk (not downloaded), nothing is labelled (fail closed). Agent labels derive from skill labels, so they follow. A genuine but older upstream skill is unlabelled too (shows its `SKILL.md` description, still startable, Plan shows the reduced-mode notice); Upgrade does not replace it, which is the 4.11 deferred question, kept deferred.
- Sign-in spec: the cause is a test race, not a product bug. Core appends the resent user message (`completeMessage`) before setting the session `working` (`core/src/chat/turns.ts` `sendMessage`), so the page briefly shows `['context','context']` with the previous turn's `error`; the test's `data-state=error` check matches that stale state and `staysSent` then sees `working`. The spec waits for the resend's own turn (it saw `working`, then `error`). The product order stays (changing it would change the event order every client reads).
- Provenance: "added on the branch" = Log summaries not in the deferred-work.md of a base revision: `PROVENANCE_BASE`, else `origin/$GITHUB_BASE_REF` in CI, else the branch's upstream; with no base the check says so and skips only that rule.
- bmad-loop: removed (lock entry, schema key, resolver, export, tests, fake-uv `install` mode, docs); epic 5's three bmad-loop deferrals are resolved as moot, and S4 (one source instance per name) stays open for bmad-method.

## Boundaries & Constraints

**Always:** Shapes and texts stay in `packages/shared`, re-exported under the same names (split files are re-exported, package export lists unchanged). Verified-copy reads: disk only, no network on any GET, bounded (entries and bytes), never follow a link, never throw for the repo's state. No em/en dashes in user text.

**Never:** No behaviour change beyond the two bugs and the removal. No new dependency, route or event. No change to `tickets.py`, the lock's bmad-method pin, or the containment/segment helpers whose rules differ (recorded instead). Tests never run real `claude`, the keychain or the network, never read the real `~/.claude`; test hooks only via `testHooksAllowed`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error handling |
|---|---|---|---|
| Hostile skill | repo `.claude/skills/bmad-product-brief/SKILL.md` not the pinned copy; source downloaded | listed with its own description, no label/group/next; `entryAction` null; `plain_labels` false unless another verified skill is labelled | — |
| Verified skill | folder identical to the pinned copy (CRLF in repo ok) | label, group, next, entry action as today | — |
| Not downloaded | source has no verified copy | no labels, no entry action | — |
| Link or extra file in skill folder | symlink inside, or one file added/changed | not verified | — |
| Provenance: stale index | a `Resolved:` summary contains an index line's phrase | fails, names the line | — |
| Provenance: unindexed | Log entry new since base, not `Resolved:`, no index phrase in it, no `Resolved:` quoting it | fails | no base → note, rule skipped |

</frozen-after-approval>

## Code Map

- `packages/adapters/src/bmad-catalog/catalog.ts:145-198` -- `buildCatalog`, `hasPlainLabels`, `missingCapabilities` call `applyLabels`; `skills.ts:146-164` `scanSkillsAt` drops the folder it found (keep `InstalledSkill` public shape; return the folder internally); `labels.ts:141-162` `applyLabels` (gain a `verified: ReadonlySet<string>` of names); `index.ts:59-70` `createBmadCatalog` gets `options.source` (already wired, `server/src/start.ts:196-201`). Without a source the catalog is unverified: fail closed.
- `packages/adapters/src/bmad-source/index.ts:142` `readTree` (private, sync) and `archive.ts:57-71` `hashEntries`/`normalizeText` -- reuse for the folder hash; `PinnedSource.root`, `BmadSourcePort.status()`/`file()` (`core/src/bmad-source-port.ts:20-35`). Cache the pinned side per name (immutable per commit).
- `packages/core/src/planning-documents.ts:167-171` -- `next` comes from the catalog, fixed by the gate (test only).
- `packages/adapters/src/catalog-memory/index.ts` -- unchanged semantics. Tests: `packages/adapters/test/bmad-catalog-{labels,catalog,capabilities}.test.ts`; fixture `tests/fixtures/bmad-upstream/skills/` (add `bmad-product-brief` copy for the verified case).
- `tests/e2e/sign-in-again.spec.ts:143-162` -- wait for the resend's turn; `staysSent` :96.
- `scripts/check-provenance.mjs` (`parseDeferredWork`, `indexProblems`, `main`), `tests/provenance.test.ts`, `.github/workflows/ci.yml` job `provenance` (pass the base).
- bmad-loop: `packages/adapters/src/bmad-source/{bmad-loop.ts,bmad-lock.json,index.ts:3,290,lock.ts:2,archive.ts:33}`, `packages/shared/src/planning.ts:556-564` (`BmadLock` key, `buildConstraints` if unused), `packages/core/src/bmad-source-port.ts:5`, `packages/shared/src/toolchain.ts:5`, `packages/adapters/test/bmad-source.test.ts:269-345`, `tests/bmad-lock.test.ts`, `tests/fixtures/fake-uv.mjs:25-28,106`, `CONTRIBUTING.md`, `ci.yml:141`, `scripts/bmad-lock.mjs` (generic; JSDoc `buildConstraints`).
- Over 600 lines: `shared/src/planning.ts` 906 (new in epic 4), `server/src/start.ts` 741 (+149), `shared/src/events.ts` 622 (+83). Not epic 4's: `claude-code-agent.ts`, `install.ts`, `chat/terminal.ts` (stay in their index line).
- Dead (only their declaration): `PLAN_SKILLS_LABEL`, `PLAN_IDEA_UNAVAILABLE_TEXT`, `BOARD_TICKETS_LABEL`, `BMAD_SETUP_OWED_TEXT` (`shared/src/planning.ts`), `putEmpty` (`web/src/api/http.ts:76`); check tests first.
- Duplicates: no-follow open flags `bmad-catalog/skills.ts:42-44`, `document.ts:28-30`, `tickets-v7/folder-watch.ts:163`; `codeOfError` `tickets-v7/index.ts:132` = `codeOf` `folder-watch.ts:~184`; generic tar code in `bmad-source/archive.ts` imported by `toolchain-uv/archive.ts:11`.
- Naming: `core/src/bmad-features.ts` exports `readBmadPieces` (everything else says "piece").
- Board piece gate: confirmed done (server `planning-routes.ts:156,167,198` via `bmadPieceRoutes`; web `workspace-board-page.tsx:16-21` `PlanPieceGate piece="board"`). No change.
- `_bmad-output/initiative-ogden-agents/deferred-work.md` -- index lines for every open epic 4 Log entry; 3.10 F7 kept open, owned by 4.13 (its fix `1d845c2` is on `story/10.9-e2e-and-release`, not this chain; review Q2); `Resolved:` for 4.6 S1, the bmad-loop entries; the 4.11 Upgrade question indexed.

## Tasks & Acceptance

**Execution:**
- [x] `packages/adapters/src/bmad-catalog/{skills.ts,labels.ts,catalog.ts,index.ts}` (+ a small `verified.ts`) -- verified-only labels as Decisions; `createBmadCatalog` passes its source; export the folder hash from `bmad-source` (async, bounded, no-follow).
- [x] Tests -- adapter: hostile `bmad-product-brief` (no label, no entry action, `next` null, `plain_labels` false), identical copy (labelled; CRLF variant), not downloaded, symlink inside, extra file; core `planning-documents` gives no next step for the hostile skill; existing catalog tests pass a verified source.
- [x] `tests/e2e/sign-in-again.spec.ts` -- before the resend's checks, record `session-state` transitions (MutationObserver) and wait for `working` then `error`; no other spec change.
- [x] `scripts/check-provenance.mjs`, `tests/provenance.test.ts`, `ci.yml` -- the two rules (pure, exported), base resolution in `main`; tests: planted stale line, planted unindexed entry, closer quoting it, no base.
- [x] bmad-loop removal (Code Map list); `bmad-lock.mjs --check` keeps working on one source.
- [x] Splits: `shared/src/planning.ts` into siblings (`planning-catalog.ts`, `planning-board.ts`, `planning-setup.ts`, `planning-text.ts` or similar) re-exported from `planning.ts`; `server/src/start.ts` BMad wiring into `start-planning.ts`; `shared/src/events.ts` epic 4 events into `events-planning.ts`. Each under 600.
- [x] Dedupe: `adapters/src/fs-safe.ts` (open flags, `codeOf`); tar code to `adapters/src/archive/tar.ts`, re-exported from `bmad-source/archive.ts`; drop the dead exports; rename `core/src/bmad-features.ts` to `bmad-pieces.ts`.
- [x] `deferred-work.md` -- as Code Map; new entries for what this sweep leaves (containment and segment helpers' differing rules; `catalog-memory` naming; Upgrade leaves outdated genuine skills unlabelled, added to the 4.11 line).

**Acceptance Criteria:**
- Given a repo whose `bmad-product-brief` is not the pinned copy, when the catalog is read, then it has no Ogden label, group, next step or entry action.
- Given the tree, `node scripts/check-provenance.mjs` passes; with a planted stale index line or a planted unindexed Log entry it fails.
- Given the branch, no `bmad-loop` pin, resolver or export remains outside planning history.
- `pnpm exec playwright test tests/e2e/sign-in-again.spec.ts --repeat-each=20 --retries=0` passes 100 of 100; `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm run pack && pnpm smoke` pass.

## Implementation Notes

- Label trust: `bmad-catalog/verified.ts` (`createSkillVerifier`) compares each mapped skill's installed folder (the one `scanSkillFoldersAt` found it in; `scanSkillsAt` keeps its public shape) with `source.file('<name>/SKILL.md')`'s folder, both through `bmad-source/folder-hash.ts` `hashFolder` (async, `lstat` root, `O_NOFOLLOW|O_NONBLOCK` opens, at most 1000 entries and 8 MiB, `undefined` for a link, FIFO or anything else; `hashEntries`/`normalizeText` reused). The pinned side is cached per folder once hashed. `applyLabels` takes the verified set; a `next` is kept only when its target is installed and verified too (a verified skill never points at an unverified one). `createBmadCatalog` builds the verifier from `options.source`; it also accepts `{ source }` alone (no setup), which tests and `tests/support.ts` `stubSetupCatalog` use. Without a source (or not downloaded) nothing is labelled.
- Fixture: `tests/fixtures/bmad-upstream/skills/bmad-product-brief/` is the unchanged folder from the pinned commit (README updated). With it, the real-uv Upgrade test's `bmod` and `older` repos lack `plain_labels` before and have it after (Upgrade copies in the verified skill they lack); `tests/fixtures/bmad-plain` docs say the `bmod` repo now lacks both capabilities.
- Tests that relied on unverified labels now pass a verified copy: `bmad-catalog-catalog.test.ts` (a copy of the generated skills), `bmad-catalog-capabilities.test.ts` (the upstream fixture), server `planning-routes.test.ts` (`verifiedSkillsSource`), e2e `document-cards.spec.ts` and the real-catalog Plan home test (`tests/support.ts` `verifiedCopySource`, a memory source over a written copy). The first `plan-and-board.spec.ts` test (source not downloaded yet) now expects the skills' own descriptions on Plan: the fail-closed case in a browser.
- Sign-in spec: `recordStates` (a `MutationObserver` on the page, recording each `data-state` value of `session-state`) before Sign in, then `turnFailedSinceRecording` waits for `working` then `error`. 100/100 with `--repeat-each=20 --retries=0`.
- Provenance: `staleIndexProblems` and `unindexedProblems` (pure, exported), `baseCandidate` (env only); `main` falls back to `@{upstream}`, verifies the base is a commit, and reads its `deferred-work.md` (`''` if the base has none). `Resolved:` is the prefix that closes (a `Resolved (part …):` entry is partial: it keeps its index line and, when new, needs an index phrase); a closing quote is a `"…"` of at least 10 characters. CI passes `PROVENANCE_BASE=origin/<base_ref>` on pull requests.
- bmad-loop: lock entry, `buildConstraints`, `bmad-loop.ts`, its exports and tests, fake-uv `install` mode, CONTRIBUTING rows and the CI comment removed; `node scripts/bmad-lock.mjs --check` passes on the one source. Historical CHANGELOG lines and the adapters README's future `buildrunner-bmad-loop` adapter name are left.
- Splits: `shared/src/planning.ts` (19 lines) re-exports `planning-catalog.ts` (201), `planning-board.ts` (223), `planning-setup.ts` (208), `planning-text.ts` (292); the board texts use `boardColumnOf` instead of the private `COLUMN_OF_STATUS`, so no new export. `shared/src/events.ts` (580) re-exports epic 4's events from `events-planning.ts` (75). `server/src/start.ts` (591): BMad wiring in `start-planning.ts` (`createBmadSourceAndCatalog`, `createDocumentCards`, `createPlanAndBoard`, `bmadSetupFailureLogger`, `stopBmadWork`; `TICKETS_SCRIPT`, `uvWorkDir` re-exported). Export lists compared by name against `HEAD`: only the four dead texts are gone.
- Dedupe: `adapters/src/fs-safe.ts` (`NO_FOLLOW`, `NON_BLOCK`, `codeOf`); tar reader in `adapters/src/archive/tar.ts`, re-exported from `bmad-source/archive.ts`, imported by `toolchain-uv/archive.ts`; dead exports removed; `core/src/bmad-features.ts` renamed `bmad-pieces.ts`.

## Plan Change Log

- `server/src/start.ts` was 640 lines after moving the BMad wiring; its HTTP/WebSocket helpers (`listen`, `closeServer`, `broadcast`, `repointAppShortcut`, `HOST`) moved to `start-io.ts` (re-exported) to get under 600. Mechanical, no behaviour change.
- `bmad-source/archive.ts` must stay loadable by plain `node` (`scripts/bmad-lock.mjs`), so it imports `../archive/tar.ts` with the `.ts` extension; `tsconfig.base.json` gains `allowImportingTsExtensions` (every package is `noEmit`; web already had it).
- E2E specs other than the sign-in spec changed (`document-cards.spec.ts`, `plan-and-board.spec.ts`) because the label trust is fail-closed: their repos' fake skills were labelled only by name before.

## Review Triage Log

### Pass 1 (2026-10-03; lenses: quick, security)

Verdicts: high 1, medium 5, low 2, false 0, maybe-false 0 (quick Q1-Q5, security S1-S6; Q1 = S1, Q4 + Q5 = S5). No intent_gap or bad_plan.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| Q1+S1 | The pinned copy in `.agents/skills/<name>` is verified while Claude Code runs a hostile `.claude/skills/<name>`: label, group and entry action applied | high | patch | `scanSkillFoldersAt` keeps the first folder; reproduced by the security lens with the real catalog. Fix: a mapped name is verified only when every installed copy of it (each skills folder) is the pinned copy; test with both folders. |
| S2 | Another folder whose `SKILL.md` frontmatter `name` is a mapped name (folder name differs) is ignored, so a second skill of that name sits beside the verified one | medium | patch | `scanSkillFoldersAt` drops name/folder mismatches; Claude Code names skills by frontmatter. Fix: a mapped name claimed by any other folder's frontmatter is not verified; test. |
| Q4+Q5+S5 | Repo-side hashing is bounded only per folder: `readdir` lists a whole folder before the cap, and all mapped folders are hashed at once (measured ~235 MiB per read) | medium | patch | `folder-hash.ts` `walk`, `verified.ts` `Promise.all`. Fix: list with `opendir` and stop at the cap; bound the repo side by the pinned folder's own entry count and bytes (x2 for CRLF); hash one folder at a time. |
| Q2 | 3.10 F7's index line removed and a `Resolved:` entry added, though the fix (`1d845c2`, 10.9) is not on this branch | medium | patch | `git merge-base --is-ancestor 1d845c2 HEAD` fails; `stopOwnServer` unchanged. Fix: keep the item open in the index (owner 4.13, which integrates 10.9's fix) and drop the premature `Resolved:` entry; 10.9's branch should add it. |
| Q3 | CI comment says the new-entries rule is skipped on a push; it falls back to `@{upstream}` and passes trivially | low | patch | `check-provenance.mjs` `main`. Comment corrected. |
| S3 | A verified skill still runs repo-controlled `_bmad/scripts` and `_bmad/custom/<skill>.toml` steps, under Ogden's label | medium | defer | Same trust model as the project's BMad scripts (user decision 2026-10-02, trust once per project); widening the label trust to config needs a user decision. deferred-work.md. |
| S4 | Labels are judged on read, not at start; a repo changed after the page loads (or a race in the walk) still runs | low | defer | Needs a concurrent writer or a change between page load and click; same class as the logged TOCTOU entries. deferred-work.md. |
| S6 | The pinned-side hash cache never refreshes after a re-download | low | reject | Fails closed (genuine copies stay unlabelled until restart), needs a damaged first copy; the fix adds invalidation state. |

After the patches (2026-10-03): `pnpm typecheck`, `pnpm test` (1701 passed, 4 skipped), `pnpm e2e` (102 passed), `pnpm run pack && pnpm smoke` (OK), `node scripts/check-provenance.mjs` (pass, new Log entries against `origin/story/4.11-reduced-mode`); `sign-in-again.spec.ts --repeat-each=20 --retries=0` 100/100 (implementer twice, quick lens once).

## Design Notes

Reproduction before the fix (macOS, after `pnpm run build`): `playwright test tests/e2e/sign-in-again.spec.ts:143 --repeat-each=20 --retries=0` 18 passed, 2 failed, both at `staysSent` (`Expected "error", Received "working"`, line 100) with the user messages already `['context','context']`.

No epic 4 Review Triage Log row routes to 4.12; the mechanical candidates were patched in their own stories. Open epic 4 deferrals (TOCTOU, runner children, upstream `tickets.py`, user decisions) stay with their owners and get index lines.

Plan size ~2,300 tokens, over 1,600; kept whole: it is one sweep as the entry defines it.

## Verification

**Commands:**
- `pnpm typecheck && pnpm test` -- pass
- `pnpm e2e` -- pass; `pnpm exec playwright test tests/e2e/sign-in-again.spec.ts --repeat-each=20 --retries=0` -- 100/100
- `node scripts/check-provenance.mjs` -- pass
- `pnpm run pack && pnpm smoke` -- pass
