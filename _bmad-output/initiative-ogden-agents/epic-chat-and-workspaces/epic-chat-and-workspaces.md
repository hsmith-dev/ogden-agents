---
type: epic
title: "Chat with your own agent in workspaces across projects"
parent: initiative-ogden-agents
covers: [CAP-3, CAP-4, CAP-16, CAP-17]
after: []
assignee: ""
risk: high
---

# Chat with your own agent in workspaces across projects

## Description

First-run onboarding finds, installs and signs into the user's agent. Each project becomes a workspace with persistent ACP chats (Claude Code first), permission cards, and a status sidebar across workspaces. Sessions keep running when the browser closes.

## Outcome

A user signs into their own Claude Code account from the UI and chats in two projects at once; CAP-16's and CAP-17's success criteria are the signal.

## Requirements

Completed at inception from the spec capabilities in `covers`.

## Done when

1. On a fresh machine, a user installs and signs into Claude Code from the UI, and another user uses only an API key (CAP-16, AD-21).
2. After a server restart, a reopened chat continues with its prior context (CAP-3).
3. A requested shell command does not run until approved on a card (CAP-4).
4. Agents work in two workspaces at once; the browser is closed and reopened, and the sidebar shows both live states (CAP-17, AD-4).
5. Released in an `ogden-agents` npm version.

## Boundaries

Chat, onboarding and workspaces with Claude Code only. Other agents come in epic 6, the terminal in epic 3, and BMAD skills in epic 4.

## References

- parent — _bmad-output/initiative-ogden-agents/initiative-ogden-agents.md
- spec — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, section Capabilities
- architecture — _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md, AD-2, AD-3, AD-4, AD-5, AD-8, AD-9, AD-16, AD-18, AD-21
- agent matrix — _bmad-output/initiative-ogden-agents/spec-ogden-agents/agent-matrix.md

## Notes

- Waits on epic 1 because: see `after` in the initiative's tickets.toml.
- Decision: session events (message deltas, completions, tool calls) are appended only through a core helper that takes a session ID and derives `workspaceId` from it, so no event can name a session in another workspace and per-workspace history deletion stays complete. This comes from story 1.3's review (user, 2026-09-29).
- Decision: the UI subscribes per workspace to a recent window and pages older history on demand, instead of replaying the whole install history in one blocking step on every page load. This needs a scoped, paged subscribe protocol in the event log. It comes from story 1.3's review (user, 2026-09-29).
- Decision: before this epic gives the server agent control, amend AD-15 so API and WebSocket auth uses a per-tab token held by the page, not the session cookie. Browsers send loopback cookies to every port on 127.0.0.1, so any local web server the user opens receives the cookie. Story 1.4 only made the cookie name port-specific and documented the limit (user, 2026-09-29).
