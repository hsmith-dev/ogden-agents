/**
 * The real catalog (story 4.4, E4-R3, E4-R4), on a repo built from the
 * pinned upstream module records (`bmod-method`, `bmod-core-tools`) plus a
 * generated `SKILL.md` per skill they list: every module skill is listed
 * with its mapped label, group and module, the record folders are not
 * skills, the agents come from the roster, the entry action is the mapped
 * one and both capabilities are detected; an unlabelled skill keeps its
 * `SKILL.md` description; a module copied in shows on the next read; bad
 * metadata (malformed records and rosters, bad codes, links out of the
 * repo, a FIFO) leaves that module or agent out without throwing; and a
 * read writes nothing. The label trust (entry 4.12): only a skill whose
 * folder equals the verified pinned copy's is labelled (a repo's own
 * `bmad-product-brief`, a link or an extra file inside, or no downloaded
 * copy, gets no label, group, next or entry action).
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Catalog } from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeBmadRepo, FAKE_TICKET_TREE_FILES, type FakeBmadRepo } from '../../../tests/fixtures/fake-bmad-repo.js';
import { pinnedCopyAt } from '../../../tests/fixtures/pinned-copy.js';
import { buildCatalog, MAX_ROSTER_MEMBERS } from '../src/bmad-catalog/catalog.js';
import { readModuleLabels } from '../src/bmad-catalog/labels.js';
import { MAX_SKILL_FOLDER_ENTRIES, readHead } from '../src/bmad-catalog/skills.js';
import { createBmadCatalog, createMemoryBmadSource, SKILL_LABELS } from '../src/index.js';

const UPSTREAM_SKILLS = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'bmad-upstream', 'skills');
const upstream = (...parts: string[]) => readFileSync(join(UPSTREAM_SKILLS, ...parts), 'utf8');
const LABELS = readModuleLabels(SKILL_LABELS).labels;
const CONFIG_SCRIPT = '_bmad/scripts/config_utils.py';

const skill = (name: string, description = `${name} from SKILL.md.`) => `---\nname: ${name}\ndescription: '${description}'\n---\n\n# ${name}\n`;

/** The skills a pinned record lists. */
function listedSkills(folder: string): string[] {
  const block = upstream(folder, 'bmod.toml').split('skills = [')[1]!.split(']')[0]!;
  return [...block.matchAll(/"([a-z0-9-]+)"/g)].map((match) => match[1]!);
}
const METHOD_SKILLS = listedSkills('bmod-method');
const CORE_SKILLS = listedSkills('bmod-core-tools');

/** The pinned records and a `SKILL.md` per skill they list, under `.claude/skills/`. */
function upstreamFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const folder of ['bmod-method', 'bmod-core-tools']) {
    for (const file of ['bmod.toml', 'SKILL.md']) files[`.claude/skills/${folder}/${file}`] = upstream(folder, file);
  }
  files['.claude/skills/bmod-method/roster.toml'] = upstream('bmod-method', 'roster.toml');
  for (const name of [...METHOD_SKILLS, ...CORE_SKILLS]) files[`.claude/skills/${name}/SKILL.md`] = skill(name);
  return files;
}

const repos: FakeBmadRepo[] = [];
afterEach(() => {
  for (const made of repos.splice(0)) made.remove();
});

function repo(files: Record<string, string>): FakeBmadRepo {
  const made = createFakeBmadRepo({ bmad: false, files, prefix: 'ogden-agents-catalog-repo-' });
  repos.push(made);
  return made;
}

