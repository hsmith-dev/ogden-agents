---
id: 16
type: bug
title: "A queued message is not sent after the agent's turn ends"
parent: none
covers: []
after: []
assignee: ""
refined: true
hitl: false
risk: medium
severity: P1
estimate: ""
---

# A queued message is not sent after the agent's turn ends

## Description

The user sends a message while Claude Code is working, and Ogden queues it ("Queued", story 2.10). The agent's turn then ends and its final reply shows, but the queued message is never sent: it goes "Not sent" and back to the composer, as if the user had pressed Stop. A queued message must be sent once the turn ends, however the turn ends; only Stop (or a failed turn, or a restart) leaves it unsent.

## Reproduction

Reported 2026-10-04 on story/6.9-epic6-sweep (PR #87) with real Claude Code; reproduced on main (0.4.0, a6e6c12) with the fake ACP agent.

1. Start a chat and send a message that makes the agent work for a while.
2. While it works, send a second message. It shows "Queued".
3. The agent asks permission for a tool call (a card shows), then withdraws that request itself without waiting for an answer (`$/cancel_request`), as claude-agent-acp 0.84 does whenever its SDK aborts a tool call. The card stays on screen and the session stays `waiting`.
4. The agent goes on and ends its turn with its final reply.
5. Actual: the queued message is "Not sent" and its text goes back to the composer; nothing is sent to the agent. Expected: the queued message is sent as the next turn, and the leftover card is closed as cancelled.

## Cause Hypothesis

When a turn ends, core takes the next queued message and, if the session still reads `waiting`, stops there: a leftover card was meant never to be answered by moving on. But a card still up when the agent has ended its turn is one the agent stopped waiting for. The queue is dropped instead of the card. Ogden does not act on the agent withdrawing a permission request, so with real Claude Code the session can be `waiting` when its turn ends.

## Acceptance Criteria

1. **A queued message is sent however the turn ends**
   **Given** a message queued while the agent works
   **When** the turn ends with any stop reason (`end_turn`, `max_tokens`, `max_turn_requests`, `refusal`, or `cancelled` without a Stop), with `idle` reported before the prompt's answer, not at all, or twice
   **Then** each queued message is sent exactly once, oldest first, and the session ends `idle`
2. **A card the agent left open does not hold the queue**
   **Given** a message queued while the agent works, and a permission card the agent withdrew
   **When** the agent ends its turn
   **Then** the leftover card is resolved as cancelled (never allowed), and the queued message is sent
3. **Stop and failures are unchanged**
   **Given** a message queued while the agent works
   **When** the user presses Stop, or the turn fails
   **Then** the queued message is not sent and shows "Not sent", as before
4. **Tests cover the condition found and fixed**
   **Given** the core and end-to-end suites
   **When** they run
   **Then** a core test for each turn ending in 1 and 2, and an end-to-end test where the fake ACP agent withdraws its card and ends its turn, fail on the defect and pass on the fix
5. **Or: no change is needed, with proof**
   **Given** the reproduction
   **When** it is run on the current code
   **Then** the queued message is already sent, with the evidence recorded in Notes — this supersedes 1 to 4

## References

- parent — none
- story 2.10a session behaviour (queue, Stop, "Not sent") — `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/`
- user report, 2026-10-04 (verbatim): "I am testing an old version I believe, but the old version needs to make sure that when a queued message needs to be sent, it gets to sent because now i have the final response"

## Notes

- Assumption: id 16, the next id not used by any backlog ticket on the open branches.
- Assumption: a failed turn still leaves the queue unsent (2.10 design: an error offers Try again); only the endings in criterion 1 are in scope.
- Open question: Ogden ignores the agent withdrawing a permission request mid-turn, so the card stays up (and the session `waiting`) while the agent keeps working, until the turn ends. Closing the card at once needs the agent port to carry the withdrawal; a follow-up, not this bug.
- Open question: claude-agent-acp 0.84 holds a turn open while background subagents it spawned still run (`deferredSettle`), after the main reply has streamed. The queue then waits for those subagents, by design: the turn has not ended.
