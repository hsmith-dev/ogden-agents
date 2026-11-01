---
title: 'Refactor sweep'
type: 'refactor'
ticket: '7'
created: '2026-10-31'
status: 'built'
baseline_revision: '5b1de5d70bf6f06b8e6346ec1f6df34dff2ba7b1'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-bring-your-own-agent/epic-bring-your-own-agent.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Entries 1 to 6 left two open deferred items and some duplication: the install-wide team roster default (a file, not the database) can still name a removed custom agent's id, so a later agent given that id silently takes the role; and the fake OpenCode asks on every tool call whatever Ogden's config says, so the Local build row cannot fail if Ogden's config stopped asking.

**Approach:** Removing a custom agent also clears every role of the roster default that names it (core's team, generic over any agent id), with the usual `settings.team_roster_default_changed` event. The fake OpenCode honours the `permission` block of `OPENCODE_CONFIG` as OpenCode does, and a Local build case shows that `allow` skips the card, so the row's cards prove Ogden's config sets `ask`. Small, behaviour-neutral cleanups the sweep finds in the epic's code go in the same change, each listed in Implementation Notes.

## Boundaries & Constraints

**Always:** core and shared name no agent (architecture test green); built-in agents' behaviour unchanged; a project's own stored roster is untouched (its id stays reserved by `isAgentIdInUse`); copy has no em or en dashes; the deferred-work log gets `Resolved:` entries quoting the original phrases and loses both Open items lines, and `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs` passes.

**Never:** new user-facing behaviour beyond the cleared default role and the sweep's bug fixes (each with a test); changes to Ogden's generated OpenCode config; a cleanup that needs a new test to show it is safe and has none.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error |
|---|---|---|---|
| Remove, default names it | roster default planner (or reviewer) = `custom-x`; `DELETE` | 204; that role is `null` in the file and view; one `settings.team_roster_default_changed` | none |
| Remove, default does not | roster default empty or other agents | 204; file unchanged; no roster event | none |
| Clearing fails | the file write throws | 204 still (agent removed), warning logged | logged, not surfaced |
| Fake, Ogden's config | `permission.edit: ask` | a card for each write (row as today) | none |
| Fake, `edit: allow` | override switch | inside write made with no card; outside write still a card (`external_directory` ask) | none |

</frozen-after-approval>

## Code Map

- `packages/core/src/team-roster.ts` -- `Team`, `createTeam` (`setDefault`, `sameRoster`, `TEAM_ROLES`): add `forgetAgent(agentId): boolean`, reading `defaults.get().orchestrationRoster`, nulling roles that name the agent, `defaults.setRoster`, appending the event as `setDefault` does.
- `packages/server/src/start-custom-agents.ts` -- `remove` already calls the late-bound `stopChats`; add a late-bound `forgetInTeamDefault` ref the same way, each in its own try/catch with a warning.
- `packages/server/src/start.ts:345,399,463` -- `stopChats` ref, its binding, `team`: bind the new ref after `team` exists.
- `tests/fixtures/fake-build-turn.mjs` -- `playBuildTurn`'s `editsInsideWithoutAsking` becomes a `decide(path)` callback (`ask` | `allow` | `deny`); Codex's caller (`fake-acp-agent.mjs:813`) keeps its rule through it.
- `tests/fixtures/fake-opencode.mjs:239` -- build path reads `readConfig().permission`, merged under a test switch `FAKE_OPENCODE_PERMISSION` (JSON, "as if the config said"), OpenCode's defaults when a key is missing (`edit` allow, `external_directory` ask); chat's `bash` call honours `permission.bash` too. Header comment documents both.
- Tests: `packages/core/test/team-roster.test.ts` (`the team of a project and the default for new projects` setUp), `packages/server/test/custom-agents.test.ts` (21.4 describe, `teamRosterDefault` route), `packages/server/test/build-conformance.test.ts` (Local describe, `setup(row, { env })`).
- `_bmad-output/initiative-ogden-agents/deferred-work.md` -- Open items lines 130 and 131; log entries at the end.
- Sweep (found by a read-only subagent, each checked here):
  - S1 `packages/server/src/start-agents.ts:248` `forChat` copies an agent's fields by hand and drops `unattendedBuild`, `attendedOnlyReason`, `localOnlyReason`; chats read the wrapped port (`core/src/chat/context.ts:99`), so 21.6's refusal of a remote Local chat or build (`core/src/chat/agents.ts:132`) never fires in the server. `acp-opencode/watch.ts:105` copies the same three by hand. One core helper (`agent-port.ts`) that both wrappers spread; a server test through the real `forChat` (`vi.mock` of `start-agents.js` capturing it, as `npm-launcher-wiring.test.ts` does).
  - S2 `adapters/src/acp-custom/custom-agent.ts:123` `probeCustomAgent` resolves the command, then the launch quirk resolves it again with the same error (`process-launch.ts:186` passes an `AgentError` through): drop the first.
  - S3 `'custom--test'` in `custom-agent-routes.ts:135` and `UNSAVED_TEST_ID` in `start-custom-agents.ts:36`: one exported constant; `custom-agent-routes.ts:68` uses `CUSTOM_AGENT_ID_PREFIX`.
  - S4 exports nothing imports: `NEVER_ASKING_MODE_WORDS`/`_IDS`, `CUSTOM_ASK_MODE_ID` and `CUSTOM_SKILLS_FOLDER` (and their `acp-custom/index.ts` re-exports), `customAgentSlug`, `customAgentId`, `TEST_TIMEOUT_MS`: drop `export`. Types and shared/web exports stay (public shapes).
  - S5 unused `type AgentPort` import in `custom-agent.ts:18`.
  - S6 `refuse` and `unavailable` are the same lines in `core/src/custom-agents.ts:67-71`, `local-endpoints.ts:96-100`, `remote-machines.ts:88-93`: two helpers in `core/src/errors.ts`, used by all three.
  - S7 `start-custom-agents.ts` `test`/`testSaved` build the same probe call, and the key-env set from a request is written twice (`create`, `update`): two local helpers.
  - S8 `acp-opencode/opencode-agent.ts:66-67` two doc comments stacked, the first belongs to `LOCAL_ATTENDED_ONLY_REASON`.
  - Not taken: the web page's two caption lists and four `instanceof Error` fallbacks (`custom-agents.tsx`): idiomatic, two uses, would churn tested markup.

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/team-roster.ts` + core test -- `Team.forgetAgent`.
- [x] `packages/server/src/start-custom-agents.ts`, `start.ts` + server test -- remove clears the default; re-adding the same name takes the freed id and holds no role.
- [x] `tests/fixtures/fake-build-turn.mjs`, `fake-acp-agent.mjs`, `fake-opencode.mjs` + conformance case -- the fake honours `permission`.
- [x] S1: core helper, both wrappers, server test (a wrapped Local-like port keeps all three fields).
- [x] S2 to S8 as listed in the Code Map; existing tests cover them unchanged.
- [x] `deferred-work.md` -- two `Resolved:` entries, two index lines gone.

**Acceptance Criteria:**
- Given a remote chat or build with the Local model through the started server, when it starts, then it is refused with `LOCAL_ONLY_REASON` before any connection (S1).
- Given the change, when `pnpm typecheck`, `pnpm test` and the provenance check run, then all pass, the architecture test included.

## Implementation Notes

- Roster default: `Team.forgetAgent(agentId)` returns whether a role was cleared; the file write goes through `defaults.setRoster` (an all-null roster drops the key, as `setDefault` does). The server binds `forgetInTeamDefault` after `team`; `remove` calls it after `stopChats`, each in its own try/catch with a warning. The write-failure case is made by a folder at the save's temporary path (`preferences.json.<pid>.tmp`), which throws on every OS.
- Fake OpenCode: `permissionOf(config, tool)` merges OpenCode's defaults (`bash` and `edit` allow, `external_directory` ask), the config's `permission` and `FAKE_OPENCODE_PERMISSION`; anything but `allow` or `deny` reads as `ask`. A build write outside `session.cwd` takes `external_directory` first, then `edit`. The chat's `bash` call honours it too (`allow`: `ran(config): <command>` with no card; `deny`: refused with no card). `playBuildTurn`'s `decide(path)` (`ask` default) replaces `editsInsideWithoutAsking`; `isInside` is exported from `fake-build-turn.mjs` for both callers.
- S1: `keptAgentFlags(agent)` in `core/src/agent-port.ts` also carries `modeFixedAtStart`, which both wrappers already copied the same way, so one spread replaces four hand-copied lines in each. Server test `packages/server/test/for-chat-flags.test.ts` captures the real `forChat` from `wireAgents` and checks a Local-like port, a plain one (no flags added) and the real `createLocalAgent` through both wrappers.
- S2: `probeCustomAgent` no longer resolves the command itself; the launch quirk's `AgentError` passes through (`process-launch.ts`). Its doc comment says so.
- S3: `UNSAVED_TEST_ID` (`${CUSTOM_AGENT_ID_PREFIX}-test`) is exported from `custom-agent-routes.ts` and imported by `start-custom-agents.ts`; `customAgentId` builds on `CUSTOM_AGENT_ID_PREFIX`.
- S4: `export` dropped from `NEVER_ASKING_MODE_WORDS`, `NEVER_ASKING_MODE_IDS`, `CUSTOM_ASK_MODE_ID`, `CUSTOM_SKILLS_FOLDER` (and the two `acp-custom/index.ts` re-exports), `customAgentSlug`, `customAgentId`, `TEST_TIMEOUT_MS`.
- S5: unused `type AgentPort` import removed from `custom-agent.ts`.
- S6: `refuseInvalid` and `secretsUnavailable` in `core/src/errors.ts` (exported through core's index with the rest of the file), used by `custom-agents.ts`, `local-endpoints.ts`, `remote-machines.ts`.
- S7: `probe(displayName, commandLine, env, fields)` and `keyEnvOf(apiKey)` local helpers in `start-custom-agents.ts`; log fields unchanged.
- S8: the two Local reasons each have their own doc comment.

- Verified: `pnpm typecheck` clean; `pnpm test` 405 files, 5119 passed, 10 skipped, 1 failed: `adapters/test/local-failures.test.ts` "a slow first token" timed out at 5 s under full-suite load (the timing test 21.1 also saw), then passed alone three times (21 of 21). No Playwright spec touched. Provenance check exit 0.
- Reviewer (quick lens) ran the touched files and architecture test: 237 passed, 2 skipped.

## Plan Change Log

## Review Triage Log

### Pass 1 (quick lens, fresh code-only subagent), 2026-11-01: high 0, medium 0, low 2, false 1; no broken rules or bugs found

| # | Finding | Verdict | Route |
|---|---|---|---|
| 1 | S1's criterion (a remote Local chat or build refused through the started server) has no end-to-end test; the new test checks only that the real `forChat` keeps the fields | low | reject: the refusal is proven by core's `chat-remote.test.ts` given the field, and the field surviving the real server wrappers (`forChat`, `withEndpointWatch`, `createLocalAgent`) by `for-chat-flags.test.ts`; a server-level remote chat needs a confirmed remote machine harness, more than a direct correction |
| 2 | The fake OpenCode's chat `bash` allow/deny and the build `deny` branches run in no test | low | reject: fixture paths no test relies on; Ogden's config sets `ask` for every tool, and the build `allow` path the deferred item asked for is tested |
| 3 | "Remove, default does not" is covered at the server only with no file | false | the core test checks the file byte for byte and no event after forgetting an agent the default no longer names, or another agent (`team-roster.test.ts`, forgetting an agent) |

## Design Notes

Clear on remove, not ignore on read: reading past a stale id would still let a re-added agent of the same name (same slug, since the file is not one of `isAgentIdInUse`'s sources) take the role. A project's stored roster is different: it reserves the id, as chats do. Custom agents cannot be the new projects' default chat agent (`registeredAgent` in `start.ts` lists only wired agents), so that field of the file needs nothing.

## Verification

Run every command from this plan's worktree root (`/Users/harrisonsmith/Library/Caches/ogden-agents-dev-worktrees/21.7`), never another checkout; do not commit. The machine is loaded: re-run a timing failure alone before treating it as real. The full `pnpm test` is run by the reviewer step; the implementer runs the touched test files.

**Commands:**
- `pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: all pass (21.6: 404 files, 5112 passed, 8 skipped)
- `pnpm exec vitest run packages/server/test/custom-agents.test.ts packages/server/test/build-conformance.test.ts packages/core/test/team-roster.test.ts` -- expected: pass
- `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs` -- expected: exit 0
