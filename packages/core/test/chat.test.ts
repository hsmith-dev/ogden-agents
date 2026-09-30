/**
 * The chat use-case against a scripted AgentPort: the user's message and the
 * reply go through the session-event helper, the state follows the adapter's
 * signals (AD-4), and an agent that can't start or crashes leaves the session
 * in `error` with a plain reason.
 */
import { mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CoreEvent, SessionId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import {
  AgentError,
  createChat,
  InvalidOperationError,
  NotFoundError,
  RESTARTED_REASON,
  SessionBusyError,
  type AgentEvent,
  type AgentPort,
  type AgentSession,
  type Core,
} from '../src/index.js';
import { openTestCore, tempDir } from './helpers.js';

/** An agent whose every prompt runs `script`, which reports through `emit`. */
function scriptedAgent(script: (text: string, emit: (event: AgentEvent) => void) => Promise<{ stopReason: string }>) {
  const starts: Array<{ cwd: string; env: Readonly<Record<string, string>> }> = [];
  let closed = 0;
  const port: AgentPort = {
    displayName: 'Test Agent',
    async startSession(input) {
      starts.push(input);
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
            const result = await script(text, emit);
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

function setUp(core: Core, port: AgentPort, env: Record<string, string> = {}, dataDir = tempDir('ogden-agents-data-')) {
  const errors: Array<[SessionId, AgentError]> = [];
  const chat = createChat({
    dataDir,
    entities: core.entities,
    sessionEvents: core.sessionEvents,
    agent: port,
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
    expect(chat.openWorkspace('~').realPath).toBe(realpathSync.native(homedir()));
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
