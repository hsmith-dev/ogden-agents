---
type: epic
title: "Chat with your own agent in workspaces across projects"
parent: initiative-ogden-agents
covers: [CAP-3, CAP-4, CAP-17]
after: []
assignee: ""
risk: high
---

# Chat with your own agent in workspaces across projects

## Description

Each project becomes a workspace with persistent ACP chats (Claude Code first), permission cards under a per-project caution level, and a status sidebar across workspaces. Sessions keep running when the browser closes, and an app shortcut reopens the app. Before any of this gives the server agent control, API and WebSocket auth moves from the loopback cookie to a per-tab token (AD-15 amendment). Installing and signing into the agent from the UI (CAP-16) is the next epic, `epic-first-run-onboarding`; until it ships, this epic's live checks use the developer's existing Claude Code login or an API key in the environment.

## Outcome

A user whose Claude Code is already signed in chats in two projects at once from the browser and finds both still live after closing and reopening it; CAP-3's and CAP-17's success criteria are the signal.

## Requirements

Each line maps to a spec capability in `covers` and names the architecture decisions it carries. E2-R7 to E2-R9 are the three decisions carried from epic 1's reviews; E2-R10 is the user's decision on reopening.

- E2-R1: A user starts a chat with Claude Code in a workspace. Messages and tool calls stream through ACP behind `AgentPort` and the `acp-claude-code` adapter, and the session shows exactly one of `working`, `waiting`, `idle`, `done`, `error`. Messages sent while the agent works are queued. (CAP-3; AD-1, AD-3, AD-4, AD-5, AD-8, AD-9)
- E2-R2: Chats are listed per workspace and persist. After a server restart every session whose process is gone is `idle` and resumable, and a reopened chat continues with its prior context: ACP `session/resume` when advertised, else `session/load`, else a new session primed from the stored transcript, marked "Resumed from history". (CAP-3; AD-3, AD-9)
- E2-R3: An agent's permission request appears as a card with Allow once, Always allow (scope shown) and Deny. The tool call does not run until the user decides. Always-allow rules are scoped to the workspace, stored and enforced in core, and can be undone. (CAP-4; AD-4, AD-5, AD-18; spec constraint "guardrails in code")
- E2-R4: Each workspace has a caution level (Ask every time by default, Ask for commands, Ask only for risky actions), enforced in core, applying only to requests not yet shown. (CAP-4; AD-2)
- E2-R5: Each project is a workspace, added by picking a folder or creating a new one; the same repo never becomes two workspaces. Many workspaces are active at once, sessions keep running when the browser closes, and a workspace's history can be deleted. (CAP-17; AD-2, AD-3, AD-5)
- E2-R6: The status sidebar shows every session in every workspace with its live state, and a Needs you group aggregates permission requests across workspaces. (CAP-17; AD-4, AD-18)
- E2-R7: Session events (message deltas, completions, tool calls, permissions, state changes) are appended only through a core helper that takes a session id and derives `workspaceId`, so no event can name a session in another workspace and per-workspace history deletion stays complete. (CAP-3, CAP-17; AD-2, AD-5, AD-11; carried decision)
- E2-R8: The UI subscribes per workspace to a recent window of events and pages older history on demand; it never replays the whole install history on page load. (CAP-17, CAP-3; AD-5 as amended; carried decision)
- E2-R9: AD-15 is amended before agent control ships: API and WebSocket requests are authorized by a per-tab token held by the page, not by the session cookie. (CAP-3, CAP-4, CAP-17; AD-15 as amended; carried decision)
- E2-R10: An Ogden Agents shortcut, offered on first run, reopens the app from the OS app menu: it runs the launcher, which starts or attaches to the server and opens a fresh launch link, so a closed browser needs no terminal. (CAP-17; AD-3, AD-15 as amended, AD-21)

## Done when

1. A user whose Claude Code is already signed in chats in a workspace from the browser, and the reply streams live (CAP-3).
2. After a server restart, a reopened Claude Code chat continues with its prior context (CAP-3).
3. Under the default caution level, a requested shell command does not run until it is approved on a card (CAP-4).
4. Agents work in two workspaces at once; every browser window is closed and the app reopened from its shortcut, and the sidebar shows both live states while the page loads only a recent window per workspace (CAP-17, AD-4, AD-5).
5. API and WebSocket requests carrying only the session cookie are refused; the tab's token opens them (AD-15 as amended).
6. Released in an `ogden-agents` npm version, with the epic's end-to-end suite passing on macOS, Windows and Linux.

## Boundaries

Chat, permissions and workspaces with Claude Code only. Installing the agent, signing in and the Welcome flow are `epic-first-run-onboarding` (CAP-16). Other agents come in epic 6, the terminal toggle in epic 3, and BMAD skills, the board and runs in epics 4 and 5.

