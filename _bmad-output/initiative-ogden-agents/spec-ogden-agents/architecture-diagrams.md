# Architecture diagrams

## System overview

```
 Browser (localhost)
 ┌──────────────────────────────────────────────────────────────┐
 │ Projects · Board · Chats · Runs · Diffs · Settings           │
 │ ┌────────── Chat view ──────────┐  [ Terminal toggle ]       │
 │ │ messages, tool cards,         │  same session in a real    │
 │ │ allow/deny permission cards   │  interactive CLI           │
 │ └───────────────────────────────┘                            │
 └───────────────────────────┬──────────────────────────────────┘
                             │ HTTP + WebSocket, 127.0.0.1 only, token
 ┌───────────────────────────▼──────────────────────────────────┐
 │ Ogden Agents server (one local Node process)                     │
 │  • Session manager ──► selected agent (Claude Code, Codex, …) │
 │  • Terminal bridge ──► agent CLI resumed in a real PTY       │
 │  • Ticket index (v7 tickets.toml + plan frontmatter)         │
 │  • Dispatch via bmad-loop, worktrees, verification, run time │
 │  • DB: workspaces, sessions, runs, events (no ticket state)  │
 └───────────────────────────┬──────────────────────────────────┘
                   user's repos on disk, each with the forked
                   method installed (_bmad/ + skills)
```

## Ticket lifecycle under Ogden Agents

```
draft ─► ready-for-dev ─► in-progress ─► in-review ─► built ──(human approve)──► done
                                 │                        │
                                 └──────► blocked ◄───────┘
                                   (reason shown; Retry = tickets.py mark <status>)
```

After each run, verification (CAP-10) must pass before the UI shows a ticket as `built`.

## Session driver handoff (CAP-5)

```
UI drives (SDK/headless) ──toggle──► UI releases session ──► terminal resumes session (PTY)
                                                     chat view: read-only live tail
terminal drives ──toggle──► PTY closed ──────────► UI resumes session (SDK/headless)
```
