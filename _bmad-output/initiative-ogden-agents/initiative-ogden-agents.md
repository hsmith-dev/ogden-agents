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
3. Claude Code chats and builds through the UI. If epic 6's spike is a go, Antigravity also chats (user, 2026-10-02; was "every agent BMAD supports").
4. No unattended run executes unsandboxed, and no ticket reaches done without a person approving it.
5. Every change carried in the BMAD-METHOD and bmad-loop forks has an upstream PR open or merged.

## Boundaries

Each epic is one user-facing outcome, built in the spec's delivery-phase order. Everything else is out of scope; see the spec's non-goals. Tracer path: `npx ogden-agents`, then sign in, then chat with Claude Code in a workspace; later epics add plan, build and approve.

- Touch point: the user's agent CLIs and ACP adapters (consumed); owner: epic-chat-and-workspaces, then epic-every-agent
- Touch point: the user's repos (`_bmad/` written, plus run branches and git worktree metadata; worktrees live in the data folder, AD-17); owner: epic-planning-and-board, then epic-unattended-builds
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
- Decision: v1 is Claude Code, fully: chat, planning and builds. Epic 6 becomes "Add Antigravity beside Claude Code, if possible", chat only, gated by a spike's go or no-go; builds with Antigravity, and Codex, Gemini CLI and GitHub Copilot CLI for chat and builds, move out of v1 to epic 8 (v2). Their research is kept in epic 6's Notes as v2 input (user, 2026-10-02).
- Decision: epic 6's agent-choice groundwork (session agent, agent registry and list, shared ACP client, picker and default per project) is built whatever Antigravity's spike decides; a no-go drops only the Antigravity entries. v1.1 (Codex and Grok) builds on it (user, 2026-10-02).
- Decision: epic ids 11 and 12: 11 is epic-build-runs-and-notifications (epic 5b, assigned first on `docs/epic-5-inception`) and 12 is epic-v1-1-codex-and-grok (v1.1, Codex and Grok), renumbered from 11 to avoid the clash (2026-10-02).
- Decision: v1.1 (epic 12, user-approved inception 2026-10-04) adds Codex and Grok as chat agents beside Claude Code, each shipping only if its live checks pass on all three OSes; v1.1 ships with whichever passes and the other follows later. Gemini CLI, GitHub Copilot CLI and builds with any agent but Claude Code stay v2 (epic 8). CAP-15, the Non-goals, agent-matrix.md, the AD-1, AD-16, AD-21 and AD-22 notes and EXPERIENCE.md are updated through their memlogs (2026-10-04).
- Decision: epic 5 (Unattended builds) is split in two at its inception: epic 5 builds one ticket for the user to approve and merge, and epic 11 (`epic-build-runs-and-notifications`) adds the run view, Runs tab, Build all ready, verification's test re-run and notifications; each ships on its own (user, 2026-10-01). Later the same day the user moved the test re-run into epic 5, so AD-17 holds from its release, and epic 11 adds richer verification reporting (user, 2026-10-01). Costs and budgets stay out (reaffirmed, 2026-10-01).
- Note (2026-10-04, draft for the user's approval): epic 13, epic-desktop-app, is incepted as a draft: Ogden as a Tauri v2 desktop app on macOS, Windows and Linux beside `npx ogden-agents`, with automatic updates. It sits outside the v1 Done when under its own heading in `tickets.toml`, and proposes a new CAP-20 (see its Notes, open questions 9 and 11).
- Decision (2026-10-04, user): epic 13 is approved and built next, after the current feedback round and ahead of the rest of epics 5, 11, 12 and 7. Its deltas are applied: spec CAP-20, AD-23, and notes on AD-3, AD-5, AD-15, AD-20 and AD-21. It stays outside the v1 Done when.
- Note (2026-10-05, draft for the user's approval, not approved): epic 14, epic-local-models (v1.2: a Local model through Ollama or LM Studio, no account, Ask only), is incepted as a draft with a full breakdown; epic 15, epic-llm-orchestration (v2: a local model as manager and the other agents as workers, user addition the same day), is an envelope only. Both sit outside the v1 Done when. They propose new CAP-21 and CAP-22 and spec, architecture and matrix deltas (see their Notes); none is applied. Branch `docs/epic-local-models-inception`, draft PR.
- Decision (2026-10-05, user): epics 14 and 15 drafts: a tool-free model call is acceptable (AD-1 note); CAP-21 and CAP-22 are proposed through a `bmad-spec` memlog; route is OpenCode probed alongside Codex local mode with Goose in reserve; endpoints are loopback only; orchestration has a per-team mode ("Approve each instruction" by default, "Dispatch automatically" as a toggle) and an in-app roster of roles (manager, planner, worker, reviewer). Remaining open questions carry recommended defaults in each epic's Notes.
- Decision (2026-10-05, user): epics 14 and 15 are APPROVED with all recommended defaults. Change: local models connect through the OpenAI-compatible API to any compatible endpoint (presets for LM Studio and Ollama, optional keychain key, per-endpoint confirmation for a non-loopback host), superseding loopback-only; the manager in epic 15 may be any configured endpoint, local-first recommended.
