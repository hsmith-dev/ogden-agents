---
title: 'Chats persist and resume after a restart'
type: 'feature'
ticket: '2.7'
created: '2026-09-30'
status: 'built'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/spec-ogden-agents/agent-matrix.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After a restart, or after an agent crash, the next message starts a fresh agent session, so the chat loses its context. The ACP session id is never stored (AD-9), so there is nothing to resume.

**Approach:**
- Store the agent's session id as an adapter ref.
- When a session has a ref but no live agent, core calls `AgentPort.reopenSession`. The adapter tries `session/resume`, then `session/load`, then `session/new`.
- When the result is `new`, core primes the first prompt with the stored transcript.
- Every reopen appends `session.resumed {via}`, and the transcript shows the break.
- This includes the 2.3 review's F3: after a failed resume, try load and log the error code.

## Boundaries & Constraints

**Always:**
- The ref is stored as `adapterRefs.agentSessionId` (AD-9). It is never a key, never in a URL and never in an event payload.
- Reopening is lazy, on the next message, so a server start spawns no agents. AD-3's start-time settling already exists: `start.ts:334` calls `settleInterruptedSessions`.
- The transcript used for priming is the session's own `session.message_completed` text only, capped at `MAX_PRIME_CHARS` (100,000). Whole recent messages are kept, and an omitted count is noted. It never includes tool output, permission data or secrets.
- The stored user message stays the user's own text; the priming goes only to the agent.
- An auth failure (`-32000`) is still thrown as it is today, never treated as "session gone".
- Tests run against the fake agent's three `FAKE_ACP_RESUME` modes, with paths that work on Windows.

**Never:**
- Prompt timeout or Cancel (the hung-agent item belongs to 2.10), queueing, or Show earlier.
- Edits to `event-log.ts`, `event-stream.tsx` (2.9), start/shortcut files (2.4), `events.ts` or `agent-port.ts` shapes.
- Eagerly reopening at start.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|---|---|---|---|
| Resume | ref set, agent advertises resume | `restored:resumed`; `session.resumed {via:resumed}`; agent keeps context | — |
| Load | load only | `loaded`; replayed history not re-emitted | — |
| Neither | `none` | `new` session; first prompt = primer + user text; `via:transcript`; ref replaced | — |
| Resume fails | resume throws a non-auth RequestError | try load if advertised, else new; log `{code}` only | — |
| No ref | chat never reached an agent | plain `startSession`, no marker | — |
| Crash, same run | fatal drop, then a new message | reopen as above | — |
| Huge history | transcript > cap | oldest whole messages dropped; primer says "N earlier messages omitted" | — |
| Reopen fails | agent can't start | session `error`, as `startSession` failures do today | — |

- Decision (2026-09-30, user): the "Resumed from history" marker shows at every reopen after the process was gone, for all three vias (resume, load, transcript), with the same words, where the user continues (EXPERIENCE.md as written).

</frozen-after-approval>

## Code Map

