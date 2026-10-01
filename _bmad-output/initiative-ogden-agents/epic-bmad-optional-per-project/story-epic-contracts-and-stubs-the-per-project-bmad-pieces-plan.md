---
title: 'Epic contracts and stubs: the per-project BMad pieces'
type: 'feature'
ticket: '2'
created: '2026-10-01'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
baseline_revision: '525c368c6d6c52b3bcce83f43bb73fdf8638133d'
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epics 4 to 7 and entries 10.3 to 10.6 need one frozen BMad pieces contract (CAP-19, AD-22) to build against; 10.1 left only a `planning` enum, a bare guard and a test probe.

**Approach:** Freeze in `shared` all four pieces with labels, sentences, the dependency rule as one function, availability, the app-wide default, Welcome's first-project answer, detection and the settings anchor, plus every user-facing text; complete core's guard with an availability registry fed from server wiring, add a read-only `BmadCatalogPort.detect` with a `catalog-memory` stub and a fake BMad repo fixture, add the server helper that registers piece routes through the guard, and pre-register the four new install/workspace routes.

## Boundaries & Constraints

**Always:** Every piece is off for new and upgraded workspaces; the default is Simple (empty). Old `{ cautionLevel, previous }` events and 10.1's `{ …, bmadPieces, previousBmadPieces }` events parse. The guard is in core and read at each call; routes serving a piece go only through the helper, which calls it. A piece is turned on only when available (core refuses otherwise); turning off is always allowed. A stored piece set must satisfy the dependency rule. Every shape, error code and user-facing text of the epic lives in `shared`. Test-only availability only via `testHooksAllowed` (env) or a programmatic `start()` option the bin never sets. Tests never run real claude, the keychain, the network, or read `~/.claude`.

**Never:** Write, read beyond existence checks, or delete anything in a user's repo, `_bmad/`, `_bmad-output/` or `.claude`. No real `bmad-catalog` adapter, offer UI, preferences file, Welcome question or designed section (10.3–10.6). Register no real piece as shipped (`SHIPPED_BMAD_PIECES` stays empty until epic 4). No guard on detection/offer/default/available routes (they serve projects with BMad off). No Developer mode or terminal change.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Available list | `GET /api/v1/bmad/pieces`, nothing shipped | all four in order, each `available:false` + coming-soon reason | — |
| Test-registered | hook/option makes `planning` available | `planning` `available:true`, no reason | — |
| Turn on unavailable | `PATCH settings { bmadPieces:['board'] }`, board not available | nothing stored, no event | 409 `feature_unavailable` |
| Rule broken | `PATCH { bmadPieces:['builds'] }` (board off), all available | nothing stored | 400 `invalid_request` |
| Keep stored unavailable | stored `['planning']`, planning now unavailable, `PATCH` caution only | 200, pieces kept | — |
| Rule function | every subset × piece × on/off | closure: on adds what it needs, off removes what needs it, notes say which | — |
| Piece route off | helper-registered route, piece off | handler not run | 409 `feature_off` |
| Piece route unknown ws | helper route, bad/unknown wsId | handler not run | 404 `not_found` |
| Detection / offer / default stubs | `GET detection`, `DELETE offer`, `GET`/`PATCH` new-projects | registered behind the gate | 501 `not_implemented` (body not read) |
| Memory detect | stub with `_bmad` only | `{ hasBmad:true, hasOutput:false }`; unknown path → both false | — |

</frozen-after-approval>

## Code Map