function write(root: string, path: string, content: string): void {
  const file = join(root, ...path.split('/'));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/**
 * A verified pinned copy holding exactly the skill folders of `files` (paths
 * under `.claude/skills/`, record folders included), so the catalog labels
 * those skills (entry 4.12).
 */
function pinnedCopyOf(files: Record<string, string>) {
  const copy: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) if (path.startsWith('.claude/skills/')) copy[path.slice('.claude/skills/'.length)] = content;
  return pinnedCopyAt(repo(copy).path);
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

/** A module record (and its skills' `SKILL.md`s) as a test module. */
function moduleFiles(folder: string, record: string, skills: readonly string[] = []): Record<string, string> {
  const files: Record<string, string> = { [`.claude/skills/${folder}/bmod.toml`]: record };
  for (const name of skills) files[`.claude/skills/${name}/SKILL.md`] = skill(name);
  return files;
}

describe('bmad-catalog catalog (story 4.4)', () => {
  it('lists the installed upstream modules, their labelled skills and roster agents, the entry action and both capabilities', async () => {
    const r = repo({ ...upstreamFiles(), '.claude/skills/my-own/SKILL.md': skill('my-own', 'My own skill.'), [CONFIG_SCRIPT]: FAKE_TICKET_TREE_FILES[CONFIG_SCRIPT]! });
    const before = r.hash();
    const catalog = Catalog.parse(await createBmadCatalog({ source: pinnedCopyOf(upstreamFiles()) }).catalog(r.path));

    expect(catalog.modules).toEqual([
      { code: 'core-tools', name: 'Core tools', version: '6.13.0-next', installedAt: null },
      { code: 'method', name: 'BMad Method', version: '6.13.0-next', installedAt: null },
    ]);
    // Every listed skill, and the user's own; the record folders are not skills.
    expect(catalog.skills.map((entry) => entry.name)).toEqual([...METHOD_SKILLS, ...CORE_SKILLS, 'my-own'].sort());
    for (const entry of catalog.skills) {
      if (entry.name === 'my-own') continue;
      const mapped = LABELS.skills.get(entry.name)!;
      expect(entry.label, entry.name).toBe(mapped.label);
      expect(entry.group, entry.name).toBe(mapped.group);
      expect(entry.description, entry.name).toBe(mapped.description ?? `${entry.name} from SKILL.md.`);
      expect(entry.module, entry.name).toBe(METHOD_SKILLS.includes(entry.name) ? 'method' : 'core-tools');
      expect(entry.installedAt, entry.name).toBeNull();
      expect(entry.next, entry.name).toEqual(mapped.next);
    }
    // The look-back is epic-scoped with the next steps that are installed (epic 7), and no other skill has a scope.
    const look = catalog.skills.find((entry) => entry.name === 'bmad-retrospective')!;
    const installedNames = catalog.skills.map((entry) => entry.name);
    expect(look.scope).toBe('epic');
    // The steps are the mapping's, each only where its skill is installed.
    const wanted = LABELS.skills.get('bmad-retrospective')!.nexts.map((step) => step.skill);
    expect(wanted).toEqual(['bmad-project-context', 'bmad-ticket']);
    expect(look.nexts.map((step) => step.skill)).toEqual(wanted.filter((name) => installedNames.includes(name)));
    expect(installedNames).toContain('bmad-ticket');
    expect(look.nexts.length).toBeGreaterThan(0);
    expect(catalog.skills.filter((entry) => entry.scope === 'epic').map((entry) => entry.name)).toEqual(['bmad-retrospective']);
    expect(await createBmadCatalog({ source: pinnedCopyOf(upstreamFiles()) }).missingCapabilities(r.path, ['look_back'])).toEqual([]);
    // An unlabelled skill keeps its SKILL.md description, with null metadata.
    expect(catalog.skills.find((entry) => entry.name === 'my-own')).toEqual({
      name: 'my-own',
      description: 'My own skill.',
      label: null,
      group: null,
      module: null,
      installedAt: null,
      next: null,
      scope: null,
      nexts: [],
    });
    // The roster's members, named by their skill and labelled as the mapping says.
    expect(catalog.agents.map((agent) => [agent.name, agent.module])).toEqual([
      ['bmad-agent-analyst', 'method'],
      ['bmad-agent-architect', 'method'],
      ['bmad-agent-dev', 'method'],
      ['bmad-agent-pm', 'method'],
      ['bmad-agent-ux-designer', 'method'],
    ]);
    for (const agent of catalog.agents) {
      expect(agent.label, agent.name).toBe(LABELS.skills.get(agent.name)!.label);
      expect(agent.description, agent.name).toBe(catalog.skills.find((entry) => entry.name === agent.name)!.description);
    }
    expect(catalog.entryAction).toBe('bmad-product-brief');
    expect(catalog.capabilities).toEqual({ plain_labels: true, ticket_tree: true, look_back: true });
    expect(r.hash()).toBe(before);
  });

  it('without labels or a ticket tree: the roster title labels an agent, a module shows its code, and both capabilities are false', async () => {
    const r = repo({
      ...moduleFiles('bmod-demo', '[bmod]\ncode = "demo"\nskills = ["demo-agent", "demo-skill"]\n', ['demo-agent', 'demo-skill']),
      '.claude/skills/bmod-demo/roster.toml': '[[members]]\nskill = "demo-agent"\ntitle = "Demo Guide"\n\n[[members]]\nskill = "demo-skill"\n\n[[members]]\nname = "Guest"\ntitle = "No skill"\n\n[[members]]\nskill = "not-installed"\ntitle = "Gone"\n',
    });
    const catalog = await buildCatalog(r.path, { labels: readModuleLabels({ entry: null, skills: {} }).labels });
    expect(catalog.modules).toEqual([{ code: 'demo', name: 'demo', version: null, installedAt: null }]);
    expect(catalog.skills.map((entry) => [entry.name, entry.label, entry.module])).toEqual([
      ['demo-agent', null, 'demo'],
      ['demo-skill', null, 'demo'],
    ]);
    expect(catalog.agents).toEqual([
      { name: 'demo-agent', label: 'Demo Guide', description: 'demo-agent from SKILL.md.', module: 'demo' },
      { name: 'demo-skill', label: 'demo-skill', description: 'demo-skill from SKILL.md.', module: 'demo' },
    ]);
    expect(catalog.entryAction).toBeNull();
    expect(catalog.capabilities).toEqual({ plain_labels: false, ticket_tree: false, look_back: false });
  });

  it('a module copied in shows on the next read, with its skills', async () => {
    const r = repo(upstreamFiles());
    const catalog = createBmadCatalog();
    expect((await catalog.catalog(r.path)).modules.map((module) => module.code)).toEqual(['core-tools', 'method']);
    for (const [path, content] of Object.entries(moduleFiles('bmod-demo', '[bmod]\ncode = "demo"\nversion = "1.0.0"\nskills = ["demo-skill"]\n', ['demo-skill']))) write(r.path, path, content);
    const next = await catalog.catalog(r.path);
    expect(next.modules.map((module) => [module.code, module.version])).toEqual([
      ['core-tools', '6.13.0-next'],
      ['demo', '1.0.0'],
      ['method', '6.13.0-next'],
    ]);
    expect(next.skills.find((entry) => entry.name === 'demo-skill')?.module).toBe('demo');
    expect(next.skills.some((entry) => entry.name === 'bmod-demo')).toBe(false);
  });

  it('the first record of a code wins, .agents before .claude; a skill listed twice belongs to the first module', async () => {
    const r = repo({
      '.agents/skills/bmod-one/bmod.toml': '[bmod]\ncode = "one"\nversion = "1"\nskills = ["shared"]\n',
      '.claude/skills/bmod-again/bmod.toml': '[bmod]\ncode = "one"\nversion = "2"\nskills = ["other"]\n',
      '.claude/skills/bmod-two/bmod.toml': '[bmod]\ncode = "two"\nskills = ["shared", "other"]\n',
      '.claude/skills/shared/SKILL.md': skill('shared'),
      '.claude/skills/other/SKILL.md': skill('other'),
    });
    const catalog = await createBmadCatalog().catalog(r.path);
    expect(catalog.modules.map((module) => [module.code, module.version])).toEqual([
      ['one', '1'],
      ['two', null],
    ]);
    expect(catalog.skills.map((entry) => [entry.name, entry.module])).toEqual([
      ['other', 'two'],
      ['shared', 'one'],
    ]);
  });

  it('leaves out a malformed record or roster, a bad code or skills list, and a non-skill bmod.toml; nothing throws', async () => {
    const r = repo({
      ...upstreamFiles(),
      // Records that are not modules: their folders still aren't skills.
      ...moduleFiles('bmod-nocode', '[bmod]\nversion = "1"\nskills = ["x"]\n'),
      ...moduleFiles('bmod-badcode', '[bmod]\ncode = "Bad Code"\n'),
      ...moduleFiles('bmod-numcode', '[bmod]\ncode = 3\n'),
      ...moduleFiles('bmod-badskills', '[bmod]\ncode = "badskills"\nskills = "x"\n'),
      ...moduleFiles('bmod-garbage', '[bmod\ncode = "garbage"\n{{{{'),
      // A skill whose own bmod.toml is not a record (as upstream's `bmad`): still a skill, no module.
      '.claude/skills/plain/SKILL.md': skill('plain'),
      '.claude/skills/plain/bmod.toml': '[skill]\nbmod = "bmod-core-tools"\n',
      // A bad skill name in a record's list is ignored; a roster that is garbage gives no agent.
      ...moduleFiles('bmod-ok', '[bmod]\ncode = "ok"\nskills = ["../x", "ok-skill"]\n', ['ok-skill']),
      '.claude/skills/bmod-ok/roster.toml': '[[members]\nskill = "ok-skill"\n',
    });
    const catalog = await createBmadCatalog().catalog(r.path);
    expect(catalog.modules.map((module) => module.code)).toEqual(['core-tools', 'method', 'ok']);
    const names = catalog.skills.map((entry) => entry.name);
    expect(names.filter((name) => name.startsWith('bmod-'))).toEqual([]);
    expect(names).toEqual(expect.arrayContaining(['plain', 'ok-skill']));
    expect(catalog.skills.find((entry) => entry.name === 'plain')?.module).toBeNull();
    expect(catalog.skills.find((entry) => entry.name === 'ok-skill')?.module).toBe('ok');
    expect(catalog.agents.map((agent) => agent.name)).not.toContain('ok-skill');
  });

  it('leaves out a record whose skills is there but unreadable (a number, numbers, a mixed list); its folder is still not a skill', async () => {
    const r = repo({
      ...moduleFiles('bmod-num', '[bmod]\ncode = "num"\nskills = 3\n'),
      ...moduleFiles('bmod-nums', '[bmod]\ncode = "nums"\nskills = [1, 2]\n'),
      ...moduleFiles('bmod-mixed', '[bmod]\ncode = "mixed"\nskills = ["a", 1]\n'),
      ...moduleFiles('bmod-none', '[bmod]\ncode = "none"\n'),
      '.claude/skills/bmod-num/SKILL.md': skill('bmod-num'),
    });
    const catalog = await createBmadCatalog().catalog(r.path);
    expect(catalog.modules.map((module) => module.code)).toEqual(['none']);
    expect(catalog.skills).toEqual([]);
  });

  it('the first record that names a code claims it, even when it is left out', async () => {
    const r = repo({
      '.agents/skills/bmod-first/bmod.toml': '[bmod]\ncode = "one"\nskills = 3\n',
      ...moduleFiles('bmod-later', '[bmod]\ncode = "one"\nskills = ["s"]\n', ['s']),
    });
    const catalog = await createBmadCatalog().catalog(r.path);
    expect(catalog.modules).toEqual([]);
    expect(catalog.skills.map((entry) => [entry.name, entry.module])).toEqual([['s', null]]);
  });

  it(`reads at most ${MAX_SKILL_FOLDER_ENTRIES} entries of a skills folder and ${MAX_ROSTER_MEMBERS} roster members`, async () => {
    const files: Record<string, string> = {};
    const names = Array.from({ length: MAX_SKILL_FOLDER_ENTRIES - 1 }, (_, index) => `s${String(index).padStart(4, '0')}`);
    for (const name of names) files[`.claude/skills/${name}/SKILL.md`] = skill(name);
    // `bmod-a` sorts first (in), then the skills, then `zz-*` past the cap (never read).
    files['.claude/skills/bmod-a/bmod.toml'] = `[bmod]\ncode = "a"\nskills = ["s0000"]\n`;
    files['.claude/skills/bmod-a/roster.toml'] = names.slice(0, MAX_ROSTER_MEMBERS + 1).map((name) => `[[members]]\nskill = "${name}"\n`).join('\n');
    files['.claude/skills/zz-bmod/bmod.toml'] = '[bmod]\ncode = "zz"\nskills = ["zz-skill"]\n';
    files['.claude/skills/zz-skill/SKILL.md'] = skill('zz-skill');
    const catalog = await createBmadCatalog().catalog(repo(files).path);
    expect(catalog.modules.map((module) => module.code)).toEqual(['a']);
    expect(catalog.skills.map((entry) => entry.name)).toEqual(names);
    expect(catalog.agents).toHaveLength(MAX_ROSTER_MEMBERS);
    expect(await createBmadCatalog().skills(repo(files).path)).toHaveLength(MAX_SKILL_FOLDER_ENTRIES - 1);
  });

  it('readHead never follows a link at the file itself', async (ctx) => {
    const r = repo({ 'real.txt': 'content' });
    if (!tryLink(join(r.path, 'real.txt'), join(r.path, 'link.txt'), false)) ctx.skip();
    expect(await readHead(join(r.path, 'real.txt'))).toBe('content');
    expect(await readHead(join(r.path, 'link.txt'))).toBe(process.platform === 'win32' ? 'content' : undefined);
  });

  it('never reads a record or roster linked out of the repo', async (ctx) => {
    const outside = repo({
      '.claude/skills/bmod-out/bmod.toml': '[bmod]\ncode = "out"\nskills = ["in-skill"]\n',
      'roster.toml': '[[members]]\nskill = "in-skill"\ntitle = "Out"\n',
    });
    const r = repo({ ...moduleFiles('bmod-in', '[bmod]\ncode = "in"\nskills = ["in-skill"]\n', ['in-skill']) });
    if (!tryLink(join(outside.path, '.claude', 'skills', 'bmod-out'), join(r.path, '.claude', 'skills', 'bmod-out'), true)) ctx.skip();
    if (!tryLink(join(outside.path, 'roster.toml'), join(r.path, '.claude', 'skills', 'bmod-in', 'roster.toml'), false)) ctx.skip();
    const catalog = await createBmadCatalog().catalog(r.path);
    expect(catalog.modules.map((module) => module.code)).toEqual(['in']);
    expect(catalog.agents).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')('never opens a bmod.toml or roster.toml that is a FIFO', async () => {
    const r = repo({ ...moduleFiles('bmod-in', '[bmod]\ncode = "in"\nskills = ["in-skill"]\n', ['in-skill']) });
    mkdirSync(join(r.path, '.claude', 'skills', 'bmod-fifo'), { recursive: true });
    mkdirSync(join(r.path, '_bmad', 'scripts'), { recursive: true });
    const made = [
      spawnSync('mkfifo', [join(r.path, '.claude', 'skills', 'bmod-fifo', 'bmod.toml')]),
      spawnSync('mkfifo', [join(r.path, '.claude', 'skills', 'bmod-in', 'roster.toml')]),
      spawnSync('mkfifo', [join(r.path, '_bmad', 'scripts', 'config_utils.py')]),
    ];
    if (made.some((result) => result.status !== 0)) return; // No mkfifo here: nothing to check.
    const catalog = await createBmadCatalog().catalog(r.path);
    expect(catalog.modules.map((module) => module.code)).toEqual(['in']);
    expect(catalog.agents).toEqual([]);
    expect(catalog.capabilities.ticket_tree).toBe(false);
  });

  it('ticket_tree: true with load_central_config defined; false without it, linked, or missing', async (ctx) => {
    const tree = async (files: Record<string, string>) => (await createBmadCatalog().catalog(repo(files).path)).capabilities.ticket_tree;
    expect(await tree({ [CONFIG_SCRIPT]: FAKE_TICKET_TREE_FILES[CONFIG_SCRIPT]! })).toBe(true);
    expect(await tree({ [CONFIG_SCRIPT]: 'def load_config(root):\n    return {}\n# load_central_config( is only named\n' })).toBe(false);
    expect(await tree({})).toBe(false);
    expect(await tree({ '_bmad/scripts/config_utils.py/inner': 'a folder, not a file' })).toBe(false);

    // Linked: the file, or a folder on the way, is a link (even to a good script inside the repo).
    const good = repo({ 'elsewhere/config_utils.py': FAKE_TICKET_TREE_FILES[CONFIG_SCRIPT]!, 'elsewhere/scripts/config_utils.py': FAKE_TICKET_TREE_FILES[CONFIG_SCRIPT]! });
    if (!tryLink(join(good.path, 'elsewhere', 'config_utils.py'), join(good.path, '_bmad', 'scripts', 'config_utils.py'), false)) ctx.skip();
    expect((await createBmadCatalog().catalog(good.path)).capabilities.ticket_tree).toBe(false);
    const folder = repo({ '_bmad/.keep': '', 'elsewhere/scripts/config_utils.py': FAKE_TICKET_TREE_FILES[CONFIG_SCRIPT]! });
    if (!tryLink(join(folder.path, 'elsewhere', 'scripts'), join(folder.path, '_bmad', 'scripts'), true)) ctx.skip();
    expect((await createBmadCatalog().catalog(folder.path)).capabilities.ticket_tree).toBe(false);
  });

  it('a missing, relative or linked repo root answers an empty catalog', async (ctx) => {
    const empty = { modules: [], skills: [], agents: [], entryAction: null, capabilities: { plain_labels: false, ticket_tree: false, look_back: false } };
    for (const path of ['', 'relative/repo', '/no/such/repo']) expect(await createBmadCatalog().catalog(path), path).toEqual(empty);
    const target = repo(upstreamFiles());
    const holder = repo({});
    if (!tryLink(target.path, join(holder.path, 'root'), true)) ctx.skip();
    expect(await createBmadCatalog().catalog(join(holder.path, 'root'))).toEqual(empty);
  });
});

describe('the label trust (entry 4.12)', () => {
  const BRIEF = join(UPSTREAM_SKILLS, 'bmad-product-brief');
  /** The pinned upstream fixture as the verified copy. */
  const pinned = () => pinnedCopyAt(UPSTREAM_SKILLS);
  /** A repo with upstream's `bmad-product-brief` folder copied into `.claude/skills`, changed by `change` first. */
  function briefRepo(change: (folder: string) => void = () => {}) {
    const r = repo({ '.claude/skills/my-own/SKILL.md': skill('my-own', 'My own skill.') });
    const folder = join(r.path, '.claude', 'skills', 'bmad-product-brief');
    cpSync(BRIEF, folder, { recursive: true });
    change(folder);
    return r;
  }
  const briefOf = (catalog: Catalog) => catalog.skills.find((entry) => entry.name === 'bmad-product-brief')!;
  const MAPPED = LABELS.skills.get('bmad-product-brief')!;
  const UPSTREAM_DESCRIPTION = 'Create, update, or validate a product brief. Use when the user wants help producing, editing, or validating a brief';

  it('a folder identical to the pinned copy is labelled, with the entry action (CRLF in the repo too)', async () => {
    for (const r of [
      briefRepo(),
      briefRepo((folder) => writeFileSync(join(folder, 'SKILL.md'), readFileSync(join(folder, 'SKILL.md'), 'utf8').replaceAll('\n', '\r\n'))),
    ]) {
      const catalog = await createBmadCatalog({ source: pinned() }).catalog(r.path);
      expect(briefOf(catalog)).toMatchObject({ label: MAPPED.label, group: MAPPED.group });
      expect(catalog.entryAction).toBe('bmad-product-brief');
      expect(catalog.capabilities.plain_labels).toBe(true);
      expect(await createBmadCatalog({ source: pinned() }).missingCapabilities(r.path, ['plain_labels'])).toEqual([]);
    }
  });

  it('a repo skill that only uses the mapped name is listed with its own description, no label, group, next or entry action', async () => {
    const r = repo({ '.claude/skills/bmad-product-brief/SKILL.md': skill('bmad-product-brief', 'Run my own script.') });
    const before = r.hash();
    const catalog = await createBmadCatalog({ source: pinned() }).catalog(r.path);
    expect(briefOf(catalog)).toEqual({ name: 'bmad-product-brief', description: 'Run my own script.', label: null, group: null, module: null, installedAt: null, next: null, scope: null, nexts: [] });
    expect(catalog.entryAction).toBeNull();
    expect(catalog.capabilities.plain_labels).toBe(false);
    expect(await createBmadCatalog({ source: pinned() }).missingCapabilities(r.path, ['plain_labels'])).toEqual(['plain_labels']);
    expect(r.hash()).toBe(before);
  });

  it('a repo skill that only uses the look-back name has no epic scope, so look_back is missing (epic 7)', async () => {
    const r = repo({ '.claude/skills/bmad-retrospective/SKILL.md': skill('bmad-retrospective', 'Run my own script.') });
    const catalog = await createBmadCatalog({ source: pinned() }).catalog(r.path);
    expect(catalog.skills.find((entry) => entry.name === 'bmad-retrospective')).toMatchObject({ label: null, scope: null, nexts: [] });
    expect(catalog.capabilities.look_back).toBe(false);
    expect(await createBmadCatalog({ source: pinned() }).missingCapabilities(r.path, ['look_back', 'plain_labels'])).toEqual(['plain_labels', 'look_back']);
  });

  it('not downloaded (no source, or a source not ready): nothing is labelled', async () => {
    const r = briefRepo();
    for (const catalog of [createBmadCatalog(), createBmadCatalog({ source: createMemoryBmadSource({ files: { 'bmad-product-brief/SKILL.md': join(BRIEF, 'SKILL.md') } }) })]) {
      const read = await catalog.catalog(r.path);
      expect(briefOf(read)).toMatchObject({ description: UPSTREAM_DESCRIPTION, label: null, group: null, next: null });
      expect(read.entryAction).toBeNull();
      expect(read.capabilities.plain_labels).toBe(false);
    }
  });

  it('one file added or changed in the folder: not verified', async () => {
    const changed = [
      briefRepo((folder) => writeFileSync(join(folder, 'extra.md'), 'one more file')),
      briefRepo((folder) => writeFileSync(join(folder, 'customize.toml'), `${readFileSync(join(folder, 'customize.toml'), 'utf8')}\n# changed\n`)),
      briefRepo((folder) => mkdirSync(join(folder, 'empty-folder'))),
    ];
    for (const r of changed) {
      const catalog = await createBmadCatalog({ source: pinned() }).catalog(r.path);
      expect(briefOf(catalog).label).toBeNull();
      expect(catalog.entryAction).toBeNull();
    }
  });

  it('a repo folder past the pinned folder\'s counts (more entries, or more than twice its bytes) is not verified', async () => {
    const extraEntries = briefRepo((folder) => {
      for (let index = 0; index < 50; index++) mkdirSync(join(folder, `empty-${index}`));
    });
    const tooBig = briefRepo((folder) => writeFileSync(join(folder, 'SKILL.md'), `${readFileSync(join(folder, 'SKILL.md'), 'utf8')}${'x'.repeat(200_000)}`));
    for (const r of [extraEntries, tooBig]) expect((await createBmadCatalog({ source: pinned() }).catalog(r.path)).entryAction).toBeNull();
  });

  it('every installed copy must be the pinned one: a hostile copy in the other skills folder (either way round) is not verified', async () => {
    for (const [good, bad] of [
      ['.agents', '.claude'],
      ['.claude', '.agents'],
    ] as const) {
      const r = repo({ [`${bad}/skills/bmad-product-brief/SKILL.md`]: skill('bmad-product-brief', 'Run my own script.') });
      cpSync(BRIEF, join(r.path, good, 'skills', 'bmad-product-brief'), { recursive: true });
      const catalog = await createBmadCatalog({ source: pinned() }).catalog(r.path);
      expect(briefOf(catalog).label, good).toBeNull();
      expect(catalog.entryAction, good).toBeNull();
      expect(catalog.capabilities.plain_labels, good).toBe(false);
    }
  });

  it('a mapped name another folder claims in its frontmatter is not verified', async () => {
    const r = briefRepo();
    write(r.path, '.claude/skills/my-brief/SKILL.md', skill('bmad-product-brief', 'Run my own script.'));
    const catalog = await createBmadCatalog({ source: pinned() }).catalog(r.path);
    expect(briefOf(catalog).label).toBeNull();
    expect(catalog.entryAction).toBeNull();
    // Without the claim, the same repo is verified.
    expect((await createBmadCatalog({ source: pinned() }).catalog(briefRepo().path)).entryAction).toBe('bmad-product-brief');
  });

  it('a link inside the folder, or the folder itself a link, is not verified', async (ctx) => {
    // The template swapped for a link to an identical copy beside the skill folder.
    const fileLink = briefRepo();
    const template = join(fileLink.path, '.claude', 'skills', 'bmad-product-brief', 'assets', 'brief-template.md');
    const outside = join(fileLink.path, 'brief-template.md');
    cpSync(template, outside);
    rmSync(template);
    if (!tryLink(outside, template, false)) ctx.skip();
    expect((await createBmadCatalog({ source: pinned() }).catalog(fileLink.path)).entryAction).toBeNull();

    const linkedFolder = repo({});
    if (!tryLink(BRIEF, join(linkedFolder.path, '.claude', 'skills', 'bmad-product-brief'), true)) ctx.skip();
    expect((await createBmadCatalog({ source: pinned() }).catalog(linkedFolder.path)).entryAction).toBeNull();
  });

  it('agents are labelled only from verified skills', async () => {
    const files = upstreamFiles();
    const catalog = await createBmadCatalog({ source: pinned() }).catalog(repo(files).path);
    // The fixture's copy has none of the roster's skills: each agent is named by its roster title or skill, never the mapping.
    for (const agent of catalog.agents) expect(agent.label, agent.name).not.toBe(LABELS.skills.get(agent.name)!.label);
  });
});
