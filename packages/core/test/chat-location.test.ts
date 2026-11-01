/**
 * Hand off between this folder and the chat's own worktree (epic 27, 27.4;
 * CAP-35): the started chat moves with every uncommitted change of the
 * folder it leaves, all or nothing, recorded as `session.location_changed`;
 * its agent is released first and starts next in the new folder. Refused
 * mid-turn (this chat or any local chat in the project folder), on a
 * conflict, and for a chat that can't move; a failure once a copy was made
 * removes it. Git is a fake here; the real one is
 * `vcs-git-move-changes.test.ts`'s and the server's tests'.
 */
import { existsSync, mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import { chatWorktreeBranch, HANDOFF_PUT_AWAY_TEXT, IGNORED_FILES_SHOWN, restoredChatWorktreeBranch, type CoreEvent, type SessionId, type SessionLocationChangedEvent } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/database.js';
import {
  AgentMidTurnError,
  createChat,
  createChatLocations,
  HandOffConflictError,
  InvalidOperationError,
  NotFoundError,
  SessionNotIdleError,
  ValidationError,
  VcsError,
  WorktreePutAwayError,
  type AgentEvent,
  type AgentPort,
  type AgentSession,
  type ChatOptions,
  type Entities,
  type RemoveWorktreeOptions,
  type StartAgentSession,
  type VcsChatWorktreePort,
  type VcsWorkingTreePort,
} from '../src/index.js';
import { openTestCore, soleAgent, tempDir } from './helpers.js';

const REVISION = 'b'.repeat(40);

/** An agent that answers at once, or holds its turn until `release` when `hold` is set; it records each start's cwd and whether it reopened. */
function agent() {
  let hold = false;
  let release: (() => void) | undefined;
  const starts: { cwd: string; reopened: boolean }[] = [];
  const open = (input: StartAgentSession, agentSessionId: string, reopened: boolean): AgentSession => {
    starts.push({ cwd: input.cwd, reopened });
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
        if (hold) await new Promise<void>((resolve) => (release = resolve));
        emit({ type: 'message_chunk', text: 'ok' });
        emit({ type: 'state', state: 'idle' });
        return { stopReason: 'end_turn' };
      },
      async cancel() {},
      async close() {},
    };
  };
  let sessions = 0;
  const port: AgentPort = {
    displayName: 'Test Agent',
    skillInvocation: (skill) => `/${skill}`,
    listAuthMethods: async () => [],
    startSession: async (input) => open(input, `agent-${++sessions}`, false),
    reopenSession: async (input) => ({ session: open(input, input.agentSessionId, true), restored: 'resumed' as const }),
  };
  return { port, starts, holdTurns: () => (hold = true), release: () => release?.() };
}

/**
 * A fake git: `addWorktree` makes the folder (a new branch, or the kept one); `removeWorktree` removes it and,
 * when asked and merged, the branch. The mover keeps each folder's changed file names; a conflict is a name in both.
 */
