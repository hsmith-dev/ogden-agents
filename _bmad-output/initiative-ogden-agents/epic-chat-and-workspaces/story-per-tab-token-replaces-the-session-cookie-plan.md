---
title: 'Per-tab token replaces the session cookie'
type: 'feature'
ticket: '1'
created: '2026-09-30'
status: 'built'
baseline_revision: '4c0f75deae2b97dab8ad1981728eacf927e39b85'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/epic-chat-and-workspaces.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Browsers send cookies for `127.0.0.1` to every port on it (RFC 6265 §8.5), so any other local web server the user opens receives the `ogden_session_<port>` cookie and can replay it with forged `Host` and `Origin` headers. Before epic 2 gives the server control of agents that run commands, API and WebSocket access must not ride on that cookie (story 1.4 review; deferred-work.md).

**Approach:** Replace the cookie with a **per-tab bearer token** that other local servers never see. The launcher opens `/#c=<launch code>`, and the page exchanges the code for its token in a same-origin POST, so the token never appears in a URL. The page keeps the token in memory and `sessionStorage` (both scoped to the origin, including the port), strips it from the URL, and sends it as `Authorization: Bearer` on REST and as a WebSocket subprotocol. The app's static files carry no data and load without auth, so a tab without a token shows the app's own "open Ogden Agents" state.

## Decisions

**Amended AD-15 (approved with this plan):**

> **AD-15 — One security gate.** The server binds only to `127.0.0.1`. Every HTTP and WebSocket request passes one middleware that checks, in order:
> 1. `Host` exactly `127.0.0.1:<port>` or `localhost:<port>`, otherwise 403.
> 2. The launcher opens `/#c=<launch code>`. The page's boot script sends the single-use launch code, valid for 60 seconds, in a same-origin `POST /api/tab/exchange` (Host and Origin checked, no token needed). The response body carries a new random per-tab token (256 bits, held in server memory until Quit, restart, or 12 hours unused). The token never appears in any URL. No cookie is set. *(Renegotiated by the user, 2026-09-30, after the security review found `/#t=<token>` recorded in browser history; the Approach and Boundaries lines were updated to match.)*
> 3. Static app files (the built UI) are served without a token; they contain no user data.
> 4. Every API request needs `Authorization: Bearer <tab token>`. Every WebSocket upgrade needs the subprotocols `ogden.v1` and `ogden.auth.<token>`, and the server echoes only `ogden.v1`. Otherwise 401.
> 5. WebSocket upgrades and every method other than GET, HEAD and OPTIONS also need a matching `Origin`, otherwise 403.
> 6. `/launcher/*` is reachable only with the launcher token (unchanged).
>
> No route is registered outside the gate. Tokens and codes never appear in logs or events, and the `Sec-WebSocket-Protocol` and `Authorization` headers are redacted. The app sends a Content-Security-Policy that allows only its own scripts: no inline script and no third-party origins.

**Launch copy (approved with this plan):**
- A tab without a token shows **"Open Ogden Agents"**, with the body: *"This tab isn't connected. Open Ogden Agents from its shortcut, or run `npx ogden-agents` in a terminal."* It has a Copy button for the command. Until story 2.4 ships the shortcut, the shortcut clause is left out.
- **New tab** in the sidebar footer menu opens another connected tab.

## Boundaries & Constraints

**Always:**
- The cookie is removed entirely: no `Set-Cookie`, and cookies are ignored for auth. `auth.key` and the signed-cookie code are deleted or retired. Existing cookies in browsers are simply ignored.
- Token checks use constant-time comparison. Tokens are minted only by `POST /api/tab/exchange` redeeming a launch code; `POST /api/launch-codes` (authenticated) returns a fresh launch URL for New tab.
- The page reads `#c=` in a boot script before the app renders, calls `history.replaceState` to drop the fragment, exchanges the code, and keeps the token in `sessionStorage`, so a reload in the same tab keeps working. A new tab or a bookmark has no token and shows the launch state.
- CSP: no inline scripts. The pre-paint appearance script from story 1.6 moves into a same-origin file (or uses a build-time hash), and the gate's server-rendered launch page is retired in favor of the app's own launch state.
- The launcher opens `/#c=<code>`; its handshake still uses the launcher token.
- Every existing test, the e2e suite and the smoke script authenticate through the new flow.

