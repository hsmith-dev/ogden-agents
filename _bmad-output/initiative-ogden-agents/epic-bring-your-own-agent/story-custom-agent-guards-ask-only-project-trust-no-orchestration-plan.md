---
title: 'Custom agent guards: Ask only, project trust, no orchestration, read-only chats after removal'
type: 'feature'
ticket: '4'
created: '2026-10-31'
status: 'built'
review: 'quick'
lenses_ran: ['quick']
route: 'oneshot'
route_source: 'auto'
baseline_revision: '87de3fc1ddb9345c6b4de424e5d5fba41bbe1c01'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-bring-your-own-agent/epic-bring-your-own-agent.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A custom agent must stay in its limits in the server, not only on its card (E21-R4): Ask only, project trust, never an orchestration worker or an unattended builder; and once removed, its chats must stay readable but closed, saying "This agent was removed."

**Approach:** Most guards already hold through the descriptor and port a custom agent has (Ask only and `modeFixedAtStart`, `needsProjectTrust`, no `unattendedBuild`); prove each with a server test. Add the missing pieces: `interactiveOnly` on the custom descriptor (orchestration's existing dispatch and roster refusals then apply), a core refusal of a message to a chat whose agent is not registered (`agent_removed`, 409, before anything is queued), and the web's read-only chat with the banner.

## Boundaries & Constraints

**Always:** core names no agent (the refusal is for any unregistered agent); copy has no em or en dashes; build sessions' read-only path is unchanged.

**Never:** changes to built-in agents' guards.

</frozen-after-approval>

## Code Map

- `packages/adapters/src/acp-custom/custom-agent.ts` -- `interactiveOnly` sentence on the descriptor.
- `packages/core/src/errors.ts`, `chat/turns.ts` (`sendMessage`) -- `AgentRemovedError` (`agent_removed`, `AGENT_REMOVED_MESSAGE`) when `ctx.agents.get(agentIdOf(session))` is undefined.
- `packages/shared/src/errors.ts`, `packages/server/src/chat-routes.ts` -- the 409 code and mapping.
- `packages/web/src/routes/session-page.tsx` -- read-only chat when the session's agent is not in the chat agents list.
- Already enforcing: `core/src/chat/permission-mode.ts:268` (mode not offered), `chat/workspaces.ts:142` (trust), `orchestration-dispatch.ts:61` and `team-roster.ts:105` (interactive only), `server/src/build-agent-sandbox.ts:11` (unattended, fails closed).

## Tasks & Acceptance

- [x] descriptor `interactiveOnly`; core refusal, API code and mapping.
- [x] server tests: Ask only (Auto and Skip all refused, mode stays Ask), untrusted project 409 `project_not_trusted`, `interactiveOnly` listed, no unattended build, removed chat readable with sends refused 409 `agent_removed` and nothing appended, the same after a restart.
- [x] web read-only chat with "This agent was removed." and a DOM test.

**Acceptance:** Given a removed custom agent, when its chat is opened, then it reads and cannot be continued; given `pnpm typecheck` and `pnpm test`, then both pass.

## Implementation Notes

- `core/test/agent-choice.test.ts` changes on purpose: a chat whose agent is not registered was failed at the agent's start (state `error`, `AGENT_NOT_REGISTERED_REASON`); it is now refused before anything is queued (state unchanged, nothing appended). Its point (never reaching another agent) holds.
- Skip all is refused at Developer mode (403) before the mode check; Auto at the mode check (409). Both leave the chat in Ask.
- Web (subagent, verified): `session-page.tsx` `agentRemoved` when the session's agent is not in the loaded chat agents list; banner "This agent was removed. You can read this chat, but not continue it.", no composer or work-starting controls, inert transcript; the Skip all banner is hidden there too.
- Removing an agent now stops its running turns (`chat.stopAgent`, bound late in `start.ts`) and the drive loop drops a removed agent's queue; this resolves the deferred "removed while working" item, recorded below.
- Verified: `pnpm test` 5056 passed, 8 skipped before the review patches; after them the custom agent server tests (31), session page DOM tests (9) and typecheck pass; full suite rerun before commit.

## Review Triage Log

### Pass 1 (quick lens), 2026-10-31: high 1, medium 1, low 2

| # | Finding | Verdict | Route |
|---|---|---|---|
| 1 | Removed mid-turn: the turn ran on and queued messages still reached it, while the page hid Stop | high | patch: Remove stops the agent's turns as Stop does (`chat.stopAgent`), the drive loop drops its queue; server test |
| 2 | The page hid Continue with another agent for a removed agent, which the server allows | medium | patch: the menu stays |
| 3 | Other tabs did not refetch chat agents on `settings.custom_agent_changed` | low | patch |
| 4 | Tests: interactive only shown only as text, mode test accepted any refusal | low | patch: roster view test; Auto 409 `mode_unavailable`, Skip all 403 |
| - | Doc comment of `BuildSessionReadOnlyError` displaced | - | moved |
