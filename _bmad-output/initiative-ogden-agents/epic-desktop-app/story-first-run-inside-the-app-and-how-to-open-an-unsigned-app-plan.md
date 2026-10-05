---
title: 'First run inside the app and how to open an unsigned app'
type: 'feature'
ticket: '11'
created: '2026-10-05'
status: 'built'
baseline_revision: 'b80c54a2793a5dccc9b0d7ffbebcb7da911835b2'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['security', 'correctness']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-desktop-app/epic-desktop-app.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Inside the app, Welcome, the launch page and the stopped state still talk about a terminal, `npx` and an app shortcut, and a downloaded unsigned app gives users no steps (E13-R9; AD-21).

**Approach:** In the app, the server (shell mode) reports the app shortcut as unsupported with no pending offer, so Welcome and Settings, Appearance never offer it. Pages that load before any server answer (the launch page, the stopped state) tell the app by Tauri's own marker, which they only look for, and say "open the app again" with no command; the Quit sentence says the same. The README gains a Download section: one file per computer (macOS universal dmg, Windows x64 and ARM64), the checksum file, plain steps for opening an unsigned app on each OS (Privacy and Security, Open Anyway; SmartScreen, More info, Run anyway), and the macOS and WebView2 requirements. The release notes already link to it (13.9). Linux steps are left out with Linux.

## Boundaries & Constraints

**Always:** the npm route's pages and tests are unchanged; no IPC (the marker is only looked for); plain words, no dashes.

**Never:** a Linux section, a shortcut offer in the app.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Launch page in the app | Tauri marker present | "Quit Ogden Agents and open it again", no command, no copy button | none |
| Stopped state in the app | quit, restart, unreachable | "Open Ogden Agents again", no command | none |
| Shortcut in the app | shell mode | status unsupported, offer not pending, add refused | none |
| npm route | no marker, no shell mode | unchanged | none |

</frozen-after-approval>

## Code Map

- `packages/server/src/start.ts` (no shortcut port in shell mode), `packages/web/src/shell/{desktop-app,open-ogden-agents,server-stopped,quit-button}`, `README.md`.
- Tests: `packages/web/test/desktop-app-wording.dom.test.tsx`, `packages/server/test/desktop-update.test.ts`, `tests/desktop-readme.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] shortcut hidden through the server in shell mode
- [x] app wording on the launch page, stopped state and Quit sentence
- [x] README Download section and its test
- [ ] live check on a clean machine per OS (the user's, in 13.13)

## Implementation Notes

- Unknown "whether Apple's Open Anyway flow differs on the user's macOS version": the steps are written for macOS 15 and later (Privacy and Security, Open Anyway after a first refusal); the user's live check records any difference.
- Welcome itself says nothing about a terminal outside its shortcut step, which the server now skips, so no Welcome code changed.

## Plan Change Log

## Review Triage Log

Pass 1 (security and correctness, self-review): low 2.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | `window.__TAURI_INTERNALS__` could be set by a page script to change wording | low | reject | It only changes copy on the page itself; no data or privilege depends on it. |
| 2 | A tokenless page cannot ask the server whether it is in the app | low | patch | The marker is used there; token pages also read `shell` from the notice. |

## Verification

**Commands:**
- `pnpm test` (CI).
