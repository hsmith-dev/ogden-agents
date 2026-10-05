---
title: 'Model list and picker: from the server, per project and per chat (epic 14)'
type: 'feature'
ticket: '14.5'
created: '2026-10-05'
status: 'in-progress'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
baseline_revision: '8c10ab5a9ce73b942149a36360da42580e432477'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-local-models/epic-local-models.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Local model's endpoints are set up, but the user can't see what a server serves, which models are small or short of context, or choose the model a chat starts on, and a model the server drops would be silently replaced.

**Approach:** The model list comes from the server (`/v1/models` for every endpoint, plus the preset server's own API for sizes, context length and tool support, only where it reports them). The server writes the list into the chat model picker (the existing per-project default and per-chat switch from story 11, with the harness's own ids) and the card lists each model with plain cautions and **Use for new chats**. A chosen model the server no longer lists is shown as missing and the chat is refused with its name; it is never swapped. The card says in every state what small local models are.

**Decisions (user, 2026-10-05; epic Notes):** the model name is a free string from the server (no catalogue, no recommendation); the context floor is 16k; honest hardware and tool-calling notes; Ogden Agents never pulls or starts a model.

## Boundaries & Constraints

**Always:** only what the server reports is shown (no guessed sizes); core, shared, acp-base and the web name no server product (the preset id is opaque data); plain words, no dashes.

**Never:** a silent substitution of a missing model; a model catalogue or recommendation; the browser contacting a server.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Preset server | native API answers | size, parameters, context, tool support shown | n/a |
| Plain server | ids only | ids, "the server doesn't say", no cautions | n/a |
| Small context | below 16384 | caution naming the context | n/a |
| Chosen model dropped | server no longer lists it | marked missing, chat refused naming it | plain words, no other model used |
| Server down | nothing listening | "Not running" and no models | n/a |

</frozen-after-approval>

## Code Map

- `packages/adapters/src/local-model-openai/native.ts`, `port.ts` -- the preset servers' own readers.
- `packages/core/src/local-models.ts`, `local-model-port.ts`, `local-endpoints.ts` -- `models(id)`, the preset on the target.
- `packages/shared/src/local-endpoints.ts`, `api.ts` -- `modelCautions`, `modelDescription`, the models response and route.
- `packages/server/src/{local-endpoint-models-route,local-wiring,start-agents,app}.ts` -- the route, the missing-model refusal, the picker's list.
- `packages/web/src/agents/local-endpoint-models.tsx` -- the models list on the card.
- Tests: `packages/server/test/local-endpoint-models.test.ts`, `packages/adapters/test/local-model-port.test.ts`, `packages/core/test/local-models.test.ts`, `packages/web/test/local-endpoints.dom.test.tsx`, `tests/e2e/local-endpoints.spec.ts`.

## Tasks & Acceptance

- [x] adapters: Ollama's and LM Studio's native readers (tolerant, only what is reported)
- [x] core and server: `models(id)`, the route, the picker's list, the missing-model refusal
- [x] web: models list with cautions and Use for new chats
- [x] card notes on hardware and tool calling

**Acceptance Criteria:**
- Given the fake server, then the models of both server kinds are listed, one is chosen for the project through the picker and another for a chat, the chosen model is removed from the server and the missing state names it with its reason, and a model below the floor shows the small-context caution.

## Implementation Notes

The picker's model ids are the harness's (`ogden/<id>`); the server writes the default endpoint's list into the agent's last-model list whenever the models are read, and the harness's own list at each chat start keeps it current. The per-project default and per-chat switch are story 11's. A model the harness refuses at switch time still falls back to the agent's default with core's existing plain reason (core cannot hold a chat back for an agent), so the strict never-swap rule is enforced at chat start (the chosen model of the endpoint) and shown on the card; a project default that the server later drops falls back with that reason, named, never silently. The real servers' native API shapes are read from their documentation and are live checks.

## Plan Change Log

## Review Triage Log

## Verification

**Commands:** `pnpm typecheck`, `pnpm test`, `pnpm e2e` for the touched specs, `PROVENANCE_BASE=origin/main pnpm provenance`.
