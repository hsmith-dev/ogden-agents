---
title: 'Attended builds with the Local model'
type: 'feature'
ticket: '6'
created: '2026-10-31'
status: 'built'
review: 'quick'
lenses_ran: []
route: 'full'
route_source: 'auto'
baseline_revision: 'b9350855'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-bring-your-own-agent/epic-bring-your-own-agent.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Build never offers the Local model, so a user on their own endpoint can chat but not build (E21-R6).

**Approach:** Register the Local model with the agent-neutral ACP build runner as attended-only: Build offers it with every tool call a card, the skill goes in `.agents/skills`, unattended stays refused in Local's own words. Custom agents get no runner, so Build never offers them.

## Boundaries & Constraints

**Always:** built-in runners unchanged; the Local reason in plain words, no dashes.

**Never:** an unattended Local build; a build runner for a custom agent.

</frozen-after-approval>

## Code Map

- `packages/adapters/src/buildrunner-acp/index.ts` -- `createLocalBuildRunner`.
- `packages/server/src/start-builds.ts` -- Local in the runners list; custom agents have none.
- `packages/adapters/src/acp-opencode/opencode-agent.ts` -- `LOCAL_ATTENDED_ONLY_REASON`, `attendedOnlyReason`.
- `packages/adapters/src/acp-opencode/watch.ts` -- `withEndpointWatch` keeps `unattendedBuild` and `attendedOnlyReason` (it dropped them, so the picker showed the generic reason).
- Tests: `build-conformance.test.ts` (a `local` row), `custom-agents.test.ts` (no custom agent in the build list; a build started with one is refused 400, no session).
- Fixtures: shared `tests/fixtures/fake-build-turn.mjs`, played by `fake-acp-agent.mjs` and `fake-opencode.mjs`.

## Tasks & Acceptance

- [x] Local build runner, attended only, registered.
- [x] Conformance row for Local (subagent); two cases skipped with reasons: no sign-in to expire (the endpoint and key are checked before start), no usage limit on the user's own server.
- [x] Custom agents not offered and refused by name.

**Acceptance:** Given the Local model, when an attended build of a fixture ticket runs against the fake server, then it reaches Ready for review with its diff and every tool call a card; an unattended request is refused; given `pnpm typecheck` and `pnpm test`, both pass.

## Implementation Notes

- Verified: `pnpm typecheck` clean; `pnpm test` 404 files passed (5112 passed, 8 skipped).
- Open for the live check (21.8): whether OpenCode's skill invocation and tool use in a worktree match chat.
- Review: not yet run; next step is a fresh code-only review, triage logged here.
