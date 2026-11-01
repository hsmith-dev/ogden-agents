/**
 * The working-tree half of `vcs-memory` (AD-37; epic 8 entry 2): an
 * in-memory `VcsWorkingTreePort` for tests and the Changes lanes (8.4 and
 * 8.5 build it on git). It runs no git and touches no file. Each folder is
 * a record of each view's changed files and their hunks; This turn's are
 * kept per `startTree..endTree`. Tests set the state (`folder(root)`),
 * mark hunks `outdated`, and read the calls. A hunk action removes the hunk
 * (or the whole file) from that view; staging moves it to Staged. A commit
 * clears Unstaged and Staged and answers a new revision.
 */
import type { VcsChangesTarget, VcsHunkResult, VcsWorkingTreePort } from '@ogden-agents/core';
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
  /** Every call as `method root …`, in order. */
  readonly calls: string[];
  /** The folder at `root`, created (no changes) if new. */
  folder(root: string): MemoryFolder;
  /** Hunk ids that answer `outdated`. */
  readonly outdated: Set<string>;
}

let objects = 0;
const nextObject = (): string => (++objects).toString(16).padStart(40, 'a');

const turnKey = (target: Extract<VcsChangesTarget, { view: 'turn' }>): string => `${target.startTree}..${target.endTree}`;

export function createMemoryVcsWorkingTree(): MemoryVcsWorkingTree {
  const calls: string[] = [];
  const folders = new Map<string, MemoryFolder>();
  const outdated = new Set<string>();
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
    async changedFiles(root, target) {
      calls.push(`changedFiles ${root} ${target.view}`);
      const files = changesOf(root, target).map((change) => change.file);
      return { ...(target.view === 'branch' ? { base: folder(root).base } : {}), files, truncated: false };
    },
    async fileDiff(root, target, path) {
      calls.push(`fileDiff ${root} ${target.view} ${path}`);
      const change = changesOf(root, target).find((found) => found.file.path === path);
      return change === undefined ? undefined : { file: change.file, hunks: change.hunks };
    },
    async applyHunk(root, { target, action, path, hunkId }): Promise<VcsHunkResult> {
      calls.push(`applyHunk ${root} ${target.view} ${action} ${path} ${hunkId ?? '*'}`);
      const changes = changesOf(root, target);
      const index = changes.findIndex((found) => found.file.path === path);
      if (index === -1) return 'not_found';
      const change = changes[index]!;
      const taken = hunkId === undefined ? change.hunks : change.hunks.filter((hunk) => hunk.id === hunkId);
      if (taken.length === 0) return 'not_found';
      if (taken.some((hunk) => outdated.has(hunk.id))) return 'outdated';
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
      }
      return 'applied';
    },
    async snapshot(root) {
      calls.push(`snapshot ${root}`);
      return nextObject();
    },
    async commitAll(root, message) {
      calls.push(`commitAll ${root} ${message.length}`);
      const state = folder(root);
      const files = new Set([...state.unstaged, ...state.staged].map((change) => change.file.path)).size;
      state.unstaged = [];
      state.staged = [];
      return { revision: nextObject(), files };
    },
  };
}
