/**
 * Delete chat and Delete history's copies (epic 27, 27.3; CAP-35): a chat's
 * rows go in one transaction, then its worktree's copy through `VcsPort`
 * (its branch deleted only when merged, else kept), never mid-turn, never a
 * copy with uncommitted changes unless the request says so, never anything
 * outside `<data>/cw`. A creation that fails after its worktree was made
 * removes the folder, git's record and the branch. Git is a fake here; the
 * real one is `vcs-git-chat-worktrees.test.ts`'s and the server's tests'.
 */
import { existsSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { chatWorktreeBranch, type CoreEvent, type SessionId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/database.js';
import {
  AgentMidTurnError,
  CHAT_WORKTREES_DIR,
  createChat,
  InvalidOperationError,
  UncommittedChangesError,
  WorkspaceBusyError,
  type Entities,
  type TerminalPort,
} from '../src/index.js';
import { openTestCore, soleAgent, tempDir } from './helpers.js';
import { fakeTerminal } from './support/fake-terminal.js';
import { agent, fakeGit, fakeWorkingTree } from './support/worktree-chat-fakes.js';

function setUp(options: { entities?: (entities: Entities) => Entities; terminal?: TerminalPort; stopBeforeRemovalMs?: number } = {}) {
  const coreDir = tempDir('ogden-agents-core-');
  const core = openTestCore(coreDir);
  const dataDir = realpathSync.native(tempDir('ogden-agents-data-'));
  const repo = realpathSync.native(tempDir('ogden-agents-repo-'));
  const git = fakeGit(repo);
  const tree = fakeWorkingTree();
  const bot = agent();
  const cleanups: { sessionId: SessionId; step: string }[] = [];
  const chat = createChat({
    dataDir,
    entities: options.entities?.(core.entities) ?? core.entities,
    sessionEvents: core.sessionEvents,
    agents: soleAgent(bot.port),
    agentEnv: () => ({}),
    vcs: git.vcs,
    vcsWorkingTree: tree.port,
    onWorktreeCleanupError: (sessionId, step) => cleanups.push({ sessionId, step }),
    ...(options.terminal === undefined ? {} : { terminal: options.terminal }),
    ...(options.stopBeforeRemovalMs === undefined ? {} : { stopBeforeRemovalMs: options.stopBeforeRemovalMs }),
  });
  const workspace = chat.openWorkspace(repo);
  const events = (): CoreEvent[] => core.events.readAfter(0);
  /** Writes to the database directly, as a bug or a damaged row would. */
  const tamper = (sql: string, ...params: string[]) => {
    const db = openDatabase(coreDir);
    try {
      db.sqlite.prepare(sql).run(...params);
    } finally {
      db.close();
    }
  };
  return { core, chat, dataDir, repo, git, tree, bot, workspace, events, cleanups, tamper };
}

type Kit = ReturnType<typeof setUp>;

const worktreeChat = async (kit: Kit) => {
  const session = await kit.chat.createChatSession(kit.workspace.id, { location: 'worktree' });
  return { session, path: session.worktreePath!, branch: session.branch! };
};

const refusal = (promise: Promise<unknown>) => promise.then(() => undefined, (error: unknown) => error as Error);

describe('Delete chat (27.3)', () => {
  it('deletes a clean worktree chat: its row, its events, its folder and its merged branch, with workspace.chat_deleted', async () => {
    const kit = setUp();
    const { session, path, branch } = await worktreeChat(kit);
    kit.chat.sendMessage(kit.workspace.id, session.id, 'hello');
    await kit.chat.settled();
    expect(kit.bot.cwds).toEqual([path]);

    const deleted = await kit.chat.deleteChat(kit.workspace.id, session.id);

    expect(deleted).toEqual({ sessionId: session.id, worktreeRemoved: true, branchKept: false });
    expect(kit.core.entities.getSession(session.id)).toBeUndefined();
    expect(kit.events().some((event) => event.streamId === session.id)).toBe(false);
    const event = kit.events().at(-1);
    expect(event).toMatchObject({ type: 'workspace.chat_deleted', workspaceId: kit.workspace.id, streamId: kit.workspace.id, payload: { sessionId: session.id, worktreeRemoved: true, branchKept: false } });
    expect(existsSync(path)).toBe(false);
    expect(kit.git.branches.has(branch)).toBe(false);
    expect(kit.git.calls).toContain(`removeWorktree ${basename(path)} ${branch} merged-only keep-unmerged`);
    // Its idle agent was stopped.
    expect(kit.bot.closed()).toBe(1);
  });

  it('deletes a plain chat without any git', async () => {
    const kit = setUp();
    const session = await kit.chat.createChatSession(kit.workspace.id);
    expect(await kit.chat.deleteChat(kit.workspace.id, session.id)).toEqual({ sessionId: session.id, worktreeRemoved: false, branchKept: false });
    expect(kit.chat.listSessions(kit.workspace.id)).toEqual([]);
    expect(kit.git.calls).toEqual([]);
  });

  it('keeps a branch that has commits of its own (branchKept), removing the folder', async () => {
    const kit = setUp();
    const { session, path, branch } = await worktreeChat(kit);
    kit.git.commitOn(branch);
    expect(await kit.chat.deleteChat(kit.workspace.id, session.id)).toEqual({ sessionId: session.id, worktreeRemoved: true, branchKept: true });
    expect(existsSync(path)).toBe(false);
    expect(kit.git.branches.has(branch)).toBe(true);
    expect(kit.events().at(-1)).toMatchObject({ type: 'workspace.chat_deleted', payload: { branchKept: true } });
  });

  it('refuses a copy with uncommitted changes (uncommitted_changes) until the request says discardUncommitted', async () => {
    const kit = setUp();
    const { session, path } = await worktreeChat(kit);
    writeFileSync(join(path, 'new.txt'), 'x');
    kit.tree.dirty.set(path, ['new.txt']);

    expect(await refusal(kit.chat.deleteChat(kit.workspace.id, session.id))).toBeInstanceOf(UncommittedChangesError);
    expect(kit.core.entities.getSession(session.id)).toBeDefined();
    expect(existsSync(join(path, 'new.txt'))).toBe(true);
    expect(kit.git.calls.some((call) => call.startsWith('removeWorktree'))).toBe(false);

    expect((await kit.chat.deleteChat(kit.workspace.id, session.id, { discardUncommitted: true })).worktreeRemoved).toBe(true);
    expect(existsSync(path)).toBe(false);
  });

  it('counts a copy whose state cannot be read as changed', async () => {
    const kit = setUp();
    const { session, path } = await worktreeChat(kit);
    kit.tree.unreadable.add(path);
    expect(await refusal(kit.chat.deleteChat(kit.workspace.id, session.id))).toBeInstanceOf(UncommittedChangesError);
    expect(existsSync(path)).toBe(true);
  });

  it('refuses mid-turn (working, busy, waiting, or the terminal driving), removing nothing', async () => {
    const kit = setUp();
    const { session, path } = await worktreeChat(kit);
    kit.bot.holdTurns();
    kit.chat.sendMessage(kit.workspace.id, session.id, 'work');
    // Busy before the agent says it works.
    expect(await refusal(kit.chat.deleteChat(kit.workspace.id, session.id))).toBeInstanceOf(AgentMidTurnError);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(kit.core.entities.getSession(session.id)?.state).toBe('working');
    expect(await refusal(kit.chat.deleteChat(kit.workspace.id, session.id, { discardUncommitted: true }))).toBeInstanceOf(AgentMidTurnError);
    kit.bot.release();
    await kit.chat.settled();

    kit.core.entities.setSessionState(session.id, 'waiting');
    expect(await refusal(kit.chat.deleteChat(kit.workspace.id, session.id))).toBeInstanceOf(AgentMidTurnError);
    kit.core.entities.setSessionState(session.id, 'idle');
    kit.core.entities.setSessionDriver(session.id, 'terminal');
    expect(await refusal(kit.chat.deleteChat(kit.workspace.id, session.id))).toBeInstanceOf(AgentMidTurnError);
    expect(existsSync(path)).toBe(true);
    expect(kit.core.entities.getSession(session.id)).toBeDefined();
  });

  it('refuses a build or planning session, and a chat an orchestration run names (invalid_operation)', async () => {
    const kit = setUp();
    const planning = await kit.chat.createChatSession(kit.workspace.id, { kind: 'planning' });
    expect(await refusal(kit.chat.deleteChat(kit.workspace.id, planning.id))).toBeInstanceOf(InvalidOperationError);
    const build = kit.core.entities.createSession({ workspaceId: kit.workspace.id, kind: 'build' });
    expect(await refusal(kit.chat.deleteChat(kit.workspace.id, build.id))).toBeInstanceOf(InvalidOperationError);

    const { session, path } = await worktreeChat(kit);
    kit.tamper(
      "INSERT INTO orchestration_runs (id, workspace_id, goal, state, mode, limits, created_at, updated_at) VALUES ('orc_01J9Z3K4M5N6P7Q8R9S0T1V2W3', ?, 'g', 'running', 'approve_each', '{}', 'x', 'x')",
      kit.workspace.id,
    );
    kit.tamper("INSERT INTO orchestration_steps (run_id, step_id, position, worker, chat, instruction, state, session_id) VALUES ('orc_01J9Z3K4M5N6P7Q8R9S0T1V2W3', 's1', 0, 'w', 'new', 'i', 'dispatched', ?)", session.id);
    expect(await refusal(kit.chat.deleteChat(kit.workspace.id, session.id))).toBeInstanceOf(InvalidOperationError);
    expect(existsSync(path)).toBe(true);
    expect(kit.chat.listSessions(kit.workspace.id)).toHaveLength(3);
  });

  it('never touches a copy outside <data>/cw (a tampered row): the rows go, the folder stays, it is reported', async () => {
    const kit = setUp();
    const { session, branch } = await worktreeChat(kit);
    const outside = realpathSync.native(tempDir('ogden-agents-elsewhere-'));
    writeFileSync(join(outside, 'keep.txt'), 'mine');
    kit.tamper('UPDATE sessions SET worktree_path = ? WHERE id = ?', outside, session.id);

    expect(await kit.chat.deleteChat(kit.workspace.id, session.id)).toEqual({ sessionId: session.id, worktreeRemoved: false, branchKept: true });
    expect(kit.core.entities.getSession(session.id)).toBeUndefined();
    expect(existsSync(join(outside, 'keep.txt'))).toBe(true);
    expect(kit.git.calls.some((call) => call.startsWith('removeWorktree'))).toBe(false);
    expect(kit.git.branches.has(branch)).toBe(true);
    expect(kit.cleanups).toEqual([{ sessionId: session.id, step: 'outside_data' }]);
  });

  it('never removes through <data>/cw when it became a link', async () => {
    const kit = setUp();
    const { session, path } = await worktreeChat(kit);
    const root = join(kit.dataDir, CHAT_WORKTREES_DIR);
    const moved = join(kit.dataDir, 'cw-real');
    renameSync(root, moved);
    symlinkSync(moved, root, 'dir');

    expect((await kit.chat.deleteChat(kit.workspace.id, session.id)).worktreeRemoved).toBe(false);
    expect(existsSync(join(moved, basename(path)))).toBe(true);
    expect(kit.git.calls.some((call) => call.startsWith('removeWorktree'))).toBe(false);
    expect(kit.cleanups.map((cleanup) => cleanup.step)).toEqual(['outside_data']);
  });

  it('logs a removal that fails after the rows went, and never throws it', async () => {
    const kit = setUp();
    const { session, path } = await worktreeChat(kit);
    kit.git.failRemoval();
    expect(await kit.chat.deleteChat(kit.workspace.id, session.id)).toEqual({ sessionId: session.id, worktreeRemoved: false, branchKept: true });
    expect(kit.core.entities.getSession(session.id)).toBeUndefined();
    expect(existsSync(path)).toBe(true);
    expect(kit.cleanups).toEqual([{ sessionId: session.id, step: 'remove' }]);
  });

  it('refuses a chat on a remote machine (invalid_operation)', async () => {
    const kit = setUp();
    const remote = kit.core.entities.createSession({ workspaceId: kit.workspace.id, kind: 'chat', machineId: 'mach_01J9Z3K4M5N6P7Q8R9S0T1V2W3' as never });
    expect(await refusal(kit.chat.deleteChat(kit.workspace.id, remote.id))).toBeInstanceOf(InvalidOperationError);
    expect(kit.core.entities.getSession(remote.id)).toBeDefined();
  });

  it('a link in the copy\'s place: only the link is removed, its target intact', async () => {
    const kit = setUp();
    const { session, path } = await worktreeChat(kit);
    const target = realpathSync.native(tempDir('ogden-agents-target-'));
    writeFileSync(join(target, 'keep.txt'), 'mine');
    rmSync(path, { recursive: true, force: true });
    symlinkSync(target, path, 'dir');
    // A link to a folder that isn't the copy can't be read as one (the adapter's worktree check refuses it): it counts as changed.
    kit.tree.unreadable.add(path);
    expect(await refusal(kit.chat.deleteChat(kit.workspace.id, session.id))).toBeInstanceOf(UncommittedChangesError);
    expect((await kit.chat.deleteChat(kit.workspace.id, session.id, { discardUncommitted: true })).worktreeRemoved).toBe(true);
    expect(kit.git.calls).toContain(`removeWorktree ${basename(path)} ${session.branch} merged-only keep-unmerged`);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(join(target, 'keep.txt'))).toBe(true);
  });

  it('refuses while the chat is switching to its terminal (the CLI starting in the copy)', async () => {
    let open!: () => void;
    const terminal = fakeTerminal({ opening: () => new Promise<void>((resolve) => (open = resolve)) });
    const kit = setUp({ terminal: terminal.port });
    const { session, path } = await worktreeChat(kit);
    kit.chat.sendMessage(kit.workspace.id, session.id, 'hello');
    await kit.chat.settled();
    const switched = kit.chat.switchDriver(kit.workspace.id, session.id, 'terminal');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await refusal(kit.chat.deleteChat(kit.workspace.id, session.id))).toBeInstanceOf(AgentMidTurnError);
    expect(await refusal(kit.chat.deleteHistory(kit.workspace.id))).toBeInstanceOf(WorkspaceBusyError);
    expect(existsSync(path)).toBe(true);
    open();
    await switched;
    await kit.chat.switchDriver(kit.workspace.id, session.id, 'ui');
    await kit.chat.close();
  });

  it('refuses when a whole turn ran while the copy was read: its new work was never checked', async () => {
    const kit = setUp();
    const { session, path } = await worktreeChat(kit);
    const turn = async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      kit.core.entities.setSessionState(session.id, 'working');
      writeFileSync(join(path, 'late.txt'), 'new work');
      kit.core.entities.setSessionState(session.id, 'idle');
    };
    kit.tree.during.read = turn;
    expect(await refusal(kit.chat.deleteChat(kit.workspace.id, session.id))).toBeInstanceOf(AgentMidTurnError);
    expect(existsSync(join(path, 'late.txt'))).toBe(true);
    expect(kit.core.entities.getSession(session.id)).toBeDefined();
    kit.tree.during.read = turn;
    expect(await refusal(kit.chat.deleteHistory(kit.workspace.id))).toBeInstanceOf(WorkspaceBusyError);
    expect(kit.chat.listSessions(kit.workspace.id)).toHaveLength(1);
  });

  it('leaves the copy, reported, when its agent has not exited in time', async () => {
    const kit = setUp({ stopBeforeRemovalMs: 30 });
    const { session, path } = await worktreeChat(kit);
    kit.chat.sendMessage(kit.workspace.id, session.id, 'hello');
    await kit.chat.settled();
    kit.bot.hangClose();
    expect(await kit.chat.deleteChat(kit.workspace.id, session.id)).toEqual({ sessionId: session.id, worktreeRemoved: false, branchKept: true });
    expect(kit.core.entities.getSession(session.id)).toBeUndefined();
    expect(existsSync(path)).toBe(true);
    expect(kit.git.calls.some((call) => call.startsWith('removeWorktree'))).toBe(false);
    expect(kit.cleanups).toEqual([{ sessionId: session.id, step: 'remove' }]);
    kit.bot.releaseClose();
  });

  it("answers not found for another project's chat", async () => {
    const kit = setUp();
    const { session } = await worktreeChat(kit);
    const other = kit.chat.openWorkspace(tempDir('ogden-agents-repo-'));
    expect((await refusal(kit.chat.deleteChat(other.id, session.id)))?.name).toBe('NotFoundError');
    expect(kit.core.entities.getSession(session.id)).toBeDefined();
  });
});

