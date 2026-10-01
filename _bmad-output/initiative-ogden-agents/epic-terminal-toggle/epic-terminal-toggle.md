---
type: epic
title: "Advanced users switch a chat to the agent's own terminal and back"
parent: initiative-ogden-agents
covers: [CAP-5]
after: []
assignee: ""
risk: high
---

# Advanced users switch a chat to the agent's own terminal and back

## Description

An advanced user flips a chat into the agent's real CLI on the same session and back, with only one driver at a time. The toggle appears only in Developer mode, and only for agents whose ACP session their own CLI can resume. For Claude Code that is `claude --resume <ACP session id>` running in a pseudo-terminal the server owns, shown in the browser through xterm over its own WebSocket. Nobody needs the toggle: every standard flow still works without a terminal (AD-21).

## Outcome

CAP-5's success criterion is the signal: a developer switches to the terminal mid-session, sends a message there, switches back, and the chat shows that message and continues the session.

## Requirements

Each line maps to CAP-5 and names the architecture decisions and UX sections it carries. Parts earlier epics built are named so no ticket rebuilds them: the session `driver` field, `session.driver_changed` and `setSessionDriver` (epic 1), chat input refused while `driver = terminal` (`packages/core/src/chat.ts`, epic 2), ACP resume and load in `acp-claude-code` (story 2.7), the lazily loaded `terminal-pty` adapter with `spawnHidden` (story 9.1), and the Developer mode preference (story 1.6).

- E3-R1: Core owns the handoff. A `TerminalPort` in core, implemented by `terminal-pty`, opens the agent's CLI on a session in the workspace folder. Switching to the terminal releases the session's ACP process and starts the CLI resuming the same session id; switching back closes the CLI and resumes the session through ACP. Only core changes `driver`, each change emits `session.driver_changed`, and while `driver = terminal` chat input is refused. (CAP-5; AD-1, AD-3, AD-4, AD-6, AD-9)
- E3-R2: Terminal bytes travel over a separate WebSocket per session, through the same security gate as every other socket (Host, tab-token subprotocol, Origin), and are never written to the event log, the database or the logs. The CLI's environment carries the agent's credentials only as the chat's process does (an API key from `SecretStorePort` in the child environment; subscription logins stay in the CLI). (CAP-5; AD-6, AD-15, AD-16)
- E3-R3: The terminal is usable: keystrokes, paste, colors and resize reach the CLI; closing or reloading the tab does not stop the CLI (the server owns it), and reopening the session reattaches with recent output. Several tabs on one session all see the output and can type; the terminal size follows whichever tab typed or resized last. A PTY with no viewer runs until the session is switched back or the server stops. (CAP-5; AD-3, AD-6)
- E3-R4: After switching back, every message sent and every reply received in the terminal appears in the chat transcript as ordinary session events, the user's marked "from terminal", and the next chat message continues the same session. (CAP-5 success; AD-5, AD-9)
- E3-R5: The handoff never leaves a session stuck: the CLI exiting on its own (`/exit`, a crash) returns the driver to the chat; a server restart with `driver = terminal` starts the session `idle`, `driver = ui` and resumable; the toggle works only while the session is `idle`: while it is working, waiting on a permission, or has queued messages, the switch is refused and the toggle disabled with a short reason, and nothing is interrupted. (CAP-5; AD-3, AD-4, AD-6)
- E3-R6: The session header shows the "Chat | Terminal" driver toggle in Developer mode for supported agents, with "Switching..." until `session.driver_changed` arrives; the dark terminal panel replaces the transcript; the read-only banner and the disabled composer with Switch to Chat show while the terminal drives; `⌘.` / `Ctrl+.` is captured before the terminal sees it; focus moves into the terminal on switch; the read-only transcript peek opens at `xl`; xterm screen-reader mode is on when the OS reports a screen reader. (CAP-5; AD-18; EXPERIENCE.md Component Patterns, Interaction Primitives, Accessibility Floor, Key Flows Flow 2; DESIGN.md Driver toggle, Terminal panel, Read-only banner, Composer)
- E3-R7: Where the toggle cannot work it is disabled with a plain reason (not idle is E3-R5): the agent's session cannot resume in its own CLI, `node-pty` failed to load (AD-19), or the agent's CLI could not be found. Each agent's result is recorded in `agent-matrix.md`. (CAP-5; AD-1, AD-19; architecture Deferred, "Where the CAP-5 toggle appears")
- E3-R8: The toggle works on macOS, Windows (ConPTY) and Linux. (CAP-5; spec Constraints, "runs natively on macOS, Windows, and Linux")

