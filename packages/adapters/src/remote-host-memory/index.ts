/**
 * `remote-host-memory` (CAP-24, epic 19 stories 19.2 and 19.4): an
 * in-memory `RemoteHostPort` for tests. It runs no SSH and touches no
 * network: `generateKeypair` returns deterministic, obviously-fake
 * strings, and `checkHostKey` answers from a map the test sets directly
 * ({@link MemoryRemoteHostPort.setFingerprint}), so a test can simulate a
 * host key that changes between two checks, or a host that cannot be
 * reached ({@link MemoryRemoteHostPort.setUnreachable}).
 *
 * `connect`/`exec` (story 19.4) stand in for the SSH session itself, but
 * for real: `connect` re-checks the live fingerprint against the caller's
 * `expectedFingerprint` exactly as the real adapter does, rejecting
 * `host_key_changed` on a mismatch even if an earlier `checkHostKey` call
 * saw a different (matching) value — the two are never conflated. Each
 * host/port is a real local temp folder
 * ({@link MemoryRemoteHostPort.homeDirFor}), and `exec` spawns the exact
 * command string a caller builds through a real local `sh -c` in that
 * folder — never a real SSH session, never a network hop — so the
 * generated remote git commands (`remote-worktree-sync.ts`'s push/pull) run
 * for real and a test can inspect or seed that folder directly.
 * {@link MemoryRemoteHostPort.setConnectionLost} makes the *next* `exec` on
 * that host/port behave as if the connection dropped mid-command: its
 * `exitCode` rejects instead of resolving, exactly as the real adapter's
 * does when the SSH connection itself is lost.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RemoteHostError, type RemoteHostChannel, type RemoteHostConnection, type RemoteHostCredential, type RemoteHostKeyCheck, type RemoteHostKeypair, type RemoteHostPort, type RemoteHostTarget } from '@ogden-agents/core';
import { baseEnvironment } from '../child-env.js';

export interface MemoryRemoteHostPort extends RemoteHostPort {
  /** Every call as `method arg…`, in order (`exec`'s records the exact command string). */
  readonly calls: string[];
  /** The fingerprint `checkHostKey` answers for this host and port until changed again; unset means a stable, deterministic default. */
  setFingerprint(host: string, port: number, fingerprint: string): void;
  /** Whether `checkHostKey` for this host and port rejects as unreachable. */
  setUnreachable(host: string, port: number, unreachable?: boolean): void;
  /** The local folder standing in for `host:port`'s own home directory (where `exec`'s relative paths resolve); created on first use if a test never set one. */
  homeDirFor(host: string, port: number): string;
  /** Points `host:port`'s "home directory" at a folder a test prepared, instead of one made on first use. */
  setHomeDir(host: string, port: number, dir: string): void;
  /** The next `exec` on `host:port` behaves as if its connection dropped before the command finished (I/O matrix: "Connection drops mid-exec"). One-shot: cleared once used. */
  setConnectionLost(host: string, port: number): void;
}

const addressKey = (host: string, port: number): string => `${host}:${port}`;

/** A stable, obviously-fake fingerprint derived only from the address, so two tests that don't set one still see consistent, distinct values per machine. */
const defaultFingerprint = (host: string, port: number): string => `fake-fp-${Buffer.from(addressKey(host, port)).toString('hex').slice(0, 32)}`;

/** The connection dropped before a command's exit status and output were known (story 19.4), matching the real adapter's own wording. */
const connectionLostError = (): RemoteHostError => new RemoteHostError('The connection to the machine was lost.', {}, 'connection_lost');

