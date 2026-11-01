---
title: 'Epic contracts: custom agent rows, live registry, routes and the variable-name rule'
type: 'feature'
ticket: '2'
created: '2026-10-31'
status: 'built'
review: 'quick'
lenses_ran: ['quick']
route: 'full'
route_source: 'auto'
baseline_revision: '6c2bd65fdab145067e94f69ad4492d11557fa33b'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-bring-your-own-agent/epic-bring-your-own-agent.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A custom agent registered in 21.1 is gone when the server stops, cannot be renamed, re-pointed or removed, and cannot have the API key its harness needs (E21-R1, E21-R3).

**Approach:** A core-owned `custom_agents` table (AD-11) with list, create, update and remove use-cases; the server loads stored rows into the live registry at start and adds, replaces or removes them as the routes change them. An optional key is kept in the secret store as `agent-api-key/<agentId>` and joins only that agent's chat environment, under a variable name the user picks that matches `^[A-Z][A-Z0-9_]*_API_KEY$` and is neither allowlisted nor a loader variable.

## Boundaries & Constraints

**Always:**
- Core and shared name no custom agent and no agent id; the architecture test stays green.
- The command is resolved before anything is saved (create and update) and again at every chat start (21.1's launch).
- The key value is never in the database, the event log, a log line or a response; events carry `{ agentId, change }` only. Responses say whether a key is set and its variable name.
- Routes under `API_ROUTES` and the AD-15 gate, `{ error: { code, message } }`, `noStore` on anything carrying a key.
- An id a stored chat or project default names stays reserved after removal (21.1).

**Never:**
- Test (spawn and `initialize`) — moved to entry 3 with the form (deferred-work). Read-only chats after removal and stopping a removed agent's running chats — entry 4.
- A setup port or sign-in for custom agents; changes to built-in agents' env, keys or wiring; `process.env` in any spawn.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error |
|---|---|---|---|
| Create | name, command, optional `{ envName, value }` | 201 `CustomAgent` (`agentId`, `displayName`, `commandLine`, `keyEnvName \| null`, `hasKey`); row stored; listed | none |
| Restart | stored row | registered at start; a chat works | a row whose command no longer resolves still registers; its chat start errors `agent_unavailable` |
| List | `GET` | every stored custom agent | none |
| Update | `PATCH` name, command, key (`null` clears) | 200; registry entry replaced live | 404 `custom_agent_not_found`; 400 `custom_agent_command_invalid` |
| Remove | `DELETE` | 204; row and secret gone, unregistered | 404 |
| Bad variable name | `PATH`, `NODE_OPTIONS`, `LD_PRELOAD_API_KEY`, `my_api_key`, `TOKEN` | 400 `invalid_request` | plain reason |
| Key reach | chat with A (key) and B | A's process env has `<envName>=<value>`; B's and every built-in's do not | none |
| Secrets unavailable | store throws | 503 `secrets_unavailable` (existing code), nothing saved | plain reason |

</frozen-after-approval>

## Code Map

- `packages/core/src/db/schema.ts` -- add `customAgents` (`agent_id` pk, `display_name`, `command_line`, `key_env_name` nullable, `created_at`, `updated_at`); `pnpm --filter @ogden-agents/core db:generate` → `0038_*.sql`.
- `packages/core/src/agent-linked-commands.ts` -- pattern to copy for `custom-agents.ts` (events.transaction, settings stream, ValidationError); wired in `core.ts:225,252`.
- `packages/shared/src/events-settings.ts:39-51`, `events.ts:28,378,453` -- add `settings.custom_agent_changed` (`change: 'added' | 'updated' | 'removed'`).
- `packages/shared/src/custom-agents.ts` -- `CustomAgentKeyEnvName` (regex plus refusals for `LD_`/`DYLD_` prefixes and allowlisted names), `CustomAgentKeyInput`, `CustomAgent`, list/update schemas; `api.ts` `customAgent: /custom-agents/:agentId`; `errors.ts` `custom_agent_not_found`.
- `packages/core/src/agent-port.ts` -- `MutableAgentRegistry.remove(agentId)` (refuses the default agent).
- `packages/server/src/start-agents.ts:217-221` -- `chatEnv`/`freshChatEnv` gain a last layer from an injected `customKeyEnv: ReadonlyMap<AgentId, Record<string,string>>`, filled only for custom ids.
- `packages/server/src/start.ts:342-353` -- the `customAgents` closure grows `list/create/update/remove` over core + `secrets` (`apiKeySecretName`, `agent-setup-types.ts:21`); loads stored rows and keys right after it, before `createChat`.
- `packages/server/src/custom-agent-routes.ts` -- GET list, POST (extend body), PATCH, DELETE; secrets errors mapped like `agent-setup-routes.ts:259-300`.
- Tests: `packages/server/test/codex-setup.test.ts:52-110` (`allText`, key-never-kept pattern) to copy; `custom-agents.test.ts` from 21.1 extended; `gate.test.ts` route list.

## Tasks & Acceptance

**Execution:**
- [x] shared schemas, event, route constants, error code; unit tests for the variable-name rule (each forbidden class).
- [x] core table, migration, `createCustomAgents` use-cases and `Core.customAgents`; core tests (create, update, remove, events without secrets).
- [x] registry `remove`; contract test.
- [x] server key layer, load-at-start, closure and routes.
- [x] server tests: matrix through the API incl. restart, key reach (fake agent echoes env) and key absent from DB, events and logs.

**Acceptance Criteria:**
- Given a custom agent saved with a key, when the server restarts, then it is listed and chats, and its key reaches only its own process.
- Given any forbidden variable name, when saving, then 400 and nothing is stored.
- Given the change, when `pnpm typecheck` and `pnpm test` run, then both pass with built-in agents' tests unchanged.

## Implementation Notes

- Core owns the rows and the key (`packages/core/src/custom-agents.ts`, `core.customAgents(secrets)`, the `core.localEndpoints(secrets)` pattern): key first on create, row before dropping a key on update, key before row on remove, so neither is left behind.
- Server wiring moved out of `start.ts` into `start-custom-agents.ts` (`createCustomAgentsWiring`, `load()` before chats and builds). A changed name or command re-registers the agent; running chats keep their process (deferred to entry 4).
- `chatEnv` and `freshChatEnv` gain a last layer, `customKeyEnv.get(agentId)`, filled only for custom ids. Masking of agent output already covers it: `_API_KEY` always matches `SECRET_ENV_NAME`.
- The variable-name rule lives in shared (`CustomAgentKeyEnvName`): the `_API_KEY` ending already excludes every allowlisted and loader name (PATH, NODE_OPTIONS); `LD_` and `DYLD_` prefixes are refused as well.
- The POST response is now `{ agent: CustomAgent }` (21.1 returned `{ agentId }`; no client used it yet). A `pending` set holds ids between choosing and storing, since create now awaits the keychain.
- No memory stub: the real use-cases landed in this story, so entries 3 and 6 build on them directly. Test moved to entry 3 (deferred-work).
- The fake ACP agent gains `has-env <NAME>` (set/unset and the last four characters), so the key-reach test never echoes a key.

- Verified: `pnpm typecheck` clean; `pnpm test` 5014 passed, 8 skipped (402 files) before the review patches; the 35 custom-agent tests (server and core) pass after them.

## Review Triage Log

### Pass 1 (quick lens), 2026-10-31: medium 4, low 3; no key reaches another agent

| # | Finding | Verdict | Route |
|---|---|---|---|
| 1 | A re-register that throws during update left the agent out of the registry | medium | patch: build first, restore the earlier registration on refusal |
| 2 | A create whose register throws kept a row that doesn't chat | medium | patch: remove the row, one refusal |
| 3 | Update overwrote the keychain secret with no restore if the row change failed | medium | patch: read the old value, put it back |
| 4 | Concurrent PATCH and DELETE interleave across keychain waits (re-registering a removed agent) | medium | patch: wiring changes run one at a time |
| 5 | Swallowed key deletes could leave a key no row names | low | patch: remove always tries the secret |
| 6 | A failed row removal after the key was dropped kept the key in memory | low | patch: `finally` clears it |
| 7 | Keys read one at a time at start (5 s each on a locked keychain) | low | patch: read side by side |

## Spec Change Log

## Verification

- `pnpm typecheck`; `pnpm vitest run packages/server/test/custom-agents.test.ts packages/core/test packages/shared/test`; `pnpm test`.
