/**
 * The `bmad-catalog` adapter's `readDocument` (story 4.7): a `.md` file
 * inside the output folder is read; a missing file, a `..` path, a file or
 * folder linked out of the repo or the folder, a FIFO, a non-`.md` file and
 * a repo root that is a link answer `null`; a file over the limit is cut
 * there with `truncated: true` (never splitting a character); the repo's
 * file tree is unchanged.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { MAX_DOCUMENT_BYTES } from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeBmadRepo, type FakeBmadRepo } from '../../../tests/fixtures/fake-bmad-repo.js';
import { readDocument, sameFile } from '../src/bmad-catalog/document.js';
import { createBmadCatalog, createMemoryBmadCatalog } from '../src/index.js';

const repos: FakeBmadRepo[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) repo.remove();
});

function repo(files: Record<string, string> = {}): FakeBmadRepo {
  const made = createFakeBmadRepo({ output: true, files });
  repos.push(made);
  return made;
}

/** A symlink (a junction on Windows for folders); false where this OS or account can't make one. */
function tryLink(target: string, at: string, folder: boolean): boolean {
  mkdirSync(dirname(at), { recursive: true });
  try {
    symlinkSync(target, at, folder && process.platform === 'win32' ? 'junction' : folder ? 'dir' : 'file');
    return true;
  } catch {
    return false;
  }
}

const SPEC = '---\ntitle: Spec\n---\n\n# Spec\n\nHello.\n';

