---
title: 'A port per worktree, and the project setup command run in each new copy'
type: 'feature'
ticket: '7'
created: '2026-11-01'
status: 'built'
baseline_revision: '63fbf07b80eefdf552e07ff77fc3333976661c20'
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

**Problem:** Parallel worktree chats all start dev servers on the same port, and nothing prepares a new copy (E27-R6; CAP-35; AD-38, AD-16). 27.2 left `WorktreePorts`, `PortProbePort` (memory stub only), `WORKTREE_PORT_RANGE` 41000 to 41999 and the `session.port_assigned` / `session.port_released` events unimplemented; `chatLocation` always answers `port: null`.

**Approach:** Each worktree chat holds one stable port from the range, recorded with the chat, probed free on `127.0.0.1` only, released when its copy is put away, handed back or deleted, and given again on Restore (the same one when still free, else another). The chat's agent (and its own terminal when it drives) gets it as `PORT` through the allowlisted environment. A project may declare a setup command (id `setup`) beside 8.9's test and lint, confirmed and trusted the same way; it runs through 8.9's runner in each new copy (created, handed off to, restored) with `PORT`. The port and the setup run's state show beside the branch badge.

## Boundaries & Constraints

**Always:** the probe binds `127.0.0.1` only (never `0.0.0.0`, `::` or a hostname) and closes at once; assignments are serialized so two chats never hold one port (a partial unique index backs it); lowest free port first, so a released port is reused; an assignment that fails or finds none leaves the chat working with `port: null`; only the name `PORT` is added to a child's env, its value a decimal in the range, on top of `baseEnvironment()` (never `process.env`, never a key); the setup command runs only in a trusted project, only while confirmed (a `package_json` one checked against the copy's own files), with the copy as cwd, never a shell, never awaited by chat creation; events stay ids, ports, states and counts; no em or en dashes in UI strings.

**Never:** a port for this-folder, remote or build sessions; binding a public interface; passing `PORT` to Problems runs or terminal panes (both run in the project folder and have no chat; Deferred); blocking the agent's first turn on setup; a setup command detected from `package.json`; editing `deferred-work.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Two at once | two worktree chats created concurrently | ports 41000 and 41001, one `session.port_assigned` each; each agent's env `PORT` differs | none |
| Taken by another program | probe says 41000 busy | 41001 given | none |
| None free | every port held or busy | chat created, `port: null`, no `PORT` | logged with session id |
| Released and reused | chat A put away (41000), chat B created | B gets 41000; `session.port_released` for A | none |
| Restore, port free | A restored, its old port free | A gets its old port back | none |
| Restore, port taken | A's old port held by B | A gets the lowest other free one | none |
| Hand off | worktree → this folder / this folder → worktree | released / assigned | none |
| Delete chat | worktree chat deleted | its port row gone with it | none |
| Setup confirmed | trusted, `setup` = `node setup.js` | runs in the copy with `PORT`; Location shows its state | a failure shows `failed`, chat unaffected |
| Setup unconfirmed | `package_json` setup whose script changed, or untrusted project | never runs, runner never called | none |
| No setup | none declared | nothing runs, `setup: null` | none |
| Non-worktree chat | this-folder chat | no `PORT` in its env, `port` absent | none |

</frozen-after-approval>

## Code Map

Project root is the worktree `/Users/harrisonsmith/Library/Caches/ogden-agents-dev-worktrees/27.7`; every path is relative to it. Never edit another checkout, `git stash`, push, switch branches or commit (the orchestrator commits). Wait for `uptime` load below 40 before `pnpm test`; re-run timing failures alone.

