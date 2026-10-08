import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractSection, releaseNotes, VERSION_PATTERN } from '../scripts/release-notes.mjs';

const { version: CURRENT_VERSION } = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { version: string };

const CHANGELOG = `# Changelog

## Unreleased

- Next thing.

## 2026.10.7-2 — second one today

- Thing A.

## 2026.10.7-1 — switch to date-based versioning

- Thing B.
`;

describe('the date-based version format (RELEASING.md)', () => {
  it('accepts a plain year.month.day with a mandatory sequence suffix, none of them leading-zero padded', () => {
    for (const version of ['2026.10.7-1', '2026.1.5-1', '2026.10.7-2', '2026.10.8-1', '2027.1.1-1']) {
      expect(VERSION_PATTERN.test(version), version).toBe(true);
    }
  });

  it('rejects a leading-zero date component', () => {
    for (const version of ['2026.10.07-1', '2026.01.7-1', '2026.10.7-01']) {
      expect(VERSION_PATTERN.test(version), version).toBe(false);
    }
  });

  it('rejects a missing -N suffix, even on what would be a day\'s first release', () => {
    expect(VERSION_PATTERN.test('2026.10.7')).toBe(false);
  });

  it('rejects a classic semver string and other garbage', () => {
    for (const version of ['1.0.0', '0.5.0-rc.1', 'v2026.10.7-1', '2026.10.7-1.2', 'not a version', '']) {
      expect(VERSION_PATTERN.test(version), version).toBe(false);
    }
  });
});

describe('release notes from CHANGELOG.md', () => {
  it('takes the section whose heading starts with the exact version', () => {
    expect(extractSection(CHANGELOG, '2026.10.7-1')?.body).toBe('- Thing B.');
    expect(extractSection(CHANGELOG, '2026.10.7-2')?.body).toContain('Thing A.');
    expect(extractSection(CHANGELOG, '2026.10.7-2')?.body).not.toContain('Thing B.');
  });

  it('never falls back to another day\'s section, a bare core version, or Unreleased: every dated release needs its own section', () => {
    expect(extractSection(CHANGELOG, '2026.10.7')).toBeUndefined();
    expect(extractSection(CHANGELOG, '2026.10.8-1')).toBeUndefined();
    expect(extractSection(CHANGELOG, '2026.10.7-3')).toBeUndefined();
  });

  it('a version with no section is always an error: there is no more stable/prerelease split to fall back on', () => {
    expect(() => releaseNotes(CHANGELOG, '2026.10.9-1', 'o/r')).toThrow('no "## 2026.10.9-1" section');
    expect(() => releaseNotes('# Changelog\n', '2026.10.9-1', 'o/r')).toThrow('no "## 2026.10.9-1" section');
  });

  it('adds how to install and verify, naming the version and the repository, with no prerelease language', () => {
    const notes = releaseNotes(CHANGELOG, '2026.10.7-1', 'o/r');
    expect(notes).toContain('ogden-agents-2026.10.7-1.tgz');
    expect(notes).toContain('SHA256SUMS.txt');
    expect(notes).toContain('https://github.com/o/r/blob/main/RELEASING.md');
    expect(notes).not.toContain('prerelease');
    expect(notes).not.toContain('next` channel');
  });

  it('names the desktop app files, links the README download steps, and has no dashes in its words (story 13.9)', () => {
    const notes = releaseNotes(CHANGELOG, '2026.10.7-1', 'o/r');
    for (const file of [
      'Ogden-Agents_2026.10.7-1_universal.dmg',
      'Ogden-Agents_2026.10.7-1_x64-setup.exe',
      'Ogden-Agents_2026.10.7-1_arm64-setup.exe',
      'Ogden-Agents_2026.10.7-1_amd64.AppImage',
      'Ogden-Agents_2026.10.7-1_aarch64.AppImage',
      'SHA256SUMS-desktop.txt',
    ]) {
      expect(notes).toContain(file);
    }
    expect(notes).toContain('https://github.com/o/r/blob/main/README.md#download');
    const paragraph = notes.split('\n').find((line) => line.startsWith('**The desktop app.**'))!;
    expect(paragraph.replaceAll(/`[^`]*`/g, '')).not.toMatch(/[–—]/);
  });

  it('the script prints the notes for this repository\'s own changelog and its current (date-based) version', () => {
    expect(VERSION_PATTERN.test(CURRENT_VERSION)).toBe(true);
    const script = fileURLToPath(new URL('../scripts/release-notes.mjs', import.meta.url));
    const run = spawnSync(process.execPath, [script, CURRENT_VERSION], { encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('continuous, date-stamped releases');
  });

  it('the script refuses a version that is not the new date-based format', () => {
    const script = fileURLToPath(new URL('../scripts/release-notes.mjs', import.meta.url));
    for (const bad of ['nope', '0.4.0', '2026.10.07-1', '2026.10.7']) {
      const run = spawnSync(process.execPath, [script, bad], { encoding: 'utf8' });
      expect(run.status, bad).toBe(2);
    }
  });
});
