---
title: 'Tracer bullet: launcher to live page'
type: 'feature'
ticket: '1'
created: '2026-09-29'
status: 'built'
baseline_revision: 'cad6fa958ed53c20bbb8cfb3c6da4b1cd7c9ea9c'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogdenmad/architecture-ogdenmad/architecture-ogdenmad.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** OgdenMad has no code. Nothing yet proves that the launcher, server, core, shared contract and browser UI connect, which every later story depends on.

**Approach:** Scaffold the pnpm monorepo in the architecture's hexagonal layout. The `bin/ogdenmad` launcher starts a Hono server on `127.0.0.1` that serves the built React page and pushes a core `server.started` event over WebSocket. The launcher then opens the browser, where the page shows the event arriving live. Reserving the npm name is the user's hands-on step in this story.

## Boundaries & Constraints

**Always:**
- Package dependencies follow the architecture's AD-1 diagram, enforced by a test:
  - `web` → `shared`
  - `server` → `core`, `adapters`, `shared`
  - `adapters` → `core`, `shared`
  - `core` → `shared`
  - `bin` → `server`
- The server binds only to `127.0.0.1`.
- Every WebSocket message is validated against a Zod schema in `packages/shared`.
- Use the versions in the architecture's Stack. WebSockets use `@hono/node-server` v2's built-in `upgradeWebSocket` with `ws`, not the deprecated `@hono/node-ws`.

**Never:**
- No security gate, cookie or launch code (story 1.4).
- No SQLite, persistence or sequence-numbered log (story 1.3). The core emitter here is in-memory and marked temporary.
- No design system or shadcn (stories 1.5–1.6). The page is minimal unstyled HTML.
- No background detaching (story 1.7), and no npm publish workflow or CI (stories 1.2 and 1.10).
- No agent, OS or tool names in `packages/core`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Launch | `pnpm install && pnpm start` on a clean checkout | Server listens on `127.0.0.1:<port>`, browser opens, page shows `server.started` with time and version | No error expected |
| No browser wanted | `node bin/ogdenmad.js --no-open` | Server starts; URL printed; no browser | No error expected |
| Default port busy | Another process holds the default port | Server takes the next free port; the launcher opens and prints that URL | Logs which port was used |
| Late page load | Page connects after the server started | Page still shows `server.started` (the core replays its latest event to new subscribers) | No error expected |
| Bad message | Client sends a non-schema message | Server ignores it and keeps the connection | Logged at warn level; nothing crashes |

</frozen-after-approval>

## Code Map

The repo is empty (baseline `cad6fa9`: BMAD, skills and planning only). Do not touch `_bmad/`, `_bmad-output/` (except this plan), `.agents/` or `.claude/`.

Verified APIs:
- `@hono/node-server` 2.1.3 exports `serve` and `upgradeWebSocket` (`serve({ fetch, websocket: { server: new WebSocketServer({ noServer: true }) } })`) and `./serve-static`. It needs Node ≥ 20 and `hono` ^4.
- `open` 11.0.4 (Node ≥ 20). `tsdown` 0.23.0 (Node ^22.18 or ^24.11 or ≥ 26). `@vitejs/plugin-react` 6.1.1. Vite 8.3.1 needs Node ^20.19 or ≥ 22.12.
- pnpm 12.6.0 is installed locally.

## Tasks & Acceptance

**Execution:**
- [x] Root files: `package.json` (private workspace root with `bin: { ogdenmad: bin/ogdenmad.js }`, `engines.node >=24`, and scripts `build`, `start`, `test`, `typecheck`), `pnpm-workspace.yaml`, `tsconfig.base.json` (strict, ESM, NodeNext), `.npmrc` if needed, `README.md` (how to run). These establish the monorepo.
- [x] `packages/shared/src/events.ts` -- Zod schema and type for `server.started` `{ type, at (ISO 8601 UTC), version }` plus a `ServerMessage` union. This is the contract web and server share.
- [x] `packages/core/src/event-bus.ts` -- a temporary in-memory emitter with `emit` and a `subscribe` that replays the latest event, plus a header comment that story 1.3 replaces it. It proves the core-to-server path.
- [x] `packages/adapters/src/index.ts` -- an empty module with a README line naming its role (AD-1). The package exists so dependency rules apply from day one.
- [x] `packages/server/src/app.ts` and `start.ts` -- a Hono app serving `packages/web/dist` statically plus `/ws`, which sends each core event validated by the shared schema. `start({ port, open })` binds `127.0.0.1` with default-port fallback, emits `server.started`, and returns the URL and a `close()`. This is the delivery layer.
- [x] `packages/web/` (`index.html`, `src/main.tsx`, `src/App.tsx`, `vite.config.ts`) -- a page that connects to `/ws`, parses messages with the shared schema, and lists the events live, with connection state shown. It proves the UI end.
- [x] `bin/ogdenmad.js` -- parses `--no-open` and `--port`, calls the server's `start`, prints the URL, and opens the browser with `open`. This is the entry point.
- [x] `tests/architecture.test.ts` -- reads every workspace `package.json` and fails on any dependency edge outside AD-1, enforcing the layout in code.
- [x] `packages/server/test/start.test.ts` -- starts on port 0 with `open: false`, connects with `ws`, and asserts that a schema-valid `server.started` arrives, including after a late connect; also checks a bad client message is ignored. This covers the I/O matrix.
- [x] hitl: the user reserves the `ogdenmad` npm name (publishing `0.0.0` from an empty placeholder after `npm login`). It's done at the end of implementation, with the user's confirmation.

