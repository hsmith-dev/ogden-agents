---
title: 'Refactor sweep'
type: 'refactor'
ticket: '11'
created: '2026-09-30'
status: 'built'
baseline_revision: 'bf4dbb253fd97357fee467324d1099e3b92580a4'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 1 was built in ten stories by different agents under review pressure. The build records and review rounds left known rough edges: conventions applied inconsistently, duplicated helpers, and a few costs accepted to ship. Epic 2 will copy whatever patterns it finds (Ogden's lesson: agents copy what they see).

**Approach:** One cleanup pass with no behavior change, scoped to the items below, which were collected from epic 1's build records and review triage logs. Each item is small, and all tests stay green throughout.

## Scope (from the build records)

1. **API path convention:** the architecture's Conventions say REST lives under `/api/v1/…`, but the routes are `/api/server/quit`, `/api/toolchain`, `/api/toolchain/uv/install` and `/api/launch-codes` (2.1). Move them under `/api/v1/` in one shared routes constant in `packages/shared`, used by server and web alike.
2. **Launcher start-up cost:** `dist/launcher.js` shares a chunk with core, so every `ogden` run loads `better-sqlite3` (1.7 note). Split the bundle so the launcher imports only what the handshake and spawn need.
3. **Unused launch code:** each background start issues a launch code nobody uses (1.7 note). Issue codes only on request (the handshake `?launch=1` and foreground mode).
4. **Web bundle:** the JS bundle is about 610 kB with the size warning raised instead (1.6 note). Lazy-load routes other than the shell and home, and restore Vite's default warning limit.
5. **Test helpers:** the server and e2e tests each carry their own sign-in, fetch and launcher helpers (`signIn`, `exchange`, `startGated`, the fake server). Put them in one shared test-support module per layer.
6. **Version sources:** server, launcher and web each read their own `package.json` version (1.7 note). Read a single build-time constant.
7. **Error shape:** some routes answer with ad hoc bodies. Every error follows the Conventions' `{ error: { code, message, details? } }`, with codes in `packages/shared`.

## Boundaries & Constraints

**Always:**
- No behavior change visible to users, except faster `ogden` start-up and a smaller first page load. Every existing test, e2e test, the smoke test and the fork and pin checks stay green, and moved routes are covered by the existing tests (updated paths).
- AD-1 dependency rules and the design-token and feature-styling lints still pass.

**Never:**
- No new features, no scope beyond the seven items, no public-surface additions beyond the shared route and error-code constants.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Routes | Any API call from the UI | Served under `/api/v1/…`; the old paths get 404 | — |
| Launcher | `ogden` with a running server | Attaches without loading `better-sqlite3` (checked by a test that inspects the launcher bundle's imports) | — |
| Errors | Any 4xx/5xx from an API route | Body matches the shared error schema | — |
| First load | Open the app | Only the shell and home chunks load; other routes load on navigation | — |

</frozen-after-approval>

## Code Map

Baseline: worktree `../ogden-agents-wt-1.11`, branch `story/1.11-refactor-sweep`, on top of 2.1 (`bf4dbb2`). 2.1 added `POST /api/tab/exchange`, `POST /api/launch-codes`, `GET /api/tab` and `packages/server/src/paths.ts` (the shared path helper); item 1 moves all API routes under `/api/v1/` through that helper and the shared constants.

- Routes: `packages/server/src/app.ts` (quit, toolchain, launch codes) and the web callers in `packages/web/src/events/` and `routes/`.
- Launcher bundle: `packages/server/tsdown.config.ts` (entries `server`, `serve`, `launcher`) and `src/launcher.ts` imports.
- Launch codes: `packages/server/src/start.ts` (`issueLaunchUrl`, the start-up issue).
- Web bundle: `packages/web/vite.config.ts` (`chunkSizeWarningLimit`) and `src/router.tsx`.
- Tests: `packages/server/test/helpers.ts`, `tests/e2e/server.ts`, `tests/fixtures/fake-server.mjs`, `tests/launcher.test.ts`.
- Versions: `packages/server/src/start.ts` (`pkg.version`) and `packages/web/src/version.ts`.

## Tasks & Acceptance

**Execution:**
- [ ] Items 1–7 above, each as its own small commit-sized change, with tests updated.

**Acceptance Criteria:**
- Given the full suite, e2e, smoke, fork and pin checks, when run after the sweep, then all pass with no user-visible behavior change beyond start-up and page-load speed.

## Implementation Notes
- Orchestrator audit: the implementer committed the seven items as seven commits on top of `bf4dbb2` (`98f8f84` item 1 to `91ba682` item 7, then `4b1419c` item 5; corrected after review). All 4 matrix rows are covered (route-enumeration and old-path 404 tests; the launcher import-graph packaging test; error-shape tests across ten refusals; a lazy-chunk e2e test). 228 tests, 34 e2e, smoke, fork and pin checks pass.

## Plan Change Log

## Review Triage Log

### Pass 1 (quick lens) — 2026-09-30

Counts: low 4 (2 patched, 2 rejected), 1 deliberate exclusion, 2 records. All story 2.1 security properties confirmed unchanged.

| # | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|
| 1 | `/launcher/restart-when-idle` 409 keeps its ad hoc body | — | reject | Deliberate: launchers and servers of different versions speak this handshake; changing the body breaks older launchers. Out of item 7's scope (not under `/api`). |
| 2 | `app.onError` turns `HTTPException` 4xx into 500 | low | patch | Returns `error.getResponse()` for `HTTPException`. |
| 3 | Bad-Host/Origin 403s are now JSON on page paths too | low | reject | Only hostile or misconfigured clients see it; harmless. |
| 4 | The first load shrank by only about 33 kB (split rather than reduced) | low | reject | The plan asked for lazy routes and the default warning limit, both met; size budget noted for later. |
| 5 | Unrecorded public-surface changes: `@ogden-agents/core/data-dir` export; `RunningServer.launchUrl` now optional | — | record | Both required by items 2 and 3; recorded here. |
| 6 | Route literals hard-coded in `smoke-installed.mjs` and `fake-server.mjs` | low | patch | `tests/route-literals.test.ts` fails if any literal isn't in `API_ROUTES` (drift proven). |
| 7 | The commit range in the audit note is wrong | — | record | Corrected above. |

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm e2e` -- expected: all pass.
- `pnpm pack && node scripts/smoke-installed.mjs` -- expected: exit 0.
