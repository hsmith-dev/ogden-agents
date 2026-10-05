/**
 * Send now or wait (2026-10-04): a message sent right away while the agent
 * works goes into the running turn when the agent can take it there, else
 * the current step is stopped and it goes next; the messages that wait are a
 * list the user changes. Against a hand-driven AgentPort; no real agent.
 */
import type { CoreEvent, SessionId } from '@ogden-agents/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AgentError,
  AnswerFirstError,
  createChat,
  DriverIsTerminalError,
  MessageNotQueuedError,
  STEER_TIMEOUT_MS,
  type AgentEvent,
  type AgentPort,
  type AgentSession,
  type Core,
  type StartAgentSession,
} from '../src/index.js';
import { openTestCore, soleAgent, tempDir, TEST_AGENT_ID } from './helpers.js';

type Steer = 'inject' | 'none' | 'fail' | 'no_turn' | 'hang' | 'manual';

/**
 * An agent the test drives by hand (as `chat.test.ts`'s): each prompt waits
 * until the test ends it. `steer` says what a message steered into the turn
 * does: taken (`inject`), not offered (`none`), refused (`fail`), found no
 * turn (`no_turn`), never answered (`hang`), or answered by the test (`manual`).
 */
function handAgent({ steer = 'inject', ignoreCancel = false }: { steer?: Steer; ignoreCancel?: boolean } = {}) {
  const prompts: string[] = [];
  const steered: string[] = [];
  let cancels = 0;
  let opened = 0;
  let emit: (event: AgentEvent) => void = () => undefined;
  let ask: StartAgentSession['onPermissionRequest'];
  let turn: { end: (stopReason?: string) => void } | undefined;
  let answerSteer: ((outcome: 'injected' | 'no_turn') => void) | undefined;
  const open = (input: StartAgentSession): AgentSession => {
    const listeners = new Set<(event: AgentEvent) => void>();
    emit = (event) => {
      for (const listener of [...listeners]) listener(event);
    };
    ask = input.onPermissionRequest;
    const session: AgentSession = {
      agentSessionId: `agent-${++opened}`,
      onEvent(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      prompt(text) {
        prompts.push(text);
        emit({ type: 'state', state: 'working' });
        return new Promise((resolve) => {
          turn = {
            end: (stopReason = 'end_turn') => {
              turn = undefined;
              emit({ type: 'state', state: 'idle' });
              resolve({ stopReason });
            },
          };
        });
      },
      async cancel() {
        cancels++;
        if (!ignoreCancel) turn?.end('cancelled');
      },
      async close() {},
    };
    if (steer === 'none') return session;
    return {
      ...session,
      steer(text) {
        steered.push(text);
        if (steer === 'fail') return Promise.reject(new AgentError('agent_failed', 'refused'));
        if (steer === 'no_turn') return Promise.resolve('no_turn' as const);
        if (steer === 'hang') return new Promise(() => {});
        if (steer === 'manual') return new Promise((resolve) => (answerSteer = resolve));
        return Promise.resolve('injected' as const);
      },
    };
  };
  const port: AgentPort = {
    displayName: 'Test Agent',
    skillInvocation: (skill) => `/${skill}`,
    listAuthMethods: async () => [],
    startSession: async (input) => open(input),
    reopenSession: async (input) => ({ session: open(input), restored: 'resumed' }),
  };
  return {
    port,
    prompts,
    steered,
    emit: (event: AgentEvent) => emit(event),
    ask: (request: Parameters<NonNullable<StartAgentSession['onPermissionRequest']>>[0]) => ask!(request),
    end: (stopReason?: string) => turn!.end(stopReason),
    running: () => turn !== undefined,
    cancels: () => cancels,
    answerSteer: (outcome: 'injected' | 'no_turn') => answerSteer!(outcome),
  };
}

const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve));
};

function setUp(core: Core, agent: ReturnType<typeof handAgent>, withPermissions = false) {
  const chat = createChat({
    dataDir: tempDir('ogden-agents-data-'),
    entities: core.entities,
    sessionEvents: core.sessionEvents,
    agents: soleAgent(agent.port),
    ...(withPermissions ? { permissions: core.permissions } : {}),
    stopGraceMs: 200,
  });
  const workspace = chat.openWorkspace(tempDir('ogden-agents-repo-'));
  const session = core.entities.createSession({ workspaceId: workspace.id, kind: 'chat', agentId: TEST_AGENT_ID });
  return { chat, workspace, session };
}

