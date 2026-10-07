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
 *   linked `.claude` or `.claude/skills` (or a link or a file at any segment
 *   of another agent's skills folder it was given, epic 6 entry 8) before
 *   creating anything. It is the
 *   user's explicit action, so it calls the server's one
 *   `BmadSourcePort.download()` (a ready copy is only re-checked), then
 *   copies each skill of the verified copy's `skills/` missing from
 *   `<repo>/.claude/skills/`, and from each other skills folder of an agent
 *   the project uses (`skillFolders`, epic 6 entry 8: `.agents/skills` for
 *   Antigravity), file by file into a staging folder beside its target,
 *   renamed into place; an existing skill folder is never touched. The same
 *   step also writes Ogden Agents' own bundled sample skills (story 18,
 *   CAP-18; `sample-skills.ts`) into the same targets, through the same
 *   never-overwrite rule — the only difference is their `SKILL.md` text is
 *   an inlined constant, not a file copied from a verified download, since
 *   the packaged tarball ships no loose `SKILL.md` anywhere (story 4.14's
 *   packaging guard). Then it runs the verified `bmad/scripts/setup.py`
 *   (`--list-config-questions`, then setup, answering any question with its
 *   default through a file in the work folder, never the repo) with
 *   `--skill` the verified copy's `bmad` folder and no `--root`, so the
 *   payload, the config template and the module records never come from the
 *   repo. The last step reads the status from the files, as above.
 *
 * - `setup` with `upgrade` (entry 4.11, Upgrade this project) writes only
 *   into a project whose `_bmad` is a real folder, and refuses
 *   (`upgrade_refused`, nothing written, nothing downloaded) when `.claude`
 *   or `.claude/skills` is a link or a file, or when the existing
 *   `_bmad/config.toml` is not a plain file or names an output folder that
 *   isn't repo-relative, can't be read here, or is reached through a link or
 *   a file. Then the same steps: each pinned skill the project lacks in
 *   either skills folder (`.agents/skills`, `.claude/skills`) is copied into
 *   `.claude/skills`, and each one another agent's folder lacks into that
 *   folder; an existing one is never touched; and the same
 *   verified `setup.py` runs, whose own repair creates what is missing,
 *   repairs stale scripts, and keeps the config's values, `custom/` and
 *   leftovers.
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
import { BmadAlreadySetUpError, BmadDownloadError, BmadSetupError, type BmadSetupRunOptions, type BmadSourcePort } from '@ogden-agents/core';
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
import { SAMPLE_SKILLS, type BundledSampleSkill } from './sample-skills.js';
import { MAX_SKILL_FILE_BYTES, readHead, SKILL_FOLDERS } from './skills.js';

