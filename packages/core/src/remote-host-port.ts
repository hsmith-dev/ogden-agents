/**
 * The port for the SSH connection to a remote machine (CAP-24, epic 19
 * story 19.2; the architecture's `RemoteHostPort` note under AD-1). Core
 * names no SSH library or client: the `remote-host-ssh` adapter does the
 * connecting. This story builds only `checkHostKey` — reading a machine's
 * host-key fingerprint, without authenticating — which is all the
 * confirm-and-pin flow (AD-26) needs. `connect`/spawning a process
 * (story 19.5) and the worktree push/pull (story 19.4) extend this same
 * interface later; their shapes are not guessed here.
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
}

/** A remote machine's SSH connection failed for a reason that is not the caller's input (unreachable, timed out, host key refused). Never carries a credential. */
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
