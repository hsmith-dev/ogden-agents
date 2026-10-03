/**
 * BMad Method's setup in the `bmad-catalog` adapter (story 4.3; review S1
 * and S2), through the real script runner and the fake uv
 * (`FAKE_UV_MODE=bmad-setup`, which emulates `setup.py` and logs each run's
 * argv and cwd), on a small verified copy in a temp folder that a memory
 * `BmadSourcePort` answers:
 *
 * - Set up downloads first (the source's one `download()`); every run is the
 *   verified `setup.py`, in the work folder, with `--skill` the verified
 *   `bmad` folder and the repo named only by `--project-root`; a failed
 *   download fails with its own plain message and writes nothing;
 * - the verified skills are copied (no `__pycache__`), an existing skill
 *   folder is left untouched, a linked `.claude` or `.claude/skills` is
 *   refused before anything is created, and no staging folder is left;
 * - a repo with `_bmad` (a folder or a link) is refused, writing nothing;
 * - the status is read from files only (no run): `not_set_up`, `unusable`,
 *   `setup_owed`, `update_available`, `current`;
 * - questions are answered with their defaults through a file in the work
 *   folder, removed afterwards; failures are plain reasons;
 * - Upgrade (entry 4.11): on the older `bmod` plain fixture, the same
 *   verified runs in the work folder; a skill the project has in
 *   `.agents/skills` or `.claude/skills` is never copied over or touched;
 *   refused with its plain reason, nothing written, nothing downloaded and
 *   nothing run, for a linked or file `_bmad`, a linked `.claude/skills`, a
 *   linked config, and an output folder outside the repo, unreadable here or
 *   reached through a link.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { BmadAlreadySetUpError, BmadDownloadError, BmadSetupError } from '@ogden-agents/core';
import {
  BMAD_DOWNLOAD_OFFLINE_MESSAGE,
  BMAD_SETUP_FAILURE_REASONS,
  BMAD_SETUP_NOT_A_FOLDER_TEXT,
  BMAD_SETUP_STEPS,
  BMAD_SETUP_VERSION_UNKNOWN_TEXT,
  BMAD_UPGRADE_REFUSED_TEXT,
  type BmadSetupProgress,
} from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createPlainRepo, PLAIN_BMOD_OWN_SKILL } from '../../../tests/fixtures/bmad-plain/plain-repos.js';
import { createFakeBmadRepo, type FakeBmadRepo } from '../../../tests/fixtures/fake-bmad-repo.js';
import { MAX_UPGRADE_BMAD_ENTRIES, strictOutputFolder, tomlString } from '../src/bmad-catalog/setup.js';
import { createBmadCatalog, createMemoryBmadSource, createUvScriptRunner, MEMORY_BMAD_SOURCE_VERSION, uvEnvironment, type UvScriptRunner } from '../src/index.js';

const FAKE_UV = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-uv.mjs');
const PINNED = MEMORY_BMAD_SOURCE_VERSION;

const cleanups: Array<() => void> = [];
const runners: UvScriptRunner[] = [];
afterEach(async () => {
  for (const runner of runners.splice(0)) await runner.close();
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function tempFolder(prefix: string): string {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return folder;
}

function write(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    const file = join(root, ...path.split('/'));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
}

/** A small verified `skills/` folder: `bmad` (with setup.py and a `__pycache__`), `bmad-spec`, `bmod-method`. */
function verifiedCopy(): string {
  const dir = tempFolder('ogden-agents-verified-');
  write(dir, {
    'bmad/SKILL.md': '---\nname: bmad\ndescription: BMad.\n---\n',
    'bmad/scripts/setup.py': 'raise SystemExit("never run by these tests")\n',
    'bmad/scripts/__pycache__/setup.cpython-312.pyc': 'bytecode',
    'bmad-spec/SKILL.md': '---\nname: bmad-spec\ndescription: Spec.\n---\n',
    'bmod-method/bmod.toml': `[bmod]\ncode = "method"\nversion = "${PINNED}"\n`,
  });
  return dir;
}

function repo(files: Record<string, string> = {}): FakeBmadRepo {
  const created = createFakeBmadRepo({ bmad: false, files, prefix: 'ogden-agents-setup-repo-' });
  cleanups.push(() => created.remove());
  return created;
}