const eventsOf = (core: Core, sessionId: SessionId): CoreEvent[] => core.events.readAfter(0).filter((event) => event.streamId === sessionId);
const typesOf = (core: Core, sessionId: SessionId) => eventsOf(core, sessionId).map((event) => event.type);
const stateOf = (core: Core, sessionId: SessionId) => core.entities.getSession(sessionId)!.state;
const completedUser = (core: Core, sessionId: SessionId) =>
  eventsOf(core, sessionId).flatMap((e) => (e.type === 'session.message_completed' && e.payload.role === 'user' ? [e.payload] : []));

describe('send now or wait', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends at once when nothing runs, whichever way is asked', async () => {
    const core = openTestCore();
    const agent = handAgent();
    const { chat, workspace, session } = setUp(core, agent);
    const sent = chat.sendMessage(workspace.id, session.id, 'hello', { delivery: 'now' });
    expect(sent.queued).toBe(false);
    await settle();
    expect(agent.prompts).toEqual(['hello']);
    expect(agent.steered).toEqual([]);
    agent.end();
    await chat.settled();
    await chat.close();
  });

  it('waits as before when asked to wait (or not told)', async () => {
    const core = openTestCore();
    const agent = handAgent();
    const { chat, workspace, session } = setUp(core, agent);
    chat.sendMessage(workspace.id, session.id, 'first');
    await settle();
    const later = chat.sendMessage(workspace.id, session.id, 'later', { delivery: 'wait' });
    expect(later.queued).toBe(true);
    await settle();
    expect(agent.steered).toEqual([]);
    expect(agent.cancels()).toBe(0);
    const queued = eventsOf(core, session.id).find((e) => e.type === 'session.message_queued');
    expect(queued?.payload).toEqual({ sessionId: session.id, messageId: later.messageId, content: 'later' });
    agent.end();
    await settle();
    expect(agent.prompts).toEqual(['first', 'later']);
    agent.end();
    await chat.settled();
    await chat.close();
  });

  it('puts a message into the running turn when the agent can take it: no stop, the reply so far is closed, the turn goes on', async () => {
    const core = openTestCore();
    const agent = handAgent({ steer: 'inject' });
    const { chat, workspace, session } = setUp(core, agent);
    chat.sendMessage(workspace.id, session.id, 'first');
    await settle();
    agent.emit({ type: 'message_chunk', text: 'Working on it' });
    const urgent = chat.sendMessage(workspace.id, session.id, 'use the other file', { delivery: 'now' });
    await settle();
    expect(agent.steered).toEqual(['use the other file']);
    expect(agent.cancels()).toBe(0);
    const events = eventsOf(core, session.id);
    expect(events.find((e) => e.type === 'session.message_queued')?.payload).toEqual({ sessionId: session.id, messageId: urgent.messageId, content: 'use the other file', now: true });
    // The reply so far is complete before the steered message, which carries its delivery.
    const replyAt = events.findIndex((e) => e.type === 'session.message_completed' && e.payload.role === 'agent');
    const steeredAt = events.findIndex((e) => e.type === 'session.message_completed' && e.payload.messageId === urgent.messageId);
    expect(replyAt).toBeGreaterThan(-1);
    expect(steeredAt).toBeGreaterThan(replyAt);
    expect(events[steeredAt]).toMatchObject({ payload: { role: 'user', content: 'use the other file', delivery: 'injected' } });
    expect(stateOf(core, session.id)).toBe('working');
    // What the agent says next is a new reply in the same turn; nothing more is prompted.
    agent.emit({ type: 'message_chunk', text: 'Switching files' });
    agent.end();
    await chat.settled();
    expect(agent.prompts).toEqual(['first']);
    expect(typesOf(core, session.id)).not.toContain('session.turn_interrupted');
    expect(stateOf(core, session.id)).toBe('idle');
    await chat.close();
  });

  it('stops the current step for an agent that can not take it mid turn, sends it next, and keeps every waiting message', async () => {
    const core = openTestCore();
    const agent = handAgent({ steer: 'none' });
    const { chat, workspace, session } = setUp(core, agent);
    chat.sendMessage(workspace.id, session.id, 'first');
    await settle();
    chat.sendMessage(workspace.id, session.id, 'waiting one');
    const urgent = chat.sendMessage(workspace.id, session.id, 'urgent', { delivery: 'now' });
    await settle();
    expect(agent.cancels()).toBe(1);
    const interrupted = eventsOf(core, session.id).find((e) => e.type === 'session.turn_interrupted');
    expect(interrupted?.payload).toEqual({ sessionId: session.id, messageId: urgent.messageId });
    await settle();
    // The stopped turn ended; the urgent message went first, then the one that waited.
    expect(agent.prompts).toEqual(['first', 'urgent']);
    expect(stateOf(core, session.id)).toBe('working');
    agent.end();
    await settle();
    expect(agent.prompts).toEqual(['first', 'urgent', 'waiting one']);
    agent.end();
    await chat.settled();
    expect(completedUser(core, session.id).map((m) => m.content)).toEqual(['first', 'urgent', 'waiting one']);
    expect(stateOf(core, session.id)).toBe('idle');
    await chat.close();
  });

  it('falls back to stopping the step when the agent refuses the message, and when it never answers', async () => {
    for (const steer of ['fail', 'hang'] as const) {
      if (steer === 'hang') vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const core = openTestCore();
      const agent = handAgent({ steer });
      const { chat, workspace, session } = setUp(core, agent);
      chat.sendMessage(workspace.id, session.id, 'first');
      await settle();
      chat.sendMessage(workspace.id, session.id, 'urgent', { delivery: 'now' });
      await settle();
      if (steer === 'hang') {
        expect(agent.cancels()).toBe(0);
        await vi.advanceTimersByTimeAsync(STEER_TIMEOUT_MS);
        await settle();
      }
      expect(agent.cancels()).toBe(1);
      expect(typesOf(core, session.id)).toContain('session.turn_interrupted');
      await settle();
      expect(agent.prompts).toEqual(['first', 'urgent']);
      agent.end();
      await chat.settled();
      await chat.close();
      vi.useRealTimers();
    }
  });

  it('sends it next with no stop when the turn had just ended', async () => {
    const core = openTestCore();
    const agent = handAgent({ steer: 'no_turn' });
    const { chat, workspace, session } = setUp(core, agent);
    chat.sendMessage(workspace.id, session.id, 'first');
    await settle();
    chat.sendMessage(workspace.id, session.id, 'urgent', { delivery: 'now' });
    await settle();
    expect(agent.cancels()).toBe(0);
    agent.end();
    await settle();
    expect(agent.prompts).toEqual(['first', 'urgent']);
    expect(typesOf(core, session.id)).not.toContain('session.turn_interrupted');
    agent.end();
    await chat.settled();
    await chat.close();
  });

  it('takes nothing next until a message on its way into the turn is answered', async () => {
    const core = openTestCore();
    const agent = handAgent({ steer: 'manual' });
    const { chat, workspace, session } = setUp(core, agent);
    chat.sendMessage(workspace.id, session.id, 'first');
    await settle();
    chat.sendMessage(workspace.id, session.id, 'urgent', { delivery: 'now' });
    await settle();
    // The turn ends while the answer is still coming: nothing is prompted meanwhile.
    agent.end();
    await settle();
    expect(agent.prompts).toEqual(['first']);
    agent.answerSteer('no_turn');
    await settle();
    expect(agent.prompts).toEqual(['first', 'urgent']);
    agent.end();
    await chat.settled();
    await chat.close();
  });

  it('refuses to send right away while a permission card waits, recording nothing; waiting still works', async () => {
    const core = openTestCore();
    const agent = handAgent();
    const { chat, workspace, session } = setUp(core, agent, true);
    chat.sendMessage(workspace.id, session.id, 'run it');
    await settle();
    void agent.ask({ toolCallId: 't1', title: 'Run npm test', kind: 'execute', command: 'npm test' });
    await settle();
    expect(stateOf(core, session.id)).toBe('waiting');
    const before = typesOf(core, session.id).length;
    expect(() => chat.sendMessage(workspace.id, session.id, 'urgent', { delivery: 'now' })).toThrow(AnswerFirstError);
    expect(typesOf(core, session.id).length).toBe(before);
    expect(agent.steered).toEqual([]);
    expect(agent.cancels()).toBe(0);
    // The card is still pending, not answered for the user.
    expect(typesOf(core, session.id)).not.toContain('permission.resolved');
    expect(chat.sendMessage(workspace.id, session.id, 'later').queued).toBe(true);
    await chat.close();
  });

  it('refuses for a chat the terminal drives', async () => {
    const core = openTestCore();
    const agent = handAgent();
    const { chat, workspace, session } = setUp(core, agent);
    core.entities.setSessionDriver(session.id, 'terminal');
    expect(() => chat.sendMessage(workspace.id, session.id, 'urgent', { delivery: 'now' })).toThrow(DriverIsTerminalError);
    expect(() => chat.removeQueuedMessage(workspace.id, session.id, 'msg_x')).toThrow(DriverIsTerminalError);
    await chat.close();
  });

  it('lets the user edit, move, remove and send right away the messages that wait, each a queue_changed event', async () => {
    const core = openTestCore();
    const agent = handAgent({ steer: 'none' });
    const { chat, workspace, session } = setUp(core, agent);
    chat.sendMessage(workspace.id, session.id, 'first');
    await settle();
    const a = chat.sendMessage(workspace.id, session.id, 'a');
    const b = chat.sendMessage(workspace.id, session.id, 'b');
    const c = chat.sendMessage(workspace.id, session.id, 'c');
    chat.updateQueuedMessage(workspace.id, session.id, a.messageId, { content: 'a, edited' });
    chat.updateQueuedMessage(workspace.id, session.id, c.messageId, { position: 0 });
    chat.removeQueuedMessage(workspace.id, session.id, b.messageId);
    const changes = eventsOf(core, session.id).flatMap((e) => (e.type === 'session.queue_changed' ? [e.payload] : []));
    expect(changes.map((change) => change.cause)).toEqual(['edited', 'moved', 'removed']);
    expect(changes.at(-1)!.queue).toEqual([
      { messageId: c.messageId, content: 'c' },
      { messageId: a.messageId, content: 'a, edited' },
    ]);
    chat.sendQueuedMessageNow(workspace.id, session.id, a.messageId);
    await settle();
    const sentNow = eventsOf(core, session.id).flatMap((e) => (e.type === 'session.queue_changed' ? [e.payload] : [])).at(-1)!;
    expect(sentNow.cause).toBe('sent_now');
    expect(sentNow.queue).toEqual([
      { messageId: a.messageId, content: 'a, edited', now: true },
      { messageId: c.messageId, content: 'c' },
    ]);
    expect(agent.cancels()).toBe(1);
    await settle();
    expect(agent.prompts).toEqual(['first', 'a, edited']);
    // Already sent: it can't be changed any more.
    expect(() => chat.updateQueuedMessage(workspace.id, session.id, a.messageId, { content: 'too late' })).toThrow(MessageNotQueuedError);
    expect(() => chat.removeQueuedMessage(workspace.id, session.id, b.messageId)).toThrow(MessageNotQueuedError);
    agent.end();
    await settle();
    expect(agent.prompts).toEqual(['first', 'a, edited', 'c']);
    agent.end();
    await chat.settled();
    await chat.close();
  });

  it('still sends the message when the agent ignores the stop: it is dropped after the grace and the message goes to a reopened agent', async () => {
    const core = openTestCore();
    const agent = handAgent({ steer: 'none', ignoreCancel: true });
    const { chat, workspace, session } = setUp(core, agent);
    chat.sendMessage(workspace.id, session.id, 'first');
    await settle();
    chat.sendMessage(workspace.id, session.id, 'urgent', { delivery: 'now' });
    await settle();
    expect(agent.cancels()).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await settle();
    expect(agent.prompts.at(-1)).toContain('urgent');
    expect(stateOf(core, session.id)).toBe('working');
    agent.end();
    await chat.settled();
    await chat.close();
  });

  it('a Stop while a message is on its way into the turn leaves it unsent, as every queued message', async () => {
    const core = openTestCore();
    const agent = handAgent({ steer: 'manual' });
    const { chat, workspace, session } = setUp(core, agent);
    chat.sendMessage(workspace.id, session.id, 'first');
    await settle();
    const urgent = chat.sendMessage(workspace.id, session.id, 'urgent', { delivery: 'now' });
    await settle();
    chat.cancel(workspace.id, session.id);
    agent.answerSteer('injected');
    await chat.settled();
    expect(completedUser(core, session.id).map((m) => m.messageId)).not.toContain(urgent.messageId);
    expect(stateOf(core, session.id)).toBe('idle');
    await chat.close();
  });
});
