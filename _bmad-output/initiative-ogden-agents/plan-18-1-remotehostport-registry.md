---
title: 'RemoteHostPort: the remote-machine registry, with no real SSH yet'
type: 'feature'
ticket: '1'
created: '2026-10-07'
status: 'built'
route: 'oneshot'
route_source: 'pinned'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** CAP-24 needs an install-level record of the remote machines the user has added, with no SSH yet (story 18.2 on) and no credential field ever on this record.

**Approach:** Add a core-owned, database-backed registry (add/list/rename/remove), matching this repo's existing `LocalEndpoints` pattern exactly (not an adapter — this repo's adapters never touch Ogden's own SQLite; the architecture's `RemoteHostPort` groups the registry with the SSH connection conceptually, but the actual adapter boundary belongs to the SSH operations added in stories 18.2/18.4/18.5).

</frozen-after-approval>

## Implementation Notes

Investigated `packages/core/src/local-endpoints.ts` + `packages/shared/src/local-endpoints.ts` as the closest existing precedent (install-level, DB-backed, secret kept out of the row, one change-event type) and confirmed by grep that no existing `*-port.ts` adapter touches Ogden's own `db/schema.ts` tables — every adapter is an external-system boundary (git, keychain, child process, HTTP); all of Ogden's own persisted state (`workspaces`, `sessions`, `localEndpoints`, `notificationWebhooks`, `permissionRules`, ...) is owned directly by a core class. Corrected the ticket's framing accordingly: this story ships `RemoteMachines` (a core class, `packages/core/src/remote-machines.ts`), not a `RemoteHostPort` adapter interface. `RemoteHostPort` (the actual SSH connect/confirm-host-key/spawn/push-pull boundary) is deferred to story 18.2, where its real method shapes can be designed against real SSH semantics instead of guessed now.

Added: `RemoteMachineId` (`mach_` prefix) and `RemoteMachine`/`AddRemoteMachineRequest`/`RenameRemoteMachineRequest` schemas in shared; `settings.remote_machines_changed` event (added/renamed/removed, never the host/username/label) wired into `events.ts`'s two discriminated unions; the `remote_machines` SQLite table (`drizzle/0036_remote_machines.sql`, generated via `pnpm db:generate` then renamed from its random tag to match the journal); `createRemoteMachines` in core (list/get/add/rename/remove, `MAX_REMOTE_MACHINES` = 20, `NotFoundError`/`ValidationError` on the existing convention); wired onto `Core` as `core.remoteMachines(secrets)` beside `core.localEndpoints(secrets)`. `remove()` always calls `secrets.delete(remoteMachineSshSecretName(id))` (swallowed) even though nothing is stored yet, so story 18.2 doesn't need to touch this method. No server wiring, routes, or UI yet — nothing calls `core.remoteMachines(...)` outside this story's own tests until story 18.3 builds the Settings UI and its routes (matching how `core.localEndpoints(...)` itself has no caller until its own routes file).

Architecture test added (`tests/architecture.test.ts`): core/shared files for the registry import no SSH/network library, generalizing the existing orchestration "names no vendor" test technique to CAP-24.

## Verification

**Commands:**
- `cd packages/core && pnpm run db:generate` -- expected: one new migration for `remote_machines`, already run and committed
- `pnpm typecheck` -- expected: no errors
- `pnpm test` -- expected: all green, including `packages/core/test/remote-machines.test.ts` and the new CAP-24 block in `tests/architecture.test.ts`
