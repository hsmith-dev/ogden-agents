---
title: 'Spike: can many panes run real CLIs in PTYs on all three OSes without leaking secrets?'
type: 'chore'
ticket: '1'
created: '2026-10-05'
status: 'built'
baseline_revision: '3ea6dfb9aa25e39630da9da04f8157a799df3c9f'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-native-cli-terminal/epic-native-cli-terminal.md'
---

<frozen-after-approval reason="human-owned intent: do not modify unless human renegotiates">

## Intent

**Problem:** Epic 16 (a herdr style terminal workspace in Developer mode: several panes per project, each running an agent's own real CLI through node-pty and xterm) rests on unknowns: whether panes behave on macOS, Windows and Linux (resize, many at once, scrollback, copy and paste, Unicode and colours, input latency), whether Ogden can stop only the panes it started, find an installed CLI without installing anything, keep every secret out of a pane child (AD-16), keep the pane socket behind the one gate (AD-15), bring a pane back after a browser refresh, and guess a pane's status (working, needs attention, idle) from output alone. Nothing else in the epic is built until the user says go or no go on measured answers.

**Approach:** A TEMPORARY probe (`apps/terminal-spike/`) and a TEMPORARY CI job on ubuntu, macOS and Windows that drives the repo's own `terminal-pty` adapter (real `node-pty`, the 3.8 retry, the tree kill), the `child-env` allowlist, and the real gate (`gate.ts`, `auth.ts`) with FAKE CLIs only (no vendor CLI, no network, no sign in, no secret), plus real xterm.js in Chromium. Findings, numbers, risks and a recommendation are written here.

## Boundaries & Constraints

**Always:** fake CLIs only; sentinel secrets are fake strings; the probe never reads the real `~/.claude`, `~/.codex`, `~/.gemini` or the keychain; only processes the probe started are ever killed.

**Never:** stories 16.2 onward, a real vendor CLI, any install, tags, publishing, repo settings, upstream.

</frozen-after-approval>

## Result in one paragraph

GO, with conditions. All three OSes passed every probe in CI (run 37363956365, 3 of 3 green; the run before, 37362082901, also 3 of 3) and nothing blocking was found. Many panes, resize, copy and paste, colours, reload with replay, status hints, the AD-15 gate on the pane socket, the AD-16 allowlist (no sentinel secret ever reached a pane child or a shell) and killing only what Ogden started all work. Five things must be designed in, not bolted on: (1) replay after a refresh must use a server side terminal mirror with a snapshot, not the raw 64 KiB tail epic 3 keeps, because the tail failed on a full screen app; (2) pane children need a bigger, still secret free environment than the base allowlist (Windows panes lose `APPDATA`, `ProgramFiles` and more, no pane has `COLORTERM`); (3) Windows ConPTY is slower (about 5 MB per second of output, about 11 KB per second of pasted input, 15 ms resize) and showed one pane in 16 or 32 whose first output was held back in 2 of 3 runs; (4) a server killed hard leaves panes that ignore hangup running on macOS and Windows, so Ogden needs a start up sweep of its own recorded pids; (5) status from output is a hint with known limits (silent work reads as idle, an unfamiliar prompt is missed).

## What was built (temporary)

- `apps/terminal-spike/fake-cli.mjs`: one fake CLI with modes `prompt`, `raw` (reports bytes, size, bracketed paste), `echo`, `login` (URL, pasted code, writes a credential into the user's own home), `long` (flood), `lines` (output then immediate exit), `escapes` (colours, truecolor, wide characters, alternate screen, OSC title), `permission` (spinner, then a yes/no, a numbered menu or press enter), `exit`, `hang` (ignores hangup, interrupt and terminate), `tree` (starts a helper, also detached), `env` (prints its whole environment), `scenario` (a scripted timeline with ground truth labels), `cjk`, `version`.
- `lib/harness.mjs`: opens panes through `terminal-pty`'s `loadPty().spawnHidden`, collects output, event driven waits, memory and process helpers, and a `PaneHost` that sketches the server side of a pane (pty, raw backlog trimmed with core's `trimBacklog`, an `xterm-headless` mirror with the serialize addon, the pids it started, `closeAll`).
- `lib/gate-server.mjs`: a minimal server with the REAL `createGate`, `createTabTokens`, `createLaunchCodes` and Ogden's logger in front of a pane WebSocket at `/ws/pane/:id` (so the gate's WebSocket rules apply as for `/ws`), serving a page with the web package's xterm 6.0.0 and fit addon.
- `lib/status.mjs`, `lib/detect.mjs`: the status detector and the install detector under test.
- `probes/*.probe.mjs` (8 files), `vitest.config.mjs`, `host-child.mjs`, and the CI job (moved out of `.github/workflows/` at the final commit to `apps/terminal-spike/ci/terminal-spike.yml`).

