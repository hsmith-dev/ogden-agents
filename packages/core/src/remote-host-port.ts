/**
 * The port for the SSH connection to a remote machine (CAP-24, epic 19
 * stories 19.2 and 19.4; the architecture's `RemoteHostPort` note under
 * AD-1). Core names no SSH library or client: the `remote-host-ssh` adapter
 * does the connecting. Story 19.2 built `checkHostKey` — reading a
 * machine's host-key fingerprint, without authenticating — which is all
 * the confirm-and-pin flow (AD-26) needs. Story 19.4 adds `connect`: an
 * authenticated session whose `exec` runs one remote shell command with
 * streamed stdio, the transport-agnostic primitive the worktree push/pull
 * (`remote-worktree-sync.ts`) and, later, story 19.5's agent spawn both
 * build on. Never a second transport (SFTP, rsync) alongside this one exec
 * channel.
 */
import { CoreError } from './errors.js';

/** Enough to address a machine for a connection attempt; never a credential. */
export interface RemoteHostTarget {
  host: string;
  port: number;
  username: string;
}

/** What reading a machine's host key found. */
export interface RemoteHostKeyCheck {
  /** The host key hashed with SHA-256, as a lowercase hex string (ssh2's own `hostHash` digest; not yet the `SHA256:base64` form OpenSSH prints — a UI nicety for story 19.3, not a security difference). */
  fingerprint: string;
}

/** A fresh keypair for one machine (AD-26: Ogden generates and owns it, never reads the user's own key). */
export interface RemoteHostKeypair {
  /** The private key, OpenSSH format (`BEGIN OPENSSH PRIVATE KEY`), unencrypted: the one copy lives in `SecretStorePort`, which is already the isolation boundary (AD-16), so a second passphrase layer would only add a UX step with no further isolation. */
  privateKey: string;
  /** The exact line to append to the remote machine's `authorized_keys` (CAP-24's non-goals: Ogden never provisions the remote machine itself, so the user installs this by hand). */
  publicKeyLine: string;
}

/** What `connect` authenticates with: the machine's own stored keypair (AD-26), never the user's own key or a password. */
export interface RemoteHostCredential {
  /** OpenSSH format, unencrypted, read from `SecretStorePort` by the caller (never by this port itself). */
  privateKey: string;
}

/**
 * One remote shell command, run over an already-authenticated connection,
 * with streamed stdio: binary-safe in both directions (a bundle's bytes
 * out on `stdin`, a bundle's bytes back on `stdout`), so neither side ever
 * buffers the whole payload in a string.
 */
export interface RemoteHostChannel {
  readonly stdin: NodeJS.WritableStream;
  readonly stdout: NodeJS.ReadableStream;
  readonly stderr: NodeJS.ReadableStream;
  /**
   * The command's exit code, once the channel has fully closed (after its
   * stdio has finished, never earlier). Rejects with {@link RemoteHostError}
   * (`connection_lost`) if the connection drops before the command's exit
   * status and its remaining output are known — never resolves with a
   * guessed code, so a caller never mistakes a dropped connection for a
   * command that ran to completion.
   */
  readonly exitCode: Promise<number>;
  /** Asks the remote process to stop; best-effort, never awaited for an answer. */
  kill(): void;
}

/** An authenticated SSH session to one machine, for running one or more commands on it (each its own `exec`). */
export interface RemoteHostConnection {
  /** Runs `command` in the remote's own (POSIX) shell. Rejects with {@link RemoteHostError} if the command could not even start. */
  exec(command: string): Promise<RemoteHostChannel>;
  /** Closes the connection. Idempotent; never throws. */
  close(): Promise<void>;
}

export interface RemoteHostPort {
  /** A fresh keypair for one machine. Pure local cryptography: no network, no disk access, nothing stored. */
  generateKeypair(options: { comment: string }): RemoteHostKeypair;
  /**
   * Connects only as far as reading the host's key, then disconnects
   * without ever attempting to authenticate. Rejects with
   * {@link RemoteHostError} (`host_unreachable`, `host_timeout`) when the
   * machine cannot be reached within `timeoutMs`.
   */
  checkHostKey(target: RemoteHostTarget, options?: { timeoutMs?: number }): Promise<RemoteHostKeyCheck>;
  /**
   * Opens an authenticated session to `target` with `credential` (CAP-24,
   * story 19.4). `expectedFingerprint` is the machine's own pinned
   * fingerprint (`RemoteMachine.hostKeyFingerprint`, set once at confirm
   * time, AD-26): this call re-checks the live host key against it on this
   * exact connection and rejects with {@link RemoteHostError}
   * (`host_key_changed`) on any mismatch, never silently proceeding.
   * `RemoteMachines.verifyPinnedHostKey` running moments before, over its
   * own short-lived connection, only proves the key was fine *then* — an
   * on-path attacker could let that probe through untouched and intercept
   * only this call instead, so the fingerprint is checked again, here, on
   * the very connection that is about to be used. Also rejects with
   * {@link RemoteHostError} (`host_unreachable`, `host_timeout`,
   * `auth_failed`) when the session cannot otherwise be established within
   * `timeoutMs`.
   */
  connect(target: RemoteHostTarget, credential: RemoteHostCredential, expectedFingerprint: string, options?: { timeoutMs?: number }): Promise<RemoteHostConnection>;
}

/**
 * A remote machine's SSH connection failed for a reason that is not the
 * caller's input: unreachable, timed out, host key refused or changed
 * (`host_unreachable`, `host_timeout`, `host_key_changed`), the credential
 * refused (`auth_failed`), the connection dropped mid-command
 * (`connection_lost`), or a remote command itself failed
 * (`remote_command_failed`, story 19.4). Never carries a credential.
 */
export class RemoteHostError extends CoreError {
  override readonly name = 'RemoteHostError';
  constructor(
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
    code = 'remote_host_failed',
  ) {
    super(code, message);
  }
}
