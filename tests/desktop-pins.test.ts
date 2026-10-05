/**
 * The desktop app's Node pins (story 13.3, AD-23): the check passes on the committed pins against a
 * matching published list, fails when one hash changes, and the staging script's table is the same
 * file. CI's `Desktop pins` job runs the script against nodejs.org itself; these tests never do.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { archiveName, parseShasums, pinProblems, REQUIRED_PLATFORMS } from '../scripts/desktop-pins.mjs';

const pins = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'packages', 'desktop', 'desktop-node-pins.json'), 'utf8')) as {
  version: string;
  archives: Record<string, { ext: string; sha256: string }>;
};
const published = (overrides: Record<string, string> = {}) =>
  new Map<string, string>([
    ...Object.entries(pins.archives).map(([platform, { ext, sha256 }]) => [archiveName(pins.version, platform, ext), sha256] as [string, string]),
    ...Object.entries(overrides),
  ]);

describe('desktop Node pins', () => {
  it('cover every target and pass against the published hashes', () => {
    expect(Object.keys(pins.archives).sort()).toEqual([...REQUIRED_PLATFORMS].sort());
    expect(pinProblems(pins, published())).toEqual([]);
  });

  it('fail when a pinned hash differs from the published one', () => {
    const name = archiveName(pins.version, 'win-x64', pins.archives['win-x64']!.ext);
    const problems = pinProblems(pins, published({ [name]: 'f'.repeat(64) }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('win-x64');
  });

  it('fail on a missing pin, a missing archive and a malformed hash or version', () => {
    const { 'darwin-arm64': _removed, ...rest } = pins.archives;
    expect(pinProblems({ ...pins, archives: rest }, published())).toEqual(['no pin for darwin-arm64']);
    expect(pinProblems(pins, new Map())).toHaveLength(REQUIRED_PLATFORMS.length);
    expect(pinProblems({ ...pins, archives: { ...pins.archives, 'win-x64': { ext: 'zip', sha256: 'abc' } } }, published())[0]).toContain('64 lowercase hex');
    expect(pinProblems({ ...pins, version: '24' }, published())[0]).toContain('plain x.y.z');
  });

  it('read SHASUMS256.txt lines', () => {
    const hash = 'a'.repeat(64);
    expect(parseShasums(`${hash}  node-v1.0.0-win-x64.zip\r\nnot a line\n${hash} *other.tar.gz\n`)).toEqual(new Map([['node-v1.0.0-win-x64.zip', hash], ['other.tar.gz', hash]]));
  });
});
