---
title: 'End-to-end suite and release (epic 4, 0.4.0)'
type: 'feature'
ticket: '13'
created: '2026-10-03'
status: 'ready-for-dev'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
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
- [ ] Merge 10.9 (`--no-ff`), resolve, commit; merge permission-modes, resolve (migration renumber, union of contracts), commit. `pnpm typecheck && pnpm test` green after each.
- [ ] `test-hooks.ts`, `start-planning.ts`, `start.ts` -- `OGDEN_AGENTS_TEST_BMAD_SOURCE` as Decisions; unit tests (honoured, ignored when not allowed or outside temp, bad lock throws, uvEnv keys outside the allowlist dropped); audit passes.
- [ ] `fake-acp-agent.mjs` -- `write-file <relpath> <base64>`.
- [ ] `installed.ts` -- fixture BMad source (tarball + lock + uvEnv JSON in the server's temp) for `bmadServer`; uv/Python availability check.
- [ ] `bmad-journey.spec.ts`, `onboarding-journey.spec.ts` -- shipped Planning/Board; only unshipped pieces Coming soon; Board on → trust dialog (A3).
- [ ] `planning-journey.spec.ts` -- matrix rows BMad off, Setup, Trust, Planning, Board live, Status (incl. reopen confirm), Module, Reduced; repo hashes where nothing may be written.
- [ ] `permission-modes-journey.spec.ts` -- matrix row Modes (Developer mode through Settings).
- [ ] `playwright.config.ts`, `ci.yml` -- projects and uv provisioning.
- [ ] `deferred-work.md` -- index lines or `Resolved:` entries so `PROVENANCE_BASE=origin/main pnpm provenance` passes; 3.10 F7 resolved.
- [ ] `CHANGELOG.md`, `RELEASING.md` -- one 0.4.0 entry (epic 10 + epic 4 + permission modes); a 0.4.0 checklist listing the live checks on `npx ogden-agents@next`: epic 4 tracer (idea to ticketed epic with real Claude Code), 10.1, permission modes (Skip all banner, Auto protected-path card with real Claude Code), BMad setup download on a real network.
- [ ] Proofs (local, not committed): guard no-op, trust gate removed, `ticket.changed` emit removed: each fails the suite; restore and repack.

**Acceptance Criteria:**
- Given the packed tarball, when `pnpm e2e:installed` runs on macOS, Windows and Linux in CI, then every project passes with no process or folder left.
- Given any of the three proofs, when the affected project runs, then it fails at the named check.
- Given the branch, when `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs` and the CI base run, then both pass.
- `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm run pack && pnpm smoke` pass.
- Live checks (hitl): each result is written under "Live check result" here before the ticket moves to done.

## Implementation Notes

## Plan Change Log

## Review Triage Log

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
