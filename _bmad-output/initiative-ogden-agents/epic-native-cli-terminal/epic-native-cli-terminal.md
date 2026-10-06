---
type: epic
title: "Advanced users run each agent's own CLI in a herdr-style terminal workspace"
parent: initiative-ogden-agents
covers: [CAP-5, CAP-17]
after: []
assignee: ""
risk: high
---

# Advanced users run each agent's own CLI in a herdr-style terminal workspace

## Description

The user asked (2026-10-05) for a "herdr style native CLI terminal" and pre-approved the epic. In Developer mode, a project gets a terminal workspace: several panes that each run an agent's own real CLI (`claude`, `codex`, `grok`, the Antigravity/Gemini CLI, `copilot`, or a plain shell) in a pseudo-terminal the server owns, shown through xterm. The USER signs in inside the CLI, so Ogden never sees or stores those credentials. Panes are laid out like herdr: split, tabs, a status per pane (working, needs attention, idle), notifications, and layouts that survive a restart where they can. This is herdr's native-terminal half; epic 3's per-chat Chat | Terminal toggle stays as it is. It is the user's own interactive use of the vendor's tool on their own machine, which is the framing each vendor's terms allow (Copilot CLI is interactive only).

Developer mode is off by default and can be turned off at any time; simple users never see any of it, and no standard flow needs a terminal (AD-21). Nothing here is auto-approved or scripted by Ogden: the CLI's own prompts show as the vendor intended.

It reuses what exists: `terminal-pty` and `node-pty` loaded lazily (AD-19, story 9.1), the per-session terminal WebSocket behind the one security gate (AD-6, AD-15, epic 3), the Developer mode preference (1.6), the child-process environment allowlist (AD-16), the process-tree kill helper, the Windows ConPTY retry logic (3.8), the Needs you sidebar (2.11) and `NotifierPort` notifications (epic 11).

## Outcome

A developer turns on Developer mode, opens Terminals in a project, starts Claude Code in one pane and Codex in another beside a plain shell, signs in inside each CLI themselves, sees which pane needs attention while looking at another, and reopens the app to find the same panes. The spec's CAP-5 spirit (advanced users keep the CLI) extended to a workspace, and CAP-17's one sidebar showing every pane's state.

## Requirements

Drafted at inception (2026-10-05, autonomous; user pre-approved the epic). New requirement ids are E16-R<n>; they carry CAP-5 and CAP-17 and propose CAP-23 (an advanced user runs agent CLIs side by side in terminal panes) as a spec delta, via a `bmad-spec` memlog (open question 1, recommended default accepted unless the user objects).

