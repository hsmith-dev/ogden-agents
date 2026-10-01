---
title: 'Terminal socket: resize, reattach and several viewers'
type: 'feature'
ticket: '5'
created: '2026-10-01'
status: 'built'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-terminal-toggle/epic-terminal-toggle.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Output reaches every viewer, but `attach` is only a resize, the backlog is sent before the viewer's size is known, no `size` frame is sent, size ignores who typed, and a tab may type without limit (3.1 F4) (E3-R2, E3-R3).

**Approach:** Core tracks the PTY size and each viewer's own size; the last viewer to attach, resize or type sets it and the others get `size`. The server sends the backlog after `attach` and rate-limits each viewer's input.

## Boundaries & Constraints

**Always:** 3.2's frame format unchanged: binary = bytes, JSON text = `attach`/`resize` in, `exit`/`size` out. Sizes within `1..MAX_TERMINAL_COLS` × `1..MAX_TERMINAL_ROWS` (schema, and clamped again in core). Backlog stays memory-only, newest 64 KiB (`TERMINAL_BACKLOG_CHARS`). Keep 3.1's frame caps (1009), slow-viewer close (1013, F2) and token hold. Closing a socket detaches only that viewer; a viewerless PTY runs until switched back or server stop (user decision; no idle timeout). Nothing typed or printed is logged, evented or stored (AD-16).

**Never:** `shared/*` changes (use standard 1008 for the rate limit). Edits to `start.ts`, `terminal-availability.ts` (3.7), `terminal-pty/*` (3.4 and 3.8), or the handoff paths in `toTerminal`/`toChat`/CLI exit (3.4). Windows resize: the checks stay skipped on win32 (3.8).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error |
|---|---|---|---|
| Attach | `attach{cols,rows}` | PTY resized to it, other viewers get `size`; then backlog, then live bytes | — |
| No `attach` in 5 s | open socket | attached at the current size | — |
| Bytes before `attach` | binary | ignored | — |
| Resize | `resize` from A | PTY = A's size; B gets `size`; A doesn't | bad shape ignored |
| Type after another resized | B types, PTY at A's size | PTY = B's size; every viewer gets `size` | — |
| Two viewers type | A and B | both reach the CLI; both see all output | — |
| Reload / network drop | socket closes, new one attaches | CLI runs on; new viewer gets the backlog | — |
| Every viewer gone | — | PTY still running after 60 s | — |
| Input flood | more than the budget | that viewer closed 1008 `rate_limited`; others and CLI unaffected | count logged only |
| Terminal ends | exit / switch back / stop | every viewer gets `exit`, then 4000 | — |

