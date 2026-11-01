/**
 * The working-tree half of `vcs-memory` (AD-37; epic 8 entry 2): an
 * in-memory `VcsWorkingTreePort` for tests and the Changes lanes (8.4 and
 * 8.5 build it on git). It runs no git and touches no file. Each folder
 * (by its `path`) is a record of each view's changed files and their hunks; This turn's are
 * kept per `startTree..endTree`. Tests set the state (`folder(root)`),
 * mark hunks `outdated` or files `unsupported`, and read the calls. A hunk
 * action removes the hunk (or the whole file, when `hunkIds` are its ids)
 * from that view; staging moves it to Staged, unstaging to Unstaged; a
 * revert answers an undo id that puts the hunks back once. A commit
 * clears Unstaged and Staged and answers a new revision (`nothing` when
 * both were empty).
 */
import type { VcsChangesTarget, VcsFolder, VcsHunkResult, VcsWorkingTreePort } from '@ogden-agents/core';
import type { ChangedFile, DiffHunk } from '@ogden-agents/shared';

/** One changed file and its hunks. */
export interface MemoryChange {
  file: ChangedFile;
  hunks: DiffHunk[];
}

export interface MemoryFolder {
  unstaged: MemoryChange[];
  staged: MemoryChange[];
  branch: MemoryChange[];
  /** The base Branch compares with. */
  base: string;
  /** This turn's changes, by `startTree..endTree`. */
  turns: Map<string, MemoryChange[]>;
}

export interface MemoryVcsWorkingTree extends VcsWorkingTreePort {
  /** Always there in memory. */
  applyHunk: NonNullable<VcsWorkingTreePort['applyHunk']>;
  undoRevert: NonNullable<VcsWorkingTreePort['undoRevert']>;
  /** Every call as `method <folder path> …`, in order. */
  readonly calls: string[];
  /** The folder at `root`, created (no changes) if new. */
  folder(root: string): MemoryFolder;
  /** Hunk ids that answer `outdated`. */
  readonly outdated: Set<string>;
  /** Paths that answer `unsupported`. */
  readonly unsupported: Set<string>;
}

let objects = 0;
const nextObject = (): string => (++objects).toString(16).padStart(40, 'a');

const turnKey = (target: Extract<VcsChangesTarget, { view: 'turn' }>): string => `${target.startTree}..${target.endTree}`;