## Done when

1. The user switches a Claude Code chat to the terminal mid-session, sends a message there, switches back, and the chat shows that message, marked "from terminal", with its reply, and continues the session (CAP-5; E3-R1, E3-R4).
2. While the terminal drives, chat input for that session is refused by the server as well as disabled in the UI (AD-6).
3. A terminal WebSocket upgrade without the tab's token or with a foreign Origin is refused. The terminal's bytes and output only the terminal showed (its prompt, thinking, tool output) appear nowhere in the event log, database or logs; messages typed in the terminal are imported after switching back and stored as chat messages marked "from terminal", as check 1 requires (AD-6, AD-15, AD-16; E3-R4; reworded 2026-10-01, see Notes).
4. If `node-pty` fails to load, the app still runs and the toggle shows why it is disabled (AD-19); with Developer mode off, no toggle is shown.
5. The epic's end-to-end suite passes on macOS, Windows and Linux, and the flow in check 1 is run live on Windows.
6. Released in an `ogden-agents` npm version.

## Boundaries

The toggle for Claude Code, plus a recorded result per agent in `agent-matrix.md`. Codex's toggle is built and verified when its adapter ships in epic 6 (every agent); this epic defines the capability flag an adapter sets. It adds no chat features, no general-purpose shell, and no terminal for unattended build runs (epic 5). It does not change sign-in (epic 9) or the security gate's rules (AD-15); it only adds a route behind the gate.

## References

