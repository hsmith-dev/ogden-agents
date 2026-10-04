---
title: 'Refactor sweep'
type: 'refactor'
ticket: '9'
created: '2026-10-01'
status: 'built'
baseline_revision: '3894c392c52cc2859ac20c371c79d11365b558ad'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 3 left findings and duplicates for this sweep: deferred-work open items, 3.4 F5, 3.5 F5, 3.6 F7, 3.7, 3.11's notes, and retrospective A6. Duplicated or page-untested code will drift before 3.10's release.

**Approach:** Close each listed item with the smallest change. Then read the epic-3 diff (`git diff c82cae7..HEAD`) once, fix only the mechanical, behaviour-free findings, and log everything else.

## Boundaries & Constraints

**Always:** Existing tests pass, with only their imports edited. Behaviour changes only where the matrix says so. The exports of `core`, `shared` and `adapters` stay; additions are fine. Each closed item gets a "Resolved:" deferred-work entry and an updated index line.

**Never:** Don't touch 3.8's files (`terminal-pty/*`, `detect.ts`, `terminal-command.ts`, `fake-claude-cli.mjs`, the win32 skips, `ci.yml`). No new dependency, migration or event type. Leave the non-epic-3 entries alone: the onboarding 500, `removeLeftovers`, and the install-scope index.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Backlog cut inside an escape sequence | 64 KiB cut falls inside `ESC[38;5…m` or an OSC | replay starts after that sequence, at a line break where it can | no terminator in reach: line-break cut, as today |
| Agent stops after the 10 s bound | dropped agent stops at 14 s | switch refused as today; then one log line, `terminal_release_late`, with the elapsed ms | Open Question 2 |
| 9th viewer | 8 attached | closed with `TERMINAL_CLOSE.tooManyViewers` (4429) | panel text unchanged |

- Decision (2026-10-01, coordinator): Q1 fake terminals — (b) merge core's fakes into core/test/support/fake-terminal.ts matching terminal-memory's failure options. Q2 late release — (a) log line only (no behaviour change in a sweep). Q3 files over 600 lines — (b) split session-page.tsx and start.ts.
- Decision (2026-10-01): plan kept whole.

</frozen-after-approval>

## Code Map

- `core/src/chat/terminal.ts` -- `trimBacklog` (l.120-125); `toTerminal`'s checks (l.191-226): unsupported → no port → idle → no session → pty → CLI, each run through `deadline.step`; the release bound (l.234).
- `server/src/terminal-availability.ts` -- the same checks, without idle and with no deadline, kept in order by hand. The wording is already shared through `core/src/terminal-reasons.ts`.
- `core/src/chat/agents.ts` -- `releaseAgent` (l.122), `drop`/`droppedAgents` (l.17-40).
- `server/src/terminal-socket.ts` l.83 and `web/src/terminal/terminal-panel.tsx` l.44 each define 4429. `shared/src/terminal.ts` `TERMINAL_CLOSE` is at l.92.
- Fakes: `core/test/terminal-handoff.test.ts` `handoffTerminal` (l.137), `core/test/terminal-viewers.test.ts` `memoryTerminal` (l.76), and `adapters/src/terminal-memory`. Core can't import adapters (AD-1). Core exports only `.` and `./data-dir`.
- `scripts/smoke-installed.mjs` (`redact` l.76, `echoLines` l.81, retry l.228-237) and `tests/e2e-installed/global-setup.ts` (l.26, 29, 55-63) duplicate code that belongs in `scripts/installed-package.mjs`.
- 3.11 leftovers:
  - `{@link}`s to unimported names in `core/src/chat.ts` (l.14-42) and `chat/types.ts`.
  - The `close` loop over a single value (`chat.ts` l.118).
  - `known?.` after `known` is already checked (`chat/turns.ts` l.137-144).
  - `entities.getWorkspace` in `sendMessage` (`turns.ts` l.246).
- `server/src/chat-routes.ts` -- `readBody` (l.60) and `ids`, imported by the workspace, permission and agent-setup routes.
- `web/src/routes/session-page.tsx` -- 612 lines. Its parts are tested in `driver-toggle.dom.test.tsx`. `tests/design-tokens.test.ts` forbids visual utilities in `src/routes`.
- Over 600 lines: `server/src/start.ts` 821 (epic 3 added 35), `shared/src/events.ts` 795, `core/src/agent-setup.ts` 660, `permissions.ts` 649, `claude-code-agent.ts` 639, `install.ts` 639.

## Tasks & Acceptance