function fakeGit(repo: string) {
  const calls: string[] = [];
  const branches = new Set<string>();
  const unmerged = new Set<string>();
  const vcs: NonNullable<ChatOptions['vcs']> = {
    topLevel: async () => repo,
    head: async () => ({ revision: REVISION, branch: 'main' }),
    async branchRevision(_repo, branch) {
      return branches.has(branch) ? REVISION : undefined;
    },
    async addWorktree(_repo, input) {
      calls.push(`addWorktree ${input.branch}${input.existingBranch === true ? ' existing' : ''}`);
      if (input.existingBranch !== true && branches.has(input.branch)) throw new VcsError("git couldn't add the worktree.");
      mkdirSync(input.path);
      branches.add(input.branch);
    },
    async removeWorktree(_repo, path, options: RemoveWorktreeOptions = {}) {
      calls.push(`removeWorktree ${basename(path)}${options.deleteBranch === undefined ? '' : ` ${options.deleteBranch}${options.mergedOnly === true ? ' merged-only' : ''}`}`);
      rmSync(path, { recursive: true, force: true });
      folders.delete(path);
      const branch = options.deleteBranch;
      if (branch === undefined) return { branchKept: false };
      if (options.mergedOnly === true && unmerged.has(branch)) return { branchKept: true };
      branches.delete(branch);
      return { branchKept: false };
    },
    async isMerged(_repo, branch) {
      return !unmerged.has(branch);
    },
  };
  const folders = new Map<string, Set<string>>();
  const changes = (path: string): Set<string> => {
    let found = folders.get(path);
    if (found === undefined) folders.set(path, (found = new Set()));
    return found;
  };
  /** Folders a move from throws for, with the `targetClean` it reports (absent: none). */
  const failing = new Map<string, boolean | undefined>();
  const conflicts = new Set<string>();
  /** Folders a move from can't clean: the changes are in both (`leftBehind`). */
  const leaving = new Set<string>();
  const moves: string[] = [];
  /** Set to hold every move until it resolves. */
  const gate: { wait?: Promise<void> | undefined } = {};
  const mover: Pick<VcsChatWorktreePort, 'moveChanges' | 'saveForPutAway' | 'restore'> = {
    // Retention is 27.6's: never reached by a hand-off.
    saveForPutAway: async () => {
      throw new Error('not a hand-off call');
    },
    restore: async () => {
      throw new Error('not a hand-off call');
    },
    async moveChanges(_repo, { from, to }) {
      moves.push(`${from.path === repo ? 'project' : 'copy'} > ${to.path === repo ? 'project' : 'copy'}${to.worktree === undefined ? '' : ` ${to.worktree.branch}`}`);
      await gate.wait;
      const snapshots = { from: 'f'.repeat(40), to: 'e'.repeat(40) };
      if (failing.has(from.path)) {
        const targetClean = failing.get(from.path);
        throw new VcsError("git couldn't write the changes there, so they stay where they were.", { snapshots, ...(targetClean === undefined ? {} : { targetClean }) });
      }
      const moving = changes(from.path);
      const target = changes(to.path);
      // A base that moved: the patch doesn't apply there.
      if ([...moving].some((file) => conflicts.has(file))) return { result: 'conflict', files: 1, leftBehind: 0, snapshots };
      const clashes = [...moving].filter((file) => target.has(file)).length;
      if (clashes > 0) return { result: 'conflict', files: clashes, leftBehind: 0, snapshots };
      const files = moving.size;
      for (const file of moving) target.add(file);
      const leftBehind = leaving.has(from.path) ? files : 0;
      if (leftBehind === 0) moving.clear();
      return { result: 'moved', files, leftBehind, snapshots };
    },
  };
  /** Whether a folder has changes, as the Changes git reads it. */
  /** Each folder's ignored names, as the Changes git lists them; a folder in `unreadable` throws. */
  const ignored = new Map<string, string[]>();
  const unreadable = new Set<string>();
  const tree: Pick<VcsWorkingTreePort, 'changedFiles' | 'ignoredFiles'> = {
    async ignoredFiles(folder, { limit }) {
      if (unreadable.has(folder.path)) throw new VcsError("git couldn't list the ignored files.");
      const names = ignored.get(folder.path) ?? [];
      return { files: names.slice(0, limit), more: Math.max(0, names.length - limit) };
    },
    async changedFiles(folder, target) {
      if (target.view !== 'unstaged') return { files: [], truncated: false };
      return { files: [...changes(folder.path)].map((path) => ({ path: path as never, change: 'changed' as const, additions: 1, deletions: 0, binary: false, tooLarge: false })), truncated: false };
    },
  };
  return { vcs, mover, tree, ignored, unreadable, calls, moves, branches, changes, failing, conflicts, leaving, gate, commitOn: (branch: string) => unmerged.add(branch) };
}

function setUp(options: { entities?: (entities: Entities) => Entities } = {}) {
  /** Chats whose copy is put away (27.6), as the put-away store reads them. */
  const putAway = new Set<SessionId>();
  const coreDir = tempDir('ogden-agents-core-');
  const core = openTestCore(coreDir);
  const dataDir = realpathSync.native(tempDir('ogden-agents-data-'));
  const repo = realpathSync.native(tempDir('ogden-agents-repo-'));
  const git = fakeGit(repo);
  const bot = agent();
  const cleanups: SessionId[] = [];
  const snapshots: { sessionId: SessionId; from: string; to: string }[] = [];
  const chat = createChat({
    dataDir,
    entities: options.entities?.(core.entities) ?? core.entities,
    sessionEvents: core.sessionEvents,
    agents: soleAgent(bot.port),
    agentEnv: () => ({}),
    vcs: git.vcs,
    vcsWorkingTree: git.tree,
    vcsChatWorktree: git.mover,
    onHandOffSnapshot: (sessionId, trees) => snapshots.push({ sessionId, ...trees }),
    onWorktreeCleanupError: (sessionId) => cleanups.push(sessionId),
    worktreePutAway: { get: (sessionId: SessionId) => (putAway.has(sessionId) ? ({ sessionId } as never) : undefined) } as never,
  });
  const workspace = chat.openWorkspace(repo);
  const events = (): CoreEvent[] => core.events.readAfter(0);
  const moved = (sessionId: SessionId): SessionLocationChangedEvent[] =>
    events().filter((event): event is SessionLocationChangedEvent => event.type === 'session.location_changed' && event.streamId === sessionId);
  const tamper = (sql: string, ...params: string[]) => {
    const db = openDatabase(coreDir);
    try {
      db.sqlite.prepare(sql).run(...params);
    } finally {
      db.close();
    }
  };
  const turn = async (sessionId: SessionId) => {
    chat.sendMessage(workspace.id, sessionId, 'hello');
    await chat.settled();
  };
  return { core, chat, dataDir, repo, git, bot, workspace, events, moved, cleanups, snapshots, tamper, turn, putAway };
}

const refusal = (promise: Promise<unknown>) => promise.then(() => undefined, (error: unknown) => error as Error);

