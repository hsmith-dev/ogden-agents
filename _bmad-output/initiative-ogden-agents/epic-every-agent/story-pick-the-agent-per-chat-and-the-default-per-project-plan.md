---
title: 'Pick the agent per chat and the default per project'
type: 'feature'
ticket: '6'
created: '2026-10-03'
status: 'in-review'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
baseline_revision: '2f6b8444179a2ff0e92bbd6b98d2719b95353e88'
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-every-agent/epic-every-agent.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-every-agent/story-epic-contracts-and-stubs-agents-as-a-choice-plan.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 6.2 gave each chat an agent through a bare toggle on the Chats page, but a project has no default agent (PATCH answers 501), the picker shows agents that can't start without saying why, Welcome offers one agent only, and the web still names Claude Code through `AGENT_ID`/`AGENT_NAME` constants (sign-in again, mode descriptions, permission cards, terminal) and the agent card says "Anthropic" (E6-R1, E6-R2; 9.2 deferral).

**Approach:** Core keeps a project's default agent on the workspace row, changed only through the workspace settings use-case (validated against the registry, appended in `workspace.settings_changed`), and a new chat with no agent picked gets the project's default. The install default lives beside 10.4's pieces in `preferences.json`, is set by Welcome's agent choice (only when more than one agent exists) and Settings → New projects, and is written on a new project's row when it is added. The web replaces the constants with the agent list: a designed picker (composer footer on empty chats, beside New chat otherwise) preselects the project default and shows each agent's readiness, unavailable ones disabled with their reason and a link to Settings → Agents; Workspace settings gains Default agent; every agent-specific sentence takes the session's agent name; the agent card names the provider from the setup status and shows a sign-in code when the setup adapter gives one.

## Boundaries & Constraints

**Always:** core and shared name no agent (architecture test); with Claude Code alone the UI looks as today (no picker, no default-agent section, no Welcome question); events stay back-compatible (AD-5: every new payload field optional); Simple projects unaffected (AD-22); a sign-in URL or code travels only in the `no-store` sign-in response and tab memory, never an event or log; keyboard and screen reader: every picker is a labelled Radix menu or radio group, disabled options keep their reason readable, status changes announced; tests never run real claude/antigravity/codex/grok, the keychain, the network, or read the real `~/.claude`; test hooks only via `testHooksAllowed`.

**Never:** no Antigravity code or entry 7's setup adapter; no per-project trust store (4.2) — an agent needing trust is shown unavailable with core's plain reason and no action; no change to `AgentPort`, the ACP client, or the frozen `ChatAgent`/`AgentUnavailable` shapes; no model picker; no sweep beyond the constants' users (entry 9).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Set project default | `PATCH settings { defaultAgentId: 'fake-agent' }` | 200, stored, `settings_changed` with `defaultAgentId`/`previousDefaultAgentId` | — |
| Clear it | `{ defaultAgentId: null }` | back to the install default; event `defaultAgentId: null` | — |
| Unknown agent | not registered | 400 `agent_unknown`, nothing stored | plain reason |
| Same value | unchanged | 200, no event | — |
| New chat, none picked | project default set | session gets the project default | — |
| Stored default gone | agent no longer registered | treated as unset (registry default) | — |
| Welcome, one agent | Claude Code alone | no agent question, nothing saved | — |
| Welcome, two agents | user picks the second | `preferences.json` `newProjects.defaultAgentId`; next added project's row has it | save failure said in place |
| Picker | agent signed out / not installed / needs trust | option disabled with its reason; link to Settings → Agents (not for trust) | — |
| Sign-in with code | port's `AgentSignIn.userCode` | card shows "Enter this code …" in the tab only | never logged |

</frozen-after-approval>

## Code Map