**Execution:**
- [x] `chat/terminal.ts` -- `trimBacklog` never starts inside a CSI, an OSC (up to BEL or ST) or a two-byte ESC sequence. Unit-test each.
- [x] `core/src/terminal-checks.ts` (new), `chat/terminal.ts`, `terminal-availability.ts` -- one check list in two stages: (unsupported, port) and (session, pty, CLI). `toTerminal` runs the idle check between the stages and passes `deadline.step`; the server passes the promise as it is. Order and wording stay the same.
- [x] `chat/agents.ts`, `chat/terminal.ts` -- after `terminal_release_timeout`, log `terminal_release_late` once the agent stops. Test with fake timers.
- [x] `shared/src/terminal.ts` -- `tooManyViewers: 4429`, with a contract test. Keep the server's `TERMINAL_TOO_MANY_VIEWERS` export as an alias, and import the constant from shared in the panel.
- [x] Fake terminals -- Open Question 1.
- [x] `scripts/installed-package.mjs` -- `redact`, `echoLines`, and `startWithRetry`, which retries once in fresh folders. Both callers use them, and their log lines are unchanged.
- [x] `core/src/chat.ts`, `chat/types.ts`, `chat/turns.ts` -- fix the four 3.11 leftovers.
- [x] `server/src/request-input.ts` (new) -- move `readBody` and `ids` here and update the four importers.
- [x] `session-page.tsx` -- move the driver wiring into a hook in `web/src/terminal/`, which brings the page under 600 lines. New `web/test/session-page.dom.test.tsx`, covering:
  - the switch on `session.driver_changed`
  - focus moving to xterm and back
  - the URL following the driver
  - the refetch on a 409
  - the waiting bar staying off while the terminal drives
- [x] Read-only sweep of the epic-3 diff -- fix the mechanical findings; log the rest.
- [x] `deferred-work.md` -- "Resolved:" entries and index lines.

**Acceptance Criteria:**
- Given the sweep, when `pnpm typecheck && pnpm test && pnpm e2e` run, then they pass and no existing test changed beyond its imports.
- Given `packages/*/src`, then `4429` appears only in `shared/src/terminal.ts`, and the retry and echo code appears only in `installed-package.mjs`.


## Implementation Notes

- Backlog cut: `trimBacklog` is now a pure export of `chat/terminal.ts` (unit-tested in `core/test/terminal-backlog.test.ts`). Besides CSI, OSC and two-byte ESC, the DCS, SOS, PM and APC strings end at BEL or ST too (same rule as OSC).
- Checks: `core/src/terminal-checks.ts` (`checkTerminalSupport`, `checkTerminalReady`, exported from core: additions only). Core's `step` throws its `tooSlow` refusal on the deadline; the server passes `(promise) => promise`. The `command` step stays in `toTerminal`, as before. `getWorkspace` moved after the checks (it only gives the CLI's folder; `getSession` already proved the workspace).
- Late release: `TerminalHandoffError` takes an optional `elapsedMs` (message `terminal_release_late (<ms> ms)`); new code `terminal_release_late`. `agents.ts` needed no change.
- Fake terminals: `core/test/support/fake-terminal.ts`, imported under the old local names (`handoffTerminal`, `memoryTerminal`). Besides the imports, the two test files' header comments now name the shared fake; unused type imports were dropped.
- `startWithRetry({ start, timeoutMs, what, label })` returns `{ install, launcher, ready }`; `install`/`launcher` always name the current run, so both callers now read `run.install`/`run.launcher` for cleanup and output.
- `start.ts` split: `start-env.ts` (agent environment, test switches) and `start-types.ts` (`StartOptions`, `StopReason`, `PortFile`, `RunningServer`), re-exported from `start.ts` (821 → 589 lines). `session-page.tsx` 612 → 532 with `web/src/terminal/use-session-driver.ts`.
- Sweep of the epic-3 diff: one mechanical fix (terminal socket uses `TERMINAL_CLOSE.tooManyViewers`); one finding logged (internal handoff codes logged as "applying an agent event failed"). 3.8's files were not touched.
- Counts: vitest 72 files / 978 passed (4 skipped) → 74 / 993 (+8 backlog, +1 late release, +1 close codes contract, +5 session page).

## Plan Change Log

## Review Triage Log

- 2026-10-01 coordinator review: no behaviour changes found.
  - F1 (backlog cut untested for DCS, APC): fixed, two tests in `core/test/terminal-backlog.test.ts`.
  - F2 (`ESC` followed by a control character consumes a line feed): deferred (deferred-work).
  - F3 (lone low surrogate in the no-line-break fallback): deferred (deferred-work).
  - F4 (`startWithRetry` untested): fixed, `tests/installed-package.test.ts` (stalled first start retried, its cleanup and RETRY line; a non-timeout failure not retried).
  - F5 (late-release log after `close`): deferred (deferred-work).

## Design Notes

- **Ownership:** this sweep's files are the ones in the tasks. It shares only `deferred-work.md` (append-only) with 3.8. It starts after 3.8 merges, or during 3.8's hitl wait if it keeps off 3.8's files.
- **Backlog cut:** find the last `ESC` before the cut. If its sequence is unterminated at the cut, move the cut past the terminator, then on to the next line break.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test` -- expected: green.
- `pnpm build && pnpm e2e` -- expected: green, `terminal.spec.ts` unchanged.
- `pnpm pack && node scripts/smoke-installed.mjs` -- expected: passes, with the same log lines.
