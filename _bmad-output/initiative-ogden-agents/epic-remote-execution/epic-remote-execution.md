---
tracker_id: ""
key: ""
type: epic
title: "Chat and build with an agent on another machine over SSH"
parent: initiative-ogden-agents
covers: [CAP-24]
after: []
assignee: ""
risk: high
---

# Chat and build with an agent on another machine over SSH

## Description

CAP-24 (v1.1): a user adds another computer (macOS, Linux or Windows) as a chat or build target by giving Ogden Agents SSH access to it. That machine needs nothing of Ogden Agents installed, only one of the supported agent CLIs and SSH reachability: Ogden spawns the agent's ACP process over the SSH connection (its stdio piped through) instead of locally, reusing the existing ACP session, permission-card and event-log machinery unchanged. The motivating case is cross-platform build verification: a ticket's build fans out to run natively on a Mac, a Linux box and a Windows box at once, each under its own per-OS sandbox and HITL approval exactly as epic 5's single-machine model works today, surfaced as one aggregated review once every machine's run finishes.

This epic's architecture is resolved by AD-24 (worktree/commit sync over the same SSH channel, `[ADOPTED]`) and AD-26 (SSH credential and host-key model, `[ADOPTED]` 2026-10-07, with the keypair-ownership sub-question resolved below). **AD-25 (multi-machine fan-out: one authored diff verified on N machines, aggregated like the board) is explicitly NOT adopted** — its own text reads "Left unmarked, not [ADOPTED] ... Confirm this reading before a build ticket is written against it." This epic therefore delivers the full single-remote-machine capability (CAP-24's core success criterion: a chat or build runs on one remote machine exactly as it would locally) as real, buildable stories, and carves the multi-machine fan-out/aggregation piece into its own story (08) that is **ticketed but blocked**, not built, pending that adoption decision. See Notes for the full flag.

## Outcome

A user who already has SSH access to another one of their own machines (with the agent CLI installed there) can add it in Ogden's Settings, confirm its host key once, and then pick it as a chat or build target exactly like a local one — permission cards, resume, the event log and Approve's merge all work the same, and that machine needed nothing of Ogden installed on it.

## Requirements

