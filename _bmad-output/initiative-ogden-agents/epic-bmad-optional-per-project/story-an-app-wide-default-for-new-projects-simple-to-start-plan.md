---
title: 'An app-wide default for new projects, Simple to start'
type: 'feature'
ticket: '4'
created: '2026-10-01'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
baseline_revision: '0593ea21ea24905cddb0758b046503671d4cf5f5'
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-bmad-optional-per-project/story-epic-contracts-and-stubs-the-per-project-bmad-pieces-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 10.2 froze the app-wide default for new projects (`NewProjectDefaults`, `/api/v1/settings/new-projects` as 501 stubs), `CreateWorkspaceRequest.bmadPieces` and Welcome's `firstProjectChoice`, but nothing keeps the default, applies it, or asks Welcome's question (E10-R4).

**Approach:** Core keeps the default in `<dataDir>/preferences.json` like `onboarding.json` and adds an add-project use-case that creates a new workspace with given pieces or the default, in the same transaction; the server fills the two stubs and routes `POST /workspaces` through the use-case; the web adds Settings → New projects, and Welcome's project step asks "Simple chats or BMad Method?" once for the first project.

## Boundaries & Constraints

**Always:** Missing, unreadable or invalid preferences file → Simple (`[]`), logging only its code (once per run while corrupt), file left as is. File mode 0600, written via temp + rename. A new workspace's pieces are written on its row in `ensureWorkspace`'s transaction, and when non-empty a `workspace.settings_changed` (`cautionLevel` = `previous` = default level, `bmadPieces`, `previousBmadPieces: []`) follows `workspace.created` in that transaction. An existing project is returned unchanged (pieces ignored). Requested pieces (body) newly-on and unavailable → 409 `feature_unavailable`, nothing created; rule breaks → 400 (schema). Default pieces no longer available at add time are dropped, then pieces whose needs are off are dropped (rule kept). `PATCH` default: unavailable newly-on piece → 409, unchanged otherwise; body limited (1 KiB). Welcome asks only when `firstProjectChoice` is unset AND there are no projects (so 0.2.0 users and Settings → Welcome re-entries with projects are never asked); its answer sets that project's pieces only, and is saved as `firstProjectChoice` with Welcome done. BMad Method choice applies `BMAD_METHOD_PRESELECTED_PIECES` filtered to available pieces (rule closure); it is greyed "Coming soon" when none is available. All text from `shared` (add any new strings there). Routes behind the gate (AD-15). Test-only availability only through 10.2's hook/option.

**Never:** Write anything into a user's repo, `_bmad/` or `.claude`. Change the default from Welcome. Guard these routes with a piece (they serve Simple projects). Touch the Workspace settings BMad section (10.5), detection/offer routes (10.3), the header tab slots (10.6), Developer mode, the terminal. Store the default in SQLite or browser storage.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No file | `GET new-projects` | `{ defaults: { bmadPieces: [] } }` | — |
| Corrupt file | invalid JSON / shape | Simple; warn with code `corrupt` only | file untouched |
| Set default | `PATCH { bmadPieces:['planning'] }`, planning available | 200, file kept 0600; next new project has planning | — |
| Set unavailable | `PATCH { bmadPieces:['board'] }`, board unavailable | nothing written | 409 `feature_unavailable` |
| Bad body | rule break / unknown piece / non-JSON / >1 KiB | nothing written | 400 / 400 / 400 / 413 |
| Add, no body pieces | default `['planning']` | workspace row `['planning']`, `workspace.created` then `settings_changed` | — |
| Add, body pieces | `{ path, bmadPieces:['planning','board'] }` both available | that project starts with both; default unchanged | — |
| Add, body unavailable | `bmadPieces:['board']` unavailable | no workspace, no event | 409 `feature_unavailable` |
| Add existing path | default `['planning']`, project exists with `[]` | returned unchanged, no event | — |
| Default now unavailable | stored `['board','builds']`, only `planning` available | new project `[]` | — |
| Welcome first run | no projects, no choice | question shown, Simple chats preselected | — |
| Welcome again | `firstProjectChoice` set, or a project exists | no question | — |

</frozen-after-approval>

## Code Map

