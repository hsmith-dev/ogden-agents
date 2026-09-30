---
title: 'Security gate'
type: 'feature'
ticket: '4'
created: '2026-09-29'
status: 'built'
baseline_revision: 'c4d87411c27222820fed9b5d3428847819e72474'
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

**Problem:** Any web page the user visits, or any other local process, can reach the Ogden Agents server on `127.0.0.1`: read its event stream now and, in later epics, drive agents that run commands. There is no authentication, no `Host` or `Origin` check, and the launcher has no way to find a running server.

**Approach:** Put every HTTP and WebSocket route behind one gate (AD-15). The launcher opens the browser at a single-use launch URL whose code, valid for 60 seconds, is exchanged for a signed `HttpOnly`, `SameSite=Strict` session cookie. Every request must carry a valid cookie and an exact loopback `Host`, and WebSocket upgrades and state-changing requests must carry a matching `Origin`. The server writes a user-only port file in the data folder.

## Boundaries & Constraints

**Always:**
- The server keeps binding only `127.0.0.1`.
- There is one gate middleware for all routes, registered before any of them. The only route reachable without a cookie is the code exchange `GET /auth?code=…`, and it still passes the `Host` check. No route is registered outside the gate.
- Allowed `Host` values: exactly `127.0.0.1:<port>` or `localhost:<port>` for the bound port.
- `Origin` is required and must equal `http://127.0.0.1:<port>` or `http://localhost:<port>` on WebSocket upgrades and on every method other than GET, HEAD and OPTIONS.
- Launch codes: at least 128 bits of randomness, single-use, expire 60 seconds after issue, kept in memory only, compared in constant time.
- The session cookie is `HttpOnly; SameSite=Strict; Path=/` and lasts 30 days. Its value is a random session ID plus an expiry, signed with HMAC-SHA256 using a 32-byte key in `<dataDir>/auth.key` (mode 0600, created if missing). So cookies survive server restarts, and deleting the key file logs everyone out.
- The port file `<dataDir>/server.json` holds `{ port, pid, version, startedAt }`, is mode 0600, and is written after binding and removed on close.
- Refusals leak nothing: 401 for a missing or invalid cookie, 403 for a bad `Host` or `Origin`, with no event data in the body. An unauthenticated `GET /` gets a small page telling the user to run `npx ogden-agents` (or `ogden`) to open the app.
- Secrets never appear in logs or events (AD-16). Launch codes are logged only as "issued" or "used" with no value.

**Never:**
- No login, password or user accounts; there's one user per install.
- No background detaching or launcher-to-running-server handshake (story 1.7). Here the launcher still starts the server in-process and gets its launch URL from `start()`.
- No HTTPS, and no remote access.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Launch | Launcher starts the server | The browser opens `/auth?code=…`, which sets the cookie and redirects (303) to `/`; the page and `/ws` work | No error expected |
| No cookie | `GET /`, an asset, or a `/ws` upgrade without a cookie | `/` gets the "open from your terminal" page (401); an asset gets 401; `/ws` is refused | — |
| Code reuse | Second exchange of the same code | 401, no cookie set | Logged "launch code rejected", with no value |
| Code expiry | Exchange 61 s after issue | 401 | Same |
| Bad Host | Any request with `Host: evil.example:<port>` or a wrong port | 403 | — |
| Bad Origin | `/ws` upgrade or POST with a missing or foreign `Origin`, even with a valid cookie | 403 | — |
| Tampered cookie | Cookie with an altered ID, expiry or signature, or expired | 401 | — |
| Restart | Server restarts on the same data folder | An existing valid cookie still works | — |
| Port file | Server running, then closed | `server.json` exists with mode 0600 and the right port and pid, and is gone after close | — |

</frozen-after-approval>

## Code Map

Baseline `fb8d2c4` (1.1–1.3 and the rename, on `story/1.4-security-gate`).

- `packages/server/src/app.ts` -- `createApp({ events, webRoot, log })`: `/ws` via `upgradeWebSocket`, then `serveStatic` and a 503 "not built" handler. Add the gate as the first middleware and the `/auth` exchange; the gate needs the bound port, so pass a port getter or build the app after binding.
- `packages/server/src/start.ts` -- binds with port fallback, appends `server.started`, and opens `url`. It must: issue a launch code after binding, open the launch URL, return `launchUrl` alongside `url`, write and remove the port file, and load or create `auth.key`.
- `packages/core/src/data-dir.ts` -- `createDataDir` (mode 0700). Put the auth key and port file here.
- `bin/ogden.js` -- prints "Ogden Agents is running at <url>". It must also print the launch URL, so a user whose browser didn't open can click it.
- `tests/launcher.test.ts`, `scripts/smoke-installed.mjs`, and `packages/server/test/{start,open}.test.ts` -- these reach `/` and `/ws` without auth today. Give them an auth helper: exchange the launch code, keep the cookie, and send it with a matching `Origin`. Node's global `WebSocket` may not accept custom headers: use `ws`, which takes `headers`, in tests; in the installed smoke test, use `ws` from the temp install's `node_modules`, or a raw HTTP upgrade.
- Node built-ins cover the crypto: `crypto.randomBytes`, `createHmac`, `timingSafeEqual`. No new dependency.

## Tasks & Acceptance

