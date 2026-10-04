---
title: 'End-to-end suite and release (epic 4, 0.4.0)'
type: 'feature'
ticket: '13'
created: '2026-10-03'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'security']
review_loop_iteration: 0
baseline_revision: '834ffe5d0bf38e1051c941c7736771083990a2e7'
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 0.4.0 is one release of epic 10, epic 4 and the per-chat permission modes (user, 2026-10-02), but the three live on separate branches; the installed-package suite still expects Planning and Board as "Coming soon", never sets BMad up, plans, or uses the board, and has no permission-modes journey; and the provenance check, made stricter in 4.12, fails against `main` on Log entries that have no index line.

**Approach:** Merge (no rebase) `origin/story/10.9-e2e-and-release` then `origin/story/permission-modes` into this chain, keeping every intent; extend the installed suite (three OSes, packed package, fake agent, local fixture BMad tarball) for epic 4 and permission modes; fix the provenance index against `main`; finish the release prep (`0.4.0-rc.1`, one CHANGELOG 0.4.0 entry, RELEASING live checks). The user runs the live checks and tags.

**Decisions (autonomous, from the brief, the entry and the epic 10 retro A3):**
- Merge order 10.9 then permission-modes (`--no-ff`). Migrations stay uniquely numbered in merge order: this chain's `0006_bmad_scripts_trusted` and `0007_bmad_modules_seen` keep their numbers; permission-modes' `0006_permission_modes` becomes `0008_permission_modes` (journal entry, snapshot `0008` chained from `0007`'s id, holding both lines' tables). The 0.2.0-upgrade tests (core and server) pass through all of them. `deferred-work.md`, CHANGELOG, `.memlog.md` and shared contracts take the union.
- No hook exists for a BMad tarball in the installed package (only server-test options). One is added, `OGDEN_AGENTS_TEST_BMAD_SOURCE`, following `OGDEN_AGENTS_TEST_CLAUDE_INSTALL`: an absolute path to a JSON file inside temp `{ lock, tarball, uvEnv }`; honoured only when `testHooksAllowed`, with the file and the tarball inside temp; the lock is parsed with the shared `BmadLock` schema; the server's one BMad source then uses that lock and reads the tarball from disk (no `fetch`); `uvEnv` adds only an allowlisted set of `UV_*` and proxy variables to uv children (so uv finds the CI-provisioned Python, never downloads one, and any network attempt hits a refused port). Declared and audited like every other hook.
- The installed suite's BMad steps need real `uv` and a uv-managed Python 3.12: the `e2e-installed` CI job provisions them as the `test` job does (setup-uv, `uv python install 3.12`); locally the epic 4 journey skips when either is missing outside CI (same rule as `realUvMissing`).
- The board live update is an agent write: the fake agent gains `write-file <relpath> <base64>` (inside the session cwd only, as `write-doc`).
- Proofs, local and not committed: the suite fails with (a) the AD-22 guard (`requireBmadFeature`) made a no-op, (b) the trust gate removed, (c) the `ticket.changed` emit removed.

## Boundaries & Constraints

**Always:** Tests never run real `claude`, the keychain or the network, and never read the real `~/.claude` (temp home per server). Test hooks act only through `testHooksAllowed`. Every server the suite starts is quit or killed with its tree and every folder removed. Shared shapes and user texts stay in `packages/shared` (spec constants imported, not retyped). No em/en dashes in user text.

