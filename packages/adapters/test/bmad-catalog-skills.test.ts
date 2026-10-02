/**
 * The catalog's skills (story 4.1): read from `SKILL.md` frontmatter under
 * `.agents/skills/*\/` and `.claude/skills/*\/`, only inside the repo's real
 * path (a linked skill or skills folder that leads out is never read), only
 * well-formed names whose frontmatter agrees, sorted, each once; a missing
 * folder answers none, and scanning writes nothing. Also the in-memory stub's
 * skills, and `tickets-v7` mapping its runner's answers.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { TicketsUnavailableError } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeBmadRepo, type FakeBmadRepo } from '../../../tests/fixtures/fake-bmad-repo.js';
import { createBmadCatalog, createMemoryBmadCatalog, createTicketsV7, parseSkillFrontmatter, ScriptRunError, type UvScriptRunner } from '../src/index.js';

const repos: FakeBmadRepo[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) repo.remove();
});

const skill = (name: string, description = `${name} does a thing.`) => `---\nname: ${name}\ndescription: '${description}'\n---\n\n# ${name}\n`;

function repo(files: Record<string, string>, bmad = false): FakeBmadRepo {
  const created = createFakeBmadRepo({ bmad, files, prefix: 'ogden-agents-skills-repo-' });
  repos.push(created);
  return created;
}

/** A symlink (a junction on Windows for folders, which needs no privilege). */
function link(target: string, at: string, folder: boolean): void {
  mkdirSync(dirname(at), { recursive: true });
  symlinkSync(target, at, folder && process.platform === 'win32' ? 'junction' : folder ? 'dir' : 'file');
}

describe('bmad-catalog skills (story 4.1)', () => {
  it('lists both folders’ skills from their frontmatter, sorted, each once, and writes nothing', async () => {
    const r = repo({
      '.claude/skills/bmad-spec/SKILL.md': skill('bmad-spec', "Condense any input: it's a spec."),
      '.agents/skills/bmad-ticket/SKILL.md': skill('bmad-ticket'),
      '.agents/skills/bmad-spec/SKILL.md': skill('bmad-spec', 'From .agents, read first.'),
      '.claude/skills/folded/SKILL.md': '---\nname: folded\ndescription: >\n  One line\n  and another.\n---\n',
    });
    const before = r.hash();
    expect(await createBmadCatalog().skills(r.path)).toEqual([
      { name: 'bmad-spec', description: 'From .agents, read first.' },
      { name: 'bmad-ticket', description: 'bmad-ticket does a thing.' },
      { name: 'folded', description: 'One line and another.' },
    ]);
    expect(r.hash()).toBe(before);
  });

  it('a repo with neither folder, or a path that is not a folder, has no skills', async () => {
    const r = repo({});
    expect(await createBmadCatalog().skills(r.path)).toEqual([]);
    expect(await createBmadCatalog().skills(join(r.path, 'nowhere'))).toEqual([]);
    expect(await createBmadCatalog().skills('relative/path')).toEqual([]);
    expect(await createBmadCatalog().skills('')).toEqual([]);
  });

  it('leaves out bad folder names, a frontmatter name that differs, no frontmatter, and a folder without SKILL.md', async () => {
    const r = repo({
      '.claude/skills/Bad-Name/SKILL.md': skill('Bad-Name'),
      '.claude/skills/-dash/SKILL.md': skill('-dash'),
      '.claude/skills/has space/SKILL.md': skill('has space'),
      '.claude/skills/other/SKILL.md': skill('not-other'),
      '.claude/skills/plain/SKILL.md': '# No frontmatter\n',
      '.claude/skills/empty/README.md': 'nothing',
      '.claude/skills/good/SKILL.md': skill('good'),
    });
    expect((await createBmadCatalog().skills(r.path)).map((entry) => entry.name)).toEqual(['good']);
  });

  it('never reads a skill whose file, folder or skills folder links out of the repo', async () => {
    const outside = repo({ 'elsewhere/SKILL.md': skill('outside'), 'skills/linked-dir/SKILL.md': skill('linked-dir'), 'all/outside-all/SKILL.md': skill('outside-all') });
    const r = repo({ '.claude/skills/inside/SKILL.md': skill('inside'), 'shared/in-repo/SKILL.md': skill('in-repo') });
    mkdirSync(join(r.path, '.claude', 'skills', 'outside'), { recursive: true });
    link(join(outside.path, 'elsewhere', 'SKILL.md'), join(r.path, '.claude', 'skills', 'outside', 'SKILL.md'), false);
    link(join(outside.path, 'skills', 'linked-dir'), join(r.path, '.claude', 'skills', 'linked-dir'), true);
    link(join(outside.path, 'all'), join(r.path, '.agents', 'skills'), true);
    // A link that stays inside the repo is fine.
    link(join(r.path, 'shared', 'in-repo'), join(r.path, '.claude', 'skills', 'in-repo'), true);
    expect((await createBmadCatalog().skills(r.path)).map((entry) => entry.name)).toEqual(['in-repo', 'inside']);
  });

  it.skipIf(process.platform === 'win32')('never opens a SKILL.md that is a FIFO (it could block forever)', async () => {
    const r = repo({ '.claude/skills/good/SKILL.md': skill('good') });
    mkdirSync(join(r.path, '.claude', 'skills', 'fifo'), { recursive: true });
    const made = spawnSync('mkfifo', [join(r.path, '.claude', 'skills', 'fifo', 'SKILL.md')]);
    if (made.status !== 0) return; // No mkfifo here: nothing to check.
    expect((await createBmadCatalog().skills(r.path)).map((entry) => entry.name)).toEqual(['good']);
  });

  it('a repo root that is a link answers no skills, as detect does', async () => {
    const r = repo({ '.claude/skills/good/SKILL.md': skill('good') });
    const holder = mkdtempSync(join(tmpdir(), 'ogden-agents-skills-link-'));
    try {
      const linked = join(holder, 'repo');
      link(r.path, linked, true);
      expect(await createBmadCatalog().skills(linked)).toEqual([]);
      expect((await createBmadCatalog().skills(r.path)).map((entry) => entry.name)).toEqual(['good']);
    } finally {
      rmSync(holder, { recursive: true, force: true });
    }
  });

  it('parses quoted, folded and missing descriptions', () => {
    expect(parseSkillFrontmatter("---\nname: a\ndescription: 'It''s quoted'\n---\n")).toEqual({ name: 'a', description: "It's quoted" });
    expect(parseSkillFrontmatter('---\nname: "b"\n---\n')).toEqual({ name: 'b' });
    expect(parseSkillFrontmatter('﻿---\r\nname: c\r\ndescription: |\r\n  x\r\n  y\r\n---\r\n')).toEqual({ name: 'c', description: 'x y' });
    expect(parseSkillFrontmatter('no frontmatter')).toBeUndefined();
    expect(parseSkillFrontmatter('---\nname: unterminated\n')).toBeUndefined();
  });
});

