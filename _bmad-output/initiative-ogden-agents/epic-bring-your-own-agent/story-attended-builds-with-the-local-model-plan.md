---
title: 'Attended builds with the Local model'
type: 'feature'
ticket: '6'
created: '2026-10-31'
status: 'built'
review: 'quick'
lenses_ran: ['quick']
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
- Verified after review fixes: `chat-remote.test.ts` 7 passed; `custom-agents` + `build-conformance` 118 passed, 2 skipped.

## Review Triage Log

### Pass 1 (quick lens, fresh code-only subagent), 2026-10-31: medium 2, low 3; no unattended Local path, no custom-agent build path

| # | Finding | Verdict | Route |
|---|---|---|---|
| 1 | The fake OpenCode asks on every tool call whatever Ogden's permission config says, so the Local row's "every call is a card" can't fail | medium | defer: needs the fake to honour `OPENCODE_CONFIG` permissions; logged in deferred-work |
| 2 | Local could be picked for a remote build (and, since epic 19, a remote chat): its endpoint key would go to the remote host | medium | patch: `localOnlyReason` on the agent port (acp-base quirk, kept by `withEndpointWatch`), refused in `chat/agents.ts` before any connection for chats and builds; tests in `chat-remote.test.ts` and `acp-opencode.test.ts` |
| 3 | A project whose default chat agent is Local now defaults to Local for builds, so Build all ready (unattended) refuses where it used Claude Code | low | accept: same as Grok and Antigravity; noted in the changelog |
| 4 | Custom-agent build refusal checked only a 400 | low | patch: asserts `UNKNOWN_BUILD_AGENT_MESSAGE` |
| 5 | Local's auth and usage cases returned early and reported as passed | low | patch: `it.skipIf` |
