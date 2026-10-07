---
id: 19
type: story
title: "Extend Welcome with a guided tour of the app"
parent: none
covers: [CAP-16]
after: []
assignee: ""
refined: true
hitl: false
risk: low
estimate: ""
---

# Extend Welcome with a guided tour of the app

## Description

Epic 9's existing first-run Welcome screen (install, sign-in) gains a guided-tour step shown once onboarding finishes: a short walkthrough highlighting the app's main surfaces — chat, the project sidebar, permission cards, and Board or Plan where BMad is on — so a brand-new user understands what they are looking at, not only how to sign in. This extends the existing Welcome flow; it is not a separate feature or screen.

## Acceptance Criteria

1. **The tour shows once, right after onboarding**
   **Given** a user who has just finished Welcome's install-and-sign-in steps for the first time
   **When** they land on their first project
   **Then** a guided tour starts automatically, pointing out chat, the project sidebar, and permission cards

2. **The tour adapts to what BMad is on**
   **Given** a project with Planning or Board turned on during onboarding
   **When** the tour reaches that part of the walkthrough
   **Then** it also points out Plan or Board; a project with every BMad piece off skips that step entirely

3. **The tour never shows again uninvited**
   **Given** a user who has completed or skipped the tour once
   **When** they restart the app or open another project
   **Then** the tour does not start again by itself

4. **The user can skip or replay it**
   **Given** the tour is showing
   **When** the user chooses to skip it
   **Then** it closes immediately and leaves no partial highlight on screen; the user can replay it later from Settings

5. **The tour never blocks the app**
   **Given** the tour is showing
   **When** the user clicks outside it or starts using chat directly
   **Then** the tour closes and the app underneath is already fully usable

## Boundaries

- Must not change: Welcome's existing install, sign-in, or project-creation steps; CAP-19's BMad per-project toggles.

## References

- parent — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, CAP-16
- source — _bmad-output/initiative-ogden-agents/epic-first-run-onboarding/epic-first-run-onboarding.md

## Notes

- Decision: this extends the existing Welcome/onboarding flow, not a separate tutorial feature (user, 2026-10-07).
