/**
 * An epic's retrospective file (epic 7, story 7.4), read-only: the
 * `bmad-catalog` adapter's `readRetrospective` finds the last
 * `*-retrospective.md` directly in the epic folder and reads its head with
 * `readDocument`'s confinement (a linked epic folder, a linked file, a file
 * outside the output folder, a non-file, a name with no stem all answer
 * `null`); the memory catalog answers the same from its documents; and the
 * `tickets-v7` watch signature reports the epics whose retrospective file
 * appeared, changed or went, from names and `lstat`s only.
 */
import { mkdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeBmadRepo, type FakeBmadRepo } from '../../../tests/fixtures/fake-bmad-repo.js';
import { changedRetrospectives, retrospectiveSignatures } from '../src/tickets-v7/retrospective-watch.js';
import { createBmadCatalog, createMemoryBmadCatalog } from '../src/index.js';

const repos: FakeBmadRepo[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) repo.remove();
});
const repo = (files: Record<string, string> = {}): FakeBmadRepo => {
  const made = createFakeBmadRepo({ output: true, files });
  repos.push(made);
  return made;
};
function tryLink(target: string, at: string, folder: boolean): boolean {
  mkdirSync(dirname(at), { recursive: true });
  try {
    symlinkSync(target, at, folder && process.platform === 'win32' ? 'junction' : folder ? 'dir' : 'file');
    return true;
  } catch {
    return false;
  }
}

const EPIC = '_bmad-output/initiative-demo/epic-a';
const RETRO = '---\nverdict: accepted\ndate: 2026-10-05\n---\n\n# Retro\n';

describe('bmad-catalog readRetrospective', () => {
  const catalog = createBmadCatalog();

  it('reads the retrospective beside the epic and changes nothing; the last by name when several', async () => {
    const r = repo({ [`${EPIC}/epic-a-retrospective.md`]: RETRO, [`${EPIC}/epic-a.md`]: '# Epic\n', [`${EPIC}/old-retrospective.md`]: '---\nverdict: rejected\n---\n' });
    const before = r.hash();
    expect(await catalog.readRetrospective(r.path, '_bmad-output', EPIC)).toEqual({ path: `${EPIC}/old-retrospective.md`, content: '---\nverdict: rejected\n---\n' });
    expect(r.hash()).toBe(before);
    const single = repo({ [`${EPIC}/epic-a-retrospective.md`]: RETRO });
    expect(await catalog.readRetrospective(single.path, '_bmad-output', EPIC)).toEqual({ path: `${EPIC}/epic-a-retrospective.md`, content: RETRO });
  });

  it('answers null for no file, a bare suffix, a folder that is not there, other folders and bad paths', async () => {
    const r = repo({ [`${EPIC}/epic-a.md`]: '# Epic\n', [`${EPIC}/-retrospective.md`]: 'x', '_bmad-output/other/z-retrospective.md': RETRO });
    expect(await catalog.readRetrospective(r.path, '_bmad-output', EPIC)).toBeNull();
    expect(await catalog.readRetrospective(r.path, '_bmad-output', '_bmad-output/initiative-demo/missing')).toBeNull();
    expect(await catalog.readRetrospective(r.path, '_bmad-output', '../outside')).toBeNull();
    expect(await catalog.readRetrospective(r.path, '_bmad-output', '/abs')).toBeNull();
    // A folder outside the output folder is never read.
    expect(await catalog.readRetrospective(r.path, '_bmad-output/specs', '_bmad-output/other')).toBeNull();
    expect(await catalog.readRetrospective('/no/such/repo', '_bmad-output', EPIC)).toBeNull();
  });

  it('reads only the head of a long file', async () => {
    const r = repo({ [`${EPIC}/epic-a-retrospective.md`]: `${RETRO}${'x'.repeat(20_000)}` });
    const read = await catalog.readRetrospective(r.path, '_bmad-output', EPIC);
    expect(read!.content.length).toBeLessThanOrEqual(8 * 1024);
    expect(read!.content.startsWith(RETRO)).toBe(true);
  });

  it('never follows a link: a linked epic folder or file answers null', async (ctx) => {
    const r = repo({ 'elsewhere/real-retrospective.md': RETRO });
    if (!tryLink(join(r.path, 'elsewhere'), join(r.path, EPIC), true)) return ctx.skip();
    expect(await catalog.readRetrospective(r.path, '_bmad-output', EPIC)).toBeNull();
    const linkedFile = repo({ 'outside/secret.md': 'secret' });
    mkdirSync(join(linkedFile.path, EPIC), { recursive: true });
    if (!tryLink(join(linkedFile.path, 'outside', 'secret.md'), join(linkedFile.path, EPIC, 'a-retrospective.md'), false)) return ctx.skip();
    expect(await catalog.readRetrospective(linkedFile.path, '_bmad-output', EPIC)).toBeNull();
  });
});

