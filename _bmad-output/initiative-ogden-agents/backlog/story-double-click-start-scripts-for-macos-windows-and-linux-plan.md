---
title: 'Double-click start scripts for macOS, Windows and Linux'
type: 'feature'
ticket: '2'
created: '2026-10-04'
status: 'built'
baseline_revision: 'a6e6c12a6636d9957fa134320be5cd8a4bfd670c'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'security']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/backlog/story-double-click-start-scripts-for-macos-windows-and-linux.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Starting Ogden Agents needs a terminal and `npx ogden-agents` (user request, 2026-10-04: "an easy way for people to start this app, like a script for Mac, Windows - linux ... a script for that too"). Non-technical users have no double-click path; a Tauri app is a separate later epic.

**Approach:** Three self-contained scripts in `start/` — `Start Ogden.command` (macOS) and `start-ogden.sh` (Linux), byte-identical POSIX `sh`; `Start Ogden.cmd` (Windows, pure batch, CRLF). Each checks Node >= the `engines` minimum, then runs `npx --yes --package=<spec> ogden <args>` with `<spec>` = `$OGDEN_AGENTS_PACKAGE` or `ogden-agents@latest`. `--check` reports without launching. A release job attaches them to the GitHub Release; a CI job and vitest tests run each on its OS.

## Boundaries & Constraints

**Always:**
- Ticket criteria 1–8 are the acceptance bar.
- Missing/old Node: plain-language message (what, which version, how), open https://nodejs.org/en/download (not in `--check`), exit non-zero. Never install, never `sudo`/elevation, never `curl|sh`, never PowerShell.
- On error: wait for a key when interactive (POSIX: stdin is a TTY; Windows: `pause`), unless `OGDEN_START_NO_PAUSE=1`. Success does not wait.
- Arguments after the script name pass to the launcher; environment (incl. `OGDEN_AGENTS_DATA_DIR`) is inherited untouched.
- Paths with spaces work (script location, tarball path, data dir).
- Release assets: `Start-Ogden-macOS.zip` (holds `Start Ogden.command`, mode 755), `Start-Ogden.cmd`, `start-ogden.sh`; uploaded only after npm publish succeeded; idempotent (`--clobber`); `contents: write` only on that job.
- Tests: no network beyond the existing tarball smoke, no real agent, keychain, or `~/.claude`.

**Never:** change `bin/ogden.js` or launcher behaviour; ship the scripts in the npm tarball; code signing; a pinned-per-release version; PATH fallbacks that search for Node outside PATH.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Happy | Node 24+, npm on PATH | npx runs launcher, browser opens, exit 0 | — |
| Check OK | `--check`, Node 24+ | prints Node/npm versions, package spec, data dir; exit 0 | — |
| No Node | PATH without node | message + download page (not in check) | exit 1, pause if interactive |
| Old Node | `node --version` → v18.x | message names 24 and found version | exit 1 |
| No npx | node but no npx | message: reinstall Node from nodejs.org | exit 1 |
| Launcher fails | npx/ogden exit ≠ 0 | "Ogden Agents did not start" + code | exit with that code |
| Args | `--no-open --port 0` | reach launcher | — |

</frozen-after-approval>

## Code Map

- `bin/ogden.js` -- launcher; read-only. Prints `running at <url>` and `one-time link: <url>`.
- `scripts/installed-package.mjs` -- `prepareInstall` (env: fresh npm cache, `OGDEN_AGENTS_DATA_DIR`, memory secret store), `runLauncher`, `track`. Add a `startScript` option: `runLauncher` runs the script instead of npx with `OGDEN_AGENTS_PACKAGE=<tarball>` and `OGDEN_START_NO_PAUSE=1`; Windows via `cmd.exe /d /s /c ""<script>" args"` (`windowsVerbatimArguments`), POSIX by executing the file directly (proves the exec bit and shebang).
- `scripts/smoke-installed.mjs` -- add `--start-script <path>`; the tarball positional arg must skip the flag's value.
- `.github/workflows/ci.yml` -- new `start-scripts` job (3 OS, Node 24): install, pack, `--check` as a user runs it, smoke via `--start-script`.
- `.github/workflows/release.yml` -- new `start-scripts` job after `publish`: `gh release create` if missing (prerelease when dist-tag `next`), `gh release upload --clobber`.
- `.gitattributes` -- `*.cmd text eol=crlf`.
- `tests/start-scripts.test.ts` (new) -- per-OS: `--check` OK / no Node / old Node (fake node), min version equals `engines`, `.command` == `.sh`, exec bits (POSIX), CRLF in `.cmd`, no `sudo`/`curl`/`powershell`/`Invoke-` in scripts.
- `README.md`, `RELEASING.md`, `CHANGELOG.md` -- "Start Ogden" section; release step; Unreleased entry.