- `packages/core/src/db/schema.ts` + `drizzle/0008_*.sql` (generate with `pnpm --filter @ogden-agents/core db:generate`) -- nullable `workspaces.default_agent_id`, no default.
- `packages/core/src/workspace-settings.ts` -- `getSettings` adds `defaultAgentId` when set and registered; `updateSettings` input `defaultAgentId?: unknown` (`AgentId|null`); option `isAgentRegistered?(id)` (absent: any valid id); `UnknownAgentError`; event fields only when changed. Wire through `permissions.ts` `PermissionsOptions` and `core.ts` `CoreOptions` (lazy function; registry is built later in `start.ts`).
- `packages/core/src/entities.ts` `ensureWorkspace` -- option `defaultAgentId?: () => AgentId | undefined` stored on create; included in the creation `settings_changed` when set.
- `packages/core/src/new-projects.ts` -- record `newProjects.defaultAgentId?`; `set` takes pieces and/or agent (null clears); options `isAgent?`; `addProject` passes the preference when registered.
- `packages/core/src/chat/workspaces.ts` `createChatSession` -- `options.agentId ?? project default (registered) ?? agents.defaultAgentId`; reads `ctx.options.permissions?.getSettings`.
- `packages/core/src/agent-setup.ts` + `agent-setup-port.ts` -- `AgentSignIn.userCode?`; signIn answer carries `code`; option `providerOf?(agentId)` adds `provider` to each status.
- `packages/shared/src/chat.ts` -- doc of `ChatAgentsResponse.defaultAgentId` (for projects without their own); `projectNotTrustedReason` moved here from core. `setup.ts` -- `AgentSetupStatus.provider?`, `SignInResponse.code?`. `bmad.ts`/new-projects schemas -- `NewProjectDefaults.defaultAgentId?`, update request pieces optional + agent nullable (at least one).
- `packages/server/src/workspace-routes.ts` -- drop the 501; map `UnknownAgentError` → 400 `agent_unknown`; log the agent id. New-projects route the same. `start.ts` -- pass `isAgentRegistered`/`isAgent` and `providerOf` from `wirings`.
- `packages/web/src/chat/chat-api.ts` -- remove `AGENT_NAME`/`AGENT_ID`; `agentNameOf` falls back to the list default's name, else "The agent". `use-chat-agents.ts` -- refetch on `agent.*` events; `useProjectDefaultAgent(wsId)`; `agentReadiness(agent, workspace)` (unavailable reason incl. trust).
- `packages/web/src/chat/agent-picker.tsx` -- rewrite as a dropdown menu (`ui/dropdown-menu` `DropdownMenuChoiceItem`, as the mode picker): trigger "Agent: X", items with readiness or reason, disabled when unavailable, a "Set up agents" link item to `/settings/agents`; hidden with one agent.
- `packages/web/src/chat/composer.tsx` -- `footer?: ReactNode` at the start of the footer row.
- `packages/web/src/routes/workspace-chats-page.tsx` -- picker in the empty composer footer, beside New chat otherwise; preselect project default (follows events until the user picks); unavailable pick shows reason + link, New chat refused client-side.
- `packages/web/src/routes/workspace-settings-page.tsx` -- `DefaultAgentSection` (radio group, only with >1 agent, readiness descriptions, link). `workspace-settings-api.ts` -- `updateDefaultAgent`.
- `packages/web/src/settings/new-project-defaults.tsx` -- agent choice with >1 agent. `onboarding/welcome-model.ts`, `routes/welcome-page.tsx` -- with >1 agent a radio "Which agent should do the work?" choosing the card shown, saved as the install default; one agent unchanged.
- Constant users -> name props: `sign-in-again.tsx` (agentId, name; shown when the agent has a setup status), `session-page.tsx`, `permissions/permission-mode-picker.tsx` (descriptions by name; enabled choices = session's modes), `permission-card.tsx`, `terminal/driver-toggle.tsx`, `terminal/terminal-panel.tsx`, `shell/sidebar-model.ts`.
- `packages/web/src/agents/agent-card.tsx`, `agent-setup-api.ts`, `signing-in.tsx` -- provider words; `code` kept in tab state and shown.
- Tests: core (`workspace-settings`, new-projects, chat default), server (`agent-choice.test.ts` PATCH/POST), shared (old event parses), web dom (picker, settings section, welcome model), e2e `tests/e2e/agent-picker.spec.ts` (two fake agents via `fakeSecondAgent({ agentId, displayName, setup })`), grep test that `packages/web/src` has no `AGENT_NAME`/`AGENT_ID` constant (architecture test). Update existing tests using the constants or 501.

## Tasks & Acceptance

**Execution:**
- [ ] shared -- schema fields, moved reason, docs; contract tests.
- [ ] core -- column + migration, settings default agent, ensureWorkspace, new-projects agent, chat default, setup provider/code; tests.
- [ ] server -- routes, wiring; tests (PATCH set/clear/unknown, POST uses default, new-projects agent, provider in status).
- [ ] web -- constants removed, picker, chats page, settings section, new projects, welcome, card, sign-in again; dom tests.
- [ ] e2e + architecture grep; fix existing tests.

**Acceptance Criteria:**
- Given two fake agents and a project default of the second, when a new chat starts from the Chats page, then the picker preselects it and the chat is the second agent's.
- Given two tabs on one project, when the default changes in Workspace settings in one, then the other's picker follows without a reload.
- Given a signed-out agent, when the picker opens, then it is disabled with its reason and a Settings → Agents link, by keyboard too.
- Given any web source, when the architecture test runs, then no `AGENT_NAME` or `AGENT_ID` constant exists in `packages/web/src`.

## Implementation Notes

- Implemented directly in this session (it held the investigation, as 6.2 to 6.4 did), not by a fresh subagent.
- Core: `workspaces.default_agent_id` (migration `0008_workspace_default_agent.sql`); `readDefaultAgent`; settings take `defaultAgentId` (unknown → `UnknownAgentError`, 400 `agent_unknown`); `OpenCoreOptions.isAgentRegistered` (server: Claude Code + `extraAgents`, known before the registry is built); `ensureWorkspace` `defaultAgentId` option, in the creation `settings_changed`; `createNewProjectDefaults` keeps `defaultAgentId` (pieces now optional in the PATCH); `createChatSession` uses the project default; `AgentSetupOptions.providerOf`; `AgentSignIn.userCode` → `SignInResponse.code`.
- Shared: `projectNotTrustedReason` moved here; `AgentSetupStatus.provider?`, `SignInResponse.code?`, `NewProjectDefaults.defaultAgentId?`.
- Web: `AGENT_NAME`/`AGENT_ID` removed; every former user takes the session's agent name (`permissionModeDescriptions(name)`, `skipAllWarning`, `skipAllBanner`, `notIdleReason`, `signInAgainWords`, `apiKeyRefused`, terminal panel words, Needs you entries carry `agentName`). `AgentPicker` is a menu: unavailable agents are `aria-disabled` but focusable (a Radix `disabled` item is skipped by the keyboard, so its reason would never be read). `DefaultAgentView` (`chat/default-agent-view.tsx`) serves Workspace settings and Settings → New projects. The session header names the agent (`session-agent`) only with more than one agent. Sign in again shows for any agent that has a setup status.
- Welcome: the per-agent "previous readiness" ref, so choosing an already-ready agent never auto-advances.
- `createMemoryAgentSetup` gained `userCode`; `tests/support.ts` `fakeSecondAgent({ agentId, displayName })` and `fakeAgentSetup`.
- Architecture test `findWebAgentConstants`: no `AGENT_NAME`/`AGENT_ID`, agent id literal, "Claude Code" or "Anthropic" in web code.
- e2e `tests/e2e/agent-picker.spec.ts`; `agent-choice.spec.ts` follows the picker becoming a menu. Radix radios check on arrow-focus only while the key is held, so the Welcome keyboard step holds ArrowDown.

## Plan Change Log

## Review Triage Log

## Design Notes

The registry default (Claude Code) stays `ChatAgentsResponse.defaultAgentId`: the agent of a project with no default and of sessions stored before agents (the web's fallback name). The install default is applied when a project is created (like 10.4's pieces), so changing it never moves existing projects. The mode picker keeps undeclared modes visible but disabled with "<Agent> doesn't offer Auto." (EXPERIENCE.md, epic Done when 3); its enabled choices are exactly the session agent's modes, which is how the entry's "lists only the session agent's modes" is met. No trust store exists before 4.2, so `needsProjectTrust` reads as untrusted everywhere, matching the server.

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `pnpm test` -- all pass (background)
- `pnpm e2e` -- all pass
- `pnpm run pack && pnpm smoke` -- pass
