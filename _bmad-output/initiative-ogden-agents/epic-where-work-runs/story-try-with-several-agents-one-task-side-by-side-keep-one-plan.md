---
title: 'Try with several agents: one task, side by side, keep one'
type: 'feature'
ticket: '8'
created: '2026-11-01'
status: 'built'
baseline_revision: 'b2cb81f376c869254045f1a3a82f62d2a4b4f3f0'
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

**Problem:** 27.2 left trials as contracts only (`Trials`, `CreateTrialRequest`, `workspace.trial_*`, routes answering 501): a user can't send one task to several agents, compare their results, or keep one (E27-R7; CAP-35; AD-37).

**Approach:** **Try with several agents...** in the new-chat draft's Agent chip opens a dialog (the draft's text, 2 to 4 agents as checkboxes with readiness, EXPERIENCE's line, a retention line). **Start** makes one worktree chat per agent (each its own branch, port and permission cards), sends each the same first message and opens `/w/:wsId/try/:tryId`: one column per agent with state glyph and word, "+N -M" (branch view of 8.4's Changes), Open chat, Review changes and Keep this one. Keep asks once, the user choosing what happens to the others: **Put away** (27.6, restorable, the default) or **Delete** (27.3's Delete chat, its ignored-files list shown per copy). Nothing is merged. Not-kept columns read "Not kept", with Restore while put away.

**Decisions (autonomous, 2026-11-01; user may overrule):** (1) Only agents a local chat can start now are offered and accepted (no `unavailable`, project trust included); a trial never takes a machine (strict body; chats made with `machineId: null`), so `localOnly` agents are fine; `attendedOnly` is about unattended builds and doesn't apply (the user drives each chat); `interactiveOnly` agents are allowed: the user typed the task, every card is shown, one session per agent. (2) Retention: a trial's copies count toward the install's cap like any worktree chat; the sweep never puts away a copy of a trial not yet kept (older idle copies go instead), so a trial may sit above the cap until Keep; the dialog says so. (3) Chats have no concurrency limit, so "Waits for a free slot" doesn't apply. (4) Delete without the confirmation is refused before anything is removed.

## Boundaries & Constraints

**Always:** every agent checked before any chat is made; a chat that fails to be made removes the ones already made (27.3 removal, nothing uncommitted yet) and the trial isn't written; Keep refuses (`agent_mid_turn`, nothing changed) while any not-kept chat works, waits, is busy, switches or is terminal-driven; Delete removes another chat's uncommitted changes only with `discardUncommitted: true`, which the UI sends only from a confirmation naming them (else 409 `uncommitted_changes` before any removal); put-away and delete only through `Chat.putAwayWorktree(…, 'not_kept')` and `Chat.deleteChat`; a copy that can't go stays (result `left`) and is said; events strict with ids only (never the task text); `{error:{code,message}}`; no em or en dashes.

**Never:** merging, pushing or changing the kept chat; a remote trial; a startup sweep; editing `deferred-work.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Start | 2 ready agents, text | 2 worktree chats (distinct branches, ports), each sent the text, trial row, `workspace.trial_started` | none |
| Unready agent | one not signed in / untrusted project | nothing made | 409 `invalid_operation` naming it |
| Unknown agent | id not registered | nothing made | 404 / 409 |
| Remote asked | body with `machineId` | | 400 |
| Local-only agent | `localOnlyReason` set | started locally, `machineId` null | none |
| Second creation fails | git fails on agent 2 | agent 1's chat and copy removed; no trial | original error |
| Retention | keep 1, trial of 2 | neither trial copy put away; older idle copy put away | none |
| Keep, put away | idle others | others put away `not_kept`; trial kept; `workspace.trial_kept {putAway}` | none |
| Keep, delete clean | others clean | others deleted (27.3) | none |
| Keep, delete dirty | other has uncommitted, no discard | nothing removed, trial not kept | 409 `uncommitted_changes` |
| Keep, delete confirmed | same, `discardUncommitted` | removed | none |
| Mid-turn | another chat working | nothing changed | 409 `agent_mid_turn` |
| Unsafe copy | put-away refuses one | it stays, result `left`; others go; trial kept | said on the page |
| Again | trial already kept | | 409 `invalid_operation` |
| Restore not kept | put-away column, Restore | normal worktree chat again | 27.6's |

</frozen-after-approval>

## Code Map

Project root is the worktree `/Users/harrisonsmith/Library/Caches/ogden-agents-dev-worktrees/27.8`; every path is relative to it. Never edit another checkout, `git stash`, push, switch branches or commit (the orchestrator commits). Wait for `uptime` load below 40 before `pnpm test`; re-run timing failures alone.

- Contracts (27.2): `packages/shared/src/where-work-runs.ts:148-185` (`CreateTrialRequest`, `Trial`, `TrialResponse`, `KeepTrialRequest`, `TRIAL_*` texts, `trialKeepConfirmText`), `events-where-work-runs.ts:120-142` (trial events), `api.ts:615-627` routes, `ids.ts` `TrialId`; `core/src/where-work-runs.ts:105` `Trials`; `core.ts:132,331` `trials: undefined`; `server/src/where-work-runs-routes.ts` (trials block, `refusal` needs `AgentMidTurnError`/`UncommittedChangesError` mapping, check `workbenchRefusal` first), `app.ts:190`, `start.ts:~470-480,632`; tests `server/test/where-work-runs-routes.test.ts:101-137`, `gate.test.ts:627`, `bmad-guard-coverage.test.ts:109`.
- Chat API to use (`core/src/chat/types.ts`): `chatAgents(ws)` (`unavailable`), `createChatSession(ws, {agentId, location:'worktree', autoTitle})`, `sendMessage`, `deleteChat(ws, ses, {discardUncommitted})`, `putAwayWorktree(ses, 'not_kept')`, `worktreeIdle`; uncommitted check: `chat/delete-chat.ts` `hasChanges` (expose as `Chat.copyHasUncommitted(ws, ses)`).
- Store pattern: `core/src/worktree-put-away-store.ts` (`events.transaction`, `events.append` for workspace stream `streamId: workspaceId`); schema `core/src/db/schema.ts:617`; migration `pnpm --filter @ogden-agents/core db:generate` (next `0043`); Delete history `event-log.ts:477` (delete the workspace's trials there).
- Retention: `core/src/worktree-retention.ts` sweep's filter: add `spared?: (sessionId) => boolean` option, wired in `core.ts:325` from the trial store (undecided trial rows plus an in-memory set while a trial starts).
- Core tests: `core/test/worktree-retention.test.ts` setup, `test/support/worktree-chat-fakes.ts`, multi agents via `createAgentRegistry([registered('a', …), registered('b', …)])` (`test/helpers.ts:47`).
- Web: `chat/agent-picker.tsx:21` (item after the agent list ~64, optional `onTrySeveral` prop), `routes/new-chat-page.tsx:45-195` (draft text `readDraft(newChatDraftKey(wsId))`, `chat/drafts.ts`); `chat/use-chat-agents.ts:44` `agentAvailability`; router `router.tsx:266-274` (`/w/$wsId/try/$tryId`, lazy); page layout `routes/workspace-runs-page.tsx`; `ui/state-glyph.tsx` `StateGlyph labelMode="visible"`; changes `workbench/changes-api.ts:81` `useChanges(wsId,{view:'branch',session})` sum `additions`/`deletions`; Review changes link `/w/$wsId/workbench?panel=changes&session=`; `chat/copy-ignored-files.tsx` `CopyIgnoredFiles`; `worktrees/worktree-retention.ts:53` `usePutAwayWorktrees`, `worktrees/put-away-notice.tsx` `useRestoreWorktree`; `events/use-event-invalidation.ts`; AlertDialog pattern `chat/delete-chat-dialog.tsx`.
- e2e: `tests/e2e/chat-server.ts:39` `withChatServer`, `tests/support.ts:186` `fakeSecondAgent` passed as `{extra:{extraAgents:[a,b]}}` (`agent-choice.spec.ts`), git setup and axe in `worktree-retention.spec.ts:26-57`, `tab.ts:105` `expectNoHorizontalOverflow`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/where-work-runs.ts`, `events-where-work-runs.ts`, `api.ts` -- `Trial` gains `text` and `chats: {sessionId, agentId, result: open|kept|put_away|removed|left}[]`; `KeepTrialRequest` gains `others: put_away|delete` (default `put_away`) and `discardUncommitted` (default false); `workspace.trial_kept` gains `removed`, `left`; `GET workspaceTrials` → `TrialsResponse` (newest first); texts (dialog title, retention line `trialRetentionText(keep, count)`, delete choice and confirmation, `left` line, unready refusal, "Part of a try" link).
- [x] `packages/core/src/db/schema.ts` + migration -- `trials` (id, workspace FK cascade, text, kept session id, created at) and `trial_chats` (trial FK cascade, position, session id no FK, agent id, result).
- [x] `packages/core/src/trials.ts` (new), `core.ts`, `index.ts`, `where-work-runs.ts`, `event-log.ts` -- store and `createTrials({chat})` implementing `Trials` plus `list`; `spared` for retention.
- [x] `packages/core/src/chat/delete-chat.ts`, `chat/types.ts`, `chat.ts` -- `copyHasUncommitted`.
- [x] `packages/core/src/worktree-retention.ts` -- `spared`.
- [x] `packages/server/src/where-work-runs-routes.ts`, `start.ts` -- list route, refusals, wiring.
- [x] `packages/web/src/*` -- picker item, `trials/try-dialog.tsx`, `trials/trials-api.ts`, `routes/try-page.tsx` (columns stack below `md`), keep dialog (choice; delete lists each copy's ignored files and names uncommitted changes), router, invalidation on trial, put-away and state events, session page link to its try.
- [x] Tests: core every matrix row; server routes end to end with fake agents; web dom (dialog readiness disabled with reason, retention line, keep dialog both choices); `tests/e2e/try-several-agents.spec.ts` (two fake agents, both side by side, keep one, restore the other; axe; 390px).

**Acceptance Criteria:**
- Given a fixture repo and two fake agents, when a trial starts and one is kept, then the other's copy is put away, nothing is merged, and Restore brings it back with its changes.
- Given `pnpm typecheck`, `pnpm test` and the new e2e spec after `pnpm run build`, then all pass.

## Implementation Notes

- `Trial` keeps `sessionIds` beside the new `chats` (the started event and the sidebar link read it). Migration `0043_chief_robbie_robertson.sql`.
- Core exposes `trialStore` and `createTrials({chat, onChatError, onKept})` (made over the server's chat, like retention) instead of a `trials` field; `Trials` gains `list`. Retention's `spared` is `trialStore.spared`: undecided trial rows plus `holdStarting` while a start is making its chats. After Keep the server runs the sweep once (`onKept`).
- An unknown agent is 409 `invalid_operation` (checked against `chatAgents` before anything is made); `AgentNotReadyError`/`UnknownAgentError` raised later by creation map to the same 409.
- Review fix: `KeepTrialRequest.discardUncommitted` became `discard: SessionId[]` (max 3), the chats the confirmation named. Core discards only those, and only while the chat's `updatedAt` and state are as at the idle check; any other changed copy is refused (409 `uncommitted_changes`) before anything goes. The dialog names copies from each copy's Unstaged and Staged views (unreadable counts as changed) and a put-away copy's saved files, and keeps Confirm disabled until those reads and the put-away list settled; a 409 anyway names every other copy and asks again.
- Review fix: a failed start discards a made chat's changes only while it is as `createChatSession` returned it; `holdStarting(workspaceId)` spares every chat of the project made after the start began (from before creation returns) until the row is written or the start fails; `onKept(sessionId)` and the server's sweep spares the chat kept.
- "+N -M" sums Branch, Staged and Unstaged (review fix: Branch alone read "+0 -0" for an agent that doesn't commit).
- `CopyIgnoredFiles` uses its own `useId` so several copies can be listed in one dialog.
- Verified (after review fixes, 2026-11-01, load ~7 rising to ~19): `pnpm typecheck` clean; `pnpm test` 478 files, 6205 passed, 13 skipped, 1 timing failure (`server/test/trials.test.ts` real-server case at 5 s under load) that passed re-run alone (3 of 3); after `pnpm run build`, Playwright try-several-agents (axe, 390px), worktree-retention, worktree-chat and new-chat 9 of 9; provenance check passed. Migration `0043_chief_robbie_robertson.sql`: renumber on merge if a sibling lane also adds `0043`.

## Plan Change Log

## Review Triage Log

Pass 1 (2026-11-01; lenses: quick and defensive, fresh subagents given the diff; the defensive lens checked that Keep never deletes another chat's uncommitted work without its confirmation and that a trial never starts a remote or refused agent, with a scratch experiment). Verdicts: high 1, medium 5, low 4, false 0, maybe-false 0. No intent_gap or bad_plan: each fix is internal or narrows this story's own request; 6 patched, 4 rejected.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | One `discardUncommitted` covered every other copy, so a copy whose reads were still loading (or the put-away list unloaded, or changed after reading) was discarded unnamed (both lenses) | high | patch | `discard = named.length > 0` applied server-wide; `KeepTrialRequest.discard` now lists the named ids, others deleted without discard (refused first), Confirm waits for every read; tests |
| 2 | A turn that ran in a named copy during the Keep was discarded under the earlier confirmation | medium | patch | `deleteChat`'s re-check is within its own run; discard now only when the session's `updatedAt`/state match the idle check; test |
| 3 | Start rollback deleted with discard even if the user messaged a made chat meanwhile | medium | patch | discard only when unchanged since creation; `store.insert` failure path tested |
| 4 | The sweep after Keep had no `spare`, so the kept chat could be put away | medium | patch | reproduced by the defensive lens (cap 1, older copy mid-turn); `onKept` spares the kept id; test |
| 5 | A copy of a trial still starting could be put away during `readyCopy` (hold taken after creation returned) | medium | patch | row visible before the hold; the workspace is held from before creation; test |
| 6 | "+N -M" counted the Branch view only, so uncommitted work showed "+0 -0" | medium | patch | implementer saw it in e2e; Branch, Unstaged and Staged summed |
| 7 | Keep's idle check for a put-away other skips busy and switching | low | reject | a put-away chat runs nothing; the fix needs new chat surface |
| 8 | Keep accepts a put-away chat as the one kept | low | reject | UI hides it; keeping it changes no work, Restore still applies |
| 9 | The dialog's task is empty when draft storage is blocked | low | reject | the task is an editable field in the dialog, so the user sees and fills it |
| 10 | A copy restored during a Keep is recorded `put_away` | low | reject | record only; no work lost; rare |

## Deferred (for the sweep)

- The sidebar tooltip's "Try: <task>, 1 of 3" (EXPERIENCE.md): the sidebar reads no trials yet; the session page links to its try instead.
- The column's latest activity line (EXPERIENCE.md): no such line exists in the web yet; the column shows the state glyph and word.
- "Waits for a free slot": chats have no concurrency limit (decision 3); if one is added, trial chats past it should wait with those words.
- A copy restored during a Keep is recorded `put_away` (review 10); Keep's idle check for a put-away other skips busy and switching (review 7).

## Design Notes

Keep order: validate, refuse mid-turn and (delete without discard) uncommitted for every other chat first; then each other goes (put away or delete), a refusal leaving it `left`; then the kept row, results and `workspace.trial_kept` in one transaction. A repeat after a crash skips chats already put away or gone. Restore of a not-kept copy uses 27.6's route; the page reads the put-away list to show Restore.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors
- `pnpm test` -- expected: all pass (timing failures re-run alone)
- `pnpm run build && pnpm exec playwright test tests/e2e/try-several-agents.spec.ts tests/e2e/worktree-retention.spec.ts` -- expected: pass
- `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs` -- expected: pass