export function createMemoryVcsWorkingTree(): MemoryVcsWorkingTree {
  const calls: string[] = [];
  const folders = new Map<string, MemoryFolder>();
  const outdated = new Set<string>();
  const unsupported = new Set<string>();
  /** Each revert's undo: where, which file, and the hunks it took. */
  const undos = new Map<string, { root: string; target: VcsChangesTarget; change: MemoryChange; hunks: DiffHunk[] }>();
  let undoCount = 0;
  const folder = (root: string): MemoryFolder => {
    let found = folders.get(root);
    if (found === undefined) {
      found = { unstaged: [], staged: [], branch: [], base: 'main', turns: new Map() };
      folders.set(root, found);
    }
    return found;
  };
  const changesOf = (root: string, target: VcsChangesTarget): MemoryChange[] => {
    const state = folder(root);
    if (target.view !== 'turn') return state[target.view];
    let turn = state.turns.get(turnKey(target));
    if (turn === undefined) {
      turn = [];
      state.turns.set(turnKey(target), turn);
    }
    return turn;
  };
  /** The file's counts from its hunks. */
  const recount = (change: MemoryChange): void => {
    change.file = {
      ...change.file,
      additions: change.hunks.reduce((sum, hunk) => sum + hunk.lines.filter((line) => line.kind === 'add').length, 0),
      deletions: change.hunks.reduce((sum, hunk) => sum + hunk.lines.filter((line) => line.kind === 'remove').length, 0),
    };
  };
  return {
    calls,
    folder,
    outdated,
    unsupported,
    async changedFiles({ path: root }: VcsFolder, target) {
      calls.push(`changedFiles ${root} ${target.view}`);
      const files = changesOf(root, target).map((change) => change.file);
      return { ...(target.view === 'branch' ? { base: folder(root).base } : {}), files, truncated: false };
    },
    async fileDiff({ path: root }: VcsFolder, target, path) {
      calls.push(`fileDiff ${root} ${target.view} ${path}`);
      const change = changesOf(root, target).find((found) => found.file.path === path);
      return change === undefined ? undefined : { file: change.file, hunks: change.hunks };
    },
    async applyHunk({ path: root }: VcsFolder, { target, action, path, hunkId, hunkIds }): Promise<VcsHunkResult> {
      calls.push(`applyHunk ${root} ${target.view} ${action} ${path} ${hunkId ?? (hunkIds === undefined ? '*' : hunkIds.join(','))}`);
      if (unsupported.has(path)) return { outcome: 'unsupported' };
      const changes = changesOf(root, target);
      const index = changes.findIndex((found) => found.file.path === path);
      if (index === -1) return { outcome: 'outdated' };
      const change = changes[index]!;
      let taken: DiffHunk[];
      if (hunkId !== undefined) taken = change.hunks.filter((hunk) => hunk.id === hunkId);
      else {
        const ids = change.hunks.map((hunk) => hunk.id);
        // The whole file only as it was shown: the same ids, no more, no fewer.
        if (hunkIds === undefined || hunkIds.length !== ids.length || !ids.every((id) => hunkIds.includes(id))) return { outcome: 'outdated' };
        taken = change.hunks;
      }
      if (taken.length === 0 || taken.some((hunk) => outdated.has(hunk.id))) return { outcome: 'outdated' };
      change.hunks = change.hunks.filter((hunk) => !taken.includes(hunk));
      recount(change);
      if (change.hunks.length === 0) changes.splice(index, 1);
      const moveTo = action === 'stage' ? folder(root).staged : action === 'unstage' ? folder(root).unstaged : undefined;
      if (moveTo !== undefined) {
        const existing = moveTo.find((found) => found.file.path === path);
        if (existing === undefined) {
          const moved: MemoryChange = { file: change.file, hunks: [...taken] };
          recount(moved);
          moveTo.push(moved);
        } else {
          existing.hunks.push(...taken);
          recount(existing);
        }
        return { outcome: 'applied' };
      }
      const undo = (++undoCount).toString(16).padStart(32, '0');
      undos.set(undo, { root, target, change, hunks: [...taken] });
      return { outcome: 'applied', undo };
    },
    async undoRevert({ path: root }: VcsFolder, { undo, path, view }): Promise<VcsHunkResult> {
      calls.push(`undoRevert ${root} ${path}`);
      const kept = undos.get(undo);
      if (kept === undefined || kept.root !== root || kept.change.file.path !== path || (view !== undefined && view !== kept.target.view)) return { outcome: 'not_found' };
      if (kept.hunks.some((hunk) => outdated.has(hunk.id))) return { outcome: 'outdated' };
      undos.delete(undo);
      const changes = changesOf(root, kept.target);
      const existing = changes.find((found) => found.file.path === path);
      if (existing === undefined) {
        kept.change.hunks = [...kept.hunks];
        recount(kept.change);
        changes.push(kept.change);
      } else {
        existing.hunks.push(...kept.hunks);
        recount(existing);
      }
      return { outcome: 'applied' };
    },
    async snapshot({ path: root }: VcsFolder) {
      calls.push(`snapshot ${root}`);
      return nextObject();
    },
    async commitAll({ path: root }: VcsFolder, message) {
      calls.push(`commitAll ${root} ${message.length}`);
      const state = folder(root);
      const files = new Set([...state.unstaged, ...state.staged].map((change) => change.file.path)).size;
      if (files === 0) return 'nothing';
      state.unstaged = [];
      state.staged = [];
      return { revision: nextObject(), files };
    },
  };
}
