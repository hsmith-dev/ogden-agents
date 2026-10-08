/**
 * `remote-host-ssh` (CAP-24, epic 19 story 19.2): the real `RemoteHostPort`,
 * over `ssh2`. `generateKeypair` uses ssh2's own key generator so the
 * OpenSSH wire format (and the `authorized_keys` line) is exactly what a
 * real `sshd` expects, never hand-encoded. `checkHostKey` connects only far
 * enough for the transport-layer key exchange to hand back the host's key,
 * then disconnects before ever offering a credential: there is nothing to
 * authenticate with and nothing to protect by doing so, since the server's
 * host key is presented before authentication in the SSH protocol itself.
 */
import { RemoteHostError, type RemoteHostKeyCheck, type RemoteHostKeypair, type RemoteHostPort, type RemoteHostTarget } from '@ogden-agents/core';
// A default import, destructured below: ssh2 is CommonJS and Node's cjs-module-lexer does not
// detect `utils` as one of its named exports (only some of its other exports), so `import { Client,
// utils } from 'ssh2'` fails at runtime with "Named export 'utils' not found" even though it
// typechecks; this is the form Node's own error message recommends.
import ssh2 from 'ssh2';

const { Client, utils } = ssh2;

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
  };
}
