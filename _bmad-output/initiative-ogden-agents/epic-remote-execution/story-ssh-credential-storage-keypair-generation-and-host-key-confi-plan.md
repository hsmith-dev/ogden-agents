---
title: 'SSH credential storage, keypair generation, and host-key confirm-and-pin'
type: 'feature'
ticket: '2'
created: '2026-10-07'
status: 'built'
baseline_revision: '71c3b279'
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

**Problem:** CAP-24 needs AD-26's credential storage and host-key confirm-and-pin flow built for real, resolving AD-26's keypair-ownership question and its blob-size unknown along the way.

**Approach:** Add `RemoteHostPort` (core) with `generateKeypair` (sync, no network) and `checkHostKey` (SSH handshake only as far as the host key, never authenticating), a real `remote-host-ssh` adapter over `ssh2`, a `remote-host-memory` fake for every other test, and extend `RemoteMachines` with `checkHostKey`/`confirmHostKey`/`verifyPinnedHostKey` mirroring `permission-mode.ts`'s `confirm: true` gate.

</frozen-after-approval>

## Implementation Notes

Chose `ssh2` (1.17.0) as the SSH client library (new dependency, `packages/adapters` + root `package.json`, both pinned to the same exact version; `pnpm-workspace.yaml`'s `allowBuilds` denies `ssh2`'s and `cpu-features`'s native-acceleration build scripts, which both exit 0 and fall back to pure-JS crypto when denied — avoids a cross-OS native compile step). `ssh2` ships its own key generator (`utils.generateKeyPairSync`), so `generateKeypair` uses that directly instead of hand-encoding OpenSSH's wire format from `node:crypto` — verified for real (not faked) by round-tripping a generated key through `ssh2.utils.parseKey`.

`checkHostKey` connects with `hostHash: 'sha256'` and an async `hostVerifier` callback: SSH's own protocol presents the host key during the transport-layer handshake, before any authentication attempt, so the callback fires (and the fingerprint is captured) regardless of whether a credential is ever offered; the implementation calls `verify(false)` immediately after capturing it and destroys the connection, never attempting to authenticate. Real-but-local test: bind a TCP server on `127.0.0.1:0`, read the assigned port, close it, then `checkHostKey` that now-closed port — a deterministic `ECONNREFUSED` through the real `ssh2` `Client`, no fake, no external network. The success path (reading a real host key from a real `sshd`) has no automated test: no second machine was available in this session; flagged as the entry's own outstanding `hitl` live check.

Corrected the entry's own description: the redaction extension belongs in `packages/shared/src/secret-patterns.ts` (`PRIVATE_KEY_BLOCK_PATTERN`, factored out of the existing `TOKEN_PATTERNS` with no behavior change) and `packages/server/src/log.ts`'s backstop (which did not yet use `TOKEN_PATTERNS` at all — a pre-existing gap, now closed for this and every other secret-shaped block), not `acp-base/mask.ts` (that mechanism is for env-var-keyed secrets handed to a spawned agent process; an SSH key never touches an env var). Added `private_key`/`privatekey`/`passphrase` to `log.ts`'s field-name redaction set as well.

`RemoteMachines.confirmHostKey` re-reads the live fingerprint at confirm time (never trusts a client-supplied boolean alone) and compares it against what was shown (first confirm) or what is already pinned (every later attempt) — a mismatch in either case is `RemoteHostError('host_key_changed', ...)`, never a silent re-pin. `verifyPinnedHostKey` is the same live-vs-pinned check with no side effects, for stories 19.4/19.5 to call before any real connection.

AD-26's own flagged unknown (whether a generated key fits the keychain's blob-size ceiling): measured, not assumed — a generated Ed25519 OpenSSH key is 444 bytes (asserted `< 512` in the adapter test), comfortably under the documented ~512-2560 byte Windows Credential Manager ceiling. The on-disk fallback AD-26 describes for an oversized key is deliberately **not implemented**: building and shipping an untested fallback path for a case this measurement suggests is unlikely, with no real Windows keychain available to verify it against, seemed worse than calling it out plainly. `SecretStorePort.set` is called as-is; a real failure today surfaces as `SecretsUnavailableError`, not silent data loss.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors (all 6 packages)
- `pnpm run build` -- expected: clean; also exercises `tests/packaging.test.ts`'s dependency-declaration checks, which is why `ssh2` is declared at the repo root too, not only in `packages/adapters`
- `npx vitest run` (full suite) -- expected: all green
