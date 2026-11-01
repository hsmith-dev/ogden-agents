---
title: 'End-to-end suite and v1.3 release part (epic 27); live checks with real agents and a remote machine'
type: 'feature'
ticket: '10'
created: '2026-11-01'
status: 'in-review'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
baseline_revision: 'd746f6840432e8dc91f564fff2d8f515a521ea3b'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-where-work-runs/epic-where-work-runs.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 27's nine stories each have browser tests against the dev server, but no journey runs where-work-runs together against the installed package on all three OSes (E27-R8, Done when 5); the installed server has no fake remote host, so a remote Location can't be shown there; the docs don't mention where work runs; and the user's live checks (real agents in worktree chats, a real SSH host, a try with two real agents) have no list or place for their results.

**Approach:** As 8.13 and 26.10: one installed-suite journey with fakes only (CI runs it on macOS, Windows and Linux), project `where-work-runs` after `workbench`: a Worktree chat from the composer (branch badge, its port reaching the fake agent as `PORT`); the agent edits; Commit these changes; Move to this folder (divider) and back; Delete chat lists an ignored `.env` first; the cap at 1 puts an older idle copy away, Restore brings it back; Try with several agents (Claude Code and Codex, both the fake), Keep this one, the other put away and restored; a remote Location on epic 19's fake remote host refuses the Local model. A test-only hook `OGDEN_AGENTS_TEST_REMOTE_HOST=memory` gives the installed server the in-memory remote host. README, CHANGELOG (existing `## Unreleased`), RELEASING.md live checks for epic 27, docs/v1-readiness.md. This story does not release.

**Decision (autonomous, 2026-11-01):** the remote host hook follows the existing hook pattern (declared in `test-hooks.ts`, honoured only under `testHooksAllowed`); no product behaviour changes.

## Boundaries & Constraints

**Always:** fakes only (the installed fake agent and its Codex personality, temp data and home folders, a fake git repo, the in-memory remote host); no real agent, SSH, key, keychain or network; Windows-safe timeouts (`SLOW`); work only in this worktree; commit locally only; the whole installed suite run once to catch drift; `node scripts/check-provenance.mjs` passes.

**Never:** bump a version, tag, publish, push or open a PR; `git stash` or switch branches; record a live result nobody observed; change product code beyond the test hook unless the journey finds a real bug (then the smallest fix, with a test, noted).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| PORT | Worktree chat, `has-env PORT` | reply ends with the badge port's last 4 digits | none |
| Hand-off with a commit | branch has a commit, uncommitted file | Move to this folder carries the file, branch kept; back reuses it | none |
| Delete chat | ignored `.env` and `node_modules/` in the copy | dialog lists `.env` only | Cancel first is not needed |
| Retention | cap 1, chat B then C | B put away, branch kept; Restore brings B's file, C put away | none |
| Local model remote | Local model chosen, Location menu | the machine item disabled with the Local model's reason; machine then Local model: send refused, no chat | none |

</frozen-after-approval>

## Code Map

