/**
 * The folder hash (entry 4.12, `bmad-source/folder-hash.ts`): the same
 * content hash a pinned source's verified files get (`hashEntries`: regular
 * files, LF-normalized, sorted paths), read from disk without following a
 * link, and `undefined` for a folder that holds a link or a FIFO, is past its
 * entry or byte bound, or isn't a real folder.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hashEntries, hashFolder, hashFolderWithCounts } from '../src/bmad-source/index.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function folder(files: Record<string, string | Buffer>): string {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-agents-folder-hash-'));
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    const file = join(dir, ...path.split('/'));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return dir;
}

const FILES = { 'SKILL.md': '---\nname: x\n---\nBody\n', 'assets/a.csv': 'a,b\n1,2\n', 'bin.dat': Buffer.from([0x89, 0x00, 0x0d, 0x0a]) };

describe('hashFolder (entry 4.12)', () => {
  it('is the content hash of the same files, CRLF text and empty folders included', async () => {
    const expected = hashEntries(new Map(Object.entries(FILES).map(([path, data]) => [path, Buffer.from(data)])));
    expect(await hashFolder(folder(FILES))).toBe(expected);
    expect(await hashFolder(folder({ ...FILES, 'SKILL.md': '---\r\nname: x\r\n---\r\nBody\r\n' }))).toBe(expected);
    const withEmpty = folder(FILES);
    mkdirSync(join(withEmpty, 'empty'));
    expect(await hashFolder(withEmpty)).toBe(expected);
    // One file changed or added is another hash.
    expect(await hashFolder(folder({ ...FILES, 'extra.md': '' }))).not.toBe(expected);
  });

  it('a link inside or at the folder, a FIFO, or a missing folder answers undefined', async (ctx) => {
    expect(await hashFolder(join(tmpdir(), 'ogden-agents-no-such-folder'))).toBeUndefined();
    const target = folder(FILES);
    const holder = folder({});
    try {
      symlinkSync(target, join(holder, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
      symlinkSync(join(target, 'SKILL.md'), join(target, 'linked.md'), 'file');
    } catch {
      ctx.skip();
    }
    expect(await hashFolder(join(holder, 'link'))).toBeUndefined();
    expect(await hashFolder(target)).toBeUndefined();
    if (process.platform !== 'win32') {
      const fifo = folder(FILES);
      if (spawnSync('mkfifo', [join(fifo, 'pipe')]).status === 0) expect(await hashFolder(fifo)).toBeUndefined();
    }
  });

  it('answers the entries and bytes it took, so another folder can be hashed within them', async () => {
    const counted = await hashFolderWithCounts(folder(FILES));
    expect(counted).toMatchObject({ entries: 4, bytes: Object.values(FILES).reduce((sum, data) => sum + Buffer.from(data).length, 0) });
    expect(await hashFolderWithCounts(folder(FILES), { maxEntries: counted!.entries, maxBytes: counted!.bytes })).toEqual(counted);
  });

  it('past its entry or byte bound answers undefined', async () => {
    const dir = folder(FILES);
    expect(await hashFolder(dir, { maxEntries: 4 })).toBeDefined();
    expect(await hashFolder(dir, { maxEntries: 3 })).toBeUndefined();
    expect(await hashFolder(dir, { maxBytes: 100 })).toBeDefined();
    expect(await hashFolder(dir, { maxBytes: 20 })).toBeUndefined();
  });
});