function link(target: string, at: string): void {
  mkdirSync(dirname(at), { recursive: true });
  symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir');
}

interface Logged {
  argv: string[];
  cwd: string;
  answers: string | null;
}

/** The real adapter on the fake uv and a memory source of a verified copy, with `env` added to the runs' environment. */
function adapter(env: Record<string, string> = {}, options: { uvMissing?: boolean; downloadFails?: boolean } = {}) {
  const skills = verifiedCopy();
  const script = join(skills, 'bmad', 'scripts', 'setup.py');
  const workDir = tempFolder('ogden-agents-uv-work-');
  const log = join(tempFolder('ogden-agents-uv-log-'), 'runs.jsonl');
  const runner = createUvScriptRunner({
    uvCommand: async () => (options.uvMissing === true ? undefined : { file: process.execPath, args: [FAKE_UV] }),
    env: () => ({ ...uvEnvironment(), FAKE_UV_MODE: 'bmad-setup', FAKE_UV_LOG_FILE: log, ...env }),
  });
  runners.push(runner);
  const source = createMemoryBmadSource({ files: { 'bmad/scripts/setup.py': script }, ...(options.downloadFails === true ? { failWith: 'offline' as const } : {}) });
  const catalog = createBmadCatalog({ runner, workDir, source });
  const runs = (): Logged[] => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Logged) : []);
  return { catalog, source, skills, workDir, runs, script };
}

/** A set-up repo's files, as setup leaves them, with the installed BMad Method at `version`. */
const setUp = (version = PINNED) => ({
  '.claude/skills/bmod-method/bmod.toml': `[bmod]\ncode = "method"\nversion = "${version}"\n`,
  '_bmad/scripts/setup.py': '',
  '_bmad/config.toml': '[core]\noutput_folder = "{project-root}/docs/out"\n',
  'docs/out/.keep': '',
});

const stagingLeft = (skillsFolder: string) => (existsSync(skillsFolder) ? readdirSync(skillsFolder).filter((name) => name.includes('ogden-setup')) : []);

