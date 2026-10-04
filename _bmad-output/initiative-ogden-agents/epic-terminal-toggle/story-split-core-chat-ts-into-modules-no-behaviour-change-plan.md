---
title: 'Split core chat.ts into modules (no behaviour change)'
type: 'refactor'
ticket: '11'
created: '2026-09-30'
status: 'built'
baseline_revision: '634b9a61af6427fbdaab47047a5f51c1c385c9b8'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-terminal-toggle/epic-terminal-toggle.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `packages/core/src/chat.ts` is one ~1,250-line closure (`createChat`) after 2.10, 9.4, 3.1 and 3.2. Lanes 3.3, 3.4 and 3.5 all edit it, and in one file they would collide (epic 2 retrospective A5; user decision 2026-09-30: split before the lanes).

**Approach:** Move the code, unchanged, into modules by concern under `packages/core/src/chat/`, sharing one context object. `chat.ts` keeps `createChat` and re-exports everything it exports today.

## Boundaries & Constraints

**Always:** Builds on 3.2 as merged (its errors, causes and import hook move with the code). Code moves verbatim: same statements in the same order, same identity checks, same error classes and messages. `createChat`, `Chat`, `ChatOptions`, `TerminalViewer` and every exported constant keep their names and types, exported from `chat.ts` (so `index.ts` is unchanged). Imports go one way, with no cycles. No module over 600 lines.

**Never:** Behaviour, API, event or log changes; fixes or renames found along the way (note them under Implementation Notes for 3.9); test edits beyond import paths; module-level mutable state.

</frozen-after-approval>

## Code Map

Current `chat.ts` (line numbers at 5d2d019; 3.2 adds about 30) → target module:

- l.94-137 exported constants, `clampCheckInDelay`, `deniedMessage` → `chat/constants.ts`.
- l.139-254 `ChatOptions`, `TerminalViewer`, `Chat`; l.291-356 `ToolCallState`, `Live`, `Terminal`, `Turn` → `chat/types.ts`.
- l.256, 289, 299-306, 358-396, 854-865 `nextUlid`, `newMessageId`, `later`, the option defaults, the maps (`live`, `busy`, `running`, `droppedAgents`, `terminals`, `switching`), `closing`, `dataHome`, `internalError`, `toAgentError`, `getWorkspace`, `getSession` → `chat/context.ts` (`ChatContext`, built once per `createChat`).
- l.258-287 `toolKind`, `toolStatus`, `capDiffs`, `sameDiffs`, `toolCallPayload` → `chat/tool-calls.ts`.
- l.398-444 delta coalescing, `finishReply` → `chat/replies.ts`.
- l.446-493 `clearQuiet`, `clearTurnTimers`, `armQuiet`, `checkIn` → `chat/check-in.ts`.
- l.522-543 `drop` (dropped-agent tracking), l.668-767 `storedAgentSessionId`, `agentFor` (reopen and resume), `promptFor`, l.908-914 `releaseAgent` → `chat/agents.ts`.
- l.495-518 `recordStoppedRequest`, l.691-714 `onPermissionRequest` → `chat/permission-requests.ts`.
- l.545-666 `hasNext`, `endTurn`, `fail`, `apply`; l.769-852 `runTurn`, `takeNext`, `drive`; l.1054-1132 `sendMessage` (queue), `cancel` → `chat/turns.ts`.
- l.867-1004 terminal handoff and l.1134-1163 `switchDriver`, `attachTerminal` → `chat/terminal.ts`.
- l.1006-1052 workspace methods, `deleteHistory` → `chat/workspaces.ts`.
- l.1165-1217 `settled`, `close` stay in `chat.ts` with `createChat`.

