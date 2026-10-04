/**
 * Permission modes: each chat has a mode (Ask, Auto, Skip all), stored on its
 * session and changed only by core, each change a
 * `session.permission_mode_changed` event. Every agent session starts in the
 * chat's mode; a mode the agent reports that the chat didn't choose moves the
 * chat to Ask; Skip all needs Developer mode and a confirmation, enforced
 * here; turning Developer mode off drops every Skip-all chat to Ask; a
 * restart sets every chat back to Ask; in Skip all no caution level or rule
 * answers a request and Always allow is refused; the terminal starts in the
 * chat's mode.
 */
import { PERMISSION_MODES, SKIP_ALL_REFUSAL, type CoreEvent, type PermissionMode, type SessionId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import {
  AgentError,
  ConfirmationRequiredError,
  createChat,
  DEVELOPER_MODE_OFF_REASON,
  DeveloperModeRequiredError,
  DriverIsTerminalError,
  ModeUnavailableError,
  PROTECTED_PATHS,
  RESTART_MODE_REASON,
  ValidationError,
  type AgentEvent,
  type AgentPermissionDecision,
  type AgentPort,
  type AgentSession,
  type AgentTerminalOptions,
  type Core,
  type StartAgentSession,
} from '../src/index.js';
import { openTestCore, soleAgent, tempDir, TEST_AGENT_ID } from './helpers.js';
import { fakeTerminal } from './support/fake-terminal.js';

interface ModedAgentOptions {
  /** The modes the agent declares. Default all three. */
  declares?: readonly PermissionMode[];
  /** The modes each session lists. Default all three. */
  lists?: readonly PermissionMode[];
  /** The mode a session starts in, as the user's own settings would start it. Default `ask`. */
  startsIn?: PermissionMode | 'other';
  /** When set, `setPermissionMode` for these modes never answers (an agent that can't be told). */
  hangsOn?: readonly PermissionMode[];
  /** When set, `setPermissionMode` for these modes rejects. */
  refuses?: readonly PermissionMode[];
  /** Started with protected paths, it doesn't keep them (an agent that can't guard). */
  ignoresGuards?: boolean;
  /** Reading the session's modes throws this many times after its first read (an unexpected failure mid-push). */
  modesThrow?: number;
}

/**
 * An agent whose sessions have a mode: `setPermissionMode` sets it (recorded
 * in `sets`), a prompt `mode` replies with it, a prompt `report <mode>
 * [asks-less]` reports a mode the agent switched to itself, and a prompt
 * `ask` asks permission for an `execute` (`npm test`) or, with `ask-read`, a
 * `read` of `src/a.ts`.
 */
function modedAgent(options: ModedAgentOptions = {}) {
  const sets: Array<{ session: string; mode: PermissionMode; beforePrompts: number }> = [];
  /** Whether each session was started with the protected paths guarded, in start order. */
  const guarded: boolean[] = [];
  const protectedPathsGiven: Array<StartAgentSession['protectedPaths']> = [];
  const decisions: AgentPermissionDecision[] = [];
  let prompts = 0;
  let sessionsOpened = 0;
  const closed: string[] = [];
  const live = new Map<string, { emit: (event: AgentEvent) => void; mode: () => PermissionMode | 'other' }>();
  const open = (input: StartAgentSession, agentSessionId: string): AgentSession => {
    const listeners = new Set<(event: AgentEvent) => void>();
    let mode: PermissionMode | 'other' = options.startsIn ?? 'ask';
    const emit = (event: AgentEvent) => {
      for (const listener of [...listeners]) listener(event);
    };
    live.set(agentSessionId, { emit, mode: () => mode });
    guarded.push(input.protectedPaths !== undefined);
    protectedPathsGiven.push(input.protectedPaths);
    let modeReads = 0;
    let throwsLeft = options.modesThrow ?? 0;
    return {
      agentSessionId,
      protectsPaths: input.protectedPaths !== undefined && options.ignoresGuards !== true,
      get permissionModes() {
        // The first reads are the start's (recorded twice, then applied); later ones may throw.
        if (++modeReads > 3 && throwsLeft > 0) {
          throwsLeft--;
          throw new Error('modes unreadable');
        }
        return options.lists ?? PERMISSION_MODES;
      },
      async setPermissionMode(next) {
        if (options.hangsOn?.includes(next)) return new Promise<void>(() => {});
        if (options.refuses?.includes(next)) throw new AgentError('agent_failed', 'Test Agent refused the mode.');
        sets.push({ session: agentSessionId, mode: next, beforePrompts: prompts });
        mode = next;
      },
      onEvent(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async prompt(text) {
        prompts++;
        emit({ type: 'state', state: 'working' });
        if (text === 'mode') emit({ type: 'message_chunk', text: `mode=${mode}` });
        else if (text.startsWith('report ')) {
          const [, reported = 'other', asksLess] = text.split(' ');
          mode = reported as PermissionMode | 'other';
          emit({ type: 'permission_mode', mode: mode, asksLess: asksLess === 'asks-less', label: reported === 'other' ? 'Plan' : undefined });
          emit({ type: 'message_chunk', text: `mode=${mode}` });
        } else if (text === 'ask' || text === 'ask-read') {
          const decision = await input.onPermissionRequest!(
            text === 'ask' ? { toolCallId: 'call-1', title: 'Run npm test', kind: 'execute', command: 'npm test' } : { toolCallId: 'call-2', title: 'Read src/a.ts', kind: 'read', paths: ['src/a.ts'] },
          );
          decisions.push(decision);
          emit({ type: 'message_chunk', text: decision.outcome });
        } else emit({ type: 'message_chunk', text: 'Hello' });
        emit({ type: 'state', state: 'idle' });
        return { stopReason: 'end_turn' };
      },
      async cancel() {},
      async close() {
        closed.push(agentSessionId);
      },
    };
  };
  const terminalOptions: Array<AgentTerminalOptions | undefined> = [];
  const port: AgentPort = {
    displayName: 'Test Agent',
    skillInvocation: (skill) => `/${skill}`,
    permissionModes: options.declares ?? PERMISSION_MODES,
    listAuthMethods: async () => [],
    startSession: async (input) => open(input, `agent-${++sessionsOpened}`),
    reopenSession: async (input) => ({ session: open(input, input.agentSessionId), restored: 'resumed' }),
    terminalResume: {
      command: async (id, env, terminal) => {
        terminalOptions.push(terminal);
        return { file: 'claude', args: ['--resume', id], env: { ...env } };
      },
      locate: async () => ({ found: true }),
    },
  };
  return { port, sets, guarded, protectedPathsGiven, decisions, closed, terminalOptions, live, prompts: () => prompts };
}

function setUp(agent = modedAgent(), core: Core = openTestCore(), timeoutMs?: number) {
  const internal: unknown[] = [];
  const terminal = fakeTerminal();
  const chat = createChat({
    dataDir: tempDir('ogden-agents-data-'),
    entities: core.entities,
    sessionEvents: core.sessionEvents,
    agents: soleAgent(agent.port),
    permissions: core.permissions,
    events: core.events,
    installSettings: core.installSettings,
    terminal: terminal.port,
    onInternalError: (_sessionId, error) => internal.push(error),
    ...(timeoutMs === undefined ? {} : { permissionModeTimeoutMs: timeoutMs }),
  });
  const workspace = chat.openWorkspace(tempDir('ogden-agents-repo-'));
  const session = core.entities.createSession({ workspaceId: workspace.id, kind: 'chat', agentId: TEST_AGENT_ID });
  return { core, chat, agent, workspace, session, internal, terminal };
}

const streamOf = (core: Core, sessionId: SessionId): CoreEvent[] => core.events.readAfter(0).filter((event) => event.streamId === sessionId);

const modeChanges = (core: Core, sessionId: SessionId) =>
  streamOf(core, sessionId).flatMap((event) =>
    event.type === 'session.permission_mode_changed' ? [{ mode: event.payload.mode, previous: event.payload.previous, cause: event.payload.cause, reason: event.payload.reason }] : [],
  );

const replies = (core: Core, sessionId: SessionId) =>
  streamOf(core, sessionId).flatMap((event) => (event.type === 'session.message_completed' && event.payload.role === 'agent' ? [event.payload.content] : []));

const until = async (check: () => boolean, what: string, ms = 2_000) => {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

describe('a chat starts in Ask (criterion 1)', () => {
  it('a new chat is in Ask, and an agent its own settings started in Skip all is told Ask before its first prompt', async () => {
    const { core, chat, agent, workspace, session } = setUp(modedAgent({ startsIn: 'skip_all' }));
    expect(session.permissionMode).toBe('ask');
    chat.sendMessage(workspace.id, session.id, 'mode');
    await chat.settled();
    expect(agent.sets).toEqual([{ session: 'agent-1', mode: 'ask', beforePrompts: 0 }]);
    expect(replies(core, session.id)).toEqual(['mode=ask']);
    expect(modeChanges(core, session.id)).toEqual([]);
  });

  it('an agent that cannot be put in Ask is stopped, and the chat fails with a plain reason', async () => {
    const { core, chat, agent, workspace, session } = setUp(modedAgent({ startsIn: 'skip_all', refuses: ['ask'] }));
    chat.sendMessage(workspace.id, session.id, 'mode');
    await chat.settled();
    expect(agent.prompts()).toBe(0);
    expect(agent.closed).toEqual(['agent-1']);
    expect(core.entities.getSession(session.id)?.state).toBe('error');
  });

  it('a server start sets every chat not in Ask back to Ask, cause restart', () => {
    const core = openTestCore();
    const { session: a } = setUp(modedAgent(), core);
    const { session: b } = setUp(modedAgent(), core);
    core.entities.setSessionPermissionMode(a.id, 'auto', 'user');
    const reset = core.entities.resetPermissionModes();
    expect(reset.map((session) => [session.id, session.permissionMode])).toEqual([[a.id, 'ask']]);
    expect(modeChanges(core, a.id).at(-1)).toEqual({ mode: 'ask', previous: 'auto', cause: 'restart', reason: RESTART_MODE_REASON });
    expect(modeChanges(core, b.id)).toEqual([]);
  });
});

describe('the user switches a chat to Auto (criterion 2, 10)', () => {
  it('records one event with the cause, tells the live agent, and the same mode again records nothing', async () => {
    const { core, chat, agent, workspace, session } = setUp();
    chat.sendMessage(workspace.id, session.id, 'hello');
    await chat.settled();
    const updated = chat.setPermissionMode(workspace.id, session.id, 'auto');
    // Stored before anything else happens: the agent's next tool call finds the chat in Auto.
    expect(updated.permissionMode).toBe('auto');
    expect(core.entities.getSession(session.id)?.permissionMode).toBe('auto');
    expect(modeChanges(core, session.id)).toEqual([{ mode: 'auto', previous: 'ask', cause: 'user', reason: undefined }]);
    // Started without the protected paths guarded: it stays in Ask and restarts (idle now, so at once), guarded.
    await until(() => agent.closed.length === 1, 'the unguarded agent restarted');
    expect(agent.sets.map((set) => set.mode)).not.toContain('auto');
    chat.setPermissionMode(workspace.id, session.id, 'auto');
    expect(modeChanges(core, session.id)).toHaveLength(1);
    chat.sendMessage(workspace.id, session.id, 'mode');
    await chat.settled();
    expect(replies(core, session.id).at(-1)).toBe('mode=auto');
    expect(agent.guarded).toEqual([false, true]);
  });

  it('a request the agent still sends in Auto is decided by the caution level and rules, as in Ask', async () => {
    const { core, chat, workspace, session, agent } = setUp();
    core.permissions.updateSettings(workspace.id, { cautionLevel: 'ask_for_commands' });
    chat.setPermissionMode(workspace.id, session.id, 'auto');
    chat.sendMessage(workspace.id, session.id, 'ask-read');
    await chat.settled();
    expect(agent.decisions).toEqual([{ outcome: 'allow_once' }]);
    const requested = streamOf(core, session.id).find((event) => event.type === 'permission.requested');
    expect(requested).toMatchObject({ payload: { permissionMode: 'auto', cautionLevel: 'ask_for_commands' } });
    expect(streamOf(core, session.id).find((event) => event.type === 'permission.resolved')).toMatchObject({ payload: { by: 'caution' } });
  });

  it('the agent of a reopened chat starts in the chat’s mode', async () => {
    const { core, chat, agent, workspace, session } = setUp();
    chat.setPermissionMode(workspace.id, session.id, 'auto');
    chat.sendMessage(workspace.id, session.id, 'mode');
    await chat.settled();
    expect(agent.sets[0]).toEqual({ session: 'agent-1', mode: 'auto', beforePrompts: 0 });
    expect(replies(core, session.id)).toEqual(['mode=auto']);
  });
});

describe('a mode the chat did not choose never sticks (criterion 3)', () => {
  it('Auto falling back to accepting edits moves the chat to Ask with a reason, and the agent is told Ask', async () => {
    const { core, chat, agent, workspace, session } = setUp();
    chat.setPermissionMode(workspace.id, session.id, 'auto');
    chat.sendMessage(workspace.id, session.id, 'report other asks-less');
    await chat.settled();
    await until(() => agent.sets.at(-1)?.mode === 'ask', 'the agent told Ask');
    expect(core.entities.getSession(session.id)?.permissionMode).toBe('ask');
    const last = modeChanges(core, session.id).at(-1)!;
    expect(last).toMatchObject({ mode: 'ask', previous: 'auto', cause: 'agent' });
    expect(last.reason).toMatch(/^Test Agent switched itself to .+, so this chat is back in Ask\.$/);
  });

  it('the agent entering plan mode by itself moves the chat to Ask, but it is not told Ask (it asks no less)', async () => {
    const { core, chat, agent, workspace, session } = setUp();
    chat.setPermissionMode(workspace.id, session.id, 'auto');
    chat.sendMessage(workspace.id, session.id, 'report other');
    await chat.settled();
    expect(modeChanges(core, session.id).at(-1)).toEqual({ mode: 'ask', previous: 'auto', cause: 'agent', reason: 'Test Agent switched itself to Plan, so this chat is back in Ask.' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(agent.sets.map((set) => set.mode)).toEqual(['auto']);
  });

  it('a chat in Ask whose agent reports Auto stays in Ask (no event) and the agent is told Ask', async () => {
    const { core, chat, agent, workspace, session } = setUp();
    chat.sendMessage(workspace.id, session.id, 'report auto asks-less');
    await chat.settled();
    await until(() => agent.sets.length === 2, 'the agent told Ask again');
    expect(agent.sets.map((set) => set.mode)).toEqual(['ask', 'ask']);
    expect(modeChanges(core, session.id)).toEqual([]);
  });

  it("the agent's echo of the chat's own mode changes nothing", async () => {
    const { core, chat, agent, workspace, session } = setUp();
    chat.setPermissionMode(workspace.id, session.id, 'auto');
    chat.sendMessage(workspace.id, session.id, 'report auto asks-less');
    await chat.settled();
    expect(core.entities.getSession(session.id)?.permissionMode).toBe('auto');
    expect(modeChanges(core, session.id)).toHaveLength(1);
    expect(agent.sets.map((set) => set.mode)).toEqual(['auto']);
  });

  it('an agent that refuses a looser mode leaves the chat in Ask, with a reason', async () => {
    const { core, chat, agent, workspace, session } = setUp(modedAgent({ refuses: ['auto'] }));
    chat.setPermissionMode(workspace.id, session.id, 'auto');
    chat.sendMessage(workspace.id, session.id, 'mode');
    await chat.settled();
    expect(replies(core, session.id)).toEqual(['mode=ask']);
    expect(modeChanges(core, session.id).at(-1)).toEqual({ mode: 'ask', previous: 'auto', cause: 'agent', reason: "Test Agent couldn't switch to Auto, so this chat is back in Ask." });
    expect(agent.closed).toEqual([]);
  });
});

describe('telling the agent its mode safely (review)', () => {
  it('a looser mode the agent does not take in time stops it: never retried as Ask, never left running', async () => {
    const { core, chat, agent, workspace, session, internal } = setUp(modedAgent({ hangsOn: ['skip_all'] }), openTestCore(), 50);
    chat.sendMessage(workspace.id, session.id, 'hello');
    await chat.settled();
    core.installSettings.setDeveloperMode(true);
    chat.setPermissionMode(workspace.id, session.id, 'skip_all', { confirm: true });
    await until(() => agent.closed.length === 1, 'the agent stopped');
    expect(agent.sets.map((set) => set.mode)).toEqual(['ask']);
    expect(internal.some((error) => (error as { code?: string }).code === 'permission_mode_timeout')).toBe(true);
    expect(modeChanges(core, session.id).map((change) => change.cause)).toEqual(['user']);
  });

  it('a push that failed unexpectedly does not stop later ones: the next change still reaches the agent', async () => {
    const { core, chat, agent, workspace, session } = setUp(modedAgent({ modesThrow: 2 }));
    chat.sendMessage(workspace.id, session.id, 'hello');
    await chat.settled();
    core.installSettings.setDeveloperMode(true);
    // Its first push (and the retry) fails reading the modes: the agent is stopped, never left unknown.
    chat.setPermissionMode(workspace.id, session.id, 'skip_all', { confirm: true });
    await until(() => agent.closed.length === 1, 'the agent stopped');
    // A later change to a fresh agent is told as usual.
    chat.sendMessage(workspace.id, session.id, 'mode');
    await chat.settled();
    expect(replies(core, session.id).at(-1)).toBe('mode=skip_all');
  });

  it('one failed push is told again: the chain goes on and the agent ends in the chat’s mode', async () => {
    const { core, chat, agent, workspace, session } = setUp(modedAgent({ modesThrow: 1 }));
    chat.sendMessage(workspace.id, session.id, 'hello');
    await chat.settled();
    core.installSettings.setDeveloperMode(true);
    chat.setPermissionMode(workspace.id, session.id, 'skip_all', { confirm: true });
    await until(() => agent.sets.at(-1)?.mode === 'skip_all', 'the agent told Skip all on the retry');
    chat.setPermissionMode(workspace.id, session.id, 'ask');
    await until(() => agent.sets.at(-1)?.mode === 'ask', 'the next push');
    expect(agent.closed).toEqual([]);
  });

  it('a prompt waits for a mode change being told, so it never runs in the looser mode', async () => {
    const { core, chat, workspace, session } = setUp();
    chat.sendMessage(workspace.id, session.id, 'hello');
    await chat.settled();
    chat.setPermissionMode(workspace.id, session.id, 'auto');
    chat.sendMessage(workspace.id, session.id, 'mode');
    await chat.settled();
    expect(replies(core, session.id).at(-1)).toBe('mode=auto');
  });

  it("a chat whose agent hasn't started this run is refused a mode the last started session didn't list", async () => {
    const agent = modedAgent({ lists: ['ask', 'auto'] });
    const { chat, workspace, session } = setUp(agent);
    chat.sendMessage(workspace.id, session.id, 'hello');
    await chat.settled();
    const other = await chat.createChatSession(workspace.id);
    expect(chat.permissionModeOptions(workspace.id, other.id).find((option) => option.mode === 'skip_all')).toMatchObject({ available: false });
    expect(() => chat.setPermissionMode(workspace.id, other.id, 'skip_all', { confirm: true })).toThrow();
  });
});

describe('Auto keeps protected files guarded (user decision 2026-10-02)', () => {
  it('an Auto chat starts its agent with the protected paths guarded; Ask and Skip all start without', async () => {
    const core = openTestCore();
    const agent = modedAgent();
    const { chat, workspace, session } = setUp(agent, core);
    core.installSettings.setDeveloperMode(true);
    const auto = await chat.createChatSession(workspace.id);
    const skip = await chat.createChatSession(workspace.id);
    chat.setPermissionMode(workspace.id, auto.id, 'auto');
    chat.setPermissionMode(workspace.id, skip.id, 'skip_all', { confirm: true });
    for (const each of [session, auto, skip]) {
      chat.sendMessage(workspace.id, each.id, 'mode');
      await chat.settled();
    }
    expect(agent.guarded).toEqual([false, true, false]);
    expect(agent.protectedPathsGiven[1]).toBe(PROTECTED_PATHS);
    expect(PROTECTED_PATHS.folders).toEqual(['.claude', '.git', '.vscode', '.idea', '_bmad']);
    expect(PROTECTED_PATHS.files).toEqual(expect.arrayContaining(['.mcp.json', 'CLAUDE.md', 'AGENTS.md', '.envrc']));
  });

  it('Auto to Skip all: the guarded agent goes to Ask (never Skip all while guarded) and restarts unguarded', async () => {
    const core = openTestCore();
    const { chat, agent, workspace, session } = setUp(modedAgent(), core);
    core.installSettings.setDeveloperMode(true);
    chat.setPermissionMode(workspace.id, session.id, 'auto');
    chat.sendMessage(workspace.id, session.id, 'mode');
    await chat.settled();
    chat.setPermissionMode(workspace.id, session.id, 'skip_all', { confirm: true });
    await until(() => agent.closed.length === 1, 'the guarded agent restarted');
    expect(agent.sets.map((set) => [set.session, set.mode])).toEqual([
      ['agent-1', 'auto'],
      ['agent-1', 'ask'],
    ]);
    chat.sendMessage(workspace.id, session.id, 'mode');
    await chat.settled();
    expect(replies(core, session.id).at(-1)).toBe('mode=skip_all');
    expect(agent.guarded).toEqual([true, false]);
  });

  it('a change across the guards during a turn: Ask at once, and the agent restarts when the turn ends, never mid-turn', async () => {
    const { core, chat, agent, workspace, session } = setUp();
    chat.sendMessage(workspace.id, session.id, 'ask');
    await until(() => core.entities.getSession(session.id)?.state === 'waiting', 'the card');
    chat.setPermissionMode(workspace.id, session.id, 'auto');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(agent.closed).toEqual([]);
    const card = streamOf(core, session.id).findLast((event) => event.type === 'permission.requested');
    if (card?.type !== 'permission.requested') throw new Error('no card');
    core.permissions.decide(workspace.id, session.id, card.payload.requestId, { decision: 'allow_once' });
    await chat.settled();
    expect(agent.closed).toEqual(['agent-1']);
    chat.sendMessage(workspace.id, session.id, 'mode');
    await chat.settled();
    expect(replies(core, session.id).at(-1)).toBe('mode=auto');
    expect(agent.guarded).toEqual([false, true]);
  });

  it('an agent that does not keep the guards it was asked for never runs in Auto: the chat is back in Ask', async () => {
    const { core, chat, agent, workspace, session } = setUp(modedAgent({ ignoresGuards: true }));
    chat.setPermissionMode(workspace.id, session.id, 'auto');
    chat.sendMessage(workspace.id, session.id, 'mode');
    await chat.settled();
    expect(replies(core, session.id)).toEqual(['mode=ask']);
    expect(modeChanges(core, session.id).at(-1)).toMatchObject({ mode: 'ask', previous: 'auto', cause: 'agent' });
    expect(agent.sets.map((set) => set.mode)).toEqual(['ask']);
  });
});

describe('a mode the agent cannot offer (criterion 4)', () => {
  it('an agent that declares no Skip all: shown unavailable with a reason, and refused with no event', async () => {
    const { core, chat, workspace, session } = setUp(modedAgent({ declares: ['ask', 'auto'] }));
    core.installSettings.setDeveloperMode(true);
    expect(chat.permissionModeOptions(workspace.id, session.id)).toEqual([
      { mode: 'ask', available: true },
      { mode: 'auto', available: true },
      { mode: 'skip_all', available: false, reason: "Test Agent doesn't offer Skip all." },
    ]);
    expect(() => chat.setPermissionMode(workspace.id, session.id, 'skip_all', { confirm: true })).toThrow(ModeUnavailableError);
    expect(modeChanges(core, session.id)).toEqual([]);
  });

  it("a session that did not list Auto: shown unavailable once it started, and refused", async () => {
    const { core, chat, workspace, session } = setUp(modedAgent({ lists: ['ask', 'skip_all'] }));
    expect(chat.permissionModeOptions(workspace.id, session.id).find((option) => option.mode === 'auto')).toEqual({ mode: 'auto', available: true });
    chat.sendMessage(workspace.id, session.id, 'hello');
    await chat.settled();
    expect(chat.permissionModeOptions(workspace.id, session.id).find((option) => option.mode === 'auto')).toEqual({
      mode: 'auto',
      available: false,
      reason: "This chat's Test Agent session doesn't offer Auto on this computer.",
    });
    expect(() => chat.setPermissionMode(workspace.id, session.id, 'auto')).toThrow(ModeUnavailableError);
    expect(modeChanges(core, session.id)).toEqual([]);
  });

  it('an agent that declares no modes offers Ask only', () => {
    const agent = modedAgent();
    const { permissionModes: _declared, ...port } = agent.port;
    const { chat, workspace, session } = setUp({ ...agent, port });
    expect(chat.permissionModeOptions(workspace.id, session.id).map((option) => option.available)).toEqual([true, false, false]);
  });

  it('a mode that is not one is refused', () => {
    const { chat, workspace, session } = setUp();
    expect(() => chat.setPermissionMode(workspace.id, session.id, 'yolo' as PermissionMode)).toThrow(ValidationError);
  });
});

describe('Skip all needs Developer mode and a confirmation, enforced by core (criterion 5)', () => {
  it('refused with Developer mode off, refused without the confirmation, and set with both', async () => {
    const { core, chat, agent, workspace, session } = setUp();
    chat.sendMessage(workspace.id, session.id, 'hello');
    await chat.settled();
    expect(() => chat.setPermissionMode(workspace.id, session.id, 'skip_all', { confirm: true })).toThrow(DeveloperModeRequiredError);
    core.installSettings.setDeveloperMode(true);
    expect(() => chat.setPermissionMode(workspace.id, session.id, 'skip_all')).toThrow(ConfirmationRequiredError);
    expect(() => chat.setPermissionMode(workspace.id, session.id, 'skip_all', { confirm: false })).toThrow(ConfirmationRequiredError);
    expect(modeChanges(core, session.id)).toEqual([]);
    expect(agent.sets.map((set) => set.mode)).toEqual(['ask']);
    chat.setPermissionMode(workspace.id, session.id, 'skip_all', { confirm: true });
    expect(modeChanges(core, session.id)).toEqual([{ mode: 'skip_all', previous: 'ask', cause: 'user', reason: undefined }]);
    await until(() => agent.sets.at(-1)?.mode === 'skip_all', 'the agent told Skip all');
  });

  it('Developer mode is off until turned on, each change is one install-level event, and the same value again appends nothing', () => {
    const core = openTestCore();
    expect(core.installSettings.developerMode()).toBe(false);
    expect(core.installSettings.setDeveloperMode(true)).toEqual({ developerMode: true, changed: true, dropped: [] });
    expect(core.installSettings.setDeveloperMode(true)).toEqual({ developerMode: true, changed: false, dropped: [] });
    expect(core.installSettings.developerMode()).toBe(true);
    const changes = core.events.readAfter(0).filter((event) => event.type === 'settings.developer_mode_changed');
    expect(changes).toEqual([expect.objectContaining({ workspaceId: null, streamId: 'settings', payload: { developerMode: true, previous: false } })]);
  });
});

describe('a Skip-all chat never writes rules (criterion 7)', () => {
  it('a request shows a card with no Always allow, whatever the caution level and rules; Always allow is refused', async () => {
    const { core, chat, agent, workspace, session } = setUp();
    core.permissions.updateSettings(workspace.id, { cautionLevel: 'ask_risky_only' });
    // A rule that would answer `npm test` in Ask.
    chat.sendMessage(workspace.id, session.id, 'ask');
    await until(() => core.entities.getSession(session.id)?.state === 'waiting', 'the first card');
    const first = streamOf(core, session.id).findLast((event) => event.type === 'permission.requested');
    if (first?.type !== 'permission.requested') throw new Error('no card');
    expect(first.payload).toMatchObject({ permissionMode: 'ask', alwaysAllowScope: { kind: 'command_prefix' } });
    core.permissions.decide(workspace.id, session.id, first.payload.requestId, { decision: 'allow_always' });
    await chat.settled();
    expect(core.permissions.listRules(workspace.id)).toHaveLength(1);

    core.installSettings.setDeveloperMode(true);
    chat.setPermissionMode(workspace.id, session.id, 'skip_all', { confirm: true });
    for (const prompt of ['ask', 'ask-read']) {
      chat.sendMessage(workspace.id, session.id, prompt);
      await until(() => core.entities.getSession(session.id)?.state === 'waiting', `the ${prompt} card`);
      const card = streamOf(core, session.id).findLast((event) => event.type === 'permission.requested');
      if (card?.type !== 'permission.requested') throw new Error('no card');
      expect(card.payload).toMatchObject({ permissionMode: 'skip_all', alwaysAllowScope: null });
      expect(() => core.permissions.decide(workspace.id, session.id, card.payload.requestId, { decision: 'allow_always' })).toThrow(SKIP_ALL_REFUSAL);
      core.permissions.decide(workspace.id, session.id, card.payload.requestId, { decision: 'allow_once' });
      await chat.settled();
    }
    // No rule and no caution level answered either: each was the user's.
    const resolved = streamOf(core, session.id).flatMap((event) => (event.type === 'permission.resolved' ? [event.payload.by] : []));
    expect(resolved).toEqual(['user', 'user', 'user']);
    expect(core.permissions.listRules(workspace.id)).toHaveLength(1);
    expect(agent.decisions.slice(1)).toEqual([{ outcome: 'allow_once' }, { outcome: 'allow_once' }]);
  });

  it('a card shown in Ask is refused Always allow once the chat moved to Skip all, and no rule is written', async () => {
    const { core, chat, workspace, session } = setUp();
    chat.sendMessage(workspace.id, session.id, 'ask');
    await until(() => core.entities.getSession(session.id)?.state === 'waiting', 'the card');
    const card = streamOf(core, session.id).findLast((event) => event.type === 'permission.requested');
    if (card?.type !== 'permission.requested') throw new Error('no card');
    expect(card.payload.alwaysAllowScope).not.toBeNull();
    core.installSettings.setDeveloperMode(true);
    chat.setPermissionMode(workspace.id, session.id, 'skip_all', { confirm: true });
    expect(() => core.permissions.decide(workspace.id, session.id, card.payload.requestId, { decision: 'allow_always' })).toThrow(SKIP_ALL_REFUSAL);
    expect(core.permissions.listRules(workspace.id)).toEqual([]);
    // Still waiting: Allow once and Deny still work.
    core.permissions.decide(workspace.id, session.id, card.payload.requestId, { decision: 'deny' });
    await chat.settled();
    expect(core.permissions.listRules(workspace.id)).toEqual([]);
  });
});

describe('turning Developer mode off drops every Skip-all chat to Ask (criterion 8)', () => {
  it('in one transaction: the Developer mode event, the terminal back to the chat, then each chat to Ask; agents told, terminals stopped', async () => {
    const core = openTestCore();
    const one = setUp(modedAgent(), core);
    const workspace = one.workspace;
    const two = await one.chat.createChatSession(workspace.id);
    const askChat = await one.chat.createChatSession(workspace.id);
    core.installSettings.setDeveloperMode(true);
    for (const session of [one.session, two]) {
      one.chat.sendMessage(workspace.id, session.id, 'hello');
      await one.chat.settled();
      one.chat.setPermissionMode(workspace.id, session.id, 'skip_all', { confirm: true });
    }
    await until(() => one.agent.sets.filter((set) => set.mode === 'skip_all').length === 2, 'both agents in Skip all');
    // The second chat goes to its terminal, which starts skipping its checks.
    await one.chat.switchDriver(workspace.id, two.id, 'terminal');
    expect(one.agent.terminalOptions).toEqual([{ permissionMode: 'skip_all' }]);
    const cli = one.terminal.processes[0]!;
    const before = core.events.lastSeq();

    const result = core.installSettings.setDeveloperMode(false);
    expect(result.dropped.map((session) => session.id).sort()).toEqual([one.session.id, two.id].sort());
    const appended = core.events.readAfter(before).map((event) =>
      event.type === 'session.permission_mode_changed'
        ? [event.type, event.streamId, event.payload.cause]
        : event.type === 'session.driver_changed'
          ? [event.type, event.streamId, event.payload.cause]
          : [event.type],
    );
    expect(appended.slice(0, 4)).toEqual([
      ['settings.developer_mode_changed'],
      ['session.permission_mode_changed', one.session.id, 'developer_mode_off'],
      ['session.driver_changed', two.id, 'developer_mode_off'],
      ['session.permission_mode_changed', two.id, 'developer_mode_off'],
    ]);
    expect(modeChanges(core, one.session.id).at(-1)?.reason).toBe(DEVELOPER_MODE_OFF_REASON);
    expect(modeChanges(core, askChat.id)).toEqual([]);
    // The live agent is told Ask; the terminal skipping its checks is stopped.
    await until(() => one.agent.sets.at(-1)?.mode === 'ask', 'the live agent told Ask');
    await until(() => cli.kills() > 0, 'the terminal stopped');
    await one.chat.settled();
    expect(core.entities.getSession(two.id)).toMatchObject({ driver: 'ui', permissionMode: 'ask' });
    // Skip all is refused again.
    expect(() => one.chat.setPermissionMode(workspace.id, one.session.id, 'skip_all', { confirm: true })).toThrow(DeveloperModeRequiredError);
  });

  it('an agent that cannot be told Ask in time is dropped, never left skipping checks', async () => {
    const { core, chat, agent, workspace, session, internal } = setUp(modedAgent({ hangsOn: ['ask'] }), openTestCore(), 50);
    // It starts in Ask already (nothing to tell), then takes Skip all.
    core.installSettings.setDeveloperMode(true);
    chat.setPermissionMode(workspace.id, session.id, 'skip_all', { confirm: true });
    chat.sendMessage(workspace.id, session.id, 'mode');
    await chat.settled();
    expect(replies(core, session.id)).toEqual(['mode=skip_all']);
    core.installSettings.setDeveloperMode(false);
    await until(() => agent.closed.length === 1, 'the agent stopped');
    expect(internal.some((error) => (error as { code?: string }).code === 'permission_mode_timeout')).toBe(true);
    expect(core.entities.getSession(session.id)?.permissionMode).toBe('ask');
  });
});

describe('the terminal runs in the chat’s mode (criterion 9)', () => {
  it("starts the CLI in the chat's mode, and refuses a mode change while it drives", async () => {
    const { core, chat, agent, workspace, session } = setUp();
    chat.sendMessage(workspace.id, session.id, 'hello');
    await chat.settled();
    chat.setPermissionMode(workspace.id, session.id, 'auto');
    await chat.switchDriver(workspace.id, session.id, 'terminal');
    expect(agent.terminalOptions).toEqual([{ permissionMode: 'auto', protectedPaths: PROTECTED_PATHS }]);
    expect(() => chat.setPermissionMode(workspace.id, session.id, 'ask')).toThrow(DriverIsTerminalError);
    expect(modeChanges(core, session.id)).toHaveLength(1);
    await chat.switchDriver(workspace.id, session.id, 'ui');
    await chat.switchDriver(workspace.id, session.id, 'terminal');
    expect(agent.terminalOptions.at(-1)).toEqual({ permissionMode: 'auto', protectedPaths: PROTECTED_PATHS });
    await chat.switchDriver(workspace.id, session.id, 'ui');
    await chat.close();
  });
});
