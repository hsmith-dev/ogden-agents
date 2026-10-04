---
title: 'Sign in again from a session'
type: 'feature'
ticket: '4'
created: '2026-09-30'
status: 'built'
baseline_revision: 'dca005efccc31b63ec27a14ba0f6b10f63cef244'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-first-run-onboarding/epic-first-run-onboarding.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** When Claude Code's sign-in expires, a chat fails with ACP `-32000`. The session shows "Claude Code needs you to sign in again." but `errorCode` is never set, so the notice offers only Try again, which fails the same way.

**Approach:** The adapter tags `-32000` as `auth_required`. Core puts it on `session.state_changed.errorCode` and drops the agent process. The next send then starts a new process with fresh credentials (and any changed key) and reopens the session with its context. The session error notice then shows **Sign in** (9.1's `useSignIn`), or a link to Settings: Agents when an API key was refused. Once signed in, **Try again** resends.

## Boundaries & Constraints

**Always:**
- Reuse 9.1's sign-in action and 9.2's precedence and cache unchanged. Credentials, the sign-in URL, codes and keys never reach events, logs or the DB (AD-16). The URL still arrives only in the `no-store` response. Nobody is ever told to open a terminal (AD-21).
- `auth_required` ends the agent process (`dropAgent`). Try again goes through the existing reopen chain (resume, then load, then new) and keeps the transcript.
- Core names no agent (AD-1). No new routes (AD-15 unchanged).
- Tests use the fake agent and fake login only.

**Never:** Editing the 9.3 files (`agent-setup.ts`, `agent-setup-routes.ts`, `start.ts`, `shared/src/setup.ts`, `setup-claude-code/*`, `agent-setup-api.ts`). Splitting `chat.ts`. Restarting live agents when a key changes (deferred). Welcome (9.5).

## I/O & Edge-Case Matrix

| Scenario | State | Expected | Error handling |
|---|---|---|---|
| Expired sign-in | prompt → `-32000`, subscription | `error`, `errorCode:'auth_required'`, "Claude Code needs you to sign in again." with **Sign in**. Agent process dropped | Raw error goes to the log, masked |
| Reopen refused | `resume-auth` | Same as above | — |
| Signing in | Sign in clicked | Notice shows 9.1's signing-in view (tab or link, paste code, Cancel) | Sign-in failure: reason plus Sign in again |
| Signed in | `agent.auth_changed signed_in` | Notice: "Signed in. Try again to continue." Try again resends; the reply uses the earlier context | — |
| API key refused | `method:'api_key'` in use | "Claude Code refused your API key." with a link to `/settings/agents`, no Sign in | — |
| Several chats in error | one sign-in finishes | Every open error notice updates from the agents query. Whether any chat resends on its own is Open Question 1 | — |
| Other errors | `agent_failed`, `agent_unavailable` | Unchanged: Try again only | — |

- Decision (2026-09-30, user): (B) the chat whose notice started the sign-in resends its last message by itself once `signed_in` arrives (only while that page is open); other chats in error show Try again.

</frozen-after-approval>

## Code Map

- `packages/adapters/src/acp-claude-code/claude-code-agent.ts`: `plainReason` (l.109) maps `-32000` to its wording only. The start/reopen catch (l.545) and the prompt catch (l.586) build `agent_unavailable` / `agent_failed`, and `setState('error', msg)` fires *before* the throw. The code must ride on both.
- `packages/core/src/agent-port.ts:48,166`: the `state` event already has `code?: AgentErrorCode`, and `auth_required` exists.
- `packages/core/src/chat.ts`: `fail` (l.468) calls `setSessionState(..., {reason})`. The `state` case (l.519) rebuilds `agent_failed` and drops `event.code`. The first `fail` wins, because `setSessionState` no-ops on the same state.
- `packages/core/src/entities.ts:62,310`: `SessionStateDetail` and the event payload need `errorCode`.
- `shared/src/events.ts:124,239` (`errorCode`) and `web/src/chat/transcript.ts:183` (folds it) are done already. Leave them unchanged.
- `web/src/routes/session-page.tsx:302-318`: the error notice and `tryAgain` (l.234).
- `web/src/agents/agent-setup-api.ts`: `useAgents` and `useSignIn`, reused as they are.
- `web/src/agents/agent-card.tsx:100-155`: `SigningIn` is private.
- `tests/fixtures/fake-acp-agent.mjs` (`auth-expired`, `FAKE_ACP_REOPEN_FAIL=resume-auth`, `FAKE_ACP_REQUIRE_API_KEY`, `context`), `fake-claude-login.mjs` (`FAKE_LOGIN_STATE`).

## Tasks & Acceptance

**Execution:**
- [x] `claude-code-agent.ts`: give `-32000` the code `auth_required` in both catches and on the `setState('error', …, code)` event. Wording unchanged.
- [x] `core/src/entities.ts`: add `errorCode` to `SessionStateDetail` and the payload (omit it when undefined).
- [x] `core/src/chat.ts`: `fail` passes `errorCode` for `auth_required` and forces `dropAgent`. The `state` case keeps `event.code`.
- [x] `web/src/agents/signing-in.tsx` (new), `agent-card.tsx`: move `SigningIn` out unchanged and import it. This is the only line-level edit to a 9.3 file.
- [x] `web/src/chat/sign-in-again.tsx` (new), `chat-api.ts` (`AGENT_ID`), `session-page.tsx`: when `errorCode==='auth_required'`, render the notice from the agents query plus `useSignIn(AGENT_ID)`, following the matrix. Try again stays and re-enables once signed in.
- [x] `tests/fixtures/fake-acp-agent.mjs` (additive): with `FAKE_ACP_REQUIRE_LOGIN=<state file>`, prompts fail `-32000` until `fake-claude-login` writes it.
- [x] Tests:
  - adapter: the code on the error and the event.
  - core: `errorCode` on the event, agent dropped, and the next send reopens.
  - `web/test/sign-in-again.test.tsx`: each matrix row.
  - `tests/e2e/sign-in-again.spec.ts`: `FAKE_ACP_REQUIRE_LOGIN` (the `auth-expired` keyword would fail its resend too) and `FAKE_ACP_RESUME=resume`; send `context`, then Sign in via the fake login (the same `context.route` as `agents-settings.spec.ts`), then Try again, then `context` replies `via=resumed`; plus the API-key and two-chat rows.

**Acceptance Criteria:**
- Given the fake agent's expired sign-in, when the user signs in from the notice and clicks Try again, then the same session answers with its earlier context and no new chat is created.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm e2e` -- expected: all pass.

**Manual checks (hitl, with approval):** The user runs `claude auth logout` mid-chat, then signs in from the notice. Expected: the chat continues with its context. The agent never runs a real login.

## Implementation Notes

- The notice (`web/src/chat/sign-in-again.tsx`) keeps a small tracker (`observeAuth`): the first sign-in state it sees is only noted; a change to `signed_in` shows "Signed in. Try again to continue."; only a sign-in started by this notice's own **Sign in** resends, once. Try again, a failed or cancelled sign-in, unmounting (leaving the page) or a new error (the notice is keyed per last sent user message) all disarm it.
- Signed in already when the notice opens (a CLI that still reports signed in although the agent refused) shows **Sign in** and Try again, not "Signed in", so a refusing agent never loops.
- Try again is disabled while signing in. The notice carries `data-auth` (the agents query answered) so browser tests wait for it deterministically.
- A refused API key: shown when the agents query says `signed_in` with `method: 'api_key'`.
- The notice reads its own start request's outcome through the `auth` seam of `useSignIn` (a wrapper around the tab's `fetch` that reads only the reply's `state`, never the URL), so `agent-setup-api.ts` (9.3's file) is unchanged.
- Remaining race (review F2): a second sign-in is detected from `agent.auth_changed signing_in` events after the click. An event this tab misses (a reconnect gap) could leave two notices armed on one sign-in. The failure is two chats each resending once, never a loop. The other direction (this tab's own sign-in replaced a slower one) disarms by mistake; that is safe, and the notice still shows Signed in with Try again.
- Additive event field (review F4): `session.message_completed.payload.origin: 'deny_reason'` marks a Deny-reason message core sent; `transcript.ts` skips it for `lastUserText`.

## Review Triage Log

- **F1 (medium, fixed):** a Sign in whose start request failed (network error, non-2xx such as 409 or a refusal, or an unreadable reply) now disarms the notice, so a sign-in finished elsewhere later never resends here. `startAnswered` in `sign-in-again.tsx`; unit tests, plus e2e "a Sign in whose start request failed never resends…" (the start request is aborted, then the user signs in from Settings: Agents in another tab). A mutation check (disarm removed) fails that e2e.
- **F2 (fixed):** the notice also disarms when its start answers anything but `signing_in` (superseded: `needs_sign_in`, or `failed`), and when a second `agent.auth_changed signing_in` arrives after its click (another tab replaced one of the sign-ins), so two tabs can't both be armed. `observeSignInStarts`; unit tests. The remaining race is documented in Implementation Notes.
- **F3 (fixed):** the e2e "nothing more is sent" checks hold over a 1 s settle window (`staysSent`: user messages and session state checked every 100 ms), in the resend, no-loop, two-chat and failed-start tests.
- **F4 (fixed):** a Deny-reason message core sends is marked `origin: 'deny_reason'` on `session.message_completed` (optional, additive in `shared/src/events.ts`; set in `core/src/chat.ts` `drive`), and `lastUserText` skips it, so neither Try again nor the auto-resend sends it as a plain message. Tests: `core/test/chat.test.ts` (only the reason is marked), `web/test/transcript.test.ts` (Try again resends the user's own message).
- **F5 (deferred):** unit tests for the React wiring of `SignInAgain`, which need a DOM test setup. Logged in `deferred-work.md` for story 9.6.
- **Windows CI regression (fixed, after merge to the PR):** three 9.2 tests in `server/test/agent-setup-routes.test.ts` failed with EPERM removing the repo folder after `server.close()`. Cause: `drop` in `core/src/chat.ts` closed the dropped agent without tracking it, and `close()` awaited only live agents, so the agent dropped on `auth_required` could outlive the server with its working directory in the repo (an orphan at shutdown, AD-3). Fix: dropped agents are kept by session until they have stopped; `close()` waits for them, and a session's next agent starts only once its dropped one has stopped. Tests: `core/test/chat.test.ts` (close and the next start wait for a slow close) and `server/test/chat.test.ts` (the real fake agent, closed right after an `auth_required` drop, is gone when `close()` resolves). All three fail without the fix.

## Plan Change Log

- 2026-09-30 (epic 2 retrospective, action A4): `ticket:` changed from '9.4' (the global ref, which `tickets.py` can't join) to the epic-local entry id `'4'` from `tickets.toml`. `baseline_revision` backfilled with `dca005e`, the parent of the story's first commit `8db7a60` (story 9.4); it wasn't recorded when the build started.
