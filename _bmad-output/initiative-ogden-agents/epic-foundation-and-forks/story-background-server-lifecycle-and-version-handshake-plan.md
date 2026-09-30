---
title: 'Background server lifecycle and version handshake'
type: 'feature'
ticket: '7'
created: '2026-09-29'
status: 'built'
baseline_revision: 'c0614a81dd8c069d1c35545cbeafa8c003c9bbb5'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The server lives inside the launcher's terminal process: closing the terminal stops Ogden Agents, a second launch starts a second server on the next port, an expired launch link means a restart, and nothing stops a newer launcher from talking to an older server (AD-3, AD-20).

**Approach:** `npx ogden-agents` (or `ogden`) starts the server as a detached background process if none is running, or attaches to the running one. Either way it gets a fresh single-use launch link from the server and opens the browser. The launcher and a running server talk over an authenticated local handshake that reports the server's version and issues launch codes. An older server is offered a restart once no session is busy, and it's never stopped mid-work. The UI gets **Quit Ogden Agents** in the sidebar footer, and it tells the user to reload when the server's version differs from its own.

## Boundaries & Constraints

**Always:**
- The launcher finds a running server only through `<dataDir>/server.json` (AD-15), then confirms it with the handshake. A `server.json` whose pid is dead or whose handshake fails is stale: it's removed, and a new server starts.
- The handshake endpoint sits behind the one gate (AD-15). The gate accepts it without a cookie only with the **launcher token**: random, at least 256 bits, created by the server on each start in `<dataDir>/launcher.token` (mode 0600, removed on close), sent in a request header, and compared in constant time. The token and launch codes never appear in logs.
- The handshake returns `{ version, pid, port, busySessions }` and, on request, a fresh launch code. Re-running the launcher always yields a working link.
- Version rule (AD-20): if the running server's version is lower than the launcher's, the launcher asks the server to restart when idle. With no busy sessions (none are `working` or `waiting`), the server shuts down cleanly and the launcher starts the new version. With busy sessions, the launcher tells the user the update will apply when they finish, and opens the running version. Running sessions are never stopped by the launcher. A newer server than the launcher is simply used.
- The background server survives the launching terminal closing on macOS, Linux and Windows. Its stdout and stderr go to the rotating log in the data folder, not the terminal.
- **Quit** (a state-changing POST, so it goes through the gate's Origin check) stops the server cleanly (closing core and removing `server.json` and `launcher.token`). The UI then shows a plain "Ogden Agents has stopped. Run `npx ogden-agents` to start it again." state.
- The UI compares the build version it was built with against `server.started`'s version and shows a non-blocking "Ogden Agents was updated. Reload" banner when they differ (AD-20).
- `--foreground` keeps today's in-terminal behavior for development and tests.
- No standard flow needs the terminal after launch (AD-21).

**Never:**
- No start-at-login, tray icon, or OS service (deferred in the architecture).
- No restart while any session is `working` or `waiting`.
- No new cookie or auth mechanism for browsers; the launcher token is only for the launcher.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Cold start | No server running | The launcher spawns a detached server, waits for the handshake, opens a fresh launch link, prints it, and exits 0 | Times out with a clear message and the log path if the server doesn't come up |
| Terminal closed | Server started by a launcher whose terminal is closed | The server keeps serving; the next launch attaches | — |
| Attach | Server already running, same version | No new process; a fresh launch link opens | — |
| Expired link | The first link's 60 s have passed | Re-running the launcher gives a new working link | — |
| Stale port file | `server.json` names a dead pid, or the handshake fails | The stale file is removed and a new server starts | Logged |
| Older server, idle | Running 0.1.0, launcher 0.2.0, no busy sessions | The old server shuts down cleanly and the new one starts and opens | — |
| Older server, busy | Same versions, one `working` session | The old server keeps running; the launcher prints that the update applies when work finishes, and opens the running version | — |
| Bad token | Handshake without a token, or with a wrong one | 401 | Logged without the value |
| Quit | User clicks Quit in the sidebar footer | The server exits cleanly, the files are removed, and the UI shows the stopped state | — |
| Version drift in UI | Page built for 0.1.0, server now 0.2.0 | Reload banner | — |

</frozen-after-approval>

## Code Map

Baseline `1f5baef` (1.1–1.6, branch `story/1.7-background-server-and-handshake`).

- `bin/ogden.js` -- parses `--port` and `--no-open`, imports `dist/server.js`, calls `start()` in-process, prints URLs, and handles SIGINT/SIGTERM. Becomes the launcher: find or confirm via `server.json` and the handshake, else spawn detached (`process.execPath`, a server entry script, `detached: true`, `stdio: 'ignore'`, `windowsHide: true`, `unref()`); `--foreground` keeps the in-process path.
- `packages/server/src/start.ts` -- binds, writes and removes `server.json` (atomic, pid-checked), issues the launch code, returns `launchUrl`. Add: write and remove `launcher.token`, and graceful shutdown on quit or restart-when-idle.
- `packages/server/src/gate.ts` -- the single gate: Host, then `/auth`, then cookie, then Origin. Add the launcher-token path for the handshake prefix (still Host-checked, constant-time).
- `packages/server/src/app.ts` -- routes behind the gate. Add the handshake route and `POST /api/server/quit`.
- `packages/core` -- `Core.entities` lists sessions with `state` (AD-4), which counts busy sessions (`working`, `waiting`).
- `packages/web/src/shell/` and `src/ui/sidebar.tsx` -- the footer holds Settings and the server status. Add Quit (a confirm-free menu item, per EXPERIENCE.md's footer) and the stopped state; add the version banner.
- `tests/launcher.test.ts`, `scripts/smoke-installed.mjs`, `tests/e2e/` -- currently rely on the in-process launcher printing a URL. Move them to `--foreground`, or to the detached flow with cleanup via Quit.
- Windows: a `detached: true` child gets its own console, and `windowsHide` hides it; closing the parent terminal doesn't kill it. On POSIX, `detached: true` creates a new process group, so SIGHUP from the terminal isn't delivered.

## Tasks & Acceptance

**Execution:**
- [x] `packages/server/src/launcher-token.ts` and `gate.ts` -- create and remove the token file; the gate accepts the token only on the handshake prefix.
- [x] `packages/server/src/app.ts` and `start.ts` -- `GET /launcher/hello` (optionally issuing a launch code), `POST /launcher/restart-when-idle`, `POST /api/server/quit`, and graceful shutdown that closes the server and core and removes both files.
- [x] `packages/server/src/serve.ts` (new entry) plus bundle wiring -- the detached server process entry, logging to the data folder.
- [x] `bin/ogden.js` -- find, attach or spawn, the handshake, the version rule, opening a fresh link, `--foreground`, and clear messages.
- [x] `packages/web` -- Quit in the footer menu, the stopped state, and the version-drift banner.
- [x] Tests: a handshake and gate token test; a launcher integration test (cold start, attach, stale file, older-server idle and busy, using a fake older server that reports a lower version); an e2e test for Quit and the banner; smoke and CI still pass on all three OSes.

**Acceptance Criteria:**
- Given no server, when the launcher runs and its terminal process exits, then the server keeps serving, and a second launch attaches with a fresh working link.
- Given an older server with a busy session, when a newer launcher runs, then the server isn't stopped; with no busy sessions it's replaced.
- Given the UI, when Quit is clicked, then the server exits and removes `server.json` and `launcher.token`.

## Implementation Notes

- The launcher logic lives in `packages/server/src/launcher.ts`, bundled as `dist/launcher.js`; `bin/ogden.js` parses arguments and calls it (or `start()` in-process with `--foreground`). The background entry is `dist/serve.js`. Both share chunks with `dist/server.js`, so the launcher also loads core's modules (including `better-sqlite3`) when it runs.
- Handshake: `GET /launcher/hello[?launch=1]` returns `{ version, pid, port, busySessions[, launchUrl] }`; `POST /launcher/restart-when-idle` answers 202 and stops, or 409 with `busySessions`. Token header: `x-ogden-launcher-token`. The launcher logs to `<dataDir>/logs/launcher.log`.
- "The update applies when they finish" is implemented as: the busy older server is left running and the next launch after the sessions finish replaces it. The server does not schedule a deferred restart by itself.
- The version is `packages/server/package.json`'s (server and launcher) and `packages/web/package.json`'s (UI build, via a Vite define); `tests/packaging.test.ts` requires root, server and web versions to be equal.
- Review round 1: Quit is its own sidebar-footer item that confirms once (EXPERIENCE.md), naming running agents; `POST /api/server/quit` answers 409 with `busySessions` unless the body has `force: true`, which only the confirmation sends. Before a quit or restart the server sends `server.stopping` to every `/ws` client, so every tab shows the stopped state; a page that can't reach the server for 60 s shows it too. `caught_up` follows each subscribe backlog, and the version banner waits for it. `start()` takes `<dataDir>/server.lock` (pid-checked, stale locks taken over), so one server runs per data folder; a losing background server exits with code 3 and its launcher attaches to the winner. The launcher never deletes `server.json`/`launcher.token` while their pid lives ("not responding" instead), kills a spawned server it gave up on, and spawns it with the data folder as cwd. A restart re-checks busy sessions at the moment it stops.
- Orchestrator audit (macOS): all 10 matrix rows covered by `tests/launcher.test.ts` (real bin, fake older/newer servers), `packages/server/test/handshake.test.ts` and `tests/e2e/lifecycle.spec.ts`; 138 tests plus 19 e2e pass; smoke OK. Source conflict: the Code Map said Quit is confirm-free, but EXPERIENCE.md says Quit confirms once, and the spine wins; routed to the review round.

## Plan Change Log

## Review Triage Log

### Pass 1 (quick lens) — 2026-09-30

Counts: high 0, medium 3, low 6; not code 1.

| # | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|
| 1 | Quit fires from the Settings dropdown without the one confirmation EXPERIENCE.md requires, and quits with busy sessions | medium | patch | Source conflict (the plan's Code Map said confirm-free; the spine wins). A footer Quit with a one-step consequence dialog; the server answers 409 `sessions_busy` unless `force`. |
| 2 | Only the quitting tab shows the stopped state; other tabs reconnect forever | medium | patch | `server.stopping` is broadcast before quit or restart; `unreachable` after 60 s; two-tab e2e test. |
| 3 | A failed quit is silent | low | patch | Error shown in the dialog (`role=alert`). |
| 4 | Two servers can share a data folder (simultaneous launchers, foreground beside background, slow-but-live server orphaned) | medium | patch | `instance-lock.ts` (link-into-place, stale by dead pid); the loser exits 3 and its launcher attaches; files are never deleted while their pid is alive; tests for simultaneous and foreground cases. |
| 5 | A timed-out spawned server keeps running | low | patch | `killTree` on timeout (untested path). |
| 6 | The background server inherits the launcher's cwd | low | patch | `cwd: dataDir`. |
| 7 | `restartWhenIdle` checks busy only at request time | low | patch | Re-checked at shutdown; the restart is aborted if busy; tested. |
| 8 | The update banner can flash during backlog replay | low | patch | `caught_up` after the backlog; the banner waits for it; tested. |
| 9 | `dist/serve.js` isn't required by assemble or bin | low | patch | Both now require it. |
| 10 | Windows detached behavior is unproven | — | CI | Settled by this story's PR CI on windows-latest. |

## Design Notes

- The launcher token extends AD-15 without weakening it: the token is readable only by the same OS user who can already read `auth.key`, and it unlocks only the handshake, not the app. It's recorded as an architecture note when this story lands.
- Versions are compared as semver; a pre-release is lower than its release.
- With no sessions yet (epic 2), "busy" is always 0 in practice. The busy path is tested with sessions created through core's entities.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test` -- expected: all pass, including the launcher integration tests.
- `pnpm e2e` -- expected: passes, including Quit and the banner.
- `pnpm pack && node scripts/smoke-installed.mjs` -- expected: exit 0, with the installed launcher starting a detached server and the smoke test quitting it at the end.

**Manual checks (if no CLI):**
- Run `ogden`, close that terminal window, then reload the browser: it still works. Run `ogden` again and a fresh link opens the same server. Click Quit: the page shows the stopped state and `server.json` is gone.