- `packages/server/src/test-hooks.ts` -- add `REMOTE_HOST_ENV = 'OGDEN_AGENTS_TEST_REMOTE_HOST'`, `testRemoteHost(env, dataDir, tmp)` (`memory` or `undefined`, as `testManager`), `TestHooks.remoteHost`, `TestHookOptions` gains `'remoteHost'` (an option given decides it), `resolveTestHooks`, `testHooksLogFields` (inUse and field), header bullet. Tests beside `testManager`'s in `packages/server/test/test-hooks.test.ts`; the audit test (`test-hooks-audit.test.ts`) must still pass.
- `packages/server/src/start-agents.ts:174` -- `options.remoteHost ?? (hooks.remoteHost === 'memory' ? createMemoryRemoteHostPort() : createSshRemoteHostPort())` (import from `@ogden-agents/adapters`). Check where `resolveTestHooks` is called with options (start.ts) and pass `remoteHost`.
- `tests/e2e-installed/installed.ts` -- `bmadServer` options gain nothing new; pass `env: { OGDEN_AGENTS_TEST_REMOTE_HOST: 'memory' }` and `codex: true` from the spec (sets `CODEX_SERVER_ENV` and `CODEX_API_KEY`).
- `tests/e2e-installed/where-work-runs-journey.spec.ts` (new) -- shape of `workbench-journey.spec.ts` (servers, `SLOW`, `idle`, `quit`, `bmadServer(..)`, `server.addRepo({ bmad: false, git: true, prefix, files })`, `landConnected`, `expectConnected`, `storedToken` REST helper as `codex-journey.spec.ts` `api`). Selectors to copy: `tests/e2e/composer-setup-row.spec.ts` (`location-chip`, `location-worktree`, `data-location`), `tests/e2e/worktree-chat.spec.ts` (`worktree-badge`, `location-branch`, `worktree-port` "Port N", `location-hand-off` "Move to this folder"/"Move to its own worktree", `hand-off-confirm(-button)`, `location-changed-marker` texts, `session-menu`, `session-menu-delete`, `delete-chat-confirm`, `copy-ignored-file`, `.git/info/exclude`), `packages/web/src/workbench/worktree-commit.tsx` (`worktree-commit-message`, `worktree-commit-button`, `worktree-committed`; on `/w/:wsId/workbench?session=<ses>&panel=changes`), `tests/e2e/worktree-retention.spec.ts` (`/settings/worktrees`, `worktree-retention-keep(-save|-saved)`, `worktree-put-away`, `worktree-restore`), `tests/e2e/try-several-agents.spec.ts` (`agent-picker`, `agent-try-several`, `try-dialog`, `try-agent[data-agent]`, `try-start`, `try-column`, `try-column-state`, `try-keep`, `trial-keep-confirm(-button)`, `try-column-outcome`, `try-restore`), `tests/e2e/remote-target.spec.ts` (machine add/check/confirm over REST: `API_ROUTES.remoteMachines`, `remoteMachineHostKeyCheck` then `remoteMachineHostKeyConfirm`; `location-machine[data-machine]`), `packages/web/src/chat/new-chat-agent.tsx` (`agent-local-only`), composer error `composer-error`. Fake prompts: `has-env PORT` (`PORT=set ending <last 4>`), `write-doc <path>`. Local model reason: `LOCAL_ONLY_REASON` in `packages/adapters/src/acp-opencode/opencode-agent.ts`. Delete chat keeps a branch with commits (`chat/delete-chat.ts`), and a move back reuses a kept branch (`chat/location.ts`). Set the cap back to 15 before the try so retention doesn't put trial copies away.
- `tests/e2e-installed/playwright.config.ts` -- project `where-work-runs` after `workbench`; `journey` depends on it; header and order comments.
- Run: `pnpm run pack`, then `pnpm e2e:installed --project where-work-runs --no-deps`, then the whole `pnpm e2e:installed` once.
- `_bmad-output/initiative-ogden-agents/deferred-work.md` -- no entry names 27.10. Epic 27-owned index lines: "The new-chat draft has no permission mode choice" (done by 27.1's draft mode chip) and "The turn snapshot store under `<data>/snapshots` is never cleaned" (27.6's `createSnapshotCleanup`): `Resolved:` Log entries quoting them, index lines removed. "A failed first send's chat is remembered only while the new-chat draft stays open" stays open: owner becomes Unowned (epic 27 closes without it). Index updated-by sentence gains "and by 27.10".
- Docs: `README.md` "What you can do" one bullet; `CHANGELOG.md` items under `## Unreleased`; `RELEASING.md` "Live checks for where work runs (epic 27)" after the epic 8 section; `docs/v1-readiness.md` a Feature coverage row and an "Evidence still required" line.

## Tasks & Acceptance

**Execution:**
- [x] `packages/server/src/test-hooks.ts`, `start-agents.ts` (and `start.ts` if options feed hooks), `packages/server/test/test-hooks.test.ts` -- the remote host hook and its unit test
- [x] `tests/e2e-installed/where-work-runs-journey.spec.ts`, `tests/e2e-installed/playwright.config.ts` -- the journey and its project
- [x] run the journey through the installed flow, then the whole installed suite once; record results; fix drift found
- [x] `deferred-work.md` -- two Resolved entries, one owner change, index sentence
- [x] `README.md`, `CHANGELOG.md`, `RELEASING.md`, `docs/v1-readiness.md` -- docs
- [x] this plan's **For the user** table

**Acceptance Criteria:**
- Given the installed package with the fake agents and the fake remote host, when the journey runs, then every step in Intent passes and the server quits cleanly.
- Given the hook unset, or set outside a test run, then the server uses the real SSH host port (unit test).
- Given the user's checks, then **For the user** lists each with a place for its result, and the plan stays `in-review` until they are recorded.

