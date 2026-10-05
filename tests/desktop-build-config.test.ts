/**
 * The per-build Tauri config (story 13.9, AD-23): a test build takes the throwaway key's override, a
 * release needs the user's public key committed (and says what to do when it is not), no key means
 * no updater artifacts, and code signing is added only when its identity is given.
 */
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { buildConfig, deepMerge, isMinisignPublicKey } from '../packages/desktop/scripts/make-build-config.mjs';

const REAL_LOOKING = Buffer.from('untrusted comment: minisign public key: ABC123\nRWQ...\n').toString('base64');

describe('the build config', () => {
  it('a test build is the throwaway key override, unchanged', () => {
    const base = { bundle: { createUpdaterArtifacts: true }, plugins: { updater: { pubkey: 'THROWAWAY' } } };
    expect(buildConfig({ mode: 'test', base })).toEqual(base);
    expect(() => buildConfig({ mode: 'test' })).toThrow('needs --base');
  });

  it('a release turns updater artifacts on only with a committed minisign public key, and says what to do otherwise', () => {
    expect(buildConfig({ mode: 'release', committedPubkey: REAL_LOOKING })).toEqual({ bundle: { createUpdaterArtifacts: true } });
    for (const bad of ['', undefined, 'REPLACED', Buffer.from('some other file').toString('base64')]) {
      expect(() => buildConfig({ mode: 'release', committedPubkey: bad })).toThrow(/RELEASING\.md/);
    }
  });

  it('a release without a key adds nothing', () => {
    expect(buildConfig({ mode: 'none' })).toEqual({});
    expect(() => buildConfig({ mode: 'other' })).toThrow('unknown mode');
  });

  it('code signing is a slot: set only when an identity or thumbprint is given', () => {
    expect(buildConfig({ mode: 'none', appleIdentity: 'Developer ID Application: X' })).toEqual({ bundle: { macOS: { signingIdentity: 'Developer ID Application: X' } } });
    const both = buildConfig({ mode: 'release', committedPubkey: REAL_LOOKING, windowsThumbprint: 'ABCD' });
    expect(both.bundle.createUpdaterArtifacts).toBe(true);
    expect(both.bundle.windows.certificateThumbprint).toBe('ABCD');
  });

  it('merges nested objects and recognises a minisign key', () => {
    expect(deepMerge({ a: { b: 1, c: 2 } }, { a: { c: 3 }, d: 4 })).toEqual({ a: { b: 1, c: 3 }, d: 4 });
    expect(isMinisignPublicKey(REAL_LOOKING)).toBe(true);
    expect(isMinisignPublicKey(' ')).toBe(false);
  });
});
