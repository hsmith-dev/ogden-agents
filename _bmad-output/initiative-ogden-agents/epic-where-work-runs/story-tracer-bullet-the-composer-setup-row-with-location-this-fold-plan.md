---
title: 'Tracer bullet: the composer setup row with Location This folder and Worktree'
type: 'feature'
ticket: '1'
created: '2026-11-01'
status: 'built'
baseline_revision: '83b1cdde22837a9f0fde03aaaeba1c17bdc6225d'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: ['{project-root}/AGENTS.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A chat's agent, model, mode and place are chosen in three different spots (agent picker in the draft's footer, model chip, mode picker in the header) and a chat can't start in its own worktree at all, so work can't start where it should run without a dialog (E27-R1, E27-R2; CAP-35).

**Approach:** One setup row under the prompt box, in the draft and in every chat: Agent, Model, Mode and Location chips, each a small menu defaulting from the project (the agent chip is 6.6's picker, the mode chip the existing mode picker moved out of the header). Location offers This folder and Worktree; starting a chat with Worktree makes a worktree through `VcsPort` in the data directory on `ogden/chat/<ses>`, stores it as the chat's `worktreePath` and `branch` (8.2), and the chat's agent (and its terminal) runs there.

## Boundaries & Constraints

**Always:** git only through `VcsPort` (`topLevel`, `head`, `addWorktree`), serialized with the repo's other git work (`serializedByRepo`); the worktree is a direct child of `<data>/cw` (a real folder, owner only), never in the repo; `worktreePath` and `branch` set only at creation; the draft's mode is applied through the existing set-mode route (Skip all keeps Developer mode and its red confirmation); `/api/v1`, `{error:{code,message}}`; no em or en dashes in UI strings; chips 28px ghost with a Phosphor glyph, truncating, the row scrolling sideways inside itself below `md`.

**Never:** branch badge, Workbench rooted at the worktree, removal with the chat, restart checks (27.3); hand-off (27.4); remote machines in the Location chip (27.5; the existing machine picker stays beside it until then); retention, ports, trials; any merge or push; editing `deferred-work.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| This folder | draft, Location This folder, send | chat as today, `worktreePath` null | none |
| Worktree | git project at its top folder with a commit; Location Worktree, send | worktree `<data>/cw/<8>` on `ogden/chat/<ses>` from HEAD; agent cwd is it; its edit lands only there | none |
| Not a repo | plain folder, Worktree | no chat, no folder | 409 `invalid_operation`, plain sentence under the composer |
| Inside another repo | project is a subfolder of a repo | no chat | 409 `invalid_operation` |
| Remote + Worktree | `machineId` and `location: worktree` | no chat | 400 `validation_failed`; in the UI Worktree is disabled while a machine is picked |
| git fails | `addWorktree` throws | no chat | 409 `invalid_operation` |
| Mode picked | draft Auto (or Skip all confirmed), send | chat created, then its mode set, then the message | refusal shown; retry reuses that chat |
| Started chat | open a chat | row shows its agent, model, mode, place (place not changeable) | terminal drives: chips disabled with their reasons |

</frozen-after-approval>

## Code Map

The project root is the git worktree `/Users/harrisonsmith/Library/Caches/ogden-agents-dev-worktrees/27.1`: every path below is relative to it and every command runs there; never edit another checkout, never `git stash` (shared with other worktrees), push, switch branches or commit (the orchestrator commits). The machine is loaded by parallel builds: check `uptime` before a full `pnpm test`, and re-run a timing failure alone.

- `packages/shared/src/chat.ts` `CreateSessionRequest` -- add `location`; `ChatLocation` (`this_folder | worktree`) and texts beside it (or `workbench-changes.ts` near `chatWorktreeBranch`).
- `packages/core/src/chat/workspaces.ts:197` `createChatSession` -- the only creator; `packages/core/src/chat/types.ts:204` its options, `ChatOptions` (add `vcs?: Pick<VcsPort,'topLevel'|'head'|'addWorktree'>`); `entities.createSession` already takes `id`, `worktreePath`, `branch` (`checkedWorktree`).
- `packages/core/src/build-start.ts:88-144` -- pattern: top-level check with `paths.realpath`, `vcs.head`, `addWorktree`, realpath of the made folder. `build-worktrees.ts` `isRealFolder`, `ensureWorktreesRoot` pattern; `build-names.ts:130` `runShortId`; `repo-serialization.ts` `serializedByRepo`; `ids.ts` `newId`.
- `packages/core/src/chat/agents.ts:103` agent `cwd`; `chat/terminal.ts:162,261` terminal `cwd` -- use `session.worktreePath` when set.
- `packages/server/src/chat-routes.ts:173` POST sessions passes body to core; `start.ts:311` `vcs` (pass into `createChat` at ~392). `vcs-git` `addWorktree` already applies hooks off and `core.longpaths`.
- `packages/web/src/routes/new-chat-page.tsx` -- draft `onSend`, footer; `chat/new-chat-agent.tsx` `useNewChatAgent` (`settings` has `defaultPermissionMode`, `defaultModels`); `ChatAgent.permissionModes`, `models`, `defaultModel`.
- `packages/web/src/routes/session-page.tsx:538` header `PermissionModePicker` (move to composer `footer` ~794 beside `ModelPicker`); `SessionMenu` `onContinue` and `HandoffDialog` for the started chat's agent chip.
- `packages/web/src/permissions/permission-mode-picker.tsx`, `chat/model-picker.tsx` `ModelMenu`, `chat/agent-picker.tsx`, `chat/composer.tsx` footer container (`overflow-hidden`), `chat/chat-api.ts` `createChatSession`, `setPermissionMode`.
- Tests: `packages/core/test` (vcs-memory or a fake VcsPort), `packages/server/test/helpers.ts`, `packages/web/test/session-page.dom.test.tsx:398,418`, `permission-modes.dom.test.tsx`; e2e `tests/e2e/chat-server.ts` (`withChatServer`, `composer`), `retrospectives.spec.ts:124` (git init in a spec), fake agent `write-doc <relpath>` writes under its cwd.

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/chat.ts` -- `ChatLocation`, `CreateSessionRequest.location` (optional, default This folder), refine refusing `worktree` with a `machineId`; Location texts.
- [x] `packages/core/src/chat-worktrees.ts` (new) -- `CHAT_WORKTREES_DIR = 'cw'`, `ensureChatWorktreesRoot`, `isChatWorktreePath`.
- [x] `packages/core/src/chat/workspaces.ts`, `chat/types.ts`, `chat.ts` -- `location: 'worktree'`: refuse build/planning kinds and remote, check top level and head, make the worktree under `serializedByRepo`, create the session with that id, path (real) and branch; on failure after `addWorktree` remove the empty folder best effort; refusals as `InvalidOperationError` with plain sentences.
- [x] `packages/core/src/chat/agents.ts`, `chat/terminal.ts` -- cwd is the chat's `worktreePath` when it has one.
- [x] `packages/server/src/chat-routes.ts`, `start.ts` -- pass `location`; wire `vcs` into the chat.
- [x] `packages/web/src/chat/setup-row.tsx` (new) -- `LocationChip` (draft: choose; started: shows the place, other item disabled with its reason) and the started chat's `SessionAgentChip` (agent checked, Continue with another agent...).
- [x] `packages/web/src/permissions/permission-mode-picker.tsx` -- ghost chip styling for the row; `draftModeOptions(agent, developerMode)`.
- [x] `packages/web/src/routes/new-chat-page.tsx`, `chat/chat-api.ts` -- draft row: agent, model (`ModelMenu`, default from project then install), mode (project default), location; send creates with them, sets a picked mode, then sends; reuse of a failed first chat also matches the location.
- [x] `packages/web/src/routes/session-page.tsx`, `chat/composer.tsx` -- mode picker out of the header into the row; row scrolls sideways.
- [x] Tests: core (worktree chat made with branch and path; refusals; cwd), server route (location passed, remote refused), web dom (draft row, header without mode picker), `tests/e2e/composer-setup-row.spec.ts` (the verify, plus 390px no page scroll).

**Acceptance Criteria:**
- Given a git project, when Playwright starts one chat with This folder and one with Worktree from the composer and each runs `write-doc`, then the first file is in the project and the second only in the worktree, on `ogden/chat/<ses>`, with no dialog.
- Given a chat page, when it loads, then the header has no mode picker and the row has Mode, Model and Location chips.
- Given `pnpm typecheck` and `pnpm test`, then both pass.

## Implementation Notes

- No API error code `validation_failed` existed; it is added to `API_ERROR_CODES`. `readBody` takes an `issueCode` hook so the create route answers the shared refine's `location` issue as 400 `validation_failed` (every other bad body stays `invalid_request`). Core also refuses a `machineId` with Worktree (`ValidationError`) before any git.
- The chat routes map `InvalidOperationError` to 400 `invalid_request`; the create route answers a Worktree refusal as 409 `invalid_operation` itself, leaving the shared mapping alone.
- `vcs-git`'s `BRANCH` pattern did not allow `_`, so `ogden/chat/ses_…` was refused by `addWorktree`; `_` is now allowed.
- The worktree is made before the synchronous settings read and insert in `createChatSession` (that step must not await). Any failure after `addWorktree` started, or a workspace removed meanwhile, removes the folder best effort (`rmSync`, never through a link); the branch is left (no removal through `VcsPort` here, 27.3).
- The draft's model chip shows the project's default for the agent, else the install's, else the agent's own; a model is sent only when picked. Picks (model, mode) reset when the agent changes. The started chat's Location chip is hidden for a remote chat (27.5).
- Chip height is the new `--setup-chip-height` token (design-tokens test forbids raw px).

- Review fixes (pass 1): a worktree chat's permission checks use its worktree (`permissions.ts`); the header's `ml-auto` sits on an always-rendered element; the started chat's Agent chip shows only with several agents; the not-a-repo sentence covers a detached HEAD; the e2e spec reuses `expectNoHorizontalOverflow` and a shared `tabRest` in `chat-server.ts`.
- Verified (after review fixes): `pnpm typecheck` clean; `pnpm test` 5539 passed, 13 skipped, 1 failed (`bmad-catalog-catalog.test.ts` timing, load ~100), which passed re-run alone; after `pnpm run build`, Playwright composer-setup-row, new-chat, permission-modes, model-picker, agent-picker, remote-target, default-permission-mode and layout: 35 passed (390px checks included); provenance check passed.

## Plan Change Log

## Review Triage Log

Pass 1 (2026-11-01; lens: quick, fresh subagent given the plan and the diff). Verdicts: high 1, medium 0, low 5, false 0, maybe-false 0. No intent_gap or bad_plan; five patched by the implementer, one deferred into this plan.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | A worktree chat's permission checks (inside, command reach, protected paths, caution) resolve against the project folder, so worktree writes always ask and absolute writes into the main checkout can be auto-allowed | high | patch | `permissions.ts` `request` built `workspace` from the project; it now checks against the chat's `worktreePath` |
| 2 | Header loses `ml-auto` while the state loads with Developer mode off | low | patch | the wrapper moved onto `DriverToggle`, which renders only in Developer mode; moved to an always-rendered element |
| 3 | A single-agent install shows the started chat's Agent chip but not the draft's | low | patch | `AgentPicker` returns null under two agents; `SessionAgentChip` now follows the same rule |
| 4 | A detached HEAD gets "isn't a git repository with a commit" | low | patch | `vcs.head` is `undefined` for detached too; the sentence now covers both |
| 5 | The e2e spec re-implements the REST client and the overflow check | low | patch | uses `expectNoHorizontalOverflow` and a shared client in `chat-server.ts` |
| 6 | A failure after `addWorktree` leaves git's worktree record (and branch) for a removed folder | low | defer | rare path (workspace removed mid-create or the insert throwing); removal through `VcsPort` is 27.3's |

## Design Notes

Decisions (autonomous, 2026-11-01): chat worktrees live at `<data>/cw/<8 base32>` (short for Windows, beside builds' `<data>/w`), which settles 8.2's deferred check at creation (the only writer makes the path there). The draft's mode is set after creation through the set-mode route rather than a new create field, so Developer mode, confirmation and availability stay in one place. Until 27.5 the machine picker stays in the row and Worktree is disabled while a machine is picked. A started chat's Location chip only shows its place (hand-off is 27.4).

## Deferred (for the sweep)

- A failure after `addWorktree` succeeded (workspace removed meanwhile, or the insert throwing) removes the folder but leaves git's `.git/worktrees/<short>` record and the `ogden/chat/<ses>` branch; 27.3's removal through `VcsPort` should clean both (review 6). 27.9: done by 27.3 (`chat/workspaces.ts` `removeUnusedWorktree` removes the record and the branch through `VcsPort`).
- The workspace-files adapter still only checks a chat-worktree root is strictly inside the data folder; creation now always makes it in `<data>/cw`, so the adapter could tighten to that folder (8.2's deferred check, settled at creation here). 27.9: fixed (`workspace-files-node` takes `chatWorktreesRoot`; the server passes `<data>/cw`).

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors
- `pnpm test` -- expected: all pass (timing failures re-run alone)
- `pnpm run build && pnpm exec playwright test tests/e2e/composer-setup-row.spec.ts tests/e2e/new-chat.spec.ts tests/e2e/permission-modes.spec.ts tests/e2e/model-picker.spec.ts tests/e2e/agent-picker.spec.ts tests/e2e/remote-target.spec.ts tests/e2e/default-permission-mode.spec.ts` -- expected: pass
- `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs` -- expected: pass
