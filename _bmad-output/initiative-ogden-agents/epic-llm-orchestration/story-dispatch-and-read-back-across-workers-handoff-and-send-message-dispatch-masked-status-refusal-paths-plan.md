---
title: 'Dispatch and read-back across workers: handoff and send-message dispatch, masked status, refusal paths (epic 15)'
type: 'feature'
ticket: '15.7'
created: '2026-10-05'
status: 'in-review'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick-security', 'quick-correctness']
review_loop_iteration: 0
baseline_revision: '91c62fd25ed546539ceea880b4a5d0495bbe3297'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-llm-orchestration/epic-llm-orchestration.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The tracer (15.3) sends an approved instruction only into a new chat, trusts that the worker is still fine when the user presses Send, applies no vendor terms at dispatch, can leave an empty chat behind when a send is refused, and reads a worker back as its last reply only (no tool calls, and an old reply of a reused chat would show as the new result).

**Approach:** Complete dispatch to every worker through the chat's own use-cases. Before any chat is made, core checks in code that the worker is still on the team and ready, that its vendor terms allow it (an `interactiveOnly` agent is never sent an instruction; a subscription agent only takes an instruction the user approved, never in a run under the automatic mode), and, for a step that names a chat, that the chat is the worker's own, a plain chat, idle and not driven by the terminal. Then the instruction goes through `createChatSession` (new) or the named chat, with `sendMessage` marked as the manager's. Every refusal is a plain result (`dispatch_refused`, a reason token and plain words) that creates nothing and changes no chat. The read-back gives the manager the worker's normalized state and a capped, secret-masked summary of its tool calls and last output since the instruction, through `makeStatusReport`. The manager is offered each worker's own idle chats so a plan may continue one.