describe('catalog-memory readRetrospective', () => {
  it('answers the last matching document directly in the epic folder, capped, and records the call', async () => {
    const memory = createMemoryBmadCatalog({}, {}, { documents: { '/repo': { [`${EPIC}/a-retrospective.md`]: RETRO, [`${EPIC}/sub/z-retrospective.md`]: 'no', [`${EPIC}/epic-a.md`]: 'no' } } });
    expect(await memory.readRetrospective('/repo', '_bmad-output', EPIC)).toEqual({ path: `${EPIC}/a-retrospective.md`, content: RETRO });
    expect(await memory.readRetrospective('/repo', '_bmad-output', '_bmad-output/initiative-demo/epic-b')).toBeNull();
    expect(await memory.readRetrospective('/repo', 'docs', EPIC)).toBeNull();
    expect(memory.retrospectiveCalls).toHaveLength(3);
  });
});

describe('the watch signature of retrospective files', () => {
  const tree = { folder: 'initiative-demo', epics: [{ slug: 'epic-a' }, { slug: 'epic-b' }, { slug: '../x' }] } as never;

  it('is empty for an epic with none, names each file, and reports the epics whose file appeared, changed or went', async () => {
    const r = repo({ [`${EPIC}/epic-a.md`]: '# Epic\n' });
    const root = join(r.path, '_bmad-output');
    const first = await retrospectiveSignatures(root, tree);
    expect([...first.keys()]).toEqual(['epic-a', 'epic-b']);
    expect([...first.values()]).toEqual(['', '']);

    const file = join(r.path, EPIC, 'epic-a-retrospective.md');
    writeFileSync(file, RETRO);
    const second = await retrospectiveSignatures(root, tree);
    expect(changedRetrospectives(first, second)).toEqual(['epic-a']);
    expect(changedRetrospectives(second, await retrospectiveSignatures(root, tree))).toEqual([]);

    writeFileSync(file, `${RETRO}more`);
    utimesSync(file, new Date(2030, 0, 1), new Date(2030, 0, 1));
    const third = await retrospectiveSignatures(root, tree);
    expect(changedRetrospectives(second, third)).toEqual(['epic-a']);

    rmSync(file);
    expect(changedRetrospectives(third, await retrospectiveSignatures(root, tree))).toEqual(['epic-a']);
  });

  it('skips an unsafe initiative or epic name and a linked epic folder', async (ctx) => {
    const r = repo({ 'elsewhere/x-retrospective.md': RETRO });
    const root = join(r.path, '_bmad-output');
    expect((await retrospectiveSignatures(root, { folder: '../x', epics: [{ slug: 'epic-a' }] } as never)).size).toBe(0);
    if (!tryLink(join(r.path, 'elsewhere'), join(r.path, EPIC), true)) return ctx.skip();
    expect((await retrospectiveSignatures(root, tree)).get('epic-a')).toBe('');
  });
});
