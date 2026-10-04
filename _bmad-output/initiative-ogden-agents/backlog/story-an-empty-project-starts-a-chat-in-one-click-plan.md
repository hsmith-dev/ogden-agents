---
title: 'An empty project starts a chat in one click'
type: 'feature'
ticket: '2'
created: '2026-10-04'
status: 'ready-for-dev'
baseline_revision: '56883363a54bcfb42b8ae698522dd02e34af5ef2'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/backlog/story-an-empty-project-starts-a-chat-in-one-click.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A project with no chats shows "No conversations yet." and a composer, with New chat only in the header; the sidebar shows an empty project as a bare name with nothing to click (user feedback 2026-10-04: "When there are no chats in a project it should be easy to start a new chat with that project").

**Approach:** Web only. The empty Chats page gets one primary **Start a chat** (project default agent, Ask by the server's rule) plus a **Use another agent** menu when the install has several agents; the composer stays as the second way in, without its own picker. An empty project's sidebar group gets a **Start a chat** row doing the same one-click start. Ticket criteria 1 to 7 are the bar.

## Boundaries & Constraints

**Always:**
- Reuse `agentAvailability`, `projectDefaultAgent`, `useChatAgents`, `useWorkspaceSettings`, `createChatSession`, `SET_UP_AGENTS`, `DropdownMenuChoiceItem` styling of the agent picker, `EmptyState`, `SidebarMenuButton`/`SidebarLabel`.
- One in-flight start per surface (ref guard); failures shown as a plain sentence with `role="alert"`; retry works.
- Reason-before-trying only while there are several agents (6.6 rule); with one agent the server's reason shows after the click.
- Sidebar row only when the group's sessions are loaded and it has no rows and no Earlier rows; accessible name `Start a chat in <project>`; in the rail the label is sr-only with a tooltip.
- UI copy plain, no em or en dashes. Tests never run real agents, keychain, network or the real `~/.claude`; no new test hooks.

**Never:** server/API/schema changes; changes to the list view, header picker, session page; hiding the header New chat (it becomes `variant="outline"` while the list is empty).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Page start | empty project, default ready | chat with default agent opens, composer focused | none |
| Another agent | several agents, pick ready one in menu | chat with that agent opens | unavailable item: preventDefault, nothing starts |
| Default blocked | several agents, default signed out | reason + link tied to Start (aria-describedby), click shows reason, no chat | role=alert |
| Server fails | POST sessions rejects | plain reason, button usable again | role=alert |
| Sidebar start | empty project, default ready | chat opens, sheet closes | failure: alert text under row |
| Sidebar blocked / data not loaded | default unavailable or list/settings unknown | navigate to `/w/$wsId` | none |
| Double click | start in flight | no second chat | ref guard |

</frozen-after-approval>

## Code Map

- `packages/web/src/routes/workspace-chats-page.tsx` -- page; `onNewChat`, `blocked`, `creating/createError`, empty branch (`chats-empty`) with Composer + footer AgentPicker (remove the footer picker here; keep header picker for the list view).
- `packages/web/src/chat/use-chat-agents.ts` -- `agentAvailability`, `projectDefaultAgent`.
- `packages/web/src/chat/agent-picker.tsx` -- menu pattern to mirror for "Use another agent" (choice items, aria-disabled unavailable, set-up link).
- `packages/web/src/chat/chat-api.ts` -- `createChatSession(wsId, auth?, agentId?)`, `agentNameOf`.
- `packages/web/src/shell/status-sidebar.tsx` -- `SidebarWorkspaceGroup` children; `unloaded` set; add the empty-project row.
- `packages/web/src/ui/sidebar.tsx` -- `SidebarMenuButton` closes the sheet unless defaultPrevented; `SidebarText` hidden in rail.
- `packages/web/src/workspaces/workspace-settings-api.ts` -- `useWorkspaceSettings(wsId)` (event-invalidated).
- Tests: `packages/web/test/agent-choice.dom.test.tsx` (router + menu helpers), `tests/e2e/agent-picker.spec.ts` (empty page footer picker assertion, update), `tests/e2e/workspaces.spec.ts`, `tests/e2e/chat-server.ts` (`withChatServer`, `startChat`), `tests/support.js` (`fakeSecondAgent`, `fakeAgentSetup`).

## Tasks & Acceptance

**Execution:**
- [ ] `packages/web/src/chat/start-chat.tsx` (new) -- `useStartChat(wsId)` (guarded create + navigate, error state) and `StartChatActions` (primary Start a chat + "Use another agent" menu of the other agents) -- shared by page and sidebar.
- [ ] `packages/web/src/routes/workspace-chats-page.tsx` -- empty state: description naming the agent, `StartChatActions`, composer without footer picker; header New chat outline while empty; use the hook for header start too.
- [ ] `packages/web/src/shell/sidebar-start-chat.tsx` (new) + `status-sidebar.tsx` -- the empty-project row.
- [ ] `packages/web/test/start-chat.dom.test.tsx` (new) -- menu, blocked, double click, failure, sidebar row naming.
- [ ] `tests/e2e/empty-project.spec.ts` (new) -- page start, another agent, sidebar start (desktop and phone sheet), keyboard; update `agent-picker.spec.ts` empty-page assertions.
- [ ] `_bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md` -- Empty chats state and Status sidebar row.

**Acceptance Criteria:**
- Given an empty project, when the page or its sidebar row is used, then the ticket's criteria 1 to 7 hold.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `pnpm typecheck` -- clean
- `pnpm test` -- all pass
- `pnpm e2e` -- all pass
- `pnpm run pack && pnpm smoke` -- passes
