---
title: 'Refactor sweep (epic 14)'
type: 'refactor'
ticket: '14.10'
created: '2026-10-05'
status: 'in-review'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick-security', 'quick-correctness']
review_loop_iteration: 0
baseline_revision: 'c4bdea945d69d9bfe73d28d82956511dd73c77d8'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-local-models/epic-local-models.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 14's stories were built one by one. Before the end to end story, the whole epic's diff needs a pass for duplication, dead code and boundary leaks, and what Codex, Grok, Antigravity and the Local model now share belongs in a shared place.

**Approach:** Move the pinned archive helpers (resumable verified download, the zip and tar.gz unpackers, the one unsafe archive error) out of Antigravity's adapter folder into `adapters/src/archive/`, so the Local model no longer imports from another agent's adapter; one JSON body helper in the endpoint routes; the shared error code reader in the OpenAI-compatible calls; `start.ts` back under 600 lines. Check the architecture tests (core, shared, acp-base and the web name no Ollama, LM Studio or OpenCode; the web names no agent), file sizes and the deferred items the epic indexed; each finding is fixed or recorded.

## Boundaries & Constraints

**Always:** no behaviour change; the full unit, architecture and integration suites pass.

**Never:** moving a security check out of the extractors; widening any permission.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Antigravity install, Local install | fixture archives | unchanged | n/a |
| Every shared export | `@ogden-agents/adapters` | still exported | n/a |

</frozen-after-approval>

## Code Map

- `packages/adapters/src/archive/{download,unzip,untar}.ts` -- moved here, with one `PinnedFile` shape.
- `packages/server/src/{local-endpoint-routes,start,start-agents}.ts`, `packages/adapters/src/local-model-openai/http.ts` -- the small clean ups.

## Tasks & Acceptance

- [x] shared archive helpers; no adapter imports another agent's adapter for them
- [x] route body helper, error code helper, `start.ts` under 600 lines
- [x] whole epic review for duplication, dead code and boundary leaks

**Acceptance Criteria:**
- Given the full suites, they pass on all three OSes; each sweep finding is fixed or recorded below.

## Implementation Notes

Dispositions of the epic's open items (all recorded in deferred-work.md, owner 14.10 or 14.11): launch time re-hash of the installed binary (open: costs one to two seconds per start and the data folder is owner only; decide with the user's live checks), the harness's tool permissions by name and not by a wildcard (open: a live check on 1.18.34), the key visible to an approved env command (mitigated: the Add form's key note now says a command you approved could print it; the harness's own database is the rest), test-hooks.ts length (open: the hook audit needs one file), CI unpacking the real archives (open), keychain and database not atomic (open), events.ts length and shared's DOM lib (open), the harness's own redirect behaviour (live check), the real harness's `.opencode/skills` (live check).

## Plan Change Log

## Review Triage Log

## Verification

**Commands:** `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm run pack && pnpm smoke`, `PROVENANCE_BASE=origin/main pnpm provenance`.

## Review triage log (whole epic sweep)

Fixed: B1 (a key must be 4 characters or more, so masking always hides it), A8 (vendor wording), A9 (orphaned comment), A10 (pointless wrapper).
Deferred to the next refactor pass, no behaviour risk, recorded as one item in deferred-work.md: A1 (move harness preparation from server local-wiring into acp-opencode), A2 (LocalModels closures, repeated unreachable throws), A3 (shared route helpers), A4 and A5 (install support shared with Antigravity, one pin type), A6 (listIds via probeEndpoint, one StructuredMode), A7 (one failure words table), A11 (one JSON init in web api), A12 (unused exports), A13 (move archive tests), A14 (shared test helpers), A15 (fake-opencode as a personality or recorded divergence).
Clean: archive move is byte identical in every check; no other secret leak found; no new file over 600 lines.
