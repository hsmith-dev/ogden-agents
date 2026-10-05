---
title: 'OpenAI-compatible endpoints card in Settings, Agents: presets, Detect, key, confirmation, Test (epic 14)'
type: 'feature'
ticket: '14.4'
created: '2026-10-05'
status: 'in-review'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick-security', 'quick-correctness']
review_loop_iteration: 0
baseline_revision: '72344aff3fe8c76a5fdb7fb46ce4a140e5771a1a'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-local-models/epic-local-models.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A user has no way yet to set up the servers the Local model talks to. They need a list, one-click presets, Detect on this computer, an optional key, the per-endpoint confirmation for another host, and Test connection, all in plain words and without the browser ever contacting a server.

**Approach:** The server serves the presets (data from the Local model's adapter, so the web names no product), Test connection (through core, which refuses an unconfirmed host before calling) and Detect (loopback candidates only, 127.0.0.1 then localhost, short timeout, only on a POST). The Settings, Agents card for an agent that needs no account shows its servers instead of a sign in: the list with where messages go, Test connection with a plain state, the key (write-only, never shown again), the confirmation, Remove, and Add (presets, Detect results, any address).

**Decisions (user, 2026-10-05; epic Notes):** loopback needs no confirmation; another host needs a plain-language confirmation bound to the host with an http warning; Detect on localhost only, on a button press; presets for LM Studio and Ollama; links to their official download pages when none is found; only the server calls out.

## Boundaries & Constraints

**Always:** the page calls only Ogden Agents' own API; Detect probes only loopback, only when pressed; a key is sent once and cleared; copy is plain with no dashes; web code names no server product or harness (E14-R1).

**Never:** a request from the browser to an endpoint; a scan of any other host; installing or starting a server for the user; showing a saved key.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Detect, server on its port | fake on the preset's port | "Found X on this computer, with N models", Use it | n/a |
| Detect, nothing | nothing listening | "No server found on this computer", download links | n/a |
| Loopback add | localhost address | added, no confirmation, no key | n/a |
| Another host | non-loopback address | shows where messages go (and the http warning), Add waits for the checkbox | 409 without `confirmHost` |
| Test, unconfirmed host | host changed | 409, nothing called, card asks to confirm | plain words |
| Test states | up / no models / down / key wrong | Ready N models / Running but no model / Not running / didn't accept the key | n/a |

</frozen-after-approval>

## Code Map

- `packages/shared/src/{local-endpoints,api}.ts` -- preset, test and detect contracts, `endpointStateWords`.
- `packages/core/src/local-models.ts` -- Test connection and Detect over `LocalEndpoints` and the port.
- `packages/adapters/src/local-model-openai/presets.ts` -- the presets and the short Detect timeout.
- `packages/server/src/{local-endpoint-use-routes,app,start,start-agents,start-types}.ts` -- the routes and wiring.
- `packages/web/src/agents/{local-endpoints,local-endpoint-form,local-endpoints-api,agent-card}.tsx` -- the card section.
- Tests: `packages/core/test/local-models.test.ts`, `packages/server/test/local-endpoint-use.test.ts`, `packages/web/test/local-endpoints.dom.test.tsx`, `tests/e2e/local-endpoints.spec.ts`.

## Tasks & Acceptance

- [x] server: presets, Test connection, Detect
- [x] web: servers section, form, API hooks
- [x] tests: unit, dom, browser (request log: no foreign request)

**Acceptance Criteria:**
- Given the fake server on a preset port, when Detect is pressed, then the card shows it ready; with nothing listening it shows not running with the download links.
- Given a loopback address, then no confirmation and no key are needed; given another host, it is refused until confirmed, shows the http warning where it applies and asks again when the host changes.
- Given a key, then it is saved to the secret store, not returned by any route and not shown again; the browser makes no request to any endpoint.

## Implementation Notes

Stacked on 14.3. The card section shows for any agent whose status says `noAccount`. Per-model and per-project choices are 14.5; the shipped flag stays off until 14.6. Changing an endpoint's address in the UI is not offered here (Remove and add again); the API supports it (a changed host drops the key and the confirmation).

## Plan Change Log

## Review Triage Log

Security and correctness reviewers (2 lenses), no critical findings. Patched: a preset's download link now must be https (medium, a javascript: or file: link passed \`z.url()\`); Detect is one at a time (low); the typed key, confirmation and Detect result are cleared on Cancel (medium); the Ready count is not cut at 500 (low); the key refused words no longer assume a saved key (low); the unused duplicate Detect timeout is gone (low); a stale test result is cleared when the key or confirmation changes, and a failed action reads the list again so a stale confirmation row appears (medium); the test result is a live region that is always on the page (low); long hosts wrap (low); the form and section errors have their own test ids (low); the vacuous key assertions were replaced by one that can fail (medium). Not changed: Detect download links need the presets request to succeed (low), the closed-port fixture can be taken by another process (low), Test and chat use separate port instances so a disagreement is possible later (low, one adapter today). No intent_gap or bad_plan.

## Verification

**Commands:** `pnpm typecheck`, `pnpm test`, `pnpm e2e` for the touched specs, `PROVENANCE_BASE=origin/main pnpm provenance`.
