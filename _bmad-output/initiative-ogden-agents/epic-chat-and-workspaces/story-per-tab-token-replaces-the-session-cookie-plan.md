---
title: 'Per-tab token replaces the session cookie'
type: 'feature'
ticket: '1'
created: '2026-09-30'
status: 'draft'
baseline_revision: '9720249'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/epic-chat-and-workspaces.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Browsers send cookies for `127.0.0.1` to every port on it (RFC 6265 §8.5), so any other local web server the user opens receives the `ogden_session_<port>` cookie and can replay it with forged `Host` and `Origin` headers. Before epic 2 gives the server control of agents that run commands, API and WebSocket access must not ride on that cookie (story 1.4 review; deferred-work.md).

**Approach:** Replace the cookie with a **per-tab bearer token** that other local servers never see. The launch-code exchange redirects to `/#t=<token>`. The page moves the token to memory and `sessionStorage` (both scoped to the origin, including the port), strips it from the URL, and sends it as `Authorization: Bearer` on REST and as a WebSocket subprotocol. The app's static files carry no data and load without auth, so a tab without a token shows the app's own "open Ogden Agents" state.

## Decisions

**Amended AD-15 (approved with this plan):**

> **AD-15 — One security gate.** The server binds only to `127.0.0.1`. Every HTTP and WebSocket request passes one middleware that checks, in order:
> 1. `Host` exactly `127.0.0.1:<port>` or `localhost:<port>`, otherwise 403.
> 2. `GET /auth?code=…`: a single-use launch code, valid for 60 seconds, is exchanged for a new random per-tab token (256 bits, held in server memory until Quit, restart, or 12 hours unused). The response is `303 Location: /#t=<token>`. No cookie is set.
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
- Token checks use constant-time comparison. Tokens are minted only by the `/auth` exchange and by `POST /api/launch-codes` (authenticated) that returns a fresh launch URL for New tab.
- The page reads `#t=` in a boot script before the app renders, calls `history.replaceState` to drop the fragment, and keeps the token in `sessionStorage`, so a reload in the same tab keeps working. A new tab or a bookmark has no token and shows the launch state.
- CSP: no inline scripts. The pre-paint appearance script from story 1.6 moves into a same-origin file (or uses a build-time hash), and the gate's server-rendered launch page is retired in favor of the app's own launch state.
- Launcher behavior is unchanged: it opens `/auth?code=…`, and its handshake still uses the launcher token.
- Every existing test, the e2e suite and the smoke script authenticate through the new flow.

**Never:**
- No cookie of any kind for auth; no token in a query string or in logs.
- No change to the Host or Origin rules or to the launcher token.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Launch | Launcher opens `/auth?code=…` | 303 to `/#t=…`; the page strips the fragment and connects | — |
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
- [ ] Server: the tab-token store, the reworked gate, `POST /api/launch-codes`, WS subprotocol auth with an echo of `ogden.v1`, CSP, header redaction; retire the cookie code and `auth.key`.
- [ ] Web: the boot script (CSP-safe) that reads and strips `#t=`; the token in memory and `sessionStorage`; a Bearer fetch helper; the WS subprotocol; the launch state; New tab.
- [ ] Update every test, the e2e suite and the smoke script to the new flow; add tests for every matrix row.
- [ ] The architecture's AD-15 text and memlog; README Security section.

**Acceptance Criteria:**
- Given a valid old session cookie only, when API and WS requests are made, then they're refused; with the tab's token they pass.
- Given a connected tab, when New tab is used, then a second connected tab opens; a bookmarked URL shows the launch state.
- Given the app, when loaded, then a CSP without inline scripts is in force and everything works.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test` -- expected: all pass.
- `pnpm e2e` -- expected: all pass, including the launch, reload, new tab, bookmark and CSP checks.
- `pnpm pack && node scripts/smoke-installed.mjs` -- expected: exit 0.