**Never:**
- No cookie of any kind for auth; no token in a query string or in logs.
- No change to the Host or Origin rules or to the launcher token.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Launch | Launcher opens `/#c=<code>` | The page exchanges the code for a token over POST, strips the fragment, and connects; no token ever in a URL or history | — |
| Cookie only | API or WS request with a valid old cookie and no token | 401 | — |
| Token | The same request with `Bearer <token>` or the WS subprotocol | Passes; the WS echoes only `ogden.v1` | — |
| Reload | Reload the connected tab | Still connected (token from `sessionStorage`) | — |
| New tab | Sidebar menu > New tab | A second tab opens connected, with its own token | — |
| Bookmark | Plain URL in a fresh tab | App loads and shows "Open Ogden Agents" | — |
| Wrong token | Tampered or expired token | 401, and the tab shows the launch state | — |
| Restart | Server restarted | Old tabs show the launch state or stopped state; relaunch opens a new tab | — |
| No Origin | WS upgrade with a valid token but a foreign Origin | 403 | — |
| Logs | Any request carrying a token | Logs show no token or subprotocol value | — |
| CSP | App pages | The CSP header is present, and the app works with no inline script | — |

</frozen-after-approval>

## Code Map

- `packages/server/src/gate.ts` -- the current gate: Host, then `/auth` (sets the cookie, 303 to `/`), then cookie (`sessionCookieName(port)`), then Origin; `/launcher/*` uses the launcher token. Rework it to the amended rule.
- `packages/server/src/auth.ts` -- launch codes (keep), signed cookie sessions and `auth.key` (retire), `sessionCookieName` (remove). Add an in-memory tab-token store.
- `packages/server/src/app.ts` -- routes; static serving and the SPA fallback (1.6); add `POST /api/launch-codes`, CSP headers, and WS subprotocol handling (`@hono/node-server` `upgradeWebSocket` with `ws`; verify how the chosen subprotocol is echoed, e.g. `handleProtocols` on the `WebSocketServer`).
- `packages/server/src/log.ts` -- the JSON logger; add header redaction.
- `packages/web/index.html` and `vite.config.ts` -- the inline pre-paint script and the appearance-key injection (1.6) must become CSP-safe.
- `packages/web/src/events/` -- the WebSocket client (seq resubscribe, `caught_up`, `server.stopping`); add the token subprotocol. Every `fetch` (quit, toolchain once 1.8 lands) adds Bearer through one helper.
- `packages/web/src/shell/` -- the footer menu gets New tab; the app-level launch state (`routes/` or a shell state) replaces the gate's HTML page.
- Tests: `packages/server/test/gate.test.ts`, `handshake.test.ts` and `start.test.ts` helpers (`signIn`/`exchange`), `tests/launcher.test.ts`, `tests/e2e/*`, and `scripts/smoke-installed.mjs` all use the cookie today.
- Architecture: update AD-15's text in `architecture-ogden-agents.md` to the amended rule above, plus a memlog entry.

## Tasks & Acceptance

**Execution:**
- [x] Server: the tab-token store, the reworked gate, `POST /api/launch-codes`, WS subprotocol auth with an echo of `ogden.v1`, CSP, header redaction; retire the cookie code and `auth.key`.
- [x] Web: the boot script (CSP-safe) that reads and strips `#t=`; the token in memory and `sessionStorage`; a Bearer fetch helper; the WS subprotocol; the launch state; New tab.
- [x] Update every test, the e2e suite and the smoke script to the new flow; add tests for every matrix row.
- [x] The architecture's AD-15 text and memlog; README Security section.

