/**
 * Trials (epic 27, 27.8; CAP-35): one task, several agents, each in its own
 * worktree chat, keep one. Every row of the plan's matrix: a start makes a
 * worktree chat per agent (distinct branches), sends each the task and
 * writes the trial with `workspace.trial_started` (ids only); an agent that
 * can't start, isn't registered, or a machine asked, makes nothing; a
 * local-only agent starts locally; a creation that fails removes the copies
 * made; retention never puts a trial's copy away before Keep; Keep puts the
 * others away or deletes them (refusing uncommitted changes unless
 * confirmed), refuses mid-turn, leaves an unsafe copy, and is refused once
 * done; a not-kept copy restores as a normal worktree chat. Git is a fake
 * (`support/worktree-chat-fakes.ts`).
 */
import { existsSync, realpathSync } from 'node:fs';
import { type CoreEvent, type SessionId, type WorkspaceTrialKeptEvent } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import {
  AgentMidTurnError,
  createAgentRegistry,
  createChat,
  InvalidOperationError,
  NotFoundError,
  UncommittedChangesError,
  ValidationError,
  VcsError,
  type AgentReadiness,
} from '../src/index.js';
import { openTestCore, registered, tempDir } from './helpers.js';
import { createTrials } from '../src/index.js';
import { agent, fakeChatWorktree, fakeGit, fakeWorkingTree } from './support/worktree-chat-fakes.js';

const refusal = (promise: Promise<unknown>) => promise.then(() => undefined, (error: unknown) => error as Error);

/** Waits (bounded) until `check` holds. */
const until = async (check: () => boolean) => {
  for (let tries = 0; tries < 1000 && !check(); tries++) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(check()).toBe(true);
};

function setUp(options: { keep?: number; readiness?: Record<string, AgentReadiness>; trusted?: boolean } = {}) {
  const core = openTestCore(tempDir('ogden-agents-core-'));
  const dataDir = realpathSync.native(tempDir('ogden-agents-data-'));
  const repo = realpathSync.native(tempDir('ogden-agents-repo-'));
  const git = fakeGit(repo);
  const tree = fakeWorkingTree();
  const copies = fakeChatWorktree();
  const bots = { a: agent(), b: agent(), c: agent(), local: agent(), trusty: agent() };
  const localPort = { ...bots.local.port, localOnlyReason: 'It runs only on this computer.' };
  const agents = createAgentRegistry([
    registered('a', bots.a.port),
    registered('b', bots.b.port),
    registered('c', bots.c.port),
    registered('local', localPort),
    registered('trusty', bots.trusty.port, { needsProjectTrust: true }),
  ]);
  // Each worktree made, counted, so a test can make the nth fail.
  const realAdd = git.vcs.addWorktree.bind(git.vcs);
  const adds = { count: 0, failAt: 0 };
  git.vcs.addWorktree = async (repoPath, input) => {
    adds.count++;
    if (adds.count === adds.failAt) throw new VcsError('git could not make the worktree', { step: 'worktree' });
    return realAdd(repoPath, input);
  };
  const added: { current: ((sessionId: SessionId) => void) | undefined } = { current: undefined };
  const chat = createChat({
    dataDir,
    entities: core.entities,
    sessionEvents: core.sessionEvents,
    agents,
    agentEnv: () => ({}),
    vcs: git.vcs,
    vcsWorkingTree: tree.port,
    vcsChatWorktree: copies,
    worktreePutAway: core.worktreePutAway,
    onChatWorktreeAdded: (sessionId) => added.current?.(sessionId),
    ...(options.readiness === undefined ? {} : { agentReadiness: async (agentId: string) => options.readiness?.[agentId] ?? { install: 'installed', auth: 'signed_in' } }),
    projectTrusted: () => options.trusted === true,
  });
  const retention = core.createWorktreeRetention({ chat, dataDir });
  // The server's wiring: one more copy runs the sweep, sparing it.
  added.current = (sessionId) => void retention.enforce({ spare: sessionId }).catch(() => undefined);
  if (options.keep !== undefined) core.worktreePutAway.setRetention(options.keep);
  const kept: SessionId[] = [];
  // The server's wiring: after a Keep the sweep runs, sparing the chat kept.
  const trials = core.createTrials({
    chat,
    onKept: (sessionId) => {
      kept.push(sessionId);
      void retention.enforce({ spare: sessionId }).catch(() => undefined);
    },
  });
  const workspace = chat.openWorkspace(repo);
  const events = (): CoreEvent[] => core.events.readAfter(0);
  const userMessages = (sessionId: SessionId) =>
    core.entities.listSessionEvents(sessionId, ['session.message_completed']).flatMap((event) => (event.type === 'session.message_completed' && event.payload.role === 'user' ? [event.payload.content] : []));
  return { core, chat, git, tree, copies, bots, adds, added, retention, trials, workspace, events, userMessages, kept, dataDir };
}