## For the user

Live checks only you can run (RELEASING.md, "Live checks for where work runs (epic 27)"). Run each in the installed desktop app and with `npx ogden-agents@latest`, in a scratch git repo, on each OS; write what you saw in its cell. Nothing here has been observed yet.

| # | Check | macOS | Windows (x64) | Linux (x64) |
|---|-------|-------|---------------|-------------|
| 1 | A real agent (Claude Code at least) in a Worktree chat from the composer: branch badge and port shown, its edit only in the copy, `$PORT` matches the badge, Commit these changes commits on the chat's branch | not yet run | not yet run | not yet run |
| 2 | Hand-off with a real agent: Move to this folder with an uncommitted edit, the agent carries on there (resuming where its adapter can); Move back to its own worktree; a move mid-turn is refused | not yet run | not yet run | not yet run |
| 3 | Delete chat lists an ignored `.env` in the copy first; with the cap at 1 a second worktree chat puts the first away, and Restore brings back its uncommitted edit | not yet run | not yet run | not yet run |
| 4 | Try with two real agents (Claude Code and Codex, or another pair): side by side, each in its own copy and port; Keep this one, the other put away and restored with its changes | not yet run | not yet run | not yet run |
| 5 | A real SSH host: added and its host key confirmed in Settings > Remote machines, picked as Location in the composer, the chat runs there ("on <machine>"); with the Local model chosen the machine is disabled with its reason | not yet run | not yet run (Windows as the client) | not yet run |
| 6 | CI: the installed `where-work-runs` journey passes on macOS, Windows and Linux after the push | not yet run | not yet run | not yet run |

## Implementation Notes

