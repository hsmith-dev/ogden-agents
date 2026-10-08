---
id: 1
type: story
title: "RemoteHostPort: the remote-machine registry, with no real SSH yet"
parent: epic-remote-execution
covers: [R1, R7]
after: [epic-chat-and-workspaces]
hitl: false
risk: low
---

# RemoteHostPort: the remote-machine registry, with no real SSH yet

## Description

Adds the install-level remote-machine registry: add, list, rename and remove a remote machine (`RemoteMachineId`, prefix `mach_`, per the architecture's id-prefix note), install-level state (not workspace-scoped, like an agent's own sign-in) persisted in the database. A machine record holds only non-secret fields (host, port, username, display name, pinned host-key fingerprint, keypair public key, confirmed flag) — no credential lives on this record; that is entry 02.

Corrected during implementation (Decision, 2026-10-07): this is `RemoteMachines`, a core-owned class persisted directly against SQLite (`packages/core/src/remote-machines.ts`), matching the existing `LocalEndpoints` pattern exactly — not a `RemoteHostPort` adapter interface. This repo's adapters never touch Ogden's own database (every existing `*-port.ts` boundary is an external system: git, the OS keychain, a child process, HTTP); Ogden's own persisted state is always owned directly by a core class. The architecture's `RemoteHostPort` note groups the registry with the SSH connection conceptually (one subsystem a user adds a machine through), but the actual TypeScript port boundary belongs only to the SSH-touching operations (connect, confirm-and-pin a host key, spawn a process, push/pull a worktree), which do need an adapter and are deferred to stories 18.2/18.4/18.5 where their real shapes can be designed against real SSH semantics. No server wiring or routes yet: nothing calls `core.remoteMachines(secrets)` outside this story's tests until story 18.3 builds the Settings UI and its routes, mirroring how `core.localEndpoints(...)` has no caller until its own routes file.

## Acceptance Criteria

Verify: Unit tests in packages/core/test add, list, rename and remove a machine; removing a machine that has no stored credential is a no-op on SecretStorePort (nothing to clean up yet); the port's own architecture test (core/shared name no SSH library, following the existing vcs-port.ts/agent-port.ts convention) passes; a machine's non-secret record never includes a credential field.

## References

- parent — _bmad-output/initiative-ogden-agents/epic-remote-execution/epic-remote-execution.md
- architecture-ogden-agents/architecture-ogden-agents.md#ad-1 (RemoteHostPort note)
- architecture-ogden-agents/architecture-ogden-agents.md#ad-9 (machineId/mach_ note)