**Never:** Merge `story/6.x` branches or `docs/epic-10-retro`. Rebase the merged branches. Change product behaviour except the new test hook and a real bug found by the suite (fixed with a regression test). Commit the proofs. Merge to main, tag, publish, or delete branches.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error handling |
|---|---|---|---|
| Shipped pieces | installed, no hooks | Planning and Board switchable; only Unattended builds and Retrospectives "Coming soon"; Welcome/New projects offer BMad Method | — |
| BMad off | project added with every piece off | header Chats only; no Plan/Board, `g p`/`g b` do nothing; no `_bmad/` written | — |
| Setup | empty repo, turn Planning on | setup steps, "Ready to plan."; `_bmad/` present; source from the fixture tarball | tarball hash mismatch → plain error (unit test) |
| Trust | turn Board on | trust dialog; Cancel leaves Board off; Allow turns it on | trust gate removed → suite fails |
| Planning | Start from an idea | planning session, fake agent answers the invocation; `write-doc` into the output folder → document card with Open and the next step | — |
| Board live | agent `write-file` of a plan with `status: ready-for-dev` | card moves to Ready within seconds | emit removed → suite fails |
| Status | Move to Ready from card menu; a Done ticket → Reopen confirm | lands in the plan file; reopen only after confirm | — |
| Module | module copied in while running | appears on Plan with New | — |
| Reduced | plain-upstream repo, Planning on | reduced-mode notice with Upgrade this project | — |
| Modes | chat; Developer mode off/on | Skip all only in Developer mode, confirm, red banner; Auto: `permission-edit .git/config` shows a card, `src/a.ts` does not | — |

</frozen-after-approval>

## Code Map

