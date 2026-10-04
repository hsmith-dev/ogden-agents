/**
 * Epic 6, entry 2 (the tracer): each chat has the agent it was started with,
 * looked up in the registry the server wires, so one project holds chats with
 * two agents working at once. Sessions stored before agents could be chosen
 * read as the registry's legacy agent; an agent's declared permission modes
 * bound its chats' modes. No real agent runs: these are in-memory ports.
 */
import type { CoreEvent, PermissionMode, SessionId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import {
  AGENT_NOT_REGISTERED_REASON,
  createAgentRegistry,
  createChat,
  ModeUnavailableError,
  UnknownAgentError,
  type AgentEventListener,
  type AgentPort,
  type AgentSession,
  type Core,
} from '../src/index.js';
import { openTestCore, tempDir } from './helpers.js';

/** An agent whose replies say who answered, and whose prompts end only when the test releases them. */
function namedAgent(name: string, declares?: readonly PermissionMode[]) {
  const releases: Array<() => void> = [];
  const envs: Array<Readonly<Record<string, string>>> = [];
  let opened = 0;
  const open = (env: Readonly<Record<string, string>>, agentSessionId: string): AgentSession => {
    envs.push(env);
    const listeners = new Set<AgentEventListener>();
    const emit = (event: Parameters<AgentEventListener>[0]) => listeners.forEach((listener) => listener(event));
    return {
      agentSessionId,
      ...(declares === undefined ? {} : { permissionModes: declares }),
      async prompt(text) {
        emit({ type: 'state', state: 'working' });
        emit({ type: 'message_chunk', text: `${name} heard ${text}` });
        await new Promise<void>((resolve) => releases.push(resolve));
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
  const port: AgentPort = {
    displayName: name,
    ...(declares === undefined ? {} : { permissionModes: declares }),
    listAuthMethods: async () => [],
    startSession: async (input) => open(input.env, `${name}-${++opened}`),
    reopenSession: async (input) => ({ session: open(input.env, input.agentSessionId), restored: 'resumed' }),
  };
  return { port, envs, release: () => releases.splice(0).forEach((resolve) => resolve()), pending: () => releases.length };
}

function setUp(core: Core = openTestCore()) {
  const claude = namedAgent('First Agent', ['ask', 'auto', 'skip_all']);
  const second = namedAgent('Second Agent', ['ask', 'skip_all']);
  const agents = createAgentRegistry(
    [
      { agentId: 'first-agent', agent: claude.port },
      { agentId: 'second-agent', agent: second.port },
    ],
    { legacyAgentId: 'first-agent' },
  );
  const chat = createChat({
    dataDir: tempDir('ogden-agents-data-'),
    entities: core.entities,
    sessionEvents: core.sessionEvents,
    agents,
    agentEnv: (agentId) => ({ WHO: agentId }),
    events: core.events,
    installSettings: core.installSettings,
  });
  const workspace = chat.openWorkspace(tempDir('ogden-agents-repo-'));
  return { core, chat, workspace, claude, second, agents };
}

const streamOf = (core: Core, sessionId: SessionId): CoreEvent[] => core.events.readAfter(0).filter((event) => event.streamId === sessionId);

const until = async (check: () => boolean, what: string, ms = 2_000) => {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

describe('the agent registry', () => {
  it('lists its agents in order, defaults to the first, and refuses a wiring mistake', () => {
    const port = namedAgent('A').port;
    const registry = createAgentRegistry([
      { agentId: 'a-agent', agent: port },
      { agentId: 'b-agent', agent: port },
    ]);
    expect(registry.agentIds).toEqual(['a-agent', 'b-agent']);
    expect(registry.defaultAgentId).toBe('a-agent');
    expect(registry.legacyAgentId).toBe('a-agent');
    expect(registry.get('b-agent')).toBe(port);
    expect(registry.get('c-agent')).toBeUndefined();
    expect(() => createAgentRegistry([])).toThrow(/no agent/);
    expect(() => createAgentRegistry([{ agentId: 'Not An Id', agent: port }])).toThrow(/not an agent id/);
    expect(() => createAgentRegistry([{ agentId: 'a-agent', agent: port }, { agentId: 'a-agent', agent: port }])).toThrow(/twice/);
    expect(() => createAgentRegistry([{ agentId: 'a-agent', agent: port }], { defaultAgentId: 'b-agent' })).toThrow(/not registered/);
  });
});

describe('a chat has the agent it was started with (E6-R1)', () => {
  it('stores the agent picked, in the row and in session.created; none picked is the default', () => {
    const { core, chat, workspace } = setUp();
    const picked = chat.createChatSession(workspace.id, { agentId: 'second-agent' });
    const plain = chat.createChatSession(workspace.id);
    expect(picked.agentId).toBe('second-agent');
    expect(plain.agentId).toBe('first-agent');
    expect(core.entities.getSession(picked.id)?.agentId).toBe('second-agent');
    const created = streamOf(core, picked.id).find((event) => event.type === 'session.created');
    expect(created?.type === 'session.created' && created.payload.session.agentId).toBe('second-agent');
    expect(chat.getSession(workspace.id, picked.id).agentId).toBe('second-agent');
    expect(chat.listSessions(workspace.id).map((session) => session.agentId)).toEqual(['second-agent', 'first-agent']);
  });

  it('refuses an agent that is not registered, creating nothing', () => {
    const { core, chat, workspace } = setUp();
    expect(() => chat.createChatSession(workspace.id, { agentId: 'missing-agent' })).toThrow(UnknownAgentError);
    expect(chat.listSessions(workspace.id)).toEqual([]);
    expect(core.events.readAfter(0).some((event) => event.type === 'session.created')).toBe(false);
  });

  it('reads a session stored before agents could be chosen as the legacy agent, and reaches that agent', async () => {
    const { core, chat, workspace, claude, second } = setUp();
    // As a session row and its event from before this story: no agent id at all.
    const old = core.entities.createSession({ workspaceId: workspace.id, kind: 'chat' });
    expect(core.entities.getSession(old.id)?.agentId).toBeUndefined();
    expect(chat.getSession(workspace.id, old.id).agentId).toBe('first-agent');
    chat.sendMessage(workspace.id, old.id, 'hello');
    await until(() => claude.pending() === 1, 'the legacy agent to answer');
    expect(second.pending()).toBe(0);
    claude.release();
    await chat.settled();
  });

  it('a chat whose agent is not registered this run fails with a plain reason instead of reaching another agent', async () => {
    const { core, chat, workspace, claude, second } = setUp();
    const gone = core.entities.createSession({ workspaceId: workspace.id, kind: 'chat', agentId: 'removed-agent' });
    chat.sendMessage(workspace.id, gone.id, 'hello');
    await chat.settled();
    expect(core.entities.getSession(gone.id)?.state).toBe('error');
    const failed = streamOf(core, gone.id).find((event) => event.type === 'session.state_changed' && event.payload.state === 'error');
    expect(failed?.type === 'session.state_changed' && failed.payload.reason).toBe(AGENT_NOT_REGISTERED_REASON);
    expect(claude.envs).toEqual([]);
    expect(second.envs).toEqual([]);
  });

  it('two chats with two agents in one project work at once, each with its own agent and environment', async () => {
    const { core, chat, workspace, claude, second } = setUp();
    const first = chat.createChatSession(workspace.id, { agentId: 'first-agent' });
    const other = chat.createChatSession(workspace.id, { agentId: 'second-agent' });
    chat.sendMessage(workspace.id, first.id, 'one');
    chat.sendMessage(workspace.id, other.id, 'two');
    await until(() => claude.pending() === 1 && second.pending() === 1, 'both agents to be answering');
    expect(core.entities.getSession(first.id)?.state).toBe('working');
    expect(core.entities.getSession(other.id)?.state).toBe('working');
    claude.release();
    second.release();
    await chat.settled();
    const reply = (sessionId: SessionId) =>
      streamOf(core, sessionId).flatMap((event) => (event.type === 'session.message_completed' && event.payload.role === 'agent' ? [event.payload.content] : []));
    expect(reply(first.id)).toEqual(['First Agent heard one']);
    expect(reply(other.id)).toEqual(['Second Agent heard two']);
    // Each agent's process gets its own environment (AD-16: its own API key only).
    expect(claude.envs.map((env) => env.WHO)).toEqual(['first-agent']);
    expect(second.envs.map((env) => env.WHO)).toEqual(['second-agent']);
  });
});

describe('each agent declares its permission modes (E6-R2)', () => {
  it('lists the agents with the modes they declare, Ask always among them', () => {
    const { chat } = setUp();
    expect(chat.chatAgents()).toEqual({
      agents: [
        { agentId: 'first-agent', displayName: 'First Agent', permissionModes: ['ask', 'auto', 'skip_all'] },
        { agentId: 'second-agent', displayName: 'Second Agent', permissionModes: ['ask', 'skip_all'] },
      ],
      defaultAgentId: 'first-agent',
    });
  });

  it("offers a chat only its own agent's modes, and refuses the others", () => {
    const { core, chat, workspace } = setUp();
    core.installSettings.setDeveloperMode(true);
    const first = chat.createChatSession(workspace.id, { agentId: 'first-agent' });
    const other = chat.createChatSession(workspace.id, { agentId: 'second-agent' });
    expect(chat.permissionModeOptions(workspace.id, first.id).every((option) => option.available)).toBe(true);
    expect(chat.permissionModeOptions(workspace.id, other.id)).toEqual([
      { mode: 'ask', available: true },
      { mode: 'auto', available: false, reason: "Second Agent doesn't offer Auto." },
      { mode: 'skip_all', available: true },
    ]);
    expect(() => chat.setPermissionMode(workspace.id, other.id, 'auto')).toThrow(ModeUnavailableError);
    expect(chat.setPermissionMode(workspace.id, first.id, 'auto').permissionMode).toBe('auto');
    expect(chat.setPermissionMode(workspace.id, other.id, 'skip_all', { confirm: true })).toMatchObject({ permissionMode: 'skip_all', agentId: 'second-agent' });
  });
});
