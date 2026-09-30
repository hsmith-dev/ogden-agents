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
  AGENT_SESSION_REF,
  InvalidOperationError,
  MAX_PRIME_CHARS,
  NotFoundError,
  PRIME_HEADER,
  PRIME_NEW_MESSAGE,
  PRIME_SHORTENED,
  primedPrompt,
  RESTARTED_REASON,
  SessionBusyError,
  WorkspaceBusyError,
  type AgentEvent,
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
          emit({ type: 'state', state: 'error', reason: failure.message });
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
    expect(sessionEvents(core, session.id).at(-1)).toMatchObject({ payload: { state: 'error', reason: 'Test Agent needs you to sign in again.' } });
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
