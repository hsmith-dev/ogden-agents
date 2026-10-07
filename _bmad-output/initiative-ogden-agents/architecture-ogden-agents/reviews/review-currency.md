# Currency Review — AD-24, AD-25, AD-26 (CAP-24 remote execution over SSH)

**Reviewer lens:** was every committed decision in AD-24/25/26 reality-checked (current tool/library versions, do named technologies still exist and fit, are SSH/git/keychain mechanics claims accurate and checkable) rather than asserted from training data?

**Verdict: pass-with-notes.** Nothing in AD-24/25/26 is factually wrong, and the one external-dependency claim that *is* checkable (git archive/bundle piped through SSH; `@napi-rs/keyring`'s pinned version) holds up. But the three ADs lean on two load-bearing technical claims that are stated as settled fact while being either unverified or actually in tension with known platform limits, and they introduce the entire SSH transport without naming or versioning *any* library or tool that performs it — a conspicuous gap given how precisely every other adapter in this document is pinned.

## Findings

### 1. (Medium-High) No SSH client library or tool is named anywhere, despite CAP-24 being entirely SSH-based
Grepped the full document: AD-24, AD-25, AD-26, the Stack table, the Structural Seed, and the CAP-24 row never name a specific SSH implementation — no `ssh2`, no `node-ssh`, no "shells out to the system `ssh`/OpenSSH binary," nothing. Compare this to every other new external dependency this document introduces: AD-16 names `@napi-rs/keyring` and pins it in the Stack table (2.1); AD-19 names `node-pty`; AD-23 names Tauri's updater/shell plugins with versions. AD-24 says the server streams a worktree "over the same SSH connection CAP-24 uses to spawn the agent," and AD-26 says credentials "reach only the server's own outbound SSH connection" — but nothing in the document says what makes that connection: an in-process Node SSH library (with its own version, maintenance status, and host-key-verification API to check) versus shelling out to the user's/OS's OpenSSH client (with its own version and `ControlMaster`/multiplexing behavior to rely on for "the same connection" across archive-piping, process-spawning, and diff-read-back). These have materially different implications for AD-26's host-key-pinning mechanics (an OpenSSH `known_hosts`-replacement story is different from a pure-JS library's host-key callback) and for what "the same SSH connection" even means operationally (one multiplexed TCP connection with several channels, vs. several sequential `ssh` invocations against a control socket). AD-24's own closing note ("the adapter/port surface this needs ... is an implementation detail for the build ticket") defers this, but at an architecture-spine altitude the *mechanism family* (library vs. shell-out) is exactly the kind of thing that should be picked and verified now, not left for a build ticket to discover — especially since AD-26's security claims (credential handling, host-key refusal behavior) are mechanism-dependent.

**Action:** before a build ticket cites AD-24/AD-26, add a Stack table entry (or an explicit "shells out to system OpenSSH, which must be present on the controller" non-goal) naming the actual SSH mechanism, and verify that library/binary's current version and maintenance status against the web.

### 2. (Medium) AD-26's keychain claim for SSH private keys is stated as equivalent to the API-key path without checking size limits that may break it
AD-26: "Each remote machine's SSH credential (a private key and passphrase...) goes through `SecretStorePort` **exactly as** AD-16 stores agent API keys: an OS keychain entry `remote-machine-ssh/<machineId>`." This is stated as settled fact, not flagged as needing verification (unlike AD-26's own, better-hedged treatment of the host-key bootstrap problem).

Checked: `@napi-rs/keyring` 2.1.0 is indeed the current npm version (confirmed via the npm registry), so the library pin itself is accurate. But the claim that it can hold an SSH private key "exactly as" it holds a short API key glosses over per-OS credential-store size limits that API keys comfortably clear and private keys may not:
- Windows Credential Manager's generic-credential blob (`CredWrite`, the backend this and the underlying Rust `keyring` crate use on Windows) is commonly documented with effective limits in the roughly 512–2560 byte range for the credential blob.
- An RSA SSH private key in PEM form is routinely 1.7 KB (2048-bit) to 3.2+ KB (4096-bit); only small-footprint key types (ed25519, ~0.4 KB) reliably fit. AD-26 doesn't constrain which key types are supported, and the "Open" bullet about Ogden generating its own keypair doesn't settle on a key type either.
- Storing *both* a private key and a passphrase (the doc implies one entry, or doesn't say two) compounds this.

This doesn't make AD-26 wrong — macOS Keychain and Linux Secret Service have much higher practical limits, and a build ticket could default to ed25519 or split entries — but the doc asserts cross-platform parity with AD-16's API-key path with the same confidence it uses for things it has actually checked, when this specific claim is unverified and plausibly false on at least one target OS for at least one key type. It should be flagged as "needs verification against `@napi-rs/keyring`'s Windows backend behavior for payloads of this size" rather than asserted as a direct reuse of AD-16's pattern.

### 3. (Low) `git archive`/bundle piped through SSH checks out as accurate and current
AD-24: "a `git archive`/bundle piped through the SSH session, or equivalent." Verified this is a standard, still-current pattern (`git archive --format=tar <rev> | ssh host "tar -x -C dest"`, or the `git bundle` equivalent for cases needing history). Git's archive format preserves the executable bit via tar, consistent with AD-24's "exact bytes" framing, and `git archive` only includes tracked content, consistent with the AD's own "tracked contents" phrasing. No currency issue here — this is the one specific technical mechanism named in these three ADs that was checkable and holds up.

### 4. (Low-Medium) "the remote's resulting diff is read back" doesn't specify a mechanism that's known to round-trip correctly
AD-24: "the remote's resulting diff is read back over the same SSH connection before the run's outcome is recorded." If this means a text-based `git diff` patch (the natural reading, paired with "diff"), that format does not reliably represent binary file changes unless generated with `--binary` (or the bytes are transferred by some other full-content means, e.g. another archive/rsync pass). The AD doesn't say which, and the choice affects whether a build that changes a binary asset on the remote can actually be merged back by "approve." This is a smaller gap than #1/#2 — it's a one-line mechanism clarification, not a verification-against-the-web item — but it's another place where a confident-sounding sentence hides an unresolved implementation question.

### 5. (Low) AD-25's and AD-26's self-flagging is good practice and not itself a currency problem
Both ADs are explicit about their own unresolved status (AD-25 "proposed, not adopted," with an explicit "confirm this reading" callout; AD-26 "proposed, not adopted — needs the user's go/no-go," with its own residual-risk paragraph on first-connection MITM). This is the right pattern and is exactly what AD-24's two unverified claims (findings #1 and #2) should have done instead of asserting them as settled.

## Summary table

| # | Area | Claim | Status |
|---|---|---|---|
| 1 | AD-24/26, Stack table | SSH transport mechanism/library | Not named anywhere — gap, needs a pinned choice |
| 2 | AD-26 | OS keychain holds SSH private key + passphrase "exactly as" AD-16's API keys | Unverified; plausible Windows size-limit conflict |
| 3 | AD-24 | `git archive`/bundle piped through SSH | Verified accurate and current |
| 4 | AD-24 | Remote diff "read back" round-trips binary changes | Mechanism unspecified; text-diff default would not |
| 5 | AD-25/26 | Self-flagged as proposed/unresolved | Good practice, no action needed |