- `packages/core/src/onboarding.ts` -- pattern to copy (read/write/corrupt-once/0600/rename) for new `preferences.ts`; `set` keeps `firstProjectChoice` already.
- `packages/core/src/entities.ts:252-268` `ensureWorkspace(path)` -- add optional `{ bmadPieces }`; insert `bmadPieces: JSON.stringify(pieces)` (column `schema.ts:37`) and append `workspace.settings_changed` in the transaction when non-empty. Default caution level: see `permissions.ts` (`DEFAULT_CAUTION_LEVEL`).
- `packages/core/src/chat/workspaces.ts` `openWorkspace`, `chat/types.ts:98` -- pass the pieces through (options arg).
- `packages/core/src/bmad-features.ts` -- `isAvailable`, `available()`; reuse `canonicalBmadPieces`, `BMAD_PIECE_INFO` needs (or `bmadPiecesProblem`) for the drop rule. `errors.ts` `FeatureUnavailableError`, `ValidationError`.
- New `packages/core/src/new-projects.ts` (or `preferences.ts` + use-case) -- `createNewProjectDefaults({ dataDir, bmad, onError })` → `get()`, `set(input)`; `createAddProject({ chat, defaults, bmad })` → `addProject(path, bmadPieces?)`. Export from `index.ts`.
- `packages/server/src/bmad-routes.ts` -- replace only the two `newProjectDefaults` 501 lines (10.3 edits the detection lines of this file); `notImplemented` when no defaults given (keep `createApp` callers working).
- `packages/server/src/chat-routes.ts:85-94` -- `POST workspaces` calls add-project with `body.value.bmadPieces`; `FeatureUnavailableError` → 409 `feature_unavailable` with `FEATURE_UNAVAILABLE_MESSAGE` (see how `workspace-routes.ts` maps it).
- `packages/server/src/app.ts`, `start.ts:~367` -- wire `newProjectDefaults` next to `onboarding` (`log.warn('new project defaults unusable', { code })`).
- Web: `chat/chat-api.ts:32` `openWorkspace(path, auth, bmadPieces?)`; `workspaces/add-project-dialog.tsx` optional `bmadPieces` prop → `openWorkspace`; `onboarding/onboarding-api.ts` `useCompleteWelcome` accepts an optional `firstProjectChoice`; `onboarding/welcome-model.ts` pure `asksFirstProjectChoice(onboarding, projectCount)` and `firstProjectPieces(choice, availability)`; `routes/welcome-page.tsx` `ProjectStep` radio group; reuse `useBmadPieces` (`workspaces/workspace-settings-api.ts`), project list from `workspaces/workspace-api.ts`.
- Web Settings: new `settings/new-project-defaults.tsx` (API + `NewProjectDefaultsSection` component: Simple / BMad Method radios, under BMad the four pieces as checkboxes via `applyBmadPieceChoice` + `describeBmadPieceChange`, unavailable greyed with `BMAD_COMING_SOON_LABEL`); new `routes/new-projects-page.tsx`; `router.tsx` adds `/settings/new-projects`; `shell/status-sidebar.tsx:~285-305` SettingsMenu adds "New projects". Pattern: `routes/workspace-settings-page.tsx` `BmadMethodView`.
- Tests to update: `packages/server/test/bmad-contract.test.ts:225-255` (stubs now real), `gate.test.ts:609` (still gated). Add: `packages/core/test/new-projects.test.ts`, `packages/server/test/new-projects.test.ts`, web model/component tests, `tests/e2e/new-projects.spec.ts` (in-process `startServer(…, { availableBmadPieces: ['planning','board'] })` per `tests/e2e/bmad-pieces.spec.ts`), `welcome.spec.ts` extension.

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/bmad.ts` -- any new texts (section intro, Simple/BMad option sentences, "New projects" label) only; no shape changes.
- [x] `packages/core/src/new-projects.ts`, `entities.ts`, `chat/workspaces.ts`, `chat/types.ts`, `index.ts` -- preferences store + add-project use-case per matrix.
- [x] `packages/server/src/{bmad-routes,chat-routes,app,start}.ts` -- fill stubs, route POST workspaces through add-project, wiring.
- [x] Web files per Code Map -- Settings → New projects page and component; dialog applies default (server-side, no client change beyond the optional prop); Welcome question.
- [x] Tests per Code Map covering every matrix row; e2e: dialog-added project Simple; Welcome first run asks, picking BMad (planning+board registered) gives that project both on and default stays Simple; Welcome re-entry doesn't ask; Settings default Planning → next project Planning, earlier unchanged.
- [x] `CHANGELOG.md` -- one appended line under the unreleased section.

**Acceptance Criteria:**
- Given no preferences file, when a project is added from the dialog and another from Welcome with Simple chats kept, then both have every piece off and nothing is written in their repos.
- Given BMad Method chosen with Planning in Settings, when the next project is added, then it starts with Planning on and earlier projects are unchanged.
- Given Welcome answered once, when Welcome is opened again from Settings, then the question is not shown.

## Implementation Notes

- Core: `new-projects.ts` holds the preferences store (`<dataDir>/preferences.json`, `{ newProjects: { bmadPieces } }`) and `createAddProject`. `ensureWorkspace(path, { bmadPieces })` takes the pieces or a function called only when the workspace is created, inside its transaction, so a refusal (`FeatureUnavailableError`, `ValidationError`) creates nothing and an existing project ignores the pieces (no 409 for an existing path). `GET` returns the default as kept (a stored piece no longer shipped stays listed); the drop rule (`applicableDefaultPieces`) applies at add time.
- Server: `createApp` builds the add-project use-case from `chat`, `bmad` and the optional `newProjectDefaults`, so callers without the store still work (new projects Simple, routes 501).
- Web: no checkbox existed in `ui/`, so `ui/checkbox.tsx` (`CheckboxOption`, radix Checkbox, laid out like `RadioGroupOption`) was added. Welcome latches the question once shown for the visit (so the project it adds doesn't hide it before the answer is used) and saves the answer only when a project was added with it. Simple chats sends `bmadPieces: []` explicitly.
- CHANGELOG had no unreleased section; one was added above 0.3.0.
- Verified: `pnpm typecheck`; `pnpm test` (1110 passed, 4 skipped, after the review patches); `pnpm e2e` (86 passed); `pnpm run pack && pnpm smoke` OK.
- CI: the installed onboarding journey expected `onboarding.json` to be exactly `{ welcomeCompleted: true }`; Welcome now also keeps `firstProjectChoice: simple_chats`, so the expectation was updated (`pnpm e2e:installed` 36 passed locally).

## Plan Change Log

## Review Triage Log

### Pass 1 (quick lens, with the security checks the caller asked for) — high 0, medium 3, low 6, false 0, maybe-false 0

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | `PATCH new-projects` logs the saved piece names, not a code | low | patch | True (`bmad-routes.ts`). Patched: logged without piece names. |
| 2 | New user-facing strings written in server/web, not `shared` (plan: all text in shared) | low | patch | True. Patched: moved to `shared/src/bmad.ts`; the generic 413 text stays the server's existing pattern. |
| 3 | Unreadable (non-ENOENT) preferences file logged on every read | medium | patch | True: only `corrupt` was deduplicated; `read()` runs on each GET/PATCH/add. Patched: once per run per persisting failure; core test. Same gap in `onboarding.ts` is pre-existing, left. |
| 4 | Settings: failed mode save leaves BMad Method shown | low | patch | True (`setMode` before save, never undone). Patched: restored on failure. |
| 5 | Settings: unchecking the last feature behaves differently by how BMad was reached | low | patch | True (`shown` falls back to `mode`, undefined after load). Patched: a piece change sets the mode; component test. |
| 6 | Welcome: BMad Method shows "Coming soon" while availability loads or failed | medium | patch | True (`bmadMethodPieces(undefined)` is empty). Patched: disabled without the badge until known. |
| 7 | Welcome: Add project before onboarding/projects load bypasses the question | medium | patch | True (`asks` false until both load; buttons enabled). Patched: buttons aria-disabled until both settle. |
| 8 | e2e doc comment attached to the wrong function | low | patch | True. Moved. |
| 9 | No component test for Welcome's question | low | patch | True (model + e2e only). Added. |

Security checks the lens confirmed: both new-projects routes and `POST /workspaces` behind the gate (401 tested, gate list); no piece guard; 1 KiB limit then schema then core checks; `preferences.json` 0600 via temp + rename, never SQLite, browser storage or a repo; pieces resolved inside the creating transaction, a refusal creates nothing.

## Design Notes

Why core owns the default application: `CreateWorkspaceRequest.bmadPieces` omitted means "the default", so the browser never reads the default to add a project and every tab agrees. Welcome sends explicit pieces. Settings integration: 10.4 owns Settings → New projects (its own route and menu entry). 10.5 owns the Workspace settings section; the piece-list UI may be similar to 10.5's — 10.8's sweep can merge them.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: all pass
- `pnpm e2e` -- expected: all pass
- `pnpm run pack && pnpm smoke` -- expected: pass
