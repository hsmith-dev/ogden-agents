/**
 * BMad Method's setup in a project (entry 4.3, AD-13, AD-21; user decisions
 * S1 and S2 of 2026-10-02): the `bmad-catalog` adapter's `setupStatus` and
 * `setup`.
 *
 * - `setupStatus` reads files only, in TypeScript: it runs no process and
 *   reaches no network. No `_bmad` entry answers `not_set_up`; a link or a
 *   file there `unusable`; a `_bmad/` without its `scripts/`, its
 *   `config.toml` or the output folder that names `setup_owed`; else the
 *   installed version (the repo's `.claude/skills/bmod-method/bmod.toml`,
 *   each step `lstat`ed, no link followed) against the pinned one
 *   (`BmadSourcePort.status().version`): `update_available` or `current`.
 * - `setup` writes only into a project with no `_bmad` entry at all
 *   (`BmadAlreadySetUpError` otherwise, nothing written), and refuses a
 *   linked `.claude` or `.claude/skills` before creating anything. It is the
 *   user's explicit action, so it calls the server's one
 *   `BmadSourcePort.download()` (a ready copy is only re-checked), then
 *   copies each skill of the verified copy's `skills/` missing from
 *   `<repo>/.claude/skills/` (Claude Code only) file by file into a staging
 *   folder beside its target, renamed into place; an existing skill folder is
 *   never touched. Then it runs the verified `bmad/scripts/setup.py`
 *   (`--list-config-questions`, then setup, answering any question with its
 *   default through a file in the work folder, never the repo) with
 *   `--skill` the verified copy's `bmad` folder and no `--root`, so the
 *   payload, the config template and the module records never come from the
 *   repo. The last step reads the status from the files, as above.
 *
 * Every run is the verified script by its absolute path, in the work folder
 * (never the repo: uv would run a `.venv` the project ships), with the repo
 * named only by `--project-root`. `setup.py` imports only Python's standard
 * library and reads the project as data (the trust proof in the 4.3 plan),
 * so no project code runs. Failures are `BmadSetupError` (or core's
 * `BmadDownloadError`) with a plain reason; nothing holds a path or output.
 */
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { BmadAlreadySetUpError, BmadDownloadError, BmadSetupError, type BmadSourcePort } from '@ogden-agents/core';
import {
  BMAD_SETUP_NOT_A_FOLDER_TEXT,
  BMAD_SETUP_OUTPUT_FOLDER_PROBLEM,
  BMAD_SETUP_STEP_LABELS,
  BMAD_SETUP_UNUSABLE_TEXT,
  BMAD_SETUP_VERSION_UNKNOWN_TEXT,
  compareVersions,
  RepoRelativePath,
  type BmadSetupFailureReason,
  type BmadSetupProgress,
  type BmadSetupStatus,
  type BmadSetupStep,
} from '@ogden-agents/shared';
import { ScriptRunError, type UvScriptRunner } from '../toolchain-uv/script-runner.js';

export interface BmadSetupOptions {
  /** The one runner of BMad Method's scripts. */
  runner: Pick<UvScriptRunner, 'run'>;
  /** The working folder of every run: an existing folder of Ogden Agents' own, never a project's (`<dataDir>/tools/uv-work`). */
  workDir: string;
  /** The server's one pinned BMad Method source (story 4.14): downloaded on Set up, the only place scripts and skills come from. */
  source: Pick<BmadSourcePort, 'status' | 'download' | 'file'>;
}

/** The folder BMad Method's setup creates at a repo's root. */
const BMAD_DIR = '_bmad';
/** Where Claude Code finds a project's skills, below the repo. */
const SKILLS_PATH = ['.claude', 'skills'] as const;
/** The verified setup script, relative to the pinned copy's `skills/`. */
export const SETUP_SCRIPT = 'bmad/scripts/setup.py';
/** The module record whose `[bmod] version` is BMad Method's version. */
const METHOD_RECORD = ['bmod-method', 'bmod.toml'] as const;
/** What a copy never takes from the verified copy. */
const SKIPPED_NAMES = new Set(['__pycache__', '.DS_Store']);

/** The file-system error codes that mean the project's folder can't be written. */
const NOT_WRITABLE_CODES = new Set(['EACCES', 'EPERM', 'EROFS', 'ENOSPC', 'EDQUOT']);

