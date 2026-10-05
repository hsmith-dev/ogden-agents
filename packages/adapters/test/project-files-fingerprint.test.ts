/**
 * The fingerprint of the project files an agent runs (epic 12, 12.3, user
 * decision 2026-10-04): `none` for no files, a hash that changes with any
 * named file's or folder's contents or when one appears, ignores line
 * endings, differs per file set, and is `undefined` for a link anywhere on
 * the way, a special path, a relative repo or an unsafe name.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { projectFilesFingerprint } from '../src/project-files-fingerprint.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-agents-pff-'));
  dirs.push(dir);
  return dir;
};
const FILES = ['.claude/settings.json', '.mcp.json'];
const HASH = /^sha256:[0-9a-f]{64}$/;

describe('projectFilesFingerprint (12.3)', () => {
  it("is 'none' for no files, and a hash for files that aren't there (absence is a state)", async () => {
    const dir = repo();
    expect(await projectFilesFingerprint(dir, [])).toBe('none');
    expect(await projectFilesFingerprint(dir, FILES)).toMatch(HASH);
  });

  it('changes when a named file changes, appears or goes, not with line endings or the order of names', async () => {
    const dir = repo();
    const absent = await projectFilesFingerprint(dir, FILES);
    writeFileSync(join(dir, '.mcp.json'), '{}\n');
    const first = await projectFilesFingerprint(dir, FILES);
    expect(first).not.toBe(absent);
    expect(await projectFilesFingerprint(dir, [...FILES].reverse())).toBe(first);
    expect(await projectFilesFingerprint(dir, [...FILES, ...FILES])).toBe(first);
    writeFileSync(join(dir, '.mcp.json'), '{}\r\n');
    expect(await projectFilesFingerprint(dir, FILES)).toBe(first);
    writeFileSync(join(dir, '.mcp.json'), '{"mcpServers":{"x":{"command":"node"}}}\n');
    const changed = await projectFilesFingerprint(dir, FILES);
    expect(changed).not.toBe(first);
    mkdirSync(join(dir, '.claude'));
    writeFileSync(join(dir, '.claude', 'settings.json'), '{"hooks":{}}');
    const withHooks = await projectFilesFingerprint(dir, FILES);
    expect(withHooks).not.toBe(changed);
    writeFileSync(join(dir, '.claude', 'settings.json'), '{"hooks":{"PreToolUse":[]}}');
    expect(await projectFilesFingerprint(dir, FILES)).not.toBe(withHooks);
  });

  it('a file outside the named ones does not count; a named folder counts as a whole', async () => {
    const dir = repo();
    mkdirSync(join(dir, '.agent'));
    writeFileSync(join(dir, '.agent', 'a.json'), '1');
    writeFileSync(join(dir, 'other.json'), 'x');
    const first = await projectFilesFingerprint(dir, ['.agent']);
    writeFileSync(join(dir, 'other.json'), 'y');
    expect(await projectFilesFingerprint(dir, ['.agent'])).toBe(first);
    writeFileSync(join(dir, '.agent', 'b.json'), '2');
    expect(await projectFilesFingerprint(dir, ['.agent'])).not.toBe(first);
  });

  it('answers undefined for a link on the way or at the file, so nothing counts as trusted through one', async () => {
    const dir = repo();
    const elsewhere = repo();
    writeFileSync(join(elsewhere, 'settings.json'), '{}');
    try {
      symlinkSync(elsewhere, join(dir, '.claude'));
      writeFileSync(join(elsewhere, 'mcp.json'), '{}');
      symlinkSync(join(elsewhere, 'mcp.json'), join(dir, '.mcp.json'));
    } catch {
      return; // No symlinks here (Windows without the privilege).
    }
    expect(await projectFilesFingerprint(dir, ['.claude/settings.json'])).toBeUndefined();
    expect(await projectFilesFingerprint(dir, ['.mcp.json'])).toBeUndefined();
  });

  it('answers undefined for a relative repo, an unsafe name, or a folder where a file is wanted past its bound', async () => {
    const dir = repo();
    expect(await projectFilesFingerprint('relative/path', FILES)).toBeUndefined();
    for (const name of ['', '../x', 'a/../b', '/etc/passwd', 'a\\b', 'a//b', './a']) expect(await projectFilesFingerprint(dir, [name]), name).toBeUndefined();
    writeFileSync(join(dir, 'file'), 'x');
    // A file where a folder is needed on the way.
    expect(await projectFilesFingerprint(dir, ['file/inside.json'])).toBeUndefined();
  });

  it('a file past the size bound is undefined, never partly read', async () => {
    const dir = repo();
    writeFileSync(join(dir, '.mcp.json'), 'x'.repeat(1024 * 1024 + 1));
    expect(await projectFilesFingerprint(dir, ['.mcp.json'])).toBeUndefined();
  });
});