export function createMemoryRemoteHostPort(): MemoryRemoteHostPort {
  const calls: string[] = [];
  const fingerprints = new Map<string, string>();
  const unreachable = new Set<string>();
  const homes = new Map<string, string>();
  const dropNext = new Set<string>();
  let keyCounter = 0;

  const homeDirFor = (host: string, port: number): string => {
    const key = addressKey(host, port);
    let dir = homes.get(key);
    if (dir === undefined) {
      dir = mkdtempSync(join(tmpdir(), 'ogden-agents-remote-fake-'));
      homes.set(key, dir);
    }
    return dir;
  };

  return {
    calls,
    homeDirFor,

    setHomeDir(host, port, dir) {
      homes.set(addressKey(host, port), dir);
    },

    setFingerprint(host, port, fingerprint) {
      fingerprints.set(addressKey(host, port), fingerprint);
    },

    setUnreachable(host, port, value = true) {
      const key = addressKey(host, port);
      if (value) unreachable.add(key);
      else unreachable.delete(key);
    },

    setConnectionLost(host, port) {
      dropNext.add(addressKey(host, port));
    },

    generateKeypair({ comment }): RemoteHostKeypair {
      keyCounter += 1;
      calls.push(`generateKeypair ${comment}`);
      return {
        privateKey: `-----BEGIN OPENSSH PRIVATE KEY-----\nfake-memory-key-${keyCounter}\n-----END OPENSSH PRIVATE KEY-----\n`, // secret-scan:allow: an obviously-fake, in-memory test double, never real key material
        publicKeyLine: `ssh-ed25519 FAKEMEMORYKEY${keyCounter} ${comment}`,
      };
    },

    async checkHostKey(target: RemoteHostTarget): Promise<RemoteHostKeyCheck> {
      const key = addressKey(target.host, target.port);
      calls.push(`checkHostKey ${key}`);
      if (unreachable.has(key)) throw new RemoteHostError(`Could not reach ${target.host}:${target.port}.`, { host: target.host, port: target.port }, 'host_unreachable');
      return { fingerprint: fingerprints.get(key) ?? defaultFingerprint(target.host, target.port) };
    },

    async connect(target: RemoteHostTarget, _credential: RemoteHostCredential, expectedFingerprint: string): Promise<RemoteHostConnection> {
      const key = addressKey(target.host, target.port);
      calls.push(`connect ${key}`);
      if (unreachable.has(key)) throw new RemoteHostError(`Could not reach ${target.host}:${target.port}.`, { host: target.host, port: target.port }, 'host_unreachable');
      // The real adapter's own invariant (see its doc comment): this exact connection's live key is checked again,
      // never trusting `checkHostKey`'s earlier, separate connection alone.
      const live = fingerprints.get(key) ?? defaultFingerprint(target.host, target.port);
      if (live !== expectedFingerprint) {
        throw new RemoteHostError(`${target.host}'s host key has changed since it was confirmed. Remove and re-add the machine only if you trust this is expected.`, { host: target.host }, 'host_key_changed');
      }
      const home = homeDirFor(target.host, target.port);
      return {
        exec(command: string, options?: { env?: Readonly<Record<string, string>> }): Promise<RemoteHostChannel> {
          calls.push(`exec ${key} ${command}`);
          const dropped = dropNext.delete(key);
          // `options?.env` on top of the base, exactly as the real adapter sends it through ssh2's own exec option (never on the command line).
          const child = spawn('sh', ['-c', command], { cwd: home, env: { ...baseEnvironment(), ...options?.env }, stdio: ['pipe', 'pipe', 'pipe'] });
          let settled = false;
          let resolveExit!: (code: number) => void;
          let rejectExit!: (error: unknown) => void;
          const exitCode = new Promise<number>((resolve, reject) => {
            resolveExit = resolve;
            rejectExit = reject;
          });
          const finish = (run: () => void): void => {
            if (settled) return;
            settled = true;
            run();
          };
          // A write after the process died (the dropped-connection path below) would otherwise throw EPIPE.
          child.stdin.on('error', () => undefined);
          child.on('error', (error) => finish(() => rejectExit(error)));
          child.on('close', (code) => {
            // A dropped connection never hands back a code, win or lose: the caller must never read it as having run.
            if (dropped) finish(() => rejectExit(connectionLostError()));
            else finish(() => resolveExit(code ?? 1));
          });
          if (dropped) {
            // Simulates the transport vanishing mid-command: the process is killed, but the caller only ever sees `connection_lost`, never its code.
            child.kill('SIGKILL');
          }
          return Promise.resolve({
            stdin: child.stdin,
            stdout: child.stdout,
            stderr: child.stderr,
            exitCode,
            kill: () => {
              try {
                child.kill();
              } catch {
                /* best-effort */
              }
            },
          });
        },
        async close() {
          /* Nothing is held open: each `exec` spawns its own short-lived child. */
        },
      };
    },
  };
}
