---
title: 'Tracer bullet: switch one Claude Code chat to its terminal and back'
type: 'feature'
ticket: '1'
created: '2026-09-30'
status: 'built'
baseline_revision: 'c4d9235f018a63f6fcd6115a3ef442d5f3a6b84a'
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

**Problem:** `driver` exists and chat input is refused while `driver = terminal`, but nothing sets it, runs Claude Code's CLI or carries its bytes.

**Approach:** Thinnest end-to-end path: core `switchDriver` (idle only) releases the ACP process and opens `claude --resume <agentSessionId>` in a server-owned PTY via a new `TerminalPort`; gated `/ws/terminal/:sessionId` carries bytes to a bare xterm panel; switching back kills the CLI, sets `driver = ui`, and the next message reopens through ACP resume/load.

## Boundaries & Constraints

**Always:** Only core changes `driver`, via `entities.setSessionDriver`. Refuse unless `idle`, not busy, with a stored agent ref. Await the ACP process exit before spawning. Same `claude` as the chat: `env.CLAUDE_CODE_EXECUTABLE`, else `findClaudeExecutable(env)`, else the Agent SDK platform binary (claude-agent-acp's `claudeCliPath` lookup). cwd `workspace.realPath ?? workspace.path` (Claude Code finds sessions by cwd). env = the chat's (`freshChatEnv`, 9.2 key rule) + `TERM=xterm-256color`. Socket: binary = bytes, JSON text = control (`resize` in, `exit` out); passes the existing gate and holds the tab token like `/ws`. Viewerless PTY lives until switch back or server stop; `chat.close()` kills PTYs. Button only in Developer mode.

**Never:** Terminal bytes in events, DB, logs or diagnostics. Transcript import (3), reattach/multi-viewer (5), busy rules/restart recovery (4), availability and final error codes (2, 7), toggle design/banner/a11y (6), Windows (8). No gate or CSP change. No edits to 9.3/9.4 files.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error |
|---|---|---|---|
| To terminal | idle, has ref | ACP closed; CLI `--resume <ref>` in cwd; `driver_changed` | — |
| Not switchable | busy/queued/no ref/node-pty missing | unchanged | 409, plain reason (existing code) |
| Chat meanwhile | POST message | refused | existing path |
| Type | binary frame | PTY gets it; output back | — |
| Back to chat | driver terminal | tree killed; `driver_changed`; next message same session | — |
| CLI exits itself | `/exit` | driver → ui; `exit` frame | minimal |
| Bad upgrade | no token / foreign Origin | refused | 401/403 |

</frozen-after-approval>

## Code Map

- `packages/core/src/chat.ts` -- `sendMessage` refusal l.803; `agentFor` cwd/env/reopen l.566-630; `drop` l.436 (doesn't await close); `busy`/`live`; `close()`.
- `packages/core/src/entities.ts:365` -- `setSessionDriver`; reuse unchanged.
- `packages/adapters/src/terminal-pty/index.ts` -- `loadPty`, `hiddenPtySpawner`, `killTree`; `HiddenPty` lacks `resize` (`IPty.resize` exists).
- `packages/adapters/src/acp-claude-code/claude-code-agent.ts:136-150`, `detect.ts` -- executable choice. claude-agent-acp 0.84.0 passes the ACP id to the SDK as the CLI session id; confirm live.
- `packages/server/src/start.ts:434-497` -- `freshChatEnv`, `chatAgent` wrapper (must forward the new method), `createChat`.
- `packages/server/src/event-socket.ts:73-110` -- upgrade + token-hold pattern; `paths.ts` `isWsPath` already covers `/ws/*`.
- `packages/web/src/events/event-stream.tsx:303` -- socket URL + token protocols; `appearance/appearance.ts` `developerMode`.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/core/src/terminal-port.ts` (new), `index.ts` -- `TerminalPort.open({file,args,cwd,env,cols,rows})` → process (onData, onExit, write, resize, kill); entry 2 completes it.
- [ ] `packages/core/src/agent-port.ts` -- optional `terminalCommand?(agentSessionId, env) → {file,args}`.
- [ ] `packages/core/src/chat.ts` -- `ChatOptions.terminal`; `switchDriver(ws, ses, driver)`; `attachTerminal(sessionId)`; exit → `driver = ui`; `close()` kills PTYs.
- [ ] `packages/adapters/src/terminal-pty/index.ts`, `terminal-port.ts` (new) -- `resize`; `TerminalPort` over `loadPty`.
- [ ] `packages/adapters/src/acp-claude-code/terminal-command.ts` (new) + one line in `claude-code-agent.ts`.
- [ ] `packages/shared/src/api.ts` -- `sessionDriver` route (`POST {driver}` → `{session}`), terminal socket path, control-frame schemas.
- [ ] `packages/server/src/terminal-socket.ts` (new), `chat-routes.ts`, `app.ts`, `start.ts` -- REST; socket (unknown/not-terminal session → close); never logs frames.
- [ ] `packages/web/package.json` -- `@xterm/xterm@6.0.0`, `@xterm/addon-fit@0.11.0` (MIT, `npm view`).
- [ ] `packages/web/src/terminal/terminal-panel.tsx`, `terminal-socket.ts` (new), `chat/chat-api.ts`, `routes/session-page.tsx` -- switch button; panel replaces transcript while terminal drives; xterm via dynamic `import()`.
- [ ] `tests/fixtures/fake-claude-cli.mjs` (new) -- echoes lines; records argv and cwd to `$FAKE_CLAUDE_RECORD`.
- [ ] `packages/core/test/chat.test.ts`, `packages/adapters/test/terminal-pty.test.ts`, `packages/server/test/terminal-socket.test.ts` (new), `gate.test.ts` -- matrix rows.

**Acceptance Criteria:**
- Given a fake-agent chat that answered once, when switched, typed in and switched back, then two `session.driver_changed` exist, the fake CLI recorded `--resume <ref>` and the workspace cwd, and the next message gets a reply.
- Given a marker typed in the terminal, then it is in no event, DB row or log file.
- hitl: live, a signed-in Claude Code chat opens in its own TUI with the same conversation, takes a message, switches back, and the next reply knows it. Record whether ids matched and the session file was free after release.

## Implementation Notes

- `AgentPort.terminalCommand?(agentSessionId, env)` is async and returns `{file, args, env}`: 9.2's `freshChatEnv` (refresh-if-stale, key precedence) is async and lives in `start.ts`'s `chatAgent` wrapper, so the wrapper hands the CLI its env back. Core adds `TERM=xterm-256color`.
- `TerminalPort` has `available()` besides `open()`, so a missing node-pty refuses the switch before the ACP process is released (matrix row "unchanged").
- Core keeps the newest 64 KiB of terminal output in memory only (`TERMINAL_BACKLOG_CHARS`) and sends it to a viewer that attaches: the first viewer attaches after the switch returns, so without it the CLI's first screen was lost. Reattach/multi-viewer rules stay entry 5's.
- Refusals are `DriverSwitchRefusedError` → 409 `session_busy` with the plain reason (existing code; entry 2 gives them their own codes). `chat.close()` sets `driver = ui` on terminal sessions before killing them (a clean stop never leaves a chat stuck; crash recovery stays entry 4).
- Schemas live in new `packages/shared/src/terminal.ts` (`api.ts` must stay import-free); `TERMINAL_SOCKET_ROUTE` is in `api.ts` but not in `API_ROUTES` (it is no REST route).
- `HiddenPty.resize` is optional so story 9.x's test fakes need no edit; every real spawn has it.
- A script `CLAUDE_CODE_EXECUTABLE` (`.js/.mjs/.cjs`) runs under Node, as the Agent SDK runs one; that is how the fake CLI runs on every OS. The session id must match `^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$` before it goes on the argument list.
- Frame limits: 1 MiB binary, 1 KiB text, else close 1009; unknown/not-terminal session closes 4404; an ended terminal sends `{type:'exit'}` then closes 4000. The `ws` server's own `maxPayload` (100 MiB) is unchanged.
- e2e CSP check ignores the one violation every page already reports: zod's caught `Function('')` probe (`script-src eval`).
- Windows CI (ConPTY): ConPTY repaints the screen, so the fake CLI prints space-free tokens (`ready>`, `echo:<line>`, `fake-claude:<args>`) and tests match them with escape sequences stripped; expected folders use `realpathSync.native` (8.3 temp names). A resize never reached the console under node-pty 1.1.0 (80x24 for 10 s), so only the two resize checks are skipped on win32, pointing at 3.8 (deferred-work); everything else is asserted on Windows.

## Plan Change Log

## Review Triage Log

Security review, 2026-09-30 (no Critical or High):

- F1 (medium) — fixed: the WebSocket server reads no frame over `MAX_WS_PAYLOAD_BYTES` (`MAX_TERMINAL_INPUT_BYTES` + 1 KiB, `start.ts`), on `/ws` too, whose client messages are a few hundred bytes; a larger frame closes the socket (1009) before it is buffered. Test: `terminal-socket.test.ts` "frame sizes on every socket".
- F2 (medium) — fixed by closing, not pausing: a viewer more than 1 MiB behind (`bufferedAmount`) is closed with 1013 and the panel reconnects from the 64 KiB backlog; the CLI runs on. Pausing was not used: `ws` has no drain event, node-pty's pause is not reliable on every platform (ConPTY), and one slow tab must not stall the others. Test: flooding fake CLI (`flood`) and a paused viewer.
- F3 (low) — fixed: a server start hands every `driver = terminal` session back to the chat (`entities.releaseTerminalDrivers`, beside the idle reconcile), with `session.driver_changed`. Tests: core and server start.
- F4 (low) — deferred to 3.5 (multi-viewer): per-viewer input rate limit; entry in `deferred-work.md`.
- F5 (low) — rejected: the terminal socket is keyed by session id, not workspace. Single-user app behind the tab token (AD-15); any authenticated tab may open any workspace anyway, so a workspace scope adds no boundary.

## Design Notes

xterm 6 injects a `<style>` and sets element styles; CSP already allows `style-src 'self' 'unsafe-inline'`, and Vite emits its CSS as a file, so `gate.ts` is unchanged.

## Verification

**Commands:**
- `pnpm typecheck && pnpm test` -- expected: green; PTY tests skip with a reason if node-pty can't load.

**Manual checks (if no CLI):**
- hitl live run on macOS with the developer's Claude Code.
