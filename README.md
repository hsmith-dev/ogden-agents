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

## Start Ogden

No terminal needed: download the start script for your computer, double-click it, and Ogden Agents opens in your browser. Download the scripts only from this project's [releases page](https://github.com/hsmith-dev/ogden-agents/releases/latest), where each release also lists their SHA-256 in `SHA256SUMS.txt`; they are also in this repository's [`start/`](start/) folder. The steps below tell your computer to run a script it can't verify, so never follow them for a "Start Ogden" file someone sent you.

First install **Node.js 24 or later** from [nodejs.org/en/download](https://nodejs.org/en/download) (the LTS version is fine). If it's missing or too old, the script tells you so, opens that page, and stops; it never installs anything itself and never asks for an administrator password.

**macOS.** Download `Start-Ogden-macOS.zip` and open it (Safari usually unzips it for you), then double-click **Start Ogden.command**. The script isn't signed by Apple, so the first time macOS refuses it ("unidentified developer", or "Apple could not verify…"):

- macOS 14 Sonoma and earlier: right-click (or Control-click) **Start Ogden.command**, choose **Open**, then **Open** again.
- macOS 15 Sequoia and later: click **Done**, open **System Settings > Privacy & Security**, scroll down to the message about Start Ogden.command, and click **Open Anyway**.

macOS remembers your answer. A Terminal window shows what's happening; you can close it once the browser opens.

**Windows.** Download `Start-Ogden.cmd` and double-click it. It needs no administrator rights and no PowerShell. If Windows shows "Windows protected your PC", click **More info**, then **Run anyway**. The window closes by itself once Ogden Agents opens.

**Linux.** Download `start-ogden.sh`, make it executable once, and run it in a terminal (if your file manager offers **Run in Terminal**, that works too; plain **Run** shows no window, so you wouldn't see an error):

```sh
chmod +x start-ogden.sh
./start-ogden.sh
```

`bash start-ogden.sh` works without the `chmod` too.

**What the script does.** It checks for Node.js, then runs `npx --yes ogden-agents@latest`: the first start downloads Ogden Agents (about a minute), and later starts check for a newer version. Ogden Agents keeps running in the background after the window closes; stop it with **Quit Ogden Agents** in the app, and double-click the script again to reopen it. If something fails, the window stays open with the reason. Options:

- Options after the script name go to Ogden Agents (for example `./start-ogden.sh --port 5000`). The Windows script refuses files and folders (a file dropped on it).
- `--check`, as the first option, only reports the Node.js, npm and package it found, and opens nothing.
- The script runs from your home folder, so npx never picks up settings or packages from the folder you downloaded it to.
- `OGDEN_AGENTS_DATA_DIR` keeps working (see Run). `OGDEN_AGENTS_PACKAGE` picks another package version, such as `ogden-agents@next`.
- **From GitHub Releases instead of npm.** `--github` (first option, or `OGDEN_AGENTS_SOURCE=github`) installs and updates from this project's [GitHub Releases](https://github.com/hsmith-dev/ogden-agents/releases): the script runs `ogden-install.mjs`, which must sit in the same folder as the script (the macOS zip already has it; download it from the same release for the others). It downloads `ogden-agents-<version>.tgz`, refuses to install it unless it matches `SHA256SUMS.txt`, installs it under your own user folder (never globally, no administrator rights), keeps the previous version for rollback, and updates on later starts. It works for a public repository; for a private one it needs `gh auth login` or `OGDEN_AGENTS_GITHUB_TOKEN`, and says so when it can't see the release. Details, channels and rollback: [RELEASING.md](RELEASING.md#installing-and-updating-from-github-releases).

## Agents and how they sign in

Each chat uses one coding agent: Claude Code, Google's Antigravity, or OpenAI's Codex. Claude Code and Antigravity can sign in with your own subscription account. Codex uses your own OpenAI API key only. Signing in with a ChatGPT account isn't supported, because OpenAI's terms don't allow other apps to use subscription sign in. A key is kept in your computer's keychain and goes only to its own agent's process. Settings > Agents installs an agent into Ogden Agents' data folder and takes its key.

## Requirements

- Node.js 24 or later
- pnpm 12

## Run

```sh
pnpm install
pnpm start            # builds, starts the server on 127.0.0.1, opens the browser
```

The page shows the connection state and lists logged events (currently one `server.started` per server start). Events persist across restarts, and a reloaded or reconnected page catches up from the last event it saw.

Ogden Agents keeps its SQLite database (`ogden-agents.db`), logs (`logs/server.log`), port file (`server.json`) and launcher token (`launcher.token`) in your OS per-user data folder under `ogden-agents/` (for example `~/Library/Application Support/ogden-agents` on macOS). Set `OGDEN_AGENTS_DATA_DIR` to use another folder. Nothing is written into your repos.

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
- **Launch link.** The launcher opens the browser at a one-time link (`http://127.0.0.1:<port>/#c=<code>`) and also prints it, so you can click it if no browser opened. The code works once, within 60 seconds.
- **Per-tab token, no cookie.** The page removes the code from the address bar at once and exchanges it, in a same-origin `POST`, for a random token for that one browser tab, held only in the server's memory. The token arrives in the response body and is kept in the tab's `sessionStorage`; it never appears in any URL, so it isn't in your browser history or autocomplete. Every API request sends it as `Authorization: Bearer`, and the WebSocket sends it as a subprotocol. Other local web servers never see it: unlike a cookie, it isn't sent to other ports on `127.0.0.1`.
  - Reloading a tab keeps it connected. A new tab, a bookmark or a copied URL has no token and shows **Open Ogden Agents**, with the command to run; **New tab** in the sidebar footer opens another connected tab.
  - Tokens end when the server stops (Quit, a restart, a reboot) or after 12 hours unused; a tab that stays open and connected keeps its token. After a restart, open the app again with `npx ogden-agents`.
  - WebSocket connections and requests that change state must also come from the app's own page (a matching `Origin`).
- **Content-Security-Policy.** The app runs only its own scripts: no inline script and no third-party origins.
- **Files in the data folder**, both readable only by you:
  - `server.json` holds the running server's `port`, `pid`, `version` and `startedAt`. It is written when the server starts and removed when it stops.
  - `launcher.token` is a random secret the server creates on every start and removes when it stops. The launcher sends it to reach the handshake (`/launcher/…`), which reports the server's version and issues launch links; it opens nothing else, and no tab token opens the handshake.

Launch codes, tab tokens and the launcher token never appear in the logs or the event log; the `Authorization` and `Sec-WebSocket-Protocol` headers are redacted.

**Known limit.** On a computer shared by several accounts, another local user can see the launch link (with its one-time code) on the process command line while your browser opens it (macOS, and Linux without `hidepid`), and could race to use it first. The code works once and only for 60 seconds; Ogden Agents is meant for one user per install.

## Develop

Coding agents (and people) working in this repo: read [AGENTS.md](AGENTS.md) first for conventions and known pitfalls.

```sh
pnpm typecheck   # tsc across every package, the launcher and the tests
pnpm test        # builds, then Vitest: architecture, packaging, design-token, launcher and server tests
pnpm e2e         # builds, then Playwright (Chromium): shell layout at 1440/900/390, theme, density, per-tab token, launch state, CSP
pnpm build       # tsdown bundles packages/server, Vite builds packages/web, both copied into dist/
pnpm run pack    # builds, then writes the publishable tarball ogden-agents-<version>.tgz
pnpm smoke       # installs that tarball with npx in an empty temp dir and checks it serves the page
pnpm e2e:installed  # installs that tarball the same way and drives Chromium through it (see below)
```

**End-to-end against the installed package.** `pnpm e2e:installed` tests what a user gets, not the workspace. It installs `ogden-agents-<version>.tgz` (run `pnpm run pack` first; set `E2E_INSTALLED_TARBALL` to use another tarball) with npx in an empty temp folder. It starts the package through its own `ogden` launcher in background mode, with a temp data folder. It then drives Chromium through epic 1's journey: launch, the launch link, the shell, theme and density, Settings > Tools (status only, nothing is downloaded), New tab, a bookmark-style tab, and Quit. Before the journey it runs the security gate's negative checks: no tab token, a foreign Origin or Host, and the launcher endpoint without its token. It also runs them through a test-only proxy that takes the gate out of the way, where every check must fail, so the checks really detect a weakened gate. At the end no server process is left and the temp folders are removed. Screenshots and traces of failures go to `test-results/e2e-installed/`. It needs Chromium for Playwright (`pnpm exec playwright install chromium`).

```sh
pnpm run pack && pnpm e2e:installed
```

The root `ogden-agents` package is the only publishable artifact. `pnpm build` writes a self-contained `dist/` (`dist/server.js`, the server with every `@ogden-agents/*` package bundled in, and `dist/web/`, the UI), and `bin/ogden.js` loads it by relative path. Third-party runtime dependencies are declared in the root `dependencies`; `tests/packaging.test.ts` fails if the bundle imports anything undeclared or the tarball picks up workspace sources.

CI runs typecheck, tests, pack and the clean-install smoke test on macOS, Windows and Linux, each on Node 24 and 26, plus the Playwright browser tests on Linux Chromium, and the end-to-end suite against the installed package on macOS, Windows and Linux (Node 24, Chromium).

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