describe('bmad-catalog setup (story 4.3)', () => {
  it('downloads, copies the verified skills, runs the verified setup.py in the work folder with --skill the verified bmad, and reports current', async () => {
    const { catalog, source, runs, script, skills, workDir } = adapter();
    const r = repo();
    const progress: BmadSetupProgress[] = [];
    const status = await catalog.setup(r.path, (step) => progress.push(step));
    expect(source.downloads).toBe(1);
    expect(progress.map((step) => step.step)).toEqual([...BMAD_SETUP_STEPS]);
    expect(status).toEqual({ state: 'current', outputFolder: '_bmad-output', bundledVersion: PINNED, installedVersion: PINNED, problems: [] });
    const skillsFolder = join(r.path, '.claude', 'skills');
    expect(readdirSync(skillsFolder).sort()).toEqual(['bmad', 'bmad-spec', 'bmod-method']);
    expect(existsSync(join(skillsFolder, 'bmad', 'scripts', '__pycache__'))).toBe(false);

    const logged = runs();
    const prefix = ['run', '--no-project', '--quiet', script, '--project-root', r.path, '--skill', join(skills, 'bmad')];
    expect(logged.map((run) => run.argv)).toEqual([[...prefix, '--list-config-questions'], prefix]);
    for (const run of logged) {
      expect(run.cwd).toBe(realpathSync(workDir));
      expect(run.argv).not.toContain('--root');
      expect(run.answers).toBeNull();
    }
  });

  it('a failed download fails with its plain message; nothing is written and no script runs', async () => {
    const { catalog, runs } = adapter({}, { downloadFails: true });
    const r = repo();
    const before = r.hash();
    const caught = await catalog.setup(r.path, () => {}).catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(BmadDownloadError);
    expect((caught as Error).message).toBe(BMAD_DOWNLOAD_OFFLINE_MESSAGE);
    expect(r.hash()).toBe(before);
    expect(runs()).toEqual([]);
  });

  it('leaves an existing skill folder untouched and copies the others', async () => {
    const { catalog } = adapter();
    const r = repo({ '.claude/skills/bmad-spec/SKILL.md': 'my own spec skill\n' });
    await catalog.setup(r.path, () => {});
    expect(readFileSync(join(r.path, '.claude', 'skills', 'bmad-spec', 'SKILL.md'), 'utf8')).toBe('my own spec skill\n');
    expect(existsSync(join(r.path, '.claude', 'skills', 'bmad', 'SKILL.md'))).toBe(true);
  });

  it('refuses a linked .claude/skills or .claude before creating anything: no copy, no run, no download', async () => {
    const { catalog, runs, source } = adapter();
    const elsewhere = tempFolder('ogden-agents-elsewhere-');
    const r = repo();
    link(elsewhere, join(r.path, '.claude', 'skills'));
    const caught = await catalog.setup(r.path, () => {}).catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(BmadSetupError);
    expect((caught as BmadSetupError).message).toBe(BMAD_SETUP_FAILURE_REASONS.failed);
    expect(readdirSync(elsewhere)).toEqual([]);

    const linkedClaude = repo();
    const other = tempFolder('ogden-agents-elsewhere-');
    link(other, join(linkedClaude.path, '.claude'));
    await expect(catalog.setup(linkedClaude.path, () => {})).rejects.toBeInstanceOf(BmadSetupError);
    expect(readdirSync(other)).toEqual([]);
    expect(runs()).toEqual([]);
    expect(source.downloads).toBe(0);
    expect(existsSync(join(r.path, '_bmad'))).toBe(false);
  });

  it('refuses a repo with _bmad (a folder or a link), writing nothing', async () => {
    const { catalog, runs } = adapter();
    const withFolder = repo({ '_bmad/config.toml': '[core]\n' });
    const before = withFolder.hash();
    await expect(catalog.setup(withFolder.path, () => {})).rejects.toBeInstanceOf(BmadAlreadySetUpError);
    expect(withFolder.hash()).toBe(before);

    const withLink = repo();
    link(tempFolder('ogden-agents-elsewhere-'), join(withLink.path, '_bmad'));
    const linkBefore = withLink.hash();
    await expect(catalog.setup(withLink.path, () => {})).rejects.toBeInstanceOf(BmadAlreadySetUpError);
    expect(withLink.hash()).toBe(linkBefore);
    expect(runs()).toEqual([]);
  });

  it('a setup.py that exits 1 fails with the plain reason, and no staging folder is left', async () => {
    const { catalog } = adapter({ FAKE_UV_SETUP_FAIL: 'something broke' });
    const r = repo();
    const caught = await catalog.setup(r.path, () => {}).catch((error: unknown) => error);
    expect((caught as BmadSetupError).reason).toBe('failed');
    expect((caught as Error).message).not.toContain(r.path);
    expect(stagingLeft(join(r.path, '.claude', 'skills'))).toEqual([]);
    expect(existsSync(join(r.path, '_bmad'))).toBe(false);
  });

  it('a permission error is not_writable, and no uv is uv_missing', async () => {
    const denied = adapter({ FAKE_UV_SETUP_FAIL: '[Errno 13] Permission denied' });
    expect(((await denied.catalog.setup(repo().path, () => {}).catch((error: unknown) => error)) as BmadSetupError).reason).toBe('not_writable');
    const missing = adapter({}, { uvMissing: true });
    const caught = (await missing.catalog.setup(repo().path, () => {}).catch((error: unknown) => error)) as BmadSetupError;
    expect(caught.reason).toBe('uv_missing');
    expect(caught.message).toBe(BMAD_SETUP_FAILURE_REASONS.uv_missing);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('a copy that fails removes its staging folder', async () => {
    const { catalog, skills, runs } = adapter();
    const unreadable = join(skills, 'bmad-spec', 'SKILL.md');
    chmodSync(unreadable, 0o000);
    cleanups.unshift(() => chmodSync(unreadable, 0o644));
    const r = repo();
    await expect(catalog.setup(r.path, () => {})).rejects.toBeInstanceOf(BmadSetupError);
    expect(stagingLeft(join(r.path, '.claude', 'skills'))).toEqual([]);
    expect(runs()).toEqual([]);
  });

  it('answers pending questions with their defaults through a file in the work folder, removed after', async () => {
    const questions = [{ module: 'method', key: 'team.size', prompt: 'How many?', default: 'small "team"', scope: 'team' }];
    const { catalog, runs, workDir } = adapter({ FAKE_UV_QUESTIONS: JSON.stringify(questions) });
    const r = repo();
    await catalog.setup(r.path, () => {});
    const setupRun = runs()[1]!;
    const index = setupRun.argv.indexOf('--module-answers');
    expect(index).toBeGreaterThan(0);
    const file = setupRun.argv[index + 1]!;
    expect(dirname(file)).toBe(workDir);
    expect(setupRun.answers).toBe('[modules."method"]\n"team"."size" = "small \\"team\\""\n');
    expect(existsSync(file)).toBe(false);
  });
});

describe('bmad-catalog setup status from files (story 4.3, S2)', () => {
  it('no _bmad is not_set_up; a linked _bmad is unusable; neither runs anything', async () => {
    const { catalog, runs } = adapter();
    expect(await catalog.setupStatus(repo().path)).toEqual({ state: 'not_set_up', outputFolder: null, bundledVersion: PINNED, installedVersion: null, problems: [] });
    const r = repo();
    link(tempFolder('ogden-agents-elsewhere-'), join(r.path, '_bmad'));
    expect(await catalog.setupStatus(r.path)).toMatchObject({ state: 'unusable', problems: [BMAD_SETUP_NOT_A_FOLDER_TEXT] });
    expect(runs()).toEqual([]);
  });

  it('maps current, update_available, setup_owed and an unknown version, with no run', async () => {
    const { catalog, runs } = adapter();
    expect(await catalog.setupStatus(repo(setUp()).path)).toEqual({ state: 'current', outputFolder: 'docs/out', bundledVersion: PINNED, installedVersion: PINNED, problems: [] });
    expect(await catalog.setupStatus(repo(setUp('6.12.0')).path)).toMatchObject({ state: 'update_available', installedVersion: '6.12.0' });
    expect((await catalog.setupStatus(repo(setUp('9.0.0')).path)).state).toBe('current');
    const { 'docs/out/.keep': _out, ...noOutput } = setUp();
    expect((await catalog.setupStatus(repo(noOutput).path)).state).toBe('setup_owed');
    const { '_bmad/scripts/setup.py': _scripts, ...noScripts } = setUp();
    expect((await catalog.setupStatus(repo({ ...noScripts, '_bmad/x': '' }).path)).state).toBe('setup_owed');
    const { '.claude/skills/bmod-method/bmod.toml': _record, ...noRecord } = setUp();
    expect(await catalog.setupStatus(repo(noRecord).path)).toMatchObject({ state: 'unusable', problems: [BMAD_SETUP_VERSION_UNKNOWN_TEXT] });
    // An output folder outside the repo is never reported.
    const outside = await catalog.setupStatus(repo({ ...setUp(), '_bmad/config.toml': '[core]\noutput_folder = "../elsewhere"\n' }).path);
    expect(outside).toMatchObject({ state: 'unusable', outputFolder: null });
    expect(runs()).toEqual([]);
  });

  it('never follows a linked installed record', async () => {
    const { catalog } = adapter();
    const elsewhere = tempFolder('ogden-agents-elsewhere-');
    write(elsewhere, { 'bmod.toml': '[bmod]\nversion = "1.0.0"\n' });
    const { '.claude/skills/bmod-method/bmod.toml': _record, ...rest } = setUp();
    const r = repo(rest);
    link(elsewhere, join(r.path, '.claude', 'skills', 'bmod-method'));
    expect((await catalog.setupStatus(r.path)).installedVersion).toBeNull();
  });
});

describe('bmad-catalog upgrade (entry 4.11)', () => {
  const plain = (kind: 'older' | 'bmod', files: Record<string, string> = {}) => {
    const created = createPlainRepo(kind, files);
    cleanups.push(() => created.remove());
    return created;
  };

  it('runs the verified setup.py in the work folder; copies only the skills the project has in neither folder, touching none it has', async () => {
    const { catalog, source, runs, script, skills, workDir } = adapter();
    const r = plain('bmod');
    const recordBefore = readFileSync(join(r.path, '.claude', 'skills', 'bmod-method', 'bmod.toml'), 'utf8');
    const progress: BmadSetupProgress[] = [];
    await catalog.setup(r.path, (step) => progress.push(step), { upgrade: true });
    expect(source.downloads).toBe(1);
    expect(progress.map((step) => step.step)).toEqual([...BMAD_SETUP_STEPS]);
    // `bmad-spec` is the project's, in `.agents/skills`: not copied into `.claude/skills`, and unchanged.
    expect(readdirSync(join(r.path, '.claude', 'skills')).sort()).toEqual(['bmad', 'bmod-method']);
    expect(readFileSync(join(r.path, '.agents', 'skills', 'bmad-spec', 'SKILL.md'), 'utf8')).toBe(PLAIN_BMOD_OWN_SKILL);
    expect(readFileSync(join(r.path, '.claude', 'skills', 'bmod-method', 'bmod.toml'), 'utf8')).toBe(recordBefore);
    const prefix = ['run', '--no-project', '--quiet', script, '--project-root', r.path, '--skill', join(skills, 'bmad')];
    expect(runs().map((run) => run.argv)).toEqual([[...prefix, '--list-config-questions'], prefix]);
    for (const run of runs()) expect(run.cwd).toBe(realpathSync(workDir));
  });

  it('the older layout (no records, no scripts, no config.toml) is upgraded too', async () => {
    const { catalog } = adapter();
    const r = plain('older');
    await catalog.setup(r.path, () => {}, { upgrade: true });
    expect(readdirSync(join(r.path, '.claude', 'skills')).sort()).toEqual(['bmad', 'bmad-help', 'bmad-spec', 'bmod-method']);
    expect(readFileSync(join(r.path, '_bmad', 'bmm', 'config.yaml'), 'utf8')).toContain('project_name: plain-older');
  });

  it('refuses a linked or file _bmad, a linked .claude/skills or config, and an output folder outside, unreadable or through a link: nothing written, downloaded or run', async () => {
    const { catalog, runs, source } = adapter();
    const cases: FakeBmadRepo[] = [];
    // `_bmad` a link, and a file.
    const linkedBmad = repo();
    link(tempFolder('ogden-agents-elsewhere-'), join(linkedBmad.path, '_bmad'));
    cases.push(linkedBmad, repo({ _bmad: 'not a folder\n' }));
    // `.claude/skills`, or `.claude`, a link.
    const linkedSkills = plain('older');
    rmSync(join(linkedSkills.path, '.claude', 'skills'), { recursive: true });
    link(tempFolder('ogden-agents-elsewhere-'), join(linkedSkills.path, '.claude', 'skills'));
    cases.push(linkedSkills);
    const linkedRoot = plain('older');
    rmSync(join(linkedRoot.path, '.claude'), { recursive: true });
    link(tempFolder('ogden-agents-elsewhere-'), join(linkedRoot.path, '.claude'));
    cases.push(linkedRoot);
    // The config a link; an output folder outside; one this reader can't see; one through a link.
    const linkedConfig = plain('older');
    const outsideConfig = join(tempFolder('ogden-agents-elsewhere-'), 'config.toml');
    writeFileSync(outsideConfig, '[core]\n');
    symlinkSync(outsideConfig, join(linkedConfig.path, '_bmad', 'config.toml'));
    cases.push(linkedConfig);
    cases.push(plain('bmod', { '_bmad/config.toml': '[core]\noutput_folder = "../outside"\n' }));
    cases.push(plain('bmod', { '_bmad/config.toml': 'core.output_folder = "../outside"\n' }));
    const throughLink = plain('bmod');
    rmSync(join(throughLink.path, 'docs'), { recursive: true });
    link(tempFolder('ogden-agents-elsewhere-'), join(throughLink.path, 'docs'));
    cases.push(throughLink);
    for (const r of cases) {
      const before = r.hash();
      const caught = await catalog.setup(r.path, () => {}, { upgrade: true }).catch((error: unknown) => error);
      expect(caught, r.path).toBeInstanceOf(BmadSetupError);
      expect((caught as BmadSetupError).reason).toBe('upgrade_refused');
      expect((caught as Error).message).toBe(BMAD_UPGRADE_REFUSED_TEXT);
      expect(r.hash()).toBe(before);
    }
    expect(runs()).toEqual([]);
    expect(source.downloads).toBe(0);
  });

  it('refuses a config.toml tomllib would read differently: a decoy in a multi-line string, an escaped quoted key; nothing written or run', async () => {
    const { catalog, runs, source } = adapter();
    const decoy = ["note = '''", '[core]', 'output_folder = "_bmad-output"', "'''", '[core]', 'output_folder = "../outside"', ''].join('\n');
    const escaped = ['[core]', '"output\\u005Ffolder" = "/abs/x"', ''].join('\n');
    for (const config of [decoy, escaped, 'core = { output_folder = "../x" }\n', '[core]\noutput_folder = "a/b. "\n', '[core]\noutput_folder = "c:x"\n', `[core]\npad = "${'x'.repeat(70 * 1024)}"\n`]) {
      const r = plain('bmod', { '_bmad/config.toml': config });
      const before = r.hash();
      const caught = await catalog.setup(r.path, () => {}, { upgrade: true }).catch((error: unknown) => error);
      expect((caught as BmadSetupError).reason, config.slice(0, 40)).toBe('upgrade_refused');
      expect(r.hash()).toBe(before);
    }
    expect(runs()).toEqual([]);
    expect(source.downloads).toBe(0);
  });

  it('refuses a _bmad holding a link (in custom/) or more entries than the cap, before anything is written', async () => {
    const { catalog, runs } = adapter();
    const linked = plain('bmod');
    link(tempFolder('ogden-agents-elsewhere-'), join(linked.path, '_bmad', 'custom', 'linked'));
    const many: Record<string, string> = {};
    for (let index = 0; index <= MAX_UPGRADE_BMAD_ENTRIES; index++) many[`_bmad/leftovers/f${index}`] = '';
    const crowded = plain('bmod', many);
    for (const r of [linked, crowded]) {
      const before = r.hash();
      const caught = await catalog.setup(r.path, () => {}, { upgrade: true }).catch((error: unknown) => error);
      expect((caught as BmadSetupError).reason).toBe('upgrade_refused');
      expect(r.hash()).toBe(before);
    }
    expect(runs()).toEqual([]);
  });

  it('Set up (no upgrade) still refuses a project with _bmad, writing nothing', async () => {
    const { catalog, runs } = adapter();
    const r = plain('bmod');
    const before = r.hash();
    await expect(catalog.setup(r.path, () => {})).rejects.toBeInstanceOf(BmadAlreadySetUpError);
    expect(r.hash()).toBe(before);
    expect(runs()).toEqual([]);
  });
});

describe('setup helpers (story 4.3)', () => {
  it('strictOutputFolder reads the pinned template and plain configs as tomllib does, and refuses the rest (entry 4.11)', () => {
    const template = readFileSync(join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'bmad-upstream', 'skills', 'bmad', 'assets', 'config.template.toml'), 'utf8');
    expect(strictOutputFolder(template)).toEqual({ ok: true, folder: '{project-root}/_bmad-output' });
    expect(strictOutputFolder('# c\n[core]\nname = "x" # y\nlist = ["a", "b"]\n[modules."method"]\n"team".size = "small"\n')).toEqual({ ok: true });
    expect(strictOutputFolder("[core]\noutput_folder = 'docs/out'\n")).toEqual({ ok: true, folder: 'docs/out' });
    expect(strictOutputFolder('core.output_folder = "x"\n')).toEqual({ ok: true, folder: 'x' });
    for (const bad of ['[core]\noutput_folder = "a"\noutput_folder = "b"\n', '[core.output_folder]\n', '[core]\nx = [\n"a"]\n', '[[core]]\n', 'a b = 1\n', '[core]\noutput_folder = 1\n']) {
      expect(strictOutputFolder(bad), bad).toEqual({ ok: false });
    }
  });

  it('tomlString reads one-line strings in a section only', () => {
    const text = '[bmod]\ncode = "method"\nversion = "6.13.0-next" # pinned\n[other]\nversion = "1"\n';
    expect(tomlString(text, 'bmod', 'version')).toBe('6.13.0-next');
    expect(tomlString(text, 'other', 'version')).toBe('1');
    expect(tomlString(text, 'core', 'version')).toBeUndefined();
    expect(tomlString("[core]\noutput_folder = 'x/y'\n", 'core', 'output_folder')).toBe('x/y');
  });
});
