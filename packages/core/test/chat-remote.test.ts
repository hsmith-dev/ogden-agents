/**
 * A plain chat targeting a remote machine (CAP-24, epic 19 story 19.7): the
 * first story to extend the remote mechanism (19.1-19.6 built it for builds
 * only) to an ordinary `chat` session. `ChatOptions.remote` is a fake here
 * (`connect` only, exactly as the real capability's narrow shape); the real
 * SSH transport is `remote-worktree-sync.test.ts`'s (19.4) and
 * `acp-base-remote.test.ts`'s (19.5) own job, and the real wiring
 * (`start.ts` building one shared capability) is this story's own
 * `tests/e2e/remote-target.spec.ts`'s job.
 */
import { realpathSync } from 'node:fs';
import { createChat, newId, RemoteHostError, type AgentError, type AgentEvent, type AgentPort, type AgentSession, type Core, type RemoteHostConnection, type StartAgentSession } from '../src/index.js';
import type { SessionId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { openTestCore, soleAgent, tempDir } from './helpers.js';

/**
 * An agent that records what it was opened with (`cwd`, `remote`), on either
 * path (`startSession` or `reopenSession` -- a fresh `createChat` reopens the
 * chat's earlier agent session, 2.7, exactly as a real restart would), and
 * answers every prompt at once with `ok`.
 */
function recordingAgent() {
  const opens: Array<{ cwd: string; remote: RemoteHostConnection | undefined }> = [];
  let sessionsOpened = 0;
  const open = (input: StartAgentSession, agentSessionId: string): AgentSession => {
    opens.push({ cwd: input.cwd, remote: input.remote });
    const listeners = new Set<(event: AgentEvent) => void>();
    return {
      agentSessionId,
      onEvent(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async prompt(text) {
        for (const listener of [...listeners]) listener({ type: 'state', state: 'working' });
        for (const listener of [...listeners]) listener({ type: 'message_chunk', text: 'ok' });
        for (const listener of [...listeners]) listener({ type: 'state', state: 'idle' });
        void text;
        return { stopReason: 'end_turn' };
      },
      async cancel() {},
      async close() {},
    };
  };
  const port: AgentPort = {
    displayName: 'Test Agent',
    skillInvocation: (skill) => `/${skill}`,
    listAuthMethods: async () => [],
    async startSession(input: StartAgentSession): Promise<AgentSession> {
      return open(input, `agent-${++sessionsOpened}`);
    },
    async reopenSession(input: StartAgentSession & { agentSessionId: string }) {
      return { session: open(input, input.agentSessionId), restored: 'resumed' as const };
    },
  };
  return { port, starts: opens };
}

/** A fake `ChatOptions.remote`: records every `connect`, and can be told to fail it. */
function fakeRemote() {
  const connects: string[] = [];
  const closes: number[] = [];
  let fails = false;
  const connect = async (machineId: string): Promise<RemoteHostConnection> => {
    connects.push(machineId);
    if (fails) throw new RemoteHostError(`${machineId} is unreachable.`, {}, 'host_unreachable');
    return {
      async exec() {
        throw new Error('not exercised at the chat-orchestration level: the ACP adapter owns exec (story 19.5)');
      },
      async close() {
        closes.push(1);
      },
    };
  };
  return { remote: { connect }, connects, closes, fail: () => (fails = true) };
}

function setUp(core: Core, port: AgentPort, remote?: { connect(machineId: string): Promise<RemoteHostConnection> }) {
  const errors: Array<[SessionId, AgentError]> = [];
  const chat = createChat({
    dataDir: tempDir('ogden-agents-data-'),
    entities: core.entities,
    sessionEvents: core.sessionEvents,
    agents: soleAgent(port),
    agentEnv: () => ({}),
    onAgentError: (sessionId, error) => errors.push([sessionId, error]),
    ...(remote === undefined ? {} : { remote }),
  });
  const repo = tempDir('ogden-agents-repo-');
  const workspace = chat.openWorkspace(repo);
  return { chat, workspace, errors, repo };
}

describe('a plain chat targeting a remote machine (CAP-24, epic 19 story 19.7)', () => {
  it('runs the agent in the machine’s own home directory, over the opened connection, not the workspace’s folder', async () => {
    const core = openTestCore();
    const agent = recordingAgent();
    const fake = fakeRemote();
    const { chat, workspace, repo } = setUp(core, agent.port, fake.remote);
    const machineId = newId('mach');

    const session = await chat.createChatSession(workspace.id, { machineId });
    expect(session.machineId).toBe(machineId);
    chat.sendMessage(workspace.id, session.id, 'hello');
    await chat.settled();

    expect(fake.connects).toEqual([machineId]);
    expect(agent.starts).toHaveLength(1);
    // Never the workspace's own folder, which names nothing on the remote machine (this story's own design call).
    expect(agent.starts[0]!.cwd).toBe('.');
    expect(agent.starts[0]!.cwd).not.toBe(realpathSync.native(repo));
    expect(agent.starts[0]!.remote).toBeDefined();
    expect(core.entities.getSession(session.id)!.state).toBe('idle');
  });

  it('omitted machineId is a local chat, byte-identical to before this story: no connect, the workspace’s own folder', async () => {
    const core = openTestCore();
    const agent = recordingAgent();
    const fake = fakeRemote();
    const { chat, workspace, repo } = setUp(core, agent.port, fake.remote);

    const session = await chat.createChatSession(workspace.id);
    expect(session.machineId).toBeNull();
    chat.sendMessage(workspace.id, session.id, 'hello');
    await chat.settled();

    expect(fake.connects).toEqual([]);
    expect(agent.starts[0]!.cwd).toBe(realpathSync.native(repo));
    expect(agent.starts[0]!.remote).toBeUndefined();
  });

  it('opens a fresh connection every time the agent (re)starts, never reusing one across restarts', async () => {
    const core = openTestCore();
    const agent = recordingAgent();
    const fake = fakeRemote();
    const { chat, workspace } = setUp(core, agent.port, fake.remote);
    const machineId = newId('mach');
    const session = await chat.createChatSession(workspace.id, { machineId });

    chat.sendMessage(workspace.id, session.id, 'one');
    await chat.settled();
    await chat.close();

    // A fresh `createChat` over the same entities, as a server restart would (AD-3): the dropped agent is gone,
    // so the next message starts a new one and opens a new connection.
    const { chat: reopened } = setUp(core, agent.port, fake.remote);
    reopened.sendMessage(workspace.id, session.id, 'two');
    await reopened.settled();

    expect(fake.connects).toEqual([machineId, machineId]);
    expect(agent.starts).toHaveLength(2);
  });

  it('refuses with agent_unavailable, fail closed, when this install never wired the remote capability at all', async () => {
    const core = openTestCore();
    const agent = recordingAgent();
    const { chat, workspace, errors } = setUp(core, agent.port); // no `remote` given.
    const machineId = newId('mach');
    const session = await chat.createChatSession(workspace.id, { machineId });

    chat.sendMessage(workspace.id, session.id, 'hello');
    await chat.settled();

    expect(agent.starts).toEqual([]);
    expect(core.entities.getSession(session.id)!.state).toBe('error');
    expect(errors.map(([, error]) => error.code)).toEqual(['agent_unavailable']);
  });

  it('refuses the same way the chat already refuses any failed start when the machine itself cannot be reached', async () => {
    const core = openTestCore();
    const agent = recordingAgent();
    const fake = fakeRemote();
    fake.fail();
    const { chat, workspace, errors } = setUp(core, agent.port, fake.remote);
    const machineId = newId('mach');
    const session = await chat.createChatSession(workspace.id, { machineId });

    chat.sendMessage(workspace.id, session.id, 'hello');
    await chat.settled();

    expect(agent.starts).toEqual([]);
    expect(core.entities.getSession(session.id)!.state).toBe('error');
    // Not an `AgentError`: the chat's own generic wrapping (`toAgentError`) still ends the chat in `error`, never
    // left `working` and never run locally instead (defense in depth, the I/O matrix's own "changed host key" row).
    expect(errors.map(([, error]) => error.code)).toEqual(['agent_failed']);
  });
});
