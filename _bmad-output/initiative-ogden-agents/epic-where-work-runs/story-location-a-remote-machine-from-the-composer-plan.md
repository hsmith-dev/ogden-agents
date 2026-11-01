---
title: 'Location: a remote machine from the composer'
type: 'feature'
ticket: '5'
created: '2026-11-01'
status: 'built'
baseline_revision: '73bba3c169ab0b27cfb2419ae89ffcdbf61dc81d'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'defensive']
review_loop_iteration: 0
context: ['{project-root}/AGENTS.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A remote machine is still picked with epic 19's separate machine picker beside the setup row, the Location chip knows only This folder and Worktree, and a remote chat shows nowhere that it runs on another machine (E27-R4; CAP-35, CAP-24; AD-24, AD-26).

**Approach:** The draft's Location chip lists This folder, Worktree, then each confirmed machine from Settings, Remote machines with its live state, then Add a remote machine; picking one starts the chat there through epic 19's chat target (`machineId`), and the machine picker leaves the draft. A started remote chat's chip and header show its machine ("on build-box"). Every remote refusal stays, checked on the server before anything starts.

**Decisions (autonomous, 2026-11-01; user may overrule):** (1) An agent you add yourself (custom, epic 21) is refused on a remote machine in v1.3: its command is found and checked on this computer and its key is this computer's, so it gets a `localOnlyReason` like the Local model. (2) A local-only agent is refused when the remote chat is created and when a remote chat is handed to it, besides the existing refusal at agent start. (3) The Chats list's own machine picker (19.7) stays as a way to open the draft with a machine picked (`?machine=`).

## Boundaries & Constraints

**Always:** the Local model and every agent with `localOnlyReason` never reach `remote.connect` (no connection opened, no env sent); unattended remote builds stay refused (build dialog unchanged); Worktree and a machine are never both chosen (the chip holds one place; the shared refine and core check stay); machine reachability and host key are probed only by the server (`checkRemoteMachineHostKey`), the page opening no connection; an unconfirmed machine is never listed; a machine item the chosen agent can't take, or that can't be reached, or whose host key changed, is disabled but focusable with its one-sentence reason; `/api/v1`, `{error:{code,message}}`; no em or en dashes in UI strings; chips truncate, the row scrolls sideways below `md`.

**Never:** a worktree on a remote machine; hand-off of a remote chat (stays on its machine); changing epic 19's SSH, host-key, credential or sync code; touching 27.4's hand-off items or 27.6's retention; removing the Build dialog's machine choice; editing `deferred-work.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Remote chat | draft, Location build-box (confirmed, connected), send | chat with `machineId`, fake agent replies over the SSH stub; header "on build-box"; chip shows build-box | none |
| No machines | none confirmed | chip lists This folder, Worktree, Add a remote machine | none |
| Unreachable | probe throws | "build-box, can't connect", disabled: "Check it's on, or pick another place." | not selectable |
| Host key changed | probe fingerprint differs | disabled with the host-key-changed reason | not selectable |
| Local-only agent | Local model or custom agent chosen | each machine disabled with the agent's `localOnly` reason | not selectable |
| Agent changed after machine | machine picked, then a local-only agent | status line says the agent's reason; send refused by the server | 409 `invalid_operation` with that reason, shown under the composer |
| Create bypassing UI | POST sessions `machineId` + local-only agent | no chat, no connection | 409 `invalid_operation` |
| Stored remote row | remote session with a local-only agent (planted) | agent never started, no connect | `agent_unavailable` (existing) |
| Handoff to local-only | remote chat, Continue with the Local model | nothing changes, no connect | 409 `invalid_operation` |
| Worktree + machine | POST with both | refused as before | 400 `validation_failed` |
| `?machine=` | draft opened from the Chats list with a machine | chip starts on that machine | unknown or unconfirmed id falls back to This folder |
| Removed machine | started remote chat whose machine was removed | header "on a remote machine" | none |

</frozen-after-approval>

## Code Map

Project root is the git worktree `/Users/harrisonsmith/Library/Caches/ogden-agents-dev-worktrees/27.5`; every path is relative to it and every command runs there. Never edit another checkout, `git stash`, push or switch branches. The machine is shared: wait for `uptime` load below 40 before `pnpm test`; re-run timing failures alone.

- `packages/web/src/chat/setup-row.tsx` `LocationChip` -- today `value: ChatLocation`; widen to a place: `{ location, machineId }` (or a union with `RemoteMachineId`), machine items after Worktree, Add a remote machine (`Link to="/settings/remote-machines"`), started remote chat shows its machine with `Desktop` glyph and "A chat on a remote machine stays on that machine." 27.4 edits the started-chat branch in parallel: keep changes there small.
- `packages/web/src/remote-machines/machine-picker.tsx` -- probe logic (open-triggered, 30 s cache, `MACHINE_UNREACHABLE_REASON`, `MACHINE_HOST_KEY_CHANGED_REASON`): extract into a `useMachineChecks(open, confirmed)` hook in the same folder and reuse in both; `MachinePicker` stays for `workspace-chats-page.tsx`. `remote-machines-api.ts` `useRemoteMachines`, `checkRemoteMachineHostKey`.
- `packages/web/src/routes/new-chat-page.tsx` -- remove `MachinePicker` (~173), the `effectiveLocation` workaround (~70) and pass the place to the chip; `createChatSession(..., pickedMachine, location)`; reuse rule unchanged. `chat/new-chat-agent.tsx` `useNewChatAgent` holds `pickedMachine`; add the local-only conflict to the status line (`NewChatAgentStatus`).
- `packages/web/src/routes/session-page.tsx:560-575` header (machine badge beside the branch badge slot; `ui/badge.tsx` add `MachineBadge` like `BranchBadge`, AD-18: no visual utilities in routes), `:872` chip hidden for remote chats today: show it.
- `packages/shared/src/chat.ts` -- `ChatAgent.localOnly?: string`; texts (machine state words, unreachable sentence, remote fixed text, "on <name>", Add a remote machine); `CHAT_WORKTREE_REMOTE_TEXT` reworded (no "Choose Local").
- `packages/core/src/chat/workspaces.ts:62` `chatAgentOf` -- `localOnly` from `agent.localOnlyReason`; `createChatSession` (~308) refuse `machineId` with a local-only agent (`InvalidOperationError`). `chat/handoff.ts` `prepare` -- refuse a remote chat to a local-only agent. `chat/agents.ts:134` start-time refusal stays.
- `packages/server/src/chat-routes.ts:195` -- 409 `invalid_operation` also for a remote create refusal.
- `packages/adapters/src/acp-custom/custom-agent.ts` quirks -- `localOnlyReason: CUSTOM_AGENT_LOCAL_ONLY_REASON` (export it); `acp-agent.ts:191` already carries it; `forChat` keeps it (`keptAgentFlags`).
- Tests: `packages/core/test/chat-remote.test.ts` (existing localOnly test creates with `machineId`: plant the row with `core.entities.createSession` instead), `packages/server/test/for-chat-flags.test.ts`, `packages/adapters/test` custom agent tests, `packages/web/test/machine-picker.dom.test.tsx` (mock pattern), session-page and new-chat dom tests, e2e `tests/e2e/remote-target.spec.ts` (switch to the Location chip), `composer-setup-row.spec.ts` (`expectNoHorizontalOverflow`, axe).

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/chat.ts` -- `ChatAgent.localOnly`, texts.
- [x] `packages/adapters/src/acp-custom/custom-agent.ts` -- custom agents local only.
- [x] `packages/core/src/chat/workspaces.ts`, `chat/handoff.ts` -- `localOnly` in the agent list; create and handoff refusals.
- [x] `packages/server/src/chat-routes.ts` -- 409 for the remote create refusal.
- [x] `packages/web/src/remote-machines/machine-checks.ts` (new), `machine-picker.tsx` -- shared probe hook.
- [x] `packages/web/src/chat/setup-row.tsx`, `routes/new-chat-page.tsx`, `chat/new-chat-agent.tsx` -- machines in the Location chip, picker gone from the draft, conflict line.
- [x] `packages/web/src/ui/badge.tsx`, `routes/session-page.tsx` -- machine badge, remote chip.
- [x] Tests: core (create and handoff refusals with no connect, planted row still refused, agent list `localOnly`), adapter (custom agent `localOnlyReason`), server (route 409, `forChat` keeps it for a custom agent), web dom (chip machine items with states, local-only disabled, Add a remote machine, conflict line, header badge, started remote chip), e2e `remote-target.spec.ts` via the chip with the fake reply, axe and 390px.

**Acceptance Criteria:**
- Given a confirmed fake machine, when Playwright picks it in the Location chip and sends, then the fake agent's reply arrives over its SSH stub and the header says "on <machine>".
- Given the Local model or a custom agent, when any path (draft, REST create, handoff, stored row) targets a machine, then no connection is opened.
- Given `pnpm typecheck` and `pnpm test`, then both pass.

## Implementation Notes

- Refusal type: core's `LocalOnlyAgentError` (a subclass of `InvalidOperationError`, code `invalid_operation`) is thrown by `createChatSession` (with `machineId`) and by the handoff `checkNow` (remote chat, so both preview and hand-off); `chat-routes.ts` `refusal` maps it to 409 for every route, so other `InvalidOperationError`s keep their 400.
- `LocationChip` reads the machines itself (`useRemoteMachines`) and probes only in the draft (`useMachineChecks(open, confirmed, !started)`); its `onChange` takes a `ChatPlace` (`{ location, machineId }`); `worktreeReason` is gone (one place).
- `?machine=` falls back to This folder only once the machine list is read; until then the pick is kept and the server stays the check.
- Custom agent reason: "An agent you add yourself runs only on this computer, where its command and key are." (`CUSTOM_AGENT_LOCAL_ONLY_REASON`).
- Review fixes (pass 1): the session page reads the machines before its not-found return; the removed-machine words are shared `CHAT_REMOTE_MACHINE_WORDS`; the draft probes machines only for an agent that can run remotely.
- Verified (after review fixes, 2026-11-01): `pnpm typecheck` clean; `pnpm test` 463 files, 6004 passed, 13 skipped (load ~11); after `pnpm run build`, Playwright remote-target, composer-setup-row, new-chat and worktree-chat 9 of 9 (axe and 390px in remote-target); provenance check passed.

## Plan Change Log

## Review Triage Log

Pass 1 (2026-11-01; lenses: quick, fresh subagent given the plan and the diff; defensive, fresh subagent given only the diff, checking that no path lets a local-only agent or its keys reach a remote machine). Verdicts: high 1, medium 2, low 4, false 0, maybe-false 0. No intent_gap or bad_plan; 3 patched, 2 deferred, 2 rejected. The defensive lens found no path where a local-only agent's process, endpoint or key reaches a remote machine.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | `useRemoteMachines()` runs after the session page's 404 early return, so a missing chat's page crashes (fewer hooks) | high | patch | confirmed at `session-page.tsx:452` vs `:516`; hook moved above the return |
| 2 | Removed-machine words ("A remote machine") defined in web while their header twin is in shared | low | patch | moved to `packages/shared/src/chat.ts` |
| 3 | The draft probes every machine even when the chosen agent is local-only (all disabled anyway) | low | patch | probe enabled only for an agent that can run remotely |
| 4 | While the machine list loads (or fails), the header and chip say "a remote machine", the removed-machine words | low | reject | brief and truthful; telling loading apart adds branches for a cosmetic flash |
| 5 | An attended remote build with the Local model connects and pushes the repo to the machine before the agent-start refusal (`build-start.ts` `validateStart`/`begin`); no process, endpoint or key is sent | medium | defer | pre-existing (19.6/21.6), not caused by this change; a `localOnlyReason` check in `validateStart` plus a `build-remote.test.ts` row |
| 6 | Continue with another agent on a remote attended build session is not refused (its `Session.machineId` is null; the run holds the machine), so Resume pushes and connects before the start refusal | medium | defer | pre-existing: handoff has no build-kind refusal; the agent is still never launched remotely |
| 7 | `createAcpAgent` has no adapter-level backstop refusing `input.remote` for a local-only port | low | reject | only core passes `remote`, and it refuses first; a guard for a caller that does not exist |

## Design Notes

The draft holds one place: This folder, Worktree, or a machine id, so the old "Worktree disabled while a machine is picked" rule disappears. Machine state words come from the existing probe (run when the menu opens): before it answers, the machine's `user@host`; connected; can't connect; host key changed. Server refusals stay the source of truth; the UI only says them early.

## Deferred (for the sweep)

- An attended remote build with a local-only agent (the Local model) opens a connection and pushes the repo to the machine before the agent-start refusal; refuse it in `build-start.ts` `validateStart` (and the queued dispatch) with a `build-remote.test.ts` row (review 5). 27.9: fixed (`build-start.ts` `refuseLocalOnly` before the probe; `build-remote.test.ts`).
- Continue with another agent is not refused for a remote attended build session (the machine is on the Run, not the Session), so Resume pushes and connects for an agent that is then refused; refuse handoff of build sessions or check the run's machine (review 6). 27.9: fixed (Retry and Resume refuse the session's current agent when it is local-only, before any push or connection; `build-remote.test.ts`).
- The Chats list header still has epic 19's machine picker (decision 3); fold it once the draft is the only way to start a chat. 27.9: logged in `deferred-work.md`.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors
- `pnpm test` -- expected: all pass (timing failures re-run alone)
- `pnpm run build && pnpm exec playwright test tests/e2e/remote-target.spec.ts tests/e2e/composer-setup-row.spec.ts tests/e2e/new-chat.spec.ts tests/e2e/worktree-chat.spec.ts` -- expected: pass
- `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs` -- expected: pass
