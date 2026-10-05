/**
 * The `bmad-catalog` adapter's read-only `detect` (story 10.3, E10-R5): a
 * real `_bmad/` or `_bmad-output/` folder answers true; a missing one, a
 * file, a symlink to a folder (never followed) and a deleted repo answer
 * false; the repo's file tree hashes the same before and after; and the
 * adapter's source uses no `fs` function but `lstat`.
 */
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeBmadRepo, type FakeBmadRepo } from '../../../tests/fixtures/fake-bmad-repo.js';
import { createBmadCatalog } from '../src/index.js';

const repos: FakeBmadRepo[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) repo.remove();
});

function repo(options: Parameters<typeof createFakeBmadRepo>[0] = {}): FakeBmadRepo {
  const made = createFakeBmadRepo(options);
  repos.push(made);
  return made;
}

/** Makes a symlink to a folder, or answers false where this OS or account can't (Windows without the right). */
function trySymlinkDir(target: string, path: string): boolean {
  try {
    symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir');
    return true;
  } catch {
    return false;
  }
}

describe('bmad-catalog detect', () => {
  const catalog = createBmadCatalog();

  it('finds _bmad and _bmad-output as real folders, and neither in a plain repo', async () => {
    expect(await catalog.detect(repo().path)).toEqual({ hasBmad: true, hasOutput: false });
    expect(await catalog.detect(repo({ output: true }).path)).toEqual({ hasBmad: true, hasOutput: true });
    expect(await catalog.detect(repo({ bmad: false, output: true }).path)).toEqual({ hasBmad: false, hasOutput: true });
    expect(await catalog.detect(repo({ bmad: false }).path)).toEqual({ hasBmad: false, hasOutput: false });
  });

  it('answers false for a file named _bmad and for a deleted, relative or empty repo path', async () => {
    const withFile = repo({ bmad: false, files: { _bmad: 'not a folder', '_bmad-output': 'nor this' } });
    expect(await catalog.detect(withFile.path)).toEqual({ hasBmad: false, hasOutput: false });

    const gone = repo();
    rmSync(gone.path, { recursive: true, force: true });
    expect(await catalog.detect(gone.path)).toEqual({ hasBmad: false, hasOutput: false });

    for (const path of ['', '.', 'some/repo', join('..', 'repo')]) expect(await catalog.detect(path), path).toEqual({ hasBmad: false, hasOutput: false });
  });

  it('answers false for a symlinked _bmad and never reads its target', async (ctx) => {
    const elsewhere = repo({ bmad: true, output: true });
    const linked = repo({ bmad: false });
    if (!trySymlinkDir(join(elsewhere.path, '_bmad'), join(linked.path, '_bmad'))) ctx.skip();
    trySymlinkDir(join(elsewhere.path, '_bmad-output'), join(linked.path, '_bmad-output'));
    const before = { linked: linked.hash(), elsewhere: elsewhere.hash() };
    expect(await catalog.detect(linked.path)).toEqual({ hasBmad: false, hasOutput: false });
    expect({ linked: linked.hash(), elsewhere: elsewhere.hash() }).toEqual(before);
  });

  it('answers false for a repo root that has become a symlink to a BMad repo', async (ctx) => {
    const target = repo({ bmad: true, output: true });
    const holder = repo({ bmad: false });
    const root = join(holder.path, 'linked-root');
    if (!trySymlinkDir(target.path, root)) ctx.skip();
    expect(await catalog.detect(root)).toEqual({ hasBmad: false, hasOutput: false });
  });

  it("leaves the repo's file tree exactly as it was", async () => {
    const bmadRepo = repo({ output: true, files: { '.claude/skills/mine/SKILL.md': '# mine\n' } });
    mkdirSync(join(bmadRepo.path, '_bmad', 'empty'));
    writeFileSync(join(bmadRepo.path, '_bmad', 'note.txt'), 'x');
    const before = bmadRepo.hash();
    for (let i = 0; i < 3; i++) await catalog.detect(bmadRepo.path);
    expect(bmadRepo.hash()).toBe(before);
  });

  it('its source imports no fs function but lstat (read-only by construction)', () => {
    const source = readFileSync(join(import.meta.dirname, '..', 'src', 'bmad-catalog', 'index.ts'), 'utf8');
    const fsImports = [...source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'(?:node:)?fs(?:\/promises)?'/g)].flatMap((match) =>
      match[1]!.split(',').map((name) => name.trim()).filter(Boolean),
    );
    expect(fsImports).toEqual(['lstat']);
    // No default or namespace import of fs, no require, no dynamic import.
    expect(source).not.toMatch(/import\s+(?:\*\s+as\s+\w+|\w+)\s+from\s+'(?:node:)?fs(?:\/promises)?'/);
    expect(source).not.toMatch(/require\(|import\(/);
    // Only the two constant names are joined to the repo path.
    expect([...source.matchAll(/join\(([^)]*)\)/g)].map((match) => match[1])).toEqual(['repoPath, name']);
  });
});
