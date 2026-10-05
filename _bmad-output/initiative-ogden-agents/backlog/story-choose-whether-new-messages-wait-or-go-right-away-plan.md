---
title: 'Choose whether new messages wait or go right away'
type: 'feature'
ticket: '17'
created: '2026-10-04'
status: 'built'
baseline_revision: '2e4d68f8befaae014c336abffc3e7f5b1fc7d984'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'races-ux']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/backlog/story-choose-whether-new-messages-wait-or-go-right-away.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A message sent while the agent works always waits for the turn to end (2.10). Sometimes it is important and should reach the agent now, as Claude Code's CLI does mid-turn (user, 2026-10-04).

**Approach:** A "while the agent is working" setting (`wait` | `now`) app-wide and per project (project wins; default `wait`), a per-message override in the composer, and a core `delivery` on send. `now` injects into the running turn when the agent declares and advertises it (Claude Code `_session/steering`), else cancels the turn (`session/cancel`) and sends the message next with a note. Waiting messages become a list the user edits, reorders, removes, or sends now.

## Boundaries & Constraints

**Always:**
- Ticket criteria 1–9 are the bar. `delivery` absent = `wait` (old clients unchanged).
- Descriptor `sendNow: 'inject' | 'interrupt'`; inject only when `sendNow === 'inject'` and `initialize` `_meta.steering.supported === true`; steering requests carry `_meta.steering.idleBehavior: 'promptRequired'` so the adapter never starts a detached turn.
- Interrupt never drops queued messages: the message goes to the queue front; the others stay after it. Appends `session.turn_interrupted` (shown "Stopped the current step to send your message.").
- A pending permission card (`waiting`) refuses `now` (409 `answer_first`, "Answer the request above first, then send your message."), no event. Terminal or switching chats refuse as today.
- Queue edits are events (`session.queue_changed`, full snapshot); a message no longer queued → 409 `message_not_queued`, nothing changed.
- New event types and fields are optional additions (AD-5); old logs replay unchanged.
- Tests use fake agents only; any new hook via `testHooksAllowed`.

**Never:** auto-deny a permission card; change Stop, "Not sent" restore, Deny reasons, check-in, card, terminal handoff, draft handling; bump agent pins.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error |
|---|---|---|---|
| Wait | working, `wait` | queued as today | queue full 409 |
| Inject | working, Claude Code | reply so far closed; `message_completed` (`delivery: 'injected'`); turn goes on | steer fails → interrupt |
| Steer finds no turn | turn just ended | message goes to queue front, sent next | — |
| Interrupt | working, Antigravity | `turn_interrupted`, cancel, message sent next, others kept | agent ignores cancel → dropped after grace, message still sent |
| Card pending | `waiting`, `now` | 409 `answer_first` | no event |
| Idle | `now` or `wait` | sent at once | — |
| Already stopping | Stop pressed, `now` | queued at front, no note | — |
| Queue edit/move/remove/send now | id in queue | snapshot event | id gone → 409 |

</frozen-after-approval>

## Code Map

- `packages/core/src/chat/turns.ts` -- `sendMessage`, `cancel`, `drive`, `takeNext`, `Turn.queue`: add delivery, inject/interrupt, queue ops; reuse `finishReply`, cancel's stop-timer path (it already keeps going when the queue is non-empty).
- `packages/core/src/chat/types.ts` -- `Chat` interface, `Turn`; `constants.ts` MAX_QUEUED_MESSAGES.
- `packages/core/src/agent-port.ts` -- `AgentSession.steer?(text): Promise<'injected'|'no_turn'>`.
- `packages/core/src/agent-descriptor.ts` -- `sendNow` field + validation.
- `packages/adapters/src/acp-base/acp-agent.ts` (568/600 lines) -- `steer` via `connection.agent.request('_session/steering', …)`; keep it short.
- `packages/adapters/src/setup-claude-code/descriptor.ts`, `setup-antigravity/descriptor.ts` -- `sendNow`.
- `packages/shared/src/events-session.ts` -- `session.turn_interrupted`, `session.queue_changed`, `delivery` on `message_completed`; `events.ts` union + `workspace.settings_changed` `whileWorking`; `events-settings.ts` `settings.while_working_changed`.
- `packages/shared/src/chat.ts`, `api.ts`, `errors.ts` -- request/response schemas, routes, codes.
- `packages/core/src/db/schema.ts` + `packages/core/drizzle/0012_while_working.sql` (+ meta journal) -- `install_settings.while_working`, `workspaces.while_working`.
- `packages/core/src/install-settings.ts`, `workspace-settings.ts` -- read/write + events.
- `packages/server/src/chat-routes.ts`, `settings-routes.ts` -- routes, refusals.
- `packages/web/src/chat/composer.tsx`, `routes/session-page.tsx`, `chat/transcript.ts`, `chat/transcript-parts.tsx` -- menu, shortcut, queue list, interrupt note.
- `packages/web/src/routes/agents-settings-page.tsx`, `workspace-settings-page.tsx`, `workspaces/workspace-settings-api.ts` -- settings UI.
- `tests/fixtures/fake-acp-agent.mjs` -- advertise and answer `_session/steering` (claude personality); antigravity none.

## Tasks & Acceptance

