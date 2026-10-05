/**
 * Story 11: each chat runs on a model the user can switch. A new chat starts
 * on the project's default for its agent, else the install's, else the
 * agent's own choice; the stored model reaches the agent at the idle point
 * before each prompt (live, or by restarting an agent that takes its model
 * only at start); a refused model moves the chat back to the agent's default
 * with the agent's words; every change is a `session.model_changed` event;
 * old sessions read as the agent's own choice.
 */
import { SessionCreatedEvent, type AgentModel, type CoreEvent, type SessionId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import {
  AgentError,
  createAgentRegistry,
  createChat,
  DriverIsTerminalError,
  ModelUnavailableError,
  ValidationError,
  type AgentDescriptor,
  type AgentEvent,
  type AgentPort,
  type AgentSession,
  type AgentTerminalOptions,
  type Core,
  type StartAgentSession,
} from '../src/index.js';
import { openTestCore, registered, tempDir, TEST_AGENT_ID } from './helpers.js';
import { fakeTerminal } from './support/fake-terminal.js';

const LIST: AgentModel[] = [
  { id: 'own-pick', name: 'Own Pick' },
  { id: 'large', name: 'Large' },
  { id: 'small', name: 'Small' },
  { id: 'locked', name: 'Locked' },
];

interface ModelAgentOptions {
  /** `live`: its sessions list models and switch them; `start`: it takes a model only at start (a static descriptor list); `none`: no models. */
  kind?: 'live' | 'start' | 'none';
  /** A `setModel` that never answers. */
  hangs?: boolean;
}

/**
 * An agent whose sessions run on a model: `setModel` switches it (recorded,
 * with the prompt count when it happened), `locked` is refused in the agent's
 * own words, a prompt `model` replies with it, `fallback <id>` reports a model
 * the agent switched to itself.
 */
function modelAgent(options: ModelAgentOptions = {}) {
  const kind = options.kind ?? 'live';
  const sets: Array<{ model: string | null; beforePrompts: number }> = [];
  const starts: Array<string | undefined> = [];
  const closed: string[] = [];
  let prompts = 0;
  let opened = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const open = (input: StartAgentSession, agentSessionId: string): AgentSession => {
    starts.push(input.model);
    const listeners = new Set<(event: AgentEvent) => void>();
    const emit = (event: AgentEvent) => {
      for (const listener of [...listeners]) listener(event);
    };
    let current = kind === 'start' ? (input.model ?? 'own-pick') : 'own-pick';
    const session: AgentSession = {
      agentSessionId,
      ...(kind === 'none' ? {} : { models: undefined }),
      onEvent(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async prompt(text) {
        prompts++;
        emit({ type: 'state', state: 'working' });
        if (text === 'wait') await held;
        if (text === 'model') emit({ type: 'message_chunk', text: `model=${current}` });
        else if (text.startsWith('fallback ')) {
          current = text.slice('fallback '.length);
          emit({ type: 'model', model: current });
          emit({ type: 'message_chunk', text: `model=${current}` });
        } else emit({ type: 'message_chunk', text: 'Hello' });
        emit({ type: 'state', state: 'idle' });
        return { stopReason: 'end_turn' };
      },
      async cancel() {},
      async close() {
        closed.push(agentSessionId);
      },
    };
    if (kind !== 'none') Object.defineProperty(session, 'models', { get: () => ({ available: LIST, current }) });
    if (kind === 'live') {
      (session as { setModel?: AgentSession['setModel'] }).setModel = async (model) => {
        if (options.hangs === true) return new Promise<void>(() => {});
        if (model === 'locked') throw new AgentError('agent_failed', "Your plan doesn't include Locked.");
        sets.push({ model, beforePrompts: prompts });
        current = model ?? 'own-pick';
      };
    }
    return session;
  };
  const terminalOptions: Array<AgentTerminalOptions | undefined> = [];
  const port: AgentPort = {
    displayName: 'Test Agent',
    skillInvocation: (skill) => `/${skill}`,
    permissionModes: ['ask'],
    listAuthMethods: async () => [],
    startSession: async (input) => open(input, `agent-${++opened}`),
    reopenSession: async (input) => ({ session: open(input, input.agentSessionId), restored: 'resumed' }),
    terminalResume: {
      command: async (id, env, terminal) => {
        terminalOptions.push(terminal);
        return { file: 'claude', args: ['--resume', id], env: { ...env } };
      },
      locate: async () => ({ found: true }),
    },
  };
  const overrides: Partial<AgentDescriptor> = kind === 'start' ? { models: { list: LIST, apply: { kind: 'env', name: 'TEST_MODEL' } } } : {};
  return { port, overrides, sets, starts, closed, terminalOptions, release, prompts: () => prompts };
}

function setUp(agent = modelAgent(), core: Core = openTestCore(), timeoutMs?: number) {
  const internal: unknown[] = [];
  const terminal = fakeTerminal();
  const chat = createChat({
    dataDir: tempDir('ogden-agents-data-'),
    entities: core.entities,
    sessionEvents: core.sessionEvents,
    agents: createAgentRegistry([registered(TEST_AGENT_ID, agent.port, agent.overrides)]),
    permissions: core.permissions,
    events: core.events,
    installSettings: core.installSettings,
    agentModels: core.agentModels,
    terminal: terminal.port,
    onInternalError: (_sessionId, error) => internal.push(error),
    ...(timeoutMs === undefined ? {} : { permissionModeTimeoutMs: timeoutMs }),
  });
  const workspace = chat.openWorkspace(tempDir('ogden-agents-repo-'));
  return { core, chat, agent, workspace, internal, terminal };
}

const streamOf = (core: Core, sessionId: SessionId): CoreEvent[] => core.events.readAfter(0).filter((event) => event.streamId === sessionId);

const modelChanges = (core: Core, sessionId: SessionId) =>
  streamOf(core, sessionId).flatMap((event) =>
    event.type === 'session.model_changed' ? [{ model: event.payload.model, previous: event.payload.previous, cause: event.payload.cause, reason: event.payload.reason }] : [],
  );

const replies = (core: Core, sessionId: SessionId) =>
  streamOf(core, sessionId).flatMap((event) => (event.type === 'session.message_completed' && event.payload.role === 'agent' ? [event.payload.content] : []));

describe('a new chat starts on the right model (criterion 1)', () => {
  it('the project default wins over the install default, which wins over the agent own choice', async () => {
    const { core, chat, workspace } = setUp();
    const own = await chat.createChatSession(workspace.id, { agentId: TEST_AGENT_ID });
    expect(own.model).toBeUndefined();
    core.agentModels.setDefaultModel(TEST_AGENT_ID, 'small');
    const install = await chat.createChatSession(workspace.id, { agentId: TEST_AGENT_ID });
    expect(install.model).toBe('small');
    core.permissions.updateSettings(workspace.id, { defaultModels: { [TEST_AGENT_ID]: 'large' } });
    const project = await chat.createChatSession(workspace.id, { agentId: TEST_AGENT_ID });
    expect(project.model).toBe('large');
    // Recorded in the chat's first event, with nothing else.
    const created = streamOf(core, project.id).find((event) => event.type === 'session.created');
    expect(created?.type === 'session.created' ? created.payload.session.model : undefined).toBe('large');
    expect(modelChanges(core, project.id)).toEqual([]);
    // Clearing the project's default falls back to the install's again.
    core.permissions.updateSettings(workspace.id, { defaultModels: { [TEST_AGENT_ID]: null } });
    expect((await chat.createChatSession(workspace.id, { agentId: TEST_AGENT_ID })).model).toBe('small');
  });

  it('a model given at creation (an agent handoff) wins, null keeps the agent own choice, and a non-id is refused', async () => {
    const { core, chat, workspace } = setUp();
    core.agentModels.setDefaultModel(TEST_AGENT_ID, 'small');
    expect((await chat.createChatSession(workspace.id, { agentId: TEST_AGENT_ID, model: 'large' })).model).toBe('large');
    expect((await chat.createChatSession(workspace.id, { agentId: TEST_AGENT_ID, model: null })).model).toBeUndefined();
    await expect(chat.createChatSession(workspace.id, { agentId: TEST_AGENT_ID, model: '--evil' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('the agent runs on the chat model before its first prompt', async () => {
    const { core, chat, agent, workspace } = setUp();
    const session = await chat.createChatSession(workspace.id, { agentId: TEST_AGENT_ID, model: 'large' });
    chat.sendMessage(workspace.id, session.id, 'model');
    await chat.settled();
    expect(agent.sets).toEqual([{ model: 'large', beforePrompts: 0 }]);
    expect(replies(core, session.id)).toEqual(['model=large']);
  });
});

describe('the picker lists the agent models (criterion 2)', () => {
  it('unknown before any agent started, then this session list and the one it runs on, kept for the agent', async () => {
    const { core, chat, workspace } = setUp();
    const session = await chat.createChatSession(workspace.id, { agentId: TEST_AGENT_ID });
    expect(chat.modelOptions(workspace.id, session.id)).toEqual({ available: null });
    chat.sendMessage(workspace.id, session.id, 'hello');
    await chat.settled();
    expect(chat.modelOptions(workspace.id, session.id)).toEqual({ available: LIST, current: 'own-pick' });
    // Kept install-wide: another chat, and the agent list, know it before their agent starts.
    expect(core.agentModels.lastModels(TEST_AGENT_ID)).toEqual(LIST);
    const other = await chat.createChatSession(workspace.id, { agentId: TEST_AGENT_ID });
    expect(chat.modelOptions(workspace.id, other.id)).toEqual({ available: LIST });
    expect((await chat.chatAgents()).agents[0]?.models).toEqual(LIST);
  });
});

describe('a switch applies to the next message (criterion 3, 6)', () => {
  it('records one event, tells a live agent before its next prompt, and the same model again records nothing', async () => {
    const { core, chat, agent, workspace } = setUp();
    const session = await chat.createChatSession(workspace.id, { agentId: TEST_AGENT_ID });
    chat.sendMessage(workspace.id, session.id, 'hello');
    await chat.settled();
    expect(chat.setModel(workspace.id, session.id, 'large').model).toBe('large');
    expect(modelChanges(core, session.id)).toEqual([{ model: 'large', previous: null, cause: 'user', reason: undefined }]);
    // Not told yet: only at the next idle point before a prompt.
    expect(agent.sets).toEqual([]);
    chat.setModel(workspace.id, session.id, 'large');
    expect(modelChanges(core, session.id)).toHaveLength(1);
    chat.sendMessage(workspace.id, session.id, 'model');
    await chat.settled();
    expect(agent.sets).toEqual([{ model: 'large', beforePrompts: 1 }]);
    expect(replies(core, session.id).at(-1)).toBe('model=large');
    // Back to the agent's own choice.
    chat.setModel(workspace.id, session.id, null);
    chat.sendMessage(workspace.id, session.id, 'model');
    await chat.settled();
    expect(agent.sets.at(-1)).toEqual({ model: null, beforePrompts: 2 });
    expect(replies(core, session.id).at(-1)).toBe('model=own-pick');
    expect(agent.closed).toEqual([]);
  });

  it('a switch made while the agent works never reaches it mid-turn: the queued message runs on it', async () => {
    const { core, chat, agent, workspace } = setUp();
    const session = await chat.createChatSession(workspace.id, { agentId: TEST_AGENT_ID });
    chat.sendMessage(workspace.id, session.id, 'wait');
    const deadline = Date.now() + 2_000;
    while (agent.prompts() === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
    chat.setModel(workspace.id, session.id, 'small');
    chat.sendMessage(workspace.id, session.id, 'model');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(agent.sets).toEqual([]);
    agent.release();
    await chat.settled();
    expect(agent.sets).toEqual([{ model: 'small', beforePrompts: 1 }]);
    expect(replies(core, session.id)).toEqual(['Hello', 'model=small']);
  });

  it('an agent that takes its model only at start is restarted (resumed) with it at the next idle point', async () => {
    const { core, chat, agent, workspace } = setUp(modelAgent({ kind: 'start' }));
    const session = await chat.createChatSession(workspace.id, { agentId: TEST_AGENT_ID, model: 'small' });
    chat.sendMessage(workspace.id, session.id, 'model');
    await chat.settled();
    expect(agent.starts).toEqual(['small']);
    chat.setModel(workspace.id, session.id, 'large');
    chat.sendMessage(workspace.id, session.id, 'model');
    await chat.settled();
    expect(agent.starts).toEqual(['small', 'large']);
    expect(agent.closed).toEqual(['agent-1']);
    expect(replies(core, session.id)).toEqual(['model=small', 'model=large']);
    // Its static list is what the picker offers before it starts.
    const other = await chat.createChatSession(workspace.id, { agentId: TEST_AGENT_ID });
    expect(chat.modelOptions(workspace.id, other.id).available).toEqual(LIST);
  });

  it('refuses an unlisted model, a non-id, and any change while the terminal drives, changing nothing', async () => {
    const { core, chat, workspace } = setUp();
    const session = await chat.createChatSession(workspace.id, { agentId: TEST_AGENT_ID });
    chat.sendMessage(workspace.id, session.id, 'hello');
    await chat.settled();
    expect(() => chat.setModel(workspace.id, session.id, 'huge')).toThrow(ModelUnavailableError);
    expect(() => chat.setModel(workspace.id, session.id, '-x')).toThrow(ValidationError);
    await chat.switchDriver(workspace.id, session.id, 'terminal');
    expect(() => chat.setModel(workspace.id, session.id, 'large')).toThrow(DriverIsTerminalError);
    expect(modelChanges(core, session.id)).toEqual([]);
  });
});

describe('a refused model is explained (criterion 4)', () => {
  it('moves the chat to the agent default with the agent words, and the prompt still goes out', async () => {
    const { core, chat, agent, workspace } = setUp();
    const session = await chat.createChatSession(workspace.id, { agentId: TEST_AGENT_ID, model: 'locked' });
    chat.sendMessage(workspace.id, session.id, 'model');
    await chat.settled();
    expect(core.entities.getSession(session.id)?.model).toBeUndefined();
    expect(modelChanges(core, session.id)).toEqual([
      { model: null, previous: 'locked', cause: 'agent', reason: "Test Agent couldn't switch to Locked: Your plan doesn't include Locked. This chat uses Test Agent's default." },
    ]);
    expect(replies(core, session.id)).toEqual(['model=own-pick']);
    expect(agent.prompts()).toBe(1);
  });

  it('an agent that never answers the switch does not hold the prompt back', async () => {
    const { core, chat, workspace, internal } = setUp(modelAgent({ hangs: true }), openTestCore(), 50);
    const session = await chat.createChatSession(workspace.id, { agentId: TEST_AGENT_ID, model: 'large' });
    chat.sendMessage(workspace.id, session.id, 'hello');
    await chat.settled();
    expect(replies(core, session.id)).toEqual(['Hello']);
    expect(internal.length).toBeGreaterThan(0);
  });
});

describe('the agent switching itself, the terminal, and old history (criteria 6, 7)', () => {
  it('a chat that chose a model follows a model the agent switched to itself; one on its own choice records nothing', async () => {
    const { core, chat, workspace } = setUp();
    const chosen = await chat.createChatSession(workspace.id, { agentId: TEST_AGENT_ID, model: 'large' });
    chat.sendMessage(workspace.id, chosen.id, 'fallback small');
    await chat.settled();
    expect(modelChanges(core, chosen.id)).toEqual([{ model: 'small', previous: 'large', cause: 'agent', reason: 'Test Agent switched itself to Small.' }]);
    const own = await chat.createChatSession(workspace.id, { agentId: TEST_AGENT_ID });
    chat.sendMessage(workspace.id, own.id, 'fallback small');
    await chat.settled();
    expect(modelChanges(core, own.id)).toEqual([]);
    expect(chat.modelOptions(workspace.id, own.id).current).toBe('small');
  });

  it('the terminal starts on the chat model', async () => {
    const { chat, agent, workspace } = setUp();
    const session = await chat.createChatSession(workspace.id, { agentId: TEST_AGENT_ID, model: 'large' });
    chat.sendMessage(workspace.id, session.id, 'hello');
    await chat.settled();
    await chat.switchDriver(workspace.id, session.id, 'terminal');
    expect(agent.terminalOptions.at(-1)?.model).toBe('large');
  });

  it('a session.created from before models reads as the agent own choice', () => {
    const old = {
      id: 'evt_01J9Z3K4M5N6P7Q8R9S0T1V2W5',
      seq: 1,
      at: '2026-10-01T00:00:00.000Z',
      type: 'session.created',
      workspaceId: 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3',
      streamId: 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W4',
      payload: {
        session: {
          id: 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W4',
          workspaceId: 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3',
          kind: 'chat',
          state: 'idle',
          driver: 'ui',
          title: null,
          adapterRefs: {},
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-01T00:00:00.000Z',
        },
      },
    };
    const parsed = SessionCreatedEvent.parse(old);
    expect(parsed.payload.session.model).toBeUndefined();
  });
});

describe('defaults are kept per agent and per project (criterion 5)', () => {
  it('the install default is one event per change and survives reopening the database', () => {
    const dataDir = tempDir();
    const core = openTestCore(dataDir);
    expect(core.agentModels.setDefaultModel(TEST_AGENT_ID, 'large')).toEqual({ model: 'large', changed: true });
    expect(core.agentModels.setDefaultModel(TEST_AGENT_ID, 'large')).toEqual({ model: 'large', changed: false });
    core.agentModels.rememberModels(TEST_AGENT_ID, LIST);
    const events = core.events.readAfter(0).filter((event) => event.type === 'settings.agent_default_model_changed');
    expect(events.map((event) => event.payload)).toEqual([{ agentId: TEST_AGENT_ID, model: 'large', previous: null }]);
    core.close();
    const again = openTestCore(dataDir);
    expect(again.agentModels.defaultModel(TEST_AGENT_ID)).toBe('large');
    expect(again.agentModels.lastModels(TEST_AGENT_ID)).toEqual(LIST);
    expect(() => again.agentModels.setDefaultModel(TEST_AGENT_ID, '-rf')).toThrow(ValidationError);
  });

  it('a project default is per agent, recorded on workspace.settings_changed, and leaves other agents alone', () => {
    const core = openTestCore();
    const { workspace } = setUp(modelAgent(), core);
    core.permissions.updateSettings(workspace.id, { defaultModels: { [TEST_AGENT_ID]: 'large', 'other-agent': 'x' } });
    expect(core.permissions.getSettings(workspace.id).defaultModels).toEqual({ [TEST_AGENT_ID]: 'large', 'other-agent': 'x' });
    core.permissions.updateSettings(workspace.id, { defaultModels: { 'other-agent': null } });
    expect(core.permissions.getSettings(workspace.id).defaultModels).toEqual({ [TEST_AGENT_ID]: 'large' });
    const changed = core.events.readAfter(0).filter((event) => event.type === 'workspace.settings_changed');
    expect(changed.at(-1)?.type === 'workspace.settings_changed' ? changed.at(-1)?.payload : undefined).toMatchObject({
      defaultModels: { [TEST_AGENT_ID]: 'large' },
      previousDefaultModels: { [TEST_AGENT_ID]: 'large', 'other-agent': 'x' },
    });
    expect(() => core.permissions.updateSettings(workspace.id, { defaultModels: { [TEST_AGENT_ID]: '' } })).toThrow(ValidationError);
  });
});
