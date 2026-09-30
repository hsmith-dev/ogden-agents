---
type: epic
title: "Developers review and navigate their project without leaving Ogden Agents (v2)"
parent: initiative-ogden-agents
covers: []
after: []
assignee: ""
risk: medium
---

# Developers review and navigate their project without leaving Ogden Agents (v2)

## Description

Version 2 scope, requested by the user on 2026-09-29. Ogden Agents v1 lets you plan, build and approve agent work. v2 improves the development experience around that work: reading the project's markdown (specs, plans, tickets, READMEs) rendered in the app, reviewing code changes with a proper diff and file view, and bringing Ogden Agents into the editor through a VS Code extension.

## Outcome

A developer reads a plan or spec, reviews an agent's code change and approves it, either in the Ogden Agents browser UI or from inside VS Code, without switching to another tool.

## Requirements

Completed at inception. Candidate lines, not yet agreed:
- V1: Browse and read the workspace's markdown files, rendered, including BMad Method planning files (specs, architecture, tickets, plans).
- V2: Review code changes with a file tree, side-by-side and inline diffs, and comments that feed back to the agent.
- V3: A VS Code extension that connects to the local Ogden Agents server (sessions, Needs you, permission cards, review) through the same security model (AD-15).

## Done when

Set at inception.

## Boundaries

Not part of the v1 initiative's Done when. It builds on epics 2 (sessions), 4 (planning files and the board) and 5 (review and approve). The VS Code extension may become its own epic when this one is incepted.

## References

- parent — _bmad-output/initiative-ogden-agents/initiative-ogden-agents.md
- spec — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md

## Notes

- Decision: planned for v2, after epic 7; the user wants markdown viewing, code-change review and an elevated development experience, or a VS Code extension as a separate epic (user, 2026-09-29).
- Open question: one epic for the in-app viewer and review, plus a separate epic for the VS Code extension, or one combined epic? Decide at inception.
