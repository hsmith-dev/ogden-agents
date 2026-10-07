---
id: 18
type: story
title: "Ship sample BMAD skills"
parent: none
covers: [CAP-18]
after: []
assignee: ""
refined: true
hitl: false
risk: low
estimate: ""
---

# Ship sample BMAD skills

## Description

Ogden Agents ships two to four example BMAD skill definitions bundled with the app, so a new user who turns on Planning in a project has something real to try in the Plan or Board UI immediately, without writing a skill first. This demonstrates CAP-18 (every installed BMAD skill is usable from the UI without an Ogden Agents code change) with real content instead of a placeholder.

## Acceptance Criteria

1. **Sample skills appear without the user writing one**
   **Given** a project with Planning turned on and no skills of its own
   **When** the user opens Plan
   **Then** at least two bundled sample skills are listed and runnable, with no code change and no skill authored by the user

2. **A sample skill actually runs**
   **Given** a bundled sample skill shown on Plan
   **When** the user starts it
   **Then** it runs the same way a user-authored skill would, through the existing skill-discovery and invocation path, with no special-casing for bundled skills

3. **A project's own skill is never hidden by a sample**
   **Given** a project that already defines a skill with the same name as a bundled sample
   **When** Plan lists that project's skills
   **Then** the project's own skill is shown and runs, not the bundled sample

4. **Sample skills do not appear where Planning is off**
   **Given** a project with every BMad piece off
   **When** the user looks at that project
   **Then** no bundled sample skill is shown and nothing from it is written into the repo

## Boundaries

- Must not change: the existing skill-discovery and invocation path for a project's own skills; CAP-19's per-project opt-in for BMad pieces.

## References

- parent — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, CAP-18
- source — _bmad-output/initiative-ogden-agents/epic-planning-and-board/epic-planning-and-board.md

## Notes

- Decision: this ships real, usable example skills, not placeholder text (user, 2026-10-07).
- Open question: which two to four skills to bundle, and their exact content, is this ticket's own work to propose and the user's to approve during the build — not decided here.
