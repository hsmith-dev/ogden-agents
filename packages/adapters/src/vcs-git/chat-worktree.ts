/**
 * `vcs-git`'s chat-worktree half (CAP-35; epic 27, 27.6): saving a chat
 * worktree's uncommitted changes before retention puts it away, Restore, and
 * the snapshot store's cleanup, on the user's own `git` run as the working
 * tree runs it (`working-tree.ts`: no hook, no fsmonitor, every filter
 * driver blanked, no network, Ogden's pins for a worktree).
 *
 * Saving (`saveForPutAway`) refuses a copy that isn't a direct child of a
 * real `<data>/cw`, whose HEAD isn't its branch (the pin), with a merge,
 * rebase, cherry-pick or revert in progress, or whose snapshot holds a
 * gitlink (a submodule or a nested repository). The snapshot is AD-37's
 * (a temporary index in `<snapshots>/tmp`, objects written to the repo's
 * store in the data folder); then every object its changes need that the
 * store lacks (a blob the copy staged lives in the repo's own objects,
 * unreachable once the copy is gone) is copied into the store, read from
 * the repo and written with the store as git's only object folder, so the
 * repo's own objects, refs and index are never written. Nothing is removed
 * here: core removes the folder through `VcsPort.removeWorktree`.
 *
 * Restore checks the path (a copy of this branch still there is repaired in
 * place; anything else: `path_taken`) and the branch. When it moved since
 * the put-away or is gone (user decision 2026-11-01): a branch that only
 * moved forward gets the copy at its tip when the saved changes merge onto
 * it by git's trivial three-way rules (a temporary index, no merge driver);
 * otherwise the copy goes on a new branch (`newBranch`, `-2`, `-3` when
 * taken) made at the saved commit. Either attempt is all or nothing: one
 * that fails after making its copy removes it (and the branch it made)
 * before anything else is tried. In every case Restore replaces git's
 * record of a copy whose folder is gone, adds the worktree back on its
 * branch (`worktree add <path> <branch>`, never `-f`), writes the
 * snapshot's files through a temporary index (`read-tree`, then
 * `checkout-index`, filters blanked), deletes what the snapshot deleted,
 * and verifies the result with a fresh snapshot. The real index stays at
 * the branch's commit, so tracked edits come back unstaged.
 *
 * The cleanup (`pruneSnapshots`) only unlinks regular files and removes
 * empty folders under a real `<snapshots>`, never through a link: per
 * project, the loose objects no kept tree reaches (`rev-list --objects`)
 * and older than the grace; a store no project maps to, only when every
 * project's store was found; `tmp` files older than the grace. Packs are
 * left.
 *
 * Moving a chat's changes (`moveChanges`, 27.4) is the working tree's
 * (`working-tree.ts`), on the same git and store.
 */
import { existsSync, lstatSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, unlinkSync, utimesSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { isRealFolder, RUN_SHORT_ID, VcsError, type VcsChatWorktreePort, type VcsSnapshotPruned, type VcsSnapshotStorePort } from '@ogden-agents/core';
import { checkBranch, checkPath, realOf, REVISION } from './checks.js';
import { createGitWorkingTree, createWorkingTreeInternals, type GitWorkingTreeOptions, type Located } from './working-tree.js';

export interface GitChatWorktreeOptions extends GitWorkingTreeOptions {
  /** `<data>/cw`: only a direct child of it, a real folder, is saved or restored. */
  chatWorktreesRoot: string;
}

/** git's files of an operation in progress, in a worktree's own git folder. */
const OPERATIONS = ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'];
/** The most objects one copy into the store moves (pack-objects' output, bytes). */
const MAX_COPY_BYTES = 512 * 1024 * 1024;
/** A loose object's file name in its fan-out folder (sha1 or sha256). */
const LOOSE = /^(?:[0-9a-f]{38}|[0-9a-f]{62})$/;
/** A store folder's name in `<snapshots>`. */
const STORE_NAME = /^[0-9a-f]{16}$/;
const EMPTY_ID = /^0+$/;
/** The most entries a copy's folder walk reads before the copy is refused as too large to check. */
const MAX_WALK_ENTRIES = 500_000;

/** One `diff-tree --raw -z` record. */
interface RawChange {
  oldMode: string;
  newMode: string;
  newId: string;
  status: string;
  path: string;
}

function parseRaw(out: string): RawChange[] {
  const tokens = out.split('\0');
  const changes: RawChange[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const header = /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])\d*$/.exec(tokens[index]!);
    if (header === null) continue;
    const path = tokens[++index] ?? '';
    if (path !== '') changes.push({ oldMode: header[1]!, newMode: header[2]!, newId: header[4]!, status: header[5]!, path });
  }
  return changes;
}