- `packages/core/src/chat.ts:294-320` -- `agentFor` always calls `startSession`. Read the session's ref here, call `reopenSession`, store the ref, and append `session.resumed`. `runTurn` (line 322) sends `prompt(text)`, so prime it there. `RESTARTED_REASON` and `close()` already mark sessions resumable.
- `packages/core/src/entities.ts` -- sessions carry `adapterRefs`, set at create time only. The orm has `sessions` and `events` (with `events_stream_idx`). `setSessionState` shows the transaction pattern to follow.
- `packages/core/src/agent-port.ts:104-158` -- `ReopenAgentSession`, `AgentRestored` and `reopenSession` are already in place. Leave them unchanged.
- `packages/adapters/src/acp-claude-code/claude-code-agent.ts:458-482` -- `reopen()`: after any non-auth error it currently skips straight to new (F3).
- `packages/shared/src/events.ts:317-326` -- `session.resumed {sessionId, via: resumed|loaded|transcript}` exists.
- `tests/fixtures/fake-acp-agent.mjs` -- `FAKE_ACP_RESUME`, and the `context` keyword, which replies `session=… via=…`.
- `packages/web/src/chat/transcript.ts` (`TranscriptItem`, `sessionView`) and `routes/session-page.tsx:120-135` (`view.items.map`) -- 2.6's rendering. Use `ui/separator.tsx`.
- `packages/server/test/chat.test.ts:305` -- the pattern for a restart test: two servers on one `dataDir`.
- The plan is checked against `b8c3ff4` (2.6 on top of 2.5); the work was rebased onto `feff5d1` (2.9, with 2.4, on top of 2.6).

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/entities.ts` -- add `setSessionAdapterRefs(id, refs)`, which merges the refs, appends no event, and leaves `updatedAt` alone. Add `listCompletedMessages(sessionId)` → `{role, content}[]`, ordered by seq.
- [x] `packages/core/src/resume-prime.ts` (new) -- `primedPrompt(messages, text)`, which applies the cap.
- [x] `packages/core/src/chat.ts` -- `agentFor` reopens when a ref exists. On success it stores `agentSessionId`, appends `session.resumed` (`new` becomes `transcript`), and marks the entry `prime` when the result was new and messages exist. `runTurn` sends `primedPrompt` once.
- [x] `packages/adapters/src/acp-claude-code/claude-code-agent.ts` -- in `reopen`, when resume fails and load is advertised, try load. Log `{method, code}`.
- [x] `tests/fixtures/fake-acp-agent.mjs` -- `context` also reports `primed=<n>`, the number of prior messages found in the prompt.
- [x] `packages/web/src/chat/transcript.ts`, `routes/session-page.tsx` -- add the item `{type:'resumed', via, at}`, placed just before the user message that triggered the reopen (the last user message before the event). Render it as a Separator with the caption given by the Open Question's answer.
- [x] `_bmad-output/initiative-ogden-agents/deferred-work.md` -- append "Resolved: reopen order on failure (2.3 F3)".
- [x] Tests:
  - `core/test/chat.test.ts`: the matrix with a scripted port.
  - `core/test/entities.test.ts`: refs and completed messages.
  - `adapters/test/acp-claude-code.test.ts`: the F3 order.
  - `server/test/resume.test.ts` (new): the server restarts in each fake mode, and `context` shows `via` and `primed`.
  - `web/test/transcript.test.ts`: where the marker goes.

**Acceptance Criteria:**
- Given a chat and a server restart, when the user sends a message, then the reply comes from the reopened session (fake: `via=resumed|loaded`, or `primed=n` for `none`), and the transcript shows the marker at the break.
- Given the event log, when it is searched for the agent's session id, then there are no matches.

## Implementation Notes

- `claude-agent-acp` 0.84.0 advertises both: its `initialize` returns `loadSession: true` and `sessionCapabilities.resume` (read from the installed adapter's `dist/acp-agent.js`, which also registers `session/resume` and `session/load` handlers). So a real Claude Code chat reopens with `session/resume`, falling back to `session/load`. The live manual check (a restart with the developer's login) was not run in this implementation pass; the advertisement was read from the adapter's source instead.
- The ref is `adapterRefs.agentSessionId` (`AGENT_SESSION_REF` in `chat.ts`). It is stored on every start, so a crash in the same run reopens too. `setSessionAdapterRefs` appends no event.
- `listCompletedMessages` also returns each `messageId`, so the message that triggered the reopen is left out of the primer by id.
- Priming is marked on the entry when the result is `new` and consumed only when a prompt succeeds, so a primed prompt that failed without losing the agent is primed again (with the newer messages) on the next send.
- `primedPrompt(messages, text, agentName, maxChars?)` labels agent lines with the agent's display name (the golden's "Claude Code:"). A newest message larger than the cap on its own keeps its end, marked `[shortened: only the end is kept] …` (review F2).
- A slash command (`/…`) sent first after a transcript reopen goes without the primer and leaves `prime` set; the next ordinary message is primed (review F1). The fake answers `/<command>` with `command=/<command> primed=<n>`.
- Fake agent: `FAKE_ACP_RESUME=both` advertises resume and load; `FAKE_ACP_REOPEN_FAIL=resume|load|resume-auth` (comma list) makes those methods refuse, for the F3 tests. `context` reads the user's text after the primer's "New message" line.
- The marker renders as a labelled `role="separator"` row (two `Separator`s around a caption), "Resumed from history" for all three vias. An e2e check was added to the crash test in `tests/e2e/chat.spec.ts` (crash, then a new message shows the marker just before it).
- The REST `Session` payload still carries `adapterRefs`, so the agent's id is readable by a signed-in tab over REST; it is in no event, URL or key (review F3, rejected).

## Plan Change Log

## Review Triage Log

- F1 (patch): the first message after a transcript reopen that is a slash command (`/…`) went with the primer in front, so the agent would not read it as a command. It now goes as it is and keeps `prime` set, so the next ordinary message is primed. Tests: core `chat.test.ts`, server `resume.test.ts` (fake `/<command>`).
- F2 (patch): a newest message longer than the cap on its own was dropped, leaving no transcript. Its end is now kept, cut to fit and marked as shortened. Test: core `chat.test.ts` (`primedPrompt`).
- F3 (reject): the agent session id is readable over REST (`adapterRefs` in `Session`) by a signed-in tab. It is not a credential, there is one token-gated user, and the plan forbids only keys, URLs and event payloads.
- F4 (defer to 2.10): the new agent id is saved before the primed prompt succeeds, so a restart in between reopens the new session unprimed. Logged in `deferred-work.md`.

## Design Notes

A primer, as a golden example:

```
[Ogden Agents] This conversation continues from a saved transcript; your earlier session ended.
(3 earlier messages omitted)
User: …
Claude Code: …
[Ogden Agents] New message:
<text>
```


## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test` -- expected: all pass on the macOS, Windows and Linux CI legs.
- `pnpm build && pnpm e2e` -- expected: the existing suite passes.

**Manual checks:**
- With the developer's existing Claude Code login (`pnpm dev:chat`): chat, restart the server, and ask "what did I say earlier?". The reply shows the context. Record which of resume and load `claude-agent-acp` 0.84 advertises (the ticket's `unknown`) in Implementation Notes.