describe('catalog-memory skills (story 4.1)', () => {
  it('answers each repo’s skills as copies, none for another, and records each call', async () => {
    const catalog = createMemoryBmadCatalog({}, { '/repo': [{ name: 'bmad-spec', description: 'Spec.' }] });
    const first = await catalog.skills('/repo');
    first[0]!.name = 'changed';
    expect(await catalog.skills('/repo')).toEqual([{ name: 'bmad-spec', description: 'Spec.' }]);
    expect(await catalog.skills('/other')).toEqual([]);
    expect(catalog.skillCalls).toEqual(['/repo', '/repo', '/other']);
    expect(catalog.calls).toEqual([]);
  });
});

describe('tickets-v7 (story 4.1)', () => {
  const ticket = { epic: 'epic-a', id: 1, file: null, type: 'story', title: 'One', status: '', state: 'planned', blocked_reason: '', ref: '1.1', hitl: true, after: [] };

  function store(answer: unknown) {
    const runs: { script: string; args: readonly string[]; cwd: string }[] = [];
    const failures: unknown[] = [];
    const runner: UvScriptRunner = {
      run: async (input) => {
        runs.push(input);
        if (answer instanceof Error) throw answer;
        return answer;
      },
    };
    return { runs, failures, tickets: createTicketsV7({ runner, script: '/vendor/tickets.py', onFailure: (error) => failures.push(error) }) };
  }

  it('runs `status` pinned to the repo and keeps only the board’s fields', async () => {
    const { runs, tickets } = store({ folder: 'x', tickets: [ticket, { ref: '1.2', title: 'Two', state: 'backlog' }], problems: ['a/b.md: skipped'] });
    expect(await tickets.status('/repo')).toEqual({
      tickets: [
        { ref: '1.1', id: 1, epic: 'epic-a', title: 'One', type: 'story', status: '', state: 'planned', blocked_reason: '' },
        { ref: '1.2', id: null, epic: null, title: 'Two', type: null, status: null, state: 'backlog', blocked_reason: null },
      ],
      problems: ['a/b.md: skipped'],
    });
    expect(runs).toEqual([{ script: '/vendor/tickets.py', args: ['--project-root', '/repo', 'status'], cwd: '/repo' }]);
  });

  it('no problems key answers an empty list', async () => {
    expect((await store({ tickets: [] }).tickets.status('/repo')).problems).toEqual([]);
  });

  it.each([
    ['uv_missing', new ScriptRunError('uv_missing')],
    ['failed', new ScriptRunError('failed', { scriptError: 'no active initiative', exitCode: 1 })],
    ['timeout', new ScriptRunError('timeout')],
    ['bad_output', new ScriptRunError('bad_output')],
    ['bad_output', new ScriptRunError('too_much_output')],
  ] as const)('a run that fails (%s) is TicketsUnavailableError', async (reason, error) => {
    const { tickets, failures } = store(error);
    const caught = await tickets.status('/repo').catch((thrown: unknown) => thrown);
    expect(caught).toBeInstanceOf(TicketsUnavailableError);
    expect((caught as TicketsUnavailableError).reason).toBe(reason);
    expect(failures).toEqual([error]);
  });

  it('shares one run among concurrent reads of a repo, and runs again once it settled', async () => {
    let release: (value: unknown) => void = () => {};
    let runs = 0;
    const runner: UvScriptRunner = {
      run: () => {
        runs++;
        return new Promise((resolve) => (release = resolve));
      },
    };
    const tickets = createTicketsV7({ runner, script: '/vendor/tickets.py' });
    const first = tickets.status('/repo');
    const second = tickets.status('/repo');
    expect(second).toBe(first);
    await Promise.resolve();
    expect(runs).toBe(1);
    release({ tickets: [] });
    expect(await first).toEqual({ tickets: [], problems: [] });
    expect(await second).toEqual({ tickets: [], problems: [] });
    const third = tickets.status('/repo');
    await Promise.resolve();
    expect(runs).toBe(2);
    release({ tickets: [] });
    await third;
  });

  it('JSON that is not a ticket list is TicketsUnavailableError (bad_output)', async () => {
    for (const answer of [null, [], { tickets: 'no' }, { tickets: [{ title: 'no ref' }] }]) {
      const caught = await store(answer).tickets.status('/repo').catch((thrown: unknown) => thrown);
      expect((caught as TicketsUnavailableError).reason).toBe('bad_output');
    }
  });
});
