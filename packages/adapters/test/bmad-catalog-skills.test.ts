/**
 * The catalog's skills (story 4.1): read from `SKILL.md` frontmatter under
 * `.agents/skills/*\/` and `.claude/skills/*\/`, only inside the repo's real
 * path (a linked skill or skills folder that leads out is never read), only
 * well-formed names whose frontmatter agrees, sorted, each once; a missing
 * folder answers none, and scanning writes nothing. Also the in-memory stub's
 * skills, and `tickets-v7` mapping its runner's answers.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { NotFoundError, TicketsUnavailableError } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeBmadRepo, type FakeBmadRepo } from '../../../tests/fixtures/fake-bmad-repo.js';
import {
  createBmadCatalog,
  createMemoryBmadCatalog,
  createTicketsV7,
  createUvScriptRunner,
  parseSkillFrontmatter,
  ScriptRunError,
  uvEnvironment,
  type UvScriptRunner,
} from '../src/index.js';

const FAKE_UV = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-uv.mjs');

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
      close: async () => {},
    };
    return { runs, failures, tickets: createTicketsV7({ runner, script: () => '/verified/tickets.py', workDir: '/work', onFailure: (error) => failures.push(error) }) };
  }

  it('runs `status` pinned to the repo and keeps only the board’s fields, with story 4.2’s defaults', async () => {
    const { runs, tickets } = store({ folder: 'x', tickets: [ticket, { ref: '1.2', title: 'Two', state: 'backlog', estimate: 3 }], problems: ['a/b.md: skipped'] });
    const defaults = { tracker_id: '', assignee: '', hitl: false, covers: [], after: [], blocks: [], blocked_at: '' };
    expect(await tickets.tree('/repo')).toEqual({
      tickets: [
        { ref: '1.1', id: 1, epic: 'epic-a', title: 'One', type: 'story', status: '', state: 'planned', blocked_reason: '', file: null, ...defaults, hitl: true },
        { ref: '1.2', id: null, epic: null, title: 'Two', type: null, status: null, state: 'backlog', blocked_reason: null, file: null, ...defaults },
      ],
      problems: ['a/b.md: skipped'],
      folder: 'x',
      epics: [],
    });
    expect(runs).toEqual([{ script: '/verified/tickets.py', args: ['--project-root', '/repo', 'status'], cwd: '/work' }]);
  });

  it('no problems key answers an empty list', async () => {
    expect((await store({ tickets: [] }).tickets.tree('/repo')).problems).toEqual([]);
  });

  it.each([
    ['uv_missing', new ScriptRunError('uv_missing')],
    ['failed', new ScriptRunError('failed', { scriptError: 'no active initiative', exitCode: 1 })],
    ['timeout', new ScriptRunError('timeout')],
    ['bad_output', new ScriptRunError('bad_output')],
    ['bad_output', new ScriptRunError('too_much_output')],
    ['failed', new ScriptRunError('closed')],
  ] as const)('a run that fails (%s) is TicketsUnavailableError', async (reason, error) => {
    const { tickets, failures } = store(error);
    const caught = await tickets.tree('/repo').catch((thrown: unknown) => thrown);
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
      close: async () => {},
    };
    const tickets = createTicketsV7({ runner, script: () => '/verified/tickets.py', workDir: '/work' });
    const first = tickets.tree('/repo');
    const second = tickets.tree('/repo');
    expect(second).toBe(first);
    await Promise.resolve();
    expect(runs).toBe(1);
    release({ tickets: [] });
    expect(await first).toEqual({ tickets: [], problems: [], folder: null, epics: [] });
    expect(await second).toEqual({ tickets: [], problems: [], folder: null, epics: [] });
    const third = tickets.tree('/repo');
    await Promise.resolve();
    expect(runs).toBe(2);
    release({ tickets: [] });
    await third;
  });

  it('JSON that is not a ticket list is TicketsUnavailableError (bad_output)', async () => {
    for (const answer of [null, [], { tickets: 'no' }, { tickets: [{ title: 'no ref' }] }, { tickets: [], epics: [{ slug: 3 }] }]) {
      const caught = await store(answer).tickets.tree('/repo').catch((thrown: unknown) => thrown);
      expect((caught as TicketsUnavailableError).reason).toBe('bad_output');
    }
  });

  it('keeps the initiative’s epics as status reports them (story 4.2)', async () => {
    const epic = { slug: 'epic-a', id: 1, status: 'in-progress', after: [], blocks: ['epic-b'] };
    expect((await store({ tickets: [], epics: [epic] }).tickets.tree('/repo')).epics).toEqual([epic]);
  });
});

describe('tickets-v7 find, mark and watch (story 4.2)', () => {
  /** A fake runner answering each subcommand (`find`, `mark`) from `answers`; an Error is thrown. */
  function store(answers: Record<string, unknown>) {
    const runs: { script: string; args: readonly string[]; cwd: string }[] = [];
    const runner: UvScriptRunner = {
      run: async (input) => {
        runs.push(input);
        const answer = answers[input.args[2]!];
        if (answer instanceof Error) throw answer;
        return answer;
      },
      close: async () => {},
    };
    return { runs, tickets: createTicketsV7({ runner, script: () => '/verified/tickets.py', workDir: '/work' }) };
  }
  const found = {
    epic: 'epic-a', id: 2, file: null, type: 'story', title: 'Two payment', status: '', state: 'planned', blocked_reason: '', ref: '1.2',
    folder: 'epic-a', description: 'Do two.', verify: 'It works.', references: ['spec'], notes: [], unknown: '', plan: '/repo/_bmad-output/x/epic-a/story-two-plan.md',
  };
  const marked = { plan: '/repo/p.md', created: true, status: 'blocked', assignee: '', blocked_at: '2026-10-02', blocked_reason: '-x y' };

  it('find runs `find <ref>` in the work folder and answers the row with its text; a plan file that is not there is hasPlan false', async () => {
    const { runs, tickets } = store({ find: found });
    const detail = await tickets.find('/repo', '1.2');
    expect(detail).toMatchObject({ ref: '1.2', title: 'Two payment', description: 'Do two.', verify: 'It works.', references: ['spec'], notes: [], unknown: '', hasPlan: false });
    expect(runs).toEqual([{ script: '/verified/tickets.py', args: ['--project-root', '/repo', 'find', '1.2'], cwd: '/work' }]);
  });

  it('find and mark answer NotFoundError for "no ticket matches" and "matches more than one ticket", and never pass a malformed ref', async () => {
    for (const scriptError of ["no ticket matches '9.9'", "'9.9' matches more than one ticket: a in x, b in y"]) {
      const missing = new ScriptRunError('failed', { scriptError, exitCode: 1 });
      await expect(store({ find: missing }).tickets.find('/repo', '9.9')).rejects.toThrow(NotFoundError);
      const marking = store({ find: missing, mark: marked });
      await expect(marking.tickets.mark('/repo', '9.9', 'draft')).rejects.toThrow(NotFoundError);
      expect(marking.runs.map((run) => run.args[2])).toEqual(['find']);
    }
    const { runs, tickets } = store({ find: found });
    await expect(tickets.find('/repo', '--help')).rejects.toThrow(NotFoundError);
    expect(runs).toEqual([]);
  });

  it('a ref the script resolved by title or tracker id to another ticket is NotFoundError, and mark writes nothing', async () => {
    // `tickets.py` resolves "payment" to the ticket whose title contains it (1.2).
    const { runs, tickets } = store({ find: found, mark: marked });
    await expect(tickets.find('/repo', 'payment')).rejects.toThrow(NotFoundError);
    await expect(tickets.mark('/repo', 'payment', 'blocked')).rejects.toThrow(NotFoundError);
    expect(runs.map((run) => run.args[2])).toEqual(['find', 'find']);
  });

  it('mark finds the exact ticket first, then runs `mark <ref> <status>` with the blocked reason as one argument', async () => {
    const { runs, tickets } = store({ find: found, mark: marked });
    expect(await tickets.mark('/repo', '1.2', 'blocked', { blockedReason: '-x y' })).toEqual({ ref: '1.2', status: 'blocked' });
    expect(runs.map((run) => run.args)).toEqual([
      ['--project-root', '/repo', 'find', '1.2'],
      ['--project-root', '/repo', 'mark', '1.2', 'blocked', '--blocked=-x y'],
    ]);
    expect(runs.every((run) => run.cwd === '/work')).toBe(true);
  });

  it('mark: exit 2 (the store refuses) is store_refused', async () => {
    const caught = await store({ find: found, mark: new ScriptRunError('failed', { scriptError: 'store is linear', exitCode: 2 }) })
      .tickets.mark('/repo', '1.2', 'draft')
      .catch((thrown: unknown) => thrown);
    expect((caught as TicketsUnavailableError).reason).toBe('store_refused');
  });

  it('watch rejects until entry 4.8 builds it', async () => {
    await expect(store({}).tickets.watch('/repo', '_bmad-output', () => {})).rejects.toThrow(/4\.8/);
  });

  it('runs uv in the work folder, never the repo, so a .venv the repo ships is not found (fake uv, echo)', async () => {
    const repoDir = repo({ '.venv/bin/python': '#!/bin/sh\necho pwned\n' }, true);
    const workDir = mkdtempSync(join(tmpdir(), 'ogden-agents-uv-work-'));
    try {
      const real = createUvScriptRunner({ uvCommand: async () => ({ file: process.execPath, args: [FAKE_UV] }), env: () => ({ ...uvEnvironment(), FAKE_UV_MODE: 'echo' }) });
      const echoed: Array<{ cwd: string; argv: string[] }> = [];
      const runner: UvScriptRunner = {
        run: async (input) => {
          echoed.push((await real.run(input)) as { cwd: string; argv: string[] });
          return { tickets: [] };
        },
        close: () => real.close(),
      };
      await createTicketsV7({ runner, script: () => '/verified/tickets.py', workDir }).tree(repoDir.path);
      expect(realpathSync(echoed[0]!.cwd)).toBe(realpathSync(workDir));
      expect(realpathSync(echoed[0]!.cwd)).not.toBe(realpathSync(repoDir.path));
      expect(echoed[0]!.argv).toEqual(['run', '--no-project', '--quiet', '/verified/tickets.py', '--project-root', repoDir.path, 'status']);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