- Contracts (27.2): `packages/shared/src/where-work-runs.ts` (`SessionLocation` worktree variant has `port`; `WORKTREE_PORT_RANGE`), `events-where-work-runs.ts:21` `TcpPort`, `:87-102` port events; `packages/core/src/where-work-runs.ts:90-103` `WorktreePorts`, `PortProbePort`; `core.ts:129,319` `worktreePorts: undefined`; `adapters/src/port-probe-memory/index.ts`.
- Store pattern: `packages/core/src/worktree-put-away-store.ts` (row + session event in one transaction via `sessionEvents.appendSessionEvent`); `db/schema.ts:616` `chatWorktreesPutAway`; migration `pnpm --filter @ogden-agents/core db:generate` (next `0042`; renumber on merge if a sibling adds one).
- Chat hooks: `core/src/chat/types.ts:121-158` options (`vcs`, `onChatWorktreeAdded`); `chat/context.ts:114` `agentEnv(sessionId)` (used by `chat/agents.ts:106` start input and `chat/terminal.ts:164,210`): add `PORT` there for a worktree chat holding a port; `chat/workspaces.ts:372-380` after `create()` (assign, then ready); `chat/location.ts` `toWorktree` after `setSessionWorktree` (assign, ready), `toThisFolder` after `setSessionWorktree` (release), `chatLocation` (`port`); `chat/put-away.ts` `putAwayNow` after `store.insert` (release), `restoreNow` after `store.remove` (assign, ready) and its returned location; `chat/delete-chat.ts` (row cascades with the session).
- `core/src/chat-locations.ts` `createChatLocations(chat)` -- add the setup summary to a worktree location (from `ProjectCommands.setupOf`).
- Setup: `core/src/project-commands.ts` (`ProjectCommandRunner.start({cwd, argv})` gains `env?: {PORT: string}`; `runs`/`latest` maps keyed `keyOf`; `stillConfirmed`, `packageJsonOf`, `packageManagerOf`, `bindingOf` take a root: pass the copy; `close()` already stops every run); `adapters/src/project-commands-node/index.ts:104` env; `project-commands-memory/` records env.
- Probe adapter: new `adapters/src/port-probe-node/index.ts` (`net.createServer().listen({host:'127.0.0.1', port, exclusive:true})`, `EADDRINUSE`/`EACCES` → not free, any error → not free, a short timeout); export from `adapters/src/index.ts`.
- Server: `server/src/start.ts:403-447` `createChat` options (`worktreePorts`, `onChatWorktreeReady` → `core.projectCommands?.runSetup`, log ids only), `:589` `createChatLocations(chat, …)`; core option for the probe (`OpenCoreOptions`, as `projectCommandRunner`).
- Web: `web/src/routes/session-page.tsx:599-611` `BranchBadge` (`WORKTREE_BADGE_TOOLTIP_TEXT`); `chat/chat-api.ts:239` (add `useSessionLocation` GET `API_ROUTES.sessionLocation`); `events/use-event-invalidation.ts` (invalidate on the port events and `workspace.project_command_*`); `workbench/workbench-problems.tsx` (hide id `setup`; `commandIdFor` treats `setup` as taken); `routes/workspace-settings-page.tsx` sections pattern (`DefaultAgentSection`), `workbench/problems-api.ts` list/set, `workspaces/script-trust-prompt.tsx`.
- Tests: `tests/fixtures/fake-acp-agent.mjs:965` `has-env PORT`; `tests/e2e/worktree-chat.spec.ts` (`withChatServer`, `git init`); server tests `packages/server/test/workbench-changes.test.ts` style with real git; `packages/adapters/test/` (real sockets on 127.0.0.1 are fine there).

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/where-work-runs.ts`, `project-commands.ts`, `index.ts` -- `WORKTREE_PORT_ENV = 'PORT'`; `WORKTREE_SETUP_COMMAND_ID = 'setup'`; worktree `SessionLocation` gains `setup: {runId, state}` nullable; texts: `worktreePortText(port)` "Port 41000", `worktreePortTooltip(port)` "Runs on port 41000 in this copy", setup state lines, Workspace settings "Worktree setup" title, hint ("Runs in each new worktree copy, with PORT set to the copy's port. One program and its arguments, no shell."), labels.
- [x] `packages/core/src/db/schema.ts` + migration -- `chat_worktree_ports` (session id PK FK cascade, port int, held int, assigned at; unique on port where held).
- [x] `packages/core/src/worktree-ports.ts` (new), `core.ts`, `index.ts` -- `createWorktreePorts({db, sessionEvents, probe, range?})` implementing `WorktreePorts` (one chain): `assign` returns the held port; else the chat's remembered one when no other holds it and the probe says free; else the lowest unheld, probed-free port in the range; `null` when none; row + `session.port_assigned` in one transaction. `release` keeps the row unheld (the remembered port) with `session.port_released`. Only for a local chat session with a worktree.
- [x] `packages/core/src/chat/{types,context,workspaces,location,put-away}.ts`, `chat-locations.ts` -- options `worktreePorts`, `onChatWorktreeReady(sessionId, {workspaceId, worktreePath, port})`; `PORT` in `agentEnv`; the hook points in the Code Map (each failure caught and reported, never failing the chat's operation); `chatLocation` and Restore's answer carry the port.
- [x] `packages/core/src/project-commands.ts` -- `runSetup({workspaceId, sessionId, cwd, port})` → the run or `undefined` (no setup, untrusted, unconfirmed, closing); one setup run per chat (a new one stops the old); `setupOf(sessionId)`; runs readable by `get`/`stop`; the `setup` command never offered.
- [x] `packages/adapters/src/port-probe-node/index.ts` (new), `project-commands-node/index.ts`, `project-commands-memory/index.ts`, `index.ts` -- the probe; runner adds only `PORT` (refuses any other name or a non-port value).
- [x] `packages/server/src/start.ts` (and `start-*.ts` as fits) -- wiring.
- [x] `packages/web/src/*` -- `useSessionLocation`; beside the branch badge: "Port 41000" (`data-testid="worktree-port"`, tooltip) and, when a setup ran, its state with Show output (the run's masked output from `GET project-command-runs/:runId`); Workspace settings "Worktree setup" section (trust prompt when untrusted; field, Save, Remove, through `PUT project-commands` keeping the other commands); Problems hides `setup`.
- [x] Tests -- core: every matrix row (memory probe; concurrent assigns; reuse; restore same/other; hand-off; delete cascade; env `PORT` only for worktree chats; setup confirmed/unconfirmed/untrusted/none with the memory runner's recorded cwd and env); adapters: real probe (a server held on 127.0.0.1 answers busy, a free port true, listens on `127.0.0.1` only), node runner `PORT` reaches the child and other names are refused; server: two worktree chats created at once with the fake agent's `has-env PORT` and a real `node setup.js` writing `process.env.PORT` into each copy; web dom tests; Playwright `tests/e2e/worktree-chat.spec.ts` (port beside the badge; axe; 390px).

**Acceptance Criteria:**
- Given a trusted fixture repo with a confirmed setup command, when two worktree chats start at once, then each agent reads a different `PORT` and each copy holds the setup's file naming its own port.
- Given `pnpm typecheck`, `pnpm test` and the touched e2e spec after `pnpm run build`, then all pass.

## Implementation Notes

- Ports: `core/src/worktree-ports.ts` (one promise chain; the remembered row stays `held = 0`; migration `0042_short_stardust.sql`, partial unique index on `port WHERE held = 1`). `chat/copy-port.ts` holds the hook points (`readyCopy`: assign then `onChatWorktreeReady`; `releasePort`), each failure to `onInternalError`. Creation awaits the assign (so the first turn has `PORT`) but never the setup.
- Setup: `ProjectCommands.runSetup` keeps setup runs per chat (`setups` map), apart from Problems' one-run-per-command `latest`; `run(…, 'setup')` is refused (409). Copy reads use the files port's `chat_worktree` root kind (the data-folder fence).
- Server tests default to the memory probe (`test/helpers.ts`), so parallel files never race for a real port; the real probe is the adapters' test and the e2e's.
- 27.2's `worktreePortText` (the tooltip line) became `worktreePortTooltip`; `worktreePortText` is now "Port 41000" as this plan names it.
- Restore's answer carries `setup: null` (the setup starts after the answer; the Location route carries the run).
- `gate.test.ts` and `bmad-guard-coverage.test.ts` gained 27.6's `GET …/worktree/ignored-files` route, which the baseline left out of their lists (both failed on the baseline).
- Review fixes (pass 1): `ProjectCommands.stopSetup(sessionId, {forget})` wired as the chat's `stopChatSetup`, awaited (bounded by `stopBeforeRemovalMs`) beside the agent and terminal before a put-away (refused when it won't stop), a hand-back (before anything moves) and Delete chat or history (the copy left and reported, the run forgotten); Restore gives the port while the chat is still held; `ProblemsTrust` exported (`text`, `testId`) and used by Worktree setup.
- Verified (after review fixes, load ~7): `pnpm typecheck` clean; `pnpm test` 475 files, 6173 passed, 13 skipped; after `pnpm run build`, Playwright worktree-chat (port beside the badge, axe, 390px), workbench-problems and worktree-retention 4 of 4; provenance check passed. Migration `0042_short_stardust.sql`: renumber on merge if a sibling lane also adds `0042`.

## Plan Change Log

## Review Triage Log

Pass 1 (2026-11-01; lens: quick, fresh subagent given the plan and the diff). Verdicts: high 0, medium 2, low 1, false 0, maybe-false 0. No intent_gap or bad_plan: each fix is internal (no route or schema); all three patched by the implementer.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | A running setup is never stopped when its copy is put away, handed back or deleted: it keeps writing there (half put away, Windows `EPERM`, a lingering `setups` entry) | medium | patch | only a newer `runSetup` or `close()` stopped one; put-away and Delete chat wait for the agent and terminal only; a stop for the chat's setup is awaited (bounded) before each removal |
| 2 | Restore gives the port after `puttingAway` is cleared, so a send in that gap starts the agent without `PORT` | medium | patch | `readyCopy` ran after the `finally`; moved inside, while the chat is held |
| 3 | Worktree setup's trust prompt copies `ProblemsTrust` line for line | low | patch | one exported prompt used by both |

## Deferred (for the sweep)

- Terminal panes and Problems runs get no `PORT`: both run in the project folder and belong to no chat; when a pane or a run can target a chat's copy, give it that copy's port. 27.9: logged in `deferred-work.md`.
- On macOS a port held on the wildcard address can still bind on `127.0.0.1`, so the probe may call it free (Design Notes). 27.9: logged in `deferred-work.md`.
- A held port isn't probed again after a server restart; a program that took it meanwhile makes the copy's dev server fail to start until the copy is put away or handed back. 27.9: logged in `deferred-work.md`.
- The agent's first turn doesn't wait for the setup command (a `npm install` may still run); a "Setting up" hold on the composer would need a product call. 27.9: logged in `deferred-work.md`.
- A setup command that didn't run because its `package.json` script changed shows nothing beside the badge; it could say so. 27.9: logged in `deferred-work.md`.

## Design Notes

Autonomous calls (2026-11-01): the range stays 41000 to 41999 (the ticket's assumption; clear of common dev ports; inside Linux's default ephemeral range, so an outbound socket may briefly hold one, which the probe skips). Only `PORT` is set (EXPERIENCE.md names no other). Problems runs and terminal panes are project-folder only with no chat, so they get no `PORT` now. Setup runs in the background: the chat isn't held for it. The setup command is declared in Workspace settings (EXPERIENCE.md has no place for it), stored with the other project commands.

On macOS a port held on the wildcard address can still bind on `127.0.0.1` (SO_REUSEADDR), so the probe may call it free; the program then fails to start on it, and the next copy gets another.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors
- `pnpm test` -- expected: all pass (timing failures re-run alone)
- `pnpm run build && pnpm exec playwright test tests/e2e/worktree-chat.spec.ts` -- expected: pass
- `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs` -- expected: pass