**Decisions (user, 2026-10-05; epic Notes):** workers keep their own permission cards and modes and the manager never changes them (the worker chat starts in the project's default mode, an existing chat keeps the mode it is in); subscription agents (Claude Code, Antigravity) take approve each only; Codex and Grok are API key workers; Copilot CLI is never an autonomous worker.

**Decision (this story, recorded): no handoff.** A plan step names `new` or one of its own worker's chats (the plan check refuses any other chat id), and handoff exists to change the agent of a chat and, with it, its mode. Using it would give the manager a way to change a worker's mode and agent, which the user decided it never has, and no step can need it. Dispatch therefore uses `createChatSession` plus `sendMessage` only; an architecture test (E15, 15.7) proves the use-case and the manager code never name `handOff`, `handoffPreview`, `setPermissionMode`, `switchDriver` or `setModel`. The masked, capped brief of AD-8 is not needed here: the read-back already goes through the same masking and capping (`makeStatusReport`).

## Boundaries & Constraints

**Always:** the rules live in core, not in the page or the prompt; every refusal is checked before a chat is made, and is plain words with no em or en dash; every worker string is masked and capped before it reaches the manager; tests run no real agent, model, network or keychain.

**Never:** a change to a worker's mode, model, driver or agent; a handoff; automatic mode, limits or the loop (entries 8 and 9); a build; a hand edit of the spec or architecture.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New chat, any worker | approved step, `chat: new`, Claude Code, Antigravity, Codex or Grok | chat of that agent in its own default mode, instruction sent as the manager's, step `dispatched` | n/a |
| Existing chat | step names the worker's own chat, idle, driven by the chat | no new chat; instruction sent into it, its mode unchanged | n/a |
| Worker left the team or is not ready | roster no longer lists it, or not ready | 409 `dispatch_refused` (`worker_not_on_team`, `worker_not_ready`) | nothing created, step stays approved |
| Signed out, project not trusted | agent unavailable | `worker_signed_out`, `trust_not_given` | same |
| Vendor terms | agent `interactiveOnly` | `interactive_only` | same |
| Subscription agent, run under automatic mode or not approved by the user | Claude Code or Antigravity | `approve_each_only`; Codex and Grok go on | same |
| Chat unusable | gone, another agent's, not a plain chat, busy or finished, driven by the terminal | `chat_gone`, `chat_other_agent`, `chat_not_a_chat`, `chat_busy`, `driver_is_terminal` | same; a message the chat queued is taken back |
| Send fails after a new chat was made | chat throws | step `failed` with the chat id, chat named "Not sent: step s1", no second chat on retry | the error is returned |
| Run stopped or step edited while the chat is made | race | nothing sent; a chat made is named "Not sent: step s1" | 409 `step_not_approved` |
| Read-back | dispatched step | state, tool calls (newest 10, 800 characters) and last reply since the instruction, masked, capped to 4000 | a secret in output or a tool title is masked |

</frozen-after-approval>

## Code Map

- `packages/shared/src/orchestration.ts`, `errors.ts`, `api.ts` -- refusal reasons, their plain words, the `dispatch_refused` code.
- `packages/core/src/orchestration.ts`, `errors.ts`, `team-roster.ts` -- the worker and chat checks, dispatch, the chats offered, the read-back summary; `DispatchRefusedError`; `isSubscription` exported.
- `packages/server/src/orchestration-routes.ts` -- maps the refusal to 409 with `details.reason`.
- tests: core `orchestration.test.ts`, server `orchestration-dispatch.test.ts`, `tests/architecture.test.ts`.
- Web: no change. The Orchestrate page already shows a refusal's plain words in its alert, keeps the step approved with Send, and shows the step's report (which now names tool calls).

## Tasks & Acceptance

- [x] shared reasons, words and code
- [x] core checks, dispatch into a new or a named chat, read-back with tool calls, chats offered to the manager
- [x] server mapping
- [x] tests (core, server with the real chat and fake Claude Code, Antigravity, Codex and Grok agents, architecture)

**Acceptance Criteria:**
- Given fake Claude Code, Antigravity, Codex and Grok workers, an approved instruction reaches each and its transcript shows it was sent by the manager.
- Given a secret in a worker's output or a tool title, the read-back masks it, and an over-long output is capped.
- Given any refusal, nothing is created or sent, every chat is unchanged, and the user and manager get plain words.
- Given a chat the step names, no new chat is made and the chat's mode is unchanged.

## Implementation Notes

- Checks (`requireWorkerReady`, `requireChatReady`) run before `createChatSession`; they read the install's agent list and the team's workers again, because the plan was checked when it was proposed. The order of reasons: not on the team, `interactiveOnly`, subscription terms, the agent's own unavailable code (signed out, project not trusted, not installed), the team's ready flag. `createChatSession` can still refuse (`AgentNotReadyError`) and is mapped to the same plain results; it creates nothing then.
- Subscription terms in code: `isSubscription(agent)` (any `subscription` sign in method, the roster's own test) and `run.mode === 'automatic' || approvedBy !== 'user'` is refused. Today a run is always approve each (15.8 sets the mode), so the automatic branch is proved with a directly changed row, as 15.6 proved approval; the roster already refuses such an agent as a worker in an automatic project.
- A refused send into a named chat leaves the step approved (the user may send it when the chat is free). Unknown errors after a new chat was made fail the step and name the chat; there is no per chat delete in core (only `deleteHistory` for a whole project), so "delete or mark" is mark: `renameSession("Not sent: step s1")`, best effort.
- A chat that queued the message behind a turn that was ending is not an instruction at once: the queued message is removed and the dispatch refused as `chat_busy`.
- Chats offered (`ownChats`): the worker's plain chats, driven by the chat, idle, newest first, at most 5, as `ManagerWorkerChat`; `validatePlanFor` then refuses any other chat id, so the manager cannot name another worker's chat.
- Read-back (`lastReply`): newest first within the chat's last 500 events, stops at the manager's instruction (matched by its text), so an old reply of a reused chat is not shown as the result; tool calls by id with their latest status, the newest 10, each title cut to 80, the whole line to 800, placed before the reply so a long reply is the part that is cut (`truncated` stays honest). A chat busier than the window, or two steps with the same text in one chat, can show a later step's output (known limit).
- The refusal is returned to the caller (`409 dispatch_refused`, `details.reason`, plain words) and the page shows it; it is not an event (deferred to the loop story, which tells the manager).

## Spec proposals

Written to the memlogs with `_bmad/scripts/memlog.py` when the stack is merged (never to the frozen documents): the architecture memlog gets the API error code `dispatch_refused` and the note that dispatch uses `createChatSession` and `sendMessage` only (no handoff); the spec memlog gets a CAP-22 note that vendor terms are applied at dispatch. `covers` stays empty.

## Plan Change Log

None yet.

## Review Triage Log

2026-10-05, security and correctness reviewers, no critical or high findings. Patched: a queued message that could not be taken back was refused as busy although it had been sent, so a retry would send twice (medium, both), now counted as sent; a named chat that failed to take an instruction was marked failed with the user's own chat id, and the read-back then showed that chat's older history (medium, both), now the step and chat are left as they were; a reused chat whose instruction is not in the newest events showed the user's earlier replies as the worker's result (medium), now an empty summary; a failed send left the run waiting forever (medium), now the run fails with `worker_error` as a worker's own error does; the empty chat of a failed send was offered back to the manager (medium), now excluded; tool titles were cut before masking (low), now masked first; the terminal check allowed any driver but `terminal` (low), now only the chat driver; tests: a vacuous unchanged check, the untested mapping of a chat that cannot be made, and stale test stubs of the chat. Not changed: a chat named by the step need not be one of the five offered (any idle plain chat of the worker, approved by the user, is allowed; the page shows the chat id); the worker's readiness is not read again after the chat is made (the window is one chat creation); a worker stopped by the user reads as done with a partial reply (existing, 15.8 Stop); tool call order follows each call's last update (cosmetic); identical instructions in one chat or a worker busier than 500 events can show a later step's output (known limit); worker text reaching the manager is wrapped as untrusted data by 15.4's input builder; a subscription test is any agent listing a subscription sign in (over restricts, never bypasses).

## Verification

**Commands:** `pnpm typecheck`, `pnpm test`, `PROVENANCE_BASE=origin/main pnpm provenance`.