**Execution:**
- [ ] shared schemas, events, routes, errors -- contract first
- [ ] migration, install and workspace settings + events -- storage
- [ ] descriptor `sendNow`, port `steer`, acp-base steer, fake agent steering -- agent layer
- [ ] core turns: delivery, inject, interrupt, answer_first, queue ops -- behaviour
- [ ] server routes -- API
- [ ] web: settings sections, composer menu + Cmd/Ctrl+Enter + tooltip, queue list, interrupt note -- UI
- [ ] tests: core unit (inject, fallback, interrupt keeps queue, races), adapter steer with fake, routes, transcript reducer, composer, one e2e -- proof
- [ ] docs: EXPERIENCE.md Composer, agent matrix, architecture memlog (AD-5 additions)

**Acceptance Criteria:**
- Given an install with no setting changed, when the user sends while working, then behaviour equals 2.10.
- Given Claude Code mid-turn, when sent right away, then no `session/cancel` is sent and the steered text reaches the agent.

## Implementation Notes

- Implemented directly in this session (no implementation subagent: the session held the whole investigation; the user's brief asked for an autonomous run).
- Core: `chat/send-now.ts` (new) wraps `sendMessage` for `delivery: 'now'` and owns the queue edits; `turns.ts` `cancel` became `stop(sessionId, turn, { keepQueue })`, `runTurn` marks `turn.prompting`, and `drive` waits for `turn.steering` before taking the next message. Steer timeout `STEER_TIMEOUT_MS` (10 s) then interrupt.
- The reply so far is closed just before the steer goes (not on its answer): the agent's next output can arrive before the steer's answer, and must start a new reply. If it does, the user message can show just after that new reply's start (cosmetic, only when the agent answers before the ack).
- A card that appears while a steer is in flight: no interrupt (the message waits first in line), so no card is ever answered for the user. Stop during a steer: the message is dropped from the queue like every queued one ("Not sent", back to the composer) even if the agent took it.
- App setting lives in its own `chat_settings` table (not `install_settings`, whose row's existence means Developer mode was ever set). Migration 0012.
- Fake agent: `_session/steering` (advertised unless Antigravity or generic personality); it answers before going on, as the real adapter does.
- UI: the menu trigger is named "Choose when it goes" so the Send button stays the only control named Send. The hint names the shortcut (`⌘ Enter` on Apple, else `Ctrl+Enter`). Docs: EXPERIENCE.md Composer, agent matrix (Send now or wait), architecture memlog (AD-5/AD-1 notes).
- CHANGELOG not touched (sibling stories edit it; the release owner writes the entry).

## Plan Change Log

## Review Triage Log

Pass 1 (lenses quick, races-ux): high 3, medium 9, low 6, false 0. All patch unless noted.
| Finding | Verdict | Route | Evidence / action |
|---|---|---|---|
| Stop during an interrupt ignored, queue still sent (both lenses) | high | patch | `stop` returned on `stopping`; now a Stop always clears queue and reasons and declines a card. Test added. |
| Steer timeout then interrupt can deliver twice (both) | high | patch | steering request can't be withdrawn; an unanswered steer now leaves the message first in line, no stop. Test changed. |
| Stop during an in-flight steer that was injected: shown Not sent though delivered | high | patch | `injected` is now always recorded; the transcript turns that Not sent into sent. Tests added. |
| No re-check after awaiting the agent before steering | medium | patch | guard on stopping, failed, still queued. |
| Send now while the agent starts waits the whole turn (both) | medium | patch | `turn.whenPrompting` retries once the prompt is out. Test added. |
| Reply closed before steer splits a reply on fallback / misorders on inject (both) | medium | patch | reply now closed only once injected. |
| `queued()` refused edits during an interrupt with a false message (both) | medium | patch | no longer refuses on `stopping`. |
| UI froze every `now` message | medium | patch | only Send now is disabled for them; the server refuses one being sent. |
| Queue buttons share bare names | medium | patch | names carry the position ("Edit message 2"). |
| Focus lost after queue actions; no Escape | medium | patch | focus returns to the composer; Escape cancels the edit. |
| No announcements for queue changes or the interrupt | medium | patch | polite region in the list; the page announces the stop note. |
| Menu opened empty; focus not back to the field | low | patch | controlled open; focus back to the field. |
| Hint "send now" wording clash; no touch path | low | patch | reworded, names the menu. |
| Project option "Now:" | low | patch | "The app setting is …". |
| Test never proves no session/cancel | low | patch | fake counts cancels; route test asserts `cancels=0`. |
| Orphaned Turn doc comment | low | patch | moved back. |
| Menu name "Choose when it goes" vague | low | reject | a name without "send" keeps Send the only control named Send for assistive tech and tests. |
| Default `wait` before settings load | low | reject | only the first instant after opening; same result as today's behaviour. |
| Two send now with mixed outcomes; edit racing the drive loop; requests during an interrupt cancelled | medium | defer | deferred-work.md entries; the last recorded as a decision (it is Stop's cancel). |

Follow-up (coordinator decision, 2026-10-04): a request cancelled while the step stops for a message sent right away stays cancelled (Stop's rule), and the stop note now adds "A pending approval request was cancelled; the agent can ask again." Tests: transcript and DOM. Its deferred entry is removed.

## Design Notes

Inject: core records `message_queued` first (draft clears on 202), calls `steer` without awaiting in the route; `drive` awaits any in-flight steer before `takeNext`, so a `no_turn` answer puts the message at the queue front before the next pick. On `injected`: `finishReply`, then `completeMessage(delivery 'injected')`.
Interrupt: like `cancel` but keep `queue`; unshift the message; append `turn_interrupted`.

## Verification

**Commands:**
- `pnpm typecheck && pnpm test` -- green
- `pnpm e2e` -- green
- `pnpm run pack && pnpm smoke` -- green