**Execution:**
- [x] `packages/server/src/auth.ts` -- load or create the key, issue and redeem launch codes (in memory, 60 s, single use), and sign and verify session cookies. Pure functions plus a small store.
- [x] `packages/server/src/gate.ts` -- the single Hono middleware: `Host` check, then the `/auth` exchange, then cookie check, then `Origin` check for upgrades and non-GET, HEAD and OPTIONS requests.
- [x] `packages/server/src/app.ts` and `start.ts` -- register the gate first, then the routes; issue the code after binding; open and return `launchUrl`; write and remove `server.json`.
- [x] `bin/ogden.js` -- print the launch URL next to the base URL.
- [x] `packages/server/test/gate.test.ts` -- every matrix row, with the clock injected for expiry.
- [ ] Update the existing server tests, `tests/launcher.test.ts` and `scripts/smoke-installed.mjs` to authenticate through the launch URL.
- [x] `README.md` -- a short "Security" section: loopback only, launch link, cookie, and the `auth.key` / `server.json` files.

**Acceptance Criteria:**
- Given a running server, when scripted requests arrive without the cookie, with a foreign `Host`, or as a WebSocket upgrade with a foreign `Origin`, then each is refused.
- Given a fresh launch code, when it's exchanged once, then a cookie is set and the page and `/ws` work; a second exchange, or one after 60 seconds, is refused.
- Given the full suite, when `pnpm test` and the clean-install smoke test run, then both pass through the gate.

## Implementation Notes

- The auth key and port file names are `AUTH_KEY_FILE` and `PORT_FILE` in `packages/core/src/data-dir.ts`; the files are written by `packages/server` (`auth.ts`, `start.ts`).
- The gate is a required `gate` option of `createApp`, registered with `app.use('*', gate)` before any route; `gate.test.ts` asserts it is `app.routes[0]`. The app is built before binding, so the gate reads the port through a getter and refuses everything (403) until the port is known.
- Launch codes are 256-bit base64url strings, stored only as SHA-256 digests and compared with `timingSafeEqual` against every live one. Cookie value: `<id>.<expiry seconds>.<base64url HMAC-SHA256>`, cookie name `ogden_session`.
- `start()` takes an optional `now` clock (tests). `server.json` is written atomically (temp file plus rename) and removed on close only if it still names this server (pid, port, startedAt).
- The installed smoke test loads `ws` from the npx cache (`<cache>/_npx/*/node_modules/ws`).
- Orchestrator: the uncommitted 1.4 work was rebased (stash, rebase, pop; no conflicts) from `fb8d2c4` onto `c4d8741`, which adds only 1.3's Windows data-folder test fix and a CI note; `baseline_revision` moved with it. Matrix audit: all 9 rows are covered in `packages/server/test/gate.test.ts` (16 tests) against a real server with an injected clock.

## Plan Change Log

## Review Triage Log

### Pass 1 (quick lens) — 2026-09-29

Counts: high 0, medium 1, low 3, false 0, maybe-false 0; rejected as plan edits 1. No acceptance criterion unmet. The reviewer cited a `packages/server/CLAUDE.md`; it doesn't exist on disk or in any commit (misstatement, disregarded).

| # | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|
| 1 | Concurrent first starts can leave two servers with different auth keys (a `wx` half-written file read as corrupt) | low | patch | Fixed: the key is written to a temp file and linked into place; on `EEXIST` the other process's key is read and never overwritten; `auth.test.ts` added. |
| 2 | The session cookie isn't port-bound, so loopback cookies go to every port and another local server could replay it | medium | intent_gap → user: mitigate now, fix before epic 2 | Mitigated: cookie named `ogden_session_<port>`, with tests (the restart test uses the same port; a foreign-port cookie gets 401); the limit is documented in the README. The AD-15 amendment (per-tab token for API and WS) is recorded in the architecture memlog, epic 2's Notes and deferred-work.md. |
| 3 | `server.started` is appended before the port file write, so a failed start leaves a false start event | low | patch | Fixed: the port file is written first, with the same cleanup. |
| 4 | `StartOptions.open` doc says it opens the server URL | low | patch | Fixed: it names the single-use launch URL. |
| 5 | One task checkbox unticked | — | reject | The fix is an edit to this build's plan. |

Also: the gate tests' HTTP helper uses `agent: false`, so a restart on the same port doesn't reuse a kept-alive socket (ECONNRESET).

## Design Notes

- A signed cookie instead of stored sessions avoids a new table and keeps core's entities unchanged. The cost is that individual sessions can't be revoked; rotating `auth.key` logs out everyone, which is acceptable with one user per install.
- `SameSite=Strict` plus the exact `Host` and `Origin` checks blocks both cross-site requests and DNS rebinding. The cookie set on `127.0.0.1` isn't sent to `localhost`; the launcher always opens `127.0.0.1`.
- The 303 redirect after the exchange takes the code out of the address bar. It may stay in history, but it's already spent.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test` -- expected: all pass, including `gate.test.ts`.
- `pnpm pack && node scripts/smoke-installed.mjs` -- expected: exit 0 after authenticating through the launch URL.
- `curl -si http://127.0.0.1:<port>/` with no cookie -- expected: 401 with the "open from your terminal" page.

**Manual checks (if no CLI):**
- `pnpm start` opens the browser, which lands on `/` connected, with the code gone from the address bar; opening the plain URL in a private window shows the "open from your terminal" page.
