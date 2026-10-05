---
id: 2
type: story
title: "Double-click start scripts for macOS, Windows and Linux"
parent: none
covers: []
after: []
assignee: ""
refined: true
hitl: false
risk: medium
estimate: ""
---

# Double-click start scripts for macOS, Windows and Linux

## Description

A person who doesn't use a terminal can start Ogden Agents by double-clicking one file: `Start Ogden.command` on macOS, `Start Ogden.cmd` on Windows, and `start-ogden.sh` on Linux. Each script checks for Node.js, explains plainly how to get it when it is missing or too old, and otherwise runs the same `npx ogden-agents` launcher a terminal user runs, which opens the browser with its one-time link. The scripts live in the repository and are attached to each GitHub Release; the README gets a "Start Ogden" section for non-technical users. A Tauri desktop app is planned separately as its own epic; these scripts are the quick path now and stay useful for the npm route.

## Acceptance Criteria

1. **Node present: the launcher runs**
   **Given** Node.js at or above the minimum in `package.json` `engines` on the user's PATH
   **When** the user runs the script for their OS (double-click, or from a terminal)
   **Then** it runs `npx --yes ogden-agents@latest` (the `ogden` launcher), whose behaviour is unchanged: it starts or finds the server and opens the browser with a one-time link
   **And** arguments given to the script reach the launcher unchanged (`--no-open`, `--port`)

2. **Node missing or too old: plain instructions, nothing installed**
   **Given** no `node` on PATH, or one older than the minimum
   **When** the user runs the script
   **Then** it prints in plain words what is missing, which version is needed and how to install it, opens the official Node.js download page in the browser, and exits with an error
   **And** it never installs anything itself, never asks for admin rights or `sudo`, and never downloads and runs a script

3. **The window stays open on any error**
   **Given** the script was double-clicked
   **When** any step fails (Node missing or too old, npx missing, the launcher exits with an error)
   **Then** the window stays open with a readable message until the user presses a key; a successful start does not wait

4. **Check mode**
   **Given** any computer
   **When** the script runs with `--check`
   **Then** it reports the Node.js and npm found (or what is missing) and the package it would run, and exits 0 when it could start Ogden Agents, non-zero otherwise, without opening a browser, waiting for a key, or touching the network

5. **Data folder passthrough**
   **Given** `OGDEN_AGENTS_DATA_DIR` set in the environment
   **When** the script starts the launcher
   **Then** the launcher and server use that folder

6. **Windows needs no admin and no execution-policy change**
   **Given** a standard Windows account with the default PowerShell execution policy
   **When** the user double-clicks `Start Ogden.cmd`, including from a folder whose path has spaces
   **Then** it runs without asking for elevation and without changing any execution policy

7. **Released with every version**
   **Given** a version tag is released
   **When** the release workflow finishes publishing to npm
   **Then** the GitHub Release for that tag has the three scripts attached, the macOS one in a zip that keeps it executable

8. **Each script is tested on its own OS**
   **Given** CI on macOS, Windows and Linux
   **When** it runs
   **Then** each OS runs its script in check mode, with Node missing and too old, and through a full start of the packed tarball (no registry), reaching the page and quitting the server

## Boundaries

- Must not change: the `ogden` launcher's own behaviour and options, `npx ogden-agents` for terminal users, the npm publish steps of the release workflow.
- Tests never run real agents, touch the keychain or read the real `~/.claude`; no network beyond what CI already uses.

## References

- launcher — bin/ogden.js; README.md, Run and Security
- release — RELEASING.md, What the release workflow does; .github/workflows/release.yml
- clean-install smoke — scripts/smoke-installed.mjs, scripts/installed-package.mjs

## Notes

- Decision (2026-10-04, user): scripts for macOS, Windows and Linux; a Tauri app is a separate, later epic.
- Decision (2026-10-04, autonomous): the scripts run `ogden-agents@latest`, not a version pinned per release, so a script downloaded once keeps starting the current release and the launcher's own update path applies. `OGDEN_AGENTS_PACKAGE` overrides the package spec (tests point it at the packed tarball).
- Decision (2026-10-04, autonomous): Windows is a pure `.cmd`, with no PowerShell, so no execution policy is involved at all.
- Assumption: the README covers Gatekeeper ("unidentified developer"/"could not verify") and Windows SmartScreen prompts; the scripts are not code-signed in this story.
- Assumption: risk medium: it changes the release workflow (a new job with `contents: write`), but a mistake shows at once and reverts cleanly. The extra check outside the ticket: the owner runs each script once on a real computer at the next release.
