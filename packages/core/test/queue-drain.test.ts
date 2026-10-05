/**
 * Backlog bug 16: a message queued while the agent answers is sent once the
 * turn ends, however the turn ends. Every way a real agent (Claude Code over
 * ACP) ends a turn is scripted here: each stop reason, `idle` reported before
 * the prompt's answer (or not at all, or twice), and a permission card the
 * agent left behind when it ended its turn without waiting for the answer.
 */
import type { CoreEvent, SessionId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import {
  AgentError,
  createChat,
  type AgentEvent,
  type AgentPermissionDecision,
  type AgentPort,
  type AgentSession,
  type Core,
  PermissionNotPendingError,
  type Permissions,
  type StartAgentSession,
} from '../src/index.js';
import { openTestCore, soleAgent, tempDir, TEST_AGENT_ID } from './helpers.js';

type Idle = 'before' | 'none' | 'twice';

/** An agent the test ends by hand, choosing how the turn ends. */
function turnEndAgent() {
  const prompts: string[] = [];
  let emit: (event: AgentEvent) => void = () => undefined;
  let ask: StartAgentSession['onPermissionRequest'];
  let turn: { resolve: (result: { stopReason: string }) => void; reject: (error: unknown) => void } | undefined;
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
          turn = { resolve, reject };
        });
      },
      async cancel() {
        const running = turn;
        turn = undefined;
        emit({ type: 'state', state: 'idle' });
        running?.resolve({ stopReason: 'cancelled' });
      },
      async close() {},
    };
  };
  let opened = 0;
  const port: AgentPort = {
    displayName: 'Test Agent',
    skillInvocation: (skill) => `/${skill}`,
    listAuthMethods: async () => [],
    async startSession(input) {
      return open(input, `agent-${++opened}`);
    },
    async reopenSession() {
      throw new AgentError('agent_unavailable', 'Test Agent can’t reopen sessions.');
    },
  };
  return {
    port,
    prompts,
    emit: (event: AgentEvent) => emit(event),
    ask: (request: Parameters<NonNullable<StartAgentSession['onPermissionRequest']>>[0]): Promise<AgentPermissionDecision> => ask!(request),
    running: () => turn !== undefined,
    /** Ends the running turn with `stopReason`, reporting `idle` as `idle` says; `gap` lets timers and I/O run in between. */
    async end(stopReason = 'end_turn', idle: Idle = 'before', gap = false) {
      const running = turn!;
      turn = undefined;
      if (idle !== 'none') emit({ type: 'state', state: 'idle' });
      if (gap) await settle();
      if (idle === 'twice') emit({ type: 'state', state: 'idle' });
      running.resolve({ stopReason });
    },
  };
}

/** Lets pending promise callbacks run (`setImmediate` is not faked). */
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};

function setUp(core: Core, agent: ReturnType<typeof turnEndAgent>, permissions?: Permissions) {
  const internal: unknown[] = [];
  const chat = createChat({
    dataDir: tempDir('ogden-agents-data-'),
    entities: core.entities,
    sessionEvents: core.sessionEvents,
    agents: soleAgent(agent.port),
    ...(permissions === undefined ? {} : { permissions }),
    onInternalError: (_sessionId, error) => internal.push(error),
  });
  const workspace = chat.openWorkspace(tempDir('ogden-agents-repo-'));
  const session = core.entities.createSession({ workspaceId: workspace.id, kind: 'chat', agentId: TEST_AGENT_ID });
  return { chat, workspace, session, internal };
}

const sessionEvents = (core: Core, sessionId: SessionId): CoreEvent[] => core.events.readAfter(0).filter((event) => event.streamId === sessionId);
const userMessages = (core: Core, sessionId: SessionId) =>
  sessionEvents(core, sessionId).flatMap((e) => (e.type === 'session.message_completed' && e.payload.role === 'user' ? [[e.payload.messageId, e.payload.content]] : []));
const stateOf = (core: Core, sessionId: SessionId) => core.entities.getSession(sessionId)!.state;