- R1 (CAP-24): Ogden spawns the agent's ACP process over an SSH connection it itself initiates; stdio is piped through; no persistent agent or daemon and no new network listener on the remote machine.
- R2 (CAP-24, AD-24): the run's worktree is created locally exactly as today (AD-17), then its tracked contents are streamed to the remote machine over the same SSH connection used to spawn the agent (not a second transport); the remote never receives or needs a credential to the project's origin remote.
- R3 (CAP-24, AD-24): the remote's resulting diff is read back over the same connection before the run's outcome is recorded; approve continues to merge only from the controller's own worktree and git history.
- R4 (CAP-24, AD-24): a dropped connection before a terminal outcome is recorded `blocked`/`connection_lost`, never left `running` and never guessed `verified`; the server attempts to reap the remote process on reconnect; a retry always re-syncs a fresh remote worktree.
- R5 (CAP-24, AD-26): each remote machine's SSH credential goes through `SecretStorePort` exactly as AD-16 stores agent API keys, namespaced `remote-machine-ssh/<machineId>`, reaching only the server's own outbound SSH connection, never the browser or an event payload; adapters redact it before emitting events.
- R6 (CAP-24, AD-26): host-key verification is user-confirmed-then-pinned the first time a machine is added (fingerprint shown, explicit logged confirm, mirroring AD-15's `confirm: true`); the confirmed fingerprint is pinned per machine in Ogden's own store, not merely appended to `~/.ssh/known_hosts`; a later connection whose host key changed is refused outright, never silently re-prompted.
- R7 (CAP-24, non-goal boundary): Ogden does not provision, discover, or install anything on the remote machine; the machine is assumed already reachable over SSH with the agent CLI already present.
- R8 (CAP-24 success criterion): a chat or an unattended build on a single remote machine behaves exactly as it would locally — permission cards, resume and the event log all work the same.
- R9 (CAP-24, AD-25 — NOT adopted, carried here only as a placeholder requirement for the blocked story): a ticket built across several machines at once produces one combined review after each machine's own gate passes. Blocked until a human adopts or revises AD-25.

## Done when

1. A user adds a remote machine in Settings (host, user, credential), sees and confirms its host-key fingerprint once, and the machine is usable only after that explicit confirm; a later changed host key is refused outright.
2. A chat session started against that machine spawns the agent's ACP process over SSH, with permission cards, message streaming, resume and the event log indistinguishable in the UI from a local chat.
3. An unattended build dispatched to that machine creates the run's worktree locally, streams it to the machine over the same SSH connection, runs the build under the remote's own per-OS sandbox and HITL rule, reads the resulting diff back, and Approve merges it from the controller's own checkout exactly as a local run.
4. A dropped SSH connection mid-run is recorded `blocked`/`connection_lost`, never silently `verified`, and a retry re-syncs a fresh worktree to a fresh per-run remote directory.
5. No remote machine's SSH private key or passphrase ever appears in the database, an event payload, or a log line.
6. CAP-24's multi-machine fan-out requirement (R9) is explicitly out of this epic's Done when until AD-25 is adopted — story 08 stays `planned`/blocked, not built, and is called out as remaining work, not silently dropped.

## Boundaries

Single remote machine, interactive chat and unattended build, over SSH only. Not: remote machine provisioning/discovery, installing or updating the agent CLI remotely, any transport other than SSH, persistent remote daemons (all CAP-24 non-goals), and not multi-machine fan-out/aggregation (AD-25, not adopted — story 08 only).

## References

- spec — `_bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md`, CAP-24 entry and its Constraints/Non-goals lines
- architecture — `_bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md`, AD-24 (lines 339-351), AD-25 (lines 353-363, not adopted), AD-26 (lines 365-375), the `RemoteHostPort` note under AD-1, the `machineId`/`fanOutId` note under AD-9 (Run), the id-prefix note (AD-... `mach_`/`fan_`)
- precedent — `packages/core/src/secret-store-port.ts`, `packages/adapters/src/secrets-keyring/index.ts` (AD-16 keychain pattern)
- precedent — `packages/web/src/permissions/permission-mode-picker.tsx`, `packages/core/src/chat/permission-mode.ts` (the `confirm: true` / Skip-all guardrail pattern this epic's host-key confirm step is modeled on)
- precedent — `packages/core/src/build-start.ts`, `packages/core/src/vcs-port.ts`, `packages/adapters/src/vcs-git/index.ts` (AD-17 worktree lifecycle this epic's remote sync rides on top of, unchanged)
- precedent — `packages/adapters/src/acp-base/acp-agent.ts` (`createAcpAgent`, the `AcpLaunch` seam a remote launch plugs into)

## Notes

- Decision (this ticket-slicing pass, 2026-10-07): AD-26's keypair-ownership sub-question is resolved as **Ogden generates and owns a fresh Ed25519 keypair per added machine** (not reuse of the user's own key), matching AD-26's own stated lean and this project's existing precedent of Ogden owning its secrets outright rather than reading the user's credential stores (AD-16). The private key is stored through `SecretStorePort` under `remote-machine-ssh/<machineId>`, the public key is shown to the user once (with a copy action and the exact `authorized_keys` line) for them to install on the remote machine by hand — CAP-24's non-goals rule out Ogden provisioning the remote machine itself, so Ogden cannot install it there either. Rationale: a user-supplied key could be a passphrase-protected key Ogden can't read non-interactively, could be reused elsewhere (raising blast radius if Ogden's data dir is compromised), and reusing AD-16's "Ogden owns the secret" posture keeps one security model instead of two. Trade-off accepted: the user does one extra manual step (appending the shown public key to the remote's `authorized_keys`) versus "point at my existing key" — judged worth it for isolation (revoking Ogden's access means removing one line, never the user's own key) and for not asking Ogden to read a passphrase-protected private key file it didn't create.
- Flag (needs a human call, not guessed past): **AD-25 is not adopted.** The task that produced this epic described AD-24/25/26 as "all now [ADOPTED]," but the architecture document's AD-25 section (lines 353-363) explicitly reads "proposed, not adopted" and "Left unmarked, not [ADOPTED] ... Confirm this reading before a build ticket is written against it." This is a direct conflict between the task's framing and the checked-in architecture doc, which `AGENTS.md`/this project's own convention treats as the source of truth for plan state. Per this epic's own instructions ("if you hit a design question beyond what AD-24/25/26 already settled that feels like it needs a human call ... stop and flag it"), story 08 (multi-machine fan-out and per-machine HITL aggregation) is sliced but deliberately left unbuilt and blocked on this adoption decision, rather than silently building against an unadopted AD. Stories 01-07 depend only on AD-24 and AD-26, both adopted, and are not affected.
- Open question: whether a password-auth fallback (AD-26: "or a password if the user insists on password auth") is in this epic's v1.1 scope or deferred; story 02's acceptance criteria assume keypair-only for the first cut and leave password auth as a documented follow-up, since AD-26's keypair-ownership decision above makes keypair the default path and CAP-24 names no password requirement.
- Unknown (AD-26's own flag, carried here): whether a PEM private key fits within Windows Credential Manager's generic-credential blob size ceiling (~512-2560 bytes). Story 02 must verify this on a real Windows keychain before assuming "exactly like AD-16" holds; its acceptance criteria include the fallback path (passphrase/reference in the keychain, key material on disk under the user's own file permissions, same posture as `CODEX_HOME`/`GROK_HOME`) if it does not.
- Waits on epic 5 because: the run worktree, `VcsPort`, the sandbox chain and the single-machine HITL model this epic's remote sync and remote build dispatch build directly on top of, unchanged.
- Waits on epic 9 because: `SecretStorePort`/`secrets-keyring` and the sign-in UI pattern this epic's SSH credential storage and remote-machine-linking UI are modeled on.
- Waits on epic 2 because: `AgentPort`/`acp-base`, the permission-card event machinery and the event log this epic reuses over SSH without changing their shape.