- Decision (2026-10-01, user): on an abnormal close (1006/1001) the terminal panel reconnects by itself with backoff (1, 2, 4 s; up to 5 tries), re-attaching with the backlog, then shows "Reload to reconnect" (small edit to 3.6's terminal-panel.tsx, e2e check).
- Decision (2026-10-01): plan kept whole.

</frozen-after-approval>

## Code Map

- `core/src/chat/terminal.ts` `attachTerminal` l.240-256 -- `backlog` is a snapshot taken when the viewer is made, and `resize` goes straight to the process. `onData` fan-out l.145-154 and `endTerminal` stay as they are. Owner: 3.4, then 3.5. Rebase on 3.4.
- `core/src/chat/types.ts:49` `TerminalViewer`, `:168` `Terminal` -- add `size`, `viewers`. `TerminalViewer` is exported from core (`chat.ts`).
- `core/src/chat/constants.ts` -- `TERMINAL_COLS/ROWS` are the initial size.
- `server/src/terminal-socket.ts` -- `receive` l.93-125 (resize on every frame; F4 is here), `onOpen` l.128-154 (sends the backlog right away). Owner: 3.5.
- `shared/src/terminal.ts` -- `TerminalSizeFrame`, `TERMINAL_CLOSE`, `MAX_TERMINAL_*`. Read only.
- `web/src/terminal/terminal-socket.ts:48-50` already sends `attach` first and handles `size`. `terminal-panel.tsx` reconnects only on 1013 and shows "disconnected" on any other close (see Open Question 1).
- `adapters/src/terminal-memory` records `resizes`. `tests/fixtures/fake-claude-cli.mjs` has `size` and `resized=`.
- Keep tests `server/test/terminal-socket.test.ts:320,495,517,541`, gate and marker tests.

## Tasks & Acceptance

**Execution:**
- [x] `core/src/chat/types.ts`, `chat/terminal.ts` -- the terminal keeps its current size and its set of viewers. A viewer has its own size and `onSize`; `backlog` becomes a getter; `resize` and `write` apply the viewer's own size when it differs and notify the other viewers (on a write, all of them); `detach()`; sizes clamped.
- [x] `server/src/terminal-socket.ts` -- attach order and its 5 s fallback; `size` frames out; a token bucket per viewer (4 MiB burst, 1 MiB/s refill) with the 1008 close; detach on close and on error.
- [x] `web/src/terminal/terminal-panel.tsx` -- only if Open Question 1 is answered (b).
- [x] `core/test/terminal-viewers.test.ts` (new) -- memory port with fake timers: every Matrix row except the socket ones, including "still running after 60 s".
- [x] `server/test/terminal-socket.test.ts` -- two sockets on one fake CLI: each types and each resizes, both see the output, and `size=` follows the last one (resize checks skipped on win32); attach order; flood closes 1008; reload reattaches with the backlog.
- [x] `_bmad-output/initiative-ogden-agents/deferred-work.md` -- a "Resolved:" entry for 3.1 F4, and update the index.

**Acceptance Criteria:**
- Given a marker typed by two viewers, then it appears in no event, database row, log line or log file (the 3.3 scan, kept).
- Given upgrades without the tab token or with a foreign Origin, then they are refused (the existing tests, kept).

## Implementation Notes

- Code Map re-checked against cc14fd6 and then 9728b39 (3.4 and its review fixes; 3.7's availability): `attachTerminal`, the `onData` fan-out and `endTerminal` moved down (3.4's `holdingSwitch`, bounds, crash import) but are otherwise as mapped. None of 3.4's handoff paths, `start.ts`, `terminal-availability.ts` or `terminal-pty/*` was edited. `terminal-socket.ts` was as mapped.
- Core (`chat/terminal.ts`, `chat/types.ts`): `Terminal` gains `size` and `viewers`; a viewer's own size is unset until it resizes, so a viewer attached by the 5 s fallback types at whatever size the terminal has. `TerminalViewer` gains `size` (the terminal's), `onSize`, `detach()`; `backlog` is a getter. Sizes are clamped in core (non-finite ignored). `TerminalSize` is exported.
- Server: `onEnd` is subscribed at open (a terminal can end before `attach`); the backlog and `onData` are read and subscribed in `attach`, in one tick. A viewer attached by the fallback gets a `size` frame with the terminal's size. A second `attach` is a resize; a `resize` before `attach` is ignored. The input budget counts frames from the first one, including ones ignored before `attach`. `now` and `attachWaitMs` options exist for tests only.
- Web: the panel reconnects after 1001/1006 with 1, 2, 4, 4, 4 s waits, showing "Reconnecting to the terminal"; the try count resets when the server sends anything (a socket that opens and drops at once counts as a failed try), and the screen is reset on the new socket's open, before the recent output arrives. The 1013 path now resets there too.
- Core's test uses its own echoing in-memory terminal (core can't import adapters, as in 3.4's tests); the server's socket tests use `terminal-memory` behind a real `createChat` and the socket alone, so attach order, the wait, the flood and detaching run without a PTY. The two-viewer and attach-order PTY tests are skipped on win32 (3.8).
- e2e: one new test in `terminal.spec.ts` (the decision's "e2e check"; the Verification line's "unchanged" predates it) using `page.routeWebSocket` to drop the terminal socket with 1001.

## Plan Change Log

- 2026-10-01: Open Question 1 answered by the user decision (reconnect with backoff), so the `terminal-panel.tsx` task applies and `terminal.spec.ts` gains one test.

## Review Triage Log

## Design Notes

On a resize, the server sends `size` to everyone except the sender, since the sender is already at that size. On a write that changes the size, it sends `size` to every viewer: the typer's xterm may have followed someone else's size, and the client ignores a size it already has (`terminal-panel.tsx` `onSize`). Backlog read and output subscribe happen in one tick, so no byte is lost between them.


## Verification

**Commands:**
- `pnpm typecheck && pnpm test` -- expected: green; PTY tests skip with a reason if node-pty can't load; resize checks skip on win32 (3.8).
- `pnpm build && pnpm e2e` -- expected: green, `terminal.spec.ts` unchanged.
