/**
 * `redactSecrets` and `PRIVATE_KEY_BLOCK_PATTERN` (AD-16; extended for
 * CAP-24/AD-26, epic 18 story 18.2): a PEM-style private key block,
 * including OpenSSH's own `OPENSSH PRIVATE KEY` format (CAP-24's generated
 * SSH keys), is redacted wherever it appears in free text — the handoff
 * brief's own backstop, shared with the log's.
 */
import { describe, expect, it } from 'vitest';
import { PRIVATE_KEY_BLOCK_PATTERN, redactSecrets } from '../src/secret-patterns.js';

const OPENSSH_KEY = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZWQy\nNTUxOQAAACBhYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODkAAAAgYWJjZGVm\n-----END OPENSSH PRIVATE KEY-----\n';
const PKCS8_KEY = '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIBg2v2ZQY1x8xJ3n9d0pC1a7m8hT1kK4e2y6n0u1v9w0\n-----END PRIVATE KEY-----';

describe('PRIVATE_KEY_BLOCK_PATTERN / redactSecrets', () => {
  it('redacts a whole OpenSSH private key block wherever it appears in text', () => {
    const text = `could not store the key: ${OPENSSH_KEY} (see above)`;
    const out = redactSecrets(text);
    expect(out).not.toContain('b3BlbnNzaC1rZXktdjEA');
    expect(out).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY/);
    expect(out).toContain('could not store the key: [redacted]');
  });

  it('redacts a PKCS8 private key block the same way', () => {
    const out = redactSecrets(`key=${PKCS8_KEY}`);
    expect(out).not.toContain('MC4CAQAwBQYDK2VwBCIEIBg2v2ZQY1x8');
    expect(out).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY/);
  });

  it('the exported pattern matches an OpenSSH key block directly (a fresh copy, so this never disturbs the shared global regex’s own lastIndex)', () => {
    expect(new RegExp(PRIVATE_KEY_BLOCK_PATTERN.source).test(OPENSSH_KEY)).toBe(true);
  });

  it('leaves ordinary text with no key block alone', () => {
    expect(redactSecrets('nothing secret here, just plain words')).toBe('nothing secret here, just plain words');
  });
});
