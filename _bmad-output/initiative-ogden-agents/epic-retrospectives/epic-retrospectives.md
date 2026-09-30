---
type: epic
title: "Each finished epic teaches the next one"
parent: initiative-ogden-agents
covers: [CAP-13]
after: []
assignee: ""
risk: low
---

# Each finished epic teaches the next one

## Description

When an epic completes, `bmad-retrospective` runs from the UI on its evidence and records recurring pitfalls in the project's `AGENTS.md`, so later runs avoid them.

## Outcome

CAP-13's success criterion is the signal.

## Requirements

Completed at inception from the spec capabilities in `covers`.

## Done when

1. After an epic completes, a retrospective file exists beside it (CAP-13).
2. A pitfall it records appears in `AGENTS.md`, and later build prompts include it.
3. Released in an `ogden-agents` npm version.

## Boundaries

Uses BMAD's own retrospective and project-context skills through the catalog (AD-12); builds no retrospective logic of its own.

## References

- parent — _bmad-output/initiative-ogden-agents/initiative-ogden-agents.md
- spec — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, section Capabilities
- architecture — _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md, AD-12

## Notes

- Waits on epic 5 because: see `after` in the initiative's tickets.toml.
