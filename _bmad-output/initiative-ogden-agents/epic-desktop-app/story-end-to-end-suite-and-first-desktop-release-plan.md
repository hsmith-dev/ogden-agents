---
title: 'End-to-end suite and first desktop release'
type: 'feature'
ticket: '13'
created: '2026-10-05'
status: 'in-progress'
baseline_revision: 'b7744ee286d1e85b151d01a96714aa402a88761a'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-desktop-app/epic-desktop-app.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 13 is only done when the built apps pass end-to-end checks in CI on the OSes it ships for, and the user has opened them on clean machines (E13-R10). By the user's decision of 2026-10-05 the scope is macOS (universal) and Windows (x64 and ARM64); Linux is out of scope.

**Approach:** The checks accumulated in the Desktop workflow across the epic form the suite, run on every leg against the installed app: smoke (the page loads through the gate, the tab token is minted, quit leaves no `ogden-node`), lifecycle (a second launch focuses the first window and starts no second server, an npm-started server is attached to and left running, quit with a busy session asks first and "quit anyway" stops the agent and its child, killing the shell leaves nothing, a fake-agent chat completes a turn), and the update test (the next channel finds a newer version the stable one does not, a bad signature or checksum is refused, Restart waits for a running turn, and the new version opens with the data intact). Windows runs them from the silently installed NSIS app, macOS from the mounted `.dmg` (plus the Intel slice under Rosetta). The user's live checks and the first prerelease are theirs and are listed below.

## Boundaries & Constraints

**Always:** private data folders, the fake agent, no real agent, keychain or network, a throwaway updater key; the user's live checks are recorded here by the user (or from the user's report) before the ticket is done.

**Never:** tag a release, publish, or record a live result nobody observed.

</frozen-after-approval>

## Code Map

- `.github/workflows/desktop.yml` (job `app`), `packages/desktop/scripts/{smoke,lifecycle,update-e2e,app-harness}.mjs`, `tests/fixtures/fake-release-server/`.

## Tasks & Acceptance

**Execution:**
- [x] the suite runs on macOS universal, Windows x64 and Windows ARM64 (Desktop workflow)
- [x] a fake-agent chat scenario added to the lifecycle script
- [x] CI: the lifecycle and update scenarios passed on macOS universal, Windows x64 and ARM64 in the stories that added them (13.5, 13.10); this pull request adds the fake-agent chat scenario
- [ ] the user's live checks (hitl, below)

## Live check result

Not done yet. The user records each result here, for each machine, before this ticket is done. Linux is out of scope (user, 2026-10-05).

| Check | macOS Apple silicon | macOS Intel | Windows x64 | Windows ARM64 |
|---|---|---|---|---|
| Download the file from the GitHub Release and open it by the README steps (Open Anyway / Run anyway) | not done | not done | not done | not done |
| Sign in with a real Claude Code, chat, Quit (the server and agents stop) | not done | not done | not done | not done |
| A second launch focuses the same window | not done | not done | not done | not done |
| With `npx ogden-agents` running, the app attaches; quitting the app leaves it running | not done | not done | not done | not done |
| Update from a first prerelease to a second on the next channel, chat intact | not done | not done | not done | not done |

## Implementation Notes

- Not built: the tauri-driver (WebDriver) checks and the Linux legs. Every check drives the built app from outside (its report file, the OS process list, the server's HTTP API), which is what runs on all legs, including macOS where WebDriver is unavailable.
- Rerun policy: Windows installed runs are timing sensitive on slow runners; a failure counts as a flake only with evidence such as the same test passing on a rerun.

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `gh run list --workflow Desktop`.