describe('a queued message is sent when the turn ends (backlog bug 16)', () => {
  const endings: Array<[string, string, Idle, boolean]> = [
    ['end_turn', 'end_turn', 'before', false],
    ['max_tokens', 'max_tokens', 'before', false],
    ['max_turn_requests', 'max_turn_requests', 'before', false],
    ['refusal', 'refusal', 'before', false],
    ['cancelled by the agent itself (no Stop)', 'cancelled', 'before', false],
    ['idle reported a while before the prompt answers', 'end_turn', 'before', true],
    ['no idle reported, only the prompt answer', 'end_turn', 'none', false],
    ['idle reported twice', 'end_turn', 'twice', true],
  ];
  for (const [name, stopReason, idle, gap] of endings) {
    it(`a turn ending ${name} sends the queue once, oldest first, then the session ends idle`, async () => {
      const core = openTestCore();
      const agent = turnEndAgent();
      const { chat, workspace, session, internal } = setUp(core, agent);
      chat.sendMessage(workspace.id, session.id, 'first');
      await settle();
      agent.emit({ type: 'message_chunk', text: 'The final answer.' });
      const second = chat.sendMessage(workspace.id, session.id, 'second');
      const third = chat.sendMessage(workspace.id, session.id, 'third');
      expect([second.queued, third.queued]).toEqual([true, true]);

      await agent.end(stopReason, idle, gap);
      await settle();
      expect(agent.prompts).toEqual(['first', 'second']);
      await agent.end(stopReason, idle, gap);
      await settle();
      await agent.end(stopReason, idle, gap);
      await chat.settled();

      expect(agent.prompts).toEqual(['first', 'second', 'third']);
      expect(userMessages(core, session.id).slice(1)).toEqual([
        [second.messageId, 'second'],
        [third.messageId, 'third'],
      ]);
      expect(stateOf(core, session.id)).toBe('idle');
      expect(internal).toEqual([]);
      await chat.close();
    });
  }

  it('a message sent after the agent reported idle, before its prompt answered, is sent once', async () => {
    const core = openTestCore();
    const agent = turnEndAgent();
    const { chat, workspace, session } = setUp(core, agent);
    chat.sendMessage(workspace.id, session.id, 'first');
    await settle();
    agent.emit({ type: 'state', state: 'idle' });
    const late = chat.sendMessage(workspace.id, session.id, 'late');
    await agent.end('end_turn', 'none');
    await settle();
    expect(agent.prompts).toEqual(['first', 'late']);
    await agent.end();
    await chat.settled();
    expect(userMessages(core, session.id).map(([id]) => id).filter((id) => id === late.messageId)).toHaveLength(1);
    expect(stateOf(core, session.id)).toBe('idle');
    await chat.close();
  });

  it('a turn the agent ended with its permission card still open sends the queue; the card is cancelled', async () => {
    const core = openTestCore();
    const agent = turnEndAgent();
    const { chat, workspace, session, internal } = setUp(core, agent, core.permissions);
    chat.sendMessage(workspace.id, session.id, 'first');
    await settle();
    // Claude Code asks, then ends its turn (a refusal, an internal timeout) without waiting for the answer.
    const abandoned = agent.ask({ toolCallId: 't1', title: 'Run npm test', kind: 'execute', command: 'npm test' });
    await settle();
    expect(stateOf(core, session.id)).toBe('waiting');
    const queued = chat.sendMessage(workspace.id, session.id, 'queued while the card was up');
    expect(queued.queued).toBe(true);

    await agent.end('end_turn');
    await settle();
    expect(await abandoned).toEqual({ outcome: 'cancelled' });
    expect(sessionEvents(core, session.id).filter((e) => e.type === 'permission.resolved').map((e) => e.payload)).toMatchObject([{ decision: 'deny', by: 'cancelled' }]);
    // An answer that comes after is refused: the card is closed, never allowed late.
    const requestId = sessionEvents(core, session.id).find((e) => e.type === 'permission.requested')!.payload.requestId;
    expect(() => core.permissions.decide(workspace.id, session.id, requestId, { decision: 'allow_once' })).toThrow(PermissionNotPendingError);
    expect(agent.prompts).toEqual(['first', 'queued while the card was up']);
    expect(stateOf(core, session.id)).toBe('working');
    await agent.end();
    await chat.settled();
    expect(userMessages(core, session.id).map(([id]) => id)).toContain(queued.messageId);
    expect(stateOf(core, session.id)).toBe('idle');
    expect(internal).toEqual([]);
    await chat.close();
  });

  it('a Deny reason still goes first when another card was left open, then the queue', async () => {
    const core = openTestCore();
    const agent = turnEndAgent();
    const { chat, workspace, session } = setUp(core, agent, core.permissions);
    chat.sendMessage(workspace.id, session.id, 'first');
    await settle();
    const denied = agent.ask({ toolCallId: 't1', title: 'Run rm -rf build', kind: 'execute', command: 'rm -rf build' });
    const abandoned = agent.ask({ toolCallId: 't2', title: 'Run npm test', kind: 'execute', command: 'npm test' });
    await settle();
    const queued = chat.sendMessage(workspace.id, session.id, 'queued');
    const first = sessionEvents(core, session.id).find((e) => e.type === 'permission.requested')!;
    core.permissions.decide(workspace.id, session.id, first.payload.requestId, { decision: 'deny', reason: 'Use the clean script.' });
    expect(await denied).toMatchObject({ outcome: 'deny' });

    await agent.end();
    await settle();
    expect(await abandoned).toEqual({ outcome: 'cancelled' });
    expect(agent.prompts).toEqual(['first', 'I denied "rm -rf build": Use the clean script.']);
    await agent.end();
    await settle();
    await agent.end();
    await chat.settled();
    expect(agent.prompts).toEqual(['first', 'I denied "rm -rf build": Use the clean script.', 'queued']);
    expect(userMessages(core, session.id).at(-1)).toEqual([queued.messageId, 'queued']);
    expect(stateOf(core, session.id)).toBe('idle');
    await chat.close();
  });

  it('a Stop still leaves the queue unsent ("Not sent")', async () => {
    const core = openTestCore();
    const agent = turnEndAgent();
    const { chat, workspace, session } = setUp(core, agent);
    chat.sendMessage(workspace.id, session.id, 'first');
    await settle();
    const queued = chat.sendMessage(workspace.id, session.id, 'queued');
    chat.cancel(workspace.id, session.id);
    await chat.settled();
    expect(agent.prompts).toEqual(['first']);
    expect(userMessages(core, session.id).map(([id]) => id)).not.toContain(queued.messageId);
    expect(stateOf(core, session.id)).toBe('idle');
    await chat.close();
  });
});
