---
title: "A queued message is not sent after the agent's turn ends"
type: 'bugfix'
ticket: '16'
created: '2026-10-04'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'auto'
lenses_ran: ['correctness-races']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A message queued while the agent works is dropped ("Not sent") when the agent ends its turn with a permission card still open. Real Claude Code (claude-agent-acp 0.84) withdraws a card's request with `$/cancel_request` whenever its SDK aborts a tool call, and does not wait for the answer; Ogden ignores the withdrawal, so the session is still `waiting` when the turn ends, and core's drive loop stops there and drops the queue.

**Approach:** When a turn has ended, a card still open is one the agent stopped waiting for: core declines it as cancelled (by leaving `waiting`, which Permissions already treats as a cancel) and goes on with the queue. Stop, failures and close keep leaving the queue unsent.

## Boundaries & Constraints

**Always:** a leftover card is resolved `cancelled`, never allowed; each queued message is sent exactly once, oldest first; Deny reasons still go before the queue; no `idle` between a turn and the queued one that follows.

**Never:** no change to the agent port or adapters (closing the card at the moment the agent withdraws it is a follow-up); no change to Stop, failure or close behaviour; no new UI.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Stop reasons | queue of 2; turn ends end_turn / max_tokens / max_turn_requests / refusal / cancelled (agent-side) | both sent in order, session ends idle | none |
| idle timing | idle before the prompt's answer (with a gap), never, or twice | queue sent once | none |
| late send | message sent after idle, before the prompt's answer | sent once | none |
| leftover card | card open (agent withdrew it), queue of 1, turn ends | card resolved cancelled; queued sent; ends idle | none |
| Stop | queue of 1, Stop | not sent ("Not sent") | unchanged |

</frozen-after-approval>

## Code Map

- `packages/core/src/chat/turns.ts` -- `drive`: after a turn, takes the next message; the `waiting` break is the defect
- `packages/core/src/permissions.ts` -- cancels a session's pending requests when it leaves `waiting` other than by a decision
- `packages/core/test/queue-drain.test.ts` -- the turn-end matrix (new)
- `tests/fixtures/fake-acp-agent.mjs` -- `permission-abandon <file>`: asks, then withdraws the request and ends the turn (new)
- `tests/e2e/session-behaviour.spec.ts` -- end-to-end reproduction through the real adapter

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/test/queue-drain.test.ts` -- matrix above -- fails only on the leftover card
- [x] `tests/fixtures/fake-acp-agent.mjs`, `tests/e2e/session-behaviour.spec.ts` -- reproduce with the real adapter -- fails on main
- [x] `packages/core/src/chat/turns.ts` -- in `drive`, a session still `waiting` once its turn ended leaves `waiting` for `working` (cancelling the leftover cards) before the next message is completed, instead of breaking -- the turn is over, the card is stale
- [x] `packages/core/test/chat.test.ts` -- no test pinned the old break; nothing to adjust

**Acceptance Criteria:**
- Given the ticket's criteria 1–4, when the suites run, then the new tests pass and the existing Stop/failure/close tests still pass

## Implementation Notes

- Root cause confirmed in claude-agent-acp 0.84 (`requestPermissionFromClient`): a tool call's permission request carries the SDK's abort signal as a `cancellationSignal`; on abort it sends `$/cancel_request` and races locally, so Claude goes on and ends its turn whatever the client does. acp-base / the 0.4.0 adapter ignore the withdrawal, so the session is still `waiting` at turn end.
- Where it starts: story 2.10 part A (424a1bc), carried through 3.11's split into `chat/turns.ts`; on main (0.4.0), the 6.x chain and story/send-now-or-wait alike.
- Every stop reason already drained (core never reads `stopReason`); only the leftover-card ending failed.
- Fix: one line in `drive` — leave `waiting` for `working` (Permissions cancels the leftover cards) instead of breaking.

## Plan Change Log

## Review Triage Log

- Pass 1 (correctness and races, one subagent): high 0, medium 0, low 5.
  - low, patched: assert a late `decide()` on the cancelled card is refused (`PermissionNotPendingError`); add a Deny reason plus leftover card case.
  - low, dismissed: `armQuiet` re-armed after the cancelled answer — harmless, the new turn re-arms anyway.
  - low, dismissed: the stop-reason variants share one core path — kept as cheap regression cover for the reported endings.
  - low, dismissed: e2e does not read the card's "cancelled" record line — the core test asserts `by: cancelled`.
  - low, dismissed: fixture misses a Stop between its two waits — no test sends one there.

## Verification

**Commands:**
- `pnpm typecheck` -- clean
- `pnpm test` -- all pass
- `pnpm e2e` -- all pass
- `pnpm run pack && pnpm smoke` -- passes
