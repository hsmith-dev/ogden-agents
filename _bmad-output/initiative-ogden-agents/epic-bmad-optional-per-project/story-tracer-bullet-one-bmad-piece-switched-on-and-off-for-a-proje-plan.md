---
title: 'Tracer bullet: one BMad piece switched on and off for a project'
type: 'feature'
ticket: '1'
created: '2026-10-01'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
baseline_revision: '042e553c6335e520f9009cd376d2e2621081fef0'
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** BMad Method is about to become optional per project (CAP-19, AD-22), but no workspace can yet hold a BMad piece, and nothing in core can refuse BMad work for a project that has it off.

**Approach:** Thread one piece (`planning`) end to end: a column on the workspace row (migration 0004, all off), carried in `WorkspaceSettings` through `GET`/`PATCH /api/v1/workspaces/:wsId/settings` and the existing core settings use-case that emits `workspace.settings_changed`, a minimal core guard `requireBmadFeature` refusing with `feature_off`, one test-only guarded route, and a bare switch in Workspace settings.

## Boundaries & Constraints

**Always:** Core alone writes the row and appends the event in the same transaction (AD-11, AD-5). The guard is server-side code in core, never the UI (AD-22). Stored 0.2.0 `workspace.settings_changed` events (`{ cautionLevel, previous }`) still parse. New and upgraded workspaces start with every piece off. The test-only route exists only when `testHooksAllowed` and its own env variable are both true, and sits behind the gate (AD-15). Tests never run real `claude`, the keychain, the network, or read `~/.claude`.

**Never:** Install, write, read or delete anything in the user's repo, `_bmad/` or `.claude` (no detection here; entry 3). No piece list with labels, dependency rule, `available` registry, route-registration helper, app-wide default or designed section (entries 2, 4, 5). No change to Developer mode or the terminal toggle.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Default | new or migrated workspace, `GET settings` | `{ cautionLevel, bmadPieces: [] }` | — |
| Turn on | `PATCH { bmadPieces: ['planning'] }` | 200 with the new settings; exactly one `workspace.settings_changed` carrying `bmadPieces` and `previousBmadPieces`, caution level unchanged | — |
| Unchanged | `PATCH` with the same pieces | 200, no event | — |
| Both fields | `PATCH { cautionLevel, bmadPieces }` | one transaction, one event | — |
| Bad piece | `PATCH { bmadPieces: ['board'] }` or a non-array, or `{}` | 400 `invalid_request`, nothing stored | — |
| Guard off | test route, planning off | 409 `feature_off`, plain message | — |
| Guard on | test route, planning on | 200 | — |
| Unknown workspace | settings or test route | 404 `not_found` | — |
| Old event | stored `{ cautionLevel, previous }` payload | parses and replays | — |
| Hook off | no env var, or not a test run | test route not registered (404 under the gate) | — |

</frozen-after-approval>

## Code Map

