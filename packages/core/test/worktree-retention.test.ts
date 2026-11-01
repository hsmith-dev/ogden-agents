/**
 * Worktree retention and Restore (epic 27, 27.6; CAP-35, AD-17 CAP-33
 * note's exception): beyond the install's cap the idle chat worktree
 * updated longest ago is put away (its changes saved, the record and
 * `session.worktree_put_away` written, then its folder removed through
 * `VcsPort` with the branch kept), never one that works or waits; an
 * unsafe copy is skipped; a put-away chat takes no message (nor one held
 * mid put-away); Restore brings it back or refuses changing nothing; a half
 * put-away copy is repaired; Delete chat counts saved changes as
 * uncommitted; the setting is 1 to 100 and a lower one applies at once; the
 * snapshot cleanup keeps the latest turns' trees and the put-away ones.
 * Git is a fake here; the real one is `vcs-git-retention.test.ts`'s.
 */
import { existsSync, realpathSync } from 'node:fs';
import { TURN_SNAPSHOTS_KEPT, type CoreEvent, type SessionId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import {
  AgentMidTurnError,
  createChat,
  InvalidOperationError,
  newId,
  RestoreFailedError,
  UncommittedChangesError,
  ValidationError,
  WorktreePutAwayError,
  VcsError,
  type VcsSnapshotStoreEntry,
} from '../src/index.js';
import { openTestCore, soleAgent, tempDir } from './helpers.js';
import { agent, fakeChatWorktree, fakeGit, fakeWorkingTree } from './support/worktree-chat-fakes.js';

type FakeCopies = ReturnType<typeof fakeChatWorktree>;

function setUp(options: { keep?: number } = {}) {
  const core = openTestCore(tempDir('ogden-agents-core-'));
  const dataDir = realpathSync.native(tempDir('ogden-agents-data-'));
  const repo = realpathSync.native(tempDir('ogden-agents-repo-'));
  const git = fakeGit(repo);
  const tree = fakeWorkingTree();
  const copies = fakeChatWorktree();
  const bot = agent();
  const skipped: SessionId[] = [];
  const added: { current: ((sessionId: SessionId) => void) | undefined } = { current: undefined };
  const chat = createChat({
    dataDir,
    entities: core.entities,
    sessionEvents: core.sessionEvents,
    agents: soleAgent(bot.port),
    agentEnv: () => ({}),
    vcs: git.vcs,
    vcsWorkingTree: tree.port,
    vcsChatWorktree: copies,
    worktreePutAway: core.worktreePutAway,
    onChatWorktreeAdded: (sessionId) => added.current?.(sessionId),
  });
  const retention = core.createWorktreeRetention({ chat, dataDir, onSkipped: (sessionId) => skipped.push(sessionId) });
  if (options.keep !== undefined) core.worktreePutAway.setRetention(options.keep);
  const workspace = chat.openWorkspace(repo);
  const events = (): CoreEvent[] => core.events.readAfter(0);
  const worktreeChat = async () => {
    const session = await chat.createChatSession(workspace.id, { location: 'worktree' });
    return { session, path: session.worktreePath!, branch: session.branch! };
  };
  return { core, chat, dataDir, repo, git, tree, copies, bot, workspace, events, retention, skipped, added, worktreeChat };
}

/** Waits (bounded) until `check` holds. */
const until = async (check: () => boolean) => {
  for (let tries = 0; tries < 1000 && !check(); tries++) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(check()).toBe(true);
};

const refusal = (promise: Promise<unknown>) => promise.then(() => undefined, (error: unknown) => error as Error);

describe('putting a chat worktree away (27.6)', () => {
  it('saves its changes, writes the record and its event, then removes the folder through VcsPort keeping the branch', async () => {
    const kit = setUp();
    const { session, path, branch } = await kit.worktreeChat();
    kit.copies.changes(path).add('a.txt').add('new.txt');
    kit.chat.sendMessage(kit.workspace.id, session.id, 'hello');
    await kit.chat.settled();

    const putAway = await kit.chat.putAwayWorktree(session.id, 'retention');

    expect(putAway).toMatchObject({ sessionId: session.id, workspaceId: kit.workspace.id, branch, files: 2, cause: 'retention' });
    expect(kit.core.worktreePutAway.get(session.id)).toMatchObject({ snapshotTree: expect.stringMatching(/^[0-9a-f]{40}$/), files: 2 });
    const event = kit.events().find((one) => one.type === 'session.worktree_put_away');
    expect(event).toMatchObject({ streamId: session.id, payload: { sessionId: session.id, snapshotId: putAway.id, cause: 'retention', files: 2 } });
    // Ids and counts only.
    expect(JSON.stringify(event)).not.toContain(path);
    // Snapshot first, then the folder, without its branch.
    // A check before the agent stops, the save, and one more just before the removal.
    expect(kit.copies.calls).toEqual(Array.from({ length: 3 }, () => `saveForPutAway ${kit.repo} ${path} ${branch}`));
    expect(kit.git.calls.at(-1)).toBe(`removeWorktree ${path.split(/[\\/]/).at(-1)}`);
    expect(existsSync(path)).toBe(false);
    expect(kit.git.branches.has(branch)).toBe(true);
    // Its agent was stopped first.
    expect(kit.bot.closed()).toBe(1);
    // The session keeps its worktree and branch: Restore needs them.
    expect(kit.core.entities.getSession(session.id)).toMatchObject({ worktreePath: path, branch });
  });

  it('saves a clean copy with no tree and no files', async () => {
    const kit = setUp();
    const { session } = await kit.worktreeChat();
    expect(await kit.chat.putAwayWorktree(session.id, 'retention')).toMatchObject({ files: 0 });
    expect(kit.core.worktreePutAway.get(session.id)).toMatchObject({ snapshotTree: null, files: 0 });
  });

  it('refuses a chat that works or waits, an unsafe copy (removing nothing), a plain chat, and one already put away', async () => {
    const kit = setUp();
    const working = await kit.worktreeChat();
    kit.bot.holdTurns();
    kit.chat.sendMessage(kit.workspace.id, working.session.id, 'work');
    expect(await refusal(kit.chat.putAwayWorktree(working.session.id, 'retention'))).toBeInstanceOf(AgentMidTurnError);
    await until(kit.bot.holding);
    kit.bot.release();
    await kit.chat.settled();

    const unsafe = await kit.worktreeChat();
    kit.copies.unsafe.add(unsafe.path);
    expect(await refusal(kit.chat.putAwayWorktree(unsafe.session.id, 'retention'))).toBeInstanceOf(InvalidOperationError);
    expect(existsSync(unsafe.path)).toBe(true);
    expect(kit.core.worktreePutAway.get(unsafe.session.id)).toBeUndefined();

    const plain = await kit.chat.createChatSession(kit.workspace.id);
    expect(await refusal(kit.chat.putAwayWorktree(plain.id, 'retention'))).toBeInstanceOf(InvalidOperationError);

    const clean = await kit.worktreeChat();
    await kit.chat.putAwayWorktree(clean.session.id, 'retention');
    expect(await refusal(kit.chat.putAwayWorktree(clean.session.id, 'retention'))).toBeInstanceOf(InvalidOperationError);
    expect(kit.events().filter((event) => event.type === 'session.worktree_put_away')).toHaveLength(1);
  });

  it('refuses a message to a put-away chat, and one sent while it is being put away (the hold)', async () => {
    const kit = setUp();
    const { session } = await kit.worktreeChat();
    kit.chat.sendMessage(kit.workspace.id, session.id, 'hello');
    await kit.chat.settled();
    // The agent's exit is held: the put-away waits on it, holding the chat.
    kit.bot.hangClose();
    const pending = kit.chat.putAwayWorktree(session.id, 'retention');
    expect(() => kit.chat.sendMessage(kit.workspace.id, session.id, 'during')).toThrow(WorktreePutAwayError);
    expect(() => kit.chat.sendMessage(kit.workspace.id, session.id, 'now', { delivery: 'now' })).toThrow(WorktreePutAwayError);
    expect(kit.chat.worktreeIdle(session.id)).toBe(false);
    await until(kit.bot.closingHeld);
    kit.bot.releaseClose();
    await pending;
    expect(() => kit.chat.sendMessage(kit.workspace.id, session.id, 'after')).toThrow(WorktreePutAwayError);
    await expect(kit.chat.switchDriver(kit.workspace.id, session.id, 'terminal')).rejects.toThrow(WorktreePutAwayError);
    expect(kit.events().filter((event) => event.type === 'session.message_completed' && event.streamId === session.id)).toHaveLength(2);
  });

  it('leaves a half put-away copy when the removal fails: the record stays, and Restore repairs it in place', async () => {
    const kit = setUp();
    const { session, path } = await kit.worktreeChat();
    kit.copies.changes(path).add('a.txt');
    kit.git.failRemoval();
    await kit.chat.putAwayWorktree(session.id, 'retention');
    expect(existsSync(path)).toBe(true);
    expect(kit.core.worktreePutAway.get(session.id)).toBeDefined();
    expect(() => kit.chat.sendMessage(kit.workspace.id, session.id, 'hi')).toThrow(WorktreePutAwayError);

    expect(await kit.chat.restoreWorktree(kit.workspace.id, session.id)).toEqual({ location: { kind: 'worktree', branch: session.branch, port: null, putAway: false }, restored: 'saved' });
    expect(kit.core.worktreePutAway.get(session.id)).toBeUndefined();
    expect([...kit.copies.changes(path)]).toEqual(['a.txt']);
  });
});

describe('Restore (27.6)', () => {
  it('brings the copy back with its changes, removes the record with session.worktree_restored, and takes messages again', async () => {
    const kit = setUp();
    const { session, path, branch } = await kit.worktreeChat();
    kit.copies.changes(path).add('a.txt');
    const putAway = await kit.chat.putAwayWorktree(session.id, 'retention');
    kit.copies.forget(path);

    expect(await kit.retention.restore(kit.workspace.id, session.id)).toEqual({ location: { kind: 'worktree', branch, port: null, putAway: false }, restored: 'saved' });
    expect(kit.copies.calls.at(-1)).toBe(`restore ${kit.repo} ${path} ${branch} ${kit.core.worktreePutAway.listAll().length === 0 ? [...kit.copies.snapshots.keys()].at(-1) : ''}`);
    expect([...kit.copies.changes(path)]).toEqual(['a.txt']);
    expect(kit.core.worktreePutAway.get(session.id)).toBeUndefined();
    expect(kit.events().at(-1)).toMatchObject({ type: 'session.worktree_restored', payload: { sessionId: session.id, snapshotId: putAway.id } });
    expect(kit.chat.sendMessage(kit.workspace.id, session.id, 'back').queued).toBe(false);
    await kit.chat.settled();
  });

  it('refuses, changing nothing and keeping the record, when the path is taken', async () => {
    const kit = setUp();
    const { session, path } = await kit.worktreeChat();
    kit.copies.changes(path).add('a.txt');
    await kit.chat.putAwayWorktree(session.id, 'retention');
    kit.copies.forget(path);
    kit.copies.takenPaths.add(path);
    expect(await refusal(kit.chat.restoreWorktree(kit.workspace.id, session.id))).toMatchObject({ reason: 'path_taken' });
    expect(kit.core.worktreePutAway.get(session.id)).toBeDefined();
    expect(kit.events().some((event) => event.type === 'session.worktree_restored')).toBe(false);
  });

  it('a branch moved forward with changes that apply: restored on it at its newer commit, the branch unchanged', async () => {
    const kit = setUp();
    const { session, path, branch } = await kit.worktreeChat();
    kit.copies.changes(path).add('a.txt');
    await kit.chat.putAwayWorktree(session.id, 'retention');
    kit.copies.forget(path);
    kit.copies.heads.set(branch, 'd'.repeat(40));
    kit.copies.forwardBranches.add(branch);
    expect(await kit.chat.restoreWorktree(kit.workspace.id, session.id)).toEqual({ location: { kind: 'worktree', branch, port: null, putAway: false }, restored: 'newer' });
    expect(kit.core.entities.getSession(session.id)?.branch).toBe(branch);
    expect(kit.events().some((event) => event.type === 'session.location_changed')).toBe(false);
  });

  it.each([
    ['moved', (copies: FakeCopies, branch: string): void => void copies.heads.set(branch, 'd'.repeat(40))],
    ['gone', (copies: FakeCopies, branch: string): void => void copies.missingBranches.add(branch)],
  ] as const)('a branch %s: the copy on a new branch, made the chat\'s with session.location_changed in the record\'s transaction', async (on, change) => {
    const kit = setUp();
    const { session, path, branch } = await kit.worktreeChat();
    kit.copies.changes(path).add('a.txt');
    const putAway = await kit.chat.putAwayWorktree(session.id, 'retention');
    kit.copies.forget(path);
    change(kit.copies, branch);
    const restoredBranch = `${branch}-restored`;
    const before = kit.events().length;
    expect(await kit.chat.restoreWorktree(kit.workspace.id, session.id)).toEqual({ location: { kind: 'worktree', branch: restoredBranch, port: null, putAway: false }, restored: on });
    expect(kit.copies.calls.at(-1)).toContain(`restore ${kit.repo} ${path} ${branch} `);
    expect([...kit.copies.changes(path)]).toEqual(['a.txt']);
    expect(kit.core.entities.getSession(session.id)).toMatchObject({ branch: restoredBranch, worktreePath: path });
    expect(kit.core.worktreePutAway.get(session.id)).toBeUndefined();
    const added = kit.events().slice(before);
    expect(added.map((event) => event.type)).toEqual(['session.location_changed', 'session.worktree_restored']);
    expect(added[0]).toMatchObject({ payload: { sessionId: session.id, location: 'worktree', previous: 'worktree', branch: restoredBranch, files: putAway.files, resumes: true } });
    // Put away again and restored again: the record names the new branch.
    kit.copies.heads.clear();
    kit.copies.missingBranches.clear();
    const again = await kit.chat.putAwayWorktree(session.id, 'retention');
    expect(again.branch).toBe(restoredBranch);
  });

  it('refuses a branch the port names that is not this chat\'s own, keeping the record', async () => {
    const kit = setUp();
    const { session, path } = await kit.worktreeChat();
    kit.copies.changes(path).add('a.txt');
    await kit.chat.putAwayWorktree(session.id, 'retention');
    kit.copies.forget(path);
    const restore = kit.copies.restore;
    kit.copies.restore = async () => ({ branch: 'main', on: 'moved' });
    expect(await refusal(kit.chat.restoreWorktree(kit.workspace.id, session.id))).toMatchObject({ reason: 'failed' });
    kit.copies.restore = restore;
    expect(kit.core.worktreePutAway.get(session.id)).toBeDefined();
    expect(kit.core.entities.getSession(session.id)?.branch).toBe(`ogden/chat/${session.id}`);
  });

  it('refuses a chat with nothing put away, and one of another project', async () => {
    const kit = setUp();
    const { session } = await kit.worktreeChat();
    expect(await refusal(kit.chat.restoreWorktree(kit.workspace.id, session.id))).toBeInstanceOf(InvalidOperationError);
    expect((await refusal(kit.retention.restore('ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3', session.id)))?.name).toBe('NotFoundError');
  });
});

describe('the retention sweep (27.6)', () => {
  it('puts away the idle copy updated longest ago once over the cap, sparing the one just added', async () => {
    const kit = setUp({ keep: 2 });
    kit.added.current = (sessionId) => void kit.retention.enforce({ spare: sessionId });
    const first = await kit.worktreeChat();
    const second = await kit.worktreeChat();
    kit.copies.changes(first.path).add('a.txt').add('b.txt');
    const third = await kit.worktreeChat();
    await kit.retention.settled();

    expect(kit.core.worktreePutAway.listAll().map((record) => record.sessionId)).toEqual([first.session.id]);
    expect(kit.events().find((event) => event.type === 'session.worktree_put_away')).toMatchObject({ payload: { files: 2, cause: 'retention' } });
    expect(existsSync(first.path)).toBe(false);
    expect(existsSync(second.path) && existsSync(third.path)).toBe(true);
  });

  it('never chooses a working copy: the next oldest idle one goes; with every copy busy nothing goes', async () => {
    const kit = setUp({ keep: 3 });
    const first = await kit.worktreeChat();
    const second = await kit.worktreeChat();
    const third = await kit.worktreeChat();
    kit.bot.holdTurns();
    kit.chat.sendMessage(kit.workspace.id, first.session.id, 'work');
    kit.core.worktreePutAway.setRetention(2);
    expect((await kit.retention.enforce()).map((each) => each.sessionId)).toEqual([second.session.id]);

    kit.chat.sendMessage(kit.workspace.id, third.session.id, 'work too');
    kit.core.worktreePutAway.setRetention(1);
    expect(await kit.retention.enforce()).toEqual([]);
    expect(kit.core.worktreePutAway.listAll().map((record) => record.sessionId)).toEqual([second.session.id]);
    for (let turn = 0; turn < 2; turn++) {
      await until(kit.bot.holding);
      kit.bot.release();
    }
    await kit.chat.settled();
  });

  it('skips a copy it can\'t put away safely, saying so, and puts away the next', async () => {
    const kit = setUp({ keep: 1 });
    const first = await kit.worktreeChat();
    const second = await kit.worktreeChat();
    const third = await kit.worktreeChat();
    kit.copies.unsafe.add(first.path);
    expect((await kit.retention.enforce({ spare: third.session.id })).map((each) => each.sessionId)).toEqual([second.session.id]);
    expect(kit.skipped).toEqual([first.session.id]);
    expect(existsSync(first.path)).toBe(true);
  });

  it('takes 1 to 100 (400 otherwise); a lower value applies at once, with its event', async () => {
    const kit = setUp();
    expect(await kit.retention.setting()).toEqual({ keep: 15 });
    for (const keep of [0, 101, 2.5, '3']) expect(await refusal(kit.retention.setSetting({ keep }))).toBeInstanceOf(ValidationError);
    const first = await kit.worktreeChat();
    await kit.worktreeChat();
    expect(await kit.retention.setSetting({ keep: 1 })).toEqual({ keep: 1 });
    await kit.retention.settled();
    expect(kit.core.worktreePutAway.listAll().map((record) => record.sessionId)).toEqual([first.session.id]);
    expect(kit.events().find((event) => event.type === 'settings.worktree_retention_changed')).toMatchObject({ payload: { keep: 1, previous: 15 } });
    // The same value again changes nothing.
    await kit.retention.setSetting({ keep: 1 });
    expect(kit.events().filter((event) => event.type === 'settings.worktree_retention_changed')).toHaveLength(1);
    expect((await kit.retention.listPutAway(kit.workspace.id)).worktrees).toEqual([expect.objectContaining({ sessionId: first.session.id, files: 0 })]);
  });
});

describe('Delete chat of a put-away copy (27.6)', () => {
  it('counts its saved changes as uncommitted until discardUncommitted, and the record goes with the chat', async () => {
    const kit = setUp();
    const { session, path } = await kit.worktreeChat();
    kit.copies.changes(path).add('a.txt');
    await kit.chat.putAwayWorktree(session.id, 'retention');
    expect(await refusal(kit.chat.deleteChat(kit.workspace.id, session.id))).toBeInstanceOf(UncommittedChangesError);
    expect(kit.core.entities.getSession(session.id)).toBeDefined();
    await kit.chat.deleteChat(kit.workspace.id, session.id, { discardUncommitted: true });
    expect(kit.core.worktreePutAway.get(session.id)).toBeUndefined();

    // A clean put-away copy deletes without asking.
    const clean = await kit.worktreeChat();
    await kit.chat.putAwayWorktree(clean.session.id, 'retention');
    expect(await kit.chat.deleteChat(kit.workspace.id, clean.session.id)).toMatchObject({ sessionId: clean.session.id });
  });
});

describe('the snapshot cleanup (27.6)', () => {
  it("keeps each chat's latest turns' trees and the put-away trees; a busy project keeps everything", async () => {
    const kit = setUp();
    const tree = (n: number) => n.toString(16).padStart(40, 'a');
    const plain = await kit.chat.createChatSession(kit.workspace.id);
    for (let n = 1; n <= TURN_SNAPSHOTS_KEPT + 2; n++) {
      kit.core.sessionEvents.appendSessionEvent(plain.id, {
        type: 'session.turn_changes_recorded',
        payload: { sessionId: plain.id, turnId: newId('trn'), startTree: tree(2 * n), endTree: tree(2 * n + 1), files: 0, additions: 0, deletions: 0 },
      });
    }
    const { session, path } = await kit.worktreeChat();
    kit.copies.changes(path).add('a.txt');
    await kit.chat.putAwayWorktree(session.id, 'retention');
    const saved = kit.core.worktreePutAway.get(session.id)!.snapshotTree!;
    const seen: VcsSnapshotStoreEntry[][] = [];
    const cleanup = kit.core.createSnapshotCleanup({ pruneSnapshots: async (entries) => (seen.push([...entries]), { objects: 0, stores: 0, temporary: 0, refused: 0 }) });
    await cleanup.run();
    const keep = new Set(seen[0]![0]!.keep);
    expect(seen[0]![0]!.folder).toBe(kit.repo);
    expect(keep.has(saved)).toBe(true);
    // The two oldest turns are past the bound.
    expect(keep.has(tree(2)) || keep.has(tree(3)) || keep.has(tree(4)) || keep.has(tree(5))).toBe(false);
    expect(keep.has(tree(2 * (TURN_SNAPSHOTS_KEPT + 2) + 1))).toBe(true);
    expect(keep.size).toBe(2 * TURN_SNAPSHOTS_KEPT + 1);

    kit.bot.holdTurns();
    kit.chat.sendMessage(kit.workspace.id, plain.id, 'work');
    await cleanup.run();
    expect(seen[1]![0]!.keep).toBeNull();
    await until(kit.bot.holding);
    kit.bot.release();
    await kit.chat.settled();
  });
});

describe('put-away safety (27.6 review)', () => {
  it("checks the copy before stopping its agent: a copy that can't be put away keeps its agent", async () => {
    const kit = setUp();
    const { session, path } = await kit.worktreeChat();
    kit.chat.sendMessage(kit.workspace.id, session.id, 'hello');
    await kit.chat.settled();
    kit.copies.unsafe.add(path);
    expect(await refusal(kit.chat.putAwayWorktree(session.id, 'retention'))).toBeInstanceOf(InvalidOperationError);
    expect(kit.bot.closed()).toBe(0);
    expect(kit.copies.calls).toHaveLength(1);
  });

  it('keeps the folder (half put away) when it changed between the save and the removal', async () => {
    const kit = setUp();
    const { session, path } = await kit.worktreeChat();
    kit.copies.changes(path).add('a.txt');
    // The third save (just before the removal) sees a write made since.
    kit.copies.saves.after = () => {
      if (kit.copies.saves.count === 2) kit.copies.changes(path).add('late.txt');
    };
    await kit.chat.putAwayWorktree(session.id, 'retention');
    expect(existsSync(path)).toBe(true);
    expect(kit.core.worktreePutAway.get(session.id)).toBeDefined();
    expect(kit.git.calls.some((call) => call.startsWith('removeWorktree'))).toBe(false);
  });

  it('answers 409 restore_failed (failed) when git could not restore, keeping the record', async () => {
    const kit = setUp();
    const { session, path } = await kit.worktreeChat();
    kit.copies.changes(path).add('a.txt');
    await kit.chat.putAwayWorktree(session.id, 'retention');
    kit.copies.restore = async () => {
      throw new VcsError('the branch is checked out elsewhere', { step: 'restore' });
    };
    expect(await refusal(kit.chat.restoreWorktree(kit.workspace.id, session.id))).toMatchObject({ name: 'RestoreFailedError', reason: 'failed' });
    expect(kit.core.worktreePutAway.get(session.id)).toBeDefined();
  });

  it("holds the chat during Restore: no send, send-now, handoff or terminal switch; and the stop waits for it", async () => {
    const kit = setUp();
    const { session, path } = await kit.worktreeChat();
    kit.copies.changes(path).add('a.txt');
    await kit.chat.putAwayWorktree(session.id, 'retention');
    // Put away: handoff refused too.
    await expect(kit.chat.handoffPreview(kit.workspace.id, session.id, 'other')).rejects.toThrow(WorktreePutAwayError);
    const restore = kit.copies.restore.bind(kit.copies);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    kit.copies.restore = async (...args) => {
      await gate;
      return restore(...args);
    };
    const pending = kit.chat.restoreWorktree(kit.workspace.id, session.id);
    let settled = false;
    const stopping = kit.chat.worktreeOpsSettled().then(() => (settled = true));
    await until(() => kit.copies.calls.length > 0);
    expect(() => kit.chat.sendMessage(kit.workspace.id, session.id, 'hi')).toThrow(WorktreePutAwayError);
    expect(() => kit.chat.sendQueuedMessageNow(kit.workspace.id, session.id, 'msg_x')).toThrow(WorktreePutAwayError);
    await expect(kit.chat.handoffPreview(kit.workspace.id, session.id, 'other')).rejects.toThrow(WorktreePutAwayError);
    await expect(kit.chat.switchDriver(kit.workspace.id, session.id, 'terminal')).rejects.toThrow(WorktreePutAwayError);
    expect(settled).toBe(false);
    release();
    await pending;
    await stopping;
    expect(settled).toBe(true);
    expect(kit.chat.sendMessage(kit.workspace.id, session.id, 'back').queued).toBe(false);
    await kit.chat.settled();
  });

  it('Delete history refuses a put-away copy with saved files until discardUncommitted', async () => {
    const kit = setUp();
    const { session, path } = await kit.worktreeChat();
    kit.copies.changes(path).add('a.txt');
    await kit.chat.putAwayWorktree(session.id, 'retention');
    expect(await refusal(kit.chat.deleteHistory(kit.workspace.id))).toBeInstanceOf(UncommittedChangesError);
    expect(kit.core.entities.getSession(session.id)).toBeDefined();
    await kit.chat.deleteHistory(kit.workspace.id, { discardUncommitted: true });
    expect(kit.core.entities.getSession(session.id)).toBeUndefined();
    expect(kit.core.worktreePutAway.get(session.id)).toBeUndefined();
  });

  it('passes every put-away tree of the install to the cleanup as protected', async () => {
    const kit = setUp();
    const { session, path } = await kit.worktreeChat();
    kit.copies.changes(path).add('a.txt');
    await kit.chat.putAwayWorktree(session.id, 'retention');
    const seen: Array<readonly string[] | undefined> = [];
    await kit.core.createSnapshotCleanup({ pruneSnapshots: async (_entries, options) => (seen.push(options.protect), { objects: 0, stores: 0, temporary: 0, refused: 0 }) }).run();
    expect(seen).toEqual([[kit.core.worktreePutAway.get(session.id)!.snapshotTree]]);
  });
});
