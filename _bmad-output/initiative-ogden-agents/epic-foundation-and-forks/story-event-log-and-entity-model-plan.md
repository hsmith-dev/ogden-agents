---
title: 'Event log and entity model'
type: 'feature'
ticket: '3'
created: '2026-09-29'
status: 'built'
baseline_revision: '2e4dd2bc108a18c615320d167ffb6afa144e5e44'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The tracer's in-memory bus loses everything on restart and replays only the latest event, so a reconnecting page shows duplicates or gaps. None of the entities later epics build on (workspace, session, run, IDs) exist yet.

**Approach:** Put the persistent, append-only event log (AD-5) and the entity model (AD-8, AD-9) in core, backed by SQLite through Drizzle and `better-sqlite3` in the per-user data folder. Core is the only writer (AD-11). Clients subscribe "after sequence N" and get exactly the missed events, then live ones. Message chunks are compacted once a message completes, history is deletable per workspace, and logs go to the data folder.

## Boundaries & Constraints

**Always:**
- Every event is appended by core with envelope `{ id: evt_<ULID>, seq, workspaceId, streamId, type, at, payload }`, validated by a Zod schema in `packages/shared`. `seq` increases strictly across the install and is assigned by SQLite.
- `packages/core` owns the database and every write (AD-11). Server routes call core, and adapters never touch the database.
- IDs are prefixed ULIDs (`ws_`, `ses_`, `run_`, `evt_`). Agent session IDs and CLI resume IDs go in a session's `adapterRefs`, never in keys (AD-9).
- Workspace paths are stored canonical: the real path, case-folded on case-insensitive filesystems (AD-2).
- Session `state` ∈ `working|waiting|idle|done|error` (AD-4) and `driver` ∈ `ui|terminal` (AD-6). Run `outcome` ∈ `running|verified|failed|blocked|stopped` (AD-8).
- The data folder comes from the OS per-user data directory (`ogden-agents/`), with an `OGDEN_AGENTS_DATA_DIR` override for tests. Nothing is written into user repos.
- No ticket content or status is stored, only ticket refs (AD-10).

**Never:**
- No routes or UI for creating workspaces or sessions (epic 2); this story provides the model, core operations and tests.
- No security gate (story 1.4), no cost or token fields (AD-8), and no secrets in events or logs (AD-16).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Catch-up | Client subscribes after seq N while events N+1…M exist | Receives N+1…M in order, then live events, with no gap or duplicate | No error expected |
| Restart | Server stops and starts on the same data folder | Earlier events are still readable; new `seq` values continue above the old maximum | No error expected |
| Page reconnect | Page reconnects after a drop | Page resubscribes after its last seq, and nothing shows twice | No error expected |
| Compaction | `session.message_delta` ×k then `session.message_completed` for one message | The completed event carries the full content; that message's deltas are removed afterwards; a client resuming mid-message ends with exactly the completed message | No error expected |
| Invalid event | Core asked to append a payload failing its schema | Nothing is written and seq is unchanged | Throws a typed validation error |
| Delete history | Delete history for one workspace | Its events, sessions and runs are gone; other workspaces are untouched; its workspace row remains | No error expected |
| Duplicate workspace | Same repo added via a symlink or different case | The existing workspace is returned; there is no second row | No error expected |
| Bad subscribe | Client sends `afterSeq` that isn't a non-negative integer | Ignored with a warning; the connection stays open | Logged at warn |

## Decisions

- Install-level events (such as `server.started`) carry `workspaceId: null`, meaning Ogden Agents itself. Every workspace-scoped event carries a real `ws_` ID. The architecture's AD-5 is amended to allow `null` (user, 2026-09-29).
- Logging keeps the existing JSON-lines logger and adds a size-capped rotating file in the data folder. There is no logging library (user, 2026-09-29).

</frozen-after-approval>

## Code Map

Baseline `bb4451b` on `story/1.3-event-log-and-entity-model` (built on 1.1 and 1.2).

