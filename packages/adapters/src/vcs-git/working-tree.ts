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
 * The project's `.git` is checked before git runs there (user decision
 * 2026-11-01, AD-37): a `.git` file is followed only for a standard linked
 * worktree or submodule (`git-pointer.ts`), and the git folder git then
 * finds must be the one checked; anything else refuses every view, the
 * snapshot and the commit with `GIT_POINTER_UNUSUAL_MESSAGE`.
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
 * is over it.
 *
 * Hunk actions (story 8.5): the file's diff in the view, exactly as the
 * viewer's ids came from it (`DIFF`), is rebuilt with only its `diff
 * --git`, `new file mode` / `deleted file mode`, `---` and `+++` lines and
 * the chosen `@@` hunks, and refused unless every header names the path
 * asked for. It goes to `git apply` on stdin (`--whitespace=nowarn`,
 * `apply.ignoreWhitespace=no`, no fuzz, never `--3way`, `--unidiff-zero`
 * or `--reject`), `--check` first, all or nothing: `--cached` to stage
 * (the real index; Unstaged's temporary one only for reading),
 * `--cached -R` to unstage, `-R` on the folder alone to revert (never the
 * index). Only a plain text file (modes 100644 or 100755, or none), not
 * binary or too large, under folders that are real folders of the view's
 * folder. A whole-file action names every hunk id the file has now, or is
 * outdated. A revert's patch is kept in memory under a random undo id,
 * bound to its folder, path and view and to the file's bytes as the revert
 * left them (sha256), for `UNDO_KEPT_MS` (at most `MAX_UNDOS_KEPT`);
 * `undoRevert` applies it forward only onto those same bytes, `--check`
 * first, and then forgets it. A restart forgets every one. A This turn
 * revert needs each hunk's lines in the folder's file exactly once. A
 * write to the folder keeps the file's own permission bits.
 *
 * Moving changes (27.4, a chat's hand-off): both folders are located (a
 * worktree by its pin, and only a real folder, never a link) and refused,
 * before anything is snapshotted, while a merge, rebase, cherry-pick or
 * revert is in progress, with unmerged entries, or with entries marked
 * assume-unchanged or skip-worktree. Both are snapshotted into the store as
 * above before anything moves; every answer and every throw after that
 * carries both tree ids (the store may then hold the only copy). The moved
 * paths are `diff-tree` of the source's `HEAD` tree against its snapshot (a
 * gitlink, or a path whose folders or file are not plain, refuses it all);
 * the target's own changes are its `HEAD` tree against its snapshot, and any
 * path in both is a conflict. A moved file whose raw bytes aren't its
 * snapshot blob (git would convert its line endings) and text that isn't
 * UTF-8 are refused before anything is written; after the apply the
 * target's raw bytes are checked against the same blobs, and a mismatch is
 * a failed apply. The patch is `diff --binary
 * --full-index --no-renames` of those two trees (the store an alternate),
 * applied to the target's files only (never its index): `--check` first (a
 * failed check is a conflict over the moved files that differ between the
 * two `HEAD`s, nothing written), never `--3way`. `git apply` writes file by
 * file, so an apply that fails partway (or times out) is reversed (`-R`,
 * checked) and thrown with `targetClean` (whether that worked and the
 * target reads as its snapshot); never put back from the snapshot, which
 * would overwrite another write; the source is untouched. Once the target
 * applied it is never undone: the source is cleaned best effort (`-R`,
 * `--check` first) and snapshotted again, and a moved path still differing
 * from its `HEAD` is counted `leftBehind` (never thrown). Each moved file
 * arrives with the source's exact mode, and what the source keeps goes back
 * to its own. Last, the source's index entries for the moved paths that
 * left it, as the snapshot has them (or intent-to-add ones of files gone),
 * go back to its `HEAD`'s (in chunks, best effort), so the changes arrive
 * unstaged; one partly staged keeps its staged version.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import {
  isRealFolder,
  VcsError,
  type VcsChangedFiles,
  type VcsChangesTarget,
  type VcsChatWorktreePort,
  type VcsFolder,
  type VcsHunkResult,
  type VcsMoveChanges,
  type VcsWorkingTreePort,
} from '@ogden-agents/core';
import {
  GIT_POINTER_UNUSUAL_MESSAGE,
  HUNK_ACTIONS_BY_VIEW,
  MAX_CHANGED_FILES,
  MAX_DIFF_FILE_BYTES,
  MAX_UNDOS_KEPT,
  UNDO_KEPT_MS,
  type ChangedFile,
  type DiffHunk,
  type DiffLine,
  type HunkAction,
} from '@ogden-agents/shared';
import { readRegularFile, type RegularFileRead } from '../fs-safe.js';
import { BRANCH, checkPath, checkRelative, REVISION, realOf, SAFE_CONFIG } from './checks.js';
import { checkGitPointer, type GitPointer } from './git-pointer.js';
import { createGitRunner, OUTPUT_TOO_LARGE, type GitRunner, type GitRunnerOptions } from './runner.js';

export interface GitWorkingTreeOptions extends GitRunnerOptions {
  /** `<data>/snapshots`: made if missing; refused (no snapshot, no read of one) when it is a link or not a folder. */
  snapshotsRoot: string;
  /** The clock a revert's undo is timed by (tests). Default `Date.now`. */
  now?: (() => number) | undefined;
}

/** Where git runs for a folder: its cwd, Ogden's pins (a worktree), the repo's shared git folder and the folder's index. */
export interface Located {
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
const WORKING_TREE_CONFIG = [
  '-c',
  'protocol.allow=never',
  // Each protocol too: a repo's `protocol.<name>.allow=always` would otherwise win over `protocol.allow`.
  ...['ext', 'file', 'ssh', 'git', 'http', 'https'].flatMap((name) => ['-c', `protocol.${name}.allow=never`]),
  '-c',
  'core.sshCommand=false', '-c', 'core.splitIndex=false', '-c', 'core.untrackedCache=false'];

/** The largest index a temporary copy is made of. */
const MAX_INDEX_BYTES = 256 * 1024 * 1024;

/**
 * The diff flags every view reads with: git's own diff, never a program's, paths unquoted where git can, blank
 * context lines kept as a space, 3 lines of context and `a/` `b/` whatever the user's config says, so a hunk
 * action's patch is the very diff the viewer's ids came from.
 */
const DIFF = [
  '-c',
  'core.quotePath=false',
  '-c',
  'diff.suppressBlankEmpty=false',
  '--literal-pathspecs',
  'diff',
  '--no-ext-diff',
  '--no-textconv',
  '--no-color',
  '--no-renames',
  '--relative',
  '--unified=3',
  '--src-prefix=a/',
  '--dst-prefix=b/',
];

/** `git apply` as hunk actions run it: whitespace as it is, never ignored, no fuzz (no `-C`), the patch on stdin. */
const APPLY = ['-c', 'apply.ignoreWhitespace=no', '-c', 'apply.whitespace=nowarn', 'apply', '--whitespace=nowarn'];

/** The modes a hunk action takes: a regular file, executable or not, or none (added or deleted). */
const PLAIN_MODES: ReadonlySet<string> = new Set(['100644', '100755', '000000']);

/** The `apply` flags of each action. */
const APPLY_FLAGS: Readonly<Record<HunkAction, readonly string[]>> = { stage: ['--cached'], unstage: ['--cached', '-R'], revert: ['-R'] };

/** One file's patch split for a hunk action: its kept header lines and each hunk's lines with its id. */
export interface SplitPatch {
  header: string[];
  hunks: Array<{ id: string; lines: string[] }>;
}

/**
 * One file's diff (git's own, as `DIFF` prints it) split into the header lines a hunk action keeps and its
 * hunks with their `parseHunks` ids; `undefined` when it is anything else: another path in a header, a
 * rename, copy or binary patch, a mode other than a regular file's, a line git doesn't print in a hunk, or
 * text that wasn't UTF-8 (it would not be written back as it was).
 */
export function splitPatch(patch: string, path: string): SplitPatch | undefined {
  if (patch.includes('\uFFFD')) return undefined;
  const lines = patch.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const first = lines.findIndex((line) => line.startsWith('@@ '));
  if (first <= 0) return undefined;
  const header: string[] = [];
  for (const line of lines.slice(0, first)) {
    if (line.startsWith('index ')) continue;
    const mode = /^(?:old|new|new file|deleted file) mode (\d{6})$/.exec(line);
    if (mode !== null && !PLAIN_MODES.has(mode[1]!)) return undefined;
    // A mode change is left as it is: only the lines move.
    if (/^(?:old|new) mode /.test(line)) continue;
    if (mode !== null || line.startsWith('diff --git ') || line.startsWith('--- ') || line.startsWith('+++ ')) header.push(line);
    else return undefined;
  }
  const count = (prefix: string) => header.filter((line) => line.startsWith(prefix)).length;
  if (!header[0]!.startsWith('diff --git ') || count('diff --git ') !== 1 || count('--- ') !== 1 || count('+++ ') !== 1 || header.length > 4) return undefined;
  // Each header names exactly this path (git adds a tab after a name with a space): never split at a " b/" inside it.
  const named = (line: string, prefix: string) => line === `${prefix}${path}` || line === `${prefix}${path}\t`;
  const minus = header.find((line) => line.startsWith('--- '))!;
  const plus = header.find((line) => line.startsWith('+++ '))!;
  if (header[0] !== `diff --git a/${path} b/${path}` || !(minus === '--- /dev/null' || named(minus, '--- a/')) || !(plus === '+++ /dev/null' || named(plus, '+++ b/'))) return undefined;
  const hunks: SplitPatch['hunks'] = [];
  for (const line of lines.slice(first)) {
    if (line.startsWith('@@ ')) hunks.push({ id: '', lines: [line] });
    else if (/^[ +\-\\]/.test(line)) hunks.at(-1)!.lines.push(line);
    else return undefined;
  }
  const ids = parseHunks(patch).map((hunk) => hunk.id);
  if (ids.length !== hunks.length) return undefined;
  hunks.forEach((hunk, index) => (hunk.id = ids[index]!));
  return { header, hunks };
}

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
  oldMode: string;
  newMode: string;
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
      if (path !== '') raw.push({ path, status: header[5]!, oldMode: header[1]!, newMode: header[2]!, oldId: header[3]!, newId: header[4]! });
      continue;
    }
    const count = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(token);
    if (count === null) continue;
    counts.set(count[3]!, count[1] === '-' || count[2] === '-' ? null : { additions: Number(count[1]), deletions: Number(count[2]) });
  }
  return { raw, counts };
}

/** The working tree's port, with the chat-worktree half's hand-off (27.4). */
export type GitWorkingTree = VcsWorkingTreePort & Pick<VcsChatWorktreePort, 'moveChanges'>;

/** The all-zero object id `update-index --index-info` removes an entry with. */
const NO_OBJECT = '0'.repeat(40);

/** How many paths go on one git command line (a hand-off's index reads and restore patches, 27.4). */
const PATH_CHUNK = 200;

/** The working tree's own git and store (27.6: shared with `chat-worktree.ts`, which saves and restores chat worktrees through them). */
export interface WorkingTreeInternals {
  readonly runner: GitRunner;
  /** Whether anything (a link too) is at `path`. */
  present(path: string): boolean;
  /** A real folder (made if missing), or a refusal: never a link, never a file. */
  realFolder(path: string): string;
  /** The repo's store of snapshot objects (`create`: made if missing), else a refusal; `undefined` when it isn't there and isn't made. */
  storeOf(common: string, create: boolean): string | undefined;
  /** The store's folder (`<snapshots>/<sha256(real common dir)[:16]>`) of a repo's shared git folder, by path only. */
  storeFolderOf(common: string): string;
  /** A temporary copy of the folder's index in `<snapshots>/tmp`, and its removal. */
  tempIndex(located: Located): { path: string; remove(): void };
  /** Writes go to the store; the repo's objects are read through alternates. */
  storeEnv(located: Located, store: string, index: string): Record<string, string>;
  /** Where git runs for `folder`; `undefined` when it is in no repository's working tree. */
  locate(folder: VcsFolder): Promise<Located | undefined>;
  /** The folder's working tree as a tree object in the store (tracked and untracked, not ignored). */
  snapshotLocated(located: Located): Promise<string>;
}

export function createWorkingTreeInternals(options: GitWorkingTreeOptions): WorkingTreeInternals {
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
    const folder = storeFolderOf(common);
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

  /** `core.worktree` from a git folder's own `config` file only (no includes, no other config), `undefined` when unset. */
  const readCoreWorktree = async (gitDir: string): Promise<string | undefined> => {
    const out = await run(gitDir, ['config', '--file', join(gitDir, 'config'), '--get', 'core.worktree']);
    if (out.code === 1) return undefined;
    if (out.code !== 0) throw new VcsError(GIT_POINTER_UNUSUAL_MESSAGE, { step: 'gitdir', reason: 'submodule_config' });
    const value = out.stdout.replace(/\r?\n$/, '');
    return value === '' ? undefined : value;
  };

  /** The project's `.git`, checked before git runs there: a `.git` file is followed only for a standard linked worktree or submodule (`git-pointer.ts`). */
  const checkedProject = (path: string): Promise<GitPointer | undefined> => checkGitPointer(path, readCoreWorktree);

  /** What git found is what was checked: its git folder (and, for a pointer, its shared one) by real path. */
  const sameAsChecked = (pointer: GitPointer | undefined, gitDir: string, common: string): void => {
    if (pointer === undefined) throw new VcsError(GIT_POINTER_UNUSUAL_MESSAGE, { step: 'gitdir', reason: 'undiscovered' });
    if (realOf(gitDir) !== pointer.gitDir || (pointer.common !== undefined && realOf(common) !== pointer.common)) {
      throw new VcsError(GIT_POINTER_UNUSUAL_MESSAGE, { step: 'gitdir', reason: 'discovered_elsewhere' });
    }
  };

  /** Where git runs for `folder`; `undefined` when it is in no repository's working tree. */
  const locate = async (folder: VcsFolder): Promise<Located | undefined> => {
    checkPath(folder.path);
    let found: Omit<Located, 'flags'>;
    if (folder.worktree !== undefined) {
      // The chat's worktree is checked by the pin; the project it came from by its `.git`.
      checkPath(folder.worktree.repoPath);
      await checkedProject(folder.worktree.repoPath);
      const pinned = await runner.pinnedWorktree(folder.worktree.repoPath, folder.path, folder.worktree.branch);
      found = { cwd: folder.path, env: pinned.env, common: pinned.common, index: join(pinned.env.GIT_DIR, 'index') };
    } else {
      if (!existsSync(folder.path)) return undefined;
      const pointer = await checkedProject(folder.path);
      if (pointer === undefined) return undefined;
      const out = await run(folder.path, ['rev-parse', '--is-inside-work-tree', '--path-format=absolute', '--git-common-dir', '--git-path', 'index', '--absolute-git-dir']);
      if (out.code !== 0) return undefined;
      const [inside, common, index, gitDir] = out.stdout.split(/\r?\n/).map((line) => line.trim());
      if (inside !== 'true' || common === undefined || common === '' || index === undefined || index === '' || gitDir === undefined || gitDir === '') return undefined;
      sameAsChecked(pointer, gitDir, common);
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


  const storeFolderOf = (common: string): string => join(options.snapshotsRoot, createHash('sha256').update(realOf(common)).digest('hex').slice(0, 16));

  const snapshotLocated = async (located: Located): Promise<string> => {
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
  };

  return { runner, present, realFolder, storeOf, storeFolderOf, tempIndex, storeEnv, locate, snapshotLocated };
}

export function createGitWorkingTree(options: GitWorkingTreeOptions): GitWorkingTree {
  const internals = createWorkingTreeInternals(options);
  const { runner, present, storeOf, tempIndex, storeEnv, locate } = internals;
  const { run, must } = runner;

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

  /** The view's changed files under `paths` (none: all), and each one's modes (old, new). */
  const listed = async (located: Located, spec: ViewSpec, paths: readonly string[]): Promise<{ files: ChangedFile[]; truncated: boolean; modes: Map<string, [string, string]> }> => {
    if (spec.empty === true) return { files: [], truncated: false, modes: new Map() };
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
    return { files, truncated: raw.length > kept.length, modes: new Map(kept.map((entry) => [entry.path, [entry.oldMode, entry.newMode]])) };
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

  /**
   * Whether every folder on `path` is a real folder of `cwd` (one not there yet is fine: git makes it), and the
   * file itself, when `leaf` and it is there, a regular file: never a link out, never a link's target.
   */
  const plainPath = (cwd: string, path: string, leaf: boolean): boolean => {
    const segments = path.split('/');
    for (let end = 1; end <= segments.length; end++) {
      if (end === segments.length && !leaf) return true;
      let stat;
      try {
        stat = lstatSync(join(cwd, ...segments.slice(0, end)));
      } catch {
        return true;
      }
      if (end < segments.length ? !stat.isDirectory() : !stat.isFile()) return false;
      // On a case-insensitive disk `Notes.txt` answers for `notes.txt`: only the exact name is that file.
      try {
        if (!readdirSync(join(cwd, ...segments.slice(0, end - 1))).includes(segments[end - 1]!)) return false;
      } catch {
        return false;
      }
    }
    return true;
  };

  /**
   * Applies `patch` with the action's flags in the folder's own environment, `--check` first: `false` (nothing
   * written) when it doesn't apply as it is. The patch's paths are the folder's: `--directory` names the folder
   * within the repo, since `apply` in a subfolder otherwise skips them (and says so only in its verbose output,
   * which is checked: a skipped patch is never taken for an applied one).
   */
  const applyPatch = async (located: Located, flags: readonly string[], patch: string, path: string): Promise<boolean> => {
    const prefix = (await must(located.cwd, [...located.flags, 'rev-parse', '--show-prefix'], 'read the repository', undefined, located.env)).replace(/\r?\n$/, '');
    const args = [...located.flags, ...APPLY, ...flags, ...(prefix === '' ? [] : [`--directory=${prefix}`])];
    const check = await run(located.cwd, [...args, '--check', '--verbose', '-'], undefined, located.env, patch);
    if (check.code !== 0) return false;
    if (/^Skipped patch/m.test(check.stderr) || !/^Checking patch /m.test(check.stderr)) throw new VcsError("git didn't take the change, so nothing was changed.", { step: 'apply' });
    // A write to the folder recreates the file with git's mode: a file kept private (`.env` at 0600) stays so.
    const file = join(located.cwd, ...path.split('/'));
    const before = flags.includes('--cached') ? undefined : statOf(file);
    await must(located.cwd, [...args, '-'], 'apply the change', undefined, located.env, patch);
    const after = before === undefined ? undefined : statOf(file);
    if (before !== undefined && after !== undefined && after.isFile() && (after.mode & 0o7777) !== (before.mode & 0o7777)) chmodSync(file, before.mode & 0o7777);
    return true;
  };

  /** The folder's file as it is now: its bytes' sha256 (`absent` when there is none), read without following a link. */
  const fileHash = (located: Located, path: string): string => {
    const read = readRegularFile(join(located.cwd, ...path.split('/')), MAX_DIFF_FILE_BYTES * 4);
    return read === undefined ? 'absent' : createHash('sha256').update(read.bytes).digest('hex');
  };

  /**
   * Whether each hunk's new side (its context and added lines, in order) is in the folder's file exactly once, so a
   * This turn revert can't land on another copy of the same lines after the file was edited.
   */
  const onceInFolder = (located: Located, path: string, hunks: SplitPatch['hunks']): boolean => {
    let read: RegularFileRead | undefined;
    try {
      read = readRegularFile(join(located.cwd, ...path.split('/')), MAX_DIFF_FILE_BYTES * 4);
    } catch {
      return false;
    }
    const lines = read === undefined ? [] : read.bytes.toString('utf8').split('\n').map((line) => line.replace(/\r$/, ''));
    for (const hunk of hunks) {
      const block = hunk.lines.slice(1).filter((line) => line[0] === ' ' || line[0] === '+').map((line) => line.slice(1).replace(/\r$/, ''));
      if (block.length === 0) continue;
      let found = 0;
      for (let at = 0; at + block.length <= lines.length && found < 2; at++) if (block.every((line, offset) => lines[at + offset] === line)) found++;
      if (found !== 1) return false;
    }
    return true;
  };

  const statOf = (file: string) => {
    try {
      return lstatSync(file);
    } catch {
      return undefined;
    }
  };

  const now = options.now ?? Date.now;
  /** Each revert's patch, by undo id, with its folder and path; oldest first. */
  const undos = new Map<string, { folder: string; path: string; view: string; patch: string; hash: string; at: number }>();
  const folderKey = (folder: VcsFolder): string => JSON.stringify([folder.path, folder.worktree?.repoPath ?? null, folder.worktree?.branch ?? null]);
  const forgetOld = (): void => {
    for (const [id, kept] of undos) if (now() - kept.at > UNDO_KEPT_MS) undos.delete(id);
  };
  const remember = (folder: VcsFolder, path: string, view: string, patch: string, hash: string): string => {
    forgetOld();
    while (undos.size >= MAX_UNDOS_KEPT) undos.delete(undos.keys().next().value!);
    const id = randomBytes(16).toString('hex');
    undos.set(id, { folder: folderKey(folder), path, view, patch, hash, at: now() });
    return id;
  };

  /** Snapshots the located folder's working tree (tracked and untracked, not ignored) into the store: its tree id. */
  const snapshotOf = internals.snapshotLocated;

  /** The located folder's `HEAD` tree. */
  const headTree = async (located: Located): Promise<string> => {
    const tree = (await must(located.cwd, [...located.flags, 'rev-parse', '--verify', 'HEAD^{tree}'], 'read the branch', undefined, located.env)).trim();
    if (!REVISION.test(tree)) throw new VcsError("git couldn't read the branch.", { step: 'move' });
    return tree;
  };

  /** The paths that differ between two trees (the store an alternate), with their modes. */
  const treeChanges = async (located: Located, store: string, from: string, to: string): Promise<RawEntry[]> => {
    if (from === to) return [];
    const out = await must(located.cwd, [...located.flags, 'diff-tree', '-r', '--no-renames', '--no-abbrev', '--raw', '-z', from, to], 'read the changes', 64 * 1024 * 1024, { ...located.env, GIT_ALTERNATE_OBJECT_DIRECTORIES: store });
    return parseListing(out).raw;
  };

  /** Whether git runs at the top of the repo's working tree in the located folder (a hand-off's paths are the repo's). */
  const atTop = async (located: Located): Promise<boolean> =>
    (await must(located.cwd, [...located.flags, 'rev-parse', '--show-prefix'], 'read the repository', undefined, located.env)).trim() === '';

  /** `paths` in lists short enough for one command line (thousands of long paths would be too long for one). */
  const inChunks = (paths: readonly string[]): string[][] => {
    const out: string[][] = [];
    for (let at = 0; at < paths.length; at += PATH_CHUNK) out.push(paths.slice(at, at + PATH_CHUNK));
    return out;
  };

  /**
   * One `git apply` of `patch` to the located folder's files only (never its index): `--check` alone, or the
   * apply itself. Whether git took it; a throw (a timeout, a kill) is `false` too, never a rejection.
   */
  const applyOnce = async (located: Located, patch: string, flags: { reverse: boolean; check: boolean }): Promise<boolean> => {
    try {
      const out = await run(located.cwd, [...located.flags, ...APPLY, ...(flags.reverse ? ['-R'] : []), ...(flags.check ? ['--check'] : []), '-'], 64 * 1024 * 1024, located.env, patch);
      return out.code === 0;
    } catch {
      return false;
    }
  };

  /** `--check` then the apply: whether both took it. */
  const applyChecked = async (located: Located, patch: string, reverse: boolean): Promise<boolean> =>
    (await applyOnce(located, patch, { reverse, check: true })) && (await applyOnce(located, patch, { reverse, check: false }));

  /** The patch from tree `from` to tree `to` (the store an alternate): whole, or only `paths` (in chunks). */
  const patchBetween = async (located: Located, store: string, from: string, to: string, paths?: readonly string[]): Promise<string> => {
    const args = [...located.flags, '-c', 'core.quotePath=false', '--literal-pathspecs', 'diff', '--no-ext-diff', '--no-textconv', '--no-color', '--no-renames', '--binary', '--full-index', '--src-prefix=a/', '--dst-prefix=b/', from, to];
    const env = { ...located.env, GIT_ALTERNATE_OBJECT_DIRECTORIES: store };
    if (paths === undefined) return must(located.cwd, args, 'read the changes', 256 * 1024 * 1024, env);
    let patch = '';
    for (const chunk of inChunks(paths)) patch += await must(located.cwd, [...args, '--', ...chunk], 'read the changes', 256 * 1024 * 1024, env);
    return patch;
  };

  /** Which of `paths` differ between tree `from` and the located folder as it reads now (snapshotted again). */
  const differingNow = async (located: Located, store: string, from: string, paths: ReadonlySet<string>): Promise<Set<string>> => {
    const now = await snapshotOf(located);
    return new Set((await treeChanges(located, store, from, now)).filter((entry) => paths.has(entry.path)).map((entry) => entry.path));
  };

  /** Each of `paths` that is a regular file in `cwd` now: its permission bits. */
  const modesOf = (cwd: string, paths: readonly string[]): Map<string, number> => {
    const modes = new Map<string, number>();
    for (const path of paths) {
      const stat = statOf(join(cwd, ...path.split('/')));
      if (stat?.isFile() === true) modes.set(path, stat.mode & 0o7777);
    }
    return modes;
  };

  /**
   * A write by `git apply` recreates a file with git's mode (and with `core.fileMode=false` none at all): each of
   * `paths` that is a regular file is set to the exact mode `modes` holds for it (a 0600 file stays so, a 0755
   * script stays runnable, a setuid bit is kept), best effort, never through a link.
   */
  const setModes = (cwd: string, paths: readonly string[], modes: ReadonlyMap<string, number>): void => {
    for (const path of paths) {
      const mode = modes.get(path);
      if (mode === undefined) continue;
      const file = join(cwd, ...path.split('/'));
      const stat = statOf(file);
      if (stat?.isFile() !== true || (stat.mode & 0o7777) === mode) continue;
      try {
        chmodSync(file, mode);
      } catch {
        // Best effort: the content moved either way.
      }
    }
  };

  /** `path` → `<mode> <object>` of a `ls-files --stage -z` (stage 0 only; a path with a conflict's stages is `conflicted`) or `ls-tree -r -z` listing. */
  const entriesOf = (out: string, staged: boolean): Map<string, string> => {
    const entries = new Map<string, string>();
    for (const record of out.split('\0')) {
      const tab = record.indexOf('\t');
      if (tab <= 0) continue;
      const fields = record.slice(0, tab).split(' ');
      const path = record.slice(tab + 1);
      if (staged) entries.set(path, fields[2] === '0' && entries.get(path) !== 'conflicted' ? `${fields[0]} ${fields[1]}` : 'conflicted');
      else entries.set(path, `${fields[0]} ${fields[2]}`);
    }
    return entries;
  };

  /**
   * Sets the located folder's index entries of `paths` back to its `HEAD`'s (removed when `HEAD` has none), so the
   * moved changes leave nothing staged: only an entry as the snapshot `snapshotTree` has it (what was staged was all
   * of it), never one that differs (a file partly staged keeps its staged version) or a conflict; and a path that
   * `HEAD` doesn't have and that is gone from the folder loses its entry whatever it holds (an intent-to-add one).
   * Only paths that left the folder are passed. In chunks, each exit checked; best effort.
   */
  const unstage = async (located: Located, store: string, snapshotTree: string, paths: readonly string[]): Promise<void> => {
    try {
      const storeRead = { ...located.env, GIT_ALTERNATE_OBJECT_DIRECTORIES: store };
      for (const chunk of inChunks(paths)) {
        const listed = (tree: string, env: Readonly<Record<string, string>>) =>
          must(located.cwd, [...located.flags, '--literal-pathspecs', 'ls-tree', '-r', '--full-tree', '-z', tree, '--', ...chunk], 'read the branch', 64 * 1024 * 1024, env);
        const index = entriesOf(await must(located.cwd, [...located.flags, '--literal-pathspecs', 'ls-files', '--stage', '-z', '--', ...chunk], 'read the index', 64 * 1024 * 1024, located.env), true);
        const snapshot = entriesOf(await listed(snapshotTree, storeRead), false);
        const head = entriesOf(await listed('HEAD', located.env), false);
        const lines: string[] = [];
        for (const path of chunk) {
          const entry = index.get(path);
          if (entry === undefined || entry === 'conflicted' || entry === head.get(path)) continue;
          const gone = head.get(path) === undefined && statOf(join(located.cwd, ...path.split('/'))) === undefined;
          if (!gone && entry !== snapshot.get(path)) continue;
          lines.push(`${head.get(path) ?? `0 ${NO_OBJECT}`}\t${path}`);
        }
        if (lines.length > 0) await must(located.cwd, [...located.flags, 'update-index', '-z', '--index-info'], 'unstage the changes', undefined, located.env, `${lines.join('\0')}\0`);
      }
    } catch {
      // Best effort: the changes moved; a staged entry left behind is only the index's.
    }
  };

  /**
   * Refuses a folder a hand-off can't move whole, before anything is snapshotted: a merge, rebase, cherry-pick or
   * revert in progress, or unmerged entries (the state would split from its resolution), and index entries marked
   * assume-unchanged or skip-worktree (their edits aren't snapshotted, so they'd be left out).
   */
  const refuseUnmovable = async (located: Located): Promise<void> => {
    const markers = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply'];
    const out = await must(located.cwd, [...located.flags, 'rev-parse', '--path-format=absolute', ...markers.flatMap((name) => ['--git-path', name])], 'read the repository', undefined, located.env);
    const paths = out.split(/\r?\n/).filter((line) => line !== '');
    if (paths.length !== markers.length) throw new VcsError("git couldn't read the repository, so nothing moved.", { step: 'move' });
    if (paths.some((path) => present(path))) throw new VcsError('A merge, rebase, cherry-pick or revert is in progress, so nothing moved. Finish or stop it first.', { step: 'move' });
    const unmerged = await must(located.cwd, [...located.flags, 'ls-files', '-u', '-z'], 'read the index', 64 * 1024 * 1024, located.env);
    if (unmerged !== '') throw new VcsError('Some files have unresolved conflicts, so nothing moved. Resolve them first.', { step: 'move' });
    const tagged = await must(located.cwd, [...located.flags, 'ls-files', '-v', '-z'], 'read the index', 256 * 1024 * 1024, located.env);
    for (const record of tagged.split('\0')) {
      const tag = record[0];
      if (tag === undefined || record[1] !== ' ') continue;
      if (tag === 'S' || tag !== tag.toUpperCase()) throw new VcsError('Some files are marked for git to skip or assume unchanged, so nothing moved.', { step: 'move' });
    }
  };

  /** The message of a move whose bytes git would change (line endings converted, a filter's work). */
  const BYTES_CHANGED = "git would change some changed files' bytes (their line endings), so nothing moved.";

  /**
   * Whether each of `blobs`' paths that is in the located folder now holds exactly that blob's bytes, read raw
   * (`hash-object --no-filters`, nothing written): the snapshot and the patch carry what git's clean step made, so a
   * conversion (`core.autocrlf`, a `text` or `eol` attribute) shows as a difference. Paths go on stdin.
   */
  const sameBytes = async (located: Located, blobs: ReadonlyMap<string, string>): Promise<boolean> => {
    const present = [...blobs.keys()].filter((path) => statOf(join(located.cwd, ...path.split('/')))?.isFile() === true);
    if (present.length === 0) return true;
    const out = await must(located.cwd, [...located.flags, 'hash-object', '--no-filters', '--stdin-paths'], 'read the changes', 64 * 1024 * 1024, located.env, `${present.join('\n')}\n`);
    const ids = out.split(/\r?\n/).filter((line) => line !== '');
    return ids.length === present.length && present.every((path, at) => ids[at] === blobs.get(path));
  };

  /** A failure of a hand-off with both snapshots (and `extra`) in its details, for the log: the store may hold the only copy. */
  const withSnapshots = (error: unknown, snapshots: { from: string; to: string }, extra: Readonly<Record<string, unknown>> = {}): VcsError =>
    error instanceof VcsError
      ? new VcsError(error.message, { ...error.details, ...extra, snapshots })
      : new VcsError("git couldn't move the changes.", { step: 'move', ...extra, snapshots });

  /** Hand off (27.4): see the file's header. */
  const moveChanges = async (repoPath: string, input: { from: VcsFolder; to: VcsFolder }): Promise<VcsMoveChanges> => {
    checkPath(repoPath);
    // A chat's copy is a real folder of its own, never a link to one.
    for (const folder of [input.from, input.to]) {
      if (folder.worktree !== undefined && !isRealFolder(folder.path)) throw new VcsError("The chat's copy isn't a folder of its own, so nothing moved.", { step: 'move' });
    }
    const source = await locate(input.from);
    const target = await locate(input.to);
    if (source === undefined || target === undefined) throw new VcsError('That folder is in no repository, so nothing moved.', { step: 'move' });
    if (source.common !== target.common || realOf(source.cwd) === realOf(target.cwd)) throw new VcsError("Those folders aren't two places of one repository, so nothing moved.", { step: 'move' });
    if (!(await atTop(source)) || !(await atTop(target))) throw new VcsError("A folder isn't its repository's top folder, so nothing moved.", { step: 'move' });
    await refuseUnmovable(source);
    await refuseUnmovable(target);
    const store = storeOf(source.common, true)!;
    // Both snapshotted before anything moves (AD-37's store): what either held is kept whatever happens next.
    const snapshots = { from: await snapshotOf(source), to: await snapshotOf(target) };
    let paths: string[] = [];
    let patch = '';
    let targetModes = new Map<string, number>();
    const blobs = new Map<string, string>();
    try {
      const sourceHead = await headTree(source);
      const targetHead = await headTree(target);
      const moved = await treeChanges(source, store, sourceHead, snapshots.from);
      for (const entry of moved) {
        checkRelative(entry.path);
        if (entry.oldMode === '160000' || entry.newMode === '160000') throw new VcsError('A submodule has changes, so nothing moved.', { step: 'move' });
        if (!plainPath(source.cwd, entry.path, true) || !plainPath(target.cwd, entry.path, false)) throw new VcsError("A changed file isn't a plain file, so nothing moved.", { step: 'move' });
      }
      paths = moved.map((entry) => entry.path);
      if (paths.length === 0) return { result: 'moved', files: 0, leftBehind: 0, snapshots };
      const own = new Set((await treeChanges(target, store, targetHead, snapshots.to)).map((entry) => entry.path));
      const overlap = paths.filter((path) => own.has(path)).length;
      if (overlap > 0) return { result: 'conflict', files: overlap, leftBehind: 0, snapshots };
      // Byte for byte: a moved file whose raw bytes aren't its snapshot blob would arrive changed.
      if (paths.some((path) => /[\n\r]/.test(path))) throw new VcsError("A changed file's name can't be moved, so nothing moved.", { step: 'move' });
      for (const entry of moved) if (!EMPTY_ID.test(entry.newId)) blobs.set(entry.path, entry.newId);
      if (!(await sameBytes(source, blobs))) throw new VcsError(BYTES_CHANGED, { step: 'move' });
      patch = await patchBetween(source, store, sourceHead, snapshots.from);
      // git's output is read as UTF-8: text in another encoding would arrive changed.
      if (patch.includes('\uFFFD')) throw new VcsError("A changed file isn't UTF-8 text, so nothing moved.", { step: 'move' });
      // Checked first, nothing written: one that doesn't apply there is a conflict over the files the two branches have differently.
      const checked = await run(target.cwd, [...target.flags, ...APPLY, '--check', '-'], 64 * 1024 * 1024, target.env, patch);
      if (checked.code !== 0) {
        const differ = new Set((await treeChanges(source, store, sourceHead, targetHead)).map((entry) => entry.path));
        return { result: 'conflict', files: Math.max(1, paths.filter((path) => differ.has(path)).length), leftBehind: 0, snapshots };
      }
      targetModes = modesOf(target.cwd, paths);
    } catch (error) {
      throw withSnapshots(error, snapshots);
    }
    const sourceModes = modesOf(source.cwd, paths);
    const movedPaths = new Set(paths);

    // Forward: `git apply` writes file by file, so one that fails partway (or times out) is reversed, and checked. Never
    // put back from the snapshot: that would overwrite whatever else wrote the target meanwhile.
    // An apply that wrote other bytes than the snapshot's (a conversion) counts as one that failed.
    const appliedAsIs = async (): Promise<boolean> => {
      if (!(await applyOnce(target, patch, { reverse: false, check: false }))) return false;
      try {
        return await sameBytes(target, blobs);
      } catch {
        return false;
      }
    };
    if (!(await appliedAsIs())) {
      let targetClean = false;
      try {
        if (await applyChecked(target, patch, true)) {
          setModes(target.cwd, paths, targetModes);
          targetClean = (await differingNow(target, store, snapshots.to, movedPaths)).size === 0;
        }
      } catch {
        targetClean = false;
      }
      throw withSnapshots(new VcsError("git couldn't write the changes there, so they stay where they were.", { step: 'move' }), snapshots, { targetClean });
    }
    setModes(target.cwd, paths, sourceModes);

    // Once the target applied it is never undone: the changes are safe there. The source is cleaned best effort and checked.
    await applyChecked(source, patch, true);
    // Each file the source keeps goes back to its own mode; where git tracks the executable bit, as git wrote it.
    const tracksExec = await run(source.cwd, [...source.flags, 'config', '--bool', '--get', 'core.fileMode'], undefined, source.env).then(
      (out) => !(out.code === 0 && out.stdout.trim() === 'false'),
      () => true,
    );
    const ownModes = new Map<string, number>();
    for (const [path, mode] of sourceModes) {
      const now = statOf(join(source.cwd, ...path.split('/')));
      if (now?.isFile() === true) ownModes.set(path, tracksExec ? (mode & ~0o111) | (now.mode & 0o111) : mode);
    }
    setModes(source.cwd, paths, ownModes);
    let left: ReadonlySet<string> = movedPaths;
    try {
      left = await differingNow(source, store, await headTree(source), movedPaths);
    } catch {
      // Unread: every moved path is counted as left behind, so nothing is removed as if clean.
    }
    // Only what left the source: its index and modes, a path left behind keeps both.
    const gone = paths.filter((path) => !left.has(path));
    await unstage(source, store, snapshots.from, gone);
    return { result: 'moved', files: paths.length, leftBehind: left.size, snapshots };
  };

  return {
    moveChanges,

    async applyHunk(folder, { target, action, path, hunkId, hunkIds }): Promise<VcsHunkResult> {
      checkRelative(path);
      if (!HUNK_ACTIONS_BY_VIEW[target.view].includes(action)) throw new VcsError("That view doesn't offer that action.", { step: 'apply' });
      const result = await withView(folder, target, async (located, spec): Promise<VcsHunkResult> => {
        // Stage and unstage write only the index, but a linked folder is refused for every action alike.
        if (!plainPath(located.cwd, path, action === 'revert')) return { outcome: 'unsupported' };
        const listing = await listed(located, spec, [path]);
        const file = listing.files.find((one) => one.path === path);
        if (file === undefined) return { outcome: 'outdated' };
        const modes = listing.modes.get(path);
        if (file.binary || file.tooLarge || modes === undefined || !modes.every((mode) => PLAIN_MODES.has(mode))) return { outcome: 'unsupported' };
        let patch: string;
        try {
          patch = await must(located.cwd, [...located.flags, ...DIFF, ...spec.args, '--', path], 'read the change', 4 * MAX_DIFF_FILE_BYTES, spec.env);
        } catch (error) {
          if (error instanceof VcsError && error.details.code === OUTPUT_TOO_LARGE) return { outcome: 'unsupported' };
          throw error;
        }
        if (Buffer.byteLength(patch, 'utf8') > MAX_DIFF_FILE_BYTES) return { outcome: 'unsupported' };
        const split = splitPatch(patch, path);
        if (split === undefined) return { outcome: 'unsupported' };
        let chosen: SplitPatch['hunks'];
        if (hunkId !== undefined) chosen = split.hunks.filter((hunk) => hunk.id === hunkId);
        else {
          // The whole file only as it was shown: every id it has now, and no other.
          const ids = new Set(hunkIds ?? []);
          if (ids.size !== split.hunks.length || split.hunks.some((hunk) => !ids.has(hunk.id))) return { outcome: 'outdated' };
          chosen = split.hunks;
        }
        if (chosen.length === 0) return { outcome: 'outdated' };
        // The turn's snapshots don't move with the folder: its lines must still be there, once.
        if (action === 'revert' && target.view === 'turn' && !onceInFolder(located, path, chosen)) return { outcome: 'outdated' };
        const built = `${[...split.header, ...chosen.flatMap((hunk) => hunk.lines)].join('\n')}\n`;
        if (!(await applyPatch(located, APPLY_FLAGS[action], built, path))) return { outcome: 'outdated' };
        return action === 'revert' ? { outcome: 'applied', undo: remember(folder, path, target.view, built, fileHash(located, path)) } : { outcome: 'applied' };
      });
      if (result === undefined) return { outcome: 'not_found' };
      return 'value' in result ? result.value : { outcome: 'outdated' };
    },

    async undoRevert(folder, { undo, path, view }): Promise<VcsHunkResult> {
      checkRelative(path);
      forgetOld();
      const kept = /^[0-9a-f]{32}$/.test(undo) ? undos.get(undo) : undefined;
      if (kept === undefined || kept.folder !== folderKey(folder) || kept.path !== path || (view !== undefined && kept.view !== view)) return { outcome: 'not_found' };
      const located = await locate(folder);
      if (located === undefined) return { outcome: 'not_found' };
      if (!plainPath(located.cwd, path, true)) return { outcome: 'unsupported' };
      // Only onto the file exactly as the revert left it: an edit anywhere since and nothing is put back.
      let same: boolean;
      try {
        same = fileHash(located, path) === kept.hash;
      } catch {
        same = false;
      }
      if (!same || !(await applyPatch(located, [], kept.patch, path))) return { outcome: 'outdated' };
      undos.delete(undo);
      return { outcome: 'applied' };
    },

    async changedFiles(folder, target): Promise<VcsChangedFiles> {
      let base: string | undefined;
      const result = await withView(folder, target, async (located, spec) => {
        base = spec.base;
        const { files, truncated } = await listed(located, spec, []);
        return { files, truncated };
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
      return internals.snapshotLocated(located);
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
