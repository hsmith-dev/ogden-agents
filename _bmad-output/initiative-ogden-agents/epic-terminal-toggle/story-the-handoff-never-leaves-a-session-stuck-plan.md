---
title: 'The handoff never leaves a session stuck'
type: 'feature'
ticket: '4'
created: '2026-10-01'
status: 'built'
baseline_revision: '07bddee'
route: 'full'
route_source: 'auto'
review: 'coordinator'
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-terminal-toggle/epic-terminal-toggle.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A switch can still end badly: a crashed CLI orphans its children, a hung agent release holds `switching` forever, `/exit` imports no terminal turns, a switch racing the CLI's exit can import twice, and `close()` ignores in-flight switches (E3-R5).

**Approach:** Every driver change in `core/src/chat/terminal.ts` (CLI exit included) holds the `switching` lock, with bounded waits, and ends at `driver = ui` (idle, resumable) or `driver = terminal` with a live CLI. Each failure is proved with the memory port, fake timers and the fake CLI's crash modes.

## Boundaries & Constraints

**Always:** Only core sets `driver`; each change emits one `session.driver_changed` with its cause. Refusals change nothing (turn, card, queue untouched) and use 3.2's codes: `session_not_idle`, `terminal_unavailable`. Reasons are plain words for 3.6 to show. A viewerless PTY is never closed (user decision). Every exit path kills the CLI's whole tree.

**Never:** Edit `server/src/terminal-availability.ts`, `start.ts`, `agent-matrix.md` (3.7, in parallel), `web/*` (3.6), `server/src/terminal-socket.ts` or viewer/size logic (3.5), `shared/*` (frozen). No idle timeout for the PTY. No Windows-specific work (3.8).

## I/O & Edge-Case Matrix

| Scenario | State | Expected | Error |
|---|---|---|---|
| Switch while working / waiting / queued / switching | — | nothing changes or is interrupted | 409 `session_not_idle` |
| Message during a switch | `switching` | refused | 409 `session_not_idle` |
| Two switch requests race | one in flight | second refused; one `driver_changed` | 409 `session_not_idle` |
| Agent release hangs | `releaseAgent` past `TERMINAL_RELEASE_TIMEOUT_MS` | driver ui, idle | 409 `session_not_idle` "still stopping. Try again." |
| CLI fails to spawn | `open` rejects after release | driver ui, idle; next message resumes via ACP | 409 `terminal_unavailable` (`pty_unavailable`) |
| CLI crashes on start / later | exit 70 | turns imported, driver ui (`cli_exited`), tree killed | per Open Question 1 |
| CLI exits during switch back | exit while `toChat` runs | one `driver_changed` (`user`), one import | — |
| Kill doesn't exit | no exit in `TERMINAL_EXIT_GRACE_MS` | switch completes, driver ui | logged code |
| Import fails | transcript throws | switch completes | code logged (3.3) |
| Server stops mid-switch | `close()` during any await | `close` awaits the switch; driver ui; no PTY left | `InvalidOperationError` to the caller |
| Restart with driver terminal | — | idle, ui, resumable (3.1 F3, keep) | — |

- Decision (2026-10-01, user, Q1): when the CLI exits by itself with an error (incl. at start), the chat returns with an agent note in the transcript, e.g. "Claude Code's terminal closed unexpectedly (exit code 70)." (core only).
- Decision (2026-10-01, user, Q2): terminal turns are imported on a clean stop (close()) and, after a crash, on the next start (core sweep at createChat).
- Decision (2026-10-01): plan kept whole.

</frozen-after-approval>

## Code Map