export function createGitChatWorktree(options: GitChatWorktreeOptions): VcsChatWorktreePort & VcsSnapshotStorePort {
  const internals = createWorkingTreeInternals(options);
  const { runner, present, storeOf, storeFolderOf, tempIndex, storeEnv, locate, snapshotLocated } = internals;
  const { run, must } = runner;
  const now = options.now ?? Date.now;
  // The hand-off (27.4) moves changes with the working tree's own git and store.
  const workingTree = createGitWorkingTree(options);

  const refuse = (reason: string): never => {
    throw new VcsError("This chat's copy can't be put away as it is, so it was kept.", { step: 'put_away', reason });
  };

  /** Whether `path` is one of Ogden's chat worktree folders: a direct child `<cw>/<8>` of a real `<cw>`. */
  const ownPath = (path: string): boolean => {
    const root = options.chatWorktreesRoot;
    if (!isRealFolder(root) || !RUN_SHORT_ID.test(basename(path)) || realOf(dirname(path)) !== realOf(root)) return false;
    // Anything at the path itself must be a real folder: a link or junction to a worktree elsewhere never is the copy.
    return !present(path) || isRealFolder(path);
  };

  /**
   * Refuses (`nested_git`) a copy holding anything named `.git` (any case) below its own top-level `.git`: a nested
   * repository's history or files git never records would go with the folder unsaved. Never follows a link; a copy
   * past `MAX_WALK_ENTRIES` is refused (`too_large`).
   */
  const refuseNestedGit = (top: string): void => {
    let seen = 0;
    const walk = (dir: string, isTop: boolean): void => {
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch {
        return refuse('unreadable');
      }
      for (const name of names) {
        if (++seen > MAX_WALK_ENTRIES) refuse('too_large');
        if (name.toLowerCase() === '.git') {
          if (isTop && name === '.git') continue;
          refuse('nested_git');
        }
        const path = join(dir, name);
        let entry;
        try {
          entry = lstatSync(path);
        } catch {
          continue;
        }
        if (entry.isDirectory() && !entry.isSymbolicLink()) walk(path, false);
      }
    };
    walk(top, true);
  };

  /** The commit `refs/heads/<branch>` is at, or `undefined` when it is gone. */
  const branchTip = async (cwd: string, branch: string, env: Readonly<Record<string, string>>): Promise<string | undefined> => {
    const out = await run(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`], undefined, env);
    const id = out.stdout.trim();
    return out.code === 0 && REVISION.test(id) ? id : undefined;
  };

  const treeOf = async (located: Located, revision: string, env: Readonly<Record<string, string>>): Promise<string> => {
    const tree = (await must(located.cwd, [...located.flags, 'rev-parse', '--verify', `${revision}^{tree}`], 'read the branch', undefined, env)).trim();
    if (!REVISION.test(tree)) throw new VcsError("git couldn't read the branch.", { step: 'put_away' });
    return tree;
  };

  /** The ids of `ids` the store itself lacks (its alternates not counted). */
  const missingFromStore = async (located: Located, storeOnly: Readonly<Record<string, string>>, ids: readonly string[]): Promise<string[]> => {
    if (ids.length === 0) return [];
    const out = await must(located.cwd, ['cat-file', '--batch-check'], 'read the snapshot', 64 * 1024 * 1024, storeOnly, `${ids.join('\n')}\n`);
    return out
      .split('\n')
      .map((line) => /^([0-9a-f]+) missing$/.exec(line.trim())?.[1])
      .filter((id): id is string => id !== undefined);
  };

  /** Copies the objects the store lacks into it: read from the repo (and the store), written with the store as git's only object folder. */
  const copyIntoStore = async (located: Located, readEnv: Readonly<Record<string, string>>, storeOnly: Readonly<Record<string, string>>, ids: readonly string[]): Promise<void> => {
    const copy = async (wanted: readonly string[]): Promise<void> => {
      const missing = await missingFromStore(located, storeOnly, wanted);
      if (missing.length === 0) return;
      const packed = await runner.runBinary(located.cwd, ['pack-objects', '--stdout', '-q'], `${missing.join('\n')}\n`, readEnv, MAX_COPY_BYTES);
      if (packed === undefined || packed.code !== 0 || packed.stdout.length === 0) refuse('copy');
      const unpacked = await runner.runBinary(located.cwd, ['unpack-objects', '-q'], packed!.stdout, storeOnly, 1024 * 1024);
      if (unpacked === undefined || unpacked.code !== 0) refuse('copy');
    };
    await copy(ids);
    // Every needed object the store holds is freshened, so a cleanup that read its keep list before this copy's record
    // was written leaves it (the grace counts from now); one a cleanup removed meanwhile is copied again.
    const objects = storeOnly.GIT_OBJECT_DIRECTORY!;
    const at = new Date(now());
    const vanished: string[] = [];
    for (const id of ids) {
      try {
        utimesSync(join(objects, id.slice(0, 2), id.slice(2)), at, at);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') vanished.push(id);
      }
    }
    if (vanished.length > 0) await copy(vanished);
    if ((await missingFromStore(located, storeOnly, ids)).length > 0) refuse('copy');
  };

  /** Whether every folder on `path` (relative, `/`) is a real folder of `cwd` (one not there is fine). */
  const plainParents = (cwd: string, path: string): boolean => {
    const segments = path.split('/');
    for (let end = 1; end < segments.length; end++) {
      try {
        if (!isRealFolder(join(cwd, ...segments.slice(0, end))) && present(join(cwd, ...segments.slice(0, end)))) return false;
      } catch {
        return false;
      }
    }
    return true;
  };

  /**
   * Git's record of a copy whose folder is gone (a put-away whose record removal failed): the real folder
   * `<common>/worktrees/<name>` whose `gitdir` points back at `path`. Removed so `worktree add` takes the path again.
   */
  const dropStaleRecord = (common: string, path: string): void => {
    const records = join(common, 'worktrees');
    const record = join(records, basename(path));
    if (!isRealFolder(records) || !isRealFolder(record)) return;
    try {
      const gitdir = join(record, 'gitdir');
      if (!lstatSync(gitdir).isFile()) return;
      // A relative `gitdir` (`worktree.useRelativePaths`) is the record folder's; compared by real path of the parent, since the copy is gone.
      const text = readFileSync(gitdir, 'utf8').trim();
      const back = isAbsolute(text) ? resolve(text) : resolve(record, text);
      const realParent = (folder: string) => join(realOf(dirname(folder)), basename(folder));
      if (basename(back) !== '.git' || realParent(dirname(back)) !== realParent(path)) return;
      rmSync(record, { recursive: true, force: true });
    } catch {
      // Not provably this copy's: left, and `worktree add` says so.
    }
  };

  /**
   * Writes `target`'s files over the copy through a temporary index (filters blanked): a fresh copy gets those changed
   * from `from`, and what `target` doesn't have of `from` is deleted; a copy repaired in place (`inPlace`) gets only
   * the files missing from its folder, so nothing in it (an edit made after the snapshot) is overwritten or deleted.
   */
  const applyTree = async (located: Located, store: string, from: string, target: string, inPlace: boolean): Promise<void> => {
    const readEnv = { ...located.env, GIT_ALTERNATE_OBJECT_DIRECTORIES: store };
    const changed = inPlace ? [] : parseRaw(await must(located.cwd, [...located.flags, 'diff-tree', '-r', '-z', '--no-renames', '--no-abbrev', from, target], 'read the snapshot', 64 * 1024 * 1024, readEnv));
    const write = inPlace
      ? (await must(located.cwd, [...located.flags, 'ls-tree', '-r', '-z', '--name-only', '--full-tree', target], 'read the snapshot', 256 * 1024 * 1024, readEnv))
          .split('\0')
          .filter((path) => path !== '' && plainParents(located.cwd, path) && !present(join(located.cwd, ...path.split('/'))))
      : changed.filter((change) => change.status !== 'D').map((change) => change.path);
    if (write.length > 0) {
      const index = tempIndex(located);
      try {
        const env = { ...readEnv, GIT_INDEX_FILE: index.path };
        await must(located.cwd, [...located.flags, 'read-tree', target], 'restore the copy', undefined, env);
        await must(located.cwd, [...located.flags, 'checkout-index', '-f', '-z', '--stdin'], 'restore the copy', undefined, env, `${write.join('\0')}\0`);
      } finally {
        index.remove();
      }
    }
    for (const change of changed) {
      if (change.status !== 'D' || !plainParents(located.cwd, change.path)) continue;
      const file = join(located.cwd, ...change.path.split('/'));
      try {
        const entry = lstatSync(file);
        if (entry.isFile() || entry.isSymbolicLink()) unlinkSync(file);
      } catch {
        // Already gone.
      }
    }
  };

  /** Removes the regular files older than `cutoff` under `folder` (never through a link), then its empty folders; how many files went. */
  const removeOld = (folder: string, cutoff: number): number => {
    let removed = 0;
    let names: string[];
    try {
      names = readdirSync(folder);
    } catch {
      return 0;
    }
    for (const name of names) {
      const path = join(folder, name);
      let entry;
      try {
        entry = lstatSync(path);
      } catch {
        continue;
      }
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        removed += removeOld(path, cutoff);
        try {
          rmdirSync(path);
        } catch {
          // Not empty.
        }
      } else if (entry.isFile() && entry.mtimeMs < cutoff) {
        try {
          unlinkSync(path);
          removed++;
        } catch {
          // Left.
        }
      }
    }
    return removed;
  };

  /**
   * The branch unchanged since the put-away: the copy back on it at its commit, fresh, or repaired in place when a
   * copy of this branch is still there (half put away). `false` when something else is at the path.
   */
  const restoreOnBranch = async (repoPath: string, project: Located, store: string | undefined, path: string, branch: string, tip: string, snapshotTree: string | null): Promise<boolean> => {
    let inPlace = false;
    if (present(path)) {
      if (!isRealFolder(path)) return false;
      // Half put away: a copy of this branch still there is repaired in place; anything else is in the way.
      try {
        await runner.pinnedWorktree(repoPath, path, branch);
        inPlace = true;
      } catch {
        return false;
      }
    } else {
      dropStaleRecord(project.common, path);
      await must(project.cwd, [...project.flags, 'worktree', 'add', path, branch], 'restore the copy', undefined, project.env);
    }
    const located = await locate({ path, worktree: { repoPath, branch } });
    if (located === undefined) throw new VcsError("git couldn't restore the copy.", { step: 'restore' });
    const tipTree = await treeOf(located, tip, located.env);
    const target = snapshotTree ?? tipTree;
    if (inPlace || target !== tipTree) await applyTree(located, store ?? storeOf(located.common, true)!, tipTree, target, inPlace);
    // Verified: a fresh copy is the snapshot again (the branch's commit, for a copy saved clean). A copy repaired in place
    // may hold newer work of its own, so it isn't compared; a fresh one that fails is repaired in place next time.
    if (!inPlace && (await snapshotLocated(located)) !== target) throw new VcsError("The restored copy isn't the one saved.", { step: 'restore' });
    return true;
  };

  /**
   * The saved changes (`theirs`, over `base`) merged onto the branch's newer commit (`ours`) in a temporary index,
   * only where git's trivial three-way rules settle every path (no content merge, so no merge driver runs): the
   * merged tree, written to the store, or `undefined` when any path conflicts.
   */
  const mergedOnto = async (project: Located, store: string, base: string, ours: string, theirs: string): Promise<string | undefined> => {
    const index = tempIndex(project);
    try {
      const env = storeEnv(project, store, index.path);
      await must(project.cwd, [...project.flags, 'read-tree', '--empty'], 'restore the copy', undefined, env);
      const read = await run(project.cwd, [...project.flags, 'read-tree', '-m', '-i', '--aggressive', base, ours, theirs], undefined, env);
      if (read.code !== 0) return undefined;
      const unmerged = await must(project.cwd, [...project.flags, 'ls-files', '-u', '-z'], 'restore the copy', 64 * 1024 * 1024, env);
      if (unmerged !== '') return undefined;
      const tree = (await must(project.cwd, [...project.flags, 'write-tree'], 'restore the copy', undefined, env)).trim();
      return REVISION.test(tree) ? tree : undefined;
    } finally {
      index.remove();
    }
  };

  /** `base`, else `base-2`, `base-3`, …: the first name no branch has. */
  const freeBranch = async (project: Located, base: string): Promise<string> => {
    for (let n = 1; n <= 100; n++) {
      const name = checkBranch(n === 1 ? base : `${base}-${n}`);
      const found = await run(project.cwd, [...project.flags, 'rev-parse', '--verify', '--quiet', `refs/heads/${name}`], undefined, project.env);
      if (found.code !== 0) return name;
    }
    throw new VcsError('Every name for a restored branch is taken.', { step: 'restore' });
  };

  /**
   * A fresh copy at `path` made by `add` (`worktree add …`), then `target`'s files written over `from`'s and checked
   * by a fresh snapshot. All or nothing: a failure after the copy was made removes it (only Ogden's files from the
   * snapshot and the commit are in it, both kept) and the branch `created` it made, so the folder and refs are as
   * before; `false` then. A failure to undo throws.
   */
  const freshCopy = async (repoPath: string, project: Located, store: string | undefined, path: string, add: readonly string[], from: string, target: string, created: { name: string; at: string } | undefined): Promise<boolean> => {
    dropStaleRecord(project.common, path);
    const made = await run(project.cwd, [...project.flags, ...add], undefined, project.env);
    if (made.code !== 0) {
      // git undoes a failed add itself; anything it left at the path isn't provably Ogden's to remove.
      if (present(path)) throw new VcsError("git couldn't restore the copy.", { step: 'restore' });
      if (created !== undefined) await dropCreatedBranch(project, created);
      return false;
    }
    try {
      const located = await locate({ path, worktree: { repoPath, branch: created?.name ?? branchOf(add) } });
      if (located === undefined) throw new VcsError("git couldn't restore the copy.", { step: 'restore' });
      if (target !== from) await applyTree(located, store ?? storeOf(located.common, true)!, from, target, false);
      if ((await snapshotLocated(located)) !== target) throw new VcsError("The restored copy isn't the one saved.", { step: 'restore' });
      return true;
    } catch {
      const removed = await run(project.cwd, [...project.flags, 'worktree', 'remove', '--force', path], undefined, project.env);
      if (removed.code !== 0 || present(path)) throw new VcsError("git couldn't undo a restore that failed partway.", { step: 'restore' });
      if (created !== undefined) await dropCreatedBranch(project, created);
      return false;
    }
  };

  /** Deletes the branch a failed Restore made, only while it is still at the commit it was made at. */
  const dropCreatedBranch = async (project: Located, created: { name: string; at: string }): Promise<void> => {
    const tip = await branchTip(project.cwd, created.name, project.env);
    if (tip === undefined) return;
    if (tip !== created.at) throw new VcsError("git couldn't undo a restore that failed partway.", { step: 'restore' });
    await must(project.cwd, [...project.flags, 'update-ref', '-d', `refs/heads/${created.name}`, created.at], 'undo the restore', undefined, project.env);
  };

  /** The branch a `worktree add <path> <branch>` checks out. */
  const branchOf = (add: readonly string[]): string => add[add.length - 1]!;

  return {
    async saveForPutAway(repoPath, worktreePath, branch) {
      checkPath(repoPath);
      checkPath(worktreePath);
      checkBranch(branch);
      if (!ownPath(worktreePath)) refuse('outside_data');
      let located: Located | undefined;
      try {
        // The pin: the copy's own git files must still name the repo and this branch (a detached HEAD is refused here).
        located = await locate({ path: worktreePath, worktree: { repoPath, branch } });
      } catch {
        refuse('head');
      }
      if (located === undefined) return refuse('head');
      const gitDir = located.env.GIT_DIR;
      if (gitDir === undefined || OPERATIONS.some((name) => present(join(gitDir, name)))) refuse('operation');
      // Files git never records (a nested repository, `.git` folders or files below the top) would go unsaved.
      refuseNestedGit(located.cwd);
      // An entry the index hides (assume-unchanged, skip-worktree) keeps its edits out of the snapshot.
      const flagged = await must(located.cwd, [...located.flags, 'ls-files', '-v', '-z'], 'read the index', 256 * 1024 * 1024, located.env);
      if (flagged.split('\0').some((entry) => entry !== '' && (entry[0] === 'S' || /^[a-z]/.test(entry)))) refuse('index_flags');
      // A path staged one way and changed again in the folder: its staged version would be lost.
      const diffNames = async (cached: boolean) =>
        new Set((await must(located.cwd, [...located.flags, 'diff', ...(cached ? ['--cached'] : []), '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z'], 'read the changes', 64 * 1024 * 1024, located.env)).split('\0').filter((name) => name !== ''));
      const staged = await diffNames(true);
      if (staged.size > 0) {
        const unstaged = await diffNames(false);
        if ([...staged].some((name) => unstaged.has(name))) refuse('partly_staged');
      }
      const head = await branchTip(located.cwd, branch, located.env);
      if (head === undefined) refuse('head');
      const headTree = await treeOf(located, head!, located.env);
      const tree = await snapshotLocated(located);
      const store = storeOf(located.common, false);
      if (store === undefined) refuse('store');
      const readEnv = { ...located.env, GIT_ALTERNATE_OBJECT_DIRECTORIES: store! };
      // A submodule or a nested repository is a gitlink: its own changes would never come back.
      const listing = await must(located.cwd, [...located.flags, 'ls-tree', '-r', '-z', '--full-tree', tree], 'read the snapshot', 256 * 1024 * 1024, readEnv);
      if (listing.split('\0').some((record) => record.startsWith('160000 '))) refuse('gitlink');
      if (tree === headTree) return { snapshotTree: null, head: head!, files: 0 };
      const changes = parseRaw(await must(located.cwd, [...located.flags, 'diff-tree', '-r', '-t', '-z', '--no-renames', '--no-abbrev', headTree, tree], 'read the snapshot', 64 * 1024 * 1024, readEnv));
      const files = changes.filter((change) => change.newMode !== '040000' && change.oldMode !== '040000').length;
      const needed = [...new Set([tree, ...changes.map((change) => change.newId).filter((id) => !EMPTY_ID.test(id))])];
      await copyIntoStore(located, readEnv, { ...located.env, GIT_OBJECT_DIRECTORY: store!, GIT_ALTERNATE_OBJECT_DIRECTORIES: '' }, needed);
      return { snapshotTree: tree, head: head!, files };
    },

    async restore(repoPath, { path, branch, head, snapshotTree, newBranch }) {
      checkPath(repoPath);
      checkPath(path);
      checkBranch(branch);
      checkBranch(newBranch);
      if (!REVISION.test(head)) throw new VcsError('That is not a commit Ogden Agents can use.', { step: 'restore' });
      if (snapshotTree !== null && !REVISION.test(snapshotTree)) throw new VcsError('That is not a snapshot Ogden Agents can use.', { step: 'restore' });
      if (!ownPath(path)) return 'path_taken';
      const project = await locate({ path: repoPath });
      if (project === undefined) throw new VcsError("git couldn't read the repository.", { step: 'restore' });
      const tip = await branchTip(project.cwd, branch, project.env);
      const store = storeOf(project.common, false);
      if (snapshotTree !== null) {
        if (store === undefined) throw new VcsError("This copy's saved changes are gone.", { step: 'restore' });
        const found = await run(project.cwd, ['cat-file', '-t', snapshotTree], undefined, { ...project.env, GIT_ALTERNATE_OBJECT_DIRECTORIES: store });
        if (found.code !== 0 || found.stdout.trim() !== 'tree') throw new VcsError("This copy's saved changes are gone.", { step: 'restore' });
      }
      if (tip === head) {
        if (!(await restoreOnBranch(repoPath, project, store, path, branch, tip, snapshotTree))) return 'path_taken';
        return { branch, on: 'saved' };
      }
      // The branch moved or is gone (user decision 2026-11-01). Nothing is ever at the path here: a copy still there
      // (half put away) is on the branch's old commit and isn't touched.
      if (present(path)) return 'path_taken';
      const headFound = await run(project.cwd, [...project.flags, 'cat-file', '-e', `${head}^{commit}`], undefined, project.env);
      if (headFound.code !== 0) throw new VcsError("The commit this copy was saved on is gone.", { step: 'restore' });
      if (tip !== undefined) {
        // Only forward (the saved commit is an ancestor of the tip), and only when the saved changes apply without a conflict.
        const forward = await run(project.cwd, [...project.flags, 'merge-base', '--is-ancestor', head, tip], undefined, project.env);
        if (forward.code === 0) {
          const headTree = await treeOf(project, head, project.env);
          const tipTree = await treeOf(project, tip, project.env);
          const merged = snapshotTree === null ? tipTree : await mergedOnto(project, store!, headTree, tipTree, snapshotTree);
          if (merged !== undefined && (await freshCopy(repoPath, project, store, path, ['worktree', 'add', path, branch], tipTree, merged, undefined))) return { branch, on: 'newer' };
        } else if (forward.code !== 1) throw new VcsError("git couldn't read the branch.", { step: 'restore' });
      }
      // A new branch at the saved commit, so nothing on the branch (or anything saved) is overwritten.
      const name = await freeBranch(project, newBranch);
      const headTree = await treeOf(project, head, project.env);
      const target = snapshotTree ?? headTree;
      if (!(await freshCopy(repoPath, project, store, path, ['worktree', 'add', '-b', name, path, head], headTree, target, { name, at: head }))) {
        throw new VcsError("git couldn't restore the copy.", { step: 'restore' });
      }
      return { branch: name, on: tip === undefined ? 'gone' : 'moved' };
    },

    moveChanges(repoPath, input) {
      return workingTree.moveChanges(repoPath, input);
    },

    async pruneSnapshots(entries, { olderThanMs, protect = [] }): Promise<VcsSnapshotPruned> {
      const pruned: VcsSnapshotPruned = { objects: 0, stores: 0, temporary: 0, refused: 0 };
      const root = options.snapshotsRoot;
      if (!present(root)) return pruned;
      // Never through a link: a snapshots folder that isn't a real folder is left whole.
      if (!isRealFolder(root)) {
        pruned.refused++;
        return pruned;
      }
      const cutoff = now() - olderThanMs;
      // One store per repository, whatever number of projects share it: their keep lists joined, all kept when any is busy.
      const stores = new Map<string, { project: Located; keep: Set<string> | null }>();
      let everyMapped = true;
      for (const entry of entries) {
        // A folder that is there and readable but in no repository maps to no store; one missing or unreadable can't be mapped.
        let readable: boolean;
        try {
          readable = existsSync(entry.folder) && statSync(entry.folder).isDirectory() && (readdirSync(entry.folder), true);
        } catch {
          readable = false;
        }
        let project: Located | undefined;
        try {
          project = readable ? await locate({ path: entry.folder }) : undefined;
        } catch {
          readable = false;
        }
        if (!readable) {
          everyMapped = false;
          pruned.refused++;
          continue;
        }
        if (project === undefined) continue;
        const folder = storeFolderOf(project.common);
        const found = stores.get(folder);
        if (found === undefined) stores.set(folder, { project, keep: entry.keep === null ? null : new Set(entry.keep) });
        else if (found.keep !== null) {
          if (entry.keep === null) found.keep = null;
          else for (const tree of entry.keep) found.keep.add(tree);
        }
      }
      for (const [folder, { project, keep }] of stores) {
        if (keep === null || !present(folder)) continue;
        const objects = join(folder, 'objects');
        if (!isRealFolder(folder) || !isRealFolder(objects) || present(join(objects, 'info', 'alternates'))) {
          pruned.refused++;
          continue;
        }
        const env = { ...project.env, GIT_ALTERNATE_OBJECT_DIRECTORIES: objects };
        // The kept trees that still exist, and everything they reach.
        const wanted = [...keep].filter((tree) => REVISION.test(tree));
        let kept: string[] = [];
        if (wanted.length > 0) {
          const out = await run(project.cwd, ['cat-file', '--batch-check'], 64 * 1024 * 1024, env, `${wanted.join('\n')}\n`);
          if (out.code !== 0) continue;
          kept = out.stdout
            .split('\n')
            .map((line) => /^([0-9a-f]+) tree \d+$/.exec(line.trim())?.[1])
            .filter((id): id is string => id !== undefined);
        }
        const reachable = new Set<string>();
        if (kept.length > 0) {
          const out = await run(project.cwd, ['rev-list', '--objects', '--stdin'], 512 * 1024 * 1024, env, `${kept.join('\n')}\n`);
          // Anything unclear keeps the whole store this time.
          if (out.code !== 0) continue;
          for (const line of out.stdout.split('\n')) {
            const id = line.split(' ')[0]?.trim();
            if (id !== undefined && id !== '') reachable.add(id);
          }
        }
        let fanouts: string[];
        try {
          fanouts = readdirSync(objects).filter((name) => /^[0-9a-f]{2}$/.test(name));
        } catch {
          continue;
        }
        for (const fanout of fanouts) {
          const dir = join(objects, fanout);
          if (!isRealFolder(dir)) continue;
          let names: string[];
          try {
            names = readdirSync(dir);
          } catch {
            continue;
          }
          for (const name of names) {
            if (!LOOSE.test(name) || reachable.has(`${fanout}${name}`)) continue;
            const file = join(dir, name);
            try {
              const entry = lstatSync(file);
              if (!entry.isFile() || entry.mtimeMs >= cutoff) continue;
              unlinkSync(file);
              pruned.objects++;
            } catch {
              // Left.
            }
          }
          try {
            rmdirSync(dir);
          } catch {
            // Not empty.
          }
        }
      }
      // A store no project maps to (a project's whole history deleted, a repo gone): only when every project was read,
      // and never one holding a put-away copy's tree (its repo may only have moved).
      if (everyMapped) {
        const mapped = new Set([...stores.keys()].map((folder) => basename(folder)));
        const protectedTrees = protect.filter((tree) => REVISION.test(tree));
        let names: string[];
        try {
          names = readdirSync(root);
        } catch {
          names = [];
        }
        for (const name of names) {
          if (!STORE_NAME.test(name) || mapped.has(name)) continue;
          const folder = join(root, name);
          if (!isRealFolder(folder)) {
            pruned.refused++;
            continue;
          }
          if (protectedTrees.some((tree) => present(join(folder, 'objects', tree.slice(0, 2), tree.slice(2))))) continue;
          removeOld(folder, cutoff);
          try {
            rmdirSync(folder);
            pruned.stores++;
          } catch {
            // Something young (or a link) is still in it.
          }
        }
      }
      const tmp = join(root, 'tmp');
      if (isRealFolder(tmp)) {
        for (const name of readdirSync(tmp)) {
          const file = join(tmp, name);
          try {
            // By its change time: a temporary index keeps the real index's modified time (`tempIndex`), so it would look old mid-snapshot.
            const entry = lstatSync(file);
            if (!entry.isFile() || entry.ctimeMs >= cutoff) continue;
            unlinkSync(file);
            pruned.temporary++;
          } catch {
            // Left.
          }
        }
      }
      return pruned;
    },
  };
}
