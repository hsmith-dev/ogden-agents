---
title: 'Refactor sweep (epic 12)'
type: 'chore'
ticket: '10'
created: '2026-10-05'
status: 'in-review'
route: 'oneshot'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
baseline_revision: 'e6f204740cb87ea59ffbff0f234e9dac2d2bb018'
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Entry 10 cleans up code across epic 12 (Codex and Grok built; the spikes' probe was removed with the spikes) with no behaviour change, runs the provenance check, keeps the deferred-work Open items index current and splits any file the epic grew past 600 lines.

**Approach:** Scope from the build records and review findings of 12.3 to 12.9 and 12.11 (Codex and Grok parts).

</frozen-after-approval>

## Acceptance

- `agent-setup.ts` is back under 600 lines (the epic took it to 602): the keychain words for an API key only agent moved to `agent-setup-status.ts`.
- Codex's and Grok's free key checks share one `bearerKeyVerify` (the same fetch, timeout, no redirect, discarded body and diagnostics; only the provider, URL and refused statuses differ), instead of two copies.
- All tests pass and no behaviour changes; `PROVENANCE_BASE=origin/main pnpm provenance` passes; the spike probe (`scripts/acp-agent-probe.mjs`, `scripts/acp-probe-pins/`, `.github/workflows/acp-agent-probe.yml`) is not in the tree.

## Implementation Notes

Built 2026-10-05 on `story/12.10-epic12-sweep` from `main` after 12.8. Looked at and left alone: `acp-agent.ts` (763 lines, already past 600 before the epic: 762 at 12.3; its split is epic 6's sweep's open item), `start.ts` (under 600), the two wiring files (`codex-wiring.ts`, `grok-wiring.ts`: small and deliberately in each agent's own slot), and the two agents' `installedX` functions (same shape, different folder layouts; a generic version would need a third spec field). The Open items index was read against the Log: every epic 12 line is still open and its phrase exists.

## Review Triage Log

A behaviour-preserving refactor covered by the existing Codex, Grok and agent-setup tests (unchanged). One quick lens: no finding.

## Verification

**Commands:** `pnpm typecheck`, `pnpm test`, `PROVENANCE_BASE=origin/main pnpm provenance`, then CI.