## Findings, with numbers

Numbers are from CI run 37362082901 (the last run, 37363956365, added the Unicode sample and slower Windows shell waits and agrees) (Linux `ubuntu-latest`, macOS `macos-latest` arm64, Windows `windows-latest`, build 10.0.26100; Node 24.21; node-pty 1.1.0; Chromium 153). "L / M / W" is Linux, macOS, Windows. Runner machines are small and shared, so read them as orders of magnitude.

### 1. Resize
Correct everywhere. A fake that reads raw saw every size the pty was given (5 of 5), a burst of 60 resizes in about a second ended on the last size, and 20 by 5 and 500 by 200 were both reported. Resize reaches the program in 0.12 / 0.26 / 15.7 ms (median). In Chromium through the fit addon the program saw the xterm cell size after every box change on all three (4 of 4). Windows ConPTY takes a frame (about 16 ms) to pass a resize on.

### 2. Many panes at once
4, 8, 16 and 32 simultaneous panes all started, each answered its own marker, no cross talk. 32 panes ready in 384 / 815 / 2268 ms. A pane's child (a small Node program) costs about 48 to 51 MB; the host (Ogden's server) costs a few MB on Linux and macOS and 50 to 230 MB at 8 to 32 panes on Windows (ConPTY output workers plus the mirror; measured in the same process as the test harness, so an upper bound). Windows adds one `conhost` per pane (+8 for 8 panes) and the spawn call itself takes about 52 ms (1 / 2 / 52 ms). Spawn to first prompt, with Node start in it: 33 / 66 / 122 ms.
The epic's caps of 8 panes per project and 16 per install are safe on all three, and 32 also worked. Real CLIs are heavier than the fake (assume 150 to 400 MB each; to be measured live).

Windows quirk: in 2 of 3 CI runs one pane of 16 or 32 opened at once printed only the start of its first line and nothing after, for 60 s ("held back first output"). A dedicated storm (16 panes, 5 rounds, 80 panes) plus 40 single opens did not reproduce it in the third run, so no un-sticking action was learned. Recommendation: panes show "starting" until the first complete prompt, a pane silent for more than 10 s after start offers "Restart pane", and 16.2 tries a resize nudge on Windows.

### 3. Scrollback
Server side: a headless xterm mirror with 10,000 lines of scrollback after 30,000 lines of output cost about 34 / 38 / 42 MB per pane at that depth and serialized in 61 / 134 / 82 ms to a 110 KB snapshot. Browser side: the xterm scrollback stays what the page sets (3,001 lines kept after 3,000 printed, then restored after a reload). Default xterm scrollback in the current panel is 1,000 lines. Recommendation: per pane scrollback of 5,000 lines (about 20 MB at 120 columns), a setting.

