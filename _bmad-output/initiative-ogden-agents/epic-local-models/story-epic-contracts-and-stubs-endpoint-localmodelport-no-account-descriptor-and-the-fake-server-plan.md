---
title: 'Epic contracts and stubs: endpoint, LocalModelPort, no-account descriptor and the fake server (epic 14)'
type: 'feature'
ticket: '14.3'
created: '2026-10-05'
status: 'in-progress'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
baseline_revision: '37280d41b7be27c00556922350560ec47a4250f4'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-local-models/epic-local-models.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 14.2 proved the path with an endpoint fixed in code. The user needs to set up any OpenAI-compatible endpoint (a list, each with an optional key), and every later story needs the agent-neutral contracts: a "needs no account" descriptor flag, the endpoint types and rules, the tool-free `LocalModelPort`, the team role types for epic 15, and the shared fake server fixture.

**Approach:** Shared: `LocalEndpoint`, requests, `readEndpointAddress` (loopback or not, http warning, no credentials in the address), the endpoint event and routes, `TeamRole`/`TeamRoster` types. Core: `noAccount` on the descriptor, `LocalModelPort`, a `LocalEndpoints` use-case (SQLite rows without keys, the keychain for `agent-endpoint-key/<id>`, per-endpoint confirmation bound to the host, one event per change) with migration 0021. Adapters: the OpenAI-compatible port (probe, list models) and the `local-model-memory` stub. Server: the routes behind the AD-15 gate, and chats resolving their endpoint and key from the list. The fake server gets a contract test of every mode.

**Decisions (user, 2026-10-05; epic Notes):** loopback needs no confirmation; a non-loopback host needs a per-endpoint plain-language confirmation bound to the host, with an http warning; the key lives in the keychain as `agent-endpoint-key/<id>`, never in the database, events or logs, and reaches only the chat process; only the server calls out.

## Boundaries & Constraints

**Always:** core and shared name no Ollama, LM Studio or OpenCode (the presets are story 14.4's data from the server); the host rule is enforced in one place (`LocalEndpoints.target`), so no call or chat reaches an unconfirmed host; events carry an id and what changed, never an address or key; plain words, no dashes.

**Never:** a key, address or response body in a log, event or answer; a redirect followed; the browser calling an endpoint; `structuredComplete` implemented here (story 14.8).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Loopback | `http://localhost:1234/v1` | added, no confirmation, no key | n/a |
| Another host | no `confirmHost` | 409 `endpoint_confirmation_required` with the host | nothing stored |
| Changed host | PATCH to a new host or port | confirmation dropped, asks again | chat refused in words |
| Plain http off machine | confirmed | `insecureRemote` true (warning) | n/a |
| Key | given with the endpoint | keychain only; `keySaved` | no keychain: 503 `secrets_unavailable`, nothing added |
| Bad address | credentials, query, scheme | 400 in plain words | n/a |

</frozen-after-approval>

## Code Map

- `packages/shared/src/{local-endpoints,events-local,team,ids,api,errors}.ts` -- contracts, `readEndpointAddress`, routes, the new error code.
- `packages/core/src/{local-endpoints,local-model-port,core,agent-descriptor}.ts`, `db/schema.ts`, `drizzle/0021_local_endpoints.sql` -- the use-case, the port, the flag, the tables.
- `packages/adapters/src/{local-model-openai,local-model-memory}/` -- the real adapter (probe, list) and the stub.
- `packages/server/src/{local-endpoint-routes,local-wiring,start-agents,start,app}.ts` -- routes and chat target.
- Tests: `packages/shared/test/local-endpoints.test.ts`, `packages/core/test/local-endpoints.test.ts`, `packages/adapters/test/local-model-port.test.ts`, `packages/server/test/local-endpoints.test.ts`, `tests/fake-openai-server.test.ts`.

## Tasks & Acceptance

- [x] shared contracts, address rules, events, routes, team types
- [x] core use-case, port, flag, migration 0021
- [x] adapters: OpenAI port and memory stub with one contract test
- [x] server routes and chat target from the list
- [x] fake server contract test

**Acceptance Criteria:**
- Given a non-loopback host, then it is refused until its confirmation is recorded, a changed host asks again, and plain http off the machine returns its warning.
- Given a key, then it is in the keychain only: not in any answer, the database, events or logs.
- Given the stub and the real adapter, then they pass the same probe and list contract.
- Given Claude Code, Antigravity, Codex and Grok, then their flows are unchanged.

## Implementation Notes

Stacked on 14.2 (branch from `story/14.2-local-model-tracer`). `core.localEndpoints(secrets)` takes the keychain the server holds, because core never holds secrets. Presets, Detect and Test are 14.4. The default endpoint is install-wide; per project and per chat choice is 14.5. The migration is 0021; renumber after what is on origin/main when merging.

## Plan Change Log

## Review Triage Log

## Verification

**Commands:** `pnpm typecheck`, `pnpm test`, `PROVENANCE_BASE=origin/main pnpm provenance`.
