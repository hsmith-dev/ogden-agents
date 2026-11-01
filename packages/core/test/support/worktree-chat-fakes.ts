/**
 * Fakes shared by the worktree chat tests (27.3 Delete chat, 27.6
 * retention): an agent that answers at once or holds its turn, a fake git
 * (`addWorktree` makes the folder and the branch, `removeWorktree` removes
 * the folder), a fake working tree's uncommitted files, and retention's
 * git (27.6).
 */
import { mkdirSync, rmSync } from 'node:fs';
import { basename } from 'node:path';
import { VcsError, type AgentEvent, type AgentPort, type AgentSession, type ChatOptions, type RemoveWorktreeOptions, type StartAgentSession, type VcsChatWorktreePort, type VcsWorkingTreePort } from '../../src/index.js';

const REVISION = 'b'.repeat(40);

/** An agent that answers at once, or holds its turn until `release` when `hold` is set. */
export function agent() {
  let hold = false;
  /** The held turns, oldest first: `release` lets the oldest go. */
  const held: Array<() => void> = [];
  let closed = 0;
  let hangClose = false;
  let releaseClose: (() => void) | undefined;
  const cwds: string[] = [];
  const open = (input: StartAgentSession, agentSessionId: string): AgentSession => {
    cwds.push(input.cwd);
    const listeners = new Set<(event: AgentEvent) => void>();
    const emit = (event: AgentEvent) => {
      for (const listener of [...listeners]) listener(event);
    };
    return {
      agentSessionId,
      onEvent(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async prompt() {
        emit({ type: 'state', state: 'working' });
        if (hold)
          await new Promise<void>((resolve) => held.push(resolve));
        emit({ type: 'message_chunk', text: 'ok' });
        emit({ type: 'state', state: 'idle' });
        return { stopReason: 'end_turn' };
      },
      async cancel() {},
      async close() {
        closed++;
        if (hangClose)
          await new Promise<void>((resolve) => {
            releaseClose = () => {
              releaseClose = undefined;
              resolve();
            };
          });
      },
    };
  };
  let sessions = 0;
  const port: AgentPort = {
    displayName: 'Test Agent',
    skillInvocation: (skill) => `/${skill}`,
    listAuthMethods: async () => [],
    startSession: async (input) => open(input, `agent-${++sessions}`),
    reopenSession: async (input) => ({ session: open(input, input.agentSessionId), restored: 'resumed' as const }),
    terminalResume: {
      command: async (id, env) => ({ file: 'agent', args: ['--resume', id], env: { ...env } }),
      locate: async () => ({ found: true }),
      transcript: async () => [],
    },
  };
  return {
    port,
    cwds,
    closed: () => closed,
    holdTurns: () => (hold = true),
    release: () => held.shift()?.(),
    /** Whether a held turn waits for {@link release}. */
    holding: () => held.length > 0,
    /** Whether a held close waits for {@link releaseClose}. */
    closingHeld: () => releaseClose !== undefined,
    hangClose: () => (hangClose = true),
    releaseClose: () => releaseClose?.(),
  };
}

/** A fake git: `addWorktree` makes the folder and the branch; `removeWorktree` removes the folder (a link only unlinked) and, when asked and merged, the branch. */
export function fakeGit(repo: string) {
  const calls: string[] = [];
  const branches = new Set<string>();
  const unmerged = new Set<string>();
  let failRemoval = false;
  const vcs: NonNullable<ChatOptions['vcs']> = {
    topLevel: async () => repo,
    head: async () => ({ revision: REVISION, branch: 'main' }),
    async addWorktree(_repo, input) {
      calls.push(`addWorktree ${input.path} ${input.branch}`);
      mkdirSync(input.path);
      branches.add(input.branch);
    },
    async removeWorktree(_repo, path, options: RemoveWorktreeOptions = {}) {
      calls.push(`removeWorktree ${basename(path)}${options.deleteBranch === undefined ? '' : ` ${options.deleteBranch}${options.mergedOnly === true ? ' merged-only' : ''}${options.keepUnmerged === true ? ' keep-unmerged' : ''}`}`);
      if (failRemoval) throw new Error('a program has files open there');
      rmSync(path, { recursive: true, force: true });
      const branch = options.deleteBranch;
      if (branch === undefined) return { branchKept: false };
      if (options.mergedOnly === true && unmerged.has(branch)) return { branchKept: true };
      branches.delete(branch);
      return { branchKept: false };
    },
    async isMerged(_repo, branch) {
      calls.push(`isMerged ${branch}`);
      return !unmerged.has(branch);
    },
  };
  return { vcs, calls, branches, commitOn: (branch: string) => unmerged.add(branch), failRemoval: () => (failRemoval = true) };
}

/** A fake working tree: each folder's uncommitted files, or a throw (a copy whose state can't be read). */
export function fakeWorkingTree() {
  const dirty = new Map<string, string[]>();
  const unreadable = new Set<string>();
  const during: { read?: (() => Promise<void>) | undefined } = {};
  const port: Pick<VcsWorkingTreePort, 'changedFiles'> = {
    async changedFiles(folder, target) {
      const read = during.read;
      during.read = undefined;
      await read?.();
      if (unreadable.has(folder.path)) throw new Error('not a worktree of this repository');
      if (target.view !== 'unstaged') return { files: [], truncated: false };
      return { files: (dirty.get(folder.path) ?? []).map((path) => ({ path: path as never, change: 'added' as const, additions: 1, deletions: 0, binary: false, tooLarge: false })), truncated: false };
    },
  };
  return { port, dirty, unreadable, during };
}


/**
 * Retention's git (27.6), core's own fake (core depends on no adapter, even in a test; `vcs-memory`'s
 * `createMemoryVcsChatWorktree` is the adapters' twin): each folder's changed file names, saved under a new tree id,
 * brought back by Restore (in place when the folder is still known); branches gone, moved, paths taken and unsafe
 * copies are set by the test.
 */
export function fakeChatWorktree() {
  const calls: string[] = [];
  const folders = new Map<string, Set<string>>();
  const snapshots = new Map<string, Set<string>>();
  const missingBranches = new Set<string>();
  /** Branches whose new commit the saved changes apply on (`newer`); any other moved branch restores on the new branch. */
  const forwardBranches = new Set<string>();
  const heads = new Map<string, string>();
  const takenPaths = new Set<string>();
  const unsafe = new Set<string>();
  let trees = 0;
  const byContent = new Map<string, string>();
  /** How many saves ran, and what runs after each one reads the folder (a write racing the put-away). */
  const saves: { count: number; after?: ((path: string) => void) | undefined } = { count: 0 };
  const changes = (path: string): Set<string> => {
    let found = folders.get(path);
    if (found === undefined) folders.set(path, (found = new Set()));
    return found;
  };
  const headOf = (branch: string) => heads.get(branch) ?? 'b'.repeat(40);
  const port: VcsChatWorktreePort = {
    async saveForPutAway(repoPath, worktreePath, branch) {
      calls.push(`saveForPutAway ${repoPath} ${worktreePath} ${branch}`);
      if (unsafe.has(worktreePath)) throw new VcsError("This chat's copy can't be put away as it is.", { step: 'put_away' });
      saves.count++;
      const files = new Set(changes(worktreePath));
      saves.after?.(worktreePath);
      if (files.size === 0) return { snapshotTree: null, head: headOf(branch), files: 0 };
      // The same changes save as the same tree, as git's would.
      const key = [...files].sort().join('\0');
      let snapshotTree = byContent.get(key);
      if (snapshotTree === undefined) byContent.set(key, (snapshotTree = (++trees).toString(16).padStart(40, 'c')));
      snapshots.set(snapshotTree, files);
      return { snapshotTree, head: headOf(branch), files: files.size };
    },
    async restore(repoPath, { path, branch, head, snapshotTree, newBranch }) {
      calls.push(`restore ${repoPath} ${path} ${branch} ${snapshotTree ?? '-'}`);
      if (takenPaths.has(path)) return 'path_taken';
      const folder = changes(path);
      folder.clear();
      for (const file of snapshotTree === null ? [] : (snapshots.get(snapshotTree) ?? [])) folder.add(file);
      if (missingBranches.has(branch)) return { branch: newBranch, on: 'gone' as const };
      if (headOf(branch) !== head) return { branch: forwardBranches.has(branch) ? branch : newBranch, on: forwardBranches.has(branch) ? ('newer' as const) : ('moved' as const) };
      return { branch, on: 'saved' as const };
    },
    async moveChanges() {
      throw new VcsError('not here', { step: 'move' });
    },
  };
  return { ...port, calls, saves, changes, forget: (path: string) => void folders.delete(path), missingBranches, forwardBranches, heads, takenPaths, unsafe, snapshots };
}