- `packages/shared/src/events.ts:72-84` -- `BMAD_PIECES`/`BmadPiece`/`BmadPieces` move to new `bmad.ts` (events.ts and `chat.ts:2` import from there; no re-export cycle). Event payload (l.221-235) unchanged in shape.
- `packages/shared/src/chat.ts:15,118-130` -- `CreateWorkspaceRequest` gains optional `bmadPieces` (10.4 applies it); `UpdateWorkspaceSettingsRequest` refines with the rule.
- `packages/shared/src/setup.ts:114` `OnboardingState` -- gains optional `firstProjectChoice`.
- `packages/shared/src/errors.ts` -- `feature_off` exists; add `feature_unavailable` (409).
- `packages/shared/src/api.ts` -- add `bmadPieces`, `newProjectDefaults`, `workspaceBmadDetection`, `workspaceBmadOffer`; keep `TEST_ROUTES.bmadProbe`.
- `packages/core/src/bmad-features.ts` -- `readBmadPieces` (reuse), guard; extend. `core.ts` `openCore` options; `permissions.ts:618-670` settings update (add availability + rule checks); `errors.ts` add `FeatureUnavailableError`; `index.ts` exports.
- `packages/core/src/agent-setup-port.ts` / `app-shortcut-port.ts` -- port file pattern for `bmad-catalog-port.ts`.
- `packages/adapters/src/setup-memory/index.ts`, `index.ts` -- pattern for `catalog-memory`.
- `packages/server/src/workspace-routes.ts:53-64,115-128` -- `refusal` and the probe; move the probe onto the helper; feature_off text from shared.
- `packages/server/src/agent-setup-routes.ts` `notImplemented` usage, `errors.ts`, `request-input.ts` `ids` -- reuse.
- `packages/server/src/app.ts`, `start.ts:146,238-240,370`, `start-types.ts`, `test-hooks.ts` -- wiring, the "test hooks in use" line.
- `packages/web/src/workspaces/workspace-settings-api.ts`, `routes/workspace-settings-page.tsx:~190-215` -- 10.1's bare switch.
- Tests: `packages/shared/test/contracts.test.ts`, `packages/core/test/bmad-features.test.ts`, `packages/server/test/{bmad-pieces,gate,test-hooks}.test.ts`, `packages/web/test/workspace-settings-page.test.tsx`, `tests/e2e/bmad-pieces.spec.ts` (in-process `startServer` passes `start()` options, `tests/support.ts:53`).

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/bmad.ts` (+ `index.ts`) -- `BMAD_PIECES = ['planning','board','builds','retrospectives']`, `BmadPiece(s)`; `BMAD_PIECE_INFO` (label, one sentence, `needs`); `applyBmadPieceChoice(current, piece, on) → { pieces, turnedOn, turnedOff }` (transitive, canonical order) and `bmadPiecesProblem(pieces): string | undefined`; `describeBmadPieceChange(result)` one-line note; `BmadPieceAvailability` (`reason` iff unavailable) and `BmadPiecesResponse` (exactly the four, in order); `NewProjectDefaults`/`…Response`/`Update…Request`; `FirstProjectChoice` (`simple_chats` | `bmad_method`) and `FIRST_PROJECT_CHOICE_PIECES` (`bmad_method` → planning, board = `BMAD_METHOD_PRESELECTED_PIECES`); `BmadDetection { hasBmad, hasOutput, offerDismissed }`/`BmadDetectionResponse`; `WORKSPACE_SETTINGS_BMAD_ANCHOR = 'bmad-method'` and `bmadSettingsHref(wsId)`; texts: `FEATURE_OFF_MESSAGE`, `FEATURE_UNAVAILABLE_MESSAGE`, `BMAD_COMING_SOON_REASON`, `BMAD_OFFER_TEXT`/`…CHOOSE`/`…NOT_NOW`, `BMAD_FILES_STAY_TEXT`, `FIRST_PROJECT_QUESTION`.
- [x] `packages/shared/src/{events,chat,setup,errors,api}.ts` -- per Code Map.
- [x] `packages/core/src/bmad-features.ts`, `errors.ts`, `core.ts`, `permissions.ts`, `index.ts` -- `openCore({ availableBmadPieces })`; `BmadFeatures` adds `available(): BmadPieceAvailability[]`, `isAvailable(piece)`, `pieces(workspaceId)`; settings update refuses newly-on unavailable pieces (`FeatureUnavailableError`) and rule breaks (`ValidationError`) before writing.
- [x] `packages/core/src/bmad-catalog-port.ts` -- `BmadCatalogPort { detect(repoPath): Promise<BmadRepoDetection> }` with the read-only contract (existence of `_bmad/`, `_bmad-output/` as directories; never creates, writes, follows into or deletes; missing folder → both false).
- [x] `packages/adapters/src/catalog-memory/index.ts` (+ index) -- `createMemoryBmadCatalog(repos)`; async, records calls. `tests/fixtures/fake-bmad-repo.ts` -- creates a temp repo with/without `_bmad/` and `_bmad-output/` and hashes its file tree (for 10.3/10.7/10.9).
- [x] `packages/server/src/bmad-pieces.ts` -- `SHIPPED_BMAD_PIECES: readonly BmadPiece[] = []` (epics append here) and `bmadPieceRoutes(app, { bmad, log })` with `get/post/patch/put/delete(piece, path, handler(c, { workspaceId }))`; path must contain `/workspaces/:wsId/` else throws at registration; refuses via core guard; `guardedRouteKeys(app)` lists what it registered.
- [x] `packages/server/src/bmad-routes.ts`, `app.ts`, `workspace-routes.ts` -- `GET bmadPieces` from `core.bmad.available()`; 501 stubs for detection, offer, new-projects; probe moves onto the helper; `feature_unavailable` → 409.
- [x] `packages/server/src/{start,start-types,test-hooks}.ts` -- `availableBmadPieces = SHIPPED ∪ option ∪ testBmadAvailable(env)` (`OGDEN_AGENTS_TEST_BMAD_AVAILABLE`, comma list of valid pieces, only under `testHooksAllowed`), named in the "test hooks in use" line.
- [x] `packages/web/src/workspaces/workspace-settings-api.ts`, `routes/workspace-settings-page.tsx` -- query available pieces; Planning switch disabled and marked "Coming soon" when unavailable.
- [x] Tests: shared contracts (every shape, both event payloads, `feature_unavailable`, rule table over all 16 subsets × 4 pieces × on/off); core (availability, refusals write nothing, `pieces`); adapters (memory detect); server (available list default and hooked, refusals, helper 409/404/200, helper path check, stubs 501 with no body read, gate list + `/api/v1`); test-hooks; web; e2e passes `availableBmadPieces: ['planning']`.

**Acceptance Criteria:**
- Given an install with no hook, when `GET /api/v1/bmad/pieces`, then all four pieces show unavailable with the coming-soon reason and no PATCH can turn one on.
- Given a route registered through `bmadPieceRoutes`, when its piece is turned off in another request, then the next call is refused with `feature_off` without running the handler.

## Implementation Notes

- Implemented by a fresh subagent from this plan; it stopped part-way when the auto-mode safety check stopped answering, and the build session finished the remaining items (the gate route list, the hook's tests, the e2e availability option, the hook read only when `start()` opens its own core).
- Shared: `packages/shared/src/bmad.ts` holds every shape, rule and text; `events.ts`/`chat.ts` import from it. `BmadPieceSet` (rule-checked) is used by requests and the settings response; event payloads keep the permissive `BmadPieces`, so 0.2.0 and 10.1 events parse. New-projects route is `/api/v1/settings/new-projects`.
- Core: `readBmadPieces` also drops a stored piece whose needs are off (reads as off); settings store pieces in canonical order. `onboarding.set` keeps a given `firstProjectChoice` through later saves without it (review F3).
- Turning on an unshipped piece is 409 `feature_unavailable` (10.1's 400 test now uses an unknown name).
- Verified: `pnpm typecheck`; `pnpm test` (1070 passed, 4 skipped); `pnpm e2e` (84 passed, incl. the Coming soon check); `pnpm run pack && pnpm smoke` OK.

## Plan Change Log

## Review Triage Log

### Pass 1 (quick lens, with the security checks the caller asked for) — high 0, medium 1, low 3, false 0, maybe-false 0

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | `guardedRouteKeys` checked only on a bare Hono: nothing ties a whole app's piece routes to the helper (AD-22 "a test fails otherwise") | low | patch | True today. Patched: `gate.test.ts` builds `createApp` with the probe and asserts `guardedRouteKeys` lists it, after the gate, in a workspace path. The full coverage test (an unguarded route fails) stays 10.6's, as its ticket says. |
| 2 | Helper maps every `NotFoundError`, including a handler's ticket/session/run, to "There is no such project."; text hard-coded in server | low | patch | True for future handlers. Patched: guard's 404 says `BMAD_PROJECT_NOT_FOUND_MESSAGE`, a handler's `BMAD_ITEM_NOT_FOUND_MESSAGE`, both in shared. |
| 3 | `OnboardingState.firstProjectChoice` is wiped by Welcome's existing `{ welcomeCompleted: true }` PATCH (whole-record replace) | medium | patch | Confirmed in `onboarding.ts` `set`. Patched: a given choice is kept through saves without it; core test added. Accepting the field before 10.4 is harmless (no effect, no secret). |
| 4 | Adapters index comment names a `bmad-catalog` adapter that doesn't exist; stub name `catalog-memory` vs `<port>-<variant>` | low | patch / reject | Comment fixed. Name kept: the epic 4 tickets name `catalog-memory`. |

Security checks the lens confirmed: guard in core and in the helper before handler/body; no piece route reachable while off (only the probe, through the helper); hooks only under `testHooksAllowed`, the `start()` option set by no shipped code; nothing writes to a user's repo, `_bmad/` or `.claude`; 0.2.0 and 10.1 events parse.

## Design Notes

Registry (the entry's unknown): availability is data in server wiring, not core code. Epic 4.2 appends `'planning','board'` to `SHIPPED_BMAD_PIECES` and registers its routes through `bmadPieceRoutes`; core only receives the list. Core refuses turning on an unavailable piece (AD-22 "turned on only when available") with its own code so the UI can say why; already-stored pieces are kept. The rule as one function:

```ts
applyBmadPieceChoice(['board'], 'builds', true)  // { pieces: ['board','builds'], turnedOn: [], turnedOff: [] }
applyBmadPieceChoice([], 'retrospectives', true) // { pieces: ['board','builds','retrospectives'], turnedOn: ['board','builds'], … }
applyBmadPieceChoice(['board','builds','retrospectives'], 'board', false) // turnedOff: ['builds','retrospectives']
```

## Verification

**Commands:**
- `pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: all pass
- `pnpm e2e` -- expected: all pass
- `pnpm run pack && pnpm smoke` -- expected: pass