- E16-R1: A terminal pane is one PTY running one launcher (Claude Code, Codex, Grok, Antigravity/Gemini, Copilot or a plain shell) in the project folder (or a subfolder the user picks inside it). `TerminalPort` gains pane operations (`openPane`, `closePane`, write, resize, list) in core, implemented by `terminal-pty`; core and shared name no CLI (launchers are descriptor data, architecture test). Panes are separate from chat sessions: a pane never drives a chat session's `driver` and never touches ACP. (CAP-5, CAP-17; AD-1, AD-6)
- E16-R2: Credentials stay with the user. A pane's child gets the AD-16 environment allowlist and nothing else: no Ogden secret, no API key from `SecretStorePort`, no token. The user signs in inside the CLI, which stores its login where it always does. Ogden never reads, copies or logs a CLI's credentials, nor injects one; a pane's CLI uses the user's own home and login (not the `*_HOME` folders Ogden gives its own ACP agents), so a sign-in in a pane never mixes with an Ogden-managed agent's. (CAP-16 spirit; AD-16)
- E16-R3: Gating. Panes exist only with Developer mode on, enforced by the server (a pane route without it is refused 403 `developer_mode_required`, as the Skip all gate is), and a `terminals` workspace piece or setting can hide the surface per project. Turning Developer mode off closes the terminal workspace's surface; running PTYs are asked about (stop or keep them in the background until the server stops) in plain words. Every pane socket and route passes the one gate: Host, per-tab token, Origin. (AD-15, AD-19, AD-21)
- E16-R4: Layout like herdr: a project's terminal workspace holds tabs, each a tree of splits (horizontal and vertical) of panes; the user can add, split, close, rename, move focus by keyboard and resize splits; sizes follow the viewing browser. The layout model is data in shared and rendered by the web package, with no CLI named. (CAP-17; AD-18)
- E16-R5: Install detection, never auto-install. Each launcher reports `found`, `not found` or `found but failed to start` by looking the CLI up on the user's PATH (and well-known install folders per OS) with no execution beyond a `--version` probe under the allowlist; a missing CLI shows its official install page link and a plain "install it yourself, then press Detect". Ogden never runs an installer or global `npm i -g` for a pane. (AD-21, AD-16)
- E16-R6: Status per pane: working, needs attention, idle (and exited). It is derived in memory from the PTY's activity and the CLI's own screen text (output recency and a launcher's prompt patterns for "waiting for you"), never from stored output, and the raw bytes are never written to the event log, database or logs (AD-6, E3-R2). A pane's status is a low-fidelity hint and is labelled as such; Ogden does not claim to know what the CLI is doing. Status changes emit `terminal.pane_status_changed` (state only, no text). (CAP-17; AD-4, AD-5, AD-6)
- E16-R7: Notifications: a pane that goes from working to needs attention or exits shows in the Needs you sidebar with a count and the tab title, and goes through `NotifierPort` (epic 11's webhook and the browser notification) only for panes the user opted in per pane or per launcher, and only with the state and pane label, never terminal text. (CAP-17; AD-16)
- E16-R8: Persistence where feasible. Layouts (tabs, splits, launchers, titles, folders) persist in SQLite through core (AD-11) and come back after a restart with each pane shown as "stopped, press to start", offering the CLI's own resume where its CLI has one (the same `agent-matrix.md` Terminal resume column). Running processes do not survive a server stop; PTYs with no viewer keep running while the server runs and reattach with recent output (E3-R3). A true detach-and-survive via a multiplexer is out (open question 4). (CAP-17; AD-3, AD-11)
- E16-R9: Nothing is auto-approved or hidden: no auto-answering of the CLI's permission prompts, no injected flags that skip them (a pane starts the CLI exactly as the user would, plus only flags the user sets in the launcher's visible argument field), no spoofing of telemetry, user-agent or version, and no scripting of input except what the user types or pastes. Copilot CLI is interactive only per the user's terms framing: its pane is never fed by Ogden, never started on a schedule or by another agent, and is excluded from any automation (epic 15). (AD-15, AD-16; user terms note)
- E16-R10: Per-chat toggle relationship (epic 3): the Chat | Terminal toggle is unchanged. A pane and a chat's terminal are different PTYs; a CLI session can be opened in a pane by the user by hand, with a plain note that a chat session driven by Ogden and the same session id opened in a pane at once can conflict, and the pane's launcher can offer "open this chat's session here" that first switches the chat to terminal through epic 3's own handoff (one driver at a time). (CAP-5; AD-6)
- E16-R11: Works on macOS and Windows first and on Linux. On Windows, ConPTY quirks use the existing retry logic (3.8) and the plain shell is PowerShell or the user's default; each CLI's Windows behaviour is recorded in `agent-matrix.md`. (spec Constraints; AD-19)

## Done when

1. With Developer mode on, a user opens Terminals in a project, starts a plain shell and each installed agent CLI in separate panes in a split layout and types in them; on a machine where a CLI is not installed its launcher says so, links the official install page and installs nothing (E16-R1, R4, R5).
2. A pane's child environment contains the allowlist only: a test shows no Ogden key, token or secret, and that terminal bytes appear nowhere in the event log, database or logs; the user's sign-in inside a CLI works and Ogden never reads it (E16-R2, R6).
3. With Developer mode off, no Terminals surface shows and every pane route and socket is refused; a pane socket without the tab token or with a foreign Origin is refused (E16-R3).
4. A pane going from working to needs attention shows in Needs you and the tab title and, only if the user opted in, sends a state-only notification; no pane text is ever sent (E16-R6, R7).
5. After a server restart the layout returns with panes shown as stopped and startable; a CLI with resume offers it (E16-R8).
6. The end-to-end suite passes on macOS, Windows and Linux with fake CLIs, and the user's live checks with the real CLIs on Mac and Windows are recorded; released in an `ogden-agents` npm version.

## Boundaries

A terminal workspace of panes running the user's own CLIs, behind Developer mode. It is not a chat feature, not an agent runtime, not a general remote shell: the server stays on `127.0.0.1` behind AD-15. It does not change sign-in for Ogden-managed agents (epics 9 and 12), the chat toggle (epic 3), builds (epic 5), or orchestration (epic 15; panes are never a manager's workers in this epic).

- Not here: auto-installing any CLI; reading or storing any CLI's login; auto-approving a CLI's prompts; a detachable multiplexer (tmux or zellij) backend; remote or SSH panes; scripting panes from an agent or manager; recording or replaying terminal sessions; Linux-specific live checks beyond CI.

## References

- parent — _bmad-output/initiative-ogden-agents/initiative-ogden-agents.md
- spec — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, sections Capabilities (CAP-5, CAP-17), Constraints (no standard flow requires the CLI; the terminal is a remote shell, so the token and Origin gate)
- agent matrix — _bmad-output/initiative-ogden-agents/spec-ogden-agents/agent-matrix.md (CLI names, sign-in and Terminal resume columns)
- architecture — _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md, AD-1, AD-3, AD-4, AD-5, AD-6, AD-11, AD-15, AD-16, AD-18, AD-19, AD-21
- epic 3 — _bmad-output/initiative-ogden-agents/epic-terminal-toggle/epic-terminal-toggle.md and its `tickets.toml` (terminal socket, Developer mode gate, Windows entry 8, per-agent availability entry 7)
- epic 11 — _bmad-output/initiative-ogden-agents/epic-build-runs-and-notifications/epic-build-runs-and-notifications.md (Needs you, `NotifierPort`, webhooks)
- ux — _bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md and DESIGN.md (Terminal panel, Needs you, Developer mode)
- code — packages/adapters/src/terminal-pty/ (lazy `node-pty`, `spawnHidden`, process-tree kill), packages/adapters/src/child-env.ts, packages/server/src/event-socket.ts, packages/web/src/appearance/appearance.ts
- external (herdr, the interaction reference) — the user's herdr setup; and each CLI's own docs for its executable name and flags (to verify in spike 16.1)

