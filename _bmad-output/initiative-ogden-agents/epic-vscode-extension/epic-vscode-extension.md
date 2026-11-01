---
type: epic
title: "Ogden inside VS Code"
parent: initiative-ogden-agents
covers: []
after: []
assignee: ""
risk: medium
---

<!-- Envelope only (2026-10-31). Requirements are completed at this epic's inception, and its children are planned in `tickets.toml` beside this file. -->

# Ogden inside VS Code

## Description

v2, unplanned. Split from epic 8 on 2026-10-31 (change-desktop-ux-uplift, approved) when epic 8 was incepted as the Workbench. A VS Code extension connects to the local Ogden server through the same security model (AD-15) and shows sessions, Needs you, permission cards and review inside the editor, reusing epic 8's diff viewer, Changes and line comments. Epic 8's leftover agents note (V4: Gemini CLI chat and builds, GitHub Copilot CLI chat) is parked here with its history until this epic's inception decides whether it stays or becomes an epic of its own.

## Outcome

A developer answers what needs them and reviews an agent's change from inside VS Code without opening Ogden's window; the spec's "Planned for v2" non-goal line (a VS Code extension) is the source, and its signal is set at inception.

## Requirements

Completed at inception. Candidate lines, not yet agreed (moved from epic 8, 2026-10-31):
- V3: A VS Code extension that connects to the local Ogden Agents server (sessions, Needs you, permission cards, review) through the same security model (AD-15). (spec Non-goals "Planned for v2, not v1"; AD-15)
- V4 (spec Non-goals "Planned for v2" and CAP-15): Gemini CLI for chat and builds, and GitHub Copilot CLI for chat only (interactive, never autonomous or multi-agent). See Notes for the history.

## Done when

1. From VS Code, the extension connects to a running local Ogden with a per-tab token through AD-15's gate and nothing else, and refuses to connect without one.
2. A permission card raised by an Ogden chat is answered from VS Code, and the chat continues.
3. A finished turn's changes are reviewed in VS Code with epic 8's diff and comments, and the comment reaches the agent.
4. The extension is published through the VS Code Marketplace as part of a release, and works on macOS, Windows and Linux.

(Envelope checks, from spec Non-goals "Planned for v2, not v1" and AD-15; re-read at inception against its Requirements, and V4's own checks are added if it stays here.)

## Boundaries

Ogden's surfaces inside VS Code over the existing server. Not here: a second server, or an editor-side agent runtime (spec Non-goals: no agent runtime of its own); editing or debugging features (the editor already has them); other editors.

## References

- parent — _bmad-output/initiative-ogden-agents/initiative-ogden-agents.md
- spec — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, Non-goals ("Planned for v2, not v1": a VS Code extension, Gemini CLI and GitHub Copilot CLI chat), CAP-15
- architecture — _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md, AD-15, AD-39
- change — _bmad-output/initiative-ogden-agents/change-desktop-ux-uplift/change-desktop-ux-uplift.md, sections 2 and 4.4 ("New envelope")
- epic 8 — _bmad-output/initiative-ogden-agents/epic-v2-developer-experience/epic-v2-developer-experience.md (the Workbench this reuses; V3 and V4's origin)
- epic 6 — _bmad-output/initiative-ogden-agents/epic-every-agent/epic-every-agent.md, Notes (the research and the 14-entry Codex and Gemini CLI plan, commit cced0a9)

## Notes

- Decision (2026-10-31, user, change-desktop-ux-uplift approved): this envelope takes epic 8's V3 (VS Code extension) and V4 (agents) when epic 8 is incepted as the Workbench; unplanned, after the v1.3 epics.
- Open question: does V4 (Gemini CLI, Copilot chat) stay in this epic or become a v2 agents epic of its own? Decide at inception.
- History of V4, kept from epic 8's Notes:
  - Decision (2026-10-02, user): more agents move to epic 8 from v1's epic 6: Codex, Gemini CLI and GitHub Copilot CLI for chat and builds, and builds with Antigravity (or Antigravity chat too, if epic 6's spike is a no-go; epic 6 keeps the agent-choice groundwork either way, user 2026-10-02). The research, the draft's 14-entry plan for Codex and Gemini CLI (commit cced0a9) and the open questions are kept in epic 6's Notes as input.
  - Decision (2026-10-02, user: "we need to add v1.1: Codex and Grok features"): Codex for chat moves out of V4 to epic 12 (v1.1, "Codex and Grok beside Claude Code"). V4 keeps Gemini CLI, GitHub Copilot CLI, builds with Antigravity, and builds with Codex and Grok unless epic 12's inception takes them into v1.1.
  - Decision (2026-10-05, user): V4's builds with Codex, Grok and Antigravity move into version 1 as epic 17 (`epic-builds-with-other-agents`). GitHub Copilot CLI builds are not planned at all (autonomous background Copilot CLI use violates GitHub's terms; Copilot stays interactive in epic 16's terminal). V4 keeps Gemini CLI chat and builds and Copilot chat.
- Constraint (user): if Copilot CLI chat is added, sign-in is only an interactive pass-through, with no autonomous or multi-agent use.
- Waits on epic 8 because: the diff viewer, Changes and line comments (8.3, 8.4, 8.6). Waits on epic 6 because: for V4, the agent registry, acp-base, the agent list and the picker (6.3, 6.4, 6.6).
