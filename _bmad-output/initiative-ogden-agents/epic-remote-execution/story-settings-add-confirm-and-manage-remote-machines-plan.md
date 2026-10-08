---
title: 'Settings: add, confirm and manage remote machines'
type: 'feature'
ticket: '3'
created: '2026-10-07'
status: 'built'
baseline_revision: 'ee45d1c3'
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

**Problem:** A user needs a UI to add a remote machine, see and confirm its host-key fingerprint, and manage machines afterward (view the public key again, remove one), with the server routes behind it.

**Approach:** REST routes over `RemoteMachines` (mirroring `local-endpoint-routes.ts`); a `RemoteMachinesSection` composing `AddMachineForm`, `HostKeyConfirmCard` (pending) and `RemoteMachineRow` (confirmed), under `/settings/remote-machines`.

</frozen-after-approval>

## Implementation Notes

Server: `packages/server/src/remote-machine-routes.ts` (GET/POST list+add, PATCH/DELETE one, POST host-key/check, POST host-key/confirm), wired through `start-types.ts`'s new `remoteHost?: RemoteHostPort` escape hatch, `start-agents.ts` (`core.remoteMachines(secrets, remoteHosts)`), `start.ts` and `app.ts`, following `local-endpoint-routes.ts`'s structure exactly (the same `refusal()`/`noStore()`/body-limit pattern). Added four new `ApiErrorCode`s (`remote_host_unreachable`, `remote_host_timeout`, `remote_host_key_changed`, `remote_host_key_not_confirmed`) and `RemoteMachinesResponse`/`RemoteMachineResponse`/`RemoteHostKeyCheckResponse` to shared.

Web: `packages/web/src/remote-machines/` (`remote-machines-api.ts`, `add-machine-form.tsx`, `host-key-confirm-card.tsx`, `remote-machine-row.tsx`, `remote-machines-section.tsx`), `packages/web/src/routes/remote-machines-settings-page.tsx` (header + section, split apart so the section can be tested without `WorkspaceHeader`'s `SidebarProvider`, matching `LocalEndpointsSection`'s own split), a router entry and a sidebar nav item (`Desktop` icon).

Design correction (recorded in the story file too): the public key does not exist until the first successful confirm, so the pending `HostKeyConfirmCard` shows only the fingerprint and Confirm; the confirmed `RemoteMachineRow` has a persistent "Show public key" disclosure rather than a one-time reveal, so the user can retrieve the `authorized_keys` line at any later time, not only in the moment right after confirming.

Caught only by the real build (`pnpm run build` + Playwright), not `pnpm test`/`pnpm typecheck`: `import { utils } from 'ssh2'` throws at runtime under Node's native ESM loader (`SyntaxError: Named export 'utils' not found` — cjs-module-lexer detects `Client` as a named export of ssh2's CommonJS module but not `utils`, even though both are plain keys of the same `module.exports = {...}` object literal) despite typechecking fine and working under vitest's own transform. Fixed with a default import destructured afterward (`import ssh2 from 'ssh2'; const { Client, utils } = ssh2;`) in `remote-host-ssh/index.ts` and its test. Also added `createMemoryRemoteHostPort`/`createSshRemoteHostPort`/`RemoteHostError`/`RemoteHostPort`/`RemoteMachines` to `packages/server/src/index.ts`'s re-exports, since `tests/support.ts`'s `serverModule()` (used by Vitest launcher tests and Playwright alike) reads the built server bundle, not the adapters/core packages directly.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors
- `pnpm run build` -- expected: clean
- `npx vitest run` (full suite, including a fixed `gate.test.ts` route inventory) -- expected: all green
- `npx playwright test tests/e2e/remote-machines.spec.ts` -- expected: both specs green (this is what caught the ssh2 import bug above)
