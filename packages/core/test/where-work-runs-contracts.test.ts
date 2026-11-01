/**
 * Epic 27 entry 2's core contract (CAP-35; user decision 2026-11-01, AD-8
 * CAP-33 note): `setSessionWorktree`, the only writer of a chat's worktree
 * after creation. It moves a chat to its own worktree and back, appending
 * `session.location_changed` with the row in one transaction; it writes
 * nothing when the place is unchanged; and it refuses a bad path or branch,
 * one without the other, a build or planning session, a remote chat and a
 * chat whose agent works or waits. The where-work-runs use-cases are
 * contracts only: absent from core until their lanes (retention, 27.6, is
 * made over the server's chat).
 */
import { join } from 'node:path';
import { chatWorktreeBranch, type SessionId, type SessionLocationChangedEvent } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { AgentMidTurnError, InvalidOperationError, newId, NotFoundError, ValidationError, type Core } from '../src/index.js';
import { openTestCore, tempDir } from './helpers.js';

function setUp() {
  const core = openTestCore();
  const workspace = core.entities.ensureWorkspace(tempDir());
  return { core, workspace };
}

const moves = (core: Core, sessionId: SessionId): SessionLocationChangedEvent['payload'][] =>
  core.events
    .readAfter(0)
    .filter((event): event is SessionLocationChangedEvent => event.type === 'session.location_changed' && event.streamId === sessionId)
    .map((event) => event.payload);