Other files: `core/src/index.ts` (`export * from './chat.js'`) is unchanged. `core/test/chat.test.ts` imports from `../src/index.js`, so it needs no edit. `src/db/` shows subfolders already work in core.

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/chat/context.ts` -- `ChatContext` holds the options-derived values, the six collections and `closing` as a field (`ctx.closing`). It also holds `internalError`, `toAgentError`, `later`, one `nextUlid` with `newMessageId`, and the getters.
- [x] `chat/constants.ts`, `chat/types.ts`, `chat/tool-calls.ts` -- move these as they are.
- [x] `chat/replies.ts`, `chat/check-in.ts`, `chat/agents.ts`, `chat/permission-requests.ts`, `chat/turns.ts`, `chat/terminal.ts`, `chat/workspaces.ts` -- each exports `createX(ctx, deps)`, which returns its functions. `deps` holds only functions from modules built before it.
- [x] `packages/core/src/chat.ts` -- the overview doc comment, `createChat` (builds the context, wires the modules in dependency order, returns the `Chat` object), `settled`, and `close` moved verbatim. It re-exports `./chat/constants.js` and the public types.
- [x] `_bmad-output/initiative-ogden-agents/deferred-work.md` -- add a Log entry: "Resolved: split `core/src/chat.ts` (story 3.11)". It lists the modules. The other files over 600 lines stay open.

**Acceptance Criteria:**
- Given the split, when `git diff --stat -- 'packages/*/test' tests` runs against the baseline, then it shows no change, or import paths only.
- Given `Object.keys(await import('@ogden-agents/core')).sort()` taken before and after, then the two lists are identical, and `pnpm typecheck` passes for server and web unchanged.
- Given `wc -l packages/core/src/chat.ts packages/core/src/chat/*.ts`, then every file is ≤ 600 lines.

## Implementation Notes

- **Re-mapped to 3de6f38.** The Code Map's lines are at 5d2d019; at 3de6f38 `chat.ts` is 1,264 lines. Moved ranges at 3de6f38: constants l.103-146; public types l.148-265; tool calls l.269-298; `ToolCallState`, `Timer`, `later`, `Live`, `Terminal`, `Turn` l.302-367; options and collections l.370-407; replies l.411-455; check-in l.459-504; `recordStoppedRequest` l.506-529; `drop` l.533-554; `hasNext` to `apply` l.556-677; `storedAgentSessionId`, `agentFor` (with `onPermissionRequest` l.702-725), `promptFor` l.679-778; `runTurn`, `takeNext`, `drive` l.780-863; getters l.865-876; terminal l.880-1049 (`releaseAgent` l.919-925 went to `agents.ts`); workspace methods l.1052-1097; `sendMessage`, `cancel` l.1099-1177; `switchDriver`, `attachTerminal` l.1179-1208; `settled`, `close` l.1210-1262. 3.2's pieces moved with their code: `DriverIsTerminalError` and the `switching` refusal in `sendMessage` (`turns.ts`), the driver-change causes (`user`, `cli_exited` in `terminal.ts`, `server_stopped` in `close`), `importTerminalTurns`/`turnsToImport` and `toChat` (`terminal.ts`).
- **Module map** (dependency order; each `createX(ctx, deps)` gets only functions of modules built before it): `constants.ts` → `types.ts` → `tool-calls.ts` → `context.ts` → `replies.ts` → `check-in.ts` → `permission-requests.ts` → `agents.ts` → `turns.ts` / `terminal.ts` → `workspaces.ts` → `chat.ts`. No cycles in `core/src` (checked with a script over every relative import, type-only included).
- **The only statement-level changes** (everything else is verbatim; checked line by line against 3de6f38, with `closing` read as `ctx.closing`): `agentFor` takes `apply` as a third argument and `runTurn` passes it; `onPermissionRequest` became `onPermissionRequestFor(session)` in `permission-requests.ts` (same body, still built once per `agentFor` call); the `Chat` methods sit in `Pick<Chat, …>` objects so their parameters keep their contextual types, and `createChat` assembles them in the same key order.
- **ULID factory.** `nextUlid` was module-level in `chat.ts` (one per process, shared by every `createChat`). It stays module-level in `context.ts` (not per context), exposed as `ctx.nextUlid`/`ctx.newMessageId`, so ordering is unchanged; no new module-level state was added.
- **Exports.** `Object.keys(await import('@ogden-agents/core')).sort()` (loaded through Vite SSR) is identical before and after (81 names); the throwaway script was deleted. `chat.ts` re-exports `./chat/constants.js` and the types `Chat`, `ChatOptions`, `TerminalViewer`; the internal types are not exported from the package.
- **Tests.** No test file changed (`git diff --stat -- 'packages/*/test' tests` is empty).
- **Verification.** Baseline (3de6f38): typecheck green; `pnpm test` 63 files, 852 passed, 4 skipped; `pnpm e2e` 79 passed twice; smoke OK. After: typecheck green; `pnpm test` 852 passed, 4 skipped (run twice); smoke OK. `pnpm e2e` after: 76/79, 78/79, 78/79, 77/79. Each failure was a different UI test that stalled about 15 minutes, far past its timeout (layout, permissions, sidebar, welcome, CSP, sign-in-again). The machine then had a load average near 9 from unrelated headless Chromium processes. A control run of the unchanged 3de6f38 code under the same load also stalled: `chat.spec` (15.7 min) and `sign-in-again` (11.9 min). Re-run `pnpm e2e` twice on a quiet machine or in CI before merge.
- **For 3.9 (found, not fixed):** `apply`'s `tool_call_update` uses `known?.` after `known` is checked defined; `close` loops `for (const entry of [live.get(sessionId)])` over one value; `sendMessage` re-reads the workspace instead of calling `getWorkspace`; the `{@link}`s in `chat.ts`'s overview (`Permissions`, `primedPrompt`, `TerminalPort`, …) and in `types.ts` no longer resolve in editors, as those names are not imported there; `turns.ts` (325 lines) is the largest module and the next to split if 3.3-3.5 grow it.

