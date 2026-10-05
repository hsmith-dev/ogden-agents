---
ticket: bug-a-queued-message-is-not-sent-after-the-agents-turn-ends.md
status: in-progress
assignee: claude
---

# Plan: a queued message is not sent after the agent's turn ends

## Approach

1. Reproduce in core with the scripted agent: queue a message, end the turn every realistic way
   (end_turn, max_tokens, refusal, max_turn_requests, agent-side cancelled; idle reported before
   the prompt resolves; a permission card the agent abandoned when its turn ended; a Deny reason
   plus a queue), assert each queued message is sent exactly once, in order.
2. Reproduce end to end with the fake ACP agent where core alone cannot show it.
3. Fix at the lowest affected base (origin/main, 0.4.0); check story/send-now-or-wait (#103).
4. Verify: pnpm typecheck, pnpm test, pnpm e2e, pnpm run pack && pnpm smoke. Draft PR to main.

## Progress

- [x] Branch fix/queued-message-drain from origin/main (a6e6c12)
- [ ] Ticket written
- [ ] Failing tests
- [ ] Fix
- [ ] Review and triage
- [ ] Verification
- [ ] PR and CI