## References

- parent — _bmad-output/initiative-ogden-agents/initiative-ogden-agents.md
- spec — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, section Capabilities (CAP-3, CAP-4, CAP-17) and Constraints
- agent matrix — _bmad-output/initiative-ogden-agents/spec-ogden-agents/agent-matrix.md, section How the UI uses it
- architecture — _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md, AD-1, AD-2, AD-3, AD-4, AD-5, AD-8, AD-9, AD-11, AD-15, AD-18, AD-21
- ux — _bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md (Component Patterns, State Patterns, Key Flow 3, Accessibility Floor) and DESIGN.md (Components)
- carried work — _bmad-output/initiative-ogden-agents/deferred-work.md (session-event helper, paged subscriptions, per-tab token)
- research — ACP SDK `@agentclientprotocol/sdk` 1.5.1 (protocol 1); Claude Code adapter `@agentclientprotocol/claude-agent-acp` 0.84.0; facts summarized in the Notes below (research of 2026-09-30)

## Notes

- Waits on epic 1 because: see `after` in the initiative's tickets.toml; entries name the epic 1 stories they need (1.4 gate, 1.6 shell, 1.7 launcher, 1.10 release workflow).
- Decision: session events (message deltas, completions, tool calls) are appended only through a core helper that takes a session ID and derives `workspaceId`, so no event can name a session in another workspace and per-workspace history deletion stays complete. This comes from story 1.3's review (user, 2026-09-29).
- Decision: the UI subscribes per workspace to a recent window and pages older history on demand, instead of replaying the whole install history in one blocking step on every page load. This needs a scoped, paged subscribe protocol in the event log. It comes from story 1.3's review (user, 2026-09-29).
- Decision: before this epic gives the server agent control, amend AD-15 so API and WebSocket auth uses a per-tab token held by the page, not the session cookie. Browsers send loopback cookies to every port on 127.0.0.1, so any local web server the user opens receives the cookie. Story 1.4 only made the cookie name port-specific and documented the limit (user, 2026-09-29).
- Decision: onboarding (install, subscription sign-in, API key, first-run Welcome; CAP-16) is split into its own epic, `epic-first-run-onboarding`, after this epic's contracts; this epic's live checks use the developer's existing Claude Code login or an API key in the environment until it ships (user, 2026-09-30).
- Decision: entry 1 is the AD-15 per-tab token amendment and entry 2 is the tracer bullet. The tracer is the first slice that gives the server agent control, which the carried decision forbids on the cookie; entry 1 gives no agent control and is itself a thin path through launcher, server and page (user, 2026-09-30).
- Decision: the tracer bullet (entry 2) is one Claude Code chat message from the session view through REST, core, `AgentPort`, `acp-claude-code` and ACP and back as live events. It creates the session-event helper (E2-R7) and the fake ACP agent every later slice tests against; its hitl setup is the developer's existing Claude Code login or API key (user, 2026-09-30).
- Decision: entry 3 is contracts and stubs for this epic and the onboarding epic (schemas, REST shapes, `AgentPort`, `AgentSetupPort`, `SecretStorePort` stubs wired in the server, the extended fake agent, route registrations), so every lane and the onboarding epic open after it (user, 2026-09-30).
- Decision: lanes after entry 3 are shortcut {4}; workspaces {5}, then events {9, 11}; sessions {6, 7, then 8 and 10}. Entry 8 joins workspaces and sessions, entry 10 sessions and events, entry 11 all three plus the shortcut (user, 2026-09-30).
- Decision: a closing refactor sweep (entry 12) and a closing end-to-end suite that also cuts the release (entry 13), so Done when 6 has an owner without a slice after the suite (user, 2026-09-30).
- Decision: Flow 3's conflict with the per-tab token (a closed browser or bookmark no longer opens the app) is resolved by an Ogden Agents app shortcut, entry 4, offered on first run and reopening the app through the launcher with a fresh link. It sits in this epic after the token fix, not in the onboarding Welcome, because this epic's Done when 4 depends on reopening, and the token fix is what creates the need; Welcome reuses the same action (user, 2026-09-30).
- Decision: built with `bmad-build` (interactive, orchestrator-reviewed), so no plan or done checkpoints are set (user, 2026-09-30).
- Decision: the two-agent resume proof in CAP-3's success criterion moves to epic 6; this epic proves resume with Claude Code and the fake agent's three resume modes (user, 2026-09-30).
- Decision: always-allow rules are stored and enforced in core, and are not passed to the agent as `allow_always` (user, 2026-09-30).
- Decision: the agent-matrix corrections found by the 2026-09-30 research (resume order, Claude sign-in path, adapter package names, Gemini and Copilot flags) go to a `bmad-spec` update of the spec companions, not to a story here (user, 2026-09-30).
- Assumption: high-risk entries (1, 6, 8) each get a check outside their own criteria: the user reviews entry 1's token flow and runs entry 6's and 8's live check against Claude Code before the entry is called done.
- Assumption: Add project uses a server-side folder browser, since a browser page cannot hand the server a local path.
- Assumption: caution levels classify requests by ACP tool kind; "risky" means `execute`, `delete`, `move` and `fetch`.
- Unknown: whether `claude-agent-acp` uses the user's installed `claude` CLI and credentials or its bundled Agent SDK CLI; entry 2 answers it, and the onboarding epic's install story waits on the answer.
- Unknown: whether `claude-agent-acp` 0.84 advertises `sessionCapabilities.resume`, `loadSession`, or both; entry 7 waits on it.
- Unknown: whether a shortcut that runs the npx launcher starts quickly enough and needs a pinned install path, and how macOS Gatekeeper treats a generated app bundle; entry 4 waits on it.
- Source conflict: agent-matrix, How the UI uses it, Resume — "`session/load` where the agent advertises `loadSession`, otherwise the stored transcript" vs research: ACP 1.5 also has `session/resume` under `sessionCapabilities.resume`, tried before `session/load` and before the transcript fallback (E2-R2, entry 7). Settled for this epic by the resume order in E2-R2; the matrix text goes to the `bmad-spec` update.
- Source conflict: AD-15 ("a valid session cookie ... obtained by exchanging a launch code") and EXPERIENCE.md (Launch page reached "without a valid session cookie"; Flow 3 step 2, "The session cookie is still valid, so the shell loads"; Open Questions on cookie lifetime) vs the carried per-tab token decision. Settled by the Decisions above: entry 1 amends AD-15 and the launch-page copy, and entry 4's shortcut replaces the bookmark in Flow 3.
- Source conflict: AD-5 ("The UI holds one WebSocket and subscribes with 'after seq N'; reconnecting and catching up are the same call") vs the carried paged-subscription decision: subscriptions become per workspace and windowed, with paging for older history. AD-5's rule text is amended in entry 9.
- Source conflict: agent-matrix, Claude Code row, "Claude Agent ACP" vs research: the `@zed-industries` adapter names are deprecated and the adapter is `@agentclientprotocol/claude-agent-acp` (0.84.0). Goes to the `bmad-spec` update.
- Validation (revised draft, run inline against `checks.set` and `checks.dependencies`, 2026-09-30; still to be re-run by independent agents per validate.md, and `tickets.py status` once the file is in the tree):
  - Set 1, coverage: pass. E2-R1 to E2-R10 each have at least one entry (R4 only 8; R7 only 2; R10 only 4, plus 13's suite); every `covers` id exists. CAP-16 now belongs to `epic-first-run-onboarding`; the two-agent resume proof is epic 6's by Decision.
  - Set 2, UX, architecture, integration and Done when: pass. Done when 1 → 2, 10; 2 → 7; 3 → 6, 8; 4 → 4, 5, 9, 11; 5 → 1; 6 → 13. The AD-15 and AD-5 amendments have owners (1, 9); matrix corrections go to `bmad-spec` by Decision.
  - Set 3, `after` is real, no restated order: pass on inspection. Collision edges, required by the collision check: 7 after 6 (adapter), 8 after 7 (core permission and session service), 11 after 4 (Done when 4's reopen and the shell's first-run area). `tickets.py status`: not run (draft outside the tree).
  - Set 4, a builder could write criteria: pass; entries 4 and 7 carry `unknown` for what their criteria depend on.
  - Set 5, refactor sweep last: pass (12 after 1 to 11; 13 after 12).
  - Dependencies, needs: pass. The fake agent is owned by 2; contracts, route registry and server wiring by 3; the session list endpoint by 5 (9 after 5); the paging store API by 9 (10 after 9); the shortcut endpoint shape by 3 (4 after 3).
  - Dependencies, collisions: pass. `router.tsx` and server wiring stay in 3; `status-sidebar.tsx` is shared by 5 and 11 (11 after 5); Drizzle migrations in 6 and 8 (8 after 6); the workspace settings page is shared by 5 and 8 (8 after 5); 4 and 11 both touch the shell's first-run area (11 after 4).
  - Dependencies, shared setup: pass. Fake agent (2), contracts and stubs (3), workspace settings page (5), paging store API (9), end-to-end harness (13, which the onboarding epic extends).
  - Dependencies, handoffs: pass. Both sides name: the env passed to `AgentPort` (2 and onboarding's API key story), the shortcut action (4 and onboarding's Welcome), Add project (5 and Welcome), the session list endpoint (5 and 9), the paging API (9 and 10), the error notice that onboarding extends with sign-in-again (10 and onboarding's story), the e2e suite onboarding extends (13).
