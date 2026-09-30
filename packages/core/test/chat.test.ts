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
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AgentError,
  createChat,
  createDecliningPermissions,
  AGENT_SESSION_REF,
  clampCheckInDelay,
  deniedMessage,
  DELTA_INTERVAL_MS,
  InvalidOperationError,
  MAX_PRIME_CHARS,
  MAX_QUEUED_MESSAGES,
  NotFoundError,
  PRIME_HEADER,
  PRIME_NEW_MESSAGE,
  PRIME_SHORTENED,
  primedPrompt,
  QueueFullError,
  RESTARTED_REASON,
  SessionBusyError,
  SessionNotBusyError,
  WorkspaceBusyError,
  type AgentEvent,
  type AgentPermissionDecision,
  type AgentPort,
  type AgentRestored,
  type AgentSession,
  type Core,
  type Permissions,
  type StartAgentSession,
} from '../src/index.js';
import { openTestCore, tempDir } from './helpers.js';

/**
 * An agent whose every prompt runs `script`, which reports through `emit`.
 * `reopen` says how it reopens a session it had (`resumed`, `loaded`, `new`),
 * or throws to fail the reopen.
 */
function scriptedAgent(
  script: (text: string, emit: (event: AgentEvent) => void, ask: StartAgentSession['onPermissionRequest']) => Promise<{ stopReason: string }>,
  reopen: (agentSessionId: string) => AgentRestored = () => {
    throw new AgentError('agent_unavailable', 'Test Agent can’t reopen sessions.');
  },
) {
  const starts: Array<{ cwd: string; env: Readonly<Record<string, string>> }> = [];
  const reopens: string[] = [];
  const prompts: string[] = [];
  let closed = 0;
  const open = (input: StartAgentSession, agentSessionId: string): AgentSession => {
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
      async prompt(text) {
        prompts.push(text);
        emit({ type: 'state', state: 'working' });
        try {
          const result = await script(text, emit, input.onPermissionRequest);
          emit({ type: 'state', state: 'idle' });
          return result;
        } catch (error) {
          // A prompt that failed with the process still alive: not fatal.
          const failure = error instanceof AgentError ? error : new AgentError('agent_failed', 'Test Agent stopped with an error.');
          // As the adapter does: the code rides on the event only when the UI acts on it (9.4).
          emit({ type: 'state', state: 'error', reason: failure.message, ...(failure.code === 'auth_required' ? { code: failure.code } : {}) });
          throw failure;
        }
      },
      async cancel() {},
      async close() {
        closed++;
      },
    };
  };
  let sessionsOpened = 0;
  const port: AgentPort = {
    displayName: 'Test Agent',
    listAuthMethods: async () => [],
    async startSession(input) {
      starts.push({ cwd: input.cwd, env: input.env });
      return open(input, `agent-${++sessionsOpened}`);
    },
    async reopenSession(input) {
      reopens.push(input.agentSessionId);
      const restored = reopen(input.agentSessionId);
      return { session: open(input, restored === 'new' ? `agent-${++sessionsOpened}` : input.agentSessionId), restored };
    },
  };
  return { port, starts, reopens, prompts, closed: () => closed };
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

  it('queues a second message while the agent is answering and sends it once the turn ends', async () => {
    const core = openTestCore();
    let finish!: () => void;
    const agent = scriptedAgent(() => new Promise((resolve) => (finish = () => resolve({ stopReason: 'end_turn' }))));
    const { chat, workspace, session } = setUp(core, agent.port);
    chat.sendMessage(workspace.id, session.id, 'one');
    expect(chat.sendMessage(workspace.id, session.id, 'two')).toMatchObject({ queued: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(agent.prompts).toEqual(['one', 'two']);
    finish();
    await chat.settled();
    expect(core.entities.getSession(session.id)!.state).toBe('idle');
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
    // The dead agent was let go; the next message reopens its session (2.7), which this agent can't do.
    expect(agent.closed()).toBe(1);
    chat.sendMessage(workspace.id, session.id, 'again');
    await chat.settled();
    expect(agent.starts).toHaveLength(1);
    expect(agent.reopens).toEqual(['agent-1']);
    expect(core.entities.getSession(session.id)!.state).toBe('error');
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

  it('answers sendMessage with queued: false when the agent is not answering (2.10)', async () => {
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

describe('resuming a chat (story 2.7)', () => {
  const echo = (text: string, emit: (event: AgentEvent) => void) => (emit({ type: 'message_chunk', text: `re: ${text.split('\n').at(-1)}` }), Promise.resolve({ stopReason: 'end_turn' }));

  /** A chat that reached the agent once, then a "restart": the first chat closes and a second one takes over the same core. */
  const restarted = async (restored: AgentRestored | (() => AgentRestored)) => {
    const core = openTestCore();
    const agent = scriptedAgent(echo, typeof restored === 'function' ? restored : () => restored);
    const first = setUp(core, agent.port);
    first.chat.sendMessage(first.workspace.id, first.session.id, 'first question');
    await first.chat.settled();
    await first.chat.close();
    const chat = createChat({ dataDir: tempDir('ogden-agents-data-'), entities: core.entities, sessionEvents: core.sessionEvents, agent: agent.port });
    return { core, agent, chat, workspace: first.workspace, session: first.session };
  };

  const resumedEvents = (core: Core, sessionId: SessionId) => sessionEvents(core, sessionId).filter((event) => event.type === 'session.resumed');

  it('a chat that never reached an agent starts a plain session, stores its id as an adapter ref, and marks nothing', async () => {
    const core = openTestCore();
    const agent = scriptedAgent(echo);
    const { chat, workspace, session } = setUp(core, agent.port);
    chat.sendMessage(workspace.id, session.id, 'hello');
    await chat.settled();
    expect(agent.starts).toHaveLength(1);
    expect(agent.reopens).toEqual([]);
    expect(core.entities.getSession(session.id)!.adapterRefs).toEqual({ [AGENT_SESSION_REF]: 'agent-1' });
    expect(resumedEvents(core, session.id)).toEqual([]);
    // AD-9: the agent's id is in no event.
    expect(JSON.stringify(core.events.readAfter(0))).not.toContain('agent-1');
  });

  it.each([
    ['resumed', 'resumed'],
    ['loaded', 'loaded'],
  ] as const)('after a restart, the next message reopens the agent session (%s), marks the break, and sends the text as it is', async (restored, via) => {
    const { core, agent, chat, workspace, session } = await restarted(restored);
    chat.sendMessage(workspace.id, session.id, 'what did I say?');
    await chat.settled();
    expect(agent.starts).toHaveLength(1);
    expect(agent.reopens).toEqual(['agent-1']);
    expect(agent.prompts).toEqual(['first question', 'what did I say?']);
    const events = sessionEvents(core, session.id);
    const marker = events.findIndex((event) => event.type === 'session.resumed');
    expect(events[marker]).toMatchObject({ payload: { sessionId: session.id, via } });
    // After the user's message that reopened it, before the reply.
    expect(events[marker - 2]).toMatchObject({ type: 'session.message_completed', payload: { role: 'user', content: 'what did I say?' } });
    expect(events.at(-2)).toMatchObject({ type: 'session.message_completed', payload: { role: 'agent', content: 're: what did I say?' } });
    expect(core.entities.getSession(session.id)!.adapterRefs[AGENT_SESSION_REF]).toBe('agent-1');
    expect(core.entities.getSession(session.id)!.state).toBe('idle');
    expect(JSON.stringify(core.events.readAfter(0))).not.toContain('agent-1');
    await chat.close();
  });

  it('when the agent had to start a new session, primes its first prompt with the transcript, once, and replaces the ref', async () => {
    const { core, agent, chat, workspace, session } = await restarted('new');
    chat.sendMessage(workspace.id, session.id, 'what did I say?');
    await chat.settled();
    expect(resumedEvents(core, session.id).map((event) => event.payload)).toEqual([{ sessionId: session.id, via: 'transcript' }]);
    expect(agent.prompts[1]).toBe(
      [PRIME_HEADER, 'User: first question', 'Test Agent: re: first question', PRIME_NEW_MESSAGE, 'what did I say?'].join('\n'),
    );
    // The stored message stays the user's own text.
    const users = sessionEvents(core, session.id).filter((e) => e.type === 'session.message_completed' && e.payload.role === 'user');
    expect(users.map((e) => e.type === 'session.message_completed' && e.payload.content)).toEqual(['first question', 'what did I say?']);
    expect(core.entities.getSession(session.id)!.adapterRefs[AGENT_SESSION_REF]).toBe('agent-2');

    chat.sendMessage(workspace.id, session.id, 'and now?');
    await chat.settled();
    expect(agent.prompts[2]).toBe('and now?');
    expect(agent.reopens).toEqual(['agent-1']);
    expect(JSON.stringify(core.events.readAfter(0))).not.toMatch(/agent-[12]/);
    await chat.close();
  });

  it('a reopen that fails leaves the session in error, not working, with no marker; the next message tries again', async () => {
    let fail = true;
    const { core, agent, chat, workspace, session } = await restarted(() => {
      if (fail) throw new AgentError('auth_required', 'Test Agent needs you to sign in again.');
      return 'resumed';
    });
    chat.sendMessage(workspace.id, session.id, 'hello?');
    await chat.settled();
    expect(core.entities.getSession(session.id)!.state).toBe('error');
    expect(sessionEvents(core, session.id).at(-1)).toMatchObject({
      payload: { state: 'error', reason: 'Test Agent needs you to sign in again.', errorCode: 'auth_required' },
    });
    expect(resumedEvents(core, session.id)).toEqual([]);
    // The ref stays, for the next try.
    expect(core.entities.getSession(session.id)!.adapterRefs[AGENT_SESSION_REF]).toBe('agent-1');

    fail = false;
    chat.sendMessage(workspace.id, session.id, 'hello again');
    await chat.settled();
    expect(agent.reopens).toEqual(['agent-1', 'agent-1']);
    expect(core.entities.getSession(session.id)!.state).toBe('idle');
    expect(resumedEvents(core, session.id)).toHaveLength(1);
    await chat.close();
  });

  it('an expired sign-in mid-chat sets errorCode, drops the agent, and the next message reopens its session (9.4)', async () => {
    const core = openTestCore();
    let expired = false;
    const agent = scriptedAgent(async (text, emit) => {
      if (expired) throw new AgentError('auth_required', 'Test Agent needs you to sign in again.');
      return echo(text, emit);
    }, () => 'resumed');
    const { chat, workspace, session } = setUp(core, agent.port);
    chat.sendMessage(workspace.id, session.id, 'first');
    await chat.settled();
    expired = true;
    chat.sendMessage(workspace.id, session.id, 'second');
    await chat.settled();
    const failed = sessionEvents(core, session.id).filter((event) => event.type === 'session.state_changed' && event.payload.state === 'error');
    expect(failed.map((event) => event.payload)).toEqual([
      { sessionId: session.id, state: 'error', previous: 'working', reason: 'Test Agent needs you to sign in again.', errorCode: 'auth_required' },
    ]);
    // The process is dropped, not kept for the next message (it would keep the old credentials).
    expect(agent.closed()).toBe(1);

    expired = false;
    chat.sendMessage(workspace.id, session.id, 'third');
    await chat.settled();
    expect(agent.starts).toHaveLength(1);
    expect(agent.reopens).toEqual(['agent-1']);
    expect(agent.prompts).toEqual(['first', 'second', 'third']);
    expect(resumedEvents(core, session.id).map((event) => event.payload.via)).toEqual(['resumed']);
    const last = sessionEvents(core, session.id).filter((event) => event.type === 'session.state_changed').at(-1);
    expect(last).toMatchObject({ payload: { state: 'idle' } });
    expect(last?.type === 'session.state_changed' && 'errorCode' in last.payload).toBe(false);
    await chat.close();
  });

  it('a dropped agent is waited for: close resolves, and the next agent starts, only once it has stopped (9.4, AD-3)', async () => {
    const core = openTestCore();
    const order: string[] = [];
    let finishFirstClose!: () => void;
    let opened = 0;
    const open = (id: string): AgentSession => ({
      agentSessionId: id,
      onEvent: () => () => undefined,
      async prompt(text) {
        if (text === 'expired') throw new AgentError('auth_required', 'Test Agent needs you to sign in again.');
        return { stopReason: 'end_turn' };
      },
      cancel: async () => {},
      async close() {
        order.push(`close ${id}`);
        // The first agent's process takes a while to exit (the grace period, a tree kill).
        if (id === 'agent-1') await new Promise<void>((resolve) => (finishFirstClose = resolve));
        order.push(`closed ${id}`);
      },
    });
    const port: AgentPort = {
      displayName: 'Test Agent',
      listAuthMethods: async () => [],
      async startSession() {
        order.push('start');
        return open(`agent-${++opened}`);
      },
      async reopenSession({ agentSessionId }) {
        order.push(`reopen ${agentSessionId}`);
        return { session: open(agentSessionId === 'agent-1' ? `agent-${++opened}` : agentSessionId), restored: 'resumed' };
      },
    };
    const { chat, workspace, session } = setUp(core, port);
    chat.sendMessage(workspace.id, session.id, 'expired');
    await chat.settled();
    expect(core.entities.getSession(session.id)!.state).toBe('error');
    expect(order).toEqual(['start', 'close agent-1']);

    // The next message reopens only once the dropped agent has stopped.
    chat.sendMessage(workspace.id, session.id, 'again');
    await settle();
    expect(order).toEqual(['start', 'close agent-1']);
    finishFirstClose();
    await chat.settled();
    expect(order).toEqual(['start', 'close agent-1', 'closed agent-1', 'reopen agent-1']);

    // Dropped again: close waits for it.
    chat.sendMessage(workspace.id, session.id, 'expired');
    await chat.settled();
    let closeResolved = false;
    const closing = chat.close().then(() => (closeResolved = true));
    await settle();
    expect(order.at(-1)).toBe('closed agent-2');
    await closing;
    expect(closeResolved).toBe(true);
  });

  it('close waits for an agent dropped just before it, still stopping (9.4, AD-3)', async () => {
    const core = openTestCore();
    let finishClose!: () => void;
    let stopped = false;
    const port: AgentPort = {
      displayName: 'Test Agent',
      listAuthMethods: async () => [],
      reopenSession: () => Promise.reject(new Error('not in this test')),
      async startSession() {
        return {
          agentSessionId: 'agent-1',
          onEvent: () => () => undefined,
          prompt: async () => {
            throw new AgentError('auth_required', 'Test Agent needs you to sign in again.');
          },
          cancel: async () => {},
          async close() {
            await new Promise<void>((resolve) => (finishClose = resolve));
            stopped = true;
          },
        };
      },
    };
    const { chat, workspace, session } = setUp(core, port);
    chat.sendMessage(workspace.id, session.id, 'hello');
    await chat.settled();
    let closed = false;
    const closing = chat.close().then(() => (closed = true));
    await settle();
    expect(closed).toBe(false);
    finishClose();
    await closing;
    expect(stopped).toBe(true);
  });

  it('an error event with code auth_required alone drops the agent; other errors carry no errorCode (9.4)', async () => {
    const core = openTestCore();
    const agent = scriptedAgent(async (text, emit) => {
      if (text === 'expired') {
        emit({ type: 'state', state: 'error', reason: 'Test Agent needs you to sign in again.', code: 'auth_required' });
        return { stopReason: 'end_turn' };
      }
      if (text === 'fail') throw new AgentError('agent_failed', 'Test Agent stopped with an error.');
      return echo(text, emit);
    }, () => 'resumed');
    const { chat, workspace, session } = setUp(core, agent.port);
    chat.sendMessage(workspace.id, session.id, 'fail');
    await chat.settled();
    const plain = sessionEvents(core, session.id).at(-1);
    expect(plain).toMatchObject({ type: 'session.state_changed', payload: { state: 'error', reason: 'Test Agent stopped with an error.' } });
    expect(plain?.type === 'session.state_changed' && 'errorCode' in plain.payload).toBe(false);
    // A failed prompt that isn't a sign-in keeps its agent.
    expect(agent.closed()).toBe(0);

    chat.sendMessage(workspace.id, session.id, 'expired');
    await chat.settled();
    expect(sessionEvents(core, session.id).filter((event) => event.type === 'session.state_changed').at(-1)).toMatchObject({
      payload: { state: 'error', errorCode: 'auth_required' },
    });
    expect(agent.closed()).toBe(1);
    chat.sendMessage(workspace.id, session.id, 'again');
    await chat.settled();
    expect(agent.reopens).toEqual(['agent-1']);
    await chat.close();
  });

  it('an agent that crashed in this run is reopened on the next message', async () => {
    const core = openTestCore();
    const agent = scriptedAgent(async (text, emit) => {
      if (text === 'crash') {
        emit({ type: 'state', state: 'error', reason: 'Test Agent stopped unexpectedly.', fatal: true });
        throw new AgentError('agent_failed', 'Test Agent stopped unexpectedly.');
      }
      return echo(text, emit);
    }, () => 'resumed');
    const { chat, workspace, session } = setUp(core, agent.port);
    chat.sendMessage(workspace.id, session.id, 'crash');
    await chat.settled();
    chat.sendMessage(workspace.id, session.id, 'still there?');
    await chat.settled();
    expect(agent.starts).toHaveLength(1);
    expect(agent.reopens).toEqual(['agent-1']);
    expect(resumedEvents(core, session.id).map((event) => event.payload.via)).toEqual(['resumed']);
    expect(core.entities.getSession(session.id)!.state).toBe('idle');
    await chat.close();
  });

  it('a slash command after a transcript reopen goes without the primer; the next message is primed (review F1)', async () => {
    const { core, agent, chat, workspace, session } = await restarted('new');
    chat.sendMessage(workspace.id, session.id, '/compact');
    await chat.settled();
    expect(agent.prompts[1]).toBe('/compact');
    chat.sendMessage(workspace.id, session.id, 'what did I say?');
    await chat.settled();
    expect(agent.prompts[2]!.startsWith(PRIME_HEADER)).toBe(true);
    expect(agent.prompts[2]).toContain('User: /compact');
    chat.sendMessage(workspace.id, session.id, 'and now?');
    await chat.settled();
    expect(agent.prompts[3]).toBe('and now?');
    expect(resumedEvents(core, session.id)).toHaveLength(1);
    await chat.close();
  });

  it('a primed prompt that failed is primed again on the next message', async () => {
    let failNext = true;
    const core = openTestCore();
    const agent = scriptedAgent(async (text, emit) => {
      if (failNext) {
        failNext = false;
        throw new AgentError('agent_failed', 'Test Agent is rate limited.');
      }
      return echo(text, emit);
    }, () => 'new');
    const { chat, workspace, session } = setUp(core, agent.port);
    core.entities.setSessionAdapterRefs(session.id, { [AGENT_SESSION_REF]: 'agent-gone' });
    core.sessionEvents.completeMessage(session.id, { messageId: 'msg_earlier', role: 'user', content: 'earlier' });
    chat.sendMessage(workspace.id, session.id, 'one');
    await chat.settled();
    chat.sendMessage(workspace.id, session.id, 'two');
    await chat.settled();
    expect(agent.prompts[0]).toContain('User: earlier');
    expect(agent.prompts[1]).toContain('User: earlier');
    expect(agent.prompts[1]).toContain('User: one');
    expect(agent.prompts[1]!.endsWith(`${PRIME_NEW_MESSAGE}\ntwo`)).toBe(true);
    await chat.close();
  });

  it('a server start reopens nothing: agents start only when a message is sent', async () => {
    const { agent, chat } = await restarted('resumed');
    await chat.settled();
    expect(agent.reopens).toEqual([]);
    expect(agent.starts).toHaveLength(1);
    await chat.close();
  });
});

describe('primedPrompt', () => {
  it('matches the golden primer', () => {
    expect(
      primedPrompt(
        [
          { role: 'user', content: 'Hi' },
          { role: 'agent', content: 'Hello.' },
        ],
        'Go on',
        'Claude Code',
      ),
    ).toBe(
      '[Ogden Agents] This conversation continues from a saved transcript; your earlier session ended.\nUser: Hi\nClaude Code: Hello.\n[Ogden Agents] New message:\nGo on',
    );
  });

  it('is the text alone when there is no transcript', () => {
    expect(primedPrompt([], 'Go on', 'Claude Code')).toBe('Go on');
  });

  it('keeps whole recent messages within the cap and says how many earlier ones it left out', () => {
    const big = 'x'.repeat(MAX_PRIME_CHARS / 2);
    const messages = [
      { role: 'user' as const, content: 'oldest' },
      { role: 'agent' as const, content: big },
      { role: 'user' as const, content: big },
      { role: 'agent' as const, content: 'newest' },
    ];
    const primed = primedPrompt(messages, 'now', 'Claude Code');
    expect(primed.split('\n').slice(0, 2)).toEqual([PRIME_HEADER, '(2 earlier messages omitted)']);
    expect(primed).toContain('Claude Code: newest');
    expect(primed).not.toContain('oldest');
    expect(primed.length).toBeLessThan(MAX_PRIME_CHARS + 500);
    expect(primedPrompt(messages, 'now', 'Claude Code', 20)).toContain('(3 earlier messages omitted)');
  });

  it('keeps the end of a newest message too long for the cap on its own, marked as shortened (review F2)', () => {
    const long = `${'a'.repeat(MAX_PRIME_CHARS)}THE END`;
    const primed = primedPrompt(
      [
        { role: 'user', content: 'older' },
        { role: 'agent', content: long },
      ],
      'now',
      'Claude Code',
    );
    const lines = primed.split('\n');
    expect(lines.slice(0, 2)).toEqual([PRIME_HEADER, '(1 earlier message omitted)']);
    expect(lines[2]!.startsWith(`Claude Code: ${PRIME_SHORTENED}`)).toBe(true);
    expect(lines[2]!.endsWith('THE END')).toBe(true);
    expect(lines[2]!.length).toBe(MAX_PRIME_CHARS);
    expect(lines.slice(3)).toEqual([PRIME_NEW_MESSAGE, 'now']);
  });
});

/**
 * An agent the test drives by hand: each prompt reports `working` and waits
 * until the test ends it (`end`) or fails it (`fail`). `cancel` ends the
 * running prompt with `cancelled`, unless `ignoreCancel` (a hung agent).
 */
function handAgent({ ignoreCancel = false, reopen }: { ignoreCancel?: boolean; reopen?: AgentRestored } = {}) {
  const prompts: string[] = [];
  let cancels = 0;
  let closed = 0;
  let sessionsOpened = 0;
  let emit: (event: AgentEvent) => void = () => undefined;
  let ask: StartAgentSession['onPermissionRequest'];
  let turn: { end: (stopReason?: string) => void; fail: (reason: string) => void } | undefined;
  const open = (input: StartAgentSession, agentSessionId: string): AgentSession => {
    const listeners = new Set<(event: AgentEvent) => void>();
    emit = (event) => {
      for (const listener of [...listeners]) listener(event);
    };
    ask = input.onPermissionRequest;
    return {
      agentSessionId,
      onEvent(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      prompt(text) {
        prompts.push(text);
        emit({ type: 'state', state: 'working' });
        return new Promise((resolve, reject) => {
          turn = {
            end: (stopReason = 'end_turn') => {
              turn = undefined;
              emit({ type: 'state', state: 'idle' });
              resolve({ stopReason });
            },
            fail: (reason) => {
              turn = undefined;
              emit({ type: 'state', state: 'error', reason });
              reject(new AgentError('agent_failed', reason));
            },
          };
        });
      },
      async cancel() {
        cancels++;
        if (!ignoreCancel) turn?.end('cancelled');
      },
      async close() {
        closed++;
      },
    };
  };
  const port: AgentPort = {
    displayName: 'Test Agent',
    listAuthMethods: async () => [],
    async startSession(input) {
      return open(input, `agent-${++sessionsOpened}`);
    },
    async reopenSession(input) {
      if (reopen === undefined) throw new AgentError('agent_unavailable', 'Test Agent can’t reopen sessions.');
      return { session: open(input, reopen === 'new' ? `agent-${++sessionsOpened}` : input.agentSessionId), restored: reopen };
    },
  };
  return {
    port,
    prompts,
    emit: (event: AgentEvent) => emit(event),
    ask: (request: Parameters<NonNullable<StartAgentSession['onPermissionRequest']>>[0]) => ask!(request),
    end: (stopReason?: string) => turn!.end(stopReason),
    fail: (reason: string) => turn!.fail(reason),
    running: () => turn !== undefined,
    cancels: () => cancels,
    closed: () => closed,
  };
}

/** Lets pending promise callbacks run (`setImmediate` is not faked). */
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};

const CHECK_IN_MS = 1_000;

function setUpHand(core: Core, agent: ReturnType<typeof handAgent>, permissions?: Permissions) {
  const errors: AgentError[] = [];
  const internal: unknown[] = [];
  const chat = createChat({
    dataDir: tempDir('ogden-agents-data-'),
    entities: core.entities,
    sessionEvents: core.sessionEvents,
    agent: agent.port,
    ...(permissions === undefined ? {} : { permissions }),
    checkInDelayMs: CHECK_IN_MS,
    onAgentError: (_sessionId, error) => errors.push(error),
    onInternalError: (_sessionId, error) => internal.push(error),
  });
  const workspace = chat.openWorkspace(tempDir('ogden-agents-repo-'));
  const session = chat.createChatSession(workspace.id);
  return { chat, workspace, session, errors, internal };
}

const userMessages = (core: Core, sessionId: SessionId) =>
  sessionEvents(core, sessionId).flatMap((e) => (e.type === 'session.message_completed' && e.payload.role === 'user' ? [[e.payload.messageId, e.payload.content]] : []));
const stateOf = (core: Core, sessionId: SessionId) => core.entities.getSession(sessionId)!.state;

describe('session behaviour (story 2.10)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('queues messages first in, first out, each queued then completed under its own id, while the session stays working', async () => {
    const core = openTestCore();
    const agent = handAgent();
    const { chat, workspace, session } = setUpHand(core, agent);
    chat.sendMessage(workspace.id, session.id, 'first');
    await settle();
    const second = chat.sendMessage(workspace.id, session.id, 'second');
    const third = chat.sendMessage(workspace.id, session.id, 'third');
    expect([second.queued, third.queued]).toEqual([true, true]);
    const queued = sessionEvents(core, session.id).filter((e) => e.type === 'session.message_queued');
    expect(queued.map((e) => e.payload)).toEqual([
      { sessionId: session.id, messageId: second.messageId, content: 'second' },
      { sessionId: session.id, messageId: third.messageId, content: 'third' },
    ]);
    // Nothing reaches the agent mid-turn.
    expect(agent.prompts).toEqual(['first']);

    agent.end();
    await settle();
    expect(agent.prompts).toEqual(['first', 'second']);
    agent.end();
    await settle();
    agent.end();
    await chat.settled();
    expect(agent.prompts).toEqual(['first', 'second', 'third']);
    expect(userMessages(core, session.id).slice(1)).toEqual([
      [second.messageId, 'second'],
      [third.messageId, 'third'],
    ]);
    // Straight from one queued message to the next: no idle in between.
    const states = sessionEvents(core, session.id).filter((e) => e.type === 'session.state_changed').map((e) => e.payload.state);
    expect(states).toEqual(['working', 'idle']);
  });

  it(`holds at most ${MAX_QUEUED_MESSAGES} queued messages; the next one is refused as busy and stored nowhere`, async () => {
    const core = openTestCore();
    const agent = handAgent();
    const { chat, workspace, session } = setUpHand(core, agent);
    chat.sendMessage(workspace.id, session.id, 'first');
    for (let i = 0; i < MAX_QUEUED_MESSAGES; i++) chat.sendMessage(workspace.id, session.id, `queued ${i}`);
    const refused = (() => {
      try {
        chat.sendMessage(workspace.id, session.id, 'one too many');
      } catch (error) {
        return error;
      }
      return undefined;
    })();
    expect(refused).toBeInstanceOf(QueueFullError);
    expect(refused).toBeInstanceOf(SessionBusyError);
    expect(JSON.stringify(sessionEvents(core, session.id))).not.toContain('one too many');
    await chat.close();
  });

  it('sends a Deny reason after the turn, as the user’s message, ahead of the queue; a Deny without one sends nothing', async () => {
    const core = openTestCore();
    const agent = handAgent();
    const { chat, workspace, session } = setUpHand(core, agent, core.permissions);
    chat.sendMessage(workspace.id, session.id, 'clean up');
    await settle();
    const denied = agent.ask({ toolCallId: 't1', title: 'Run rm -rf build', kind: 'execute', command: 'rm -rf build' });
    const quiet = agent.ask({ toolCallId: 't2', title: 'Edit a.ts', kind: 'edit' });
    await settle();
    const queued = chat.sendMessage(workspace.id, session.id, 'and then this');
    const [first, second] = sessionEvents(core, session.id).filter((e) => e.type === 'permission.requested');
    core.permissions.decide(workspace.id, session.id, first!.payload.requestId, { decision: 'deny', reason: 'Use the clean script.' });
    core.permissions.decide(workspace.id, session.id, second!.payload.requestId, { decision: 'deny' });
    expect(await denied).toEqual({ outcome: 'deny', reason: 'Use the clean script.' });
    expect(await quiet).toEqual({ outcome: 'deny' });
    // Mid-turn the agent is sent nothing.
    expect(agent.prompts).toEqual(['clean up']);

    agent.end();
    await settle();
    agent.end();
    await settle();
    agent.end();
    await chat.settled();
    expect(agent.prompts).toEqual(['clean up', 'I denied "rm -rf build": Use the clean script.', 'and then this']);
    expect(userMessages(core, session.id).map(([, content]) => content)).toEqual(['clean up', 'I denied "rm -rf build": Use the clean script.', 'and then this']);
    expect(userMessages(core, session.id)[2]![0]).toBe(queued.messageId);
    // Only the Deny reason is marked, so Try again never resends it (9.4 review F4).
    const completed = sessionEvents(core, session.id).flatMap((e) => (e.type === 'session.message_completed' && e.payload.role === 'user' ? [e.payload] : []));
    expect(completed.map((payload) => payload.origin)).toEqual([undefined, 'deny_reason', undefined]);
    expect(stateOf(core, session.id)).toBe('idle');
  });

  it('coalesces reply chunks to one delta per interval, flushed before any other event and at the end; the reply is unchanged', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const core = openTestCore();
    const live: CoreEvent[] = [];
    core.events.subscribe(0, (event) => live.push(event));
    const agent = handAgent();
    const { chat, workspace, session } = setUpHand(core, agent);
    chat.sendMessage(workspace.id, session.id, 'talk');
    await settle();
    const deltas = () => live.filter((e) => e.type === 'session.message_delta').map((e) => (e.type === 'session.message_delta' ? e.payload.text : ''));

    agent.emit({ type: 'message_chunk', text: 'a' });
    expect(deltas()).toEqual(['a']);
    agent.emit({ type: 'message_chunk', text: 'b' });
    agent.emit({ type: 'message_chunk', text: 'c' });
    expect(deltas()).toEqual(['a']);
    await vi.advanceTimersByTimeAsync(DELTA_INTERVAL_MS);
    expect(deltas()).toEqual(['a', 'bc']);
    agent.emit({ type: 'message_chunk', text: 'd' });
    expect(deltas()).toEqual(['a', 'bc']);
    // Held-back text goes before the tool call.
    agent.emit({ type: 'tool_call', toolCallId: 't1', title: 'Read a.ts', kind: 'read', status: 'completed' });
    const mine = live.filter((e) => e.streamId === session.id).map((e) => e.type);
    expect(mine.slice(-2)).toEqual(['session.message_delta', 'session.tool_call']);
    expect(deltas()).toEqual(['a', 'bc', 'd']);
    agent.emit({ type: 'message_chunk', text: 'e' });
    agent.emit({ type: 'message_chunk', text: 'f' });
    agent.end();
    await settle();
    expect(deltas()).toEqual(['a', 'bc', 'd', 'ef']);
    const reply = live.filter((e) => e.type === 'session.message_completed').at(-1)!;
    expect(reply).toMatchObject({ payload: { role: 'agent', content: 'abcdef' } });
    await chat.settled();
    await chat.close();
  });

  it('keeps a pending card pending when the agent reports working (the working guard)', async () => {
    const core = openTestCore();
    const agent = handAgent();
    const { chat, workspace, session } = setUpHand(core, agent, core.permissions);
    chat.sendMessage(workspace.id, session.id, 'run it');
    await settle();
    void agent.ask({ toolCallId: 't1', title: 'Run npm test', kind: 'execute', command: 'npm test' });
    await settle();
    expect(stateOf(core, session.id)).toBe('waiting');
    agent.emit({ type: 'state', state: 'working' });
    await settle();
    expect(stateOf(core, session.id)).toBe('waiting');
    expect(sessionEvents(core, session.id).some((e) => e.type === 'permission.resolved')).toBe(false);
    await chat.close();
  });

  it('checks in on a quiet agent with a tool call in progress, naming it, and keeps waiting: no error, no timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const core = openTestCore();
    const agent = handAgent();
    const { chat, workspace, session, errors } = setUpHand(core, agent);
    chat.sendMessage(workspace.id, session.id, 'build it');
    await settle();
    agent.emit({ type: 'tool_call', toolCallId: 't1', title: 'Read a.ts', kind: 'read', status: 'completed' });
    agent.emit({ type: 'tool_call', toolCallId: 't2', title: 'Run npm run build', kind: 'execute', status: 'in_progress' });
    await vi.advanceTimersByTimeAsync(CHECK_IN_MS - 10);
    expect(sessionEvents(core, session.id).some((e) => e.type === 'session.check_in')).toBe(false);
    await vi.advanceTimersByTimeAsync(10);
    const checkIns = () => sessionEvents(core, session.id).filter((e) => e.type === 'session.check_in');
    expect(checkIns().map((e) => e.payload)).toEqual([{ sessionId: session.id, waitingOn: 'Run npm run build' }]);
    // Once per quiet stretch; the session keeps working and never errs.
    await vi.advanceTimersByTimeAsync(CHECK_IN_MS * 10);
    expect(checkIns()).toHaveLength(1);
    expect(stateOf(core, session.id)).toBe('working');
    expect(errors).toEqual([]);
    expect(agent.cancels()).toBe(0);
    // The agent speaks again: the stretch starts over.
    agent.emit({ type: 'message_chunk', text: 'Still building.' });
    await vi.advanceTimersByTimeAsync(CHECK_IN_MS);
    expect(checkIns()).toHaveLength(2);
    agent.end();
    await chat.settled();
    expect(stateOf(core, session.id)).toBe('idle');
  });

  it('checks in with nothing named when no tool call is in progress, forgets a turn’s tool calls when it ends, and never checks in while waiting', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const core = openTestCore();
    const agent = handAgent();
    const { chat, workspace, session, errors } = setUpHand(core, agent, core.permissions);
    chat.sendMessage(workspace.id, session.id, 'one');
    await settle();
    // A tool call left in progress when its turn ended is forgotten (2.3 F7).
    agent.emit({ type: 'tool_call', toolCallId: 't1', title: 'Run a server', kind: 'execute', status: 'in_progress' });
    agent.end();
    await chat.settled();
    chat.sendMessage(workspace.id, session.id, 'two');
    await settle();
    await vi.advanceTimersByTimeAsync(CHECK_IN_MS);
    const checkIns = () => sessionEvents(core, session.id).filter((e) => e.type === 'session.check_in');
    expect(checkIns().map((e) => e.payload)).toEqual([{ sessionId: session.id }]);
    expect(stateOf(core, session.id)).toBe('working');

    // While waiting on the user, no check-in.
    agent.emit({ type: 'message_chunk', text: 'Asking.' });
    void agent.ask({ toolCallId: 't2', title: 'Run npm test', kind: 'execute', command: 'npm test' });
    await settle();
    expect(stateOf(core, session.id)).toBe('waiting');
    await vi.advanceTimersByTimeAsync(CHECK_IN_MS * 3);
    expect(checkIns()).toHaveLength(1);
    expect(errors).toEqual([]);

    // Stop still works from here.
    chat.cancel(workspace.id, session.id);
    await settle();
    await chat.settled();
    expect(stateOf(core, session.id)).toBe('idle');
  });

  it('Stop cancels the running prompt, drops the queue unsent, and ends idle; Stop with nothing running is refused', async () => {
    const core = openTestCore();
    const agent = handAgent();
    const { chat, workspace, session } = setUpHand(core, agent);
    expect(() => chat.cancel(workspace.id, session.id)).toThrow(SessionNotBusyError);
    chat.sendMessage(workspace.id, session.id, 'long job');
    await settle();
    const queued = chat.sendMessage(workspace.id, session.id, 'after that');
    agent.emit({ type: 'message_chunk', text: 'Working on' });
    chat.cancel(workspace.id, session.id);
    // A second Stop is harmless.
    chat.cancel(workspace.id, session.id);
    await chat.settled();
    expect(agent.cancels()).toBe(1);
    expect(agent.prompts).toEqual(['long job']);
    expect(stateOf(core, session.id)).toBe('idle');
    expect(userMessages(core, session.id).map(([id]) => id)).not.toContain(queued.messageId);
    expect(sessionEvents(core, session.id).filter((e) => e.type === 'session.message_completed').at(-1)).toMatchObject({ payload: { role: 'agent', content: 'Working on' } });
    expect(() => chat.cancel(workspace.id, session.id)).toThrow(SessionNotBusyError);
    // The chat goes on as before, with the same agent.
    chat.sendMessage(workspace.id, session.id, 'next');
    await settle();
    agent.end();
    await chat.settled();
    expect(agent.prompts).toEqual(['long job', 'next']);
    expect(agent.closed()).toBe(0);
  });

  it('Stop while waiting declines the pending card and leaves waiting for idle at once', async () => {
    const core = openTestCore();
    const agent = handAgent();
    const { chat, workspace, session } = setUpHand(core, agent, core.permissions);
    chat.sendMessage(workspace.id, session.id, 'run it');
    await settle();
    const decision: Promise<AgentPermissionDecision> = agent.ask({ toolCallId: 't1', title: 'Run npm test', kind: 'execute', command: 'npm test' });
    await settle();
    expect(stateOf(core, session.id)).toBe('waiting');
    chat.cancel(workspace.id, session.id);
    expect(stateOf(core, session.id)).toBe('idle');
    expect(await decision).toEqual({ outcome: 'cancelled' });
    await settle();
    expect(sessionEvents(core, session.id).filter((e) => e.type === 'permission.resolved').map((e) => e.payload.by)).toEqual(['cancelled']);
    await chat.settled();
    expect(agent.cancels()).toBe(1);
    expect(stateOf(core, session.id)).toBe('idle');
  });

  it('Stop drops an agent that does not end its turn within the grace period: idle, resumable, process closed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const core = openTestCore();
    const agent = handAgent({ ignoreCancel: true });
    const { chat, workspace, session } = setUpHand(core, agent);
    chat.sendMessage(workspace.id, session.id, 'hang');
    await settle();
    chat.cancel(workspace.id, session.id);
    await vi.advanceTimersByTimeAsync(4_900);
    expect(stateOf(core, session.id)).toBe('working');
    await vi.advanceTimersByTimeAsync(100);
    await chat.settled();
    expect(stateOf(core, session.id)).toBe('idle');
    expect(sessionEvents(core, session.id).at(-1)).toMatchObject({ type: 'session.state_changed', payload: { state: 'idle', resumable: true } });
    expect(agent.closed()).toBe(1);
  });

  it('a turn that ends in error sends nothing queued; the next message is sent at once', async () => {
    const core = openTestCore();
    const agent = handAgent();
    const { chat, workspace, session } = setUpHand(core, agent);
    chat.sendMessage(workspace.id, session.id, 'one');
    await settle();
    const queued = chat.sendMessage(workspace.id, session.id, 'queued');
    agent.fail('Test Agent is rate limited.');
    await chat.settled();
    expect(stateOf(core, session.id)).toBe('error');
    expect(agent.prompts).toEqual(['one']);
    expect(userMessages(core, session.id).map(([id]) => id)).not.toContain(queued.messageId);
    expect(chat.sendMessage(workspace.id, session.id, 'try again')).toMatchObject({ queued: false });
    await settle();
    agent.end();
    await chat.settled();
    expect(stateOf(core, session.id)).toBe('idle');
  });

  it('a close with a queue leaves the session idle and resumable, the queued message unsent, and no timer running', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const core = openTestCore();
    const agent = handAgent();
    const { chat, workspace, session } = setUpHand(core, agent);
    chat.sendMessage(workspace.id, session.id, 'one');
    await settle();
    agent.emit({ type: 'message_chunk', text: 'Partly' });
    agent.emit({ type: 'message_chunk', text: ' done' });
    const queued = chat.sendMessage(workspace.id, session.id, 'queued');
    await chat.close();
    await chat.settled();
    expect(vi.getTimerCount()).toBe(0);
    expect(sessionEvents(core, session.id).at(-1)).toMatchObject({ payload: { state: 'idle', reason: RESTARTED_REASON, resumable: true } });
    expect(userMessages(core, session.id).map(([id]) => id)).not.toContain(queued.messageId);
    expect(sessionEvents(core, session.id).filter((e) => e.type === 'session.message_completed').at(-1)).toMatchObject({ payload: { role: 'agent', content: 'Partly done' } });
  });

  it('saves a transcript reopen’s new agent id only once its primed prompt succeeded (2.7 F4)', async () => {
    const core = openTestCore();
    const agent = handAgent({ reopen: 'new' });
    const { chat, workspace, session } = setUpHand(core, agent);
    core.entities.setSessionAdapterRefs(session.id, { [AGENT_SESSION_REF]: 'agent-gone' });
    core.sessionEvents.completeMessage(session.id, { messageId: 'msg_earlier', role: 'user', content: 'earlier' });
    chat.sendMessage(workspace.id, session.id, 'one');
    await settle();
    // The primed prompt is running: the old ref stays, so a restart now primes again.
    expect(core.entities.getSession(session.id)!.adapterRefs[AGENT_SESSION_REF]).toBe('agent-gone');
    agent.fail('Test Agent is rate limited.');
    await chat.settled();
    expect(core.entities.getSession(session.id)!.adapterRefs[AGENT_SESSION_REF]).toBe('agent-gone');
    chat.sendMessage(workspace.id, session.id, 'two');
    await settle();
    expect(agent.prompts[1]).toContain('User: earlier');
    agent.end();
    await chat.settled();
    expect(core.entities.getSession(session.id)!.adapterRefs[AGENT_SESSION_REF]).toBe('agent-1');
    await chat.close();
  });

  it('review F1: a message sent after a Stop whose agent ignores it is sent once, after the grace, never shown "Not sent"', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const core = openTestCore();
    const agent = handAgent({ ignoreCancel: true, reopen: 'resumed' });
    const { chat, workspace, session } = setUpHand(core, agent);
    chat.sendMessage(workspace.id, session.id, 'hang');
    await settle();
    chat.cancel(workspace.id, session.id);
    const after = chat.sendMessage(workspace.id, session.id, 'after the stop');
    expect(after.queued).toBe(true);
    const queuedSeq = sessionEvents(core, session.id).find((e) => e.type === 'session.message_queued')!.seq;
    await vi.advanceTimersByTimeAsync(5_000);
    await settle();
    expect(agent.closed()).toBe(1);
    expect(agent.prompts).toEqual(['hang', 'after the stop']);
    // No idle (or error) between the queueing and its sending: the web never marks it "Not sent".
    const sentSeq = sessionEvents(core, session.id).find((e) => e.type === 'session.message_completed' && e.payload.messageId === after.messageId)!.seq;
    const between = sessionEvents(core, session.id).filter((e) => e.seq > queuedSeq && e.seq < sentSeq && e.type === 'session.state_changed');
    expect(between).toEqual([]);
    agent.end();
    await chat.settled();
    expect(userMessages(core, session.id).filter(([id]) => id === after.messageId)).toHaveLength(1);
    expect(stateOf(core, session.id)).toBe('idle');
  });

  it('review F2: after a Stop, a permission request is declined at once with no card, and recorded as cancelled', async () => {
    const core = openTestCore();
    const agent = handAgent({ ignoreCancel: true });
    const { chat, workspace, session } = setUpHand(core, agent, core.permissions);
    chat.sendMessage(workspace.id, session.id, 'run it');
    await settle();
    chat.cancel(workspace.id, session.id);
    expect(await agent.ask({ toolCallId: 't1', title: 'Run npm test', kind: 'execute', command: 'npm test' })).toEqual({ outcome: 'cancelled' });
    expect(stateOf(core, session.id)).toBe('working');
    const permissionEvents = sessionEvents(core, session.id).filter((e) => e.type.startsWith('permission.'));
    expect(permissionEvents.map((e) => e.type)).toEqual(['permission.requested', 'permission.resolved']);
    expect(permissionEvents[1]!.payload).toMatchObject({ decision: 'deny', by: 'cancelled' });
    agent.end();
    await chat.settled();
    expect(stateOf(core, session.id)).toBe('idle');
  });

  it('review F3: an update for a tool call this turn never reported (a late one) is ignored', async () => {
    const core = openTestCore();
    const agent = handAgent();
    const { chat, workspace, session } = setUpHand(core, agent);
    chat.sendMessage(workspace.id, session.id, 'one');
    await settle();
    agent.emit({ type: 'tool_call', toolCallId: 't1', title: 'Read a.ts', kind: 'read', status: 'in_progress' });
    agent.end();
    await chat.settled();
    agent.emit({ type: 'tool_call_update', toolCallId: 't1', status: 'completed' });
    expect(sessionEvents(core, session.id).filter((e) => e.type === 'session.tool_call_updated')).toEqual([]);
  });

  it('review F4: clamps the check-in delay to 1 s .. 2^31-1 ms', () => {
    expect(clampCheckInDelay(10)).toBe(1_000);
    expect(clampCheckInDelay(-1)).toBe(1_000);
    expect(clampCheckInDelay(90_000)).toBe(90_000);
    expect(clampCheckInDelay(1e15)).toBe(2 ** 31 - 1);
    expect(clampCheckInDelay(Number.NaN)).toBe(10 * 60_000);
  });

  it('review F5: a Deny-reason message quotes at most 200 characters of the command, with an ellipsis', () => {
    const long = `npm run ${'x'.repeat(400)}`;
    const text = deniedMessage(long, 'Too much.');
    const quoted = text.slice('I denied "'.length, text.indexOf('": Too much.'));
    expect(quoted).toHaveLength(200);
    expect(quoted.endsWith('…')).toBe(true);
    expect(deniedMessage('npm test', 'No.')).toBe('I denied "npm test": No.');
  });

  it('keeps error (and so Try again) when the adapter reported a non-fatal error and the prompt then resolved', async () => {
    const core = openTestCore();
    const agent = scriptedAgent(async (_text, emit) => {
      emit({ type: 'message_chunk', text: 'Partly' });
      emit({ type: 'state', state: 'error', reason: 'Test Agent hit a rate limit.' });
      return { stopReason: 'end_turn' };
    });
    const { chat, workspace, session } = setUp(core, agent.port);
    chat.sendMessage(workspace.id, session.id, 'go');
    await chat.settled();
    expect(core.entities.getSession(session.id)!.state).toBe('error');
    expect(sessionEvents(core, session.id).at(-1)).toMatchObject({ type: 'session.state_changed', payload: { state: 'error', reason: 'Test Agent hit a rate limit.' } });
    // The next message is sent as usual.
    chat.sendMessage(workspace.id, session.id, 'again');
    await chat.settled();
    expect(agent.prompts).toEqual(['go', 'again']);
  });
});
