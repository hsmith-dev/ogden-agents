/**
 * `vcs-git`'s working-tree half (AD-37; story 8.4): core's
 * `VcsWorkingTreePort` on the user's own `git`, run as `index.ts` runs it
 * (`runner.ts`: an argument array, the allowlisted environment, no hook, no
 * fsmonitor), with `--no-ext-diff --no-textconv` on every diff and literal
 * pathspecs. Every call's cwd is the folder core resolved; a chat's
 * worktree is run in only with the folders Ogden pins, after 5.3's check
 * that its own files still name the repo and its branch. Paths are
 * relative to that folder (`--relative`), `/`-separated; renames show as a
 * deletion and an addition (`--no-renames`).
 *
 * Snapshots (This turn): the folder's index is copied to a temporary file
 * in `<snapshots>/tmp`, and with `GIT_INDEX_FILE` on it,
 * `GIT_OBJECT_DIRECTORY` on the repo's own store in Ogden's data folder
 * (`<snapshots>/<sha256(real common dir)[:16]>/objects`) and the repo's
 * objects as an alternate, `add -A -- .` and `write-tree` give the tree;
 * the temporary file is removed. The repo's index, refs and objects are
 * never written. The snapshots folder and each store are real folders,
 * never links (a link is refused and nothing is written). Unstaged uses
 * the same temporary index with untracked files added `-N`, so a new file
 * shows as Added and an ignored one not at all.
 *
 * Branch compares `merge-base(<base>, HEAD)` with `HEAD` (commits only),
 * the base being `origin/HEAD`'s branch, else `main`, else `master`.
 *
 * A file's `tooLarge` in a listing is from its blobs' sizes (either side
 * over `MAX_DIFF_FILE_BYTES`); its diff says so too once the diff itself
 * is over it. No hunk action here (8.5).
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { isRealFolder, VcsError, type VcsChangedFiles, type VcsChangesTarget, type VcsFolder, type VcsWorkingTreePort } from '@ogden-agents/core';
import { MAX_CHANGED_FILES, MAX_DIFF_FILE_BYTES, type ChangedFile, type DiffHunk, type DiffLine } from '@ogden-agents/shared';
import { readRegularFile, type RegularFileRead } from '../fs-safe.js';
import { BRANCH, checkPath, checkRelative, REVISION, realOf, SAFE_CONFIG } from './checks.js';
import { createGitRunner, OUTPUT_TOO_LARGE, type GitRunnerOptions } from './runner.js';

export interface GitWorkingTreeOptions extends GitRunnerOptions {
  /** `<data>/snapshots`: made if missing; refused (no snapshot, no read of one) when it is a link or not a folder. */
  snapshotsRoot: string;
}

/** Where git runs for a folder: its cwd, Ogden's pins (a worktree), the repo's shared git folder and the folder's index. */
interface Located {
  cwd: string;
  env: Readonly<Record<string, string>>;
  common: string;
  index: string;
  /** `-c` flags turning off every content filter the repo's, the worktree's or the user's config names (no clean or process program runs). */
  flags: string[];
}

/** One view's diff: the revisions or flags before `--`, its environment, and what to clean up after. */
interface ViewSpec {
  args: string[];
  env: Readonly<Record<string, string>>;
  base?: string | undefined;
  /** A diff of the working tree: its new side is read from the folder itself. */
  worktreeSide: boolean;
  /** Nothing to compare (Branch with no common commit): no changes. */
  empty?: boolean;
  release(): void;
}

const EMPTY_ID = /^0+$/;
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** A raw record's header: `:<old mode> <new mode> <old id> <new id> <status>`. */
const RAW_HEADER = /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])\d*$/;

/** Config every working-tree call runs with: no network (a promisor remote's lazy fetch), no command for ssh, no split index, no untracked cache. */
const WORKING_TREE_CONFIG = ['-c', 'protocol.allow=never', '-c', 'core.sshCommand=false', '-c', 'core.splitIndex=false', '-c', 'core.untrackedCache=false'];

/** The largest index a temporary copy is made of. */
const MAX_INDEX_BYTES = 256 * 1024 * 1024;