describe('Hand off between this folder and its own worktree (27.4)', () => {
  it('moves an idle this-folder chat and every change of the folder to its own copy, and its next turn runs there', async () => {
    const kit = setUp();
    const session = await kit.chat.createChatSession(kit.workspace.id);
    await kit.turn(session.id);
    kit.git.changes(kit.repo).add('edited.txt').add('new.txt').add('staged.txt');

    const moved = await kit.chat.moveChat(kit.workspace.id, session.id, 'worktree');

    const branch = chatWorktreeBranch(session.id);
    expect(moved).toMatchObject({ id: session.id, branch });
    expect(moved.worktreePath).not.toBeNull();
    expect(basename(join(moved.worktreePath!, '..'))).toBe('cw');
    expect(kit.git.calls).toEqual([`addWorktree ${branch}`]);
    expect(kit.git.moves).toEqual([`project > copy ${branch}`]);
    expect([...kit.git.changes(moved.worktreePath!)].sort()).toEqual(['edited.txt', 'new.txt', 'staged.txt']);
    expect(kit.git.changes(kit.repo).size).toBe(0);
    expect(kit.moved(session.id).map((event) => event.payload)).toEqual([{ sessionId: session.id, location: 'worktree', previous: 'this_folder', branch, files: 3, resumes: true }]);
    expect(kit.snapshots).toEqual([{ sessionId: session.id, from: 'f'.repeat(40), to: 'e'.repeat(40) }]);
    expect(kit.chat.chatLocation(kit.workspace.id, session.id)).toEqual({ kind: 'worktree', branch, port: null, putAway: false });

    // Released first; the next turn reopens its own agent session in the copy.
    await kit.turn(session.id);
    expect(kit.bot.starts).toEqual([
      { cwd: kit.repo, reopened: false },
      { cwd: moved.worktreePath, reopened: true },
    ]);
  });

  it('moves a worktree chat back: the project folder holds the changes, the clean copy goes, its merged branch too', async () => {
    const kit = setUp();
    const session = await kit.chat.createChatSession(kit.workspace.id, { location: 'worktree' });
    const path = session.worktreePath!;
    kit.git.changes(path).add('a.txt');

    const moved = await kit.chat.moveChat(kit.workspace.id, session.id, 'this_folder');

    expect(moved).toMatchObject({ worktreePath: null, branch: null });
    expect([...kit.git.changes(kit.repo)]).toEqual(['a.txt']);
    expect(existsSync(path)).toBe(false);
    expect(kit.git.branches.has(session.branch!)).toBe(false);
    expect(kit.git.calls.at(-1)).toBe(`removeWorktree ${basename(path)} ${session.branch} merged-only`);
    // It never reached an agent: it starts fresh with the history.
    expect(kit.moved(session.id).map((event) => event.payload)).toEqual([{ sessionId: session.id, location: 'this_folder', previous: 'worktree', branch: null, files: 1, resumes: false }]);
    expect(kit.chat.chatLocation(kit.workspace.id, session.id)).toEqual({ kind: 'this_folder' });
    await kit.turn(session.id);
    expect(kit.bot.starts.at(-1)?.cwd).toBe(kit.repo);
  });

  it('round trip: the edit is intact both ways, the branch with commits is kept and reused', async () => {
    const kit = setUp();
    const session = await kit.chat.createChatSession(kit.workspace.id);
    kit.git.changes(kit.repo).add('notes.md');
    const first = await kit.chat.moveChat(kit.workspace.id, session.id, 'worktree');
    kit.git.commitOn(first.branch!);
    await kit.chat.moveChat(kit.workspace.id, session.id, 'this_folder');
    expect([...kit.git.changes(kit.repo)]).toEqual(['notes.md']);
    expect(existsSync(first.worktreePath!)).toBe(false);
    // It has commits: kept.
    expect(kit.git.branches.has(first.branch!)).toBe(true);

    const again = await kit.chat.moveChat(kit.workspace.id, session.id, 'worktree');
    expect(kit.git.calls.filter((call) => call.startsWith('addWorktree'))).toEqual([`addWorktree ${first.branch}`, `addWorktree ${first.branch} existing`]);
    expect([...kit.git.changes(again.worktreePath!)]).toEqual(['notes.md']);
    expect(kit.moved(session.id).map((event) => [event.payload.previous, event.payload.location])).toEqual([
      ['this_folder', 'worktree'],
      ['worktree', 'this_folder'],
      ['this_folder', 'worktree'],
    ]);
  });

  it('refuses mid-turn: this chat, or another chat in the project folder, works, waits, is busy or terminal-driven', async () => {
    const kit = setUp();
    const session = await kit.chat.createChatSession(kit.workspace.id);
    const other = await kit.chat.createChatSession(kit.workspace.id);
    kit.git.changes(kit.repo).add('a.txt');
    kit.bot.holdTurns();

    kit.chat.sendMessage(kit.workspace.id, session.id, 'work');
    // Busy before the agent says it works.
    expect(await refusal(kit.chat.moveChat(kit.workspace.id, session.id, 'worktree'))).toBeInstanceOf(AgentMidTurnError);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await refusal(kit.chat.moveChat(kit.workspace.id, session.id, 'worktree'))).toBeInstanceOf(AgentMidTurnError);
    // Another chat in the project folder works: its changes are the folder's too.
    expect(await refusal(kit.chat.moveChat(kit.workspace.id, other.id, 'worktree'))).toBeInstanceOf(AgentMidTurnError);
    kit.bot.release();
    await kit.chat.settled();

    kit.core.entities.setSessionState(other.id, 'waiting');
    expect(await refusal(kit.chat.moveChat(kit.workspace.id, session.id, 'worktree'))).toBeInstanceOf(AgentMidTurnError);
    kit.core.entities.setSessionState(other.id, 'idle');
    kit.core.entities.setSessionDriver(other.id, 'terminal');
    expect(await refusal(kit.chat.moveChat(kit.workspace.id, session.id, 'worktree'))).toBeInstanceOf(AgentMidTurnError);

    expect(kit.git.calls).toEqual([]);
    expect(kit.git.moves).toEqual([]);
    expect([...kit.git.changes(kit.repo)]).toEqual(['a.txt']);
    expect(kit.moved(session.id)).toEqual([]);
  });

  it('refuses while the copy is put away (27.6: worktree_put_away), moving nothing; its Location says put away', async () => {
    const kit = setUp();
    const session = await kit.chat.createChatSession(kit.workspace.id, { location: 'worktree' });
    kit.git.changes(session.worktreePath!).add('a.txt');
    kit.putAway.add(session.id);
    expect(kit.chat.chatLocation(kit.workspace.id, session.id)).toEqual({ kind: 'worktree', branch: session.branch, port: null, putAway: true });
    const error = await refusal(kit.chat.moveChat(kit.workspace.id, session.id, 'this_folder'));
    expect(error).toBeInstanceOf(WorktreePutAwayError);
    expect(error?.message).toBe(HANDOFF_PUT_AWAY_TEXT);
    expect(kit.git.moves).toEqual([]);
    expect(kit.moved(session.id)).toEqual([]);
    kit.putAway.delete(session.id);
    expect((await kit.chat.moveChat(kit.workspace.id, session.id, 'this_folder')).worktreePath).toBeNull();
  });

  it("a chat Restore put on a new branch (27.6: '-restored') moves back like any worktree chat", async () => {
    const kit = setUp();
    const session = await kit.chat.createChatSession(kit.workspace.id, { location: 'worktree' });
    const restored = restoredChatWorktreeBranch(session.id);
    kit.tamper('UPDATE sessions SET branch = ? WHERE id = ?', restored, session.id);
    kit.git.changes(session.worktreePath!).add('a.txt');
    const moved = await kit.chat.moveChat(kit.workspace.id, session.id, 'this_folder');
    expect(moved).toMatchObject({ worktreePath: null, branch: null });
    expect([...kit.git.changes(kit.repo)]).toEqual(['a.txt']);
    expect(kit.git.calls.at(-1)).toBe(`removeWorktree ${basename(session.worktreePath!)} ${restored} merged-only`);
  });

  it('a worktree chat moving back is refused while a chat in the project folder works; a chat in another copy does not count', async () => {
    const kit = setUp();
    const away = await kit.chat.createChatSession(kit.workspace.id, { location: 'worktree' });
    const elsewhere = await kit.chat.createChatSession(kit.workspace.id, { location: 'worktree' });
    const here = await kit.chat.createChatSession(kit.workspace.id);
    kit.core.entities.setSessionState(elsewhere.id, 'working');
    kit.core.entities.setSessionState(here.id, 'working');
    expect(await refusal(kit.chat.moveChat(kit.workspace.id, away.id, 'this_folder'))).toBeInstanceOf(AgentMidTurnError);
    kit.core.entities.setSessionState(here.id, 'idle');
    expect((await kit.chat.moveChat(kit.workspace.id, away.id, 'this_folder')).worktreePath).toBeNull();
  });

  it('overlap: the project folder has its own change to a file the copy changed (handoff_conflict, files 1), nothing moved', async () => {
    const kit = setUp();
    const session = await kit.chat.createChatSession(kit.workspace.id, { location: 'worktree' });
    const path = session.worktreePath!;
    kit.git.changes(path).add('a.txt').add('b.txt');
    kit.git.changes(kit.repo).add('a.txt');

    const error = await refusal(kit.chat.moveChat(kit.workspace.id, session.id, 'this_folder'));

    expect(error).toBeInstanceOf(HandOffConflictError);
    expect((error as HandOffConflictError).files).toBe(1);
    expect([...kit.git.changes(path)].sort()).toEqual(['a.txt', 'b.txt']);
    expect(existsSync(path)).toBe(true);
    expect(kit.core.entities.getSession(session.id)).toMatchObject({ worktreePath: path, branch: session.branch });
    expect(kit.moved(session.id)).toEqual([]);
    expect(kit.git.calls.some((call) => call.startsWith('removeWorktree'))).toBe(false);
  });

  it('base moved: the changes do not apply in the new copy (handoff_conflict); the new copy and branch go, the project keeps its changes', async () => {
    const kit = setUp();
    const session = await kit.chat.createChatSession(kit.workspace.id);
    kit.git.changes(kit.repo).add('moved-base.txt');
    kit.git.conflicts.add('moved-base.txt');

    expect(await refusal(kit.chat.moveChat(kit.workspace.id, session.id, 'worktree'))).toBeInstanceOf(HandOffConflictError);

    const branch = chatWorktreeBranch(session.id);
    expect(kit.git.calls).toEqual([`addWorktree ${branch}`, expect.stringMatching(new RegExp(`^removeWorktree [a-z0-9]+ ${branch.replace('/', '\\/')} merged-only$`))]);
    expect(kit.git.branches.has(branch)).toBe(false);
    expect([...kit.git.changes(kit.repo)]).toEqual(['moved-base.txt']);
    expect(kit.core.entities.getSession(session.id)).toMatchObject({ worktreePath: null, branch: null });
  });

  it('kept branch: a conflict in the copy made on it removes the copy and keeps the branch', async () => {
    const kit = setUp();
    const session = await kit.chat.createChatSession(kit.workspace.id);
    const branch = chatWorktreeBranch(session.id);
    kit.git.branches.add(branch);
    kit.git.changes(kit.repo).add('x.txt');
    kit.git.conflicts.add('x.txt');
    expect(await refusal(kit.chat.moveChat(kit.workspace.id, session.id, 'worktree'))).toBeInstanceOf(HandOffConflictError);
    expect(kit.git.calls).toEqual([`addWorktree ${branch} existing`, expect.stringMatching(/^removeWorktree [a-z0-9]+$/)]);
    expect(kit.git.branches.has(branch)).toBe(true);
  });

  it('refuses the same place, a remote chat, a planning session and a terminal-driven chat (invalid_operation), moving nothing', async () => {
    const kit = setUp();
    const plain = await kit.chat.createChatSession(kit.workspace.id);
    const copy = await kit.chat.createChatSession(kit.workspace.id, { location: 'worktree' });
    const remote = kit.core.entities.createSession({ workspaceId: kit.workspace.id, kind: 'chat', machineId: 'mach_01J9Z3K4M5N6P7Q8R9S0T1V2W3' as never });
    const planning = await kit.chat.createChatSession(kit.workspace.id, { kind: 'planning' });
    const driven = await kit.chat.createChatSession(kit.workspace.id);
    kit.core.entities.setSessionDriver(driven.id, 'terminal');
    for (const [id, to] of [
      [plain.id, 'this_folder'],
      [copy.id, 'worktree'],
      [remote.id, 'worktree'],
      [planning.id, 'worktree'],
      [driven.id, 'worktree'],
    ] as const) {
      expect(await refusal(kit.chat.moveChat(kit.workspace.id, id, to))).toBeInstanceOf(InvalidOperationError);
    }
    expect(kit.chat.chatLocation(kit.workspace.id, remote.id)).toEqual({ kind: 'remote', machineId: remote.machineId });
    expect(kit.git.moves).toEqual([]);
    expect(kit.git.calls.filter((call) => !call.startsWith('addWorktree'))).toEqual([]);
  });

  it('a tampered row naming a folder outside <data>/cw writes nothing', async () => {
    const kit = setUp();
    const session = await kit.chat.createChatSession(kit.workspace.id, { location: 'worktree' });
    const outside = realpathSync.native(tempDir('ogden-agents-outside-'));
    kit.tamper('UPDATE sessions SET worktree_path = ? WHERE id = ?', outside, session.id);
    kit.git.changes(outside).add('mine.txt');
    expect(await refusal(kit.chat.moveChat(kit.workspace.id, session.id, 'this_folder'))).toBeInstanceOf(InvalidOperationError);
    expect(kit.git.moves).toEqual([]);
    expect(existsSync(outside)).toBe(true);
    expect([...kit.git.changes(outside)]).toEqual(['mine.txt']);
  });

  it('a git failure after the copy was made removes the new copy and its branch; the project keeps its changes (plain 409)', async () => {
    const kit = setUp();
    const session = await kit.chat.createChatSession(kit.workspace.id);
    kit.git.changes(kit.repo).add('a.txt');
    kit.git.failing.set(kit.repo, undefined);
    const error = await refusal(kit.chat.moveChat(kit.workspace.id, session.id, 'worktree'));
    expect(error).toBeInstanceOf(InvalidOperationError);
    expect(error?.message).not.toMatch(/[–—]/);
    const branch = chatWorktreeBranch(session.id);
    expect(kit.git.branches.has(branch)).toBe(false);
    expect(kit.git.calls.at(-1)).toMatch(/^removeWorktree /);
    expect([...kit.git.changes(kit.repo)]).toEqual(['a.txt']);
    expect(kit.core.entities.getSession(session.id)).toMatchObject({ worktreePath: null });
  });

  it('a row write that fails after the move moves the changes back and removes the copy; the original error is the answer', async () => {
    const failure = new Error('the database is locked');
    const kit = setUp({
      entities: (entities) => ({
        ...entities,
        setSessionWorktree: () => {
          throw failure;
        },
      }),
    });
    const session = await kit.chat.createChatSession(kit.workspace.id);
    kit.git.changes(kit.repo).add('a.txt');
    expect(await refusal(kit.chat.moveChat(kit.workspace.id, session.id, 'worktree'))).toBe(failure);
    expect(kit.git.moves).toEqual([`project > copy ${chatWorktreeBranch(session.id)}`, 'copy > project']);
    expect([...kit.git.changes(kit.repo)]).toEqual(['a.txt']);
    expect(kit.git.branches.has(chatWorktreeBranch(session.id))).toBe(false);
    expect(kit.cleanups).toEqual([]);
  });

  it('a row write that fails and changes that cannot move back: the copy is left and reported', async () => {
    const failure = new Error('the database is locked');
    const kit = setUp({
      entities: (entities) => ({
        ...entities,
        setSessionWorktree: () => {
          throw failure;
        },
      }),
    });
    const session = await kit.chat.createChatSession(kit.workspace.id);
    kit.git.changes(kit.repo).add('a.txt');
    const original = kit.git.mover.moveChanges;
    let count = 0;
    kit.git.mover.moveChanges = async (repo, input) => {
      if (++count === 2) throw new VcsError('no');
      return original(repo, input);
    };
    expect(await refusal(kit.chat.moveChat(kit.workspace.id, session.id, 'worktree'))).toBe(failure);
    expect(kit.cleanups).toEqual([session.id]);
    expect(kit.git.calls.some((call) => call.startsWith('removeWorktree'))).toBe(false);
  });

  it('a copy that does not read clean after the move is left and reported', async () => {
    const kit = setUp();
    const session = await kit.chat.createChatSession(kit.workspace.id, { location: 'worktree' });
    const path = session.worktreePath!;
    kit.git.changes(path).add('a.txt');
    const original = kit.git.mover.moveChanges;
    kit.git.mover.moveChanges = async (repo, input) => {
      const result = await original(repo, input);
      // Something wrote the copy again just after.
      kit.git.changes(path).add('late.txt');
      return result;
    };
    expect((await kit.chat.moveChat(kit.workspace.id, session.id, 'this_folder')).worktreePath).toBeNull();
    expect(existsSync(path)).toBe(true);
    expect(kit.cleanups).toEqual([session.id]);
  });

  it('a git failure that may have half-written the new copy leaves it and reports; the snapshots of the throw are logged', async () => {
    const kit = setUp();
    const session = await kit.chat.createChatSession(kit.workspace.id);
    kit.git.changes(kit.repo).add('a.txt');
    kit.git.failing.set(kit.repo, false);
    expect(await refusal(kit.chat.moveChat(kit.workspace.id, session.id, 'worktree'))).toBeInstanceOf(InvalidOperationError);
    expect(kit.git.calls.some((call) => call.startsWith('removeWorktree'))).toBe(false);
    expect(kit.git.branches.has(chatWorktreeBranch(session.id))).toBe(true);
    expect(kit.cleanups).toEqual([session.id]);
    expect(kit.snapshots).toEqual([{ sessionId: session.id, from: 'f'.repeat(40), to: 'e'.repeat(40) }]);
    expect([...kit.git.changes(kit.repo)]).toEqual(['a.txt']);
    expect(kit.core.entities.getSession(session.id)).toMatchObject({ worktreePath: null });
  });

  it('a git failure whose new copy reads as before removes it, and logs the snapshots', async () => {
    const kit = setUp();
    const session = await kit.chat.createChatSession(kit.workspace.id);
    kit.git.changes(kit.repo).add('a.txt');
    kit.git.failing.set(kit.repo, true);
    expect(await refusal(kit.chat.moveChat(kit.workspace.id, session.id, 'worktree'))).toBeInstanceOf(InvalidOperationError);
    expect(kit.git.calls.at(-1)).toMatch(/^removeWorktree /);
    expect(kit.snapshots).toHaveLength(1);
    expect(kit.cleanups).toEqual([]);
  });

  it('moving back, changes left behind in the copy keep it and report; the row moves', async () => {
    const kit = setUp();
    const session = await kit.chat.createChatSession(kit.workspace.id, { location: 'worktree' });
    const path = session.worktreePath!;
    kit.git.changes(path).add('a.txt');
    kit.git.leaving.add(path);
    expect((await kit.chat.moveChat(kit.workspace.id, session.id, 'this_folder')).worktreePath).toBeNull();
    expect([...kit.git.changes(kit.repo)]).toEqual(['a.txt']);
    expect(existsSync(path)).toBe(true);
    expect(kit.git.calls.some((call) => call.startsWith('removeWorktree'))).toBe(false);
    expect(kit.cleanups).toContain(session.id);
  });

  it('to its worktree, changes left behind in the project folder are reported, never thrown', async () => {
    const kit = setUp();
    const session = await kit.chat.createChatSession(kit.workspace.id);
    kit.git.changes(kit.repo).add('a.txt');
    kit.git.leaving.add(kit.repo);
    const moved = await kit.chat.moveChat(kit.workspace.id, session.id, 'worktree');
    expect([...kit.git.changes(moved.worktreePath!)]).toEqual(['a.txt']);
    expect(kit.cleanups).toEqual([session.id]);
  });

  it('a row write that fails after moving back never moves the project folder into the copy: both are left and reported', async () => {
    const failure = new Error('the database is locked');
    let fail = false;
    const kit = setUp({
      entities: (entities) => ({
        ...entities,
        setSessionWorktree: (...args: Parameters<Entities['setSessionWorktree']>) => {
          if (fail) throw failure;
          return entities.setSessionWorktree(...args);
        },
      }),
    });
    const session = await kit.chat.createChatSession(kit.workspace.id, { location: 'worktree' });
    const path = session.worktreePath!;
    kit.git.changes(path).add('a.txt');
    kit.git.changes(kit.repo).add('mine.txt');
    fail = true;
    expect(await refusal(kit.chat.moveChat(kit.workspace.id, session.id, 'this_folder'))).toBe(failure);
    expect(kit.git.moves).toEqual(['copy > project']);
    expect([...kit.git.changes(kit.repo)].sort()).toEqual(['a.txt', 'mine.txt']);
    expect(existsSync(path)).toBe(true);
    expect(kit.cleanups).toEqual([session.id]);
  });

  it.skipIf(process.platform === 'win32')('a copy that is a link inside <data>/cw is refused, nothing written', async () => {
    const kit = setUp();
    const session = await kit.chat.createChatSession(kit.workspace.id, { location: 'worktree' });
    const path = session.worktreePath!;
    const elsewhere = realpathSync.native(tempDir('ogden-agents-elsewhere-'));
    rmSync(path, { recursive: true, force: true });
    symlinkSync(elsewhere, path);
    expect(await refusal(kit.chat.moveChat(kit.workspace.id, session.id, 'this_folder'))).toBeInstanceOf(InvalidOperationError);
    expect(kit.git.moves).toEqual([]);
    expect(kit.core.entities.getSession(session.id)).toMatchObject({ worktreePath: path });
  });

  it('holds the project folder for the move: another chat there takes no message or terminal switch until it is done', async () => {
    const kit = setUp();
    const session = await kit.chat.createChatSession(kit.workspace.id);
    const other = await kit.chat.createChatSession(kit.workspace.id);
    const away = await kit.chat.createChatSession(kit.workspace.id, { location: 'worktree' });
    kit.git.changes(kit.repo).add('a.txt');
    let open: () => void = () => undefined;
    kit.git.gate.wait = new Promise<void>((resolve) => (open = resolve));

    const moving = kit.chat.moveChat(kit.workspace.id, session.id, 'worktree');
    while (kit.git.moves.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));

    expect(() => kit.chat.sendMessage(kit.workspace.id, other.id, 'hello')).toThrow(SessionNotIdleError);
    expect(() => kit.chat.sendMessage(kit.workspace.id, other.id, 'hello')).toThrow("This chat's folder is being moved. Try again in a moment.");
    expect(await refusal(kit.chat.switchDriver(kit.workspace.id, other.id, 'terminal'))).toBeInstanceOf(SessionNotIdleError);
    // Continuing another chat with another agent is refused before anything is committed.
    const switched = await refusal(kit.chat.handoffPreview(kit.workspace.id, other.id, 'other-agent' as never));
    expect(switched).toBeInstanceOf(SessionNotIdleError);
    expect(switched?.message).toBe("This chat's folder is being moved. Try again in a moment.");
    // The moving chat itself says its folder is moving, not that it switches drivers.
    expect(() => kit.chat.sendMessage(kit.workspace.id, session.id, 'hello')).toThrow("This chat's folder is being moved. Try again in a moment.");
    // A chat in another copy is not held.
    kit.chat.sendMessage(kit.workspace.id, away.id, 'hello');

    open();
    kit.git.gate.wait = undefined;
    await moving;
    await kit.chat.settled();
    // Released once done.
    kit.chat.sendMessage(kit.workspace.id, other.id, 'hello');
    await kit.chat.settled();
    expect(kit.bot.starts.map((start) => start.cwd)).toContain(kit.repo);
  });

  it('a kept branch with commits survives a branch read that is absent or fails: nothing is made', async () => {
    for (const broken of ['absent', 'rejects'] as const) {
      const kit = setUp();
      const session = await kit.chat.createChatSession(kit.workspace.id);
      const branch = chatWorktreeBranch(session.id);
      kit.git.branches.add(branch);
      kit.git.commitOn(branch);
      kit.git.changes(kit.repo).add('a.txt');
      if (broken === 'absent') delete kit.git.vcs.branchRevision;
      else kit.git.vcs.branchRevision = async () => Promise.reject(new VcsError('no'));
      expect(await refusal(kit.chat.moveChat(kit.workspace.id, session.id, 'worktree'))).toBeInstanceOf(InvalidOperationError);
      expect(kit.git.calls).toEqual([]);
      expect(kit.git.branches.has(branch)).toBe(true);
      expect([...kit.git.changes(kit.repo)]).toEqual(['a.txt']);
    }
  });

  it('a new copy whose branch has commits by the time it is removed keeps its branch (merged only)', async () => {
    const kit = setUp();
    const session = await kit.chat.createChatSession(kit.workspace.id);
    const branch = chatWorktreeBranch(session.id);
    kit.git.changes(kit.repo).add('x.txt');
    kit.git.conflicts.add('x.txt');
    kit.git.commitOn(branch);
    expect(await refusal(kit.chat.moveChat(kit.workspace.id, session.id, 'worktree'))).toBeInstanceOf(HandOffConflictError);
    expect(kit.git.calls.at(-1)).toMatch(/ merged-only$/);
    expect(kit.git.branches.has(branch)).toBe(true);
  });

  it('a project in a subfolder of the folder counts: its working chat refuses the move, and its chats are held during one', async () => {
    const kit = setUp();
    mkdirSync(join(kit.repo, 'sub'));
    const inner = kit.chat.openWorkspace(join(kit.repo, 'sub'));
    const nested = await kit.chat.createChatSession(inner.id);
    const session = await kit.chat.createChatSession(kit.workspace.id);
    kit.core.entities.setSessionState(nested.id, 'working');
    expect(await refusal(kit.chat.moveChat(kit.workspace.id, session.id, 'worktree'))).toBeInstanceOf(AgentMidTurnError);
    kit.core.entities.setSessionState(nested.id, 'idle');

    let open: () => void = () => undefined;
    kit.git.gate.wait = new Promise<void>((resolve) => (open = resolve));
    const moving = kit.chat.moveChat(kit.workspace.id, session.id, 'worktree');
    while (kit.git.moves.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));
    expect(() => kit.chat.sendMessage(inner.id, nested.id, 'hello')).toThrow(SessionNotIdleError);
    open();
    kit.git.gate.wait = undefined;
    await moving;
  });

  it('is refused without the hand-off git (invalid_operation)', async () => {
    const core = openTestCore(tempDir('ogden-agents-core-'));
    const repo = realpathSync.native(tempDir('ogden-agents-repo-'));
    const chat = createChat({ dataDir: realpathSync.native(tempDir('ogden-agents-data-')), entities: core.entities, sessionEvents: core.sessionEvents, agents: soleAgent(agent().port), agentEnv: () => ({}) });
    const workspace = chat.openWorkspace(repo);
    const session = await chat.createChatSession(workspace.id);
    expect(await refusal(chat.moveChat(workspace.id, session.id, 'worktree'))).toBeInstanceOf(InvalidOperationError);
  });
});

