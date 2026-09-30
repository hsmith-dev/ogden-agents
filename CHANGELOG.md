# Changelog

Every release of the `ogden-agents` npm package. Versions follow [semantic versioning](https://semver.org/); before 1.0.0, a minor version may change behavior. How a release is made is in [RELEASING.md](RELEASING.md).

## 0.1.0 — first release

The first build on npm. Run it with `npx ogden-agents` (Node 24 or later on macOS, Windows or Linux). It is the foundation, not yet a working agent UI: it starts, signs you in and shows the app shell, but runs no agents.

- **Launcher and background server.** `npx ogden-agents` starts a local server on `127.0.0.1` in the background, or finds the one already running, and opens the browser with a one-time sign-in link. The server keeps running after the terminal closes, until Quit in the app. The launcher and server compare versions: an older server with no busy session restarts on the new version, and one with busy sessions keeps running until they finish. An open tab whose version differs from the server's shows a reload banner.
- **Security gate, per-tab sign-in, no cookie.** Every HTTP and WebSocket request passes one gate with `Host` and `Origin` checks. The launcher opens `/#c=<one-time code>`; the page removes the code from the address bar and exchanges it in a same-origin `POST` for a per-tab bearer token, kept in memory and the tab's `sessionStorage`. The token never appears in a URL or browser history, and no cookie is set, so other web servers on your computer never receive it. A bookmark or brand-new tab shows "Open Ogden Agents"; **New tab** in the sidebar opens another connected tab.
- **Content-Security-Policy.** The app runs only its own scripts: no inline script and no third-party origins.
- **Event log.** State reaches the UI through one append-only event log in SQLite, in the per-user data folder, over one WebSocket.
- **App shell.** The design system (light and dark themes, density) and the app layout with the workspace switcher and status sidebar, in their empty states.
- **Python tools, installed for you.** Settings > Tools checks for `uv` (the tool BMad Method's scripts run on) and, with one click, installs a private copy: the official release for your OS and CPU, verified against pinned hashes, with no terminal and no system changes.
- **Bundled forks.** The package ships pinned copies of the BMAD-METHOD and bmad-loop forks, locked by `forks.lock`.
- **Release pipeline.** Tagged releases publish from GitHub Actions through npm trusted publishing, only after the full test matrix passes, and then run `npx ogden-agents@<version>` from the registry on macOS, Windows and Linux.
