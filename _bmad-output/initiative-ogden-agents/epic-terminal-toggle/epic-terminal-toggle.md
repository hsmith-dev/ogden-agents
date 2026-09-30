---
type: epic
title: "Advanced users switch a chat to the agent's own terminal and back"
parent: initiative-ogden-agents
covers: [CAP-5]
after: []
assignee: ""
risk: medium
---

# Advanced users switch a chat to the agent's own terminal and back

## Description

An advanced user flips a chat into the agent's real CLI on the same session and back, with only one driver at a time. The toggle appears only for agents whose ACP session their own CLI can resume.

## Outcome

CAP-5's success criterion is the signal.

## Requirements

Completed at inception from the spec capabilities in `covers`.

## Done when

1. The user switches to the terminal mid-session, sends a message, switches back, and the chat shows that message and continues (CAP-5).
2. While the terminal drives, chat input for that session is rejected (AD-6).
3. If `node-pty` fails to load, the app still runs and the toggle shows why it is disabled (AD-19).
4. Released in an `ogden-agents` npm version.

## Boundaries

The toggle for Claude Code, plus a recorded result per agent in `agent-matrix.md`. It adds no chat features.

## References

- parent — _bmad-output/initiative-ogden-agents/initiative-ogden-agents.md
- spec — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, section Capabilities
- architecture — _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md, AD-6, AD-19
- agent matrix — _bmad-output/initiative-ogden-agents/spec-ogden-agents/agent-matrix.md

## Notes

- Unknown: which ACP adapters map to a CLI-resumable session (spec Open Questions); decides where the toggle appears.
- Waits on epic 2 because: see `after` in the initiative's tickets.toml.
