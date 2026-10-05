import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractSection, releaseNotes } from '../scripts/release-notes.mjs';

const CHANGELOG = `# Changelog

## Unreleased

- Next thing.

## 0.4.0 — big one

Published first as 0.4.0-rc.1.

- Thing A.

## 0.3.0 — older

- Thing B.
`;

describe('release notes from CHANGELOG.md', () => {
  it('takes the section whose heading starts with the version', () => {
    expect(extractSection(CHANGELOG, '0.3.0')?.body).toBe('- Thing B.');
    expect(extractSection(CHANGELOG, '0.4.0')?.body).toContain('Thing A.');
    expect(extractSection(CHANGELOG, '0.4.0')?.body).not.toContain('Thing B.');
  });

  it('a prerelease uses its own section, then its release, then Unreleased', () => {
    expect(extractSection(CHANGELOG, '0.4.0-rc.1')?.heading).toBe('0.4.0 — big one');
    expect(extractSection(CHANGELOG, '0.5.0-rc.1')?.heading).toBe('Unreleased');
    expect(extractSection('## 0.5.0-rc.1\n\n- own\n\n## 0.5.0\n\n- rel', '0.5.0-rc.1')?.body).toBe('- own');
  });

  it('a stable version with no section is an error; a prerelease without any gets a link', () => {
    expect(() => releaseNotes(CHANGELOG, '0.9.0', 'o/r')).toThrow('no "## 0.9.0" section');
    expect(releaseNotes('# Changelog\n', '0.9.0-rc.1', 'o/r')).toContain('https://github.com/o/r/blob/main/CHANGELOG.md');
  });

  it('adds how to install and verify, naming the version and the repository', () => {
    const notes = releaseNotes(CHANGELOG, '0.4.0', 'o/r');
    expect(notes).toContain('ogden-agents-0.4.0.tgz');
    expect(notes).toContain('SHA256SUMS.txt');
    expect(notes).toContain('https://github.com/o/r/blob/main/RELEASING.md');
    expect(releaseNotes(CHANGELOG, '0.5.0-rc.1', 'o/r')).toContain('prerelease');
  });

  it('the script prints the notes for this repository\'s own changelog', () => {
    const script = fileURLToPath(new URL('../scripts/release-notes.mjs', import.meta.url));
    const run = spawnSync(process.execPath, [script, '0.4.0'], { encoding: 'utf8' });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('BMad Method');
    expect(spawnSync(process.execPath, [script, 'nope'], { encoding: 'utf8' }).status).toBe(2);
  });
});
