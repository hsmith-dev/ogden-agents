---
title: 'Refactor sweep'
type: 'refactor'
ticket: '11'
created: '2026-09-30'
status: 'draft'
baseline_revision: ''
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
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

Baseline: set when the story starts (on top of 2.1, so the sweep also covers 2.1's new routes).

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

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm e2e` -- expected: all pass.
- `pnpm pack && node scripts/smoke-installed.mjs` -- expected: exit 0.