**Acceptance Criteria:**
- Given a valid old session cookie only, when API and WS requests are made, then they're refused; with the tab's token they pass.
- Given a connected tab, when New tab is used, then a second connected tab opens; a bookmarked URL shows the launch state.
- Given the app, when loaded, then a CSP without inline scripts is in force and everything works.

## Implementation Notes

- **Server.** `auth.ts` now holds launch codes and the in-memory `TabTokens` store (SHA-256 digests, constant-time lookup, 12 h idle expiry; an open `/ws` holds its token so a connected tab never expires). `auth.key`, `createSessions`, `loadOrCreateAuthKey` and `sessionCookieName` are gone; core's constant is now `LEGACY_AUTH_KEY_FILE`, and `start()` deletes a leftover `auth.key`. `gate.ts` follows the amended order: Host, the launcher prefix (unchanged, matched right after Host), `/auth` (303 to `/#t=<token>`, `Cache-Control: no-store`, no cookie), static GET/HEAD outside `/api` and `/ws` without a token, then Bearer or the WS subprotocol (401), then Origin (403). The CSP is set by the gate on every non-upgrade response, with `connect-src` naming `ws://127.0.0.1:<port>` and `ws://localhost:<port>` explicitly for browsers where `'self'` doesn't cover `ws:`. `style-src` keeps `'unsafe-inline'` (components set inline styles); only scripts are locked down.
- **WS echo.** `WebSocketServer({ handleProtocols: chooseWebSocketProtocol })` in `start.ts` echoes only `ogden.v1`, whatever order the client offers (`ws`'s default would echo the first offer, which could be the token).
- **Routes added.** `POST /api/launch-codes` (201 `{ launchUrl }`, built on the request's validated Host so a `localhost` tab's new tab stays on `localhost`) and `GET /api/tab` (204). The second is not named in the plan: a browser can't see the HTTP status of a refused WebSocket upgrade, so after a socket closes the page asks `/api/tab` whether its token is still good; 401 shows the launch state, a network error keeps reconnecting. Shared path constants live in `packages/shared/src/tab-token.ts`.
- **Logs.** `log.ts` redacts `Authorization`, `Sec-WebSocket-Protocol`, `Cookie`, `Set-Cookie` and the launcher-token header by field name at any depth, plus `Bearer …`, `ogden.auth.…`, `?code=…` and `#t=…` inside any string; `serve.ts` redacts captured stdio too.
- **Web.** `packages/web/boot/boot.js` replaces the inline pre-paint script: a same-origin classic script (`/boot.js`, emitted by a Vite plugin with the shared constants filled in) that applies appearance and moves `#t=` to `sessionStorage` then `history.replaceState`s it away. `src/auth/tab-token.ts` holds the token in memory and adds Bearer with `credentials: 'omit'`; a 401 forgets it. The event stream offers the subprotocols and gains a `not-connected` status; `AppShell` renders `OpenOgdenAgents` (the approved copy, shortcut clause left out). New tab is a footer button beside Settings and Quit (opens `about:blank` inside the click to avoid the pop-up blocker, nulls `opener`, then navigates to the fresh launch link).
- **Tests.** Server helpers return `{ token, headers, protocols }`; `gate.test.ts` covers every server-side matrix row (launch, cookie only, token and echo, bookmark, wrong token, expiry and hold, new tab, restart, Origin, logs, CSP, legacy key). The retired launch-page drift checks in `tests/design-tokens.test.ts` were removed with the page. E2E: `tab.ts` gets a fresh launch link from the launcher handshake for each tab (a token can't be shared through `storageState`); `tab-token.spec.ts` covers launch, subprotocol echo, reload, New tab, bookmark, wrong token, cookie only and CSP; the restart test now expects the launch state, and reconnect catch-up is tested by dropping the socket through `page.routeWebSocket`.
- **Not changed.** EXPERIENCE.md still describes the cookie-era launch page (Launch page row, State Patterns "Unauthenticated", Flow 3 step 2, the cookie-lifetime open question); the epic assigns that copy change to this entry, but this plan lists only the architecture and README, so it is left for the UX owner. CHANGELOG has no entry yet.
- Orchestrator: rebased onto the updated planning branch (1.8 inserted below); the implementer resolved conflicts in app.ts, start.ts and the shared index, keeping 1.8's toolchain routes behind the new Bearer gate. Matrix audit: all 11 rows covered by `packages/server/test/gate.test.ts`, `auth.test.ts`, `log.test.ts`, `packages/web/test/tab-token.test.ts` and `tests/e2e/tab-token.spec.ts`. Extra route `GET /api/tab` (token validity probe after a WS close) is flagged for review.

## Plan Change Log

- 2026-09-30, security review (user renegotiated Decisions step 2 and the Launch row): the launch link is now `/#c=<code>`; the boot script strips it with `history.replaceState` (fallback `location.replace`, never `location.hash`), POSTs the code to `/api/tab/exchange` (Host and Origin checked, no Bearer) and takes the token from the response body, so no URL or history entry ever holds a token. `GET /auth` is retired (it now loads the app, whose launch state shows). The app renders after the exchange settles, and a launch link pasted into an open app tab reloads it so the boot script runs. Also from the review: the WebSocket subprotocol authenticates only a real upgrade (`Connection: upgrade`) to `/ws`, every response carries the CSP, one `paths.ts` helper drives both the gate and the SPA fallback (`/api`, `/ws` and below never get `index.html`), a test enumerates the registered routes, `redact` replaces too-deep values and redacts `token` only when it is a string (the launcher's boolean is now `launcherTokenFound`), and the architecture and README gained the multi-user launch-URL known limit. Where the Implementation Notes above say `/auth` or `#t=`, this entry supersedes them.

## Review Triage Log

### Pass 1 (security lens) — 2026-09-30

Counts: medium 4, low 5; one routed to the user (renegotiated); one pre-existing, documented. Held up: path tricks, constant-time checks, echo of only `ogden.v1`, foreign/null Origin 403, no cookie path left.

| # | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|
| 1 | A fake `Upgrade` header plus the subprotocol token authenticates `/api/*` without Bearer and skips the CSP | medium | patch | Only a real upgrade (`Connection: upgrade`) to `/ws` accepts the subprotocol; CSP on every response; tests. |
| 2 | The token-free exemption is path-based, so a future GET route would be public | medium | patch | The static handler skips server paths; a route-enumeration test fails on any new page-level route. |
| 3 | `/#t=<token>` is recorded in browser global history and autocomplete | medium | intent_gap → user renegotiated AD-15 step 2 | Launcher opens `/#c=<code>`; the page exchanges it via `POST /api/tab/exchange`; e2e asserts no URL or history entry holds the token. |
| 4 | The boot fallback `location.hash = ''` pushes history | low | patch | `location.replace`. |
| 5 | Another local account can race the launch code seen in `ps` | low | defer (pre-existing since 1.4) | Documented as a known limit in AD-15 and the README; 60 s single-use codes; one user per install. |
| 6 | `redact` returns values nested deeper than 8 levels unredacted | low | patch | `[too deep]`. |
| 7 | `token` field redaction hides a boolean diagnostic | low | patch | String-only redaction; field renamed `launcherTokenFound`. |
| 8 | EXPERIENCE.md still cookie-era | medium | patch (orchestrator) | Updated via bmad-ux update mode: launch state, Not connected, Flow 3 via app shortcut, question resolved; memlog entries. |
| 9 | SPA fallback and gate disagree on `/api`, `/ws/` | low | patch | One `paths.ts` helper. |
| 10 | The cookie-only e2e test checks fetch only | low | patch | Also asserts a cookie-only `/ws` upgrade is refused. |

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test` -- expected: all pass.
- `pnpm e2e` -- expected: all pass, including the launch, reload, new tab, bookmark and CSP checks.
- `pnpm pack && node scripts/smoke-installed.mjs` -- expected: exit 0.