/** The entry at `path` (`lstat`, never followed), or `undefined` when missing. Other errors are thrown. */
async function entryAt(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** The plain-reason error for a failed file operation or run. */
function setupErrorOf(error: unknown): Error {
  if (error instanceof BmadSetupError || error instanceof BmadAlreadySetUpError || error instanceof BmadDownloadError) return error;
  if (error instanceof ScriptRunError) {
    const reason: BmadSetupFailureReason =
      error.code === 'uv_missing'
        ? 'uv_missing'
        : error.code === 'timeout'
          ? 'timeout'
          : error.code === 'failed' && /permission denied|read-only file system|not writable|errno 13|errno 30/i.test(error.scriptError ?? '')
            ? 'not_writable'
            : 'failed';
    return new BmadSetupError(reason, { cause: error.code });
  }
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return new BmadSetupError(code !== undefined && NOT_WRITABLE_CODES.has(code) ? 'not_writable' : 'failed', { cause: code ?? 'unknown' });
}

/** The value of `key` in `[section]` of a TOML text, when it is a plain one-line string; `undefined` otherwise. */
export function tomlString(text: string, section: string, key: string): string | undefined {
  let current = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[\s*([A-Za-z0-9_.-]+)\s*\]\s*(?:#.*)?$/.exec(line);
    if (header !== null) {
      current = header[1]!;
      continue;
    }
    if (current !== section) continue;
    const match = /^([A-Za-z0-9_-]+|"[A-Za-z0-9_-]+")\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?$/.exec(line);
    if (match === null || match[1]!.replace(/"/g, '') !== key) continue;
    const value = match[2]!;
    if (value.startsWith("'")) return value.slice(1, -1);
    try {
      return JSON.parse(value) as string;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Copies the folder `from` (the verified copy) into `to`, file by file; links and skipped names are left out. */
async function copyTree(from: string, to: string): Promise<void> {
  await mkdir(to);
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (SKIPPED_NAMES.has(entry.name)) continue;
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory()) await copyTree(source, target);
    // Never overwrite: the staging folder is new, so anything there is a race and refuses.
    else if (entry.isFile()) await copyFile(source, target, constants.COPYFILE_EXCL);
  }
}

/** A TOML basic string (JSON's escapes are TOML's for the characters it emits). */
const tomlQuote = (value: string): string => JSON.stringify(value);

/** The text of the plain file `parts` below `root`, reached through real folders only (each step `lstat`ed); `undefined` otherwise. */
async function plainFileText(root: string, parts: readonly string[]): Promise<string | undefined> {
  let path = root;
  for (const [index, part] of parts.entries()) {
    path = join(path, part);
    const entry = await entryAt(path).catch(() => undefined);
    const last = index === parts.length - 1;
    if (entry === undefined || entry.isSymbolicLink() || (last ? !entry.isFile() : !entry.isDirectory())) return undefined;
  }
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

/** The output folder a `_bmad/config.toml` names, relative to the repo; `null` with a problem when it can't be used. */
function outputFolderOf(configText: string): { folder: RepoRelativePath | null; problem?: string } {
  let folder = tomlString(configText, 'core', 'output_folder') ?? '_bmad-output';
  if (folder.startsWith('{project-root}/')) folder = folder.slice('{project-root}/'.length);
  folder = folder.replace(/\/+$/, '');
  if (folder === '') folder = '_bmad-output';
  const parsed = RepoRelativePath.safeParse(folder);
  return parsed.success ? { folder: parsed.data } : { folder: null, problem: BMAD_SETUP_OUTPUT_FOLDER_PROBLEM };
}

export interface BmadSetup {
  setupStatus(repoPath: string): Promise<BmadSetupStatus>;
  setup(repoPath: string, onProgress: (progress: BmadSetupProgress) => void): Promise<BmadSetupStatus>;
}

export function createBmadSetup({ runner, workDir, source }: BmadSetupOptions): BmadSetup {
  /** The status from the files alone (S2): no process, no network. */
  const setupStatus = async (repoPath: string): Promise<BmadSetupStatus> => {
    const pinned = source.status().version;
    const base = { outputFolder: null, bundledVersion: pinned, installedVersion: null };
    let bmad;
    try {
      bmad = await entryAt(join(repoPath, BMAD_DIR));
    } catch {
      return { ...base, state: 'unusable', problems: [BMAD_SETUP_UNUSABLE_TEXT] };
    }
    if (bmad === undefined) return { ...base, state: 'not_set_up', problems: [] };
    // A link or a file in its place: never followed.
    if (bmad.isSymbolicLink() || !bmad.isDirectory()) return { ...base, state: 'unusable', problems: [BMAD_SETUP_NOT_A_FOLDER_TEXT] };

    const record = await plainFileText(repoPath, [...SKILLS_PATH, ...METHOD_RECORD]);
    const version = record === undefined ? undefined : tomlString(record, 'bmod', 'version')?.trim();
    const installedVersion = version === undefined || version === '' ? null : version;

    const scripts = await entryAt(join(repoPath, BMAD_DIR, 'scripts')).catch(() => undefined);
    const config = await plainFileText(repoPath, [BMAD_DIR, 'config.toml']);
    const output = config === undefined ? { folder: null } : outputFolderOf(config);
    const outputThere = output.folder !== null && (await entryAt(join(repoPath, ...output.folder.split('/'))).catch(() => undefined)) !== undefined;
    const scriptsThere = scripts !== undefined && !scripts.isSymbolicLink() && scripts.isDirectory();
    const at = { outputFolder: output.folder, bundledVersion: pinned, installedVersion };
    if (output.problem !== undefined) return { ...at, state: 'unusable', problems: [output.problem] };
    if (!scriptsThere || config === undefined || !outputThere) return { ...at, state: 'setup_owed', problems: [] };
    if (installedVersion === null) return { ...at, state: 'unusable', problems: [BMAD_SETUP_VERSION_UNKNOWN_TEXT] };
    return { ...at, state: (compareVersions(installedVersion, pinned) ?? 0) < 0 ? 'update_available' : 'current', problems: [] };
  };

  /** Refuses a link or a file at `.claude` or `.claude/skills`, before anything is created (review Q6). */
  const checkSkillsFolders = async (repoPath: string): Promise<void> => {
    let folder = repoPath;
    for (const part of SKILLS_PATH) {
      folder = join(folder, part);
      const entry = await entryAt(folder);
      if (entry === undefined) return;
      if (entry.isSymbolicLink() || !entry.isDirectory()) throw new BmadSetupError('failed', { cause: 'not_a_real_folder' });
    }
  };

  /** Copies each verified skill missing from the repo's skills folder: staging beside the target, then a rename. */
  const copySkills = async (repoPath: string, skillsRoot: string): Promise<void> => {
    await checkSkillsFolders(repoPath);
    let folder = repoPath;
    for (const part of SKILLS_PATH) {
      folder = join(folder, part);
      if ((await entryAt(folder)) === undefined) await mkdir(folder);
    }
    await checkSkillsFolders(repoPath);
    for (const skill of await readdir(skillsRoot, { withFileTypes: true })) {
      if (!skill.isDirectory() || SKIPPED_NAMES.has(skill.name) || skill.name.startsWith('.')) continue;
      const target = join(folder, skill.name);
      // An existing skill (or anything at its name) is the project's: left untouched.
      if ((await entryAt(target)) !== undefined) continue;
      const staging = join(folder, `.${skill.name}.ogden-setup-${randomBytes(6).toString('hex')}`);
      try {
        await copyTree(join(skillsRoot, skill.name), staging);
        // Checked again just before: a folder that appeared meanwhile is never replaced.
        if ((await entryAt(target)) !== undefined) {
          await rm(staging, { recursive: true, force: true });
          continue;
        }
        await rename(staging, target);
      } catch (error) {
        await rm(staging, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
    }
  };

  /** Writes the default answer of each question into a file in the work folder; `undefined` when there are none. */
  const writeDefaults = async (questions: unknown): Promise<string | undefined> => {
    if (!Array.isArray(questions) || questions.length === 0) return undefined;
    const byModule = new Map<string, Array<[string, string]>>();
    for (const question of questions as Array<{ module?: unknown; key?: unknown; default?: unknown }>) {
      if (typeof question?.module !== 'string' || typeof question.key !== 'string' || typeof question.default !== 'string') {
        throw new BmadSetupError('failed', { cause: 'bad_question' });
      }
      const list = byModule.get(question.module) ?? [];
      list.push([question.key, question.default]);
      byModule.set(question.module, list);
    }
    const lines: string[] = [];
    for (const [module, answers] of byModule) {
      lines.push(`[modules.${tomlQuote(module)}]`);
      for (const [key, value] of answers) lines.push(`${key.split('.').map(tomlQuote).join('.')} = ${tomlQuote(value)}`);
      lines.push('');
    }
    const file = join(workDir, `bmad-answers-${randomBytes(8).toString('hex')}.toml`);
    await writeFile(file, lines.join('\n'), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    return file;
  };

  return {
    setupStatus,

    async setup(repoPath, onProgress) {
      const step = (code: BmadSetupStep) => {
        try {
          onProgress({ step: code, label: BMAD_SETUP_STEP_LABELS[code] });
        } catch {
          // The caller's listener never changes the setup.
        }
      };
      try {
        step('checking');
        const root = await lstat(repoPath);
        if (!root.isDirectory()) throw new BmadSetupError('failed', { cause: 'repo_not_a_folder' });
        // Never written into: a project with any `_bmad` entry (a folder, a link, a file) gets status only.
        if ((await entryAt(join(repoPath, BMAD_DIR))) !== undefined) throw new BmadAlreadySetUpError();
        await checkSkillsFolders(repoPath);
        // The user's Set up: the pinned copy is downloaded and verified now (S1), or only re-checked when ready.
        await source.download();
        const script = source.file(SETUP_SCRIPT);
        if (script === undefined) throw new BmadSetupError('failed', { cause: 'no_setup_script' });
        const bmadSkill = dirname(dirname(script));
        const skillsRoot = dirname(bmadSkill);

        step('copying_skills');
        await copySkills(repoPath, skillsRoot);

        step('writing_config');
        // `--skill` is the verified copy's `bmad`, with no `--root`: nothing the repo holds is the payload or a module record.
        const run = (args: readonly string[]) => runner.run({ script, args: ['--project-root', repoPath, '--skill', bmadSkill, ...args], cwd: workDir });
        const answers = await writeDefaults(await run(['--list-config-questions']));
        try {
          await run(answers === undefined ? [] : ['--module-answers', answers]);
        } finally {
          if (answers !== undefined) await rm(answers, { force: true }).catch(() => undefined);
        }

        step('verifying');
        return await setupStatus(repoPath);
      } catch (error) {
        throw setupErrorOf(error);
      }
    },
  };
}
