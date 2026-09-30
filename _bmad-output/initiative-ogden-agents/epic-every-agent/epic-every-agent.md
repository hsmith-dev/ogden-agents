---
type: epic
title: "Every agent BMAD supports works for chat and builds"
parent: initiative-ogden-agents
covers: [CAP-15]
after: []
assignee: ""
risk: medium
---

# Every agent BMAD supports works for chat and builds

## Description

Codex, Gemini, Copilot and Antigravity join Claude Code as adapters: builds for all of them, chat for each that speaks ACP. Every "verify" cell in the agent matrix is filled in.

## Outcome

CAP-15's success criterion is the signal.

## Requirements

Completed at inception from the spec capabilities in `covers`.

## Done when

1. Each supported agent completes a `bmad-build-auto` run through the UI (CAP-15).
2. Each agent that speaks ACP completes a chat, with permission cards and a normalized state (AD-4).
3. `agent-matrix.md` has no "verify" cells left.
4. Released in an `ogden-agents` npm version.

## Boundaries

Adapters only; no core change (AD-1).

## References

- parent — _bmad-output/initiative-ogden-agents/initiative-ogden-agents.md
- spec — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, section Capabilities
- architecture — _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md, AD-1, AD-4, AD-17
- agent matrix — _bmad-output/initiative-ogden-agents/spec-ogden-agents/agent-matrix.md

## Notes

- Unknown: whether Antigravity gains ACP support; until it does, it is build-only.
- Waits on epic 2, epic 5 because: see `after` in the initiative's tickets.toml.
