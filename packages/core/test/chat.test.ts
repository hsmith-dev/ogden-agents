/**
 * The chat use-case against a scripted AgentPort: the user's message and the
 * reply go through the session-event helper, the state follows the adapter's
 * signals (AD-4), and an agent that can't start or crashes leaves the session
 * in `error` with a plain reason.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { MAX_DIFF_TEXT_LENGTH, type CoreEvent, type SessionId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import {
  AgentError,
  createChat,
  createDecliningPermissions,
  InvalidOperationError,
  NotFoundError,
  RESTARTED_REASON,
  SessionBusyError,
  WorkspaceBusyError,
  type AgentEvent,
  type AgentPort,
  type AgentSession,
  type Core,
  type Permissions,
  type StartAgentSession,
} from '../src/index.js';
import { openTestCore, tempDir } from './helpers.js';

/** An agent whose every prompt runs `script`, which reports through `emit`. */
function scriptedAgent(
  script: (text: string, emit: (event: AgentEvent) => void, ask: StartAgentSession['onPermissionRequest']) => Promise<{ stopReason: string }>,
) {
  const starts: Array<{ cwd: string; env: Readonly<Record<string, string>> }> = [];
  let closed = 0;
  const port: AgentPort = {
    displayName: 'Test Agent',
    reopenSession: () => Promise.reject(new Error('not in this test')),
    listAuthMethods: async () => [],
    async startSession(input) {
      starts.push({ cwd: input.cwd, env: input.env });
      const listeners = new Set<(event: AgentEvent) => void>();
      const emit = (event: AgentEvent) => {
        for (const listener of [...listeners]) listener(event);
      };
      const session: AgentSession = {
        agentSessionId: `agent-${starts.length}`,
        onEvent(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        async prompt(text) {
          emit({ type: 'state', state: 'working' });
          try {
            const result = await script(text, emit, input.onPermissionRequest);
            emit({ type: 'state', state: 'idle' });
            return result;
          } catch (error) {
            // A prompt that failed with the process still alive: not fatal.
            const failure = error instanceof AgentError ? error : new AgentError('agent_failed', 'Test Agent stopped with an error.');
            emit({ type: 'state', state: 'error', reason: failure.message });
            throw failure;
          }
        },
        async cancel() {},
        async close() {
          closed++;
        },
      };
      return session;
    },
  };
  return { port, starts, closed: () => closed };
}

const hello = scriptedAgent(async (_text, emit) => {
  for (const text of ['Hello', ' there']) emit({ type: 'message_chunk', text });
  return { stopReason: 'end_turn' };
});

function setUp(core: Core, port: AgentPort, env: Record<string, string> = {}, dataDir = tempDir('ogden-agents-data-'), permissions?: Permissions) {
  const errors: Array<[SessionId, AgentError]> = [];
  const chat = createChat({
    dataDir,
    entities: core.entities,
    sessionEvents: core.sessionEvents,
    agent: port,
    ...(permissions === undefined ? {} : { permissions }),
    agentEnv: () => env,
    onAgentError: (sessionId, error) => errors.push([sessionId, error]),
  });
  const repo = tempDir('ogden-agents-repo-');
  const workspace = chat.openWorkspace(repo);
  const session = chat.createChatSession(workspace.id);
  return { chat, workspace, session, errors, repo };
}

/** The session's events, as the UI would see them. */
const sessionEvents = (core: Core, sessionId: SessionId): CoreEvent[] =>
  core.events.readAfter(0).filter((event) => event.streamId === sessionId);

describe('chat', () => {
  it('a message is stored, the reply streams, and the session goes working then idle', async () => {
    const core = openTestCore();
    const live: CoreEvent[] = [];
    core.events.subscribe(0, (event) => live.push(event));
    const agent = scriptedAgent(async (_text, emit) => {
      for (const text of ['Hello', ' there']) emit({ type: 'message_chunk', text });
      return { stopReason: 'end_turn' };
    });
    const { chat, workspace, session, repo } = setUp(core, agent.port, { ANTHROPIC_API_KEY: 'from-core' });

    const { messageId } = chat.sendMessage(workspace.id, session.id, 'Say hello in five words');
    expect(messageId).toMatch(/^msg_/);
    await chat.settled();

    const mine = live.filter((event) => event.streamId === session.id);
    expect(mine.map((event) => event.type)).toEqual([
      'session.created',
      'session.message_completed', // the user's message
      'session.state_changed', // working
      'session.message_delta',
      'session.message_delta',
      'session.message_completed', // the reply
      'session.state_changed', // idle
    ]);
    expect(mine.every((event) => event.workspaceId === workspace.id)).toBe(true);
    const completed = mine.filter((event) => event.type === 'session.message_completed');
    expect(completed.map((event) => [event.payload.role, event.payload.content])).toEqual([
      ['user', 'Say hello in five words'],
      ['agent', 'Hello there'],
    ]);
    const states = mine.filter((event) => event.type === 'session.state_changed').map((event) => event.payload.state);
    expect(states).toEqual(['working', 'idle']);
    // The reply's deltas were pruned once it completed (AD-5).
    expect(sessionEvents(core, session.id).some((event) => event.type === 'session.message_delta')).toBe(false);
    // Core passed the workspace's folder and its environment to the agent.
    // The real-cased path, not the case-folded key (AD-2).
    expect(agent.starts).toEqual([{ cwd: realpathSync.native(repo), env: { ANTHROPIC_API_KEY: 'from-core' } }]);
    expect(workspace.realPath).toBe(realpathSync.native(repo));
  });

  it('keeps one agent session per chat across messages', async () => {
    const core = openTestCore();
    const agent = scriptedAgent(async (_t, emit) => (emit({ type: 'message_chunk', text: 'ok' }), { stopReason: 'end_turn' }));
    const { chat, workspace, session } = setUp(core, agent.port);
    chat.sendMessage(workspace.id, session.id, 'one');
    await chat.settled();
    chat.sendMessage(workspace.id, session.id, 'two');
    await chat.settled();
    expect(agent.starts).toHaveLength(1);
    await chat.close();
    expect(agent.closed()).toBe(1);
  });

  it('refuses a second message while the agent is answering', async () => {
    const core = openTestCore();
    let finish!: () => void;
    const agent = scriptedAgent(() => new Promise((resolve) => (finish = () => resolve({ stopReason: 'end_turn' }))));
    const { chat, workspace, session } = setUp(core, agent.port);
    chat.sendMessage(workspace.id, session.id, 'one');
    expect(() => chat.sendMessage(workspace.id, session.id, 'two')).toThrow(SessionBusyError);
    await new Promise((resolve) => setTimeout(resolve, 0));
    finish();
    await chat.settled();
    expect(() => chat.sendMessage(workspace.id, session.id, 'three')).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    finish();
    await chat.settled();
  });

  it('an agent that can’t be started puts the session in error with a plain reason, and the next message tries again', async () => {
    const core = openTestCore();
    let attempts = 0;
    const port: AgentPort = {
      displayName: 'Test Agent',
      reopenSession: () => Promise.reject(new Error('not in this test')),
      listAuthMethods: async () => [],
      async startSession() {
        attempts++;
        throw new AgentError('agent_unavailable', "Test Agent isn't set up on this computer yet.", { details: { adapterPath: '/nowhere' } });
      },
    };
    const { chat, workspace, session, errors } = setUp(core, port);
    chat.sendMessage(workspace.id, session.id, 'hello');
    await chat.settled();
    const last = sessionEvents(core, session.id).at(-1)!;
    expect(last).toMatchObject({
      type: 'session.state_changed',
      payload: { state: 'error', previous: 'working', reason: "Test Agent isn't set up on this computer yet." },
    });
    expect(core.entities.getSession(session.id)!.state).toBe('error');
    expect(errors.map(([, error]) => error.code)).toEqual(['agent_unavailable']);

    chat.sendMessage(workspace.id, session.id, 'again');
    await chat.settled();
    expect(attempts).toBe(2);
  });

  it('an agent that crashes mid-reply keeps what it wrote, ends in error, and never hangs', async () => {
    const core = openTestCore();
    const agent = scriptedAgent(async (_text, emit) => {
      emit({ type: 'message_chunk', text: 'About to ' });
      // The process went away: the adapter says so with `fatal`.
      emit({ type: 'state', state: 'error', reason: 'Test Agent stopped unexpectedly.', fatal: true });
      throw new AgentError('agent_failed', 'Test Agent stopped unexpectedly.');
    });
    const { chat, workspace, session } = setUp(core, agent.port);
    chat.sendMessage(workspace.id, session.id, 'crash');
    await chat.settled();
    const events = sessionEvents(core, session.id);
    const reply = events.filter((e) => e.type === 'session.message_completed').at(-1)!;
    expect(reply).toMatchObject({ payload: { role: 'agent', content: 'About to ' } });
    const states = events.filter((e) => e.type === 'session.state_changed').map((e) => e.payload.state);
    expect(states).toEqual(['working', 'error']);
    expect(core.entities.getSession(session.id)!.state).toBe('error');
    // The dead agent was let go; the next message starts a new one.
    expect(agent.closed()).toBe(1);
    chat.sendMessage(workspace.id, session.id, 'again');
    await chat.settled();
    expect(agent.starts).toHaveLength(2);
  });

  it('a failed prompt with the agent still running keeps its agent session; the next message uses it', async () => {
    const core = openTestCore();
    const agent = scriptedAgent(async (text, emit) => {
      if (text === 'fail') throw new AgentError('agent_failed', 'Test Agent is rate limited. Try again in a minute.');
      emit({ type: 'message_chunk', text: 'ok' });
      return { stopReason: 'end_turn' };
    });
    const { chat, workspace, session } = setUp(core, agent.port);
    chat.sendMessage(workspace.id, session.id, 'fail');
    await chat.settled();
    expect(core.entities.getSession(session.id)!.state).toBe('error');
    expect(sessionEvents(core, session.id).at(-1)).toMatchObject({ payload: { state: 'error', reason: 'Test Agent is rate limited. Try again in a minute.' } });
    expect(agent.closed()).toBe(0);

    chat.sendMessage(workspace.id, session.id, 'hello');
    await chat.settled();
    expect(core.entities.getSession(session.id)!.state).toBe('idle');
    expect(agent.starts).toHaveLength(1);
  });

  it('closing with a turn in flight leaves the session idle and resumable, not working', async () => {
    const core = openTestCore();
    const agent = scriptedAgent(() => new Promise(() => {}));
    const { chat, workspace, session } = setUp(core, agent.port);
    chat.sendMessage(workspace.id, session.id, 'hello');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(core.entities.getSession(session.id)!.state).toBe('working');
    await chat.close();
    expect(core.entities.getSession(session.id)!.state).toBe('idle');
    expect(sessionEvents(core, session.id).at(-1)).toMatchObject({
      type: 'session.state_changed',
      payload: { state: 'idle', previous: 'working', reason: RESTARTED_REASON, resumable: true },
    });
    expect(agent.closed()).toBe(1);
    expect(() => chat.sendMessage(workspace.id, session.id, 'again')).toThrow(InvalidOperationError);
  });

  it('closing while an agent is still starting waits until that agent is stopped', async () => {
    const core = openTestCore();
    let finishStart!: () => void;
    let closedAgents = 0;
    const port: AgentPort = {
      displayName: 'Test Agent',
      reopenSession: () => Promise.reject(new Error('not in this test')),
      listAuthMethods: async () => [],
      async startSession() {
        await new Promise<void>((resolve) => (finishStart = resolve));
        return {
          agentSessionId: 'slow-start',
          onEvent: () => () => undefined,
          prompt: () => new Promise(() => {}),
          cancel: async () => {},
          close: async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
            closedAgents++;
          },
        };
      },
    };
    const { chat, workspace, session } = setUp(core, port);
    chat.sendMessage(workspace.id, session.id, 'hello');
    const closing = chat.close();
    finishStart();
    await closing;
    expect(closedAgents).toBe(1);
    expect(core.entities.getSession(session.id)!.state).toBe('idle');
  });

  it('settles sessions a stopped server left working or waiting: idle, resumable (AD-3)', () => {
    const core = openTestCore();
    const { chat, workspace } = setUp(core, hello.port);
    const working = chat.createChatSession(workspace.id);
    const waiting = chat.createChatSession(workspace.id);
    const idle = chat.createChatSession(workspace.id);
    core.entities.setSessionState(working.id, 'working');
    core.entities.setSessionState(waiting.id, 'waiting');
    const settled = core.entities.settleInterruptedSessions(RESTARTED_REASON);
    expect(settled.map((s) => s.id).sort()).toEqual([working.id, waiting.id].sort());
    for (const id of [working.id, waiting.id]) {
      expect(core.entities.getSession(id)!.state).toBe('idle');
      expect(sessionEvents(core, id).at(-1)).toMatchObject({ payload: { state: 'idle', reason: RESTARTED_REASON, resumable: true } });
    }
    expect(sessionEvents(core, idle.id).map((e) => e.type)).toEqual(['session.created']);
  });

  it('refuses a relative path, and Ogden Agents’ data folder, anything in it, or any folder above it', () => {
    const core = openTestCore();
    const dataDir = join(tempDir('ogden-agents-parent-'), 'data');
    mkdirSync(join(dataDir, 'logs'), { recursive: true });
    const { chat } = setUp(core, hello.port, {}, dataDir);
    expect(() => chat.openWorkspace('.')).toThrow(/full path/);
    expect(() => chat.openWorkspace('some/repo')).toThrow(/full path/);
    for (const path of [dataDir, join(dataDir, 'logs'), dirname(dataDir), `${dataDir}/../data`]) {
      expect(() => chat.openWorkspace(path), path).toThrow(/Ogden Agents' own data/);
    }
    expect(core.entities.listWorkspaces().map((w) => w.realPath)).not.toContain(realpathSync.native(dataDir));
  });

  it('expands a leading ~ to the user’s home', () => {
    const core = openTestCore();
    const { chat } = setUp(core, hello.port);
    // A folder of its own in the home folder: on Windows the temp data folder sits
    // inside home, so `~` itself is (rightly) refused as an ancestor of it.
    const inHome = mkdtempSync(join(homedir(), '.ogden-agents-test-'));
    try {
      expect(chat.openWorkspace(`~/${basename(inHome)}`).realPath).toBe(realpathSync.native(inHome));
    } finally {
      rmSync(inHome, { recursive: true, force: true });
    }
  });

  it('a session is found only through its own workspace', () => {
    const core = openTestCore();
    const { chat, session } = setUp(core, hello.port);
    const other = chat.openWorkspace(tempDir('ogden-agents-repo-'));
    expect(() => chat.getSession(other.id, session.id)).toThrow(NotFoundError);
    expect(() => chat.sendMessage(other.id, session.id, 'hello')).toThrow(NotFoundError);
    expect(sessionEvents(core, session.id).map((e) => e.type)).toEqual(['session.created']);
  });

  it('refuses chat input while the terminal drives the session (AD-6)', () => {
    const core = openTestCore();
    const { chat, workspace, session } = setUp(core, hello.port);
    core.entities.setSessionDriver(session.id, 'terminal');
    expect(() => chat.sendMessage(workspace.id, session.id, 'hello')).toThrow(InvalidOperationError);
  });

  it('opening a path that is not a folder is refused in plain words; the same repo is one workspace', () => {
    const core = openTestCore();
    const { chat, workspace, repo } = setUp(core, hello.port);
    expect(() => chat.openWorkspace(`${repo}/does-not-exist`)).toThrow(/no folder at that path/);
    expect(chat.openWorkspace(repo).id).toBe(workspace.id);
  });
});

describe('tool calls and permission requests', () => {
  it('appends each tool call and its updates as session events, the whole call each time', async () => {
    const core = openTestCore();
    const agent = scriptedAgent(async (_text, emit) => {
      emit({ type: 'tool_call', toolCallId: 't1', title: 'Edit src/a.ts', kind: 'edit', status: 'in_progress' });
      emit({ type: 'tool_call_update', toolCallId: 't1', status: 'completed', diffs: [{ path: 'src/a.ts', oldText: null, newText: 'x' }] });
      emit({ type: 'tool_call', toolCallId: 't2', title: 'Something new', kind: 'not-an-acp-kind' });
      return { stopReason: 'end_turn' };
    });
    const { chat, workspace, session } = setUp(core, agent.port);
    chat.sendMessage(workspace.id, session.id, 'edit it');
    await chat.settled();
    const calls = sessionEvents(core, session.id).filter((e) => e.type === 'session.tool_call' || e.type === 'session.tool_call_updated');
    expect(calls.map((e) => [e.type, e.workspaceId, e.payload])).toEqual([
      ['session.tool_call', workspace.id, { sessionId: session.id, toolCallId: 't1', title: 'Edit src/a.ts', kind: 'edit', status: 'in_progress' }],
      [
        'session.tool_call_updated',
        workspace.id,
        { sessionId: session.id, toolCallId: 't1', title: 'Edit src/a.ts', kind: 'edit', status: 'completed', diffs: [{ path: 'src/a.ts', oldText: null, newText: 'x' }] },
      ],
      // An unknown kind is `other`; a missing status is `pending`.
      ['session.tool_call', workspace.id, { sessionId: session.id, toolCallId: 't2', title: 'Something new', kind: 'other', status: 'pending' }],
    ]);
  });

  it('an update that only changes the status carries no diffs; one that changes them does (review F1)', async () => {
    const core = openTestCore();
    const diff = { path: 'src/a.ts', oldText: 'a', newText: 'b' };
    const agent = scriptedAgent(async (_text, emit) => {
      emit({ type: 'tool_call', toolCallId: 't1', title: 'Edit src/a.ts', kind: 'edit', status: 'pending', diffs: [diff] });
      emit({ type: 'tool_call_update', toolCallId: 't1', status: 'in_progress' });
      emit({ type: 'tool_call_update', toolCallId: 't1', status: 'in_progress', diffs: [diff] });
      emit({ type: 'tool_call_update', toolCallId: 't1', status: 'completed', diffs: [{ ...diff, newText: 'c' }] });
      return { stopReason: 'end_turn' };
    });
    const { chat, workspace, session } = setUp(core, agent.port);
    chat.sendMessage(workspace.id, session.id, 'edit it');
    await chat.settled();
    const updates = sessionEvents(core, session.id).filter((e) => e.type === 'session.tool_call_updated');
    expect(updates.map((e) => [e.payload.status, e.payload.diffs])).toEqual([
      ['in_progress', undefined],
      // The same diffs again: still left out.
      ['in_progress', undefined],
      ['completed', [{ ...diff, newText: 'c' }]],
    ]);
  });

  it('cuts each side of an oversize diff to the shared cap and flags it truncated, before it is appended', async () => {
    const core = openTestCore();
    const big = 'x'.repeat(MAX_DIFF_TEXT_LENGTH + 10);
    const agent = scriptedAgent(async (_text, emit) => {
      emit({ type: 'tool_call', toolCallId: 't1', title: 'Write big.txt', kind: 'edit', diffs: [{ path: 'big.txt', oldText: null, newText: big }] });
      emit({ type: 'tool_call_update', toolCallId: 't1', status: 'completed', diffs: [{ path: 'small.txt', oldText: big, newText: 'ok' }] });
      return { stopReason: 'end_turn' };
    });
    const { chat, workspace, session } = setUp(core, agent.port);
    chat.sendMessage(workspace.id, session.id, 'write it');
    await chat.settled();
    const calls = sessionEvents(core, session.id).filter((e) => e.type === 'session.tool_call' || e.type === 'session.tool_call_updated');
    expect(calls.map((e) => e.payload.diffs)).toEqual([
      [{ path: 'big.txt', oldText: null, newText: 'x'.repeat(MAX_DIFF_TEXT_LENGTH), truncated: true }],
      [{ path: 'small.txt', oldText: 'x'.repeat(MAX_DIFF_TEXT_LENGTH), newText: 'ok', truncated: true }],
    ]);
  });

  it('by default denies every permission request and appends no permission event', async () => {
    const core = openTestCore();
    const decisions: unknown[] = [];
    const agent = scriptedAgent(async (_text, _emit, ask) => {
      decisions.push(await ask!({ toolCallId: 't1', title: 'Run npm test', kind: 'execute', command: 'npm test' }));
      return { stopReason: 'end_turn' };
    });
    const { chat, workspace, session } = setUp(core, agent.port);
    chat.sendMessage(workspace.id, session.id, 'run the tests');
    await chat.settled();
    expect(decisions).toEqual([{ outcome: 'deny' }]);
    expect(core.events.readAfter(0).some((e) => e.type.startsWith('permission.'))).toBe(false);
  });

  it('passes each request to the permissions it is given, with the session; one that fails is a deny', async () => {
    const core = openTestCore();
    const asked: Array<[SessionId, string]> = [];
    const permissions: Permissions = {
      ...createDecliningPermissions(),
      request: async (sessionId, request) => {
        asked.push([sessionId, request.toolCallId]);
        if (request.toolCallId === 'broken') throw new Error('boom');
        return { outcome: 'allow_once' };
      },
    };
    const decisions: unknown[] = [];
    const agent = scriptedAgent(async (_text, _emit, ask) => {
      decisions.push(await ask!({ toolCallId: 't1', title: 'Run npm test' }));
      decisions.push(await ask!({ toolCallId: 'broken', title: 'Run it' }));
      return { stopReason: 'end_turn' };
    });
    const { chat, workspace, session } = setUp(core, agent.port, {}, undefined, permissions);
    chat.sendMessage(workspace.id, session.id, 'run');
    await chat.settled();
    expect(asked).toEqual([
      [session.id, 't1'],
      [session.id, 'broken'],
    ]);
    expect(decisions).toEqual([{ outcome: 'allow_once' }, { outcome: 'deny' }]);
  });

  it('answers sendMessage with queued: false while there is no queue (2.10)', async () => {
    const core = openTestCore();
    const { chat, workspace, session } = setUp(core, hello.port);
    expect(chat.sendMessage(workspace.id, session.id, 'hi')).toMatchObject({ queued: false });
    await chat.settled();
  });
});

describe('workspaces and history (story 2.5)', () => {
  it('lists workspaces and their sessions; an unknown workspace is not found', () => {
    const core = openTestCore();
    const { chat, workspace, session } = setUp(core, hello.port);
    const other = chat.openWorkspace(tempDir('ogden-agents-repo-'));
    expect(chat.listWorkspaces()).toEqual([workspace, other]);
    expect(chat.getWorkspace(other.id)).toEqual(other);
    expect(chat.listSessions(workspace.id)).toEqual([session]);
    expect(chat.listSessions(other.id)).toEqual([]);
    const unknown = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3' as typeof workspace.id;
    expect(() => chat.getWorkspace(unknown)).toThrow(NotFoundError);
    expect(() => chat.listSessions(unknown)).toThrow(NotFoundError);
    expect(() => chat.deleteHistory(unknown)).toThrow(NotFoundError);
  });

  it('deletes one workspace’s history, keeps the other’s, and stops the deleted sessions’ idle agents', async () => {
    const core = openTestCore();
    const agent = scriptedAgent(async (_t, emit) => (emit({ type: 'message_chunk', text: 'ok' }), { stopReason: 'end_turn' }));
    const { chat, workspace, session } = setUp(core, agent.port);
    chat.sendMessage(workspace.id, session.id, 'hi');
    await chat.settled();
    const other = chat.openWorkspace(tempDir('ogden-agents-repo-'));
    const kept = chat.createChatSession(other.id);

    const deleted = chat.deleteHistory(workspace.id);
    expect(deleted.deletedSessions).toBe(1);
    expect(deleted.deletedEvents).toBeGreaterThan(0);
    expect(chat.listSessions(workspace.id)).toEqual([]);
    expect(chat.getWorkspace(workspace.id)).toEqual(workspace);
    expect(chat.listSessions(other.id)).toEqual([kept]);
    expect(core.events.readAfter(0).some((e) => e.streamId === kept.id && e.type === 'session.created')).toBe(true);
    // The agent process of the deleted session was stopped.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(agent.closed()).toBe(1);
  });

  it('refuses while a session is working, deleting nothing', async () => {
    const core = openTestCore();
    let finish!: () => void;
    const agent = scriptedAgent(() => new Promise((resolve) => (finish = () => resolve({ stopReason: 'end_turn' }))));
    const { chat, workspace, session } = setUp(core, agent.port);
    chat.sendMessage(workspace.id, session.id, 'one');
    // Refused even before the agent has reported `working`.
    expect(() => chat.deleteHistory(workspace.id)).toThrow(WorkspaceBusyError);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(() => chat.deleteHistory(workspace.id)).toThrow(WorkspaceBusyError);
    expect(chat.listSessions(workspace.id)).toHaveLength(1);
    finish();
    await chat.settled();
    expect(chat.deleteHistory(workspace.id).deletedSessions).toBe(1);
  });

  it('refuses a workspace with a waiting session in core itself', () => {
    const core = openTestCore();
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    core.entities.createSession({ workspaceId: workspace.id, kind: 'chat', state: 'waiting' });
    expect(() => core.entities.deleteWorkspaceHistory(workspace.id)).toThrow(WorkspaceBusyError);
    expect(core.entities.listSessions(workspace.id)).toHaveLength(1);
  });
});