- parent — _bmad-output/initiative-ogden-agents/initiative-ogden-agents.md
- spec — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, sections Capabilities (CAP-5), Constraints, Open Questions
- spec — _bmad-output/initiative-ogden-agents/spec-ogden-agents/architecture-diagrams.md, section Session driver handoff (CAP-5)
- agent matrix — _bmad-output/initiative-ogden-agents/spec-ogden-agents/agent-matrix.md, column Terminal resume (CAP-5)
- architecture — _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md, AD-1, AD-3, AD-5, AD-6, AD-15, AD-16, AD-19, AD-21, Deferred
- ux — _bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md, Information Architecture (Terminal mode), Component Patterns (Composer, Driver toggle, Terminal panel), State Patterns, Interaction Primitives, Accessibility Floor, Key Flows (Flow 2)
- ux — _bmad-output/initiative-ogden-agents/ux-ogden-agents/DESIGN.md, colors `terminal`, Components (Composer, Driver toggle, Terminal panel, Read-only banner)
- code — packages/adapters/src/terminal-pty/index.ts (story 9.1's lazy loader and hidden PTY), packages/adapters/src/acp-claude-code/claude-code-agent.ts (spawn, `CLAUDE_CODE_EXECUTABLE`, resume and load), packages/core/src/chat.ts (driver refusal), packages/shared/src/events.ts (`session.driver_changed`), packages/server/src/event-socket.ts (the `/ws` socket), packages/web/src/appearance/appearance.ts (Developer mode)

## Notes

- Decision (2026-09-30, inception, autonomous draft, approved by the user 2026-09-30): the tracer bullet is entry 1, one Claude Code chat switched to `claude --resume` in a PTY and back, through core, adapter, server socket and a bare panel. Entry 2 then freezes contracts and stubs so the lanes open at once. Entry 3 (terminal messages reach the transcript) is the least certain and comes right after the contracts.
- Decision (2026-09-30, inception, autonomous draft, approved by the user 2026-09-30): lanes after entry 2 are core handoff and terminal socket (3, then 4, then 5, since both touch the core terminal session lifecycle (CLI exit, viewers)), UI including the xterm client (6), and availability (7, after 6 because both touch the driver toggle). Windows (8) waits on 5 and 7 because it touches the PTY, the handoff and CLI resolution. Entry 2 owns every shared shape: the frame format, error codes, the availability shape, the from-terminal origin field, and the adapter's terminal-resume capability. Entry 1 owns the fake CLI fixture; entry 2 extends it. Live Claude Code checks sit only on the hitl entries 1, 8 and 10. A refactor sweep (9) and an end-to-end suite with release (10) close the epic.
- Decision (2026-09-30, inception): Codex's toggle is deferred to epic 6, which ships the Codex adapter; this epic records Claude Code as measured and the other agents as not yet measured in `agent-matrix.md`.
- Decision (2026-09-30, user): the terminal shows Claude Code's own terminal, `claude --resume <ACP session id>` on the same session, not a plain shell.
- Decision (2026-09-30, user): the toggle is available only when the session is `idle`; while it is `working`, `waiting` or has queued messages, the toggle is disabled with a short reason and nothing is interrupted.
- Decision (2026-09-30, user): Developer mode is the only gate (a browser preference that shows the toggle); there is no extra server setting.
- Decision (2026-09-30, user): several viewers all see the output and can type; the terminal size follows whichever tab typed or resized last.
- Decision (2026-09-30, user; resolves the EXPERIENCE.md Driver toggle conflict between "Visible only when…" and "disabled with a tooltip"): the toggle is visible only in Developer mode, and disabled with a tooltip reason when the session is not idle or the terminal cannot work for it (unsupported agent, node-pty failed to load, CLI not found; E3-R7).
- Confirmed (story 3.2; was the coordinator's assumption of 2026-09-30): terminal I/O uses WebSocket binary frames for bytes and JSON text frames for control only (`attach`, `resize` in; `exit`, `size` out; `packages/shared/src/terminal.ts`) on a separate per-session socket behind the AD-15 gate (AD-6), `/ws/terminal/:sesId`.
- Confirmed (story 3.2; was the coordinator's assumption of 2026-09-30): the event log records only `session.driver_changed` (with its `cause`) and the messages imported after switching back (the user's with `origin: 'terminal'`); terminal bytes are never recorded (AD-6, AD-16).
- Assumption (coordinator's call 2026-09-30, confirm in 3.1/3.5 planning): a PTY with no viewer is kept until the session is switched back or the server stops; there is no idle timeout.
- Assumption: the CLI is spawned with the environment core builds for the chat's ACP process (an API key from the keychain after 9.2), so the terminal is signed in exactly when the chat is.
- Assumption: the terminal runs the same `claude` the chat uses: the installed CLI the adapter passes as `CLAUDE_CODE_EXECUTABLE`, else the CLI bundled with the Agent SDK run by this Node.
- Assumption: the terminal availability shape `{ available, reason }` lives on the session response, since it depends on the session's agent and state and on this server's node-pty load.
- Open question: How do terminal messages reach the chat after switching back: does ACP `session/load` or `session/resume` from claude-agent-acp replay the turns the CLI added, or must core read Claude Code's session file and diff it against the stored transcript? Entry 3 waits on it.
- Open question: Windows: does `claude` resolve as a `.cmd` shim or a native binary under ConPTY, and do `Ctrl+.`, paste and resize behave in xterm against ConPTY? Entry 8 waits on it.
- Unknown: which ACP adapters map to a CLI-resumable session (spec Open Questions); decides where the toggle appears. Entry 7 records Claude Code; epic 6 measures the rest.
- Waits on epic 2 because: the toggle hands off a persistent, resumable ACP session (2.7) and renders in the completed session view (2.10).
- Decision (2026-10-01, user): Done when 3 is reworded, in wording only (epic 3 retro S2, A6, Q2). As first written, a marker typed in the terminal had to appear nowhere in the event log, which contradicted E3-R4 and Done when 1: terminal messages are imported as chat messages. The as-built rule is unchanged: terminal bytes and terminal-only output are stored nowhere, and messages typed in the terminal are imported and stored as chat messages marked "from terminal" (3.3, its review F8). The wording is only in this file, not in the spec kernel.
