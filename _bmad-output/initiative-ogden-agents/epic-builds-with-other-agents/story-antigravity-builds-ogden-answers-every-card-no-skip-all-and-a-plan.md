---
title: 'Antigravity builds: Ogden answers every card, no Skip all, and a sandbox or attended only'
type: 'feature'
ticket: '7'
created: '2026-10-06'
status: 'built'
baseline_revision: 'b08ca6ec228001a021999a6c6a9aa05737687a75'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['security', 'correctness']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-builds-with-other-agents/epic-builds-with-other-agents.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The user decided (2026-10-06) that Antigravity builds attended only: unattended is no-go (no sandbox recorded), Ogden never selects or starts Skip all (`yolo`) or `auto_edit` (it approves protected files), and its Gemini API key route is the only parked candidate for a later unattended path.

**Approach:** Antigravity takes no sandbox through a build start, so the fail closed refuses an unattended build. This entry says why in its own plain words, and proves with explicit tests that no mode that approves for you is ever asked for (even when the agent starts in one), every request is a card at the ask level that no rule allows, and the person cannot switch a build session into Skip all.

## Boundaries & Constraints

**Always:** An unattended Antigravity build is refused (`sandbox_unavailable`, its reason, attended offered). An attended build keeps Ask (`default`); an agent that opens in `auto_edit` or `yolo` is put back (core tells Ask) before any prompt; its protected-file write is a card. Its Google sign-in or Gemini API key is as chat keeps them. New copy has no dashes.

**Never:** No `yolo`, no `auto_edit`, no unattended path. The account terms question stays the user's (spike, Notes).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Attended build | Ask | three cards (inside, outside, protected), none auto-answered, no mode asked for | — |
| Starts in auto_edit | fake agent opens in it | one set_mode to `default`, never auto_edit or yolo | — |
| Switch to Skip all | the person asks | refused, the session stays Ask | — |
| Unattended | any sandbox | 409 `sandbox_unavailable` with its reason | nothing written |

</frozen-after-approval>

## Code Map

- `packages/adapters/src/acp-antigravity/antigravity-agent.ts` -- `ANTIGRAVITY_ATTENDED_ONLY_REASON`.
- `tests/fixtures/fake-acp-agent.mjs` -- `FAKE_ACP_MODE_LOG` (every mode id the client asked for).
- `packages/server/test/build-conformance.test.ts`, `packages/adapters/test/acp-antigravity.test.ts` -- the proofs.

## Tasks & Acceptance

**Execution:**
- [x] Its reason; the mode log in the fake; the explicit tests.

**Acceptance Criteria:**
- Given an attended Antigravity build, when it runs (even from an agent that opens in auto_edit), then no yolo or auto_edit is ever asked for and each request is a card.

## Implementation Notes

Interpretation (Notes, 2026-10-06): "Ogden answers every card" means no agent switch approves anything for the person; in an attended build every request is a card the person answers at the Ask level, and no rule answers one. Live checks (the user's, entry 11): the exact permission options and tool names for an edit and a command; whether any option gives its commands a sandbox; the terms question for unattended use.

## Review Triage Log

One combined security and correctness review (an independent agent), loop 1; no blocker, the product code is sound (an attended build cannot send yolo or auto_edit through core; the auto_edit start is told Ask before the first prompt, not racy). Fixed: the switch to Skip all test now asserts 409 `session_busy` (it proves builds are read only for everyone, said so); the first test asserts the mode log is empty (it opened in Ask); the adapter refusal asserts its message.
