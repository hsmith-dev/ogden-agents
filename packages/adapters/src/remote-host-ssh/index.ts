/**
 * `remote-host-ssh` (CAP-24, epic 19 stories 19.2 and 19.4): the real
 * `RemoteHostPort`, over `ssh2`. `generateKeypair` uses ssh2's own key
 * generator so the OpenSSH wire format (and the `authorized_keys` line) is
 * exactly what a real `sshd` expects, never hand-encoded. `checkHostKey`
 * connects only far enough for the transport-layer key exchange to hand
 * back the host's key, then disconnects before ever offering a credential:
 * there is nothing to authenticate with and nothing to protect by doing so,
 * since the server's host key is presented before authentication in the
 * SSH protocol itself.
 *
 * `connect` (story 19.4) is the one place an actual SSH authentication
 * happens: it re-checks the live host key against the caller's
 * `expectedFingerprint` on this exact connection (never trusting that
 * `checkHostKey`'s own earlier, separate connection saw the same peer) and
 * never offers anything but the machine's own stored keypair. `exec` maps
 * ssh2's channel events onto `RemoteHostChannel`: the channel's `exit`
 * event only records the code, and `exitCode` resolves on the channel's
 * later `close` (after its stdio has fully drained) so a caller never reads
 * a short stdout because it didn't wait long enough. A connection that
 * drops before that `close` rejects every still-open exec's `exitCode`
 * with `RemoteHostError('connection_lost', …)`, never leaving it unsettled.
 */
import { RemoteHostError, type RemoteHostChannel, type RemoteHostConnection, type RemoteHostCredential, type RemoteHostKeyCheck, type RemoteHostKeypair, type RemoteHostPort, type RemoteHostTarget } from '@ogden-agents/core';
// A default import, destructured below: ssh2 is CommonJS and Node's cjs-module-lexer does not
// detect `utils` as one of its named exports (only some of its other exports), so `import { Client,
// utils } from 'ssh2'` fails at runtime with "Named export 'utils' not found" even though it
// typechecks; this is the form Node's own error message recommends.
import ssh2 from 'ssh2';
import type { Client as SshClient, ClientChannel } from 'ssh2';

const { Client, utils } = ssh2;

/** The connection dropped before a command's exit status and output were known (story 19.4). */
const connectionLost = (): RemoteHostError => new RemoteHostError('The connection to the machine was lost.', {}, 'connection_lost');

/** One ssh2 exec channel, wrapped as a {@link RemoteHostChannel} plus the hook a connection drop uses to settle it. */
interface WrappedChannel {
  readonly channel: RemoteHostChannel;
  /** Rejects `exitCode` with `connection_lost`, unless it already settled. */
  readonly markLost: () => void;
}

/** Wraps one ssh2 exec channel; `onSettled` lets the connection stop tracking it once it is done, either way. */
function wrapChannel(channel: ClientChannel, onSettled: () => void): WrappedChannel {
  let exitCode: number | undefined;
  let settled = false;
  let resolveExit!: (code: number) => void;
  let rejectExit!: (error: unknown) => void;
  const exitPromise = new Promise<number>((resolve, reject) => {
    resolveExit = resolve;
    rejectExit = reject;
  });
  channel.on('exit', (code: number | null) => {
    exitCode = code ?? 1;
  });
  const finish = (run: () => void): void => {
    if (settled) return;
    settled = true;
    onSettled();
    run();
  };
  // `exitCode` resolves only once the channel has fully closed (after stdio has drained), never on `exit` alone.
  channel.on('close', () => finish(() => resolveExit(exitCode ?? 1)));
  // ssh2 surfaces a stream-level error (say, the channel was abruptly destroyed) distinctly from 'close'.
  channel.on('error', () => finish(() => rejectExit(connectionLost())));
  return {
    channel: {
      stdin: channel,
      stdout: channel,
      stderr: channel.stderr,
      exitCode: exitPromise,
      kill: () => {
        try {
          channel.signal('KILL');
        } catch {
          /* best-effort */
        }
        try {
          channel.close();
        } catch {
          /* best-effort */
        }
      },
    },
    markLost: () => finish(() => rejectExit(connectionLost())),
  };
}

