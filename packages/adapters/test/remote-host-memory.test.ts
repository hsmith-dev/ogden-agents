/**
 * `remote-host-memory` (CAP-24, epic 19 stories 19.2 and 19.4): the fake
 * `RemoteHostPort` server-level tests use. Checked for its own correctness,
 * the way `vcs-memory` is.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RemoteHostError, type RemoteHostChannel } from '@ogden-agents/core';
import { describe, expect, it } from 'vitest';
import { createMemoryRemoteHostPort } from '../src/remote-host-memory/index.js';

/** Collects a channel's stdout fully, after ending its stdin (`input`, if any) and draining stderr. */
async function run(channel: RemoteHostChannel, input?: string): Promise<{ code: number; stdout: string }> {
  const chunks: Buffer[] = [];
  channel.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
  channel.stderr.resume();
  if (input !== undefined) channel.stdin.write(input);
  channel.stdin.end();
  const code = await channel.exitCode;
  return { code, stdout: Buffer.concat(chunks).toString('utf8') };
}

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

describe('connect/exec (CAP-24 story 19.4)', () => {
  it('runs the exact command string through a real local shell, in a folder standing in for the host', async () => {
    const hosts = createMemoryRemoteHostPort();
    const { fingerprint } = await hosts.checkHostKey({ host: 'a', port: 22, username: 'u' });
    const connection = await hosts.connect({ host: 'a', port: 22, username: 'u' }, { privateKey: 'fake' }, fingerprint);
    const channel = await connection.exec('echo hello > out.txt');
    const { code } = await run(channel);
    expect(code).toBe(0);
    const home = hosts.homeDirFor('a', 22);
    expect(readFileSync(join(home, 'out.txt'), 'utf8')).toBe('hello\n');
    await connection.close();
    expect(hosts.calls).toEqual(['checkHostKey a:22', 'connect a:22', 'exec a:22 echo hello > out.txt']);
  });

  it('streams stdin to the command and stdout back, binary-safe', async () => {
    const hosts = createMemoryRemoteHostPort();
    const { fingerprint } = await hosts.checkHostKey({ host: 'a', port: 22, username: 'u' });
    const connection = await hosts.connect({ host: 'a', port: 22, username: 'u' }, { privateKey: 'fake' }, fingerprint);
    const channel = await connection.exec('cat');
    const { code, stdout } = await run(channel, 'roundtrip me');
    expect(code).toBe(0);
    expect(stdout).toBe('roundtrip me');
  });

  it('reports a non-zero exit code without rejecting', async () => {
    const hosts = createMemoryRemoteHostPort();
    const { fingerprint } = await hosts.checkHostKey({ host: 'a', port: 22, username: 'u' });
    const connection = await hosts.connect({ host: 'a', port: 22, username: 'u' }, { privateKey: 'fake' }, fingerprint);
    const channel = await connection.exec('exit 7');
    const { code } = await run(channel);
    expect(code).toBe(7);
  });

  it('rejects connect for an unreachable host, before any exec', async () => {
    const hosts = createMemoryRemoteHostPort();
    hosts.setUnreachable('a', 22);
    await expect(hosts.connect({ host: 'a', port: 22, username: 'u' }, { privateKey: 'fake' }, 'fake-fp')).rejects.toBeInstanceOf(RemoteHostError);
    expect(hosts.calls.some((call) => call.startsWith('exec'))).toBe(false);
  });

  it("rejects connect with host_key_changed when the live fingerprint doesn't match what the caller pinned, even right after a matching checkHostKey, before any exec", async () => {
    const hosts = createMemoryRemoteHostPort();
    const { fingerprint } = await hosts.checkHostKey({ host: 'a', port: 22, username: 'u' });
    // The host key changes on the machine between the probe and the real connection (an on-path attacker
    // intercepting only the second one) -- `connect` must catch this itself, never trusting the earlier probe alone.
    hosts.setFingerprint('a', 22, 'a-different-fingerprint');
    const failure = await hosts.connect({ host: 'a', port: 22, username: 'u' }, { privateKey: 'fake' }, fingerprint).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RemoteHostError);
    expect((failure as RemoteHostError).code).toBe('host_key_changed');
    expect(hosts.calls.some((call) => call.startsWith('exec'))).toBe(false);
  });

  it('two machines (or a test-chosen home) each get their own folder, never colliding', async () => {
    const hosts = createMemoryRemoteHostPort();
    const first = hosts.homeDirFor('a', 22);
    const second = hosts.homeDirFor('b', 22);
    expect(first).not.toBe(second);
    const chosen = hosts.homeDirFor('a', 22); // the same host/port again: the same folder, not a new one.
    expect(chosen).toBe(first);
  });

  it("setConnectionLost makes the next exec's exitCode reject with connection_lost, one-shot, never handing back a code", async () => {
    const hosts = createMemoryRemoteHostPort();
    const { fingerprint } = await hosts.checkHostKey({ host: 'a', port: 22, username: 'u' });
    const connection = await hosts.connect({ host: 'a', port: 22, username: 'u' }, { privateKey: 'fake' }, fingerprint);
    hosts.setConnectionLost('a', 22);
    const dropped = await connection.exec('echo should-not-matter');
    const failure = await run(dropped).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RemoteHostError);
    expect((failure as RemoteHostError).code).toBe('connection_lost');

    // One-shot: the next exec on the same connection runs normally again.
    const next = await connection.exec('exit 0');
    expect((await run(next)).code).toBe(0);
  });

  it('a prepared "remote" folder (writeFileSync by the test) is exactly what exec sees, and what exec writes is exactly what the test can read back', async () => {
    const hosts = createMemoryRemoteHostPort();
    const prepared = hosts.homeDirFor('seeded', 22);
    writeFileSync(join(prepared, 'seed.txt'), 'seeded content\n');
    const { fingerprint } = await hosts.checkHostKey({ host: 'seeded', port: 22, username: 'u' });
    const connection = await hosts.connect({ host: 'seeded', port: 22, username: 'u' }, { privateKey: 'fake' }, fingerprint);
    const channel = await connection.exec('cat seed.txt');
    const { stdout } = await run(channel);
    expect(stdout).toBe('seeded content\n');
  });
});
