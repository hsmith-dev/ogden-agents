---
title: 'Session view completes, part A: session behaviour'
type: 'feature'
ticket: '10'
created: '2026-09-30'
status: 'built'
baseline_revision: '7b2d8795a2e441d31ac30a44804ee5f0b17c57aa'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-permission-cards-plan.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A second message gets a 409, a recorded Deny reason never reaches the agent, a silent agent looks hung with no way out, there are no tool-call rows and no Try again, and five deferred items sit in core and the Chats page: 2.2 per-chunk writes, 2.2 hung agent, 2.3 F7, 2.5 F6 and 2.7 F4.

**Approach:** Core adds a message queue, delivers Deny reasons after the turn, coalesces chunks, prunes tool calls, defers the reopen ref, checks in on a quiet agent, and gets a Stop route. The session view adds tool-call rows, Queued / Not sent, the quiet status, Stop, and the error notice with Try again.

## Boundaries & Constraints

**Always:**
- Session events go only through `sessionEvents` (E2-R7).
- Core never moves a `waiting` session to `working` except through `Permissions.decide`. Leaving `waiting` cancels pending requests (2.6), so the adapter's `state: working` is ignored while the session is `waiting`.
- The queue:
  - It is FIFO per session and in memory, holding at most `MAX_QUEUED_MESSAGES` (20; the next one gets 409 `session_busy`).
  - A queued message is appended `session.message_queued`, then `session.message_completed` (same `messageId`) when it is sent.
  - A Deny reason becomes the next message after the turn, ahead of the queue.
- Deltas are coalesced: at most one append per 50 ms per reply, flushed before any other event of the session and at turn end. The completed text is unchanged.
- A transcript reopen's adapter ref is saved only after its primed prompt succeeds (2.7 F4).
- The tool-call map is cleared when a turn ends (2.3 F7).
- Stop is available whenever the session is `working` or `waiting`. It never asks for confirmation, and `Esc` never stops.
- Tests use the fake agent and Windows-safe paths.

**Never:**
- An automatic timeout or error for a quiet agent.
- Sending the agent a prompt mid-turn.
- Show earlier, Jump to latest, the web store or protocol changes (2.10b).
- Sidebar, Needs you, tab title or global live regions (2.11).
- Caution levels (2.8), Sign in again (9.4; the notice only exposes `errorCode`).
- Edits to the adapter, `workspace-api.ts`, `status-sidebar.tsx`, `needs-you-group.tsx`, `sidebar-model.ts`, `live-announcer.tsx`, `app-shell.tsx` or `ui/sidebar.tsx`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|---|---|---|---|
| Queue | send while `working` | 202 `{queued:true}`; a "Queued" row; sent after `idle` | 21st → 409 |
| Deny reason | Deny with a reason mid-turn | after the turn: the user message `I denied "<command or title>": <reason>`, sent as the next prompt | no reason → nothing sent |
| Quiet, tool running | no agent event for 10 min while `working`; a tool call is `pending` or `in_progress` | `session.check_in {waitingOn: title}` → "Claude Code is waiting on <title>"; keeps waiting | — |
| Quiet, nothing running | same, no tool call in progress | `session.check_in {}` → "Claude Code has been quiet for 10 minutes" + Stop; still `working` | — |
| Process exits | adapter reports `fatal` | `error` with its reason + Try again | — |
| Stop | `POST …/cancel` while `working`/`waiting` | ACP cancel; pending cards cancelled; `idle` | not busy → 409; no end within 5 s → agent dropped, `idle` resumable |
| Error with a queue | turn ends in `error` | queued rows "Not sent"; the texts go back into the composer | — |
| Restart with a queue | queued, never sent | rows "Not sent" | — |
| First send fails | Chats page | retrying reuses the created chat | — |

## Decisions

