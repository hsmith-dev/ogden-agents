/**
 * A chat turn's snapshots (AD-37; story 8.4): the chat snapshots its folder
 * just before each prompt and once it settled, and appends
 * `session.turn_changes_recorded` with the trees and counts only. A build,
 * a remote chat and a folder in no repository are not snapshotted; a
 * snapshot that fails or hangs never fails the turn. In-memory ports only.
 */
import type { ChangedFile, CoreEvent, SessionId, SessionTurnChangesRecordedEvent } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import {
  createChat,
  createTurnSnapshots,
  newId,
  withinTimeout,
  type AgentEventListener,
  type AgentPort,
  type AgentSession,
  type Core,
  type VcsFolder,
  type VcsWorkingTreePort,
} from '../src/index.js';
import { openTestCore, soleAgent, tempDir } from './helpers.js';

const until = async (check: () => boolean, what: string, ms = 10_000) => {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

/** An agent that records each prompt in `log` and replies at once. */
function agent(log: string[]): AgentPort {
  const session = (): AgentSession => {
    const listeners = new Set<AgentEventListener>();
    const emit = (event: Parameters<AgentEventListener>[0]) => listeners.forEach((listener) => listener(event));
    return {
      agentSessionId: 'a-1',
      async prompt() {
        log.push('prompt');
        emit({ type: 'state', state: 'working' });
        emit({ type: 'message_chunk', text: 'Done.' });
        emit({ type: 'state', state: 'idle' });
        return { stopReason: 'end_turn' };
      },
      async cancel() {},
      async close() {},
      onEvent(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async setPermissionMode() {},
    };
  };
  return { displayName: 'Test Agent', skillInvocation: (skill) => `/${skill}`, listAuthMethods: async () => [], startSession: async () => session(), reopenSession: async () => ({ session: session(), restored: 'resumed' }) };
}

const changed = (path: string, additions: number, deletions: number): ChangedFile => ({ path, change: 'changed', additions, deletions, binary: false, tooLarge: false });

/** A port whose snapshots answer trees in turn (or `mode` says otherwise), recording each call in `log`. */
function port(log: string[], mode: 'trees' | 'no_repo' | 'throws' = 'trees') {
  let next = 0;
  const folders: VcsFolder[] = [];
  const vcs: VcsWorkingTreePort = {
    changedFiles: async () => ({ files: [changed('a.txt', 2, 1), changed('.git/config', 9, 9), changed('b.txt', 1, 0)], truncated: false }),
    fileDiff: async () => undefined,
    snapshot: async (folder) => {
      folders.push(folder);
      log.push('snapshot');
      if (mode === 'throws') throw new Error('git failed');
      if (mode === 'no_repo') return undefined;
      return (++next).toString(16).padStart(40, '0');
    },
    commitAll: async () => 'nothing',
  };
  return { vcs, folders };
}

function setUp(mode?: 'trees' | 'no_repo' | 'throws') {
  const log: string[] = [];
  const { vcs, folders } = port(log, mode);
  const core: Core = openTestCore(undefined, undefined, { vcsWorkingTreePort: vcs });
  const chat = createChat({
    dataDir: tempDir('ogden-agents-data-'),
    entities: core.entities,
    sessionEvents: core.sessionEvents,
    agents: soleAgent(agent(log)),
    agentEnv: () => ({}),
    events: core.events,
    installSettings: core.installSettings,
    turnSnapshots: core.turnSnapshots,
  });
  const workspace = chat.openWorkspace(tempDir('ogden-agents-repo-'));
  return { core, chat, workspace, log, folders };
}

const recorded = (core: Core, sessionId: SessionId) =>
  core.events.readAfter(0).filter((event: CoreEvent): event is SessionTurnChangesRecordedEvent => event.streamId === sessionId && event.type === 'session.turn_changes_recorded');

describe('turn snapshots (story 8.4)', () => {
  it('snapshots before and after each prompt and records the trees and counts only', async () => {
    const { core, chat, workspace, log, folders } = setUp();
    const session = await chat.createChatSession(workspace.id);
    chat.sendMessage(workspace.id, session.id, 'one');
    await until(() => recorded(core, session.id).length === 1, 'the first turn');
    chat.sendMessage(workspace.id, session.id, 'two');
    await until(() => recorded(core, session.id).length === 2, 'the second turn');
    expect(log).toEqual(['snapshot', 'prompt', 'snapshot', 'snapshot', 'prompt', 'snapshot']);
    const [first, second] = recorded(core, session.id).map((event) => event.payload);
    // A refused path the port named is not counted.
    expect(first).toEqual({ sessionId: session.id, turnId: expect.stringMatching(/^trn_/), startTree: '1'.padStart(40, '0'), endTree: '2'.padStart(40, '0'), files: 2, additions: 3, deletions: 1 });
    expect(second).toMatchObject({ startTree: '3'.padStart(40, '0'), endTree: '4'.padStart(40, '0') });
    expect(folders[0]).toEqual({ path: workspace.realPath ?? workspace.path });
    expect((await core.workspaceChanges!.turns(workspace.id, session.id)).turns.map((turn) => turn.id)).toEqual([second!.turnId, first!.turnId]);
  });

  it('runs the turn and records nothing in a folder in no repository, or when the snapshot fails', async () => {
    for (const mode of ['no_repo', 'throws'] as const) {
      const { core, chat, workspace, log } = setUp(mode);
      const session = await chat.createChatSession(workspace.id);
      chat.sendMessage(workspace.id, session.id, 'one');
      await until(() => log.includes('prompt') && core.entities.getSession(session.id)?.state === 'idle', `the turn (${mode})`);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(recorded(core, session.id), mode).toEqual([]);
      expect(core.events.readAfter(0).some((event) => event.streamId === session.id && event.type === 'session.message_completed' && event.payload.content === 'Done.'), mode).toBe(true);
    }
  });

  it('never snapshots a build or a remote chat', async () => {
    const log: string[] = [];
    const { vcs } = port(log);
    const core = openTestCore(undefined, undefined, { vcsWorkingTreePort: vcs });
    const workspace = core.entities.ensureWorkspace(tempDir());
    const snapshots = createTurnSnapshots({ entities: core.entities, sessionEvents: core.sessionEvents, port: vcs });
    for (const input of [{ kind: 'build' as const }, { kind: 'chat' as const, machineId: newId('mach') }]) {
      const session = core.entities.createSession({ workspaceId: workspace.id, ...input });
      expect(await snapshots.start(session.id), input.kind).toBeUndefined();
    }
    expect(log).toEqual([]);
  });

  it('gives up on a snapshot that takes too long, leaving the work to finish unseen', async () => {
    const started = Date.now();
    expect(await withinTimeout(new Promise<string>(() => undefined), 50)).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(await withinTimeout(Promise.reject(new Error('x')), 50)).toBeUndefined();
    expect(await withinTimeout(Promise.resolve('tree'), 50)).toBe('tree');
  });
});