## Plan Change Log

## Review Triage Log

## Design Notes

Risk points are closures that share state, and how each stays together:

- **`closing`.** About 20 functions read it, and `close` sets it partway through. It becomes `ctx.closing`, read at each call. Never destructure it into a local or pass it as an argument: a copy would go stale. `close()` keeps its order: drivers set to `ui`, then `closing = true`, then terminals, then live agents, then dropped agents.
- **Collection identity.** The guards `live.get(id) === entry`, `busy.get(id) !== turn`, `droppedAgents.get(id) === stopped` and `terminals.get(id) !== entry` depend on there being one instance of each map. Each map is created once in `context.ts` and never copied or spread.
- **Mutated `Live` and `Turn` objects.** `reply`, `pendingDelta`, `deltaTimer`, `prime`, `unsavedRef`, `stopping`, `failed`, `queue` and `reasons` are changed across modules. They are typed once in `types.ts` and only ever passed by reference.
- **The agents ↔ turns cycle.** `agentFor` subscribes `apply`, and `fail` calls `drop`. `runTurn` (the only caller of `agentFor`) passes `apply` in as an argument, so `agents.ts` never imports `turns.ts`.
- **The 2.7 F4 pair.** `agentFor` sets `prime` and `unsavedRef`, and `runTurn` saves the ref after a primed prompt succeeds. Both use the same `Live` fields. Keep `promptFor` beside `agentFor` in `agents.ts`, and leave the save line in `runTurn` unchanged.
- **One monotonic ULID factory.** Message ids and `preq_` ids share it, so their ordering stays monotonic across both.
- **`apply`'s order.** `armQuiet` runs first, then a flush before any event that is not a chunk. It moves as one block.

Why the split comes after 3.2: 3.2's `chat.ts` edits are about 30 lines, and the split carries them. Putting 3.11 first would make 3.2 wait, and 3.6 and 3.7 (which come after 3.2 only) would wait with it.

## Verification

**Commands:**
- `pnpm typecheck && pnpm test` -- expected: green, with the same test count as the baseline.
- `pnpm build && pnpm e2e` -- expected: green.
- `wc -l packages/core/src/chat.ts packages/core/src/chat/*.ts` -- expected: each file ≤ 600.
