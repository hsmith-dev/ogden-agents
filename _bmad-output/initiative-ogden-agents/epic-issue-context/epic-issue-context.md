---
type: epic
title: "v1.3: Start a chat or a build from an issue in your tracker"
parent: initiative-ogden-agents
covers: [CAP-35, CAP-3]
after: []
assignee: ""
risk: medium
---

# v1.3: Start a chat or a build from an issue in your tracker

## Description

Pick an issue from GitHub Issues, Linear or a linked Jira board when starting a chat (and, with Builds on, as a note on a build), and its title, description, status, assignees and link become masked, capped context in the agent's first message; the issue also names the chat (spec CAP-35). The idea comes from emdash's issue context builder and `@issue` mentions; no emdash code is copied.

## Outcome

A user goes from a tracker issue to a working agent in one step, in any project folder, git or not.

## Requirements

Drafted 2026-11-10 (autonomous). Each line maps to a spec capability in `covers`.

- E27-R1: Tracker accounts are per install (Settings, Trackers): a GitHub or Linear token kept through SecretStorePort (AD-16), never sent to an agent, never in the event log. A project may pick its default repository or team, but nothing is ever inferred from a git remote, and a project need not be a git repository (user, 2026-11-10). (CAP-35)
- E27-R2: An issue picker in New chat: search and recent issues from the chosen account, through core, over HTTPS only (epic 18's outbound guard). (CAP-35, CAP-3)
- E27-R3: The issue's context is built in core as one fenced block (provider, identifier, title, URL, status, assignees, description capped at 8 KB), masked with the secret masker, prefixed to the first message, and shown in the composer before it is sent. (CAP-35)
- E27-R4: The chat is named from the issue (`<identifier> <title>`), and a build started from a ticket linked to an issue gets the same block as its note. (CAP-35)
- E27-R5: Jira reuses epic 18's link and client when epic 18 is wired; until then only GitHub and Linear. (CAP-35)

## Done when

1. In a folder that is not a git repository, a chat started from a Linear issue sends the issue's context first and is named after it.
2. The same from a GitHub issue, with the repository chosen in project settings.
3. No token appears in any event, agent environment or stored message (tests).

## Boundaries

Not here: writing back to the tracker (status, comments), PR links, `@issue` mentions mid-chat (a follow-up), more trackers than three.

## References

- spec — spec-ogden-agents/spec-ogden-agents.md, CAP-35, CAP-3
- architecture — AD-16 (secrets), AD-29 (Jira authentication), epic 18's outbound URL guard
- prior art — https://github.com/generalaction/emdash, `apps/emdash-desktop/src/core/primitives/issues/api/issue-context.ts`, `packages/plugins/src/{issues,integrations}` (Apache-2.0; ideas only)

## Notes

- Status: DRAFT, broken into tickets 2026-11-10 (tickets.toml); built on branch `epic-27-issue-context`. Jira (E27-R5) waits on epic 18 being wired and is not in these tickets.
- Built 2026-11-10 (27.1 to 27.4): `packages/shared/src/trackers.ts`, `packages/core/src/{issue-context,tracker-accounts,tracker-port}.ts`, `packages/adapters/src/trackers/`, `packages/server/src/tracker-routes.ts`, `packages/web/src/trackers/`, Settings > Issue trackers, and From an issue on a project's Chats page.
- Decision (2026-11-10, autonomous): the context block goes into the new chat's composer draft, not a hidden prefix, so the person reads and can edit exactly what the agent gets (E27-R3's "shown in the composer before it is sent"); the server builds it from a fresh fetch, never from text the page sent.
- Decision (2026-11-10, autonomous): a build note from a linked issue (second half of E27-R4) is left for a follow-up ticket; nothing links a BMad ticket to a tracker issue yet.
- Assumption: Linear's GraphQL shapes (`searchIssues`, `issue(id:)` by identifier, the personal key sent bare in Authorization) follow its public docs and are proven only against a fake here; live check 27.5 confirms them.

