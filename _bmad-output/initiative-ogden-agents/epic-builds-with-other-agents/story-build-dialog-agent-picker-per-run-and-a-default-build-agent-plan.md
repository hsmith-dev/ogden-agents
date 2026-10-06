---
title: 'Build dialog agent picker per run and a default build agent per project'
type: 'feature'
ticket: '8'
created: '2026-10-06'
status: 'built'
baseline_revision: 'ac750ccc221709039543d4921ea6f6a44a912966'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'pinned'
lenses_ran: ['security', 'correctness']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-builds-with-other-agents/epic-builds-with-other-agents.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Several agents can now build, but Build always uses Claude Code and the Build dialog's "Use another agent" is disabled. The person needs to pick the agent for a run, see for each one whether it builds on its own or only with them watching and why in plain words, and set the agent a Build uses when they pick none.

**Approach:** Build opens the dialog with an agent picker when more than one agent can build here (the picker's list is entry 3's `GET build-agents`); the choice applies to that run only. The sandbox status is asked per agent (`?agent=`). A project's default build agent (`defaultBuildAgentId`, a new nullable setting) is chosen in Workspace settings, and a Build or Build all ready that names no agent uses it, falling back to the project's default chat agent when it can build, else Claude Code.

## Boundaries & Constraints

**Always:** Nothing starts until a button in the dialog is pressed. An agent that is not ready cannot be chosen, and says what to do. An agent that builds only with the person watching starts only an attended build. With one agent that can build, or a list that cannot be read, Build behaves as it did. The choice is not remembered per ticket. The default build agent never overrides a request that names an agent. New copy has no dashes.

**Never:** No agent is ever chosen for the person beyond the default rule. No unattended path for an agent that cannot take a sandbox.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Two agents build | Build on a card | dialog with both, default chosen, nothing started | — |
| Attended only agent chosen | its own reason shown | Build with me watching starts an attended run with it | — |
| One agent builds | Build | goes straight on, no agent named | — |
| List unreadable | server error | Build goes straight on | — |
| Default build agent set | Build names none | the default builds (also Build all ready) | an unwired agent is ignored |
| Not ready agent | no key | radio disabled with its reason | — |

</frozen-after-approval>

## Code Map

- `packages/shared/src/build-settings.ts`, `builds.ts`, `api.ts` -- `defaultBuildAgentId`, the picker's words.
- `packages/core/src/db/schema.ts`, `drizzle/0031_build_default_agent.sql` -- the column.
- `packages/core/src/build-settings.ts`, `build-context.ts`, `builds.ts` -- the default and the per-agent status.
- `packages/server/src/build-routes.ts` -- `?agent=`.
- `packages/web/src/planning/{build-dialog,board-tickets,build-limit-fields,builds-api}.tsx` -- the picker and the setting.

## Tasks & Acceptance

**Execution:**
- [x] Setting, migration, default rule, per-agent status; picker and settings UI; DOM, server and e2e tests.

**Acceptance Criteria:**
- Given two agents that can build, when Build is pressed, then the dialog asks which and the run uses the choice; the default build agent is set per project and used when none is named.

## Implementation Notes

Migration 0031 (`default_build_agent_id`) was generated with drizzle-kit after the latest on main (0030) and renamed. This closes the deferred item that the sandbox status route was the default agent's.

## Review Triage Log

One combined security and correctness review (an independent agent), loop 1; no blocker, server enforcement holds (the UI only selects an agent; each start is checked by the server per agent). Fixed: the default rule's fallback is wrapped as a whole (a project that is gone, or an unreadable setting, falls back to the install's agent); the confirm text names the chosen agent; Use another agent focuses the checked radio first; the picker shows only with two or more agents that are ready; the default agent's field is labelled as a group. Existing tests that compared the build settings exactly now include the new field.

Noted for the release notes (entry 11): with no default build agent set, a project whose default chat agent can build (for example Codex) now builds with that agent by default, as the Notes' assumption says; the sandbox rules still apply, so a Build with it ends in the Build dialog until its sandbox is verified. Declined: refusing unknown agent ids when the default is saved (an unwired agent is ignored until it exists, and the stored choice survives).