/** One authenticated session (story 19.4): every open `exec` is tracked so a connection drop settles each of them, never leaving one unsettled. */
function createConnection(conn: SshClient): RemoteHostConnection {
  const open = new Set<WrappedChannel>();
  const dropAll = (): void => {
    for (const wrapped of [...open]) wrapped.markLost();
    open.clear();
  };
  conn.on('error', dropAll);
  conn.on('close', dropAll);
  let closed = false;
  return {
    exec(command, options) {
      return new Promise((resolve, reject) => {
        // `env` travels only through ssh2's own protocol-level exec option (AD-16): never spliced into `command`.
        conn.exec(command, { env: options?.env }, (error, stream) => {
          if (error) {
            reject(new RemoteHostError('The remote command could not start.', {}, 'connection_lost'));
            return;
          }
          const wrapped = wrapChannel(stream, () => open.delete(wrapped));
          open.add(wrapped);
          resolve(wrapped.channel);
        });
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      dropAll();
      try {
        conn.end();
      } catch {
        /* already closing */
      }
    },
  };
}

/** How long to wait for the handshake (through the host key) before giving up. */
const DEFAULT_TIMEOUT_MS = 10_000;

export interface SshRemoteHostOptions {
  /** Overrides the default connect timeout, for tests only. */
  timeoutMs?: number;
}

export function createSshRemoteHostPort(options: SshRemoteHostOptions = {}): RemoteHostPort {
  return {
    generateKeypair({ comment }): RemoteHostKeypair {
      const pair = utils.generateKeyPairSync('ed25519', { comment });
      return { privateKey: pair.private, publicKeyLine: pair.public };
    },

    checkHostKey(target: RemoteHostTarget, checkOptions): Promise<RemoteHostKeyCheck> {
      const timeoutMs = checkOptions?.timeoutMs ?? options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      return new Promise<RemoteHostKeyCheck>((resolve, reject) => {
        const conn = new Client();
        let settled = false;
        const finish = (run: () => void): void => {
          if (settled) return;
          settled = true;
          try {
            conn.end();
          } catch {
            /* already closing */
          }
          try {
            conn.destroy();
          } catch {
            /* already destroyed */
          }
          run();
        };
        conn.on('error', (error: Error & { level?: string }) => {
          finish(() => {
            const timedOut = error.level === 'client-timeout';
            reject(
              new RemoteHostError(
                timedOut ? `Timed out connecting to ${target.host}:${target.port}.` : `Could not reach ${target.host}:${target.port}: ${error.message}`,
                { host: target.host, port: target.port },
                timedOut ? 'host_timeout' : 'host_unreachable',
              ),
            );
          });
        });
        conn.connect({
          host: target.host,
          port: target.port,
          username: target.username,
          readyTimeout: timeoutMs,
          hostHash: 'sha256',
          // Never offered: authenticating is never attempted, so there is no credential here to protect.
          tryKeyboard: false,
          hostVerifier: (fingerprint: string, verify: (ok: boolean) => void): boolean => {
            finish(() => resolve({ fingerprint }));
            // The handshake is deliberately refused: this call never needs to succeed past the host key.
            verify(false);
            return false;
          },
        });
      });
    },

    connect(target: RemoteHostTarget, credential: RemoteHostCredential, expectedFingerprint: string, connectOptions): Promise<RemoteHostConnection> {
      const timeoutMs = connectOptions?.timeoutMs ?? options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      return new Promise<RemoteHostConnection>((resolve, reject) => {
        const conn = new Client();
        let settled = false;
        const settle = (run: () => void): void => {
          if (settled) return;
          settled = true;
          run();
        };
        conn.on('error', (error: Error & { level?: string }) => {
          // A post-`ready` error is this connection's own business (`createConnection`'s listener), not this attempt's.
          settle(() => {
            const timedOut = error.level === 'client-timeout';
            const authFailed = error.level === 'client-authentication';
            try {
              conn.end();
            } catch {
              /* already closing */
            }
            reject(
              new RemoteHostError(
                authFailed ? `${target.host} refused the key.` : timedOut ? `Timed out connecting to ${target.host}:${target.port}.` : `Could not reach ${target.host}:${target.port}: ${error.message}`,
                { host: target.host, port: target.port },
                authFailed ? 'auth_failed' : timedOut ? 'host_timeout' : 'host_unreachable',
              ),
            );
          });
        });
        conn.on('ready', () => {
          settle(() => resolve(createConnection(conn)));
        });
        conn.connect({
          host: target.host,
          port: target.port,
          username: target.username,
          privateKey: credential.privateKey,
          readyTimeout: timeoutMs,
          hostHash: 'sha256',
          tryKeyboard: false,
          // The one place this exact connection's live host key is checked against what was pinned (the port's own
          // doc comment): `checkHostKey`'s earlier probe proved the key was fine then, on a different connection: an
          // on-path attacker could let that probe through untouched and intercept only this one instead, so it is
          // never trusted alone.
          hostVerifier: (fingerprint: string, verify: (ok: boolean) => void): boolean => {
            if (fingerprint !== expectedFingerprint) {
              settle(() => {
                try {
                  conn.end();
                } catch {
                  /* already closing */
                }
                reject(new RemoteHostError(`${target.host}'s host key has changed since it was confirmed. Remove and re-add the machine only if you trust this is expected.`, { host: target.host }, 'host_key_changed'));
              });
              verify(false);
              return false;
            }
            verify(true);
            return true;
          },
        });
      });
    },
  };
}
