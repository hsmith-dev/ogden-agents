/**
 * A slow agent start shows as starting (epic 6 entry 5: Antigravity takes
 * about 17 s to start on Windows): core appends `session.agent_starting`
 * once a start has run for `AGENT_STARTING_NOTICE_MS`, and
 * `session.agent_started` when it ends; a quick start appends neither.
 * In-memory ports only.
 */
import type { CoreEvent, SessionId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { AgentError, createChat, type AgentEventListener, type AgentPort, type AgentSession, type Core } from '../src/index.js';
import { AGENT_STARTING_NOTICE_MS } from '../src/chat/constants.js';
import { openTestCore, soleAgent, tempDir } from './helpers.js';

/** An agent whose start waits until the test lets it go (or fails it). */
function slowAgent() {
  let letGo: (() => void) | undefined;
  let failStart: ((error: Error) => void) | undefined;
  let quick = false;
  const session = (): AgentSession => {
    const listeners = new Set<AgentEventListener>();
    const emit = (event: Parameters<AgentEventListener>[0]) => listeners.forEach((listener) => listener(event));
    return {
      agentSessionId: 'slow-1',
      async prompt() {
        emit({ type: 'state', state: 'working' });
        emit({ type: 'message_chunk', text: 'Hello.' });
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
  const started = () =>
    quick
      ? Promise.resolve(session())
      : new Promise<AgentSession>((resolve, reject) => {
          letGo = () => resolve(session());
          failStart = reject;
        });
  const port: AgentPort = {
    displayName: 'Slow Agent',
    listAuthMethods: async () => [],
    startSession: started,
    reopenSession: async () => ({ session: await started(), restored: 'resumed' }),
  };
  return {
    port,
    quick: () => (quick = true),
    letGo: () => letGo?.(),
    fail: (error: Error) => failStart?.(error),
    waiting: () => letGo !== undefined,
  };
}

function setUp(core: Core = openTestCore()) {
  const agent = slowAgent();
  const chat = createChat({
    dataDir: tempDir('ogden-agents-data-'),
    entities: core.entities,
    sessionEvents: core.sessionEvents,
    agents: soleAgent(agent.port),
    agentEnv: () => ({}),
    events: core.events,
    installSettings: core.installSettings,
  });
  const workspace = chat.openWorkspace(tempDir('ogden-agents-repo-'));
  return { core, chat, workspace, agent };
}

const typesOf = (core: Core, sessionId: SessionId): string[] =>
  core.events
    .readAfter(0)
    .filter((event: CoreEvent) => event.streamId === sessionId)
    .map((event) => event.type);

const until = async (check: () => boolean, what: string, ms = 5_000) => {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe('a slow agent start shows as starting (epic 6 entry 5)', () => {
  it('announces a start still running after a moment, then that it started, before the reply', async () => {
    const { core, chat, workspace, agent } = setUp();
    const session = await chat.createChatSession(workspace.id);
    const sentAt = Date.now();
    chat.sendMessage(workspace.id, session.id, 'hello');
    await until(() => typesOf(core, session.id).includes('session.agent_starting'), 'the starting notice');
    expect(Date.now() - sentAt).toBeGreaterThanOrEqual(AGENT_STARTING_NOTICE_MS - 50);
    expect(typesOf(core, session.id)).not.toContain('session.agent_started');
    agent.letGo();
    await until(() => core.entities.getSession(session.id)?.state === 'idle', 'the reply');
    const types = typesOf(core, session.id);
    expect(types.filter((type) => type === 'session.agent_starting')).toHaveLength(1);
    expect(types.indexOf('session.agent_started')).toBeGreaterThan(types.indexOf('session.agent_starting'));
    expect(types.indexOf('session.message_completed', types.indexOf('session.agent_started'))).toBeGreaterThan(-1);
  });

  it('adds nothing for a quick start', async () => {
    const { core, chat, workspace, agent } = setUp();
    agent.quick();
    const session = await chat.createChatSession(workspace.id);
    chat.sendMessage(workspace.id, session.id, 'hello');
    await until(() => core.entities.getSession(session.id)?.state === 'idle', 'the reply');
    await new Promise((resolve) => setTimeout(resolve, AGENT_STARTING_NOTICE_MS + 100));
    expect(typesOf(core, session.id).filter((type) => type.startsWith('session.agent_start'))).toEqual([]);
  });

  it('ends the notice when the start fails too', async () => {
    const { core, chat, workspace, agent } = setUp();
    const session = await chat.createChatSession(workspace.id);
    chat.sendMessage(workspace.id, session.id, 'hello');
    await until(() => typesOf(core, session.id).includes('session.agent_starting'), 'the starting notice');
    agent.fail(new AgentError('agent_unavailable', "Slow Agent couldn't start. Try again."));
    await until(() => core.entities.getSession(session.id)?.state === 'error', 'the error');
    expect(typesOf(core, session.id)).toContain('session.agent_started');
  });
});
