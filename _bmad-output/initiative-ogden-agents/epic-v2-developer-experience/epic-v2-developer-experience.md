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
- V4 (spec Non-goals "Planned for v2" and CAP-15, 2026-10-02): Codex, Gemini CLI and GitHub Copilot CLI for chat and builds; builds with Antigravity; Antigravity chat too if epic 6's spike is a no-go (epic 6 keeps the agent-choice groundwork either way, user 2026-10-02); CAP-3's two-agent resume proof on a no-go.

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
- Decision (2026-10-02, user): more agents move here from v1's epic 6: Codex, Gemini CLI and GitHub Copilot CLI for chat and builds, and builds with Antigravity (or Antigravity chat too, if epic 6's spike is a no-go; epic 6 keeps the agent-choice groundwork either way, user 2026-10-02). The research, the draft's 14-entry plan for Codex and Gemini CLI (commit cced0a9) and the open questions are kept in epic 6's Notes as input. Whether they are part of this epic or a v2 epic of their own is decided at inception.
- Decision (2026-10-02, user: "we need to add v1.1: Codex and Grok features"): Codex for chat moves out of V4 to epic 12 (v1.1, "Codex and Grok beside Claude Code"). V4 keeps Gemini CLI, GitHub Copilot CLI, builds with Antigravity, and builds with Codex and Grok unless epic 12's inception takes them into v1.1.
- Decision (2026-10-05, user): V4's builds with Codex, Grok and Antigravity move into version 1 as epic 17 (`epic-builds-with-other-agents`). GitHub Copilot CLI builds are not planned at all (autonomous background Copilot CLI use violates GitHub's terms; Copilot stays interactive in epic 16's terminal). V4 keeps Gemini CLI chat and builds and Copilot chat.