- Merges: conflicts expected (merge-tree): 10.9 → `CHANGELOG.md`, `deferred-work.md`; permission-modes → also `.memlog.md`, `packages/core/drizzle/meta/{0006_snapshot.json,_journal.json}`, `core/src/{chat/types.ts,core.ts,db/schema.ts}`, `server/src/app.ts`, `server/test/helpers.ts`, `shared/src/events.ts` (4.12 split epic 4 events into `events-planning.ts`; PM edits `events-common.ts`/`events-session.ts`), `web/src/routes/session-page.tsx`. PM's `server/src/start.ts` edits must land in 4.12's split (`start.ts`, `start-planning.ts`, `start-io.ts`). 10.9's fix for 3.10 F7 (`1d845c2`) closes that index line: add its `Resolved:` entry.
- Migrations: `packages/core/drizzle/0006_bmad_scripts_trusted.sql`, `0007_bmad_modules_seen.sql`, PM `0006_permission_modes.sql` → rename `0008_…`; tests `packages/core/test/upgrade-0.2.0.test.ts`, `packages/server/test/upgrade-0.2.0.test.ts`.
- Hook: `packages/server/src/test-hooks.ts` (pattern `testClaudeInstall`, `TestHooks`, `resolveTestHooks`, `testHooksLogFields`); `server/src/start-planning.ts` `createBmadSourceAndCatalog` (`createUpstreamBmadSource({ dataDir, lock, fetch })`); `server/src/start.ts:239` `uvChildEnv` (`options.extraUvEnv`); audit `packages/server/test/test-hooks-audit.test.ts`; unit tests beside the others in `packages/server/test/test-hooks*.test.ts`. Fixture tarball/lock: `packages/server/test/helpers.ts` `fixtureUpstream` (uses `tests/fixtures/tar.ts` `repoTarGz` and `bmad-source/archive.ts` `hashEntries`, `selectVerified`, `parseTar`, `gunzipLimited`).
- Fake agent: `tests/fixtures/fake-acp-agent.mjs` `write-doc` (l.382) is the pattern for `write-file`.
- Installed suite: `tests/e2e-installed/installed.ts` (10.9's `bmadServer`; add the fixture-source and uv env), `bmad-journey.spec.ts` ("nothing shipped" step → unshipped pieces only; Board trust check), `onboarding-journey.spec.ts` (greyed BMad Method check → enabled), `playwright.config.ts` (add projects `planning` and `modes` after `bmad`, before `upgrade`). New `planning-journey.spec.ts` and `permission-modes-journey.spec.ts`. Mirror dev specs `tests/e2e/plan-and-board.spec.ts`, `document-cards.spec.ts`, `permission-modes.spec.ts` (selectors, shared constants).
- CI: `.github/workflows/ci.yml` job `e2e-installed` (add setup-uv and Python steps as in job `test` l.44-56).
- Provenance: `scripts/check-provenance.mjs`, `_bmad-output/initiative-ogden-agents/deferred-work.md`; run with `PROVENANCE_BASE=origin/main`.
- Release: `package.json`, `packages/{server,web}/package.json` (`0.4.0-rc.1` from 10.9), `CHANGELOG.md`, `RELEASING.md`.

## Tasks & Acceptance

**Execution:**
- [x] Merge 10.9 (`--no-ff`), resolve, commit; merge permission-modes, resolve (migration renumber, union of contracts), commit. `pnpm typecheck && pnpm test` green after each.
- [x] `test-hooks.ts`, `start-planning.ts`, `start.ts` -- `OGDEN_AGENTS_TEST_BMAD_SOURCE` as Decisions; unit tests (honoured, ignored when not allowed or outside temp, bad lock throws, uvEnv keys outside the allowlist dropped); audit passes.
- [x] `fake-acp-agent.mjs` -- `write-file <relpath> <base64>`.
- [x] `installed.ts` -- fixture BMad source (tarball + lock + uvEnv JSON in the server's temp) for `bmadServer`; uv/Python availability check.
- [x] `bmad-journey.spec.ts`, `onboarding-journey.spec.ts` -- shipped Planning/Board; only unshipped pieces Coming soon; Board on → trust dialog (A3).
- [x] `planning-journey.spec.ts` -- matrix rows BMad off, Setup, Trust, Planning, Board live, Status (incl. reopen confirm), Module, Reduced; repo hashes where nothing may be written.
- [x] `permission-modes-journey.spec.ts` -- matrix row Modes (Developer mode through Settings).
- [x] `playwright.config.ts`, `ci.yml` -- projects and uv provisioning.
- [x] `deferred-work.md` -- index lines or `Resolved:` entries so `PROVENANCE_BASE=origin/main pnpm provenance` passes; 3.10 F7 resolved.
- [x] `CHANGELOG.md`, `RELEASING.md` -- one 0.4.0 entry (epic 10 + epic 4 + permission modes); a 0.4.0 checklist listing the live checks on `npx ogden-agents@next`: epic 4 tracer (idea to ticketed epic with real Claude Code), 10.1, permission modes (Skip all banner, Auto protected-path card with real Claude Code), BMad setup download on a real network.
- [x] Proofs (local, not committed): guard no-op, trust gate removed, `ticket.changed` emit removed: each fails the suite; restore and repack.

**Acceptance Criteria:**
- Given the packed tarball, when `pnpm e2e:installed` runs on macOS, Windows and Linux in CI, then every project passes with no process or folder left.
- Given any of the three proofs, when the affected project runs, then it fails at the named check.
- Given the branch, when `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs` and the CI base run, then both pass.
- `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm run pack && pnpm smoke` pass.
- Live checks (hitl): each result is written under "Live check result" here before the ticket moves to done.

## Implementation Notes

- Implemented directly in this session (no implementation subagent), after the plan.
- Merges (`--no-ff`, no rebase): `7362a74` merges `origin/story/10.9-e2e-and-release` (a41f72b): CHANGELOG and `deferred-work.md` conflicts, both sides kept; the 3.10 F7 index line closed by a `Resolved:` entry (10.9's `killProcessTree`, `1d845c2`), 10.9 F5 indexed. `34fbd98` merges `origin/story/permission-modes` (beff41e): conflicts in `.memlog.md`, `deferred-work.md`, drizzle meta, `core/src/{chat/types.ts,core.ts,db/schema.ts}`, `server/src/app.ts`, `server/test/helpers.ts`, `shared/src/events.ts`, `web/src/routes/session-page.tsx`, all resolved as unions (both imports, both core use-cases, both route registrations, both events). Permission modes' `0006_permission_modes` regenerated with `drizzle-kit generate` as `0008_permission_modes` (identical SQL; snapshot chained from `0007`; journal `when` after 0007's); this chain's 0006 and 0007 kept. Two test stubs gained the merged required fields (`skillInvocation`, `permissionMode`). Its two deferrals indexed.
- Hook `OGDEN_AGENTS_TEST_BMAD_SOURCE` (`server/src/test-hooks.ts` `testBmadSource`, `TestHooks.bmadSource`, log field): the JSON file is read first (unreadable throws), then honoured only inside temp; the lock parses with `BmadLock`; the tarball is checked by its real path inside temp; `uvEnv` keeps only `BMAD_SOURCE_UV_ENV_NAMES`. Not read when `start()` is given `bmadSource` or `bmadFetch`. `start-planning.ts` `createBmadSourceAndCatalog(…, testSource)` passes its lock and a `fetch` that reads the file; `start.ts` adds `uvEnv` to uv children before `extraUvEnv`. Unit tests in `server/test/test-hooks.test.ts` (incl. a real download from the fixture tarball, and a cut tarball refused).
- Installed suite: `installed.ts` `bmadServer({ bmadSource: true })` writes the upstream fixture plus test-only `bmad-spec/SKILL.md` and `bmad-ticket/SKILL.md` (so the spec card offers "Turn this spec into tickets") as a tarball, a lock over its hash, and uv's variables (own cache, `UV_PYTHON=3.12`, only-managed, no downloads, `UV_OFFLINE=1`, the managed Python dir from `uv python dir --color never`, proxies at 127.0.0.1:9). `uvReady()` skips the planning journey outside CI when uv or its Python is missing; CI's `e2e-installed` job now provisions both (setup-uv, `uv python install 3.12`) as the `test` job does.
- `planning-journey.spec.ts` covers every matrix row except Modes, which is `permission-modes-journey.spec.ts`; playwright projects `planning` and `modes` run after `bmad`, before `upgrade`. The fake agent gained `write-file <relpath> <base64>`. The tree's 1.1 starts in progress because `review` counts as a met prerequisite (`board-model.ts` `MET_STATES`). Upgrade this project asks to confirm (`Upgrade this project?`). A failing run prints the server's warn/error log lines (codes only).
- 10.9's specs: `bmad-journey.spec.ts` test 1 now checks what 0.4.0 ships (Planning and Board enabled, Unattended builds and Retrospectives Coming soon, main switch and New projects' BMad Method enabled) and that turning Board on asks for the trust (Cancel); `onboarding-journey.spec.ts` checks Welcome's BMad Method is available.
- Provenance: against `origin/main` 43 Log entries had no index line; each was closed earlier by an unquoting `Resolved:` entry, is a partial close or note, or is superseded by an indexed entry (checked in the tree), so one backfill `Resolved:` entry quotes each with its reason. `PROVENANCE_BASE=origin/main` and the CI base both pass. The over-600 index line names `shared/src/events.ts` (603) and `web/src/routes/session-page.tsx` (605) after the merge.
- Release: version stays `0.4.0-rc.1` (from 10.9); CHANGELOG has one 0.4.0 entry (epic 10, epic 4, permission modes; the bmad-loop mention dropped, 4.12 removed it); RELEASING's "0.4.0 release checklist" lists the merge order (#59 and #63 come in through 4.13) and 13 live checks on `npx ogden-agents@next`.
- Proofs (2026-10-03, macOS, local, not committed; each file restored with `git checkout` and the tarball repacked): (a) AD-22 guard, `requireBmadFeature`'s check made a no-op: `--project bmad --project planning` fails at `bmad-journey.spec.ts:297` (expected 409 `feature_off` from the guarded probe, received 200). (b) Trust gate, `requireScriptsTrusted`'s check made a no-op: `--project planning` fails at `planning-journey.spec.ts:309` (expected `scripts_not_trusted`, received `reduced_mode`: the board route ran on). (c) The `ticket.changed` append in `core/src/ticket-watcher.ts` removed: `--project planning` fails at the live move (card 1.2 stays `draft`, expected `ready`).
- Local runs (macOS): `pnpm typecheck`; `pnpm test` 137 files, 1781 passed, 4 skipped; `pnpm e2e` 103 passed; `pnpm run pack && pnpm smoke` OK; `pnpm e2e:installed` 41 passed (45 s); provenance both bases.

## Plan Change Log

## Review Triage Log

### Pass 1 (2026-10-03; lenses: quick, security)

Verdicts: high 1, medium 3, low 5, false 1, maybe-false 0 (quick Q1-Q9, security S1; the security lens found nothing else at AD-15, AD-16, AD-22, the trust gate, mode enforcement for planning sessions, the migrations or the new hook). No intent_gap or bad_plan.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| S1 | `_bmad/` isn't a protected path: an edit a caution level or Auto allows without a card can plant `_bmad/scripts/config_utils.py`, which the Board's watcher then runs via `tickets.py` | high | defer | Real (`PROTECTED_PATHS`, caution shortcut, watcher rerun), but present on the epic 4 chain with caution levels alone (Auto adds a second way in) and in the project-trust model the user decided (4.1 S2, 4.12 S3); the fix is a security policy choice (protect `_bmad` and show a card on every write there, or re-check the script after trust). deferred-work.md with an index line; in the PR's Needs you. |
| Q1 | Nothing checks BMad Method came from the fixture; a silent fallback to GitHub would pass in CI | medium | patch | The hook returns `undefined` outside temp, and Node's `fetch` isn't proxied. The journey now checks the "test hooks in use" line has `bmadSource: true` and `GET /bmad/source` names the fixture commit. |
| Q2 | The hash-mismatch unit test fails at gunzip, never the hash, and checks no plain error | medium | patch | A tarball with one extra file and the original lock: refused with `bmad_download_failed`/`integrity`, the plain message, and `expected …, got …` detail. |
| Q3 | BMad-off step has no server-side refusal, so the guard proof can't fail the planning project | low | patch | Added `GET catalog` → 409 `feature_off` on the off project. `g p` from Plan is trivially a no-op; `g b` stays the check. |
| Q4 | Proof results not recorded, tasks unticked | false | reject | The reviewer read an earlier HEAD: Implementation Notes record all three proofs (commit after launch). Task boxes ticked. |
| Q5 | `installed.ts` copies `UPSTREAM_FIXTURE`, `FIXTURE_COMMIT`, the lock and the Python probe from `server/test/helpers.ts` | medium | patch | Moved into `tests/fixtures/bmad-upstream-source.ts` (plain Node: `fixtureSource`, `hasManagedPython`, `realUvMissing`, `TEST_PYTHON`), used by both. |
| Q6 | The merge put permission modes' settings event back into `shared/src/events.ts` (603 lines) | low | patch | Moved to `events-settings.ts`, re-exported; `events.ts` 592. `session-page.tsx` (605) stays in the over-600 index line. |
| Q7 | Two backfill quotes are generic (`` `tests/launcher.test.ts` ``, "Resolved (story 9.3):") and would close future entries | low | patch | Longer, specific quotes; provenance passes on both bases. |
| Q8 | "the hook stays exercised" is untrue: `planning,board` are shipped | low | patch | Test 2 registers `builds` and checks its switch is enabled and not Coming soon. |
| W1 | CI run 37179473869, windows-latest installed: the modes journey's `say` counted replies before the chat reloaded after Settings (expected 1, received 5) | medium | patch | Test race on a slow runner: `developerMode` now waits for the conversation's earlier replies before returning. Planning journey passed there (54 s). |
| Q9 | CI comment stale (says no uv download) and run on | low | patch | Rewritten. |

After the patches (2026-10-03, macOS): `pnpm typecheck`; `pnpm test` 1781 passed, 4 skipped (after removing a stray `packages/node_modules` a local `npx vitest` left); `pnpm run pack && pnpm smoke` OK; `pnpm e2e:installed` 41 passed; provenance against `origin/main` and `origin/story/4.12-epic4-sweep`.

## Design Notes

Plan ~2,100 tokens, over 1,600: kept whole, the entry defines one release story (integration, suite, release prep), autonomous run.

Live check result: pending (the user runs RELEASING.md's 0.4.0 checks on `npx ogden-agents@next` after tagging `v0.4.0-rc.1`).

## Verification

**Commands:**
- `pnpm typecheck && pnpm test` -- green
- `pnpm e2e` -- green
- `pnpm run pack && pnpm smoke && pnpm e2e:installed` -- green on macOS
- `PROVENANCE_BASE=origin/main pnpm provenance` -- pass
- CI on the draft PR -- every job green on all three OSes