describe('Delete history removes its chats’ copies (27.3)', () => {
  it('refuses a dirty copy without the confirmation, then removes every copy with it', async () => {
    const kit = setUp();
    const one = await worktreeChat(kit);
    const two = await worktreeChat(kit);
    const plain = await kit.chat.createChatSession(kit.workspace.id);
    kit.git.commitOn(two.branch);
    kit.tree.dirty.set(one.path, ['a.txt']);

    expect(await refusal(kit.chat.deleteHistory(kit.workspace.id))).toBeInstanceOf(UncommittedChangesError);
    expect(kit.chat.listSessions(kit.workspace.id)).toHaveLength(3);
    expect(existsSync(one.path) && existsSync(two.path)).toBe(true);

    const deleted = await kit.chat.deleteHistory(kit.workspace.id, { discardUncommitted: true });
    expect(deleted.deletedSessions).toBe(3);
    expect(kit.chat.listSessions(kit.workspace.id)).toEqual([]);
    expect(existsSync(one.path) || existsSync(two.path)).toBe(false);
    expect(kit.git.branches.has(one.branch)).toBe(false);
    expect(kit.git.branches.has(two.branch)).toBe(true);
    expect(kit.events().some((event) => event.streamId === plain.id)).toBe(false);
  });

  it('refuses while a worktree chat works or waits', async () => {
    const kit = setUp();
    const { session, path } = await worktreeChat(kit);
    for (const state of ['working', 'waiting'] as const) {
      kit.core.entities.setSessionState(session.id, state);
      expect(await refusal(kit.chat.deleteHistory(kit.workspace.id, { discardUncommitted: true }))).toBeInstanceOf(WorkspaceBusyError);
      expect(existsSync(path)).toBe(true);
    }
    expect(kit.chat.listSessions(kit.workspace.id)).toHaveLength(1);
  });

  it('refuses while a worktree chat is driven by its terminal', async () => {
    const kit = setUp();
    const { session, path } = await worktreeChat(kit);
    kit.core.entities.setSessionDriver(session.id, 'terminal');
    expect(await refusal(kit.chat.deleteHistory(kit.workspace.id))).toBeInstanceOf(WorkspaceBusyError);
    expect(existsSync(path)).toBe(true);
  });
});

describe('a worktree chat whose creation fails late (27.3)', () => {
  it("removes the folder, git's record and the branch, and answers the original error", async () => {
    const kit = setUp({
      entities: (entities) => ({
        ...entities,
        createSession: () => {
          throw new Error('the database is locked');
        },
      }),
    });
    const error = await refusal(kit.chat.createChatSession(kit.workspace.id, { location: 'worktree' }));
    expect(error?.message).toBe('the database is locked');
    const added = kit.git.calls.find((call) => call.startsWith('addWorktree'))!;
    const [, path, branch] = added.split(' ') as [string, string, string];
    expect(kit.git.calls).toContain(`removeWorktree ${basename(path)} ${branch}`);
    expect(existsSync(path)).toBe(false);
    expect(kit.git.branches.has(branch)).toBe(false);
    expect(branch).toMatch(/^ogden\/chat\/ses_/);
    expect(chatWorktreeBranch(branch.slice('ogden/chat/'.length) as SessionId)).toBe(branch);
  });
});
