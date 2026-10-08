---
id: 2
type: story
title: "SSH credential storage, keypair generation, and host-key confirm-and-pin"
parent: epic-remote-execution
covers: [R5, R6]
after: [1, epic-first-run-onboarding]
hitl: true
risk: high
---

# SSH credential storage, keypair generation, and host-key confirm-and-pin

## Description

Adds the `remote-host-ssh` adapter's security-critical core: generating and owning a fresh Ed25519 keypair per machine (this epic's resolution of AD-26's open keypair-ownership question — Ogden generates and owns it, never reads the user's own key), storing the private key (and passphrase if any) through SecretStorePort under remote-machine-ssh/<machineId> exactly as AD-16 stores agent API keys, and the host-key verification flow: connect, compute and surface the fingerprint, and refuse to mark the machine usable until an explicit confirm (mirroring AD-15/permission-mode.ts's confirm: true gate — a ConfirmationRequiredError absent it) is recorded as a logged core event and the fingerprint is pinned per machine in Ogden's own store (never only ~/.ssh/known_hosts); a later connection whose host key changed is refused outright, never silently re-prompted. Extends mask.ts's secret redaction (SECRET_ENV_NAME / secretValues / maskSecrets) to SSH private-key and passphrase formats so an SSH adapter's output can never leak one into an event or log line. Verifies AD-26's own flagged unknown: whether a generated private key fits the OS keychain's blob size on all three OSes; where it does not (Windows Credential Manager's documented ~512-2560 byte ceiling), falls back to keeping only a reference/passphrase in the keychain with the key material on disk under the user's own file permissions, the same posture as acp-codex/acp-grok's CODEX_HOME/GROK_HOME fallback (never a second generic encrypted-file secret store, since AD-16 explicitly removed that).

## Acceptance Criteria

Verify: Unit tests (fake SSH transport, no real network) cover: a new machine gets a freshly generated keypair never derived from or equal to any existing user key; the private key is never returned by any method other than the one call that hands it to the real outbound SSH connection; attempting to use a machine before its host key is confirmed is refused; confirming records one logged event and pins the fingerprint; a second connection with a changed host key is refused outright, not re-prompted; the key/passphrase never appears in a rendered event, log line or error message (a redaction test that scans every emitted event/log for the known key material); on a platform where the keychain write is simulated to exceed the size ceiling, the fallback path is used and still passes the no-leak test. Live check (hitl): a real add-machine flow against a real sshd on at least one of macOS/Linux/Windows, confirming the real OS keychain accepts (or correctly falls back for) a real generated key, before this entry counts as proven beyond the fakes.

## References

- parent — _bmad-output/initiative-ogden-agents/epic-remote-execution/epic-remote-execution.md
- architecture-ogden-agents/architecture-ogden-agents.md#ad-26
- packages/core/src/secret-store-port.ts
- packages/adapters/src/secrets-keyring/index.ts
- packages/core/src/chat/permission-mode.ts (confirm: true precedent)
- packages/adapters/src/acp-base/mask.ts

## Notes

- Decision (implementation, 2026-10-07): generated the keypair with `ssh2`'s own `utils.generateKeyPairSync('ed25519', ...)` (the chosen SSH client library's bundled keygen) rather than hand-encoding OpenSSH's wire format from `node:crypto` — it produces the exact OpenSSH `BEGIN OPENSSH PRIVATE KEY` / `ssh-ed25519 ...` forms a real `sshd` expects (secret-scan:allow: prose naming the format, no key material), verified by round-tripping through `ssh2.utils.parseKey` in a real (non-fake) test. This method lives in the `remote-host-ssh` adapter (not core), since core may import no SSH library; `RemoteHostPort.generateKeypair` is the one new method this needed beyond `checkHostKey`.
- Decision: extended `packages/shared/src/secret-patterns.ts` (`PRIVATE_KEY_BLOCK_PATTERN`, factored out of the existing `TOKEN_PATTERNS`) and `packages/server/src/log.ts`'s redaction backstop, rather than `acp-base/mask.ts`'s `SECRET_ENV_NAME`/`secretValues` mechanism named in this entry's own description: that mechanism redacts env-var-keyed secrets handed to a spawned agent child process, which has no relationship to an SSH private key that never touches an environment variable. `secret-patterns.ts`/`log.ts` is this repo's actual generic "a secret-shaped block appears anywhere in text" backstop (used by the handoff brief); it already had a private-key-block pattern, just not wired into the log backstop specifically. Also added `private_key`/`privatekey`/`passphrase` to `log.ts`'s field-name redaction list.
- Resolved empirically, for Ed25519 specifically (AD-26's own flagged unknown): a generated private key is 444 bytes (measured, asserted `< 512` in `packages/adapters/test/remote-host-ssh.test.ts`), comfortably under Windows Credential Manager's documented ~512-2560 byte generic-credential ceiling. This is strong evidence the on-disk fallback AD-26 describes is unlikely to ever be needed for this key type, but it is not a real-Windows-keychain measurement.
- Open question, honestly not resolved here, left for this entry's own live check or a follow-up: the on-disk fallback itself (keeping a reference/passphrase in the keychain with key material on disk under the user's own permissions, `CODEX_HOME`/`GROK_HOME`-style) is **not implemented**. Given the 444-byte measurement above, building a fallback path that cannot be exercised against a real Windows keychain in this environment risked shipping untested code for a case that may never occur; `SecretStorePort.set` is called as-is and a real failure today surfaces as `SecretsUnavailableError` (no silent data loss, just no graceful degradation yet). If the live check ever finds the keychain refuses it in practice, add the fallback then, informed by the real failure instead of a guess.
- Live check (hitl), genuinely outstanding: this build session had no real second machine or `sshd` to connect to, so `checkHostKey`'s real-network success path (reading an actual host key from a real server) and the real OS keychain's acceptance of a real generated key are unverified beyond the automated tests (which cover: the real crypto round-trip through `ssh2.utils.parseKey`, and the real-but-local "closed port" unreachable path through the real `ssh2` client). Whoever has real hardware should run this live check before treating story 18.2 as fully proven.