## Notes

- Status: APPROVED by the user 2026-10-05 (pre-approved as part of the epic 14/15 approval message; its inception drafted autonomously).
- Decision (2026-10-05, user): this epic exists; content as described above (Developer mode, panes running the real CLIs, the user signs in, no credentials seen by Ogden, split/tabs/status/notifications/persistence, safe defaults, detection without auto-install, Windows ConPTY retry logic, Mac and Windows first, Linux ok, Copilot CLI interactive only, the terms framing of the user's own interactive use).
- Decision (2026-10-05, user): GO on building epic 16 (entries 2 onward) after spike 16.1 (PR #150), with the spike's design conditions designed in: refresh replay from a server side headless terminal mirror snapshot (not a raw tail); a pane environment larger than the base allowlist but still secret free (Windows folders and COLORTERM; proxies and SSH_AUTH_SOCK opt in); a "starting" state and a Restart pane action for Windows ConPTY, spawning the absolute path found by detection; a start up sweep of pane pids Ogden itself recorded, never touching other processes; status as a conservative guess (silence alone never says needs attention); caps of 8 panes per project and 16 per install; the Unicode 11 addon (also for the existing chat terminal panel) with new xterm packages pinned. Launcher list (decided): Claude Code, Codex, Grok, Antigravity (`agy`), Copilot (interactive only) and a plain shell; Gemini only if already installed. Ogden detects CLIs and never installs one; the user signs in inside each CLI and Ogden never sees or stores those credentials. Open question 2 is closed by this decision.
- Assumption: the tracer bullet is entry 2 (one plain-shell pane through core, adapter, socket and a bare page), after a spike that proves per-OS PTY behaviour and each CLI's launch facts with fake CLIs in CI.
- Assumption: status detection uses output recency plus per-launcher prompt patterns held as data, with a "status is a guess" label; it never reads stored output. A CLI that changes its prompt wording degrades to working or idle by recency.
- Assumption: one PTY per pane, a global cap of 8 panes per project and 16 per install (adjustable constants), to protect the machine.
- Assumption: a pane's working folder is the project folder or a subfolder inside it (Ogden's protected-paths and project-root checks apply); a plain shell is a real shell, so the user can leave the folder themselves.
- Unknown: each CLI's executable name and flags on Windows (`claude`, `codex`, `grok`, `gemini` or the Antigravity CLI, `copilot`) and whether each prompt pattern is stable; spike 16.1 records them from fakes in CI and the user's live checks verify the real ones.
- Open question 1 (assumed yes): propose CAP-23 "A user in Developer mode runs the agents' own CLIs side by side in terminal panes, signing in inside each CLI" as a spec delta via a `bmad-spec` memlog, with AD-6 and AD-16 notes (panes are not chat sessions; pane children get the allowlist and no key).
- Open question 2 (assumed: Antigravity and Gemini): the launcher list is Claude Code, Codex, Grok, Antigravity (its CLI) with Gemini CLI as a second launcher only if the Antigravity CLI is not distinct, Copilot, and a plain shell; each is hidden when not found. Add or drop any?
- Open question 3 (assumed yes): panes may run in a subfolder of the project, not outside it.
- Open question 4 (assumed no): no tmux or zellij backend; running processes end when the server stops, and layouts restore as stopped panes.
- Open question 5 (assumed per-pane opt-in, off by default): notifications for pane attention are opt-in per pane or launcher.
- Open question 6 (assumed: lazy and optional): if `node-pty` fails to load, the Terminals surface shows the reason, as epic 3 does (AD-19).
- Waits on epic 3 because: the terminal adapter, socket, Developer mode gate, Windows ConPTY work and per-agent availability are 3.1 to 3.8.
- Waits on epic 11 because: Needs you and `NotifierPort` webhooks are its stories.
- Waits on epic 2 because: the sidebar and per-tab token gate are 2.1 and 2.11.
- Deltas proposed (not applied): spec CAP-23; AD-6 note (panes are separate PTYs with the same never-logged rule, status derived in memory); AD-16 note (pane children: allowlist, no secrets, the user's own CLI logins untouched); `agent-matrix.md` columns for CLI executable and pane notes; EXPERIENCE.md Terminals workspace, pane status and install-detection states.
