---
type: epic
title: "v1.3: See and take over sessions you started elsewhere"
parent: initiative-ogden-agents
covers: [CAP-29, CAP-3, CAP-17]
after: []
assignee: ""
risk: medium
---

# v1.3: See and take over sessions you started elsewhere

## Description

Ogden lists Claude Code and Codex sessions found on this computer that it did not start, read-only, and the user can take one over: Ogden resumes it by its own id as an ordinary chat, and from then on owns the process (spec CAP-29, AD-32). Discovery only watches the agents' own session files; it installs no hook and changes no config (user decision 2026-10-31).

## Outcome

A user who started a Claude Code session in a terminal sees it under On this computer within seconds and continues it in Ogden with its context; the CAP-29 success line is the signal.

## Requirements

Drafted at inception (2026-10-31, autonomous, awaiting the user's approval). Each line maps to a spec capability in `covers`.

- E22-R1: `SessionDiscoveryPort` with per-agent adapters reading only their declared glob allowlist; found sessions are core install-level rows with events only on seen, gone and state change; off by default, per agent. (CAP-29; AD-32)
- E22-R2: Ogden's own chats, builds and panes are never listed as outside: a found session whose agent session id is in any Ogden session's refs, or whose cwd is in the data directory, is dropped. (CAP-29; AD-32)
- E22-R3: Transcripts are parsed tolerantly against fixtures, masked on read, never stored in events or the database, and never sent to a device. (CAP-29; AD-16, AD-32)
- E22-R4: Take over creates an ordinary chat in Ask and resumes the agent session through its adapter, after re-checking ownership and liveness in one transaction; a folder with no project runs the add-project flow with trust first. (CAP-29, CAP-3; AD-2, AD-3, AD-32)
- E22-R5: Codex is view-only until spike 1 shows its sessions resume under Ogden's `CODEX_HOME`. (CAP-29; AD-32)
- E22-R6: The UI: Settings, Session discovery; the On this computer group in the status sidebar; the read-only found-session view with Take over and plain refusals. (CAP-29, CAP-17; EXPERIENCE.md)
- E22-R7: Works on all three OSes; live checks with a real terminal Claude Code session recorded by the user; ships in the v1.3 release. (CAP-29)

## Done when

1. With discovery on, a Claude Code session written into a fixture home appears under On this computer within seconds with its masked transcript, and an Ogden chat's own session never appears (CAP-29).
2. Take over resumes a fixture session as a chat in Ask with its prior context, and is refused while the original is running, while its liveness is unknown, and when it is already in Ogden.
3. An adapter test fails if any file outside the allowlist is opened, and no agent config or hook file changes with discovery on.
4. Codex sessions show view-only, or take over if spike 1 is a go.
5. The end-to-end suite passes on all three OSes, the user's live check is recorded, and the epic ships in the v1.3 release.

## Boundaries

Finding and taking over Claude Code and Codex sessions. Not here: hooks or config changes (user decision), driving a running outside process (AD-3), other agents (a later adapter each), cross-machine discovery.

## References

- spec — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, CAP-29, Constraints (CAP-29 constraint)
- architecture — _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md, AD-32, AD-2, AD-3, AD-16
- parent — _bmad-output/initiative-ogden-agents/initiative-ogden-agents.md
- change — _bmad-output/initiative-ogden-agents/change-desktop-agent-harness/change-desktop-agent-harness.md, sections 4.4 and 5
- lessons — _bmad-output/initiative-ogden-agents/change-desktop-agent-harness/the-mob-lessons.md (ideas only; the-mob's code is unlicensed and is never copied)
- agent matrix — _bmad-output/initiative-ogden-agents/spec-ogden-agents/agent-matrix.md
- experience — _bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md
- design — _bmad-output/initiative-ogden-agents/ux-ogden-agents/DESIGN.md, Components
- code — packages/adapters/src/acp-claude-code/transcript.ts, packages/adapters/src/setup-codex (the never-read-~/.codex promise AD-32 amends)

## Notes

- Status: drafted autonomously 2026-10-31; awaiting the user's approval of the inception.
- Decision (2026-10-31, user): discovery watches files only; no hooks.
- Decision (2026-10-31, autonomous): spike 1 first (Codex resume and Claude's running-session records), then the tracer bullet, entry 2.
- Unknown: whether a session from the user's `~/.codex` resumes under Ogden's `CODEX_HOME`; entry 5's take-over part waits on spike 1.
- Waits on epic 2 because: sessions, resume and the sidebar (2.3, 2.11). Waits on epic 12 because: Codex's adapter and `CODEX_HOME` (12.3).
