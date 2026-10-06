import { describe, expect, it } from 'vitest';
import { credentialReadFences, CREDENTIAL_FOLDERS } from '../src/build-names.js';

describe("the credential folders a build's commands may not read (story 5.8 review)", () => {
  it('covers keys, cloud logins, the config folder, other agents and macOS keychains and browser profiles', () => {
    const fences = credentialReadFences('/home/u', () => undefined);
    for (const folder of ['.ssh', '.aws', '.config', '.claude', '.codex', '.gemini', '.grok', 'Library/Keychains', 'Library/Application Support/Google/Chrome']) {
      expect(fences, folder).toContain(`/home/u/${folder}`);
    }
    expect(CREDENTIAL_FOLDERS).toContain('.claude.json');
  });

  it('adds where a link really leads, and the folder under the real home when it is not there yet', () => {
    const links: Record<string, string> = { '/home/u/.ssh': '/vault/ssh', '/home/u': '/real/u' };
    const fences = credentialReadFences('/home/u', (path) => links[path]);
    expect(fences).toContain('/home/u/.ssh');
    expect(fences).toContain('/vault/ssh');
    expect(fences).toContain('/real/u/.aws');
    expect(new Set(fences).size).toBe(fences.length);
  });
});