describe('bmad-catalog readDocument (story 4.7)', () => {
  const catalog = createBmadCatalog();

  it('reads a .md inside the output folder, and changes nothing', async () => {
    const r = repo({ '_bmad-output/specs/spec-x.md': SPEC });
    const before = r.hash();
    expect(await catalog.readDocument(r.path, '_bmad-output', '_bmad-output/specs/spec-x.md')).toEqual({ content: SPEC, truncated: false });
    expect(r.hash()).toBe(before);
  });

  it('answers null for a missing file, a folder, a path outside the folder, .. and a non-.md file', async () => {
    const r = repo({ '_bmad-output/notes.txt': 'x', 'src/x.md': '# x', '_bmad-output/dir.md/inner.md': '# inner' });
    for (const path of ['_bmad-output/missing.md', '_bmad-output/notes.txt', 'src/x.md', '_bmad-output/../src/x.md', '../x.md', '/etc/x.md', '_bmad-output/dir.md']) {
      expect(await catalog.readDocument(r.path, '_bmad-output', path), path).toBeNull();
    }
    // An output folder that leaves the repo, or names nothing usable.
    expect(await catalog.readDocument(r.path, '../elsewhere', '../elsewhere/x.md')).toBeNull();
    expect(await catalog.readDocument(r.path, '.', 'src/x.md')).toBeNull();
    expect(await catalog.readDocument('relative/repo', '_bmad-output', '_bmad-output/x.md')).toBeNull();
  });

  it('never reads a file linked out of the folder, or a folder linked out of the repo', async (ctx) => {
    const r = repo({ 'src/secret.md': '# secret' });
    const outside = repo({ 'docs/secret.md': '# outside' });
    if (!tryLink(join(r.path, 'src', 'secret.md'), join(r.path, '_bmad-output', 'link.md'), false)) ctx.skip();
    if (!tryLink(join(outside.path, 'docs'), join(r.path, '_bmad-output', 'linked'), true)) ctx.skip();
    expect(await catalog.readDocument(r.path, '_bmad-output', '_bmad-output/link.md')).toBeNull();
    expect(await catalog.readDocument(r.path, '_bmad-output', '_bmad-output/linked/secret.md')).toBeNull();
    // The output folder itself linked out of the repo.
    const third = repo();
    const elsewhere = repo({ 'out/doc.md': '# doc' });
    if (!tryLink(join(elsewhere.path, 'out'), join(third.path, 'out'), true)) ctx.skip();
    expect(await catalog.readDocument(third.path, 'out', 'out/doc.md')).toBeNull();
  });

  it('never reads a .md link to a file of another kind inside the folder', async (ctx) => {
    const r = repo({ '_bmad-output/data.toml': 'x = 1' });
    if (!tryLink(join(r.path, '_bmad-output', 'data.toml'), join(r.path, '_bmad-output', 'data.md'), false)) ctx.skip();
    expect(await catalog.readDocument(r.path, '_bmad-output', '_bmad-output/data.md')).toBeNull();
  });

  it('a repo root that is a link is never followed into', async (ctx) => {
    const r = repo({ '_bmad-output/spec.md': SPEC });
    const holder = repo();
    const linked = join(holder.path, 'linked-repo');
    if (!tryLink(r.path, linked, true)) ctx.skip();
    expect(await catalog.readDocument(linked, '_bmad-output', '_bmad-output/spec.md')).toBeNull();
  });

  it.skipIf(process.platform === 'win32')('never opens a FIFO', async () => {
    const r = repo();
    mkdirSync(join(r.path, '_bmad-output'), { recursive: true });
    if (spawnSync('mkfifo', [join(r.path, '_bmad-output', 'pipe.md')]).status !== 0) return; // No mkfifo here.
    expect(await catalog.readDocument(r.path, '_bmad-output', '_bmad-output/pipe.md')).toBeNull();
  });

  it('cuts a document over the limit there, without splitting a character', async () => {
    const r = repo();
    const file = join(r.path, '_bmad-output', 'long.md');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${'a'.repeat(9)}é${'b'.repeat(10)}`);
    // 9 ASCII bytes, then é (2 bytes) across the 10-byte cut: the é is dropped, not mangled.
    expect(await readDocument(r.path, '_bmad-output', '_bmad-output/long.md', 10)).toEqual({ content: 'a'.repeat(9), truncated: true });
    expect(await readDocument(r.path, '_bmad-output', '_bmad-output/long.md', 11)).toEqual({ content: `${'a'.repeat(9)}é`, truncated: true });
    expect(await readDocument(r.path, '_bmad-output', '_bmad-output/long.md', 21)).toEqual({ content: `${'a'.repeat(9)}é${'b'.repeat(10)}`, truncated: false });
    writeFileSync(file, 'x'.repeat(MAX_DOCUMENT_BYTES + 5));
    const read = await catalog.readDocument(r.path, '_bmad-output', '_bmad-output/long.md');
    expect(read?.truncated).toBe(true);
    expect(read?.content.length).toBe(MAX_DOCUMENT_BYTES);
    writeFileSync(file, 'x'.repeat(MAX_DOCUMENT_BYTES));
    expect((await catalog.readDocument(r.path, '_bmad-output', '_bmad-output/long.md'))?.truncated).toBe(false);
  });
});

describe('the opened file is the checked one (story 4.7 review)', () => {
  it('sameFile compares device and inode: another file, or the same inode on another device, is not the same', () => {
    const r = repo({ '_bmad-output/a.md': 'a', '_bmad-output/b.md': 'b' });
    const a = statSync(join(r.path, '_bmad-output', 'a.md'), { bigint: true });
    const b = statSync(join(r.path, '_bmad-output', 'b.md'), { bigint: true });
    expect(sameFile(a, statSync(join(r.path, '_bmad-output', 'a.md'), { bigint: true }))).toBe(true);
    expect(sameFile(a, b)).toBe(false);
    expect(sameFile({ dev: a.dev, ino: a.ino }, { dev: a.dev + 1n, ino: a.ino })).toBe(false);
    expect(sameFile({ dev: a.dev, ino: a.ino }, { dev: a.dev, ino: a.ino + 1n })).toBe(false);
  });
});

describe('catalog-memory readDocument (story 4.7)', () => {
  it('answers its documents inside the output folder only, and records each call', async () => {
    const memory = createMemoryBmadCatalog({}, {}, { documents: { '/repo': { '_bmad-output/spec.md': '# Spec', 'src/x.md': '# x' } } });
    expect(await memory.readDocument('/repo', '_bmad-output', '_bmad-output/spec.md')).toEqual({ content: '# Spec', truncated: false });
    expect(await memory.readDocument('/repo', '_bmad-output', 'src/x.md')).toBeNull();
    expect(await memory.readDocument('/repo', '_bmad-output', '_bmad-output/missing.md')).toBeNull();
    expect(await memory.readDocument('/other', '_bmad-output', '_bmad-output/spec.md')).toBeNull();
    expect(memory.documentCalls).toHaveLength(4);
  });
});