type Kit = ReturnType<typeof setUp>;

async function startTwo(kit: Kit, text = 'Fix the login bug') {
  const { trial } = await kit.trials.start(kit.workspace.id, { text, agentIds: ['a', 'b'] });
  await kit.chat.settled();
  await kit.retention.settled();
  return trial;
}

describe('starting a trial (27.8)', () => {
  it('makes one worktree chat per agent on its own branch, sends each the task, and writes the trial with ids only', async () => {
    const kit = setUp();
    const trial = await startTwo(kit);
    expect(trial.chats.map((chat) => [chat.agentId, chat.result])).toEqual([
      ['a', 'open'],
      ['b', 'open'],
    ]);
    expect(trial).toMatchObject({ workspaceId: kit.workspace.id, text: 'Fix the login bug', keptSessionId: null });
    const sessions = trial.sessionIds.map((id) => kit.core.entities.getSession(id)!);
    expect(sessions.map((session) => [session.kind, session.agentId, session.machineId])).toEqual([
      ['chat', 'a', null],
      ['chat', 'b', null],
    ]);
    expect(new Set(sessions.map((session) => session.branch)).size).toBe(2);
    expect(new Set(sessions.map((session) => session.worktreePath)).size).toBe(2);
    for (const session of sessions) expect(existsSync(session.worktreePath!)).toBe(true);
    for (const id of trial.sessionIds) expect(kit.userMessages(id)).toEqual(['Fix the login bug']);
    const started = kit.events().filter((event) => event.type === 'workspace.trial_started');
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ streamId: kit.workspace.id, payload: { trialId: trial.id, sessionIds: trial.sessionIds } });
    // Never the task's text in a trial event.
    expect(JSON.stringify(started)).not.toContain('login');
    expect(await kit.trials.get(kit.workspace.id, trial.id)).toEqual({ trial });
    expect((await kit.trials.list(kit.workspace.id)).trials.map((each) => each.id)).toEqual([trial.id]);
  });

  it('lists the newest first', async () => {
    const kit = setUp();
    const first = await startTwo(kit, 'one');
    const second = await startTwo(kit, 'two');
    expect((await kit.trials.list(kit.workspace.id)).trials.map((each) => each.id)).toEqual([second.id, first.id]);
  });

  it('makes nothing for an agent that is signed out, one that needs an untrusted project, or one not registered', async () => {
    const kit = setUp({ readiness: { b: { install: 'installed', auth: 'needs_sign_in', blocked: 'agent_signed_out' } } });
    const signedOut = await refusal(kit.trials.start(kit.workspace.id, { text: 'Fix it', agentIds: ['a', 'b'] }));
    expect(signedOut).toBeInstanceOf(InvalidOperationError);
    expect(signedOut?.message).toContain('Test Agent');
    const untrusted = await refusal(kit.trials.start(kit.workspace.id, { text: 'Fix it', agentIds: ['a', 'trusty'] }));
    expect(untrusted).toBeInstanceOf(InvalidOperationError);
    const unknown = await refusal(kit.trials.start(kit.workspace.id, { text: 'Fix it', agentIds: ['a', 'nobody'] }));
    expect(unknown).toBeInstanceOf(InvalidOperationError);
    expect(unknown?.message).toContain('nobody');
    expect(kit.chat.listSessions(kit.workspace.id)).toEqual([]);
    expect(kit.adds.count).toBe(0);
    expect(kit.events().filter((event) => event.type === 'workspace.trial_started')).toEqual([]);
  });

  it('refuses a machine, a single agent and a repeated one (400s), and an unknown project (404)', async () => {
    const kit = setUp();
    for (const body of [
      { text: 'Fix it', agentIds: ['a', 'b'], machineId: 'mach_01J9Z3K4M5N6P7Q8R9S0T1V2W9' },
      { text: 'Fix it', agentIds: ['a'] },
      { text: 'Fix it', agentIds: ['a', 'a'] },
      { text: '  ', agentIds: ['a', 'b'] },
    ]) {
      expect(await refusal(kit.trials.start(kit.workspace.id, body)), JSON.stringify(body)).toBeInstanceOf(ValidationError);
    }
    expect(await refusal(kit.trials.start('ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3', { text: 'Fix it', agentIds: ['a', 'b'] }))).toBeInstanceOf(NotFoundError);
    expect(await refusal(kit.trials.get(kit.workspace.id, 'try_01J9Z3K4M5N6P7Q8R9S0T1V2W6'))).toBeInstanceOf(NotFoundError);
    expect(kit.chat.listSessions(kit.workspace.id)).toEqual([]);
  });

  it('starts a local-only agent locally', async () => {
    const kit = setUp();
    const { trial } = await kit.trials.start(kit.workspace.id, { text: 'Fix it', agentIds: ['a', 'local'] });
    await kit.chat.settled();
    expect(kit.core.entities.getSession(trial.sessionIds[1]!)).toMatchObject({ agentId: 'local', machineId: null, branch: expect.any(String) });
  });

  it("removes the first chat and its copy when the second can't be made, writes no trial, and answers git's error", async () => {
    const kit = setUp();
    kit.adds.failAt = 2;
    const error = await refusal(kit.trials.start(kit.workspace.id, { text: 'Fix it', agentIds: ['a', 'b'] }));
    expect(error).toBeDefined();
    expect(error).not.toBeInstanceOf(ValidationError);
    expect(kit.chat.listSessions(kit.workspace.id)).toEqual([]);
    const made = kit.git.calls.filter((call) => call.startsWith('addWorktree')).map((call) => call.split(' ')[1]!);
    expect(made).toHaveLength(1);
    expect(existsSync(made[0]!)).toBe(false);
    expect(kit.events().filter((event) => event.type === 'workspace.trial_started')).toEqual([]);
    expect(kit.bots.a.cwds).toEqual([]);
  });
});