## Tasks & Acceptance

**Execution:**
- [ ] `start/start-ogden.sh`, `start/Start Ogden.command` -- POSIX script, identical, mode 755.
- [ ] `start/Start Ogden.cmd` -- pure batch, CRLF; `.gitattributes` rule.
- [ ] `scripts/installed-package.mjs`, `scripts/smoke-installed.mjs` -- start-script mode.
- [ ] `tests/start-scripts.test.ts` -- matrix rows above.
- [ ] `.github/workflows/ci.yml`, `.github/workflows/release.yml` -- jobs.
- [ ] `README.md`, `RELEASING.md`, `CHANGELOG.md` -- docs (Gatekeeper right-click Open / Open Anyway, SmartScreen More info → Run anyway, Linux `chmod +x`).

**Acceptance Criteria:**
- Given the packed tarball, when `node scripts/smoke-installed.mjs --start-script <os script>` runs, then it reaches the page, `server.started`, and quits cleanly on all three OSes.

## Implementation Notes

- Implemented directly in the session that planned it (the plan was written with the full investigation in context).
- Smoke via the start script (`--start-script`) passed locally on macOS; the first CI run on PR #105 was fully green, Windows included.

## Plan Change Log

## Review Triage Log

Pass 1 (lenses: quick, security). high 2, medium 4, low 6, false 0, maybe-false 0.

| Finding | Verdict | Route | Evidence / action |
|---|---|---|---|
| `.cmd` resolves `node`/`npx`/`where`/`findstr` from the current folder (Downloads) first | high | patch | cmd.exe searches the cwd before PATH. Set `NoDefaultCurrentDirectoryInExePath=1`, `cd /d %USERPROFILE%`, call `where.exe`/`findstr.exe` by full path; test with planted `node.bat`/`npx.bat` in cwd. |
| npx reads `.npmrc`/`node_modules` from the script's folder | high | patch | npm walks up from the cwd. Both scripts now `cd` to the home folder first. |
| `%*` forwards unquoted dropped paths with `&` to cmd | medium | patch | Arguments not starting with `--` are refused (exit 2); test with `C:\R&D\notes.txt`. |
| `--check` echoes data dir/package unquoted (`&` splits the line) | medium | patch | Echo with delayed expansion; test with `R&D data`. |
| `.cmd` served LF from GitHub Raw (index LF) | medium | patch | `*.cmd -text`, committed CRLF (`i/crlf`). |
| Linux double-click without a terminal hides errors | medium | patch | README now says run in a terminal / Run in Terminal. |
| No checksums; README teaches bypassing Gatekeeper/SmartScreen | low | patch | `SHA256SUMS.txt` asset; README: download only from the releases page, never a file someone sent. |
| Assets uploaded after publish, not verify | low | patch | `needs: [guard, verify]`. |
| Write token persisted by checkout | low | patch | `persist-credentials: false`. |
| `--check` only as first argument | low | patch | README says "as the first option". |
| No test for the non-check download-page path / pause | low | patch | POSIX test for the non-check no-Node path (empty PATH, no browser). Pause needs a TTY: not tested. |
| `call` re-expands `%` and doubles `^` in the package path | low | reject | Only for `OGDEN_AGENTS_PACKAGE` paths with `%`/`^`; fixing needs a non-`call` npx launch with more complexity. |
| Inline retry loop in release.yml vs AGENTS.md shared-helper rule | low | reject | release.yml already uses inline wait loops for `npm view`; the rule targets install/download helpers. |
| Draft-release race / `--clobber` partial state | low | reject | A re-run recovers; tags are pushed by the owner one at a time. |
| `uname` missing shows the Linux hint on macOS in tests | low | reject | Test-only PATH; real macOS has `uname`. Test comment corrected. |
| Unpinned `@latest` | — | reject | Recorded design decision (ticket Notes). |

## Design Notes

- `@latest` (not a per-release pin): a downloaded script keeps starting the current release; the launcher already restarts an idle older server on a newer version. Prerelease Releases still carry `@latest` scripts; `OGDEN_AGENTS_PACKAGE=ogden-agents@next` selects the prerelease.
- Pure `.cmd`: no PowerShell means no execution policy is touched, so no `-ExecutionPolicy Bypass` trade-off. SmartScreen/Mark-of-the-Web may still prompt for a downloaded file (documented).
- macOS ships zipped because a browser download drops the exec bit; Archive Utility keeps it.

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm test`, `pnpm e2e` -- pass.
- `pnpm run pack && pnpm smoke` and `node scripts/smoke-installed.mjs --start-script "start/Start Ogden.command"` -- `smoke: OK`.
- `bash "start/Start Ogden.command" --check` -- exit 0.