/** The diff flags every view reads with. */
const DIFF = ['--literal-pathspecs', 'diff', '--no-ext-diff', '--no-textconv', '--no-color', '--no-renames', '--relative'];

/** A unified diff's hunks (one file's), each with its lines' numbers; ids `h<n>-<sha1 of the hunk, 10>`. */
export function parseHunks(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: { header: string; hunk: DiffHunk } | undefined;
  let oldLine = 0;
  let newLine = 0;
  const finish = () => {
    if (current === undefined) return;
    const digest = createHash('sha1').update(current.header).update('\n');
    for (const line of current.hunk.lines) digest.update(`${line.kind[0]}${line.text}\n`);
    current.hunk.id = `h${hunks.length + 1}-${digest.digest('hex').slice(0, 10)}`;
    hunks.push(current.hunk);
    current = undefined;
  };
  for (const line of patch.split('\n')) {
    const header = HUNK_HEADER.exec(line);
    if (header !== null) {
      finish();
      const oldStart = Number(header[1]);
      const newStart = Number(header[3]);
      current = {
        header: header[0],
        hunk: { id: '', oldStart, oldLines: header[2] === undefined ? 1 : Number(header[2]), newStart, newLines: header[4] === undefined ? 1 : Number(header[4]), lines: [] },
      };
      oldLine = oldStart;
      newLine = newStart;
      continue;
    }
    if (current === undefined) continue;
    // "\ No newline at end of file".
    if (line.startsWith('\\')) continue;
    const kind = line[0];
    const text = line.slice(1);
    let entry: DiffLine;
    if (kind === ' ') entry = { kind: 'context', text, oldLine: oldLine++, newLine: newLine++ };
    else if (kind === '+') entry = { kind: 'add', text, newLine: newLine++ };
    else if (kind === '-') entry = { kind: 'remove', text, oldLine: oldLine++ };
    else {
      finish();
      continue;
    }
    // A side's numbers start at 0 only when it has no lines (a new or deleted file).
    if (entry.oldLine === 0) delete entry.oldLine;
    if (entry.newLine === 0) delete entry.newLine;
    current.hunk.lines.push(entry);
  }
  finish();
  return hunks;
}

interface RawEntry {
  path: string;
  status: string;
  oldId: string;
  newId: string;
}

/** `diff --raw --numstat -z`'s records: each file's status and blob ids, and its line counts (`null` for a binary file). */
function parseListing(out: string): { raw: RawEntry[]; counts: Map<string, { additions: number; deletions: number } | null> } {
  const tokens = out.split('\0');
  const raw: RawEntry[] = [];
  const counts = new Map<string, { additions: number; deletions: number } | null>();
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token === '') continue;
    const header = RAW_HEADER.exec(token);
    if (header !== null) {
      const path = tokens[++index] ?? '';
      if (path !== '') raw.push({ path, status: header[5]!, oldId: header[3]!, newId: header[4]! });
      continue;
    }
    const count = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(token);
    if (count === null) continue;
    counts.set(count[3]!, count[1] === '-' || count[2] === '-' ? null : { additions: Number(count[1]), deletions: Number(count[2]) });
  }
  return { raw, counts };
}