describe("retention and a trial's copies (27.8)", () => {
  it('puts away an older idle copy instead of either trial copy, and the trial may sit above the cap until Keep', async () => {
    const kit = setUp({ keep: 1 });
    const older = await kit.chat.createChatSession(kit.workspace.id, { location: 'worktree' as const, agentId: 'c' });
    await kit.retention.settled();
    const trial = await startTwo(kit);
    await kit.retention.settled();
    expect(kit.core.worktreePutAway.get(older.id)).toMatchObject({ cause: 'retention' });
    for (const id of trial.sessionIds) expect(kit.core.worktreePutAway.get(id)).toBeUndefined();
    expect(await kit.retention.enforce()).toEqual([]);
    expect(kit.core.trialStore.spared(trial.sessionIds[0]!)).toBe(true);
    // Kept: the kept chat counts as any other again.
    await kit.trials.keep(kit.workspace.id, trial.id, { sessionId: trial.sessionIds[0] });
    expect(kit.core.trialStore.spared(trial.sessionIds[0]!)).toBe(false);
    expect(kit.kept).toEqual([trial.sessionIds[0]]);
  });
});

describe('keeping one (27.8)', () => {
  it("puts the others' copies away (not kept), keeps the chosen one untouched, and records ids only", async () => {
    const kit = setUp();
    const trial = await startTwo(kit);
    const [keep, other] = trial.sessionIds as [SessionId, SessionId];
    const keptSession = kit.core.entities.getSession(keep)!;
    const callsBefore = kit.git.calls.length;
    const { trial: done } = await kit.trials.keep(kit.workspace.id, trial.id, { sessionId: keep });
    expect(done.keptSessionId).toBe(keep);
    expect(done.chats.map((chat) => chat.result)).toEqual(['kept', 'put_away']);
    expect(kit.core.worktreePutAway.get(other)).toMatchObject({ cause: 'not_kept' });
    expect(existsSync(kit.core.entities.getSession(other)!.worktreePath!)).toBe(false);
    // The kept chat: no merge, no change.
    expect(kit.core.worktreePutAway.get(keep)).toBeUndefined();
    expect(kit.core.entities.getSession(keep)).toMatchObject({ worktreePath: keptSession.worktreePath, branch: keptSession.branch });
    expect(kit.git.calls.slice(callsBefore).every((call) => !call.includes(keptSession.worktreePath!.split(/[\\/]/).at(-1)!))).toBe(true);
    const event = kit.events().find((each): each is WorkspaceTrialKeptEvent => each.type === 'workspace.trial_kept');
    expect(event?.payload).toEqual({ trialId: trial.id, sessionId: keep, putAway: [other], removed: [], left: [] });
    // Again: refused, nothing changed.
    expect(await refusal(kit.trials.keep(kit.workspace.id, trial.id, { sessionId: other }))).toBeInstanceOf(InvalidOperationError);
    expect(kit.events().filter((each) => each.type === 'workspace.trial_kept')).toHaveLength(1);
  });

  it('deletes clean others with Delete chat', async () => {
    const kit = setUp();
    const trial = await startTwo(kit);
    const [keep, other] = trial.sessionIds as [SessionId, SessionId];
    const copy = kit.core.entities.getSession(other)!.worktreePath!;
    const { trial: done } = await kit.trials.keep(kit.workspace.id, trial.id, { sessionId: keep, others: 'delete' });
    expect(done.chats.map((chat) => chat.result)).toEqual(['kept', 'removed']);
    expect(kit.core.entities.getSession(other)).toBeUndefined();
    expect(existsSync(copy)).toBe(false);
    expect(kit.events().find((each) => each.type === 'workspace.trial_kept')?.payload).toMatchObject({ putAway: [], removed: [other], left: [] });
  });

  it('refuses deleting a copy with uncommitted changes, removing nothing, until the user confirms', async () => {
    const kit = setUp();
    const trial = await startTwo(kit);
    const [keep, other] = trial.sessionIds as [SessionId, SessionId];
    const copy = kit.core.entities.getSession(other)!.worktreePath!;
    kit.tree.dirty.set(copy, ['notes.md']);
    expect(await kit.chat.copyHasUncommitted(kit.workspace.id, other)).toBe(true);
    expect(await kit.chat.copyHasUncommitted(kit.workspace.id, keep)).toBe(false);
    expect(await refusal(kit.trials.keep(kit.workspace.id, trial.id, { sessionId: keep, others: 'delete' }))).toBeInstanceOf(UncommittedChangesError);
    expect(kit.core.entities.getSession(other)).toBeDefined();
    expect(existsSync(copy)).toBe(true);
    expect((await kit.trials.get(kit.workspace.id, trial.id)).trial.keptSessionId).toBeNull();
    const { trial: done } = await kit.trials.keep(kit.workspace.id, trial.id, { sessionId: keep, others: 'delete', discard: [other] });
    expect(done.chats.map((chat) => chat.result)).toEqual(['kept', 'removed']);
    expect(existsSync(copy)).toBe(false);
  });

  it('refuses while another chat works, changing nothing', async () => {
    const kit = setUp();
    kit.bots.b.holdTurns();
    const { trial } = await kit.trials.start(kit.workspace.id, { text: 'Fix it', agentIds: ['a', 'b'] });
    await until(kit.bots.b.holding);
    const [keep, other] = trial.sessionIds as [SessionId, SessionId];
    expect(await refusal(kit.trials.keep(kit.workspace.id, trial.id, { sessionId: keep }))).toBeInstanceOf(AgentMidTurnError);
    expect(kit.core.worktreePutAway.get(other)).toBeUndefined();
    expect((await kit.trials.get(kit.workspace.id, trial.id)).trial.keptSessionId).toBeNull();
    kit.bots.b.release();
    await kit.chat.settled();
    // The working one itself can be kept while it is the others that are idle.
    expect((await kit.trials.keep(kit.workspace.id, trial.id, { sessionId: keep })).trial.keptSessionId).toBe(keep);
  });

  it("leaves a copy that can't be put away safely, puts the others away, and keeps the trial", async () => {
    const kit = setUp();
    const { trial } = await kit.trials.start(kit.workspace.id, { text: 'Fix it', agentIds: ['a', 'b', 'c'] });
    await kit.chat.settled();
    const [keep, unsafe, other] = trial.sessionIds as [SessionId, SessionId, SessionId];
    const unsafeCopy = kit.core.entities.getSession(unsafe)!.worktreePath!;
    kit.copies.unsafe.add(unsafeCopy);
    const { trial: done } = await kit.trials.keep(kit.workspace.id, trial.id, { sessionId: keep });
    expect(done.chats.map((chat) => chat.result)).toEqual(['kept', 'left', 'put_away']);
    expect(existsSync(unsafeCopy)).toBe(true);
    expect(kit.core.worktreePutAway.get(other)).toBeDefined();
    expect(kit.events().find((each) => each.type === 'workspace.trial_kept')?.payload).toMatchObject({ putAway: [other], left: [unsafe] });
  });

  it("refuses a chat that isn't the trial's, and a body with a machine", async () => {
    const kit = setUp();
    const trial = await startTwo(kit);
    const stranger = await kit.chat.createChatSession(kit.workspace.id);
    expect(await refusal(kit.trials.keep(kit.workspace.id, trial.id, { sessionId: stranger.id }))).toBeInstanceOf(InvalidOperationError);
    expect(await refusal(kit.trials.keep(kit.workspace.id, trial.id, { sessionId: trial.sessionIds[0], machineId: 'x' }))).toBeInstanceOf(ValidationError);
  });

  it('skips a chat already put away on a repeat after a crash', async () => {
    const kit = setUp();
    const trial = await startTwo(kit);
    const [keep, other] = trial.sessionIds as [SessionId, SessionId];
    // The crash: the copy went, the kept row was never written.
    await kit.chat.putAwayWorktree(other, 'not_kept');
    const { trial: done } = await kit.trials.keep(kit.workspace.id, trial.id, { sessionId: keep });
    expect(done.chats.map((chat) => chat.result)).toEqual(['kept', 'put_away']);
    expect(kit.events().filter((each) => each.type === 'session.worktree_put_away')).toHaveLength(1);
  });

  it('restores a not-kept copy as a normal worktree chat', async () => {
    const kit = setUp();
    const trial = await startTwo(kit);
    const [keep, other] = trial.sessionIds as [SessionId, SessionId];
    const copy = kit.core.entities.getSession(other)!.worktreePath!;
    kit.copies.changes(copy).add('result.md');
    await kit.trials.keep(kit.workspace.id, trial.id, { sessionId: keep });
    expect(existsSync(copy)).toBe(false);
    const restored = await kit.chat.restoreWorktree(kit.workspace.id, other);
    expect(restored.location).toMatchObject({ kind: 'worktree', putAway: false });
    // Its saved changes are back in its copy (the fake's restore: git's own is `vcs-git-retention.test.ts`'s).
    expect([...kit.copies.changes(copy)]).toEqual(['result.md']);
    kit.chat.sendMessage(kit.workspace.id, other, 'carry on');
    await kit.chat.settled();
    expect(kit.userMessages(other)).toEqual(['Fix the login bug', 'carry on']);
  });

  it('never discards a changed copy the confirmation did not name: the whole Keep is refused first', async () => {
    const kit = setUp();
    const { trial } = await kit.trials.start(kit.workspace.id, { text: 'Fix it', agentIds: ['a', 'b', 'c'] });
    await kit.chat.settled();
    const [keep, named, unnamed] = trial.sessionIds as [SessionId, SessionId, SessionId];
    const copyOf = (id: SessionId) => kit.core.entities.getSession(id)!.worktreePath!;
    kit.tree.dirty.set(copyOf(named), ['a.md']);
    kit.tree.dirty.set(copyOf(unnamed), ['b.md']);
    expect(await refusal(kit.trials.keep(kit.workspace.id, trial.id, { sessionId: keep, others: 'delete', discard: [named] }))).toBeInstanceOf(UncommittedChangesError);
    for (const id of [named, unnamed]) {
      expect(kit.core.entities.getSession(id)).toBeDefined();
      expect(existsSync(copyOf(id))).toBe(true);
    }
    // The kept chat can't be named, nor a chat of no trial.
    expect(await refusal(kit.trials.keep(kit.workspace.id, trial.id, { sessionId: keep, others: 'delete', discard: [keep] }))).toBeInstanceOf(InvalidOperationError);
    const { trial: done } = await kit.trials.keep(kit.workspace.id, trial.id, { sessionId: keep, others: 'delete', discard: [named, unnamed] });
    expect(done.chats.map((chat) => chat.result)).toEqual(['kept', 'removed', 'removed']);
  });

  it('keeps a named copy whose chat ran a turn after the check: its new changes were never confirmed', async () => {
    const kit = setUp();
    const { trial } = await kit.trials.start(kit.workspace.id, { text: 'Fix it', agentIds: ['a', 'b', 'c'] });
    await kit.chat.settled();
    const [keep, clean, named] = trial.sessionIds as [SessionId, SessionId, SessionId];
    const namedCopy = kit.core.entities.getSession(named)!.worktreePath!;
    kit.tree.dirty.set(namedCopy, ['a.md']);
    // While the clean copy is read (after the idle check), a turn runs in the named one and changes it.
    kit.tree.during.read = async () => {
      kit.chat.sendMessage(kit.workspace.id, named, 'more');
      await kit.chat.settled();
      kit.tree.dirty.set(namedCopy, ['a.md', 'b.md']);
    };
    const { trial: done } = await kit.trials.keep(kit.workspace.id, trial.id, { sessionId: keep, others: 'delete', discard: [named] });
    expect(done.chats.map((chat) => chat.result)).toEqual(['kept', 'removed', 'left']);
    expect(kit.core.entities.getSession(clean)).toBeUndefined();
    expect(existsSync(namedCopy)).toBe(true);
  });

  it('never puts away the chat just kept when the sweep runs after Keep', async () => {
    const kit = setUp({ keep: 1 });
    kit.bots.c.holdTurns();
    const older = await kit.chat.createChatSession(kit.workspace.id, { location: 'worktree' as const, agentId: 'c' });
    kit.chat.sendMessage(kit.workspace.id, older.id, 'work');
    await until(kit.bots.c.holding);
    // The older chat's turn is held: wait for the trial's own replies, not for every turn.
    const { trial } = await kit.trials.start(kit.workspace.id, { text: 'Fix it', agentIds: ['a', 'b'] });
    const answered = (id: SessionId) => kit.core.entities.listSessionEvents(id, ['session.message_completed']).some((event) => event.type === 'session.message_completed' && event.payload.role === 'agent');
    await until(() => trial.sessionIds.every((id) => answered(id) && kit.chat.worktreeIdle(id)));
    await kit.retention.settled();
    const [keep, other] = trial.sessionIds as [SessionId, SessionId];
    await kit.trials.keep(kit.workspace.id, trial.id, { sessionId: keep });
    await kit.retention.settled();
    expect(kit.core.worktreePutAway.get(other)).toMatchObject({ cause: 'not_kept' });
    // Over the cap (the older chat works), but the one kept stays.
    expect(kit.core.worktreePutAway.get(keep)).toBeUndefined();
    kit.bots.c.release();
    await kit.chat.settled();
  });

  it("spares a trial's copies from before their creation returns, against a sweep that spares nothing", async () => {
    const kit = setUp({ keep: 1 });
    // Another sweep, sparing no one, runs as each copy is made.
    kit.added.current = () => void kit.retention.enforce().catch(() => undefined);
    const trial = await startTwo(kit);
    for (const id of trial.sessionIds) expect(kit.core.worktreePutAway.get(id)).toBeUndefined();
  });

  it("leaves a chat made by a failed start that the user used meanwhile, with its changes", async () => {
    const kit = setUp();
    const realAdd = kit.git.vcs.addWorktree;
    let made = 0;
    kit.git.vcs.addWorktree = async (repoPath, input) => {
      if (++made === 2) {
        // The first chat was used while the second was being made.
        const first = kit.chat.listSessions(kit.workspace.id)[0]!;
        kit.chat.sendMessage(kit.workspace.id, first.id, 'hello');
        await kit.chat.settled();
        kit.tree.dirty.set(first.worktreePath!, ['mine.md']);
        throw new VcsError('git could not make the worktree', { step: 'worktree' });
      }
      return realAdd(repoPath, input);
    };
    expect(await refusal(kit.trials.start(kit.workspace.id, { text: 'Fix it', agentIds: ['a', 'b'] }))).toBeDefined();
    const left = kit.chat.listSessions(kit.workspace.id);
    expect(left).toHaveLength(1);
    expect(existsSync(left[0]!.worktreePath!)).toBe(true);
  });

  it('removes the chats made when the trial row cannot be written', async () => {
    const kit = setUp();
    const failing = { ...kit.core.trialStore, insert: () => { throw new Error('the disk is full'); } };
    const trials = createTrials({ store: failing, chat: kit.chat, isPutAway: () => false });
    expect((await refusal(trials.start(kit.workspace.id, { text: 'Fix it', agentIds: ['a', 'b'] })))?.message).toBe('the disk is full');
    expect(kit.chat.listSessions(kit.workspace.id)).toEqual([]);
    expect((await kit.trials.list(kit.workspace.id)).trials).toEqual([]);
    for (const call of kit.git.calls.filter((each) => each.startsWith('addWorktree'))) expect(existsSync(call.split(' ')[1]!)).toBe(false);
  });

  it("goes with the project's history", async () => {
    const kit = setUp();
    await startTwo(kit);
    await kit.chat.deleteHistory(kit.workspace.id, { discardUncommitted: true });
    expect((await kit.trials.list(kit.workspace.id)).trials).toEqual([]);
  });
});
