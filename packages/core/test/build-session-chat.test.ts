/**
 * A `build` session in the chat core (story 5.2, review loop 1): its agent
 * starts in the run's worktree with the run's sandbox, its permission
 * requests are answered by the build policy (never a card), and core itself
 * refuses a user message, a permission mode, a driver change and Stop for
 * it; only the builds use-case's own prompt (`{ build: true }`) goes through.
 */
import type { SessionId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import {
  BuildSessionReadOnlyError,
  createBuildSessions,
  createChat,
  type AgentEvent,
  type AgentPermissionDecision,
  type AgentPort,
  type StartAgentSession,
} from '../src/index.js';
import { openTestCore, soleAgent, tempDir } from './helpers.js';

/** An agent that asks one permission per prompt and records how it was started. */
function askingAgent() {
  const starts: StartAgentSession[] = [];
  const decisions: AgentPermissionDecision[] = [];
  const port: AgentPort = {
    displayName: 'Test Agent',
    skillInvocation: (skill) => `/${skill}`,
    listAuthMethods: async () => [],
    async startSession(input) {
      starts.push(input);
      const listeners = new Set<(event: AgentEvent) => void>();
      return {
        agentSessionId: `agent-${starts.length}`,
        onEvent(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        async prompt() {
          for (const listener of listeners) listener({ type: 'state', state: 'working' });
          decisions.push((await input.onPermissionRequest?.({ toolCallId: 't', title: 'Write', kind: 'edit', paths: ['src/a.ts'] })) ?? { outcome: 'cancelled' });
          for (const listener of listeners) listener({ type: 'state', state: 'idle' });
          return { stopReason: 'end_turn' };
        },
        async cancel() {},
        async close() {},
      };
    },
    async reopenSession() {
      throw new Error('not used');
    },
  };
  return { port, starts, decisions };
}

describe('a build session in the chat core (story 5.2)', () => {
  it('starts in the worktree with the sandbox and the policy; refuses user messages, a mode, a driver and Stop', async () => {
    const core = openTestCore();
    const agent = askingAgent();
    const buildSessions = createBuildSessions();
    const chat = createChat({ dataDir: tempDir('ogden-agents-data-'), entities: core.entities, sessionEvents: core.sessionEvents, agents: soleAgent(agent.port), buildSessions });
    try {
      const workspace = chat.openWorkspace(tempDir('ogden-agents-repo-'));
      const session = await chat.createChatSession(workspace.id, { kind: 'build' });
      const sandbox = { kind: 'test', writableRoots: ['/w/x'], deniedPaths: [], deniedReads: [], allowedReads: ['/w/x'] };
      buildSessions.set(session.id, { cwd: '/w/x', sandbox, decide: () => ({ outcome: 'allow_once' }) });

      expect(() => chat.sendMessage(workspace.id, session.id, 'hello')).toThrow(BuildSessionReadOnlyError);
      expect(() => chat.setPermissionMode(workspace.id, session.id, 'skip_all', { confirm: true })).toThrow(BuildSessionReadOnlyError);
      await expect(chat.switchDriver(workspace.id, session.id, 'terminal')).rejects.toBeInstanceOf(BuildSessionReadOnlyError);
      expect(() => chat.cancel(workspace.id, session.id)).toThrow(BuildSessionReadOnlyError);
      expect(agent.starts).toEqual([]);

      chat.sendMessage(workspace.id, session.id, '/build 1.1', { build: true });
      await chat.settled();
      expect(agent.starts).toHaveLength(1);
      expect(agent.starts[0]).toMatchObject({ cwd: '/w/x', sandbox });
      expect(agent.starts[0]!.attended).toBeUndefined();
      expect(agent.decisions).toEqual([{ outcome: 'allow_once' }]);
      // No card: no permission event in the session's stream.
      expect(core.events.readAfter(0).filter((event) => event.streamId === session.id && event.type.startsWith('permission.'))).toEqual([]);
    } finally {
      await chat.close();
    }
  });

  it('an attended build (story 5.6) starts in the worktree with no sandbox, its requests are cards at ask_every_time', async () => {
    const core = openTestCore();
    const agent = askingAgent();
    const buildSessions = createBuildSessions();
    const chat = createChat({ dataDir: tempDir('ogden-agents-data-'), entities: core.entities, sessionEvents: core.sessionEvents, agents: soleAgent(agent.port), buildSessions, permissions: core.permissions });
    try {
      const workspace = chat.openWorkspace(tempDir('ogden-agents-repo-'));
      const session = await chat.createChatSession(workspace.id, { kind: 'build' });
      buildSessions.set(session.id, { attended: true, cwd: '/w/y' });
      // The user does not type into a build session, attended or not.
      expect(() => chat.sendMessage(workspace.id, session.id, 'hello')).toThrow(BuildSessionReadOnlyError);
      expect(() => chat.setPermissionMode(workspace.id, session.id, 'skip_all', { confirm: true })).toThrow(BuildSessionReadOnlyError);

      chat.sendMessage(workspace.id, session.id, '/build 1.1', { build: true });
      for (let tries = 0; tries < 50 && agent.starts.length === 0; tries++) await new Promise((resolve) => setTimeout(resolve, 10));
      expect(agent.starts).toHaveLength(1);
      expect(agent.starts[0]).toMatchObject({ cwd: '/w/y' });
      expect(agent.starts[0]!.sandbox).toBeUndefined();
      // The agent is told it is an attended build, so its own policy tier can keep the user's settings from skipping a card.
      expect(agent.starts[0]).toMatchObject({ attended: true });
      // The request waits for the user as a card, at the ask_every_time level.
      const requested = () => core.events.readAfter(0).filter((event) => event.streamId === session.id && event.type === 'permission.requested');
      for (let tries = 0; tries < 50 && requested().length === 0; tries++) await new Promise((resolve) => setTimeout(resolve, 10));
      const [card] = requested();
      expect(card?.payload).toMatchObject({ cautionLevel: 'ask_every_time', alwaysAllowScope: null });
      expect(agent.decisions).toEqual([]);
      core.permissions.decide(workspace.id, session.id, (card!.payload as { requestId: string }).requestId, { decision: 'allow_once' });
      await chat.settled();
      expect(agent.decisions).toEqual([{ outcome: 'allow_once' }]);
    } finally {
      await chat.close();
    }
  });

  it('a build session without its setup (after a restart) never starts an agent', async () => {
    const core = openTestCore();
    const agent = askingAgent();
    const chat = createChat({ dataDir: tempDir('ogden-agents-data-'), entities: core.entities, sessionEvents: core.sessionEvents, agents: soleAgent(agent.port), buildSessions: createBuildSessions() });
    try {
      const workspace = chat.openWorkspace(tempDir('ogden-agents-repo-'));
      const session = await chat.createChatSession(workspace.id, { kind: 'build' });
      chat.sendMessage(workspace.id, session.id as SessionId, '/build 1.1', { build: true });
      await chat.settled();
      expect(agent.starts).toEqual([]);
      expect(core.entities.getSession(session.id)?.state).toBe('error');
    } finally {
      await chat.close();
    }
  });
});
