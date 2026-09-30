# Changelog

Every release of the `ogden-agents` npm package. Versions follow [semantic versioning](https://semver.org/); before 1.0.0, a minor version may change behavior. How a release is made is in [RELEASING.md](RELEASING.md).

## Unreleased

- **Per-tab sign-in, no cookie.** Each browser tab now holds its own token, exchanged from the one-time launch link inside the page, so the token never appears in a URL or browser history. Other web servers running on your computer can no longer receive a session cookie, because there isn't one. A bookmark or brand-new tab shows "Open Ogden Agents"; **New tab** in the sidebar opens another connected tab. The app sends a strict Content-Security-Policy.

## 0.1.0 — first release

The first build on npm. Run it with `npx ogden-agents` (Node 24 or later on macOS, Windows or Linux). It is the foundation, not yet a working agent UI: it starts, signs you in and shows the app shell, but runs no agents.

- **Launcher and background server.** `npx ogden-agents` starts a local server on `127.0.0.1` in the background, or finds the one already running, and opens the browser with a one-time sign-in link. The server keeps running after the terminal closes, until Quit in the app. The launcher and server compare versions and offer a restart to an older server without stopping it.
- **Security gate.** Every HTTP and WebSocket request passes one gate: a single-use launch code exchanged for an `HttpOnly`, `SameSite=Strict` cookie, plus `Host` and `Origin` checks.
- **Event log.** State reaches the UI through one append-only event log in SQLite, in the per-user data folder, over one WebSocket.
- **App shell.** The design system (light and dark themes, density) and the app layout with the workspace switcher and status sidebar, in their empty states.
- **Python tools, installed for you.** Settings > Tools checks for `uv` (the tool BMad Method's scripts run on) and, with one click, installs a private copy: the official release for your OS and CPU, verified against pinned hashes, with no terminal and no system changes.
- **Bundled forks.** The package ships pinned copies of the BMAD-METHOD and bmad-loop forks, locked by `forks.lock`.
- **Release pipeline.** Tagged releases publish from GitHub Actions through npm trusted publishing, only after the full test matrix passes, and then run `npx ogden-agents@<version>` from the registry on macOS, Windows and Linux.
