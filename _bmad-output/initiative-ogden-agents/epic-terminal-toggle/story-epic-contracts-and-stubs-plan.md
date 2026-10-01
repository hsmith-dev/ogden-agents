---
title: 'Epic contracts and stubs'
type: 'feature'
ticket: '2'
created: '2026-09-30'
status: 'built'
baseline_revision: '5d2d019'
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

**Problem:** 3.1's terminal contract is provisional: every switch refusal is 409 `session_busy`, chat input while the terminal drives is 400 `invalid_request`, and there is no availability shape, from-terminal origin, import hook or explicit capability. Lanes 3.3–3.7 would each invent these in shared files.

**Approach:** Freeze every shared shape now and wire stubs that keep today's behaviour, naming the lane that owns each file.

## Boundaries & Constraints

**Always:** Bytes are binary frames on the gated `/ws/terminal/:sesId`, JSON text frames are control only, and the event log gets only `session.driver_changed` and imported messages (confirms the epic's two coordinator assumptions, as 3.1 built them). Core names no agent, OS or terminal library (AD-1). A refusal changes nothing. Old events without the new optional fields still parse.

**Never:** Lane behaviour: import/diffing (3.3), recovery rules beyond today's (3.4), reattach order, size-follows-last, input rate limit (3.5), toggle UI or caption (3.6), node-pty/CLI availability checks, agent-matrix (3.7), Windows (3.8). No gate, CSP or migration change.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error |
|---|---|---|---|
| Switch while busy | working, waiting, queued, switching | unchanged | 409 `session_not_idle` |
| Switch, no terminal | no capability, node-pty missing, CLI missing, never reached agent | unchanged | 409 `terminal_unavailable`, `details.terminal` |
| Chat while terminal drives | POST message | refused | 409 `driver_is_terminal` |
| GET session | any | `{ session, terminal }` | — |
| Attach frame | `{type:'attach',cols,rows}` | applied as a resize (stub) | bad shape ignored |
| Switch back | driver terminal | import hook (stub: nothing), then `driver_changed` cause `user` | hook throws: logged, switch completes |
| CLI exit / stop / restart | — | cause `cli_exited` / `server_stopped` / `server_restarted` | — |

</frozen-after-approval>

## Code Map

- `shared/src/terminal.ts` -- 3.1 schemas; extend here (`api.ts` stays import-free). `errors.ts` `API_ERROR_CODES`; `chat.ts` `SessionResponse`; `events.ts:246,285` driver-changed payload, `origin`.
- `core/src/errors.ts:86` `DriverSwitchRefusedError` (keep as base). `core/src/chat.ts` `toTerminal` l.916, `toChat` l.1001, `sendMessage` l.1059-60, `onExit` l.984, `close` l.1186. `entities.ts:124,357` `setSessionDriver`, `releaseTerminalDrivers`. `agent-port.ts:171` `terminalCommand?`.
- `adapters/src/acp-claude-code/terminal-command.ts` (CLI resolution inside `claudeTerminalCommand`), `claude-code-agent.ts:218`.
- `server/src/chat-routes.ts:82-97` `refusal`; `start.ts:545` `chatAgent` forwards the capability; `terminal-socket.ts` frame parsing.
- `web/src/chat/transcript.ts:211` -- Try again skips only `deny_reason`; a terminal user message stays retryable. Leave it.
- Tests: `gate.test.ts:610-670` registry; `core/test/chat.test.ts:1481` `fakeTerminal`, `:1539,1663` `terminalCommand` fakes.

## Tasks & Acceptance

**Execution:**
- [ ] `shared/src/terminal.ts` -- `SessionTerminal` = `{available:true}` | `{available:false, code:'agent_unsupported'|'no_agent_session'|'pty_unavailable'|'cli_not_found', reason}`; client frames `attach{cols,rows}`, `resize`; server frames `exit`, `size{cols,rows}` (another viewer resized); `DriverChangeCause`.
- [ ] `shared/src/errors.ts`, `chat.ts`, `events.ts` -- the three codes; `SessionResponse.terminal?`; `driver_changed.payload.cause?`; `origin: enum['deny_reason','terminal']`.
- [ ] `core/src/errors.ts` -- `SessionNotIdleError`, `TerminalUnavailableError(code, reason)` (both extend `DriverSwitchRefusedError`), `DriverIsTerminalError`.
- [ ] `core/src/agent-port.ts` -- `terminalCommand?` becomes `terminalResume?: { command(id, env); locate(env) → {found:true}|{found:false,reason}; transcript?({agentSessionId,cwd,env}) → AgentTranscriptTurn[] }`, turn = `{role, text}`.
- [ ] `core/src/terminal-import.ts` (new) -- `turnsToImport(stored, turns)` stub returning `[]` (3.3).
- [ ] `core/src/entities.ts`, `chat.ts` -- `setSessionDriver(id, driver, cause?)`; new errors thrown; causes passed; `toChat` runs `transcript` + `turnsToImport` after `stopTerminal`, appends with `origin:'terminal'`, any failure → `internalError`.
- [ ] `adapters/.../terminal-command.ts`, `claude-code-agent.ts` -- extract `resolveClaudeExecutable`; declare `terminalResume {command, locate}`.
- [ ] `adapters/src/terminal-memory/index.ts` (new), `index.ts` -- in-memory `TerminalPort`: echoes, records writes and resizes, `exit(code)`, switchable `available`.
- [ ] `server/src/terminal-availability.ts` (new) -- stub: `agent_unsupported` without `terminalResume`, else available (3.7). `chat-routes.ts` GET session adds `terminal`, error mapping; `app.ts`, `start.ts` wiring; `terminal-socket.ts` takes `attach` as a resize.
- [ ] `tests/fixtures/fake-claude-cli.mjs` -- `crash` (exit 70, no output); POSIX `resized=<c>x<r>` on SIGWINCH.
- [ ] `epic-terminal-toggle.md` -- the two frame/event assumptions marked "Confirmed (story 3.2)".
- [ ] Tests: `shared/test/contracts.test.ts` (each schema, code, cause, origin; old event parses); `adapters/test/terminal-memory.test.ts` (every method); `core/test/chat.test.ts` (matrix by class and code, causes, failing hook still switches; fakes move to `terminalResume`); `server/test/terminal-socket.test.ts` (status codes, GET `terminal`, attach); `gate.test.ts` registry lists `GET /ws` and `GET /ws/terminal/:sesId` after the gate; `crash` in `terminal-pty.test.ts`.

**Acceptance Criteria:**
- Given lanes 3.3–3.7, when each builds, then none edits `shared/src/*`, `core/src/errors.ts` or `agent-port.ts` except to adjust a shape it owns.

## Implementation Notes

- `DriverSwitchRefusedError` is now an abstract base; every refusal is a `SessionNotIdleError` (409 `session_not_idle`, also for "already switching") or a `TerminalUnavailableError(terminalCode, reason)` (409 `terminal_unavailable`, `details.terminal` from its `terminal` getter). No terminal port → `pty_unavailable`; `locate` not found, or `command` rejecting → `cli_not_found`; `open` failing → `pty_unavailable`. A message sent while switching is also `SessionNotIdleError` (409 `session_not_idle`). `GET` session survives a throwing availability check: `terminal` is `pty_unavailable` with a plain reason, and only an error code is logged.
- `TerminalUnavailableCode` is exported beside `SessionTerminal`; `AgentCliLocation` and `AgentTranscriptTurn` (`role: 'user' | 'agent'`) sit in `agent-port.ts`. `turnsToImport` returns the turns to append; core appends them as completed messages before `driver_changed`, the user's with `origin: 'terminal'` (agent replies carry no origin).
- `setSessionDriver` validates `cause` against the shared enum; with no cause the payload has none (old events parse). Causes: `user` (both directions), `cli_exited`, `server_stopped` (`close`), `server_restarted` (`releaseTerminalDrivers`).
- `start.ts` forwards all of `terminalResume` (`transcript` only if the adapter has it) through `freshChatEnv`, so 3.3 adds `transcript` in the adapter without touching `start.ts`. `createApp` takes `terminalAvailability`; without it `GET` session has no `terminal`.
- Fake CLI: `crash` exits 70; on POSIX it prints `resized=<c>x<r>` on Node's stdout `resize` event (a raw `SIGWINCH` listener still reads the old size). The attach check lives in the existing win32-skipped resize test.
- `web/src/terminal/terminal-socket.ts` (3.6's) got a one-line guard: `TerminalServerFrame` is now a union, so only `exit` calls `onExit`; it did not compile otherwise.

## Plan Change Log

## Review Triage Log

## Design Notes

- **Ownership:** `chat.ts` terminal code (split by 3.11): 3.4, then 3.5. `terminal-import.ts`, adapter `transcript`, fake CLI session file: 3.3. `terminal-socket.ts`, `terminal-pty/*`: 3.5, then 3.8. `terminal-availability.ts`, `agent-matrix.md`: 3.7 (never the adapter). `web/src/terminal/*`, `chat-api.ts`, `session-page.tsx`, caption: 3.6.
- **409 for `terminal_unavailable`:** it is this server's state, like `session_busy`; the body carries the `SessionTerminal` the toggle shows.
- **`SessionTerminal`, not `TerminalAvailability`:** core already exports that name (`{ok, reason}`, `terminal-port.ts`).
- **Not idle stays out of `SessionTerminal`:** the UI derives it from the state (E3-R5 vs E3-R7); queued messages exist only while `working`.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test` -- expected: green; PTY tests skip with a reason if node-pty can't load.
- `pnpm build && pnpm e2e` -- expected: green, `terminal.spec.ts` unchanged.