### 4. Copy and paste
In Chromium on all three: bracketed paste is on when the program asks, `term.paste` wraps in the bracketed markers, newlines go as carriage returns, and a pasted text with accents, CJK and emoji arrives byte for byte; select all and the system clipboard round trip worked. At the pty level a 100 KB bracketed paste arrived intact on Linux and macOS in 21 and 44 ms. On Windows the program received all 102,412 bytes but ConPTY took 9 to 10 seconds (about 11 KB per second), whether written whole or in 1 KB or 4 KB chunks, with the output echoed or quiet; a nudge did not change it. Ctrl+C reaches a raw reading program as one 0x03 byte, and a program in cooked mode gets SIGINT, on all three. Recommendation: the server must not apply a short deadline to pasted input on Windows, the socket's rate limit (1 MiB burst) is fine, and the UI should show a small "pasting" state for large pastes.

### 5. Unicode and colours
Palette, 256 colour and truecolour colours, bold, CJK wide cells, combining marks, the alternate screen, OSC titles and bracketed paste mode all read back correctly from a real xterm on all three. A 842 KB stream of 3 and 4 byte characters crossing read boundaries had no broken character on Linux and macOS (0 replacement characters, 40,000 of 40,000 units). On Windows there were no replacement characters and a short sample came through code point for code point (CJK, emoji, combining mark, full width letter), but only 36,005 of 40,000 units of the long stream matched whole: ConPTY re-renders the screen and re wraps the stream at the pane's column and drops spaces at wrap points and line ends, so the bytes are not the program's bytes (they carry extra cursor and title sequences too, 901 KB for 842 KB). The screen is right, the byte stream is not; that is one more reason replay and status read the mirror's screen, never a recorded stream. One real gap: xterm's default width table treats emoji as one cell wide (cell width 1 for a smiley face), which misaligns the line; loading `@xterm/addon-unicode11` and setting `unicode.activeVersion = '11'` fixed it (width 2). The web package does not load that addon today. Recommendation: load it for panes.

### 6. Input latency
Key to echo through the pty only: 0.15 / 0.33 / 0.63 ms median (p95 0.23 / 0.47 / 10 ms); with four other panes flooding output 0.36 / 0.28 / 10.9 ms. Through the gated WebSocket and a real xterm keydown in Chromium: 0.8 / 1.7 / 1.2 ms median, p95 1.2 / 4.0 / 2.1 ms. Typing in one pane while another floods and a viewer is paused: Windows 1.4 ms median, 15.6 ms p95. Input latency is not a risk; Windows adds one 16 ms frame at worst.

### 7. Output volume and backpressure
A flood of 100 MB (40 MB on Windows): 34 / 18 / 4.8 MB per second bare and 25 / 12 / 4.3 MB per second with the server side mirror parsing it (extra CPU about 1 to 3 s per 100 MB). Six panes each printing 20 MB at once into six xterms in Chromium finished in 8 / 21 / 28 s with the page at 18 to 56 frames per second and 43 to 65 MB of JS heap. The existing safeguard works for panes: a viewer that stops reading is closed by the server once 1 MiB is unsent (closed in every run), the pane and the fast viewer carry on and finished (63 to 69 MB delivered). Recommendation: keep epic 3's slow viewer rule; there is no way to pause a pty reliably on Windows, so the mirror and a bounded per viewer buffer are the bound.