**Acceptance Criteria:**
- Given a clean checkout with Node ≥ 24, when the user runs `pnpm install && pnpm start`, then a browser page opens and shows a live `server.started` event from the running server.
- Given any workspace package, when it declares a dependency outside the AD-1 diagram, then `pnpm test` fails.
- Given the server is running, when anything connects from a non-loopback interface, then the connection is refused, because the server binds only `127.0.0.1`.

## Implementation Notes

- Workspace packages `shared`, `core` and `adapters` export TypeScript source; `tsdown` bundles them (and zod) into `packages/server/dist/index.js`, with third-party deps left external. `packages/server` exports `types: ./src/index.ts`, `default: ./dist/index.js`, so the launcher needs `pnpm build` first.
- `bin/ogdenmad.js` is plain ESM JavaScript (type-checked with `checkJs`), not bundled. It passes `open` through to `start()`, which opens the browser with the `open` package once listening; the root package (`bin`) therefore depends only on `@ogdenmad/server`.
- The shared contract adds a `ClientMessage` union (`ping`) and a `pong` server message, so a client has one valid thing to send and the tests can prove a connection survives a bad message.
- Port fallback applies to an explicit `--port` as well as the default; up to 20 consecutive ports are tried. `--port 0` asks the OS for any free port.
- Logs are JSON lines on stderr (data-directory log file comes later). `exactOptionalPropertyTypes` was left off because `ws`'s `WebSocketServer` types don't satisfy `@hono/node-server`'s `WebSocketServerLike` under it.
- `pnpm install` added a `minimumReleaseAgeExclude` list to `pnpm-workspace.yaml` for three recently published packages (pnpm 12 supply-chain default).
- Matrix test audit (orchestrator): the Launch and --no-open rows had no automated test (verified by hand only). Added `tests/launcher.test.ts` (runs the real `bin/ogdenmad.js --no-open --port 0`, fetches the page, SIGTERM exits 0; invalid `--port` exits 2) and `packages/server/test/open.test.ts` (mocks `open`: called with the URL when asked, not otherwise, and a failure only warns). `pnpm test` now builds first so the launcher test runs against real output. Result: 15 tests in 4 files pass, none skipped; typecheck clean.
- 2026-09-29: the user published the empty placeholder `ogdenmad@0.0.0` (npm account `harrisonsmith.ai`, web 2FA) from a separate folder, reserving the name; the first real release is `0.1.0` (story 1.10).

## Plan Change Log

## Review Triage Log

### Pass 1 (quick lens) — 2026-09-29

Counts: high 0, medium 1, low 5, false 1, maybe-false 0; rejected as plan edits 2.

| # | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|
| 1 | `tests/architecture.test.ts` checks declared deps only; undeclared `@ogdenmad/*` imports resolve via root `node_modules` | medium | patch | Root depends on `@ogdenmad/server`, and Node resolution walks up, so AD-1 can erode silently in later epics. Fix: scan `src` import specifiers too (test-only, no public surface). |
| 2 | `packages/web/src/App.tsx` duplicates `server.started` on every reconnect | low | patch | The bus replays the latest event to each subscriber and the page appends; sleep/wake triggers it. Fix: clear the list on open. |
| 3 | `bin/ogdenmad.js` accepts `--port ""` as 0 and `0x10` as 16 | low | patch | `Number('')` is 0. Fix: digits-only check before converting. |
| 4a | `start.ts` "No free port" message names ports beyond 65535 never tried | low | patch | The loop breaks above 65535 but the message uses `requested + PORT_ATTEMPTS - 1`. Fix: report the last candidate tried. |
| 4b | `start.ts` drops an HTTP server on EADDRINUSE without closing it | false | reject | A server whose `listen` failed holds no socket or handle; nothing leaks. |
| 5 | `start.ts` warns "default port was busy" for an explicit `--port` | low | patch | Fallback applies to explicit ports too, so the message is wrong there. Fix: reword and update the test. |
| 6 | pnpm not pinned to the Stack's 12.8 | low | patch | The plan's Always says use Stack versions; no `packageManager` field. Fix: `packageManager: pnpm@12.8.1`. |
| 7 | hitl npm reservation unchecked while in review; root is `private: true` | — | reject | The fix is a plan or process change: the human step is handled at present time, and the placeholder publishes from a separate folder. |
| 8 | Design Notes say tsdown bundles `bin`; it does not | — | reject | The fix is an edit to this build's plan (Implementation Notes already record the real build). |

## Design Notes

- Build: `tsdown` bundles `server` and `bin` into `dist`, and Vite builds `web/dist`; `tsc --noEmit` type-checks. `pnpm start` = build, then `node bin/ogdenmad.js`. Story 1.2 turns this into one publishable package.
- Default port: a fixed default (proposed `4317`) with fallback to the next free port, so bookmarks usually keep working. Story 1.4's port file makes discovery exact.
- Deferred to story 1.3: the architecture's envelope requires `workspaceId`, but install-level events such as `server.started` have no workspace. Story 1.3 must settle this (for example a nullable `workspaceId` or a reserved system stream) and report it back to the architecture.

## Verification

**Commands:**
- `pnpm install && pnpm typecheck` -- expected: no type errors.
- `pnpm test` -- expected: architecture and server tests pass.
- `pnpm build && node bin/ogdenmad.js --no-open` -- expected: prints `http://127.0.0.1:<port>`; `curl` of that URL returns the page HTML.

**Manual checks (if no CLI):**
- `pnpm start` opens the browser, and the page lists `server.started` with a time and version while showing "connected".
