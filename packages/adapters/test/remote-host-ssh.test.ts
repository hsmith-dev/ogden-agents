/**
 * `remote-host-ssh` (CAP-24, epic 18 story 18.2): `generateKeypair` is real
 * local cryptography, checked here for real with `ssh2`'s own key parser
 * (no network at all). `checkHostKey`'s unreachable path is checked
 * against a real, briefly-bound-then-closed local TCP port (no fake, but
 * also no real remote machine, no real sshd, and no network egress) so the
 * "could not reach it" branch runs through the real `ssh2` client, not a
 * stand-in. Reading a host key from a real `sshd` is this story's own
 * `hitl` live check, not an automated test.
 */
import { RemoteHostError } from '@ogden-agents/core';
import { createServer } from 'node:net';
import { utils } from 'ssh2';
import { describe, expect, it } from 'vitest';
import { createSshRemoteHostPort } from '../src/remote-host-ssh/index.js';

describe('generateKeypair', () => {
  it('returns a private key ssh2 itself can parse back, and a matching public key line', () => {
    const hosts = createSshRemoteHostPort();
    const pair = hosts.generateKeypair({ comment: 'ogden-agents:mach_test' });
    expect(pair.privateKey).toMatch(/^-----BEGIN OPENSSH PRIVATE KEY-----/);
    expect(pair.publicKeyLine).toMatch(/^ssh-ed25519 [A-Za-z0-9+/=]+ ogden-agents:mach_test$/);
    // AD-26's own flagged unknown, for this key type specifically: an Ed25519 OpenSSH key is a few hundred
    // bytes, well under Windows Credential Manager's documented ~512-2560 byte generic-credential ceiling, so
    // (for this choice of key type, not a claim about every key type) the on-disk fallback AD-26 describes is
    // very unlikely to ever trigger — measured here, not assumed; the real keychain still needs the live check.
    expect(Buffer.byteLength(pair.privateKey, 'utf8')).toBeLessThan(512);

    const parsed = utils.parseKey(pair.privateKey);
    expect(parsed).not.toBeInstanceOf(Error);
    if (parsed instanceof Error) throw parsed;
    // The parsed key's own public half, re-serialized, is the same key material the public-key line carries.
    const parsedPublicBase64 = parsed.getPublicSSH().toString('base64');
    expect(pair.publicKeyLine).toContain(parsedPublicBase64);
  });

  it('never reuses key material across calls', () => {
    const hosts = createSshRemoteHostPort();
    const a = hosts.generateKeypair({ comment: 'a' });
    const b = hosts.generateKeypair({ comment: 'b' });
    expect(a.privateKey).not.toBe(b.privateKey);
    expect(a.publicKeyLine).not.toBe(b.publicKeyLine);
  });
});

describe('checkHostKey', () => {
  it('rejects with RemoteHostError(host_unreachable) for a closed local port, through the real ssh2 client', async () => {
    // A real TCP server, bound then immediately closed: its port is a real, briefly-valid one nothing else grabbed,
    // and closing it leaves that port refusing connections deterministically, with no network egress involved.
    const probe = createServer();
    const port = await new Promise<number>((resolve) => {
      probe.listen(0, '127.0.0.1', () => resolve((probe.address() as { port: number }).port));
    });
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    const hosts = createSshRemoteHostPort({ timeoutMs: 2000 });
    const failure = await hosts.checkHostKey({ host: '127.0.0.1', port, username: 'ogden-test' }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RemoteHostError);
    expect((failure as RemoteHostError).code).toBe('host_unreachable');
    expect((failure as RemoteHostError).message).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY/);
  }, 10_000);
});