- `packages/core/src/event-bus.ts` -- the temporary in-memory bus to replace. Its `emit`/`subscribe` callers are `packages/server/src/start.ts` and `app.ts`.
- `packages/shared/src/events.ts` -- `ServerStartedEvent`, `PongMessage`, `ServerMessage`, `ClientMessage`. Extend these into the envelope, entity schemas, the `subscribe` client message, and session message events (`session.message_delta` and `session.message_completed`, keyed by `messageId`).
- `packages/server/src/app.ts` -- `/ws` currently subscribes on open. Instead, wait for the client's `{ type: 'subscribe', afterSeq }` and stream from there.
- `packages/web/src/App.tsx` -- clears its list on each open (1.1 review fix). Replace with tracking the last seq and resubscribing after it.
- `packages/server/src/log.ts` -- the JSON-lines logger to extend with a size-capped rotating file in the data folder.
- `tests/packaging.test.ts` -- new runtime deps (`better-sqlite3`, `drizzle-orm`, `env-paths`, `ulid`) must be declared with matching ranges in `packages/core` and the root.
- `tests/architecture.test.ts` -- core may now depend on third-party packages; internal edges are unchanged.
- Registry facts:
  - `better-sqlite3` 13.0.3: Node ≥ 22, Node-API prebuilds for all 8 targets, no bundled types. `@types/better-sqlite3` 9.6.0 predates v13; check that the API used compiles.
  - `drizzle-orm` 0.45.3 exports `./better-sqlite3` and `./better-sqlite3/migrator`; `drizzle-kit` 0.31.11 generates SQL migrations.
  - `env-paths` 4.0.0 (Node ≥ 20) and `ulid` 3.0.2.

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/` -- ID schemas (prefixed ULID), workspace/session/run entity schemas with the enums above, the event envelope, event types (`server.started`, `session.message_delta`, `session.message_completed`, `workspace.history_deleted`), and client `subscribe`. This extends the contract.
- [x] `packages/core/src/db/` -- the Drizzle schema (`workspaces`, `sessions`, `runs`, `events` with `seq INTEGER PRIMARY KEY AUTOINCREMENT` and indexes on `(workspace_id, seq)` and `(stream_id)`), SQL migrations generated by `drizzle-kit` and committed, and `openDatabase(dataDir)` with WAL mode that migrates on open. This is the persistence.
- [x] `packages/core/src/data-dir.ts` -- resolves the data folder via `env-paths('ogden-agents', { suffix: '' })` or `OGDEN_AGENTS_DATA_DIR`, and creates it with user-only permissions.
- [x] `packages/core/src/event-log.ts` -- `append`, `readAfter(seq, { workspaceId?, limit })`, `subscribe(afterSeq, listener)` (backlog then live, gap-free, synchronous), `completeMessage` (append completed, then prune deltas) and `deleteWorkspaceHistory`; delete `event-bus.ts`. This is the event log.
- [x] `packages/core/src/entities.ts` -- `ensureWorkspace(path)` with canonical-path dedupe, and create/update helpers for sessions and runs that emit events. This is the entity model.
- [x] `packages/server/src/{start,app,log}.ts` -- open the database in the data folder, append `server.started` on boot, implement the `subscribe` protocol, and add rotating file logging in the data folder.
- [x] `packages/web/src/App.tsx` -- track the last seq, and on reconnect resubscribe after it.
- [x] Root and `packages/core` `package.json`, and `pnpm-lock.yaml` -- declare the new deps with identical ranges.
- [x] Tests in `packages/core/test/` and `packages/server/test/` -- cover every matrix row, including restart on a temp data folder and a WebSocket client that disconnects and resubscribes after N.

**Acceptance Criteria:**
- Given events 1…M exist, when a WebSocket client subscribes after N, then it receives exactly N+1…M, then new events live.
- Given a data folder with events, when the server restarts on it, then those events are served and `seq` continues upward.
- Given the full suite, when `pnpm test` and the clean-install smoke test run, then both pass, with `better-sqlite3` loading from the installed tarball.

## Implementation Notes

- Event types beyond the four named: the entity helpers must emit events, so `workspace.created`, `session.created`, `session.state_changed`, `session.driver_changed` (AD-6's name), `run.created` and `run.outcome_changed` were added to the shared contract. Session and run events use the session ID as `streamId` (the run view is the session view); workspace events use the workspace ID; install-level events use `streamId: 'server'` with `workspaceId: null`.
- Each event type has an input schema (`NewCoreEvent`, no `id`/`seq`/`at`) and a stored schema (`CoreEvent`). `append` validates the input before any write, so an invalid event throws `EventValidationError` and leaves `seq` untouched. Unknown payload keys are stripped, not stored.
- Entity writes and their events share one transaction (`EventLog.transaction`); subscribers are notified only after commit. `subscribe` reads its backlog until a read comes back empty, then registers, all synchronously, and drops any event at or below its cursor.
- `openCore(dataDir)` wires database, event log and entities; the server owns and closes it. `StartOptions` gained `dataDir` and `core` (replacing `bus`); `RunningServer` exposes `dataDir` and `core`.
- Migrations: `packages/core/drizzle/0000_init.sql` (generated by `drizzle-kit generate --name init`). `tsdown` copies them to `packages/server/dist/drizzle/`, which `assemble-dist` carries into `dist/drizzle/`; core looks there first, then in `packages/core/drizzle/`.
- `pnpm-workspace.yaml` denies `esbuild`'s build script (pulled in by `drizzle-kit`, dev only); pnpm otherwise fails the install on an unapproved build. `better-sqlite3` 13 ships prebuilds and needs no build script. `@types/better-sqlite3` 9.6.0 compiles against the API used.
- Logs: stderr plus `<dataDir>/logs/server.log`, rotated at 5 MiB, keeping 3 old files.
- The launcher test and the smoke script now run with a temp `OGDEN_AGENTS_DATA_DIR`, and the smoke client sends `subscribe` before waiting for `server.started`.
- Orchestrator: the uncommitted 1.3 work was rebased (stash, rebase, pop; no conflicts) from `0c7a4a7` onto `2e4dd2b`, which adds only 1.2's Windows smoke fix and CI note. `baseline_revision` moved with it so the review diff covers only 1.3.
- Matrix test audit (orchestrator, macOS, Node 24.21): all 8 rows have tests that ran and passed (65 passed; 1 skipped is the case-sensitive-filesystem test `it.runIf(!caseInsensitive)`, which runs on Linux CI); `pnpm pack` plus the smoke test pass with `better-sqlite3` and migrations loading from the installed tarball.
- CI confirmation (PR #2, after the rename): the first run failed only the Windows data-folder test, which assumed the env-paths folder ends in the app name (Windows adds `\\Data`); fixed in `b93b335`. GitHub Actions run 36667176996: 6/6 green, including `better-sqlite3`, migrations, symlink/junction and permission paths on Windows.

## Plan Change Log

## Review Triage Log

### Pass 1 (quick lens) — 2026-09-29

Counts: high 0, medium 3, low 4, false 0, maybe-false 0.

| # | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|
| 1 | `subscribe` inside an open transaction can skip a real event after a rollback (SQLite reuses the rolled-back seq) | low | reject | Verified that seq is reused after a rollback, but no caller subscribes inside a transaction; the fix is a new guard for an unreachable state. Noted for later callers. |
| 2 | `Core` exposes the raw DB handle, which `RunningServer.core` hands to the server | medium | patch | Breaks AD-11's "only core writes"; unused by the server. Fixed: `Core` is `events`, `entities`, `close`; `openDatabase` is no longer exported. |
| 3 | `append` doesn't check that a session event's `workspaceId` matches its session | medium | intent_gap → user: carry to epic 2 | No mismatching caller today; the design fix (a session-event helper deriving `workspaceId`) belongs to epic 2. Recorded in epic 2's Notes and deferred-work.md. |
| 4 | A fresh page load replays the whole install history synchronously | medium | intent_gap → user: carry to epic 2 | Harmless at today's size and grows with retention; needs scoped, paged subscriptions designed with epic 2's UI. Recorded in epic 2's Notes and deferred-work.md. |
| 5 | `send` drops an event that fails `ServerMessage` after the cursor advanced | low | reject | Every stored event was validated on append; reachable only after a schema tightening, and the fix adds complexity. Noted: event schema changes must keep stored rows valid. |
| 6 | A failed `server.started` append leaves the port listening | low | patch | Fixed: close the HTTP server and `wss` before rethrowing; the test binds the port afterwards. |
| 7 | An explicit `dataDir` is not created with user-only permissions | low | patch | Fixed: `createDataDir`, mode 0o700, with tests. |

## Design Notes

- The persistence code lives in core, not in an adapter, because AD-11 says only core writes the database and adapters never hold a handle. SQLite isn't one of the things AD-1 bars from core (agents, OSes, sandboxes, CLIs, BMAD skills).
- `better-sqlite3` is synchronous, so appending and notifying subscribers happen in one tick. Reading the backlog and registering a subscriber also happen in one tick, which is what makes catch-up gap-free without locks.
- Migrations are generated by `drizzle-kit` into `packages/core/drizzle/`. The build copies them next to `dist/server.js` so the installed package migrates on first run.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test` -- expected: all pass, including the new core and server tests.
- `pnpm pack && node scripts/smoke-installed.mjs` -- expected: exit 0, with `better-sqlite3` loading from the installed package.

**Manual checks (if no CLI):**
- Run `pnpm start`, reload the page, then restart the server: `server.started` entries accumulate with increasing seq, and none repeat on reconnect.