describe('setSessionWorktree: Hand off is the one writer of a chat worktree after creation', () => {
  it('moves a this-folder chat to its own worktree and back, each with its event', () => {
    const { core, workspace } = setUp();
    const chat = core.entities.createSession({ workspaceId: workspace.id, kind: 'chat' });
    const worktreePath = join(tempDir(), 'worktree');
    const branch = chatWorktreeBranch(chat.id);

    const there = core.entities.setSessionWorktree(chat.id, { worktreePath, branch, files: 3, resumes: true });
    expect(there.session).toMatchObject({ worktreePath, branch });
    expect(core.entities.getSession(chat.id)).toMatchObject({ worktreePath, branch });
    expect(there.event?.payload).toEqual({ sessionId: chat.id, location: 'worktree', previous: 'this_folder', branch, files: 3, resumes: true });

    const back = core.entities.setSessionWorktree(chat.id, { worktreePath: null, branch: null, files: 0, resumes: false });
    expect(core.entities.getSession(chat.id)).toMatchObject({ worktreePath: null, branch: null });
    expect(back.event?.payload).toEqual({ sessionId: chat.id, location: 'this_folder', previous: 'worktree', branch: null, files: 0, resumes: false });
    expect(moves(core, chat.id)).toHaveLength(2);
    // No path in any event.
    expect(JSON.stringify(core.events.readAfter(0).filter((event) => event.type === 'session.location_changed'))).not.toContain(worktreePath);
  });

  it('writes nothing when the chat is already there', () => {
    const { core, workspace } = setUp();
    const chat = core.entities.createSession({ workspaceId: workspace.id, kind: 'chat' });
    const before = core.events.lastSeq();
    const result = core.entities.setSessionWorktree(chat.id, { worktreePath: null, branch: null, files: 0, resumes: true });
    expect(result.event).toBeUndefined();
    expect(result.session.updatedAt).toBe(chat.updatedAt);
    const worktreePath = join(tempDir(), 'w');
    core.entities.setSessionWorktree(chat.id, { worktreePath, branch: chatWorktreeBranch(chat.id), files: 1, resumes: true });
    expect(core.entities.setSessionWorktree(chat.id, { worktreePath, branch: chatWorktreeBranch(chat.id), files: 1, resumes: true }).event).toBeUndefined();
    expect(core.events.readAfter(before).map((event) => event.type)).toEqual(['session.location_changed']);
  });

  it('refuses a wrong branch, a relative path, one without the other, or a bad count, changing nothing', () => {
    const { core, workspace } = setUp();
    const chat = core.entities.createSession({ workspaceId: workspace.id, kind: 'chat' });
    const absolute = join(tempDir(), 'w');
    const refused = [
      { worktreePath: absolute, branch: chatWorktreeBranch(newId('ses')), files: 0, resumes: false },
      { worktreePath: 'relative/w', branch: chatWorktreeBranch(chat.id), files: 0, resumes: false },
      { worktreePath: absolute, branch: null, files: 0, resumes: false },
      { worktreePath: null, branch: chatWorktreeBranch(chat.id), files: 0, resumes: false },
      { worktreePath: absolute, branch: chatWorktreeBranch(chat.id), files: -1, resumes: false },
      { worktreePath: absolute, branch: chatWorktreeBranch(chat.id), files: 1.5, resumes: false },
    ];
    for (const change of refused) expect(() => core.entities.setSessionWorktree(chat.id, change), JSON.stringify(change)).toThrow(ValidationError);
    expect(core.entities.getSession(chat.id)).toMatchObject({ worktreePath: null, branch: null });
    expect(moves(core, chat.id)).toEqual([]);
    expect(() => core.entities.setSessionWorktree(newId('ses'), { worktreePath: null, branch: null, files: 0, resumes: false })).toThrow(NotFoundError);
  });

  it('refuses a build or planning session and a remote chat (invalid operation), and a chat mid-turn (agent mid turn)', () => {
    const { core, workspace } = setUp();
    const to = (id: SessionId) => ({ worktreePath: join(tempDir(), 'w'), branch: chatWorktreeBranch(id), files: 0, resumes: false });
    for (const kind of ['build', 'planning'] as const) {
      const session = core.entities.createSession({ workspaceId: workspace.id, kind });
      expect(() => core.entities.setSessionWorktree(session.id, to(session.id)), kind).toThrow(InvalidOperationError);
    }
    const remote = core.entities.createSession({ workspaceId: workspace.id, kind: 'chat', machineId: newId('mach') });
    expect(() => core.entities.setSessionWorktree(remote.id, to(remote.id))).toThrow(InvalidOperationError);
    for (const state of ['working', 'waiting'] as const) {
      const chat = core.entities.createSession({ workspaceId: workspace.id, kind: 'chat', state });
      expect(() => core.entities.setSessionWorktree(chat.id, to(chat.id)), state).toThrow(AgentMidTurnError);
      expect(core.entities.getSession(chat.id)?.worktreePath).toBeNull();
    }
    expect(core.events.readAfter(0).some((event) => event.type === 'session.location_changed')).toBe(false);
  });

  it('writes the row and its event in one transaction: both roll back together, and the event is delivered with the row already changed', () => {
    const { core, workspace } = setUp();
    const chat = core.entities.createSession({ workspaceId: workspace.id, kind: 'chat' });
    const change = { worktreePath: join(tempDir(), 'w'), branch: chatWorktreeBranch(chat.id), files: 2, resumes: true };
    expect(() =>
      core.events.transaction(() => {
        core.entities.setSessionWorktree(chat.id, change);
        throw new Error('roll back');
      }),
    ).toThrow('roll back');
    expect(core.entities.getSession(chat.id)?.worktreePath).toBeNull();
    expect(moves(core, chat.id)).toEqual([]);

    const seen: Array<string | null | undefined> = [];
    core.events.subscribe(core.events.lastSeq(), (event) => {
      if (event.type === 'session.location_changed') seen.push(core.entities.getSession(chat.id)?.worktreePath);
    });
    core.entities.setSessionWorktree(chat.id, change);
    expect(seen).toEqual([change.worktreePath]);
  });

  it('leaves the where-work-runs use-cases undefined until their lanes (retention and trials are made over the server chat, 27.6, 27.8)', () => {
    const { core } = setUp();
    expect([core.chatLocations, core.worktreePorts]).toEqual([undefined, undefined]);
    expect(typeof core.createWorktreeRetention).toBe('function');
    expect(typeof core.createTrials).toBe('function');
  });
});
