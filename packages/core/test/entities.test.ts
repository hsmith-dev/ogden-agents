import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CoreEvent, Run, Session, Workspace } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import {
  canonicalWorkspacePath,
  InvalidOperationError,
  isCaseInsensitivePath,
  NotFoundError,
  ValidationError,
} from '../src/index.js';
import { openTestCore, tempDir } from './helpers.js';

const caseInsensitive = isCaseInsensitivePath(realpathSync.native(tempDir()));

/** Swaps the case of the last path segment's letters, e.g. `.../Repo` -> `.../rEPO`. */
function otherCase(path: string): string {
  const cut = path.lastIndexOf('/') + 1 || path.lastIndexOf('\\') + 1;
  const tail = [...path.slice(cut)].map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())).join('');
  return path.slice(0, cut) + tail;
}

describe('workspaces', () => {
  it('creates a workspace with a ws_ ULID and its canonical path, and appends workspace.created', () => {
    const core = openTestCore();
    const repo = join(tempDir(), 'Repo');
    mkdirSync(repo);
    const workspace = core.entities.ensureWorkspace(repo);
    expect(Workspace.parse(workspace)).toEqual(workspace);
    expect(workspace.id).toMatch(/^ws_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(workspace.path).toBe(canonicalWorkspacePath(repo));
    const [event] = core.events.readAfter(0);
    expect(CoreEvent.parse(event)).toMatchObject({
      type: 'workspace.created',
      workspaceId: workspace.id,
      streamId: workspace.id,
      payload: { workspace },
    });
  });

  it('returns the existing workspace for the same repo reached through a symlink', () => {
    const core = openTestCore();
    const root = tempDir();
    const repo = join(root, 'repo');
    mkdirSync(repo);
    const link = join(root, 'link');
    symlinkSync(repo, link, 'junction');

    const a = core.entities.ensureWorkspace(repo);
    const b = core.entities.ensureWorkspace(link);
    const c = core.entities.ensureWorkspace(join(repo, '..', 'repo'));
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(core.entities.listWorkspaces()).toEqual([a]);
    expect(core.events.readAfter(0).filter((e) => e.type === 'workspace.created')).toHaveLength(1);
  });

  it.runIf(caseInsensitive)('returns the existing workspace for a different casing on a case-insensitive filesystem', () => {
    const core = openTestCore();
    const repo = join(tempDir(), 'MyRepo');
    mkdirSync(repo);
    const a = core.entities.ensureWorkspace(repo);
    const b = core.entities.ensureWorkspace(otherCase(repo));
    expect(b).toEqual(a);
    expect(a.path).toBe(a.path.toLowerCase());
    expect(core.entities.listWorkspaces()).toHaveLength(1);
  });

  it.runIf(!caseInsensitive)('keeps the real casing on a case-sensitive filesystem', () => {
    const repo = join(tempDir(), 'MyRepo');
    mkdirSync(repo);
    expect(canonicalWorkspacePath(repo)).toBe(realpathSync.native(repo));
    expect(isCaseInsensitivePath(realpathSync.native(repo))).toBe(false);
  });

  it('refuses a path that does not exist or is not a directory', () => {
    const core = openTestCore();
    const root = tempDir();
    const file = join(root, 'file.txt');
    writeFileSync(file, 'x');
    expect(() => core.entities.ensureWorkspace(join(root, 'missing'))).toThrow(/ENOENT/);
    expect(() => core.entities.ensureWorkspace(file)).toThrow(InvalidOperationError);
    expect(core.entities.listWorkspaces()).toEqual([]);
    expect(core.events.lastSeq()).toBe(0);
  });
});

describe('sessions', () => {
  it('creates a session with defaults and adapter refs, and appends session.created', () => {
    const core = openTestCore();
    const workspace = core.entities.ensureWorkspace(tempDir());
    const session = core.entities.createSession({
      workspaceId: workspace.id,
      kind: 'chat',
      adapterRefs: { 'agent.session': 'agent-owned-id-123' },
    });
    expect(Session.parse(session)).toEqual(session);
    expect(session).toMatchObject({ state: 'idle', driver: 'ui', title: null, kind: 'chat' });
    expect(session.id).toMatch(/^ses_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(session.adapterRefs).toEqual({ 'agent.session': 'agent-owned-id-123' });
    expect(core.entities.getSession(session.id)).toEqual(session);
    expect(core.events.readAfter(0).at(-1)).toMatchObject({
      type: 'session.created',
      workspaceId: workspace.id,
      streamId: session.id,
      payload: { session },
    });
  });

  it('merges adapter refs without an event and without touching updatedAt (AD-9)', () => {
    const core = openTestCore();
    const workspace = core.entities.ensureWorkspace(tempDir());
    const session = core.entities.createSession({ workspaceId: workspace.id, kind: 'chat', adapterRefs: { other: 'kept' } });
    const before = core.events.readAfter(0).length;
    const updated = core.entities.setSessionAdapterRefs(session.id, { agentSessionId: 'agent-owned-id-456' });
    expect(updated.adapterRefs).toEqual({ other: 'kept', agentSessionId: 'agent-owned-id-456' });
    expect(core.entities.setSessionAdapterRefs(session.id, { agentSessionId: 'agent-owned-id-789' }).adapterRefs).toEqual({
      other: 'kept',
      agentSessionId: 'agent-owned-id-789',
    });
    expect(core.entities.getSession(session.id)).toEqual({ ...session, adapterRefs: { other: 'kept', agentSessionId: 'agent-owned-id-789' } });
    expect(core.events.readAfter(0)).toHaveLength(before);
    expect(() => core.entities.setSessionAdapterRefs('ses_01J00000000000000000000000' as Session['id'], { a: 'b' })).toThrow(NotFoundError);
    expect(() => core.entities.setSessionAdapterRefs(session.id, { '': 'empty key' })).toThrow(ValidationError);
  });

  it('lists a session’s completed messages in order, and no one else’s', () => {
    const core = openTestCore();
    const workspace = core.entities.ensureWorkspace(tempDir());
    const session = core.entities.createSession({ workspaceId: workspace.id, kind: 'chat' });
    const other = core.entities.createSession({ workspaceId: workspace.id, kind: 'chat' });
    expect(core.entities.listCompletedMessages(session.id)).toEqual([]);
    core.sessionEvents.completeMessage(session.id, { messageId: 'msg_1', role: 'user', content: 'Hi' });
    core.sessionEvents.appendSessionEvent(session.id, { type: 'session.message_delta', payload: { messageId: 'msg_2', role: 'agent', text: 'Hel' } });
    core.sessionEvents.completeMessage(other.id, { messageId: 'msg_3', role: 'user', content: 'Elsewhere' });
    core.sessionEvents.completeMessage(session.id, { messageId: 'msg_2', role: 'agent', content: 'Hello.' });
    expect(core.entities.listCompletedMessages(session.id)).toEqual([
      { messageId: 'msg_1', role: 'user', content: 'Hi' },
      { messageId: 'msg_2', role: 'agent', content: 'Hello.' },
    ]);
  });

  it('changes state and driver, appending one event per real change', () => {
    const core = openTestCore();
    const workspace = core.entities.ensureWorkspace(tempDir());
    const session = core.entities.createSession({ workspaceId: workspace.id, kind: 'planning' });
    const from = core.events.lastSeq();

    expect(core.entities.setSessionState(session.id, 'working').state).toBe('working');
    expect(core.entities.setSessionState(session.id, 'working').state).toBe('working'); // no-op
    expect(core.entities.setSessionDriver(session.id, 'terminal').driver).toBe('terminal');
    expect(core.entities.getSession(session.id)).toMatchObject({ state: 'working', driver: 'terminal' });
    expect(core.entities.setSessionDriver(session.id, 'ui', 'user').driver).toBe('ui');

    const events = core.events.readAfter(from);
    expect(events.map((e) => [e.type, e.payload])).toEqual([
      ['session.state_changed', { sessionId: session.id, state: 'working', previous: 'idle' }],
      ['session.driver_changed', { sessionId: session.id, driver: 'terminal', previous: 'ui' }],
      ['session.driver_changed', { sessionId: session.id, driver: 'ui', previous: 'terminal', cause: 'user' }],
    ]);
  });

  it('rejects values outside the enums, and unknown ids, writing nothing', () => {
    const core = openTestCore();
    const workspace = core.entities.ensureWorkspace(tempDir());
    const session = core.entities.createSession({ workspaceId: workspace.id, kind: 'chat' });
    const before = core.events.lastSeq();

    expect(() => core.entities.setSessionState(session.id, 'sleeping' as never)).toThrow(ValidationError);
    expect(() => core.entities.setSessionDriver(session.id, 'robot' as never)).toThrow(ValidationError);
    expect(() => core.entities.setSessionDriver(session.id, 'terminal', 'whim' as never)).toThrow(ValidationError);
    expect(() => core.entities.createSession({ workspaceId: workspace.id, kind: 'meeting' as never })).toThrow(
      ValidationError,
    );
    expect(() =>
      core.entities.createSession({ workspaceId: 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3', kind: 'chat' }),
    ).toThrow(NotFoundError);
    expect(() => core.entities.setSessionState('ses_01J9Z3K4M5N6P7Q8R9S0T1V2W3', 'done')).toThrow(NotFoundError);

    expect(core.events.lastSeq()).toBe(before);
    expect(core.entities.listSessions(workspace.id)).toEqual([session]);
  });
});

describe('runs', () => {
  it('creates one run on a build session, stores only the ticket ref, and tracks its outcome', () => {
    const core = openTestCore();
    const workspace = core.entities.ensureWorkspace(tempDir());
    const session = core.entities.createSession({ workspaceId: workspace.id, kind: 'build' });
    const deadline = new Date(Date.now() + 3_600_000).toISOString();
    const run = core.entities.createRun({ sessionId: session.id, ticketRef: '2.3', sandbox: 'native', deadline });
    expect(Run.parse(run)).toEqual(run);
    expect(run).toMatchObject({
      sessionId: session.id,
      workspaceId: workspace.id,
      ticketRef: '2.3',
      outcome: 'running',
      sandbox: 'native',
      worktreePath: null,
      deadline,
    });
    expect(run.id).toMatch(/^run_[0-9A-HJKMNP-TV-Z]{26}$/);

    const verified = core.entities.setRunOutcome(run.id, 'verified');
    expect(verified.outcome).toBe('verified');
    expect(core.entities.getRun(run.id)).toEqual(verified);

    const events = core.events.readAfter(0).slice(-2);
    expect(events.map((e) => [e.type, e.streamId])).toEqual([
      ['run.created', session.id],
      ['run.outcome_changed', session.id],
    ]);
    expect(events[1]!.payload).toEqual({ runId: run.id, outcome: 'verified', previous: 'running' });
  });

  it('refuses a run on a non-build session, a second run, or a bad outcome', () => {
    const core = openTestCore();
    const workspace = core.entities.ensureWorkspace(tempDir());
    const chatSession = core.entities.createSession({ workspaceId: workspace.id, kind: 'chat' });
    const build = core.entities.createSession({ workspaceId: workspace.id, kind: 'build' });
    const run = core.entities.createRun({ sessionId: build.id, ticketRef: '1.1' });
    const before = core.events.lastSeq();

    expect(() => core.entities.createRun({ sessionId: chatSession.id, ticketRef: '1.1' })).toThrow(InvalidOperationError);
    expect(() => core.entities.createRun({ sessionId: build.id, ticketRef: '1.2' })).toThrow(InvalidOperationError);
    expect(() => core.entities.createRun({ sessionId: build.id, ticketRef: '' })).toThrow(ValidationError);
    expect(() => core.entities.setRunOutcome(run.id, 'built' as never)).toThrow(ValidationError);
    expect(core.events.lastSeq()).toBe(before);
  });
});