- Ticket 2.10 is delivered in two parts (user, 2026-09-30): this part A, then 2.10b "History and streaming at scale", which goes after it. In the ticket folder this plan is `story-session-view-completes-part-a-session-behaviour-plan.md`.
- Hung agent (user, 2026-09-30): no automatic timeout or error. After 10 minutes with no agent event while `working` (never while `waiting`), core checks in. The agent is still live when its entry is live and no `fatal` exit was reported (the adapter already reports one). A tool call in progress shows "Claude Code is waiting on <tool title>" and keeps waiting. Nothing in progress shows "Claude Code has been quiet for 10 minutes" with Stop. Only an exited process goes to `error` with Try again. Stop is always available.
- Deny reason (user, 2026-09-30): a visible user message, `I denied "<command or title>": <reason>`.
- Queue after an error or a restart (user, 2026-09-30): queued messages are marked "Not sent", and their text goes back into the composer.

</frozen-after-approval>

## Code Map

- `packages/core/src/chat.ts`:
  - `apply` (:251): coalescing, the working guard, pruning at turn end, and resetting the quiet timer on every event.
  - `agentFor` (:318, :348): hold the ref while `prime`.
  - `onPermissionRequest` (:322): note a `deny` with a `reason`.
  - `runTurn` (:380): after the turn, send the reasons, then drain the queue.
  - `sendMessage` (:463): queue.
  - `close` (:488): the queue is dropped.
  - Add `cancel(ws, ses)` to `Chat`.