export interface BmadSetupOptions {
  /** The one runner of BMad Method's scripts. */
  runner: Pick<UvScriptRunner, 'run'>;
  /** The working folder of every run: an existing folder of Ogden Agents' own, never a project's (`<dataDir>/tools/uv-work`). */
  workDir: string;
  /** The server's one pinned BMad Method source (story 4.14): downloaded on Set up, the only place scripts and skills come from. */
  source: Pick<BmadSourcePort, 'status' | 'download' | 'file'>;
  /**
   * Ogden Agents' own bundled sample skills (story 18, CAP-18), written
   * alongside the verified pinned copy's. The shipped set by default;
   * overridable so a test can isolate itself from the shipped content, the
   * way `catalog.ts`'s `labels` and `verifier` already are.
   */
  sampleSkills?: readonly BundledSampleSkill[];
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

/**
 * Writes `skill`'s `SKILL.md` at `folder/<name>/SKILL.md`, staged beside it
 * then renamed in, the same way `copyTree`'s callers stage a copied skill;
 * does nothing when something is already at that name (a project's own
 * skill, or a sample a previous run already wrote — never touched, AC3).
 */
async function writeSampleSkillInto(folder: string, skill: BundledSampleSkill): Promise<void> {
  const target = join(folder, skill.name);
  if ((await entryAt(target)) !== undefined) return;
  const staging = join(folder, `.${skill.name}.ogden-setup-${randomBytes(6).toString('hex')}`);
  try {
    await mkdir(staging);
    await writeFile(join(staging, 'SKILL.md'), skill.content, { encoding: 'utf8', mode: 0o644, flag: 'wx' });
    // Checked again just before: a name that appeared meanwhile is never replaced.
    if ((await entryAt(target)) !== undefined) {
      await rm(staging, { recursive: true, force: true });
      return;
    }
    await rename(staging, target);
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error;
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

/** The default output folder, as BMad Method's config template names it. */
const DEFAULT_OUTPUT_FOLDER = '_bmad-output';

export interface BmadSetup {
  setupStatus(repoPath: string): Promise<BmadSetupStatus>;
  setup(repoPath: string, onProgress: (progress: BmadSetupProgress) => void, options?: BmadSetupRunOptions): Promise<BmadSetupStatus>;
}

/** Upgrade this project refused before anything was written (entry 4.11); `cause` is for the log only. */
const refused = (cause: string) => new BmadSetupError('upgrade_refused', { cause });

/** The most of `_bmad/config.toml` an upgrade reads; a larger one is refused. */
const MAX_UPGRADE_CONFIG_BYTES = MAX_SKILL_FILE_BYTES;
/** At most this many entries in an existing `_bmad/` (upstream `setup.py` copies it whole before replacing it). */
export const MAX_UPGRADE_BMAD_ENTRIES = 5000;
/** At most this many bytes of files in an existing `_bmad/`. */
export const MAX_UPGRADE_BMAD_BYTES = 50 * 1024 * 1024;

/** One key or header segment this reader accepts: bare, or quoted without escapes (so its name is exact). */
const TOML_SEGMENT = /^(?:[A-Za-z0-9_-]+|"[A-Za-z0-9_-]+"|'[A-Za-z0-9_-]+')$/;

/** The path a dotted key or header names, or `undefined` outside the accepted subset (no spaces around dots). */
function tomlPath(raw: string): string[] | undefined {
  const parts = raw.split('.');
  if (!parts.every((part) => TOML_SEGMENT.test(part))) return undefined;
  return parts.map((part) => (part.startsWith('"') || part.startsWith("'") ? part.slice(1, -1) : part));
}

/**
 * The `[core] output_folder` of a `_bmad/config.toml` exactly as Python's
 * `tomllib` reads it, from a strict subset of TOML where a line-based reading
 * can't disagree with it (entry 4.11 review): every line blank, a comment, a
 * `[table]` header, or `key = value` on one line, with keys of plain
 * segments (bare, or quoted without escapes), no multi-line string, no
 * backslash, no inline table, and an array closed on its line. `ok: false`
 * for anything else (the upgrade is refused); `folder` is absent when the
 * file doesn't set it.
 */
export function strictOutputFolder(text: string): { ok: true; folder?: string } | { ok: false } {
  const target = 'core.output_folder';
  let section: string[] = [];
  let folder: string | undefined;
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line.includes('\\') || line.includes("'''") || line.includes('"""')) return { ok: false };
    const header = /^\[([^[\]]+)\]\s*(?:#.*)?$/.exec(line);
    if (header !== null) {
      const path = tomlPath(header[1]!);
      if (path === undefined || `${path.join('.')}.`.startsWith(`${target}.`)) return { ok: false };
      section = path;
      continue;
    }
    const pair = /^([^=\s]+)\s*=\s*(.*)$/.exec(line);
    const key = pair === null ? undefined : tomlPath(pair[1]!);
    if (pair === null || key === undefined) return { ok: false };
    const value = pair[2]!;
    if (value.startsWith('{') || (value.startsWith('[') && !/\]\s*(?:#.*)?$/.test(value))) return { ok: false };
    const full = [...section, ...key].join('.');
    if (full.startsWith(`${target}.`)) return { ok: false };
    if (full !== target) continue;
    const string = /^"([^"]*)"\s*(?:#.*)?$/.exec(value) ?? /^'([^']*)'\s*(?:#.*)?$/.exec(value);
    if (string === null || folder !== undefined) return { ok: false };
    folder = string[1]!;
  }
  return folder === undefined ? { ok: true } : { ok: true, folder };
}

/** A segment Win32 would normalise before `mkdir` (a trailing dot or space) or read as a stream (a colon). */
const WINDOWS_UNSAFE_SEGMENT = /[.\s]$|:/;

/**
 * Refuses an existing `_bmad/` that upstream `setup.py` shouldn't copy whole
 * (it copies it into a staging folder before replacing it): any link,
 * junction or entry that is neither a regular file nor a folder, more than
 * {@link MAX_UPGRADE_BMAD_ENTRIES} entries, or more than
 * {@link MAX_UPGRADE_BMAD_BYTES} of files. Every entry is `lstat`ed; nothing is followed.
 */
async function checkBmadTree(bmadPath: string): Promise<void> {
  let entries = 0;
  let bytes = 0;
  const pending = [bmadPath];
  while (pending.length > 0) {
    const folder = pending.pop()!;
    for (const name of await readdir(folder)) {
      const path = join(folder, name);
      const entry = await lstat(path);
      entries++;
      if (entries > MAX_UPGRADE_BMAD_ENTRIES) throw refused('bmad_too_many_entries');
      if (entry.isSymbolicLink()) throw refused('bmad_has_link');
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) {
        bytes += entry.size;
        if (bytes > MAX_UPGRADE_BMAD_BYTES) throw refused('bmad_too_large');
      } else throw refused('bmad_has_special_entry');
    }
  }
}

/**
 * Whether Upgrade may write into the repo (entry 4.11): `_bmad` a real
 * folder holding only real folders and regular files, within the caps; its
 * `config.toml` (when there) a plain file of at most
 * {@link MAX_UPGRADE_CONFIG_BYTES}, in the strict subset
 * {@link strictOutputFolder} reads exactly as `setup.py` does, whose output
 * folder is repo-relative with no segment Win32 would rewrite; and every
 * existing segment of that folder a real folder (`setup.py` creates the rest
 * inside the repo). Throws `upgrade_refused` otherwise.
 */
async function checkUpgradeTarget(repoPath: string): Promise<void> {
  const bmadPath = join(repoPath, BMAD_DIR);
  const bmad = await entryAt(bmadPath);
  if (bmad === undefined) throw new BmadSetupError('failed', { cause: 'not_set_up' });
  if (bmad.isSymbolicLink() || !bmad.isDirectory()) throw refused('bmad_not_a_folder');
  await checkBmadTree(bmadPath);
  const configPath = join(bmadPath, 'config.toml');
  const config = await entryAt(configPath);
  let folder: string = DEFAULT_OUTPUT_FOLDER;
  if (config !== undefined) {
    if (config.isSymbolicLink() || !config.isFile() || config.size >= MAX_UPGRADE_CONFIG_BYTES) throw refused('config_not_a_small_file');
    // Bounded, and never through a link swapped in after the lstat.
    const text = await readHead(configPath);
    if (text === undefined || Buffer.byteLength(text) >= MAX_UPGRADE_CONFIG_BYTES) throw refused('config_unreadable');
    const read = strictOutputFolder(text);
    if (!read.ok) throw refused('config_outside_subset');
    if (read.folder !== undefined) {
      const output = outputFolderOf(`[core]\noutput_folder = ${JSON.stringify(read.folder)}\n`);
      if (output.folder === null) throw refused('output_folder_outside');
      folder = output.folder;
    }
  }
  const segments = folder.split('/').filter((part) => part !== '');
  if (segments.some((part) => part === '.' || WINDOWS_UNSAFE_SEGMENT.test(part))) throw refused('output_folder_segment');
  let path = repoPath;
  for (const part of segments) {
    path = join(path, part);
    const entry = await entryAt(path);
    if (entry === undefined) return;
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw refused('output_folder_not_a_folder');
  }
}

/**
 * The skills folders setup copies into: `.claude/skills` first, then each
 * other agent's (epic 6 entry 8), once each. A folder that isn't a plain
 * repo-relative path (an empty, `.` or `..` segment, a drive or a backslash)
 * fails the setup before anything is written: core passes only descriptors'
 * checked folders, so it is a wiring bug.
 */
export function skillTargets(skillFolders: readonly string[] = []): (readonly string[])[] {
  const targets: (readonly string[])[] = [SKILLS_PATH];
  for (const folder of skillFolders) {
    const segments = folder.split('/');
    if (!RepoRelativePath.safeParse(folder).success || folder.includes('\\') || segments.some((part) => part === '' || part === '.' || part === '..' || WINDOWS_UNSAFE_SEGMENT.test(part))) {
      throw new BmadSetupError('failed', { cause: 'bad_skills_folder' });
    }
    if (!targets.some((target) => target.join('/') === segments.join('/'))) targets.push(segments);
  }
  return targets;
}

export function createBmadSetup({ runner, workDir, source, sampleSkills = SAMPLE_SKILLS }: BmadSetupOptions): BmadSetup {
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

  /**
   * Refuses a link or a file at any segment of each target skills folder
   * (`.claude`, `.claude/skills`, and each other agent's, epic 6 entry 8),
   * before anything is created (review Q6); an upgrade says so (entry 4.11).
   */
  const checkSkillsFolders = async (repoPath: string, targets: readonly (readonly string[])[], upgrade = false): Promise<void> => {
    for (const target of targets) {
      let folder = repoPath;
      for (const part of target) {
        folder = join(folder, part);
        const entry = await entryAt(folder);
        if (entry === undefined) break;
        if (entry.isSymbolicLink() || !entry.isDirectory()) throw upgrade ? refused('skills_not_a_folder') : new BmadSetupError('failed', { cause: 'not_a_real_folder' });
      }
    }
  };

  /** Whether the repo has a skill named `name` in a skills folder other than `.claude/skills` (an upgrade leaves it be, entry 4.11). */
  const elsewhere = async (repoPath: string, name: string): Promise<boolean> => {
    for (const folder of SKILL_FOLDERS) {
      if (folder.join('/') === SKILLS_PATH.join('/')) continue;
      // Only an `lstat`: a folder there that can't be read counts as absent, and nothing is written there.
      if ((await entryAt(join(repoPath, ...folder, name)).catch(() => undefined)) !== undefined) return true;
    }
    return false;
  };

  /**
   * Copies each verified skill missing from each target skills folder: staging
   * beside the target, then a rename. `.claude/skills` comes first; with
   * `upgrade`, a skill the project has in another skills folder is not added
   * there (entry 4.11). Another agent's folder (epic 6 entry 8) gets every
   * skill it lacks.
   */
  const copySkills = async (repoPath: string, skillsRoot: string, targets: readonly (readonly string[])[], upgrade: boolean): Promise<void> => {
    await checkSkillsFolders(repoPath, targets, upgrade);
    for (const target of targets) {
      let folder = repoPath;
      for (const part of target) {
        folder = join(folder, part);
        if ((await entryAt(folder)) === undefined) await mkdir(folder);
      }
      // Checked again once created: a link swapped in meanwhile is never written through.
      await checkSkillsFolders(repoPath, [target], upgrade);
      await copySkillsInto(repoPath, skillsRoot, folder, upgrade && target === SKILLS_PATH);
    }
  };

  /** Copies each verified skill missing from `folder`; with `leaveElsewhere`, also one the project has in another skills folder (entry 4.11). */
  const copySkillsInto = async (repoPath: string, skillsRoot: string, folder: string, leaveElsewhere: boolean): Promise<void> => {
    for (const skill of await readdir(skillsRoot, { withFileTypes: true })) {
      if (!skill.isDirectory() || SKIPPED_NAMES.has(skill.name) || skill.name.startsWith('.')) continue;
      const target = join(folder, skill.name);
      // An existing skill (or anything at its name) is the project's: left untouched.
      if ((await entryAt(target)) !== undefined) continue;
      if (leaveElsewhere && (await elsewhere(repoPath, skill.name))) continue;
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

  /**
   * Writes each bundled sample skill (story 18, CAP-18) into every target
   * skills folder, the same shape as {@link copySkills}/{@link
   * copySkillsInto}: `.claude/skills` first, then each other agent's; with
   * `upgrade`, a sample the project has in another skills folder is not
   * added to `.claude/skills` either (entry 4.11's rule, applied the same
   * way). An existing name — the project's own skill, or a sample a
   * previous run already wrote — is never touched (AC3).
   */
  const writeSampleSkills = async (repoPath: string, targets: readonly (readonly string[])[], upgrade: boolean): Promise<void> => {
    for (const target of targets) {
      const folder = join(repoPath, ...target);
      const leaveElsewhere = upgrade && target === SKILLS_PATH;
      for (const skill of sampleSkills) {
        const result = join(folder, skill.name);
        if ((await entryAt(result)) !== undefined) continue;
        if (leaveElsewhere && (await elsewhere(repoPath, skill.name))) continue;
        await writeSampleSkillInto(folder, skill);
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

    async setup(repoPath, onProgress, options = {}) {
      const upgrade = options.upgrade === true;
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
        if (upgrade) {
          // Upgrade this project (entry 4.11): only a real `_bmad/` whose output folder stays inside the repo through real folders.
          await checkUpgradeTarget(repoPath);
        } else if ((await entryAt(join(repoPath, BMAD_DIR))) !== undefined) {
          // Never written into: a project with any `_bmad` entry (a folder, a link, a file) gets status only.
          throw new BmadAlreadySetUpError();
        }
        const targets = skillTargets(options.skillFolders);
        await checkSkillsFolders(repoPath, targets, upgrade);
        // The user's Set up: the pinned copy is downloaded and verified now (S1), or only re-checked when ready.
        await source.download();
        const script = source.file(SETUP_SCRIPT);
        if (script === undefined) throw new BmadSetupError('failed', { cause: 'no_setup_script' });
        const bmadSkill = dirname(dirname(script));
        const skillsRoot = dirname(bmadSkill);

        step('copying_skills');
        await copySkills(repoPath, skillsRoot, targets, upgrade);
        // Ogden Agents' own bundled sample skills (story 18): same targets, same never-overwrite rule.
        await writeSampleSkills(repoPath, targets, upgrade);

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