- `core/src/chat/terminal.ts` -- `toTerminal` (checks, `releaseAgent`, mark, `open`, `onExit` l.155-168 sets `cli_exited` without importing), `stopTerminal` (bounded by `TERMINAL_EXIT_GRACE_MS`), `toChat`, `switchDriver` (`switching` lock). Owner now: 3.4, then 3.5.
- `core/src/chat/agents.ts:122` `releaseAgent` awaits `droppedAgents` unbounded. Don't change `drop`.
- `core/src/chat.ts` `close()` -- sets `server_stopped`, stops terminals; doesn't await in-flight switches.
- `core/src/chat/turns.ts:248` -- refusal while `switching`; reuse.
- `core/src/chat/constants.ts` -- add `TERMINAL_RELEASE_TIMEOUT_MS` (10 s).
- `adapters/src/terminal-pty/index.ts` `hiddenPtySpawner` -- `kill()` skips the tree once exited (orphans a crashed CLI's children); `onExit` added after exit never fires.
- `adapters/src/terminal-memory/index.ts` -- add options `openError`, `exitOnKill: false`.
- `tests/fixtures/fake-claude-cli.mjs` -- `crash` exists; add `FAKE_CLAUDE_CRASH_ON_START=1`; `FAKE_CLAUDE_GRANDCHILD` exists.
- Keep tests `core/test/chat.test.ts:1754-1825`, `server/test/terminal-socket.test.ts:285,302,466,481`.

## Tasks & Acceptance

**Execution:**
- [x] `core/src/chat/terminal.ts`, `constants.ts` -- bound `releaseAgent` in `toTerminal`; CLI exit takes the `switching` lock, kills the tree, imports turns, then sets `ui`/`cli_exited` (skips if a switch already holds it); register each switch promise in `running`.
- [x] `core/src/chat.ts` -- `close()` awaits in-flight switches (bounded) before stopping terminals.
- [x] `adapters/src/terminal-pty/index.ts` -- `kill()` after exit still kills the group on POSIX; late `onExit` is called once.
- [x] `adapters/src/terminal-memory/index.ts`, `tests/fixtures/fake-claude-cli.mjs` -- failure modes above.
- [x] `core/test/terminal-handoff.test.ts` (new) -- every Matrix row, fake timers for release, grace and close.
- [x] `adapters/test/terminal-pty.test.ts`, `server/test/terminal-socket.test.ts` -- crash with a grandchild leaves no process; crash on start returns the chat; restart row kept.

**Acceptance Criteria:**
- Given any Matrix row, when it ends, then the session is `driver = ui` and idle (or terminal with a live CLI), a chat message then gets a reply, and no CLI or child process is alive.

## Implementation Notes

- Baseline 07bddee (3.1, 3.2, 3.11, 3.6, 3.3, 3.7), not 73f83d4. Code Map re-checked: 3.7 added `server/src/terminal-availability.ts` (its own `plainOr` filter) and the `start.ts` wiring (`createTerminalAvailability`, one terminal port for chat and check); `releaseTerminalDrivers` still runs in `start.ts` before `createChat`. `start.ts` is unchanged. 3.7 having landed, `terminal-availability.ts` was edited (the Never-list barred it only while 3.7 ran in parallel) to share core's reasons, as the dispatcher asked.
- Every driver change runs through `holdingSwitch` in `core/src/chat/terminal.ts`: it takes `switching` before returning and drops it however the work ends; the promise goes in `running` (so `settled` waits) and in a local `switches` set (so `close` waits, at most `TERMINAL_CLOSE_WAIT_MS` = release + exit grace, then logs `terminal_close_timeout`). Paths under it: both switch directions, a CLI's own exit (`cliExited`), each terminal at close, and the import after a crash.
- `releaseAgent` is raced against `TERMINAL_RELEASE_TIMEOUT_MS` (10 s); past it the switch refuses `session_not_idle` "Claude Code is still stopping. Try again." and logs `terminal_release_timeout`. The dropped agent is left in `droppedAgents`, so the next message's agent still waits for it (never two processes). `stopTerminal`'s grace now logs `terminal_exit_timeout`. Both codes are a new `TerminalHandoffError` (message = code).
- `cliExited` (lock held): removes the entry, tells viewers, calls `kill()` (the tree, though the CLI has exited), imports, appends the agent's note for a non-zero exit (`terminalClosedNote`, "(exit code N)", no code for a signal), then `ui`/`cli_exited`. The `onExit` handler finds the lock taken only while the switch that opened that CLI still runs (an exit reported synchronously as core subscribes): it parks the exit on the entry and that switch finishes it, returning `ui`. With an async report the switch returns `terminal` and the exit path follows; both end at `ui` (two tests).
- Q2: `close` (`closeTerminals`) stops each terminal, imports its turns, then `ui`/`server_stopped`; the old synchronous `server_stopped` loop is gone. For a crash, a new adapter ref `terminalImportPending` (`1` once the CLI has opened, cleared after any import attempt) is swept by `createChat` (`importAfterRestart`), each import under the lock. The mark (3.3) keeps it from importing twice.
- `sendMessage` checks `switching` before `driver === terminal`, so a message during a switch back (or a CLI's exit) is `session_not_idle` as the Matrix says, not `driver_is_terminal`.
- `hiddenPtySpawner`: on its program's exit it SIGKILLs the POSIX group in its own `onExit` handler, once, and a later `kill()` does nothing (review F2; not Windows, story 3.8; deferred-work); `onExit` added after the exit is called once on `setImmediate`. Memory port: `openError`, `exitOnKill`, `exitOnOpen`. Fake CLI: `FAKE_CLAUDE_CRASH_ON_START=1`; its grandchild ignores SIGHUP and reports ready before the CLI goes on (a crash before that killed it under load, so the test proved nothing).
- Reasons (3.7 deferred entry, resolved): `core/src/terminal-reasons.ts` holds EXPERIENCE.md's words and `plainTerminalReason` (3.7's filter); core's refusal and the availability check both use it, so `node-pty`'s raw reason never reaches a 409. Core's `agent_unsupported` and `pty_unavailable` words changed to EXPERIENCE.md's (one core test regex updated).
- Core tests can't import adapters (AD-1), so `core/test/terminal-handoff.test.ts` has its own fake terminal with the memory port's modes. Two kept tests changed: the core "exits by itself" test awaits `settled()` before reading the driver, and the server crash and `/exit` tests wait for `ui`, since the import now comes first.

## Plan Change Log

## Review Triage Log

- Review of cc14fd6 (coordinator), all applied in the follow-up commit:
  - F1 (medium, fixed): not every wait under the lock was bounded (a hung `available`/`locate`/`command`/`open` or transcript read held `switching` forever). The checks before the release share one `TERMINAL_STEP_TIMEOUT_MS` (10 s) deadline, the spawn has its own (a CLI that starts late is killed at once), and each transcript read is bounded (treated as unreadable). Timeouts refuse `terminal_unavailable` "Claude Code's terminal took too long to start. Try again." and log `terminal_open_timeout`. The close-past-its-wait test became a hanging lookup that the switch gives up on (lock released, `settled()` resolves); one test per hanging step.
  - F2 (safety, fixed): a `kill()` after the exit could signal a reused process group. The post-exit group kill now runs only in `hiddenPtySpawner`'s own `onExit` handler, in the tick the exit is reported; a later `kill()` signals nothing. Residual risk (the exit is reported after the reap) logged in deferred-work with the Windows gap for 3.8.
  - F3 (fixed): `plainTerminalReason` also rejects a drive letter (`\b[A-Za-z]:`) and anything with `=`, and cuts a reason at 200 characters (`...`). Tests.
  - F4 (fixed): the crash-import sweep at `createChat` catches its own failure and logs it; a start never fails over it. Test.
  - F5 (deferred to 3.9): the two fake terminals can drift; an agent released after the bound stops late, unwatched. Logged in deferred-work.

## Design Notes

The CLI-exit path and `toChat` both import; holding `switching` across both is what keeps the 3.3 mark from being read twice. `stopTerminal` removes the entry before killing, so a killed CLI's `onExit` never sets `cli_exited`; keep that order.


## Verification

**Commands:**
- `pnpm typecheck && pnpm test` -- expected: green; PTY tests skip with a reason if node-pty can't load.
- `pnpm build && pnpm e2e` -- expected: green, `terminal.spec.ts` unchanged.