- `packages/core/src/permissions.ts:468` -- answer `{outcome:'deny', reason}` (the type is at `agent-port.ts:84`). A one-line edit to 2.8's file.
- `packages/core/src/agent-port.ts:136` -- `cancel()` exists. Do not change its shapes.
- `packages/shared/src/events.ts` -- add `session.check_in {sessionId, waitingOn?}` (session stream, schematized; AD-5). Leave the rest as it is.
- `packages/server/src/chat-routes.ts:81,139` -- the busy mapping; the `sessionCancel` stub.
- `packages/web/src/chat/transcript.ts` -- fold tool calls (grouped runs), queued and not-sent messages, the latest `check_in` (cleared by any later session event), and `errorCode`.
- `packages/web/src/routes/session-page.tsx` -- it still reads the merged events here; 2.10b switches it.
- `packages/web/src/appearance/appearance.ts` -- density, for grouping.
- `packages/web/src/routes/workspace-chats-page.tsx:111` -- 2.5 F6.
- `tests/fixtures/fake-acp-agent.mjs` -- `slow` exists. Add `tools` (reads 3 files, then edits 1 with a diff), `quiet-tool` and `quiet` (an in-progress tool, or nothing, then silence until cancelled). A test-only env var shortens the check-in delay.

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/chat.ts`, `permissions.ts` (one line), `shared/src/events.ts` (`session.check_in`) -- as in the Code Map. The check-in delay is a `ChatOptions` value (default 10 min).
- [x] `packages/server/src/chat-routes.ts` -- `POST cancel`: 204, 409 when not busy, 404 otherwise. The queue-full answer is 409.
- [x] `packages/web/src/chat/transcript.ts`, `chat/tool-call-row.tsx` (new), `routes/session-page.tsx`, `chat/chat-api.ts` (`cancelSession`) -- tool-call rows, Queued / Not sent, the quiet status line, a Stop button beside the composer while busy, and the error notice with Try again (it resends the last user message).
- [x] `packages/web/src/routes/workspace-chats-page.tsx` -- reuse the created chat on retry.
- [x] Tests:
  - `core/test/chat.test.ts`: queue order and cap, the reason before the queue, coalescing, the working guard, pruning, the deferred ref, and both check-ins (no error).
  - `server/test/cancel.test.ts`.
  - `web/test/transcript.test.ts`.
  - `tests/e2e/session-behaviour.spec.ts`: grouped rows, Queued then sent, `fail` then Try again, Stop on `quiet`.

**Acceptance Criteria:**
- Given a pending card, when the agent emits `working`, then the card stays pending.
- Given a quiet agent with a running tool call, when the check-in fires, then the session stays `working` and no error appears.

## Implementation Notes

- Core keeps a per-session `Turn` (queue, Deny reasons, quiet and Stop timers) from the first message until nothing is left to send. When the adapter reports `idle` with a reason or a queued message waiting, the session stays `working` and the next one goes straight out, so queued rows never flash "Not sent". The web marks a queued message "Not sent" when a `session.state_changed` to `idle` or `error` arrives while it is still queued; no new event type was needed for it.
- Stop drops the queued messages (they show "Not sent" and their text goes back into the composer); a message sent after the Stop is still sent. Stop also drops any pending Deny reason silently: it is not sent to the agent, and it stays visible on the resolved card. After a Stop, a permission request from the agent is declined at once, with no card, and recorded as cancelled. If the grace period passes with a message sent after the Stop waiting, the agent is dropped and that message goes next (the session stays `working`). Stop from `waiting` sets `idle` at once, which declines the pending cards through `Permissions`; from `working` the state waits for the agent to end its turn. After `STOP_GRACE_MS` (5 s) the agent is dropped and the session is `idle`, resumable.
- A prompt races the entry's `gone` promise, so a dropped or closed agent can never leave a turn hanging; every timer is `unref`ed and cleared on turn end, Stop, drop and close.
- Deltas: leading-edge throttle (the first chunk goes at once, then at most one delta per 50 ms), flushed before any other event of the session, before a permission request, and at turn end.
- The check-in fires once per quiet stretch; while `waiting` it re-arms instead, and a permission answer restarts the stretch.
- Additions outside the Code Map, each small: `QueueFullError` and `SessionNotBusyError` in core `errors.ts`; the API error code `session_not_busy` (409 for Stop with nothing running) in shared `errors.ts`; `StartOptions.checkInDelayMs` plus the test-only `OGDEN_AGENTS_TEST_CHECK_IN_MS` in `start.ts`; `composer.tsx` gains `hint`, `action` (Stop) and `restore`; the `sessionCancel` doc in `api.ts` now says 204/409. Existing tests updated for the new behaviour: the 409-on-second-message tests now expect a queue, per-chunk delta counts now check the joined text, and the Deny-with-reason tests expect the follow-up message.
- 2.5 F6: the empty Chats list keeps its composer while the only chat is the one a failed first send created, and a retry reuses it.

## Plan Change Log

- 2026-09-30 (epic 2 retrospective, action A4): `ticket:` changed from '2.10' (the global ref, which `tickets.py` can't join) to the epic-local entry id `'10'` from `tickets.toml`. `baseline_revision` backfilled with `7b2d879`, the parent of the story's first commit `424a1bc` (story 2.10); it wasn't recorded when the build started. This plan is the plan of record for entry 10; part B's plan (`story-session-view-completes-part-b-history-and-streaming-plan.md`) now carries `part_of_ticket: '10'`, since `tickets.py` allows one plan per ticket.

## Review Triage Log

- F1 (medium, fixed): the Stop grace timer set `idle` even with messages queued after the Stop, so they flashed "Not sent" and were then sent. It now leaves the session `working` for them. Test: core "review F1".
- F2 (medium, fixed): after a Stop, a permission request still showed a card. It is now declined at once (`cancelled`) and recorded as `permission.requested` plus `resolved by:cancelled`. Test: core "review F2".
- F3 (fixed): a late `tool_call_update` with no title or kind could blank a row. The web keeps the known title and kind and makes no row for an unknown call; core ignores updates for calls the turn never reported. Tests: core and web "review F3".
- F4 (fixed): the check-in delay (from `StartOptions` or `OGDEN_AGENTS_TEST_CHECK_IN_MS`) is clamped to 1 s .. 2^31-1 ms (`clampCheckInDelay`, in core and in `start.ts`). Tests: core "review F4", server `cancel.test.ts`.
- F5 (fixed): the Deny-reason message quotes at most 200 characters of the command or title, ending in an ellipsis (`deniedMessage`). Test: core "review F5".
- F6 (fixed): Implementation Notes reworded: Stop drops pending Deny reasons silently; they stay visible on the resolved card.
- Pre-existing (fixed; 2.10a owns error states): a non-fatal adapter `error` followed by the prompt resolving overwrote `error` with `idle`, hiding Try again. A turn that recorded an `error` now keeps it. Test: core "keeps error (and so Try again)…".

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test` -- expected: all pass.
- `pnpm build && pnpm e2e` -- expected: all pass, including `permissions.spec.ts`.

**Manual checks:**
- Live with `pnpm dev:chat`: a multi-file change groups its rows in Comfortable and lists them in Compact; the edit expands to its hunk. Deny with a reason, and the next turn quotes it.