- `packages/server/src/test-hooks.ts`: `REMOTE_HOST_ENV` (`OGDEN_AGENTS_TEST_REMOTE_HOST`), `testRemoteHost` (`memory` only under `testHooksAllowed`), `TestHooks.remoteHost`, `TestHookOptions` gains `remoteHost` (a given port decides it), `resolveTestHooks`, the log line's `remoteHost` field, and a header bullet. `start.ts` already passes all of `options` to `resolveTestHooks`, so it needed no change. `start-agents.ts` takes `createMemoryRemoteHostPort()` under the hook, else `createSshRemoteHostPort()` as before. Unit test beside `testManager`'s; the hooks audit test passes.
- `tests/e2e-installed/where-work-runs-journey.spec.ts` (new): one server (`bmadServer` with `codex: true` and the remote host hook), a fake git repo with only `README.md`. Steps in Intent order. The port's last four digits are read from the `worktree-port` badge and matched in the agent's `PORT=set ending` reply. Move to this folder carries only the uncommitted `draft.md` (the committed `notes.md` stays on the kept branch); moving back makes a new copy on that branch with both. Delete chat runs on the moved-back copy (its `.env` and `node_modules/` excluded through `.git/info/exclude`), keeps the branch with its commit. Retention: cap 1, then 15 again before the try. The machine is added, checked and confirmed over REST (the memory host's default fingerprint, read from the check). The Local model's reason is read from `LOCAL_ONLY_REASON`'s source line so the two never drift (a clear error naming the file if the line changes form; importing the adapter module would pull core into the spec); the disabled machine item is checked for `aria-disabled` and its reason, not clicked. "Machine then Local model" opens the draft with `?machine=<id>&agent=local` (the Local model isn't choosable in the picker on an install with no endpoint set up); the server's `LocalOnlyAgentError` comes before the readiness check, so the send is refused with the reason and no chat is made.
- The try's two chats are also checked for two different ports (`API_ROUTES.sessionLocation`), as epic Done when 3 asks.
- `tests/e2e-installed/installed.ts` `bmadServer`: `OGDEN_AGENTS_TEST_REMOTE_HOST` is set to '' in the base environment, as every other owned hook is, so the runner's own environment can't turn it on; a spec's `env` overrides it.
- `packages/server/test/remote-host-wiring.test.ts` (new): through the started server's real `wireAgents`, the in-memory host only with the hook `memory` in a test run, the SSH host when unset or outside a test run, and a remote host given to `start()` wins.
- `tests/e2e-installed/playwright.config.ts`: project `where-work-runs` after `workbench`; `journey` depends on it; header and order comments.
- `deferred-work.md`: two `Resolved:` Log entries (the draft's permission mode chip, 27.1; the snapshot store cleanup, 27.6), their index lines removed; "A failed first send's chat is remembered only while the new-chat draft stays open" now Unowned; the index sentence names 27.10.
- Docs: README one bullet; CHANGELOG five items under `## Unreleased`; RELEASING.md "Live checks for where work runs (epic 27)" after the epic 8 section; docs/v1-readiness.md a Feature coverage row and an "Evidence still required" line.
- No product code changed beyond the test hook: the journey found no bug. The first run's only failure was the test's own click on a disabled menu item (that click was later removed).

## Plan Change Log

## Review Triage Log

Pass 1 (quick lens, fresh subagent given the diff and the plan): 6 findings; medium 1, low 4, rejected 1; patched 5, deferred 0.

| # | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|
| 1 | The forced click on the disabled machine item is followed by a `not.toHaveAttribute` that passes on its first poll, so it proves nothing | low | patch | True: no `data-machine` before the click. Click and assertion deleted; the disabled state and its reason stay checked. |
| 2 | "Machine then Local model" opens the draft with both in the URL, not by choosing them in the UI | low | rejected | On an install with no Local model endpoint the picker won't choose the Local model, so a user can't take that path either; the URL is the shipped `?machine=` and `?agent=` route, and the server refuses before readiness. Making it choosable needs a fake endpoint: more than a direct fix for a low finding. |
| 3 | The "real SSH host port" criterion is tested only at the hook resolver, not at `wireAgents`' choice | medium | patch | Unmet acceptance criterion; unit test added for the choice (hook memory, unset, and a given `remoteHost` winning). |
| 4 | `bmadServer` blanks every owned hook but not `OGDEN_AGENTS_TEST_REMOTE_HOST`, so the runner's env could turn it on for every installed server | low | patch | True (`prepareInstall` passes `process.env`); blanked in the base env, the spec's `env` overrides it. |
| 5 | `LOCAL_ONLY_REASON` parsed from source with a regex and `!`: a reformat throws an unhelpful TypeError at load | low | patch | The import would pull `@ogden-agents/core` into the spec (`opencode-agent.ts` imports it), so the source read stays, with the `!` gone and a clear error naming the file when the line does not match. |
| 6 | The try's two chats aren't checked for different ports (epic Done when 3) | low | patch | One assertion: both ports numbers and different, from the session location route. |

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `uptime` load below 40, then `pnpm test` -- all pass
- `pnpm run build && pnpm exec playwright test tests/e2e/worktree-chat.spec.ts tests/e2e/remote-target.spec.ts` -- pass
- `pnpm run pack && pnpm e2e:installed --project where-work-runs --no-deps` -- pass; then `pnpm e2e:installed` -- record results
- `node scripts/secret-scan.mjs`; `node scripts/check-provenance.mjs` -- pass

**Results (2026-11-01, macOS arm64, local):**
- `pnpm typecheck`: no errors.
- `pnpm test` (load about 2.4): 487 files, 6343 passed, 13 skipped.
- `pnpm exec playwright test tests/e2e/worktree-chat.spec.ts tests/e2e/remote-target.spec.ts` (after `pnpm run pack`'s build): 3 passed.
- `pnpm run pack && pnpm e2e:installed --project where-work-runs --no-deps`: passed (the first run failed only on the test's own click of a disabled menu item; the click was later removed after review).
- `pnpm e2e:installed` (whole suite once): 57 passed in 2.2 min; no drift found.
- `node scripts/secret-scan.mjs`: nothing found. `node scripts/check-provenance.mjs` (also with `PROVENANCE_BASE` at the baseline): passes.
- Windows and Linux: not run here; CI runs the installed suite on both (For the user, row 6).

After review (parent, 2026-11-01, macOS arm64, load about 3): `pnpm typecheck` clean; `pnpm test` 488 files, 6347 passed, 13 skipped; `pnpm run pack` (build included), then `worktree-chat.spec.ts` and `remote-target.spec.ts` 3 passed (`--retries=0`) and `pnpm e2e:installed --project where-work-runs --no-deps` 1 passed; secret scan clean; provenance passes, also with `PROVENANCE_BASE` at the baseline. Status stays `in-review`, not `built`: this ticket is hitl, done only when **For the user** is filled.
