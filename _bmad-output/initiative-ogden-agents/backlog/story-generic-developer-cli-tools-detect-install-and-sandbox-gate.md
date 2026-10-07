---
id: 20
type: story
title: "Generic developer CLI tools: detect, install, and sandbox-gate"
parent: none
covers: [CAP-25]
after: []
assignee: ""
refined: true
hitl: true
risk: medium
estimate: ""
---

# Generic developer CLI tools: detect, install, and sandbox-gate

## Description

A user discovers which common developer CLI tools (gcloud, docker, kubectl, aws, or any other the user names, not a fixed catalog) are already on their machine from Settings, and installs a missing one by having Ogden Agents run that tool's own official installer with a permission-card-style confirmation of the exact command — never requiring a terminal. An installed tool is usable by interactive chats immediately, behind the existing permission card like any shell command. An unattended sandboxed build (epic 5) can reach it only after the user has explicitly allowed that specific tool for unattended use in that project — deny-by-default, matching epic 5's existing sandbox posture, even once the tool is installed and already usable in chat.

## Acceptance Criteria

1. **Settings shows what is already installed**
   **Given** a machine with some developer CLI tools already on `PATH` or in a known install location
   **When** the user opens the developer tools section of Settings
   **Then** each tool Ogden Agents knows about shows its real installed or not-installed state

2. **Installing a tool runs its own real installer, with a visible confirmation**
   **Given** a tool shown as not installed
   **When** the user clicks Install
   **Then** Ogden Agents shows the exact official installer command before running it, runs it only after the user confirms, and the tool is then usable — with no terminal opened at any point

3. **A refused or failed install says so in plain words**
   **Given** the user declines the confirmation, or the real installer fails
   **When** the install attempt ends
   **Then** Settings shows the tool as still not installed with a plain reason, and nothing silently retries

4. **An installed tool works in chat like any shell command**
   **Given** a tool installed through this feature
   **When** an agent in a chat runs it
   **Then** it runs behind the existing permission card (CAP-4) exactly as any other shell command would

5. **Unattended builds cannot reach it until explicitly allowed**
   **Given** a tool installed and already usable in chat, and a project running an unattended build
   **When** that build's agent tries to use the tool
   **Then** it is refused, with a plain reason, unless the user has explicitly allowed that specific tool for unattended use in that project

6. **Explicitly allowing a tool for unattended use is a deliberate, visible action**
   **Given** a project where the user wants an unattended build to use an installed tool
   **When** they grant that specific tool's unattended-use allowance
   **Then** the allowance is scoped to that tool and that project, is visible in the project's settings afterward, and can be revoked

## Boundaries

- Must not change: CAP-4's existing permission-card behavior for interactive chat; epic 5's existing sandbox and worktree model for build isolation; Ogden's sha256 pin-and-verify flow for its own managed agent CLI binaries (CAP-16) — this ticket adds a parallel, unverified path for user-named tools, it does not touch that one.

## References

- parent — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, CAP-25
- source — _bmad-output/initiative-ogden-agents/epic-unattended-builds/epic-unattended-builds.md

## Notes

- Decision: Ogden runs the tool's own official installer itself with a confirmed command, never just displaying one for the user to run in their own terminal (user, 2026-10-07).
- Decision: unattended access is deny-by-default per tool, matching epic 5's existing sandbox posture (user, 2026-10-07).
- Open question: what "detected" means exactly — a `PATH` scan only, or also known per-OS default install locations the way `agent-matrix.md`'s CLI location table already does for agent CLIs. Resolve during this ticket's own build, not before.
- Open question: the exact UI for granting the per-tool unattended allowlist exception (a checkbox per tool in project settings, or a first-use confirmation) is this ticket's own design work, not decided here.
- `hitl: true`: this executes real installer commands and adds a new exception path into the unattended-build sandbox boundary — a person should look at the first build of this before it's called done, beyond the usual review.
