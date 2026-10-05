---
title: 'Epic contracts and stubs: shell launcher calls, update prompt, runtime pins and app config'
type: 'feature'
ticket: '3'
created: '2026-10-05'
status: 'built'
baseline_revision: '8105fea31fb0d78a2738a4cddea742b33a1c95f5'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['security', 'correctness']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-desktop-app/epic-desktop-app.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The lanes of epic 13 (runtime, shell lifecycle, data folder, packaging, updates, first run) share contracts that do not exist yet: the server's shell mode, the shell's launcher calls, the update prompt, the Node pins and the Tauri skeleton (E13-R2, R3, R4, R6, R7).

**Approach:** Add each contract with a stub, in new modules so later stories never edit `start.ts`: `shell-mode.ts` (`OGDEN_AGENTS_SHELL=desktop`, a parent watch that exits the server when its stdin pipe closes); a launcher `--json` mode that prints `{action, owned, port, pid, version, url, launchUrl, dataDir}` and holds a server it started; `update-notice/` (desktop update state, one busy rule, routes) with `/launcher/app-update` (report and poll) and `/launcher/update-channel`, and `POST /api/v1/updates/app/restart` and `PUT /api/v1/updates/app/channel` for the page; events `app.update_available` and `app.update_requested`; `shell`, `appChannel` and `app` on the update notice; the web `UpdateBanner`'s desktop source and an About channel row; `scripts/desktop-pins.mjs --check` with the pins in `packages/desktop/desktop-node-pins.json`; a config and source guard test for AD-15 in the webview; the CI pins job; EXPERIENCE.md and DESIGN.md entries.

## Boundaries & Constraints

**Always:** the shell's calls sit under `/launcher/` and need the launcher token; the page's calls need the tab token and a matching Origin (AD-15 unchanged). The server never downloads or installs an update; the page never reaches Tauri. Restart never goes ahead while the busy rule says anything is working. In shell mode the npm check never runs. User text has no dashes and, in the app, never says terminal or npx.

**Never:** the Tauri updater plugin or any shell-side update work (13.10), the shell's quit and menu (13.5), the npm notice's own behaviour (13.7).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Report an update | launcher token, shell mode, newer version | 204; the page's notice shows `app`; `app.update_available` | not newer: 409; bad or oversized body: 400 or 413; no token: 401; not shell mode: 404 |
| Restart, idle | update downloaded | 202; the shell's poll answers `restart: true` once | not downloaded: 409; no update: 404 |
| Restart, busy | a working session | 409 `sessions_busy`; with `whenIdle`, 202 and the poll stays false until idle | none |
| Server in shell mode, shell gone | stdin pipe closes | server exits | none |
| Launcher `--json` | server started by it | one JSON line, `owned: true`, stays alive holding the pipe | an attached server: `owned: false`, exits at once |

</frozen-after-approval>

## Code Map

- `packages/server/src/shell-mode.ts`, `update-notice/{busy-rule,desktop-update,routes}.ts` -- the contracts.
- `packages/server/src/{launcher,serve,start,app,update-routes,update-check}.ts`, `bin/ogden.js` -- wiring (start.ts only gains the one block).
- `packages/shared/src/{desktop-update,updates,api,events-settings,events}.ts` -- schemas, routes, events.
- `packages/web/src/{shell/update-banner,routes/about-page,updates/*}` -- the banner's desktop source and the channel row.
- `scripts/desktop-pins.mjs`, `tests/desktop-pins.test.ts`, `tests/desktop-config.test.ts`, `tests/desktop-launcher.test.ts`, `packages/server/test/desktop-update.test.ts`, `packages/web/test/desktop-update-banner.dom.test.tsx`.

## Tasks & Acceptance

**Execution:**
- [x] shared schemas, routes and events
- [x] shell mode, parent watch, busy rule, desktop update service and routes, wired once in `start.ts`
- [x] launcher `--json` with a held server
- [x] web banner source, About channel row
- [x] pins script and CI job; config guard test
- [x] EXPERIENCE.md and DESIGN.md entries
- [x] review and triage (below); CI on the pull request

**Acceptance Criteria:**
- Given the tests, then pins check passes and fails on a changed hash, launcher calls refuse without the launcher token, events validate, the banner renders each source, the server in shell mode exits when its stdin closes, and the capability test finds no permission on the server's origin.

## Implementation Notes

- Unknown "can an existing config route carry shell mode": yes. `GET /api/v1/updates` (already read app-wide by the banner) now carries `shell`, so no new route.
- The parent watch needs a pipe, but the launcher spawns the server detached. So the launcher in shell mode keeps the server's stdin as a pipe and stays alive (the shell runs it with `--json`); when the shell dies its stdin to the launcher closes, the launcher exits, the server's pipe closes and it exits. Without shell mode nothing changes: an `npx` server outlives its launcher.
- The user's wording "Update available — Restart to update" is written "Update available. Ogden 0.6.0 is ready. Restart to update." because user text has no dashes.
- Notes from the release are carried in the report and kept by the server; 13.10 shows them.

## Plan Change Log

## Review Triage Log

Pass 1 (security and correctness, self-review): medium 3, low 2.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | The shell's update calls must not be reachable by a page or another user's process | medium | patch | They sit under `/launcher/` (launcher token only; a tab token is refused, tested) and register only in shell mode (404 elsewhere, tested). |
| 2 | A restart could go ahead under a running turn | medium | patch | One busy rule decides both the page's Restart and the shell's poll; "Restart when they finish" and the poll are tested against a working session. |
| 3 | Held server pipe: a shell-mode env with a launcher that did not hold would end the server at once (stdin of `/dev/null`) | medium | patch | The launcher holds whenever it runs in shell mode, whatever the flags (`holdServer` defaults to shell mode), so shell mode never starts a server with a closed stdin. |
| 4 | Notes from the shell are not shown anywhere yet | low | defer | 13.10 shows them in the update prompt. |
| 5 | The channel row has no live effect until the shell reads it | low | defer | 13.10 reads `/launcher/update-channel`. |

## Verification

**Commands:**
- `pnpm test` (CI), `node scripts/desktop-pins.mjs --check` (CI job `Desktop Node pins`).
