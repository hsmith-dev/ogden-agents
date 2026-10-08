/**
 * `remote-host-memory` (CAP-24, epic 19 story 19.2): the fake `RemoteHostPort`
 * server-level tests use. Checked for its own correctness, the way
 * `vcs-memory` is.
 */
import { RemoteHostError } from '@ogden-agents/core';
import { describe, expect, it } from 'vitest';
import { createMemoryRemoteHostPort } from '../src/remote-host-memory/index.js';

describe('createMemoryRemoteHostPort', () => {
  it('answers a stable default fingerprint per host and port until one is set', async () => {
    const hosts = createMemoryRemoteHostPort();
    const first = await hosts.checkHostKey({ host: 'a', port: 22, username: 'u' });
    const second = await hosts.checkHostKey({ host: 'a', port: 22, username: 'u' });
    const other = await hosts.checkHostKey({ host: 'b', port: 22, username: 'u' });
    expect(first).toEqual(second);
    expect(first).not.toEqual(other);
  });

  it('lets a test change the fingerprint between two checks, simulating a changed host key', async () => {
    const hosts = createMemoryRemoteHostPort();
    hosts.setFingerprint('a', 22, 'fp-1');
    expect(await hosts.checkHostKey({ host: 'a', port: 22, username: 'u' })).toEqual({ fingerprint: 'fp-1' });
    hosts.setFingerprint('a', 22, 'fp-2');
    expect(await hosts.checkHostKey({ host: 'a', port: 22, username: 'u' })).toEqual({ fingerprint: 'fp-2' });
  });

  it('lets a test simulate an unreachable machine', async () => {
    const hosts = createMemoryRemoteHostPort();
    hosts.setUnreachable('a', 22);
    await expect(hosts.checkHostKey({ host: 'a', port: 22, username: 'u' })).rejects.toBeInstanceOf(RemoteHostError);
    hosts.setUnreachable('a', 22, false);
    await expect(hosts.checkHostKey({ host: 'a', port: 22, username: 'u' })).resolves.toBeDefined();
  });

  it('generates an obviously-fake, non-colliding keypair each call, and records every call', () => {
    const hosts = createMemoryRemoteHostPort();
    const a = hosts.generateKeypair({ comment: 'one' });
    const b = hosts.generateKeypair({ comment: 'two' });
    expect(a.privateKey).not.toBe(b.privateKey);
    expect(a.publicKeyLine).toContain('one');
    expect(b.publicKeyLine).toContain('two');
    expect(hosts.calls).toEqual(['generateKeypair one', 'generateKeypair two']);
  });
});
