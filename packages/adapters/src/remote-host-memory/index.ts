/**
 * `remote-host-memory` (CAP-24, epic 19 story 19.2): an in-memory
 * `RemoteHostPort` for tests. It runs no SSH and touches no network or
 * disk: `generateKeypair` returns deterministic, obviously-fake strings,
 * and `checkHostKey` answers from a map the test sets directly
 * ({@link MemoryRemoteHostPort.setFingerprint}), so a test can simulate a
 * host key that changes between two checks, or a host that cannot be
 * reached ({@link MemoryRemoteHostPort.setUnreachable}).
 */
import { RemoteHostError, type RemoteHostKeyCheck, type RemoteHostKeypair, type RemoteHostPort, type RemoteHostTarget } from '@ogden-agents/core';

export interface MemoryRemoteHostPort extends RemoteHostPort {
  /** Every call as `method arg…`, in order. */
  readonly calls: string[];
  /** The fingerprint `checkHostKey` answers for this host and port until changed again; unset means a stable, deterministic default. */
  setFingerprint(host: string, port: number, fingerprint: string): void;
  /** Whether `checkHostKey` for this host and port rejects as unreachable. */
  setUnreachable(host: string, port: number, unreachable?: boolean): void;
}

const addressKey = (host: string, port: number): string => `${host}:${port}`;

/** A stable, obviously-fake fingerprint derived only from the address, so two tests that don't set one still see consistent, distinct values per machine. */
const defaultFingerprint = (host: string, port: number): string => `fake-fp-${Buffer.from(addressKey(host, port)).toString('hex').slice(0, 32)}`;

export function createMemoryRemoteHostPort(): MemoryRemoteHostPort {
  const calls: string[] = [];
  const fingerprints = new Map<string, string>();
  const unreachable = new Set<string>();
  let keyCounter = 0;

  return {
    calls,

    setFingerprint(host, port, fingerprint) {
      fingerprints.set(addressKey(host, port), fingerprint);
    },

    setUnreachable(host, port, value = true) {
      const key = addressKey(host, port);
      if (value) unreachable.add(key);
      else unreachable.delete(key);
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
  };
}
