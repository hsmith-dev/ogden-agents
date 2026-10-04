---
title: 'Refactor sweep'
type: 'refactor'
ticket: '8'
created: '2026-10-01'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
baseline_revision: 'a3425187ece0e84d0fb1f094e49971edc13605bb'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 10 left follow-ups: a copied event-invalidation hook (10.3 F3), a new checkbox not yet reviewed against DESIGN.md (10.4), installed-suite fixture repos outside the teardown sweep (10.7 F7), source files grown past 600 lines, a flaky `sign-in-again.spec.ts`, and the epic 9/3 retro actions owned by 10.8 (provenance check with epic 3's baseline backfill; every `OGDEN_AGENTS_TEST_*` read behind `testHooksAllowed`, named in the "test hooks in use" line, enforced by a test).

**Approach:** Mechanical cleanup with no behaviour change, except two bugs: the sign-in code race found behind the flake, and the fixture-repo cleanup. Add a provenance script run in CI, and a static test that fails on any test-hook read that bypasses `testHooksAllowed`.

## Boundaries & Constraints

**Always:** Tests never run real claude, the keychain or the network, and never read the real `~/.claude`. Test hooks act only through `testHooksAllowed`. Splits are moves plus re-exports, so public import paths stay the same. Shared-doc edits (`deferred-work.md`, the epic file) only add to what is there, apart from the Open items index, which the doc's own header says to keep current. Folders are removed through the shared helpers' hooks (AGENTS.md pitfall).

**Never:** Change a route, event, schema, migration or user-facing text, except where the I/O matrix says so. Touch `core/src/chat/terminal.ts`, `claude-code-agent.ts` or `setup-claude-code/install.ts`, which stay deferred. Touch the `story/4.1-planning-tracer` branch. Retry-tune or skip the flaky spec instead of fixing its cause.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Code sent while sign-in starts | `submitCode` after `signIn` claimed its flight but before `port.signIn()` resolved | The code waits for the handle, then is delivered (204) | Start fails or is cancelled while waiting → `SignInNotPendingError` (409), as today |
| No sign-in | `submitCode` with no flight | 409 `sign_in_not_pending` | unchanged |
| Hook bypass | shipped source reads an `OGDEN_AGENTS_TEST_*` value outside a function that calls `testHooksAllowed` | the audit test fails and names the file | — |
| Check-in hook in use | `OGDEN_AGENTS_TEST_CHECK_IN_MS` honoured | the "test hooks in use" line includes `checkInMs` | not honoured → not in the line |
| Stale baseline | a plan with status in-progress, in-review, built or done whose `baseline_revision` is missing or not an ancestor of HEAD | `scripts/check-provenance.mjs` exits 1 and lists the plan | draft and ready-for-dev plans are exempt |
| Unmatched index line | a deferred-work Open items line whose `(log: "…")` phrase is missing or appears in no log entry | the script exits 1 and lists the line | — |

</frozen-after-approval>

## Code Map

- `packages/core/src/agent-setup.ts` (703 lines) -- `signIn`/`submitCode` (about l.638–685), `Flight` (l.184). Race: `signIn` announces `signing_in` before `await port.signIn()`, so the Settings card shows "Paste the code" while `flight.handle` is still undefined, and `submitCode` refuses with 409. CI evidence: run 36953739311 attempt 1, `sign-in-again.spec.ts:212`. The other tab's POST `/sign-in` was aborted by `other.goto` (status -1), and POST `/sign-in/code` returned 409 one second later. Over 600 lines and touched here, so it gets split (epic 9 retro A6).
- `packages/server/src/test-hooks.ts`, `start-env.ts` (`CHECK_IN_MS_ENV`, `SECRET_STORE_ENV`), `start.ts` l.236–260 (the hook resolution and the "test hooks in use" line) -- move the resolution into one `test-hooks.ts` function, which brings `start.ts` (624 lines) under 600.
- `packages/web/src/workspaces/bmad-detection-api.ts` `useDetectionInvalidation` and `workspace-settings-api.ts` `useSettingsInvalidation` (`workspace-api.ts` `useListInvalidation` too) -- the same seen-seq loop three times.
- `packages/web/src/ui/checkbox.tsx` -- mirrors `radio-group.tsx`'s `RadioGroupOption`. The focus ring is global (`theme.css :focus-visible`). It lacks `data-slot` on the Root. `settings/new-project-defaults.tsx` and `workspaces/bmad-method-section.tsx` each define `canTurnOn` and a Coming soon badge.
- `packages/core/src/permissions.ts` (692 lines; grew 649→692 in epic 10, with `getSettings`/`updateSettings` at l.632–682) -- 10.1 left moving settings to their own module to the sweep.
- `packages/shared/src/events.ts` (825 lines, grew in epic 10) and `packages/shared/test/contracts.test.ts` (359→645 lines).
- `tests/fixtures/fake-bmad-repo.ts` `createFakeBmadRepo`, `tests/fixtures/data-folder-0.2.0.ts` `createDataFolder020`, `tests/e2e-installed/installed.ts` `upgradeServer`/`extraFolder` -- repos go to the OS temp folder, not the swept extra folder.
- `.github/workflows/ci.yml` -- the lightweight jobs are the pattern (`uv pins`). Checkout is shallow by default.
- `_bmad-output/initiative-ogden-agents/deferred-work.md` -- Open items index (l.3–36), Log.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/core/src/agent-setup.ts` + `packages/core/test/agent-setup*.test.ts` -- `Flight` gains a promise that settles when the handle arrives or the start fails or stops. `submitCode` with a flight and no handle awaits it, then re-checks. Then split the file to under 600 lines: move the errors, types and interfaces into `agent-setup-types.ts`, re-exported. Add a test where the port's `signIn` is held: a code sent meanwhile is delivered once it resolves, and refused if the start fails or is cancelled.
- [ ] `tests/e2e/sign-in-again.spec.ts` -- keep the spec as is; the product fix is the cure. Prove it with `pnpm e2e tests/e2e/sign-in-again.spec.ts --repeat-each=20 --retries=0` (all pass) and record the counts in Implementation Notes.
- [ ] `packages/server/src/test-hooks.ts`, `start-env.ts`, `start.ts` -- one `resolveTestHooks(env, dataDir, options)` in `test-hooks.ts` returns every honoured hook. `start.ts` logs one line, which now includes `checkInMs` when the env delay is honoured. The env-name constants all live in `test-hooks.ts`; `start-env.ts` re-exports them so imports are unchanged. `start.ts` ends under 600 lines.
- [ ] `packages/server/test/test-hooks-audit.test.ts` (new) -- scans `packages/*/src/**` and `bin/` for `OGDEN_AGENTS_TEST_`. It fails when a literal is declared outside `test-hooks.ts`, or when an env read of a hook constant sits in a function that doesn't call `testHooksAllowed`. Include a self-test on an inline bad sample. Extend `test-hooks.test.ts` to assert `checkInMs` in the log line.
- [ ] `packages/web/src/events/use-event-invalidation.ts` (new) + the three API files -- one hook that takes a predicate over new events since the last seen seq and returns what to invalidate. All three callers use it.
- [ ] `packages/web/src/ui/checkbox.tsx` -- review against DESIGN.md and the `RadioGroupOption` conventions: tokens only, `data-slot="checkbox"` on the Root, keyboard and label association, disabled styling. Patch the gaps and keep the house pattern over stock shadcn (Phosphor icons, global focus ring). Add a DOM test: Space toggles, the label click toggles, and the accessible name and description are set. Share `canTurnOn` and the Coming soon badge between the two BMad UIs only where the semantics match.
- [ ] `packages/core/src/workspace-settings.ts` (new), `permissions.ts` -- move `getSettings`/`updateSettings` into a factory that `createPermissions` delegates to. Move the pure path and command helpers if that is needed to get under 600; `permissions.ts` re-exports them.
- [ ] `packages/shared/src/events.ts` -- split the event schemas by area into sibling modules, re-exported unchanged, so it ends under 600. `packages/shared/test/contracts.test.ts` -- move the BMad contracts to `bmad-contracts.test.ts`.
- [ ] `tests/fixtures/fake-bmad-repo.ts`, `data-folder-0.2.0.ts`, `tests/e2e-installed/installed.ts` -- add an optional `parent` folder (default: OS temp). `upgradeServer` puts the repos under `extraFolder`.
- [ ] `scripts/check-provenance.mjs` (new), `package.json` (`provenance` script), `.github/workflows/ci.yml` (job `Provenance`, `fetch-depth: 0`), `tests/provenance.test.ts` (the pure parsing and matching on fixture text, no git) -- the check in the I/O matrix.
- [ ] Plans -- backfill `baseline_revision` with full SHAs: the parent of each story's first commit for 3.1, 3.2, 3.11, 3.6, 3.3, 3.4, 3.5, 3.7, 3.8, 3.9, 1.5 (design direction) and 10.1. `node scripts/check-provenance.mjs` passes.
- [ ] `deferred-work.md` -- explain the `(log: "…")` convention in the header and add a phrase to every index line. Add Resolved log entries and remove the index lines for: the provenance check, CHECK_IN_MS, and the split of `agent-setup.ts`, `permissions.ts` and `events.ts`. Add new entries for 10.4 F3's pre-existing `onboarding.ts` repeated-log gap (Unowned, a sweep).
- [ ] Epic file Notes -- record the orchestrator's accept-as-default decisions from 10.7, dated 2026-10-01.
- [ ] Epic 10 diff (`042e553..HEAD`) -- scan for duplication, dead exports, naming drift and stale comments. Make mechanical fixes only and list each in Implementation Notes.

**Acceptance Criteria:**
- Given the branch, when `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm run pack && pnpm smoke` and `node scripts/check-provenance.mjs` run, then all pass with no change to any test's expected user-visible behaviour.
- Given `wc -l` on every file the epic grew, plus `agent-setup.ts`, then none is over 600 lines.

## Implementation Notes

- Sign-in race: `Flight` gains `started`/`settle` (settled when the handle arrives, the start fails, or the flight is stopped); `submitCode` with a flight and no handle awaits it, then re-checks that the same flight is still current and not stopped, else 409 as before. New `packages/core/test/agent-setup-sign-in-race.test.ts` (held port: delivered after resolve; refused on start failure; refused on cancel even if the start then resolves; no flight refused at once).
- `sign-in-again.spec.ts` unchanged. `pnpm exec playwright test tests/e2e/sign-in-again.spec.ts --repeat-each=20 --retries=0`: **100 passed, 0 failed** (3.8 min, macOS, after `pnpm run build`).
- Splits (moves plus re-exports; export lists of `@ogden-agents/shared`, `@ogden-agents/core`, `server/src/start.ts`, `start-env.ts` and `server/src/index.ts` compared key by key against `a342518`: none added or removed; every shared zod schema's definition identical):
  - `core/src/agent-setup.ts` 703 → 587: errors, constants, interfaces into `agent-setup-types.ts` (named re-export; the internal `Flight`, `newFlight`, `SavedKey` live there but are not re-exported).
  - `core/src/permissions.ts` 692 → 405: `getSettings`/`updateSettings` into `workspace-settings.ts` (`createWorkspaceSettings`, spread into `createPermissions`; `readCautionLevel` shared); the pure scope/matching/protected-path helpers into `permission-matching.ts` (`export *` from `permissions.ts`).
  - `shared/src/events.ts` 825 → 539: `events-common.ts` (Seq, streams, page sizes, shared enums; `export *`), `events-session.ts` (session and permission events; named re-export so the `*Input` schemas stay internal), `events-envelope.ts` (internal `assigned`/stream fields, not re-exported).
  - `server/src/start.ts` 624 → 592: hook resolution into `test-hooks.ts` `resolveTestHooks` + `testHooksLogFields`; that alone left 613, so the port-file helpers moved to `port-file.ts` too (see Plan Change Log).
  - `shared/test/contracts.test.ts` 645 → 370; BMad contracts in `bmad-contracts.test.ts` (301); 34 `it`s before, 17 + 17 after.
- Test hooks: every `OGDEN_AGENTS_TEST_*` constant now in `test-hooks.ts` (`CHECK_IN_MS_ENV`, `SECRET_STORE_ENV`, `checkInDelayFromEnv`, `testSecretStore` moved from `start-env.ts`, re-exported there). The line names `checkInMs` (the clamped value) only when honoured; the memory secret store stays on its own line (Design Notes). `test-hooks-audit.test.ts` scans `packages/*/src` and `bin/` with comments stripped; self-tests on inline samples (literal outside, ungated read, imported alias, commented mention).
- `useEventInvalidation(keysFor)` in `web/src/events/use-event-invalidation.ts`; the detection, settings and list invalidations use it (keys deduped per batch, mapping held in a ref so the effect deps stay `[events, queryClient]`).
- Checkbox review: added `data-slot="checkbox"` on the Root, and the label dims to 50% with `not-allowed` cursor when disabled (DESIGN.md: disabled at 50%); tokens, Phosphor `Check` and global focus ring kept. `canTurnOn` semantics match in both UIs (piece off: it and every need not on must ship), so one `canTurnOnBmadPiece` and `ComingSoonBadge` in `web/src/workspaces/bmad-piece-choice.tsx`; each UI keeps a thin adapter for its availability shape (`new-project-defaults.tsx` still exports `canTurnOn`, tested). `missingNeeds` stays in the section (it drives the "Needs …" text).
- Fixtures: `createFakeBmadRepo` and `createDataFolder020` take `parent` (default OS temp); `upgradeServer` passes `extraFolder(`${name}-repos`)`, so repos and the migrations scratch folder are inside the swept extra folder.
- Provenance: `scripts/check-provenance.mjs`, `pnpm provenance`, CI job `provenance` (`fetch-depth: 0`), `tests/provenance.test.ts`. Backfilled (parent of first story commit): 3.1 `9d6924e8`, 3.2 `bc20615b`, 3.3 `3e497ad8`, 3.4 `a7e42047`, 3.5 `6aad6cfa`, 3.6 `50d78595`, 3.7 `55145691`, 3.8 `abec6afb` (first commit `6c7dd2e`; `172a621` mentions 3.8 but is tagged story 3.1), 3.9 `3894c392`, 3.11 `634b9a61`, 1.5 `f01e14ce`, 10.1 `042e553c` (full SHAs in the plans).
- deferred-work.md: header explains `(log: "…")`; every index line has a phrase; index lines for the provenance check and CHECK_IN_MS removed; the 600-line split lines edited to drop agent-setup/permissions/events; three Resolved entries and the 10.4 F3 `onboarding.ts` entry (Unowned, a sweep) appended. Epic Notes record the 10.7 accept-as-default decisions.
- Epic 10 diff scan (`042e553..HEAD`), mechanical fixes: `api.ts` route comments no longer say the 10.3/10.4 routes are 501 stubs to be filled; `catalog-memory` header no longer says the server wires it until 10.3; `bmad-features.ts` points to `workspace-settings.ts` for `updateSettings`. Reviewed and left: exported option/props types and `fetch*` helpers used only in their own file follow the house pattern; no other duplication found beyond the items above.
- `wc -l`: no source or test file the epic grew is over 600; only `pnpm-lock.yaml` and `tests/fixtures/data-folder-0.2.0/rows.json` (data) are.

## Plan Change Log

- `start.ts`: moving the hook resolution brought it to 613, not under 600, so `writePortFile`/`removePortFile` moved to `server/src/port-file.ts` (internal, never exported).
- Checkbox DOM test: happy-dom doesn't turn Space into a click on a button, so the test checks the Root is a `type="button"` element, that Space's keydown is not prevented (the browser activates it) and Enter's is, then that the click toggles. A real Space press isn't simulated.
- The race test is a new file (`agent-setup-sign-in-race.test.ts`) rather than an addition to `agent-setup.test.ts` (910 lines).

## Review Triage Log

### Pass 1 (quick lens) — high 0, medium 0, low 5, false 0, maybe-false 0

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1a | Audit misses a namespace import (`h.X`), an alias re-exported in one file and read in another, and a plain copy (`const k = X; env[k]`) | low | patch | True: the scan matched `[NAME]` against per-file names only. No shipped code does any of these today. Patched: outside `test-hooks.ts`, any reference to a hook name or alias except in import or re-export statements fails, and so does `import * as` from test-hooks; aliases are collected across files; each bypass has a self-test. |
| 1b | The gate check is textual: `testHooksAllowed(` anywhere in the function passes even if its result doesn't gate the read; an expression-bodied arrow is checked against its outer function | low | reject | True, but reads are now confined to `test-hooks.ts`, whose readers all return early on `!testHooksAllowed(...)`. Closing it fully needs a real parser (TypeScript 7 has no JS API), which is complexity for an unlikely case. |
| 2 | Checkbox DOM test title says "Space toggles it", but no Space press changes `aria-checked` | low | patch | True: happy-dom doesn't turn Space into a click. Retitled to say what it checks (a native button: Space left to the browser, Enter blocked, a click toggles). |
| 3 | New `onboarding.ts` index line lacks the period before `(log: "…")` | low | patch | True. Fixed. |
| 4 | Implementation Notes line counts are off by one (`permissions.ts` 405, `start.ts` 592) | low | patch | True (`wc -l`). Corrected; both are under 600. |

## Design Notes

Accept-as-default decisions (orchestrator, from 10.7): an "existing user" is a data folder with projects, so a 0.2.0 install with no projects is asked Welcome's first-project question once. `@types/better-sqlite3` as a root devDependency is fine.

Secret-store memory mode keeps its own "secrets store" log line and is not added to "test hooks in use", because every vitest server sets it and the smoke reads that line.

The index convention replaces fuzzy matching: an index line ends `(log: "<verbatim phrase from its entry's summary>")`. Log entries are append-only, so the phrase never goes stale.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: all pass
- `pnpm e2e` -- expected: all pass
- `pnpm run build && pnpm exec playwright test tests/e2e/sign-in-again.spec.ts --repeat-each=20 --retries=0` -- expected: 100/100 pass
- `pnpm run pack && pnpm smoke` -- expected: pass
- `node scripts/check-provenance.mjs` -- expected: exit 0