describe('createChatLocations (27.4)', () => {
  it('parses the ids and the body: a malformed id is not_found, a malformed body invalid', async () => {
    const kit = setUp();
    const locations = createChatLocations(kit.chat);
    const session = await kit.chat.createChatSession(kit.workspace.id);
    expect(await locations.location(kit.workspace.id, session.id)).toEqual({ location: { kind: 'this_folder' } });
    expect(await refusal(locations.location('nope', session.id))).toBeInstanceOf(NotFoundError);
    expect(await refusal(locations.location(kit.workspace.id, '../x'))).toBeInstanceOf(NotFoundError);
    expect(await refusal(locations.handOff(kit.workspace.id, session.id, { to: 'mars' }))).toBeInstanceOf(ValidationError);
    expect(await refusal(locations.handOff(kit.workspace.id, session.id, { to: 'worktree', extra: 1 }))).toBeInstanceOf(ValidationError);
    const { session: moved } = await locations.handOff(kit.workspace.id, session.id, { to: 'worktree' });
    expect(moved.branch).toBe(chatWorktreeBranch(session.id));
  });
});

describe("a copy's ignored files before it goes (user decision 2026-11-01)", () => {
  it("lists a worktree chat's copy's ignored files, capped with how many more", async () => {
    const kit = setUp();
    const session = await kit.chat.createChatSession(kit.workspace.id, { location: 'worktree' });
    kit.git.ignored.set(session.worktreePath!, ['.env']);
    expect(await kit.chat.copyIgnoredFiles(kit.workspace.id, session.id)).toEqual({ files: ['.env'], more: 0, listed: true });
    kit.git.ignored.set(session.worktreePath!, Array.from({ length: 25 }, (_, index) => `secret-${String(index).padStart(2, '0')}.key`));
    const capped = await kit.chat.copyIgnoredFiles(kit.workspace.id, session.id);
    expect(capped.files).toHaveLength(IGNORED_FILES_SHOWN);
    expect(capped.more).toBe(5);
    // Through the routes' parser too.
    expect((await createChatLocations(kit.chat).ignoredFiles(kit.workspace.id, session.id)).more).toBe(5);
  });

  it('a this-folder chat, a put-away copy or a tampered row lists none; a copy git cannot read says so', async () => {
    const kit = setUp();
    const here = await kit.chat.createChatSession(kit.workspace.id);
    kit.git.ignored.set(kit.repo, ['.env']);
    expect(await kit.chat.copyIgnoredFiles(kit.workspace.id, here.id)).toEqual({ files: [], more: 0, listed: true });

    const session = await kit.chat.createChatSession(kit.workspace.id, { location: 'worktree' });
    kit.git.ignored.set(session.worktreePath!, ['.env']);
    kit.git.unreadable.add(session.worktreePath!);
    expect(await kit.chat.copyIgnoredFiles(kit.workspace.id, session.id)).toEqual({ files: [], more: 0, listed: false });
    kit.git.unreadable.delete(session.worktreePath!);

    kit.putAway.add(session.id);
    expect((await kit.chat.copyIgnoredFiles(kit.workspace.id, session.id)).files).toEqual([]);
    kit.putAway.delete(session.id);

    const outside = realpathSync.native(tempDir('ogden-agents-outside-'));
    kit.git.ignored.set(outside, ['.env']);
    kit.tamper('UPDATE sessions SET worktree_path = ? WHERE id = ?', outside, session.id);
    expect((await kit.chat.copyIgnoredFiles(kit.workspace.id, session.id)).files).toEqual([]);
  });
});