export function createGitWorkingTree(options: GitWorkingTreeOptions): VcsWorkingTreePort {
  // The user's own checkout as its config says (never `core.autocrlf=false` here), and never a fetch, a split index
  // (`sharedindex.*` written beside the repo's index) or an untracked cache (written into the index read).
  const runner = createGitRunner({ ...options, overrideAutocrlf: false, extraConfig: WORKING_TREE_CONFIG, extraEnv: { GIT_NO_LAZY_FETCH: '1' } });
  const { run, must } = runner;

  const refusedStore = (): never => {
    throw new VcsError("Ogden Agents' snapshots folder isn't a folder of its own, so no snapshot was used.", { step: 'snapshots' });
  };

  /** Whether anything (a link too) is at `path`. */
  const present = (path: string): boolean => {
    try {
      lstatSync(path);
      return true;
    } catch {
      return false;
    }
  };

  /** A real folder (made if missing), or a refusal: never a link, never a file. */
  const realFolder = (path: string): string => {
    if (!present(path)) mkdirSync(path, { mode: 0o700 });
    if (!isRealFolder(path)) refusedStore();
    return path;
  };

  /** The repo's store of snapshot objects (`create`: made if missing), else a refusal; `undefined` when it isn't there and isn't made. */
  const storeOf = (common: string, create: boolean): string | undefined => {
    const root = options.snapshotsRoot;
    checkPath(root);
    const folder = join(root, createHash('sha256').update(realOf(common)).digest('hex').slice(0, 16));
    const objects = join(folder, 'objects');
    for (const path of [root, folder, objects]) {
      if (create) realFolder(path);
      else if (!present(path)) return undefined;
      else if (!isRealFolder(path)) refusedStore();
    }
    // Ogden's own store: never a list of other stores to read, never a path that splits as several.
    if (present(join(objects, 'info', 'alternates')) || present(join(objects, 'info', 'http-alternates')) || objects.includes(delimiter)) refusedStore();
    return objects;
  };

  /** A temporary copy of the folder's index in `<snapshots>/tmp` (none when it has none), and its removal. */
  const tempIndex = (located: Located): { path: string; remove(): void } => {
    realFolder(options.snapshotsRoot);
    const dir = realFolder(join(options.snapshotsRoot, 'tmp'));
    const path = join(dir, `${randomUUID()}.index`);
    // A regular file only, read from the descriptor checked: never a link to another file, never a FIFO or a device.
    let read: RegularFileRead | undefined;
    try {
      read = readRegularFile(located.index, MAX_INDEX_BYTES);
    } catch {
      throw new VcsError("The repository's index isn't a file Ogden Agents reads.", { step: 'index' });
    }
    if (read !== undefined) {
      writeFileSync(path, read.bytes, { flag: 'wx', mode: 0o600 });
      // The copy keeps the index's own time: git tells a file changed within the same second as the index (a
      // "racily clean" entry) only by comparing it with the index's time, and a newer copy would hide that change.
      utimesSync(path, read.atime, read.mtime);
    }
    return {
      path,
      remove: () => {
        for (const file of [path, `${path}.lock`]) rmSync(file, { force: true });
      },
    };
  };

  /** Writes go to the store; the repo's objects (and the store, for reads) are read through alternates. */
  const storeEnv = (located: Located, store: string, index: string): Record<string, string> => {
    const repoObjects = join(located.common, 'objects');
    if (repoObjects.includes(delimiter)) throw new VcsError("The repository's folder can't be used for a snapshot.", { step: 'snapshot' });
    return { ...located.env, GIT_INDEX_FILE: index, GIT_OBJECT_DIRECTORY: store, GIT_ALTERNATE_OBJECT_DIRECTORIES: repoObjects };
  };

  /** Where git runs for `folder`; `undefined` when it is in no repository's working tree. */
  const locate = async (folder: VcsFolder): Promise<Located | undefined> => {
    checkPath(folder.path);
    let found: Omit<Located, 'flags'>;
    if (folder.worktree !== undefined) {
      const pinned = await runner.pinnedWorktree(folder.worktree.repoPath, folder.path, folder.worktree.branch);
      found = { cwd: folder.path, env: pinned.env, common: pinned.common, index: join(pinned.env.GIT_DIR, 'index') };
    } else {
      if (!existsSync(folder.path)) return undefined;
      const out = await run(folder.path, ['rev-parse', '--is-inside-work-tree', '--path-format=absolute', '--git-common-dir', '--git-path', 'index']);
      if (out.code !== 0) return undefined;
      const [inside, common, index] = out.stdout.split(/\r?\n/).map((line) => line.trim());
      if (inside !== 'true' || common === undefined || common === '' || index === undefined || index === '') return undefined;
      found = { cwd: folder.path, env: {}, common: realOf(common), index };
    }
    return { ...found, flags: await filterFlags(found.cwd, found.env) };
  };

  /**
   * `-c` flags emptying every filter driver the config names (`filter.<name>.clean`, `.smudge`, `.process`), and
   * not required, so `add` and `diff` never run a program the repo, a worktree or the user configured (git-lfs too).
   */
  const filterFlags = async (cwd: string, env: Readonly<Record<string, string>>): Promise<string[]> => {
    const out = await run(cwd, ['config', '--name-only', '-z', '--get-regexp', '^filter\\.'], undefined, env);
    // Exit 1: none configured.
    if (out.code !== 0) return [];
    const names = new Set<string>();
    for (const key of out.stdout.split('\0')) {
      if (!key.startsWith('filter.')) continue;
      const name = key.slice('filter.'.length, key.lastIndexOf('.'));
      if (name === '' || key.lastIndexOf('.') < 'filter.'.length) continue;
      // `-c` splits at the first `=`: a name holding one can't be turned off, so nothing runs.
      if (name.includes('=') || name.includes('\n')) throw new VcsError('The repository names a filter Ogden Agents can\'t turn off, so git didn\'t run.', { step: 'filter' });
      names.add(name);
    }
    return [...names].flatMap((name) => ['-c', `filter.${name}.clean=`, '-c', `filter.${name}.smudge=`, '-c', `filter.${name}.process=`, '-c', `filter.${name}.required=false`]);
  };

  /** The branch Branch compares with and its commit: `origin/HEAD`'s, else `main`, else `master`. */
  const branchBase = async (located: Located): Promise<{ name: string; revision: string } | undefined> => {
    const candidates: Array<{ name: string; refs: string[] }> = [];
    const origin = await run(located.cwd, [...located.flags, 'symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], undefined, located.env);
    const originName = origin.code === 0 ? origin.stdout.trim().replace(/^refs\/remotes\/origin\//, '') : '';
    if (originName !== '' && originName !== origin.stdout.trim() && BRANCH.test(originName) && !originName.includes('..')) {
      candidates.push({ name: originName, refs: [`refs/heads/${originName}`, `refs/remotes/origin/${originName}`] });
    }
    for (const name of ['main', 'master']) candidates.push({ name, refs: [`refs/heads/${name}`] });
    for (const { name, refs } of candidates) {
      for (const ref of refs) {
        const found = await run(located.cwd, [...located.flags, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`], undefined, located.env);
        const revision = found.stdout.trim();
        if (found.code === 0 && REVISION.test(revision)) return { name, revision };
      }
    }
    return undefined;
  };

  /** The diff a view reads; `undefined` when it has nothing to compare (Branch without a base). */
  const viewSpec = async (located: Located, target: VcsChangesTarget): Promise<ViewSpec | undefined> => {
    const none = () => undefined;
    if (target.view === 'turn') {
      if (!REVISION.test(target.startTree) || !REVISION.test(target.endTree)) throw new VcsError('That is not a snapshot Ogden Agents can use.', { step: 'snapshot' });
      const store = storeOf(located.common, false);
      if (store === undefined) throw new VcsError("This turn's snapshots are gone.", { step: 'snapshot' });
      return { args: [target.startTree, target.endTree], env: { ...located.env, GIT_ALTERNATE_OBJECT_DIRECTORIES: store }, worktreeSide: false, release: none };
    }
    if (target.view === 'staged') return { args: ['--cached'], env: located.env, worktreeSide: false, release: none };
    if (target.view === 'branch') {
      const base = await branchBase(located);
      if (base === undefined) return undefined;
      const merged = await run(located.cwd, [...located.flags, 'merge-base', base.revision, 'HEAD'], undefined, located.env);
      const from = merged.stdout.trim();
      if (merged.code !== 0 || !REVISION.test(from)) return { args: [], env: located.env, base: base.name, worktreeSide: false, empty: true, release: none };
      return { args: [from, 'HEAD'], env: located.env, base: base.name, worktreeSide: false, release: none };
    }
    // Unstaged: the index against the folder, with untracked files (not ignored ones) as intent to add, in a temporary index.
    const store = storeOf(located.common, true)!;
    const index = tempIndex(located);
    try {
      const env = storeEnv(located, store, index.path);
      await must(located.cwd, [...located.flags, '--literal-pathspecs', 'add', '--intent-to-add', '--', '.'], 'read the changes', undefined, env);
      return { args: [], env, worktreeSide: true, release: index.remove };
    } catch (error) {
      index.remove();
      throw error;
    }
  };

  /** The blobs' sizes, by id (`cat-file --batch-check`). */
  const blobSizes = async (located: Located, env: Readonly<Record<string, string>>, ids: readonly string[]): Promise<Map<string, number>> => {
    const sizes = new Map<string, number>();
    const wanted = [...new Set(ids.filter((id) => !EMPTY_ID.test(id)))];
    if (wanted.length === 0) return sizes;
    const out = await run(located.cwd, [...located.flags, 'cat-file', '--batch-check'], undefined, env, `${wanted.join('\n')}\n`);
    if (out.code !== 0) return sizes;
    for (const line of out.stdout.split('\n')) {
      const match = /^([0-9a-f]+) \S+ (\d+)$/.exec(line.trim());
      if (match !== null) sizes.set(match[1]!, Number(match[2]));
    }
    return sizes;
  };

  /** The view's changed files under `paths` (none: all). */
  const listed = async (located: Located, spec: ViewSpec, paths: readonly string[]): Promise<{ files: ChangedFile[]; truncated: boolean }> => {
    if (spec.empty === true) return { files: [], truncated: false };
    const out = await must(located.cwd, [...located.flags, ...DIFF, '--no-abbrev', '-z', '--raw', '--numstat', ...spec.args, '--', ...paths], 'read the changes', 64 * 1024 * 1024, spec.env);
    const { raw, counts } = parseListing(out);
    const kept = raw.slice(0, MAX_CHANGED_FILES);
    const sizes = await blobSizes(located, spec.env, kept.flatMap((entry) => [entry.oldId, entry.newId]));
    const sizeOf = (entry: RawEntry, side: 'old' | 'new'): number => {
      const id = side === 'old' ? entry.oldId : entry.newId;
      if (!EMPTY_ID.test(id)) return sizes.get(id) ?? 0;
      if (side === 'old' || entry.status === 'D' || !spec.worktreeSide) return 0;
      try {
        return lstatSync(join(located.cwd, ...entry.path.split('/'))).size;
      } catch {
        return 0;
      }
    };
    const files = kept.map((entry): ChangedFile => {
      const count = counts.get(entry.path);
      const binary = count === null;
      return {
        path: entry.path,
        change: entry.status === 'A' ? 'added' : entry.status === 'D' ? 'deleted' : 'changed',
        additions: count?.additions ?? 0,
        deletions: count?.deletions ?? 0,
        binary,
        tooLarge: !binary && Math.max(sizeOf(entry, 'old'), sizeOf(entry, 'new')) > MAX_DIFF_FILE_BYTES,
      };
    });
    return { files, truncated: raw.length > kept.length };
  };

  /** Runs `read` with the view's spec, cleaning up after; `undefined` when the folder is in no repository or the view has nothing to compare. */
  const withView = async <T>(folder: VcsFolder, target: VcsChangesTarget, read: (located: Located, spec: ViewSpec) => Promise<T>): Promise<{ value: T } | { base?: string } | undefined> => {
    const located = await locate(folder);
    if (located === undefined) return undefined;
    const spec = await viewSpec(located, target);
    if (spec === undefined) return {};
    try {
      return { value: await read(located, spec) };
    } finally {
      spec.release();
    }
  };

  return {
    async changedFiles(folder, target): Promise<VcsChangedFiles> {
      let base: string | undefined;
      const result = await withView(folder, target, async (located, spec) => {
        base = spec.base;
        return listed(located, spec, []);
      });
      if (result === undefined || !('value' in result)) return { files: [], truncated: false };
      return { ...(target.view === 'branch' && base !== undefined ? { base } : {}), ...result.value };
    },

    async fileDiff(folder, target, path) {
      checkRelative(path);
      const result = await withView(folder, target, async (located, spec) => {
        const [file] = (await listed(located, spec, [path])).files.filter((one) => one.path === path);
        if (file === undefined) return undefined;
        if (file.binary || file.tooLarge) return { file, hunks: [] };
        let patch: string;
        try {
          patch = await must(located.cwd, [...located.flags, ...DIFF, ...spec.args, '--', path], 'read the change', 4 * MAX_DIFF_FILE_BYTES, spec.env);
        } catch (error) {
          if (error instanceof VcsError && error.details.code === OUTPUT_TOO_LARGE) return { file: { ...file, tooLarge: true }, hunks: [] };
          throw error;
        }
        if (Buffer.byteLength(patch, 'utf8') > MAX_DIFF_FILE_BYTES) return { file: { ...file, tooLarge: true }, hunks: [] };
        return { file, hunks: parseHunks(patch) };
      });
      return result === undefined || !('value' in result) ? undefined : result.value;
    },

    async snapshot(folder) {
      const located = await locate(folder);
      if (located === undefined) return undefined;
      const store = storeOf(located.common, true)!;
      const index = tempIndex(located);
      try {
        const env = storeEnv(located, store, index.path);
        await must(located.cwd, [...located.flags, '--literal-pathspecs', 'add', '--all', '--', '.'], 'snapshot the folder', undefined, env);
        const tree = (await must(located.cwd, [...located.flags, 'write-tree'], 'snapshot the folder', undefined, env)).trim();
        if (!REVISION.test(tree)) throw new VcsError("git couldn't snapshot the folder.", { step: 'snapshot' });
        return tree;
      } finally {
        index.remove();
      }
    },

    async commitAll(folder, message) {
      checkPath(folder.path);
      if (folder.worktree === undefined) throw new VcsError('Only a chat that works in its own copy can commit here.', { step: 'commit' });
      const { repoPath, branch } = folder.worktree;
      const located = (await locate(folder))!;
      const { cwd, env, flags } = located;
      const ref = `refs/heads/${branch}`;
      // The chat's own branch, as a ref of its own: one made to point at another (`ref: refs/heads/main`) is refused.
      if ((await run(cwd, [...flags, 'symbolic-ref', '--quiet', ref], undefined, env)).code === 0) throw new VcsError("The chat's branch isn't as Ogden Agents made it, so nothing was committed.", { step: 'commit' });
      const old = (await must(cwd, [...flags, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`], 'read the branch', undefined, env)).trim();
      if (!REVISION.test(old)) throw new VcsError("git couldn't read the chat's branch.", { step: 'commit' });
      await must(cwd, [...flags, '--literal-pathspecs', 'add', '--all'], 'stage the changes', undefined, env);
      const tree = (await must(cwd, [...flags, 'write-tree'], 'stage the changes', undefined, env)).trim();
      const oldTree = (await must(cwd, [...flags, 'rev-parse', '--verify', `${old}^{tree}`], 'read the branch', undefined, env)).trim();
      if (!REVISION.test(tree) || !REVISION.test(oldTree)) throw new VcsError("git couldn't stage the changes.", { step: 'commit' });
      if (tree === oldTree) return 'nothing';
      const changed = await must(cwd, [...flags, 'diff-tree', '-r', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', oldTree, tree], 'read the changes', undefined, env);
      const files = changed.split('\0').filter((name) => name !== '').length;
      // Plumbing, never `commit`: the commit's parent is the branch as read, and the branch moves only from that
      // commit (compare and swap, never through a symbolic ref), whatever HEAD says by then.
      const revision = (
        await must(cwd, [...flags, ...SAFE_CONFIG, ...(await runner.identityFlags(repoPath)), 'commit-tree', tree, '-p', old, '-m', message], 'commit the changes', undefined, env)
      ).trim();
      if (!REVISION.test(revision)) throw new VcsError("git couldn't commit the changes.", { step: 'commit' });
      await must(cwd, [...flags, 'update-ref', '--no-deref', '-m', 'commit (Ogden Agents)', ref, revision, old], 'move the branch', undefined, env);
      return { revision, files };
    },
  };
}
