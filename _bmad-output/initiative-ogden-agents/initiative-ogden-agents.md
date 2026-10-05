---
type: initiative
title: "Anyone builds software with their own coding agent, from the browser"
parent: none
covers: [CAP-1, CAP-2, CAP-3, CAP-4, CAP-5, CAP-6, CAP-7, CAP-8, CAP-9, CAP-10, CAP-12, CAP-13, CAP-14, CAP-15, CAP-16, CAP-17, CAP-18, CAP-19]
after: []
assignee: ""
risk: high
---

# Anyone builds software with their own coding agent, from the browser

## Description

Ogden Agents is a local app, installed with `npx ogden-agents`, that pairs the whole BMAD method with the user's own coding agent behind a browser UI. It works across many projects at once, the way herdr does. The spec owns the capabilities, constraints and non-goals; the architecture spine owns the cross-epic decisions.

## Outcome

A non-developer goes from an idea to approved, agent-built code without opening a terminal. The spec's success signal is the measure.

## Done when

1. On macOS, Windows and Linux, a non-developer completes the spec's success signal without opening a terminal.
2. `npx ogden-agents` from the public npm registry installs and launches on all three.
3. Every agent BMAD supports builds through the UI, and every agent that speaks ACP also chats.
4. No unattended run executes unsandboxed, and no ticket reaches done without a person approving it.
5. Every change carried in the BMAD-METHOD and bmad-loop forks has an upstream PR open or merged.

## Boundaries

Each epic is one user-facing outcome, built in the spec's delivery-phase order. Everything else is out of scope; see the spec's non-goals. Tracer path: `npx ogden-agents`, then sign in, then chat with Claude Code in a workspace; later epics add plan, build and approve.

- Touch point: the user's agent CLIs and ACP adapters (consumed); owner: epic-chat-and-workspaces, then epic-every-agent
- Touch point: the user's repos (`_bmad/` and worktrees written); owner: epic-planning-and-board, then epic-unattended-builds
- Touch point: Docker, only where already installed (sandbox fallback); owner: epic-unattended-builds
- Touch point: the npm registry (publishing); owner: epic-foundation-and-forks
- Touch point: the upstream BMAD-METHOD and bmad-loop repos (PRs); owner: epic-foundation-and-forks sets up the process, and each epic sends its own patches
- Touch point: GitHub Releases assets (desktop apps, `SHA256SUMS`, `latest.json`, the `desktop-channel-next` prerelease), nodejs.org downloads (pinned Node), the updater endpoints, the npm registry read for the newer-version notice, and the Apple and Windows signing services (slots only); owner: epic-desktop-app (13), outside the v1 Done when (approved 2026-10-04)

## References

- spec — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md
- architecture — _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md
- constraint — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, section Constraints

## Notes

- Decision: build and plan in a new `ogden-agents` repo; this planning moves there in epic 1; `ogden-aiagents` stays the old product (user, 2026-09-29).
- Decision: no cost or token tracking; CAP-11 retired (user, 2026-09-29).
- Decision: the cross-epic decisions live in the architecture spine, not in hitl stories (user chose bmad-architecture, 2026-09-29).
- Decision: epic 1 is built interactively with `bmad-build`; later epics may run unattended with `bmad-build-auto`, with checkpoints set at their inception (user, 2026-09-29).
- Note (2026-10-04, draft for the user's approval): epic 13, epic-desktop-app, is incepted as a draft: Ogden as a Tauri v2 desktop app on macOS, Windows and Linux beside `npx ogden-agents`, with automatic updates. It sits outside the v1 Done when under its own heading in `tickets.toml`, and proposes a new CAP-20 (see its Notes, open questions 9 and 11).
- Decision (2026-10-04, user): epic 13 is approved and built next, after the current feedback round and ahead of the rest of epics 5, 11, 12 and 7. Its deltas are applied: spec CAP-20, AD-23, and notes on AD-3, AD-5, AD-15, AD-20 and AD-21. It stays outside the v1 Done when.
