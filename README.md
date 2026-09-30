# Ogden Agents

[![CI](https://github.com/hsmith-dev/ogden-agents/actions/workflows/ci.yml/badge.svg)](https://github.com/hsmith-dev/ogden-agents/actions/workflows/ci.yml)

A local browser UI for running BMAD with coding agents. Early development: the current build is the tracer bullet from launcher to live page.

## Install

Ogden Agents runs with one command and needs no checkout:

```sh
npx ogden-agents
```

Installed globally (`npm install -g ogden-agents`), the command is `ogden`.

To run it from a checkout instead, see below. Release notes are in [CHANGELOG.md](https://github.com/hsmith-dev/ogden-agents/blob/main/CHANGELOG.md).

## Requirements

- Node.js 24 or later
- pnpm 12

## Run

```sh
pnpm install
pnpm start            # builds, starts the server on 127.0.0.1, opens the browser
```

The page shows the connection state and lists logged events (currently one `server.started` per server start). Events persist across restarts, and a reloaded or reconnected page catches up from the last event it saw.

Ogden Agents keeps its SQLite database (`ogden-agents.db`), logs (`logs/server.log`), session key (`auth.key`) and port file (`server.json`) in your OS per-user data folder under `ogden-agents/` (for example `~/Library/Application Support/ogden-agents` on macOS). Set `OGDEN_AGENTS_DATA_DIR` to use another folder. Nothing is written into your repos.

To change the database schema, edit `packages/core/src/db/schema.ts`, run `pnpm --filter @ogden-agents/core db:generate`, and commit the new migration in `packages/core/drizzle/`.

Launcher options (after `pnpm build`):

```sh
node bin/ogden.js --no-open     # print the URL and one-time link only; don't open a browser
node bin/ogden.js --port 5000   # a new server tries this port first
node bin/ogden.js --foreground  # run the server in this terminal (Ctrl+C stops it), for development
```

By default the launcher starts the server as a background process and exits, so the server keeps running after you close the terminal; its output goes to `logs/server.log` in the data folder. Running the launcher again finds that server (through `server.json` and the launcher handshake) and opens it with a fresh one-time link. Stop it with **Quit Ogden Agents** in the app's sidebar footer (it confirms first, and names any agents still working). Only one server runs per data folder (`server.lock`); a second one, such as `--foreground` beside a background server, refuses to start. If an older version is running and no session is busy, the launcher restarts it on the new version; if sessions are busy, it opens the running version and the update applies on a later launch once they finish. The page shows a reload banner when the server's version differs from its own.

The server binds only to `127.0.0.1`. It tries port 4317 first and moves to the next free port if that one is busy; the URL it prints is the one in use.

## Security

Ogden Agents is for one user on one machine, and it keeps other web pages and local processes out:

- **Loopback only.** The server listens only on `127.0.0.1`; there is no remote access and no HTTPS. It answers only requests addressed to `127.0.0.1:<port>` or `localhost:<port>`, which blocks DNS rebinding.
- **Launch link.** The launcher opens the browser at a one-time link (`/auth?code=…`) and also prints it, so you can click it if no browser opened. The link works once, within 60 seconds. Opening the plain URL without it shows a page asking you to run `npx ogden-agents` (or `ogden`) again.
- **Session cookie.** The link is exchanged for a signed `HttpOnly`, `SameSite=Strict` cookie that lasts 30 days, and every request and WebSocket must carry it. WebSocket connections and requests that change state must also come from the app's own page (a matching `Origin`).
- **Files in the data folder**, both readable only by you:
  - `auth.key` signs the session cookies, so a browser stays signed in across restarts. Delete it to sign every browser out.
  - `server.json` holds the running server's `port`, `pid`, `version` and `startedAt`. It is written when the server starts and removed when it stops.
  - `launcher.token` is a random secret the server creates on every start and removes when it stops. The launcher sends it to reach the handshake (`/launcher/…`), which reports the server's version and issues launch links; it opens nothing else, and no cookie opens the handshake.

Launch codes, the launcher token and cookies never appear in the logs or the event log.

**Known limit.** Browsers send cookies for `127.0.0.1` to every port on it, so any other local web server you open in the same browser also receives the session cookie (named `ogden_session_<port>`, so installs on different ports don't overwrite each other). Before agents can run commands (epic 2), API and WebSocket access moves to a per-tab token that other local servers never see.

## Develop

```sh
pnpm typecheck   # tsc across every package, the launcher and the tests
pnpm test        # builds, then Vitest: architecture, packaging, design-token, launcher and server tests
pnpm e2e         # builds, then Playwright (Chromium): shell layout at 1440/900/390, theme, density, launch page
pnpm build       # tsdown bundles packages/server, Vite builds packages/web, both copied into dist/
pnpm run pack    # builds, then writes the publishable tarball ogden-agents-<version>.tgz
pnpm smoke       # installs that tarball with npx in an empty temp dir and checks it serves the page
```

The root `ogden-agents` package is the only publishable artifact. `pnpm build` writes a self-contained `dist/` (`dist/server.js`, the server with every `@ogden-agents/*` package bundled in, and `dist/web/`, the UI), and `bin/ogden.js` loads it by relative path. Third-party runtime dependencies are declared in the root `dependencies`; `tests/packaging.test.ts` fails if the bundle imports anything undeclared or the tarball picks up workspace sources.

CI runs typecheck, tests, pack and the clean-install smoke test on macOS, Windows and Linux, each on Node 24 and 26, plus the Playwright browser tests on Linux Chromium.

Releases are published to npm only by GitHub Actions, from a version tag on `main`, after the same CI passes; see [RELEASING.md](https://github.com/hsmith-dev/ogden-agents/blob/main/RELEASING.md).

## Layout

The monorepo follows the hexagonal layout in the architecture (AD-1). `tests/architecture.test.ts` fails if a package declares a dependency outside these edges.

| Path | Role | May depend on |
| --- | --- | --- |
| `bin/ogden.js` | Launcher | `server` |
| `packages/server` | Delivery: HTTP and WebSocket, wiring | `core`, `adapters`, `shared` |
| `packages/adapters` | Agent, OS, sandbox and tool adapters | `core`, `shared` |
| `packages/core` | Domain, ports, event log | `shared` |
| `packages/web` | React UI | `shared` |
| `packages/shared` | Zod schemas and types (the contract) | nothing internal |