### 8. Clean kill of only the panes Ogden started
With a bystander (a detached process Ogden did not start) and a look alike (the exact command line of a pane's CLI, started outside Ogden): closing three panes (one that ignores hangup, interrupt and terminate; one with a helper; one with a detached helper) stopped each pane and the helper, left the bystander and the look alike running on all three, and `kill()` on a pane that had already exited signalled nothing. Kill took 3 s on Linux and macOS (my probe waited out its 3 s check for the detached helper) and 0.2 s on Windows. A helper a CLI starts detached on purpose outlives its pane on Linux and macOS (accepted since 3.8) and was stopped on Windows by the job. Ogden only ever signals a pid it spawned itself, through the process group on POSIX or `taskkill /T /F` on Windows, by absolute path.
Gap: when the server itself is killed hard, a pane whose program ignores hangup keeps running on macOS and Windows (it stopped on Linux). A normal Quit stops them; a crash does not. Recommendation: record each pane's pid and start time in the data folder and sweep those, and only those, on the next start (never match by name).

### 9. Launching each CLI by detecting an installed binary (never installing)
Detection by PATH lookup (Windows with `PATHEXT`) plus well known folders, with one `--version` under the allowlist and a timeout, no shell: found, not found with the official install link, and found but failed all work on all three (6 launchers: claude, codex, grok, antigravity as `agy`, gemini, copilot). Detection of all six took 0.4 to 1.5 s. Nothing but the version probe was ever executed and nothing was installed.
Windows facts: npm installed CLIs are `.cmd` shims, and node-pty starts a `.cmd` or an `.exe` given by absolute path (works, about 90 ms to prompt, also with a space in the path), but a bare name fails ("File not found") even with the pane's `PATH`, and an unreadable path is a spawn error, not an exit. Node refuses to run a `.cmd` without a shell (the 2024 security fix), so the version probe on a shim goes through `cmd.exe` with the whole command wrapped in one more pair of quotes. On macOS and Linux a missing file spawns and then exits with code 1 and a bare name resolves through the pane's `PATH`. Recommendation: always spawn the absolute path found by detection.

### 10. AD-16 environment for pane children
Sixteen sentinel secrets set in the server environment (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CODEX_API_KEY`, `XAI_API_KEY`, `GEMINI_API_KEY`, `GH_TOKEN`, `GITHUB_TOKEN`, `COPILOT_GITHUB_TOKEN`, `NPM_TOKEN`, `AWS_SECRET_ACCESS_KEY`, `OGDEN_AGENTS_*`, a `LC_*` carrier, a proxy URL with a password, `SSH_AUTH_SOCK`) never reached a pane child or an interactive shell in it, on all three (0 of 16, checked in the child's whole environment and in a shell's `env` or `Get-ChildItem Env:`). The child saw only `HOME LANG PATH PWD SHELL TERM USER` (Linux), plus `TMPDIR` and the locale names (macOS), or `COMSPEC PATH PATHEXT SYSTEMROOT TEMP TMP TERM USERNAME USERPROFILE` (Windows). `TERM` is `xterm-256color` from node-pty.
Gaps for panes (the base allowlist is built for helpers, not for a user's shell and CLIs): `COLORTERM` is missing everywhere (CLIs then fall back from truecolour); on Windows `APPDATA`, `LOCALAPPDATA`, `ProgramFiles`, `ProgramData`, `windir` and `PSModulePath` are missing (cmd showed `%APPDATA%` unexpanded; npm global CLIs and many tools read them; PowerShell worked because it sets its own); the Windows code page was 437. Proposed `paneEnvironment()` in `child-env.ts`: the base plus `COLORTERM`, `LANG` kept, `XDG_*`, `WINDOWS_FOLDERS`, `ProgramFiles`, `ProgramFiles(x86)`, `ProgramW6432`, `CommonProgramFiles`, `ALLUSERSPROFILE`, `USERDOMAIN`, `COMPUTERNAME`, `HOMEDRIVE`, `HOMEPATH`, `OS`, `PROCESSOR_ARCHITECTURE`, `LOGNAME`, all checked against `SECRET_NAME`. Proxies and `SSH_AUTH_SOCK` are not passed by default (a proxy URL can hold a password; `SSH_AUTH_SOCK` lets the pane use the user's keys), each an opt in in the launcher's visible settings. A plain shell still reads the user's own shell start up files, which is the user's own environment, by design.

### 11. AD-15 on the pane socket
The pane socket sits under `/ws`, so the existing gate applies unchanged. Opened only with Host `127.0.0.1:port` or `localhost:port`, a live tab token in the subprotocol, and the page Origin. Refused: no token (401), wrong token (401), no `ogden.v1` (401), two tokens (401), token in the query string (401), foreign Origin (403), Origin of another local port (403), `null` Origin (403), no Origin (403), wrong Host (403), a plain GET (401 without a token). The token is never echoed back (the server answers only `ogden.v1`). All identical on the three OSes. Not covered here (16.9): the Developer mode refusal (`developer_mode_required`) and a per pane id check, which the spike's one pane route did not have.

### 12. Reconnect after a browser refresh, scrollback replay
In Chromium on all three: reload the tab, reopen the pane's socket, the screen and 3,000 lines of scrollback came back identical and typing worked (213 / 257 / 270 ms from reload to replayed).
Replay strategy matters. The raw backlog epic 3 keeps (last 64 KiB, trimmed at a line) rebuilt the visible screen correctly for plain output, a short full screen app and a redrawing menu, but FAILED for a full screen app on the alternate screen painted once and then updated in place (30 of 30 visible rows wrong and the alternate screen lost, because the paint and the mode switch are older than the tail). A server side `@xterm/headless` mirror serialized with `@xterm/addon-serialize` rebuilt every workload exactly (0 rows differ in 4 of 4, 110 KB snapshot, 2 to 134 ms). Codex and other TUIs run exactly like that. Recommendation: the pane keeps a headless mirror (and the replay is its snapshot), not a raw tail. The mirror adds `@xterm/headless` and `@xterm/addon-serialize` (both MIT, pure JavaScript) to the server and has the cost in 3 and 7 above.
Sign in: a code pasted into a login prompt reached the CLI, the CLI stored its login in the user's own home folder (the fake's `.fakecli`), and the pasted code and the CLI's output were absent from the server's log (0 lines), and nothing was written to Ogden's data folder.

### 13. Status per pane
Fake CLIs with ground truth labels, three detectors on the same bytes: `screen` (headless mirror, last lines only, pattern depth per pattern), `tail` (stripped recent bytes), `recency` (no patterns). Agreement after a 1.5 s grace after each change, same on all three OSes:

| scenario | screen | tail | recency only |
|---|---|---|---|
| permission question (y/n), then work, then idle | 100% | 100% | 63 to 66% |
| permission numbered menu | 100% | 100% | 63 to 66% |
| press enter to continue | 100% | 100% | 63 to 66% |
| output text that merely contains (y/n) while working | 100% | 100% | 100% |
| a (y/n) line, then silent work | 75% | 75% | 75% |
| a prompt in words the patterns do not know | 39% | 39% | 39% |
| silent thinking for 4 s | 27 to 28% | same | same |
| CLI exits | exit event | | |

Detection lag: working in about 10 to 30 ms, needs attention in 400 to 480 ms (a 400 ms quiet window on purpose), idle in 1.2 s (a 1.2 s window), exited in under 30 ms from the exit event. CPU to track a pane: about 1 to 3 ms per scenario, negligible. The screen and tail detectors scored the same here; the screen is the one that survives a redrawing TUI and is already needed for replay. Limits, stated in the UI as "a guess": silent work with no output reads as idle after 1.2 s; a `(y/n)` that happens to end the output is read as needs attention until output resumes; a changed prompt wording is missed (falls back to working or idle); recency alone cannot ever say needs attention. Patterns are per launcher data and need the live checks.

### 14. Windows ConPTY behaviours
node-pty 1.1.0 on Windows 10.0.26100. The 3.8 retry held: a storm of 16 spawns at once (6 rounds, 96 spawns) and churn (8 spawns while 8 other panes exit or are killed, 10 rounds, 160 spawns) had no "Invalid pty handle" and no error 87 (0 retries used, 0 failures), in all three runs. Exit codes are reported exactly (0, 3, 130), a program that exits at once keeps its output and code (25 of 25), and no output was lost at exit in 20 runs of 2,000 lines (0 lost on all three). Ctrl+C is a byte for a raw reader and SIGINT otherwise. Slower than Unix: output 5 MB per second, input about 11 KB per second, 52 ms to spawn, 16 ms to resize. PowerShell and cmd both start under the allowlist and run commands; PowerShell takes several seconds to become ready on a CI runner (command run 20 to 40 s after start in the worst run), so the "starting" state matters. ConPTY asks the terminal for the cursor position at start; the probe's harness answered none and the shells still started, and xterm answers it when a viewer is attached.

## Risks (ranked)

1. Replay design (high, but solved on paper): raw tail replay breaks full screen TUIs. Needs the headless mirror and its snapshot (pure JS, measured). If the mirror is dropped, "reconnect shows the same screen" is false for Codex and similar.
2. Windows ConPTY (medium): the held first output (2 of 3 runs, 1 pane of 16 or 32), slow paste and output, re-rendered Unicode. Mitigations: a "starting" state with Restart pane, a pasting state, accept lower throughput; Windows is a live check on a real machine, since CI runners are not users' machines.
3. Pane environment (medium): the base allowlist is too small for real CLIs on Windows and for colours; the larger list must stay secret free and tested (a sentinel test per OS in CI, as in this spike). Proxy and `SSH_AUTH_SOCK` stay opt in.
4. Hard server death leaves hangup ignoring panes on macOS and Windows (medium): start up sweep of recorded pids and start times, never by name.
5. Status is low fidelity (medium, known): silent work reads as idle; an unfamiliar prompt is missed. Labelled as a guess; patterns are per launcher data; never stored.
6. Real CLIs are heavier and change (medium): memory per pane 150 to 400 MB is assumed, prompt wording and flags change between versions, the Antigravity CLI (`agy`) replaced the Gemini CLI for Google's consumer plans, Grok Build and Copilot CLI are young. Live checks decide the launcher list.
7. Terms (low, user owned): each vendor's terms framing (the user's own interactive use on their own machine, Copilot interactive only) is the user's call, as in the epic.
8. Supply chain (low): adds `@xterm/headless`, `@xterm/addon-serialize` and `@xterm/addon-unicode11` (same publisher as the `@xterm/xterm` already shipped); pin exact versions and run the repo's existing minimum release age policy.

## Recommendation: GO, with these design decisions for 16.2 and on

1. Pane server side: `terminal-pty` as is; one pty per pane; a headless mirror per pane (scrollback 5,000 lines, setting) used for replay (snapshot on attach) and for status; never written to the event log, database or logs (verified: zero bytes of a login reached the server log).
2. Spawn only the absolute path found by detection; never a bare name (Windows fails); never install; the version probe under the allowlist with a timeout.
3. `paneEnvironment()` as in 10, with a per OS sentinel test in CI as in this spike.
4. Keep epic 3's socket rules for panes (1 MiB slow viewer close, input rate limit, 8 viewers), `/ws/pane/:id` under the gate, plus the server side Developer mode check.
5. Windows: "starting" state and Restart pane, a pasting state, no tight deadlines on input; the 3.8 retry stays.
6. Pid records and a start up sweep of the panes Ogden itself started.
7. xterm: load the Unicode 11 addon for panes; scrollback 5,000 lines.
8. Status: output recency plus per launcher prompt patterns on the mirror's last lines (depth per pattern), 400 ms quiet window for needs attention, 1.2 s for idle, exit from the exit event, labelled "a guess".
9. Caps: 8 per project and 16 per install are safe (32 worked); keep them as constants.

## Proposed agent-matrix.md addition (for 16.5, to verify live)

| Launcher | Executable | Where an install usually puts it | Install page (official) | Sign in | Notes for panes |
|---|---|---|---|---|---|
| Claude Code | `claude` | macOS and Linux `~/.local/bin/claude`; Windows `%USERPROFILE%\.local\bin\claude.exe`; npm global `claude`/`claude.cmd` | docs.anthropic.com Claude Code | inside the CLI (subscription or Console login) | Terminal resume `claude --resume <id>`; Windows ConPTY passes resize, bracketed paste, Ctrl+C and truecolour (3.8) |
| Codex | `codex` | npm global (`@openai/codex`; on Windows `%APPDATA%\npm\codex.cmd`), Homebrew | github.com/openai/codex | inside the CLI | `codex resume <id>`; full screen TUI (alternate screen), so replay needs the mirror |
| Grok | `grok` | `~/.local/bin` or `~/.grok/bin` from x.ai's installer; npm | x.ai/cli | inside the CLI | `grok --resume <id>`; young, expect changes |
| Antigravity | `agy` | macOS and Linux `~/.local/bin/agy`; Windows `%LOCALAPPDATA%\agy\bin` | antigravity.google | Google account inside the CLI | replaced the Gemini CLI for Google's consumer plans; one Go binary |
| Gemini | `gemini` | npm global | github.com/google-gemini/gemini-cli | inside the CLI | only as a fallback launcher if the user has it; hidden when not found |
| Copilot | `copilot` | npm global (`@github/copilot`), WinGet `GitHub.Copilot`, Homebrew | docs.github.com Copilot CLI | `copilot login` inside the CLI | interactive only: never scripted, never started by Ogden on a schedule (E16-R9) |
| Plain shell | user's `SHELL`, else `bash` or `sh`; Windows `powershell.exe` then `cmd.exe` | system | none | none | Windows PowerShell can take seconds to start |

Names and locations above come from the vendors' public docs and Ogden's own agent matrix; none was run. The user's live checks confirm each.

## Live checks for the user (hitl; real CLIs, never in CI)

On a Mac and on a Windows machine, with Developer mode on once 16.2 exists (until then, in any terminal, the same tests, since they test the CLIs themselves):
1. Each of `claude`, `codex`, `grok`, `agy`, `copilot` (and `gemini` if installed) answers `--version`, and where `where` or `which` finds it (the install locations in the table).
2. Each shows its sign in inside a terminal, the code or link flow works in a pasted terminal, and nothing is asked of Ogden.
3. Resize a window while the CLI is open; the CLI redraws correctly. Paste a long text (several thousand characters) into each. On Windows note how long a 100 KB paste takes.
4. Open four to six at once; note machine memory.
5. Leave each at a permission question; copy the exact words it shows (these are the status patterns) and say what it prints while thinking silently.
6. Windows only: the panes' first prompt always appears (the held first output); PowerShell start time.
7. Close the app window or kill the server while a CLI runs; note whether the CLI keeps running.

## Go or no go (for the user)

Ask: "Spike 16.1 is green on Mac, Windows and Linux with fake CLIs. Do you say GO to build epic 16 (stories 16.2 onward) with the design decisions above, and is the launcher list Claude Code, Codex, Grok, Antigravity (`agy`), Copilot and a plain shell, with Gemini only if installed?"

## Tasks & Acceptance

- [x] `apps/terminal-spike/`: the probe, its fake CLIs, helpers and per OS findings JSON.
- [x] CI job on ubuntu, macOS and Windows: green (runs 37362082901 and 37363956365); each question above answered or recorded as a limit.
- [x] this plan: findings, numbers, risks, recommendation, matrix addition, live checks, go or no go.
- [x] the temporary job moved out of `.github/workflows/` to `apps/terminal-spike/ci/terminal-spike.yml`.
- [ ] the user's go or no go and launcher list recorded as a dated Decision in the epic's Notes (after the user answers).
- [ ] the user's live checks recorded.

## Implementation Notes

- Implemented directly in this session; the work was a CI iteration loop (push, read logs, fix). Five CI runs (the first two had Windows failures that were probe faults or the held first output). Fixes found on the way: cmd shim quoting for the version probe; a stricter "wait until quiet" for slow PowerShell; polling floor in the latency numbers (the first latency numbers were a 5 ms poll, replaced by event driven waits); the first Windows run showed the held first output and the slow paste, which is why `conpty-quirks.probe.mjs` exists.
- Decision (keep or remove): the spike code stays in `apps/terminal-spike/`, every file marked SPIKE 16.1, as 16.2's reference (harness, fake CLIs, gate server, status and detection code). It is not in the pnpm workspace and installs its two xterm helper packages with npm only inside the throwaway job. 16.2 copies what it needs into `packages/` and the real CI, then `apps/terminal-spike/` is deleted (the refactor sweep, 16.10, at the latest). The job is at `apps/terminal-spike/ci/terminal-spike.yml`.

## Plan Change Log

## Review Triage Log