- `packages/core/src/db/schema.ts` `workspaces` -- add `bmadPieces` JSON text column, default `'[]'`; generate `packages/core/drizzle/0004_*.sql` + snapshot + journal with `pnpm --filter @ogden-agents/core db:generate` (pattern: `0003_caution_level.sql`).
- `packages/shared/src/events.ts` `CautionLevel`, `WorkspaceSettingsChangedInput` (~l.208) -- home of `BMAD_PIECES = ['planning']`, `BmadPiece`; payload gains optional `bmadPieces`, `previousBmadPieces`.
- `packages/shared/src/chat.ts` `WorkspaceSettings`, `UpdateWorkspaceSettingsRequest` (~l.117-130) -- settings gain `bmadPieces`; request becomes an explicit partial of both fields, non-empty.
- `packages/shared/src/errors.ts` `API_ERROR_CODES` -- add `feature_off` (409).
- `packages/shared/src/api.ts` -- add a separate `TEST_ROUTES.bmadProbe` (`${API_BASE}/workspaces/:wsId/test/bmad-probe`), not in `API_ROUTES`, so the gate test's route list is unchanged.
- `packages/core/src/permissions.ts` `getSettings`/`updateSettings` (~l.89-97, 618-640), `createDecliningPermissions` -- the existing settings use-case; extend it for pieces (same transaction, one event).
- `packages/core/src/errors.ts` -- add `FeatureOffError` (`code: 'feature_off'`).
- `packages/core/src/core.ts` -- expose the guard on `Core`.
- `packages/server/src/workspace-routes.ts` `refusal` -- map `FeatureOffError` to 409; log the pieces count/names on save (no paths).
- `packages/server/src/test-hooks.ts` -- reuse `testHooksAllowed`; add `BMAD_PROBE_ENV` + `testBmadProbe(env, dataDir)`.
- `packages/server/src/app.ts`, `start.ts` -- pass `bmad` guard and `bmadProbe` flag; register the probe after the gate.
- `packages/web/src/workspaces/workspace-settings-api.ts` -- add `updateBmadPieces`; invalidation already follows `workspace.settings_changed`.
- `packages/web/src/routes/workspace-settings-page.tsx` -- add a bare "BMad Method" section with one `Switch` (`@/ui/switch`) for Planning; same latest-gate save pattern as `CautionLevelSection`.
- Tests to extend: `packages/shared/test/contracts.test.ts`, `packages/core/test/permissions.test.ts`, `packages/server/test/workspace-settings.test.ts`, `packages/server/test/test-hooks.test.ts`, `packages/web/test/workspace-settings-page.test.tsx`; `tests/e2e/caution.spec.ts` is the e2e pattern.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/shared/src/{events,chat,errors,api}.ts` -- piece enum, optional event fields, settings field, `feature_off`, `TEST_ROUTES` -- the contract all layers share.
- [ ] `packages/core/src/db/schema.ts` + generated migration 0004 -- the column, all off for existing rows.
- [ ] `packages/core/src/errors.ts`, `permissions.ts`, `core.ts` -- `FeatureOffError`; settings read/write pieces in one transaction with one event; `requireBmadFeature(workspaceId, piece)` (NotFound for an unknown workspace, `FeatureOffError` when off; unknown stored values read as off).
- [ ] `packages/server/src/{test-hooks,workspace-routes,app,start}.ts` -- `feature_off` mapping; the hook-gated `GET` probe calling the core guard.
- [ ] `packages/web/src/workspaces/workspace-settings-api.ts`, `routes/workspace-settings-page.tsx` -- the bare switch.
- [ ] Tests: shared contract (old and new payloads, request validation); core (default off, set/unset, one event, unchanged → none, combined patch, guard, migrated row); server (PATCH + one event, restart persistence on the same data folder, probe 409 → 200, probe absent without the hook, needs a token); test-hooks; web view; e2e two tabs with the second following without reload.

**Acceptance Criteria:**
- Given two open tabs on a project's settings, when the switch is flipped in one, then the other shows the new state without a reload, and after a server restart the state is kept.
- Given a 0.2.0 data folder, when it opens, then every workspace reports `bmadPieces: []` and its stored settings events parse.

## Implementation Notes

- Implemented directly in the planning session (full context already loaded) rather than by a fresh implementation subagent.
- The unknown, resolved for entry 2 to freeze: `workspace.settings_changed` keeps its type and its required `{ cautionLevel, previous }`, and grows optional `bmadPieces` and `previousBmadPieces`, present only when the pieces changed. A 0.2.0 payload parses unchanged (contract test); a level-only change still writes the 0.2.0 shape.
- Storage: `workspaces.bmad_pieces` JSON text, default `'[]'` (migration `0004_bmad_pieces.sql`, generated). `readBmadPieces` drops any value this version can't name, so the guard never turns on what it doesn't know.
- Guard: `packages/core/src/bmad-features.ts` (`core.bmad.requireBmadFeature`), throwing `FeatureOffError` (`feature_off`), mapped to 409 in `workspace-routes.ts`. Settings get/update stay in `permissions.ts` so a PATCH with both fields is one transaction and one event.
- Test-only route: `TEST_ROUTES.bmadProbe` (`GET /api/v1/workspaces/:wsId/test/bmad-probe`), outside `API_ROUTES`, registered after the gate only when `testBmadProbe(env, dataDir)`: `OGDEN_AGENTS_TEST_BMAD_PROBE=1` and `testHooksAllowed`. It adds no check of its own; core's guard decides.
- Web: a bare "BMad Method" section with a Planning switch; the second tab follows through the existing `workspace.settings_changed` invalidation.
- Verified: `pnpm typecheck`, `pnpm test` (1026 passed), `pnpm e2e` (83 passed, including the new `tests/e2e/bmad-pieces.spec.ts` with two tabs and a restart), `pnpm run pack && pnpm smoke` OK.

## Plan Change Log

## Review Triage Log

### Pass 1 (quick lens, with the security checks the caller asked for) — high 0, medium 0, low 2, false 0, maybe-false 0; 1 note

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | `bmad_pieces` in drizzle `mode: 'json'`: a non-JSON stored value throws in drizzle's `JSON.parse` before `readBmadPieces` runs, so settings, the guard and every whole-row workspace read answer 500 instead of "reads as off" | low | patch | Confirmed in drizzle's `mapFromDriverValue`. Reachable only with a damaged row, failing closed, but it broke the stated rule and the workspace list. Column is now plain text, parsed in `readBmadPieces` with try/catch, written with `JSON.stringify`; no SQL change (`db:generate`: nothing to migrate). Test adds `'garbage'` and checks the workspace list and guard. |
| 2 | AC "0.2.0 data folder… stored settings events parse" shown only on the shared schema, not through the real read path of an upgraded folder | low | patch | True: `database.test.ts` stored no event. It now stores a 0.2.0 `workspace.settings_changed` row, migrates, opens core and reads it back unchanged, with the project Simple and its level kept. |
| 3 | The review diff left out `0004_snapshot.json` | false | reject | Excluded from the review diff only for size; it is staged and in the commit. |

Security checks the lens confirmed: guard in core, read on every call; probe registered only under `testBmadProbe` and after the gate (401 without a token); probe not in `API_ROUTES`; nothing touches the user's repo, `_bmad/` or `.claude`; logs carry ids and piece names only.

## Design Notes

The unknown (entry 1): the event grows by optional fields rather than a new type or a union, so a 0.2.0 payload `{ cautionLevel, previous }` still parses and a pieces change still states the (unchanged) caution level. Entry 2 freezes this. The pieces live on the existing settings use-case in `permissions.ts` so a PATCH carrying both fields is one transaction and one event; moving settings into their own core module is left to entry 2 or the sweep. The enum holds only `planning` so the API cannot store a piece whose dependency rule and availability entry 2 has not yet defined; widening an enum keeps stored events parseable.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: all pass
- `pnpm e2e` -- expected: all pass
- `pnpm run pack && pnpm smoke` -- expected: pass

**Manual checks (if no CLI):**
- Live (hitl, developer): flip the switch in one tab and watch a second tab follow; restart and confirm it stays.
