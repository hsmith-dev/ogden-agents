/**
 * The desktop part of a release (story 13.9, E13-R8): artifacts from every leg get space-free names,
 * `SHA256SUMS-desktop.txt` matches the files, and `latest.json` carries each platform's signature
 * and a download URL on the release. An unsigned release has no `latest.json`. Fake files only.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildLatestJson, collectArtifacts, sha256sums } from '../packages/desktop/scripts/release-manifest.mjs';

const SCRIPT = join(import.meta.dirname, '..', 'packages', 'desktop', 'scripts', 'release-manifest.mjs');
const VERSION = '0.5.0-rc.2';
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-release-test-'));
  dirs.push(dir);
  return dir;
};

/** The folders `actions/download-artifact` leaves: one per leg, with Tauri's own file names. */
function downloaded({ signed = true } = {}) {
  const root = temp();
  const put = (leg: string, rel: string, text: string, sig?: string) => {
    const file = join(root, leg, rel);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, text);
    if (signed && sig !== undefined) writeFileSync(`${file}.sig`, sig);
  };
  put('ogden-desktop-macos-universal', `release/bundle/dmg/Ogden Agents_${VERSION}_universal.dmg`, 'dmg bytes');
  put('ogden-desktop-macos-universal', 'release/bundle/macos/Ogden Agents.app.tar.gz', 'mac update bytes', 'MAC-SIGNATURE\n');
  put('ogden-desktop-windows-x64', `release/bundle/nsis/Ogden Agents_${VERSION}_x64-setup.exe`, 'x64 bytes', 'X64-SIGNATURE\n');
  put('ogden-desktop-windows-arm64', `release/bundle/nsis/Ogden Agents_${VERSION}_arm64-setup.exe`, 'arm64 bytes', 'ARM64-SIGNATURE\n');
  return root;
}

describe('release artifacts', () => {
  it('are found by their Tauri names and renamed without spaces', () => {
    const artifacts = collectArtifacts(downloaded(), VERSION);
    expect(artifacts.map((a) => a.name)).toEqual([
      `Ogden-Agents_${VERSION}_universal.dmg`,
      `Ogden-Agents_${VERSION}_universal.app.tar.gz`,
      `Ogden-Agents_${VERSION}_x64-setup.exe`,
      `Ogden-Agents_${VERSION}_arm64-setup.exe`,
    ]);
    for (const artifact of artifacts) expect(artifact.name).not.toMatch(/\s/);
  });

  it('fail loudly when a leg is missing or doubled', () => {
    const root = downloaded();
    rmSync(join(root, 'ogden-desktop-windows-arm64'), { recursive: true });
    expect(() => collectArtifacts(root, VERSION)).toThrow(/arm64-setup\.exe, found 0/);
    expect(() => collectArtifacts(temp(), VERSION)).toThrow(/found 0/);
  });
});

describe('latest.json', () => {
  it('has the version, the notes and, per platform, the signature and a release download URL', () => {
    const artifacts = collectArtifacts(downloaded(), VERSION).map((a) => ({ ...a, signature: a.sigSource === undefined ? undefined : readFileSync(a.sigSource, 'utf8') }));
    const manifest = buildLatestJson({ version: VERSION, notes: 'Notes', pubDate: '2026-10-05T00:00:00.000Z', repo: 'hsmith-dev/ogden-agents', tag: `v${VERSION}`, artifacts });
    expect(manifest.version).toBe(VERSION);
    expect(Object.keys(manifest.platforms).sort()).toEqual(['darwin-aarch64', 'darwin-x86_64', 'windows-aarch64', 'windows-x86_64']);
    expect(manifest.platforms['darwin-aarch64']).toEqual(manifest.platforms['darwin-x86_64']);
    expect(manifest.platforms['windows-x86_64']).toEqual({ signature: 'X64-SIGNATURE', url: `https://github.com/hsmith-dev/ogden-agents/releases/download/v${VERSION}/Ogden-Agents_${VERSION}_x64-setup.exe` });
    expect(manifest.platforms['windows-aarch64']!.signature).toBe('ARM64-SIGNATURE');
  });

  it('refuses an update artifact with no signature', () => {
    const artifacts = collectArtifacts(downloaded({ signed: false }), VERSION);
    expect(() => buildLatestJson({ version: VERSION, notes: '', pubDate: 'now', repo: 'o/r', tag: 't', artifacts })).toThrow(/has no signature/);
  });
});

describe('SHA256SUMS-desktop.txt', () => {
  it('lists every attached file with the hash sha256sum would print', () => {
    const text = sha256sums([{ name: 'a.bin', bytes: Buffer.from('hello') }]);
    expect(text).toBe(`${createHash('sha256').update('hello').digest('hex')}  a.bin\n`);
  });
});

describe('the script', () => {
  const run = (args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

  it('writes the renamed files, their signatures, latest.json and sums that verify', () => {
    const out = temp();
    const notes = join(temp(), 'notes.md');
    writeFileSync(notes, 'What is new.');
    const result = run(['--in', downloaded(), '--out', out, '--version', VERSION, '--tag', `v${VERSION}`, '--repo', 'hsmith-dev/ogden-agents', '--notes-file', notes]);
    expect(result.status, result.stderr).toBe(0);
    const names = readdirSync(out).sort();
    expect(names).toContain('latest.json');
    expect(names).toContain('SHA256SUMS-desktop.txt');
    expect(names).toContain(`Ogden-Agents_${VERSION}_x64-setup.exe.sig`);
    expect(JSON.parse(readFileSync(join(out, 'latest.json'), 'utf8')).notes).toBe('What is new.');
    for (const line of readFileSync(join(out, 'SHA256SUMS-desktop.txt'), 'utf8').trim().split('\n')) {
      const [hash, name] = line.split('  ') as [string, string];
      expect(createHash('sha256').update(readFileSync(join(out, name))).digest('hex')).toBe(hash);
    }
  });

  it('an unsigned release has the installers and sums but no latest.json', () => {
    const out = temp();
    const result = run(['--in', downloaded({ signed: false }), '--out', out, '--version', VERSION, '--tag', `v${VERSION}`, '--repo', 'o/r', '--unsigned']);
    expect(result.status, result.stderr).toBe(0);
    expect(readdirSync(out)).not.toContain('latest.json');
    expect(readdirSync(out)).toContain('SHA256SUMS-desktop.txt');
    expect(result.stdout).toContain('no latest.json');
  });

  it('a signed release with a missing signature fails', () => {
    const result = run(['--in', downloaded({ signed: false }), '--out', temp(), '--version', VERSION, '--tag', `v${VERSION}`, '--repo', 'o/r']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('has no signature');
  });
});
