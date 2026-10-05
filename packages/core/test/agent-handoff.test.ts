/**
 * Handoff (user decision 2026-10-04): a chat whose agent ran out of usage
 * continues, in the same chat, with another agent. No real agent runs: these
 * are in-memory ports that record what they were sent; one "runs out of
 * usage" on the prompt `limit`.
 */
import type { CoreEvent, PermissionMode, SessionId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import {
  AgentError,
  AgentNotReadyError,
  createAgentRegistry,
  createChat,
  DriverIsTerminalError,
  HandoffNotPreviewedError,
  InvalidOperationError,
  SessionNotIdleError,
  UnknownAgentError,
  type AgentEventListener,
  type AgentPort,
  type AgentSession,
  type Core,
} from '../src/index.js';
import { HANDOFF_HEADER } from '../src/handoff-brief.js';
import { openTestCore, registered, tempDir } from './helpers.js';

/** An agent that records each prompt, answers "<name> heard <text>", and runs out of usage on `limit`. */
function recordingAgent(name: string, declares: readonly PermissionMode[] = ['ask']) {
  const prompts: string[] = [];
  const opened: Array<{ via: 'start' | 'reopen'; agentSessionId: string }> = [];
  let count = 0;
  const open = (agentSessionId: string): AgentSession => {
    const listeners = new Set<AgentEventListener>();
    const emit = (event: Parameters<AgentEventListener>[0]) => listeners.forEach((listener) => listener(event));
    return {
      agentSessionId,
      permissionModes: declares,
      async prompt(text) {
        prompts.push(text);
        emit({ type: 'state', state: 'working' });
        if (text.endsWith('limit')) {
          const error = new AgentError('usage_limit', `${name} has reached its usage limit.`);
          emit({ type: 'state', state: 'error', reason: error.message, code: 'usage_limit' });
          throw error;
        }
        emit({ type: 'message_chunk', text: `${name} heard ${text.split('\n').at(-1) ?? ''}` });
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
    permissionModes: declares,
    skillInvocation: (skill) => `/${skill}`,
    listAuthMethods: async () => [],
    startSession: async () => {
      const agentSessionId = `${name}-${++count}`;
      opened.push({ via: 'start', agentSessionId });
      return open(agentSessionId);
    },
    reopenSession: async (input) => {
      opened.push({ via: 'reopen', agentSessionId: input.agentSessionId });
      return { session: open(input.agentSessionId), restored: 'resumed' };
    },
  };
  return { port, prompts, opened };
}

function setUp(options: { trusted?: boolean } = {}, core: Core = openTestCore()) {
  const first = recordingAgent('First Agent', ['ask', 'auto', 'skip_all']);
  const second = recordingAgent('Second Agent', ['ask', 'skip_all']);
  const careful = recordingAgent('Careful Agent');
  const agents = createAgentRegistry([
    registered('first-agent', first.port),
    registered('second-agent', second.port, { provider: 'Second Provider', handoffBudgetChars: 5_000 }),
    registered('careful-agent', careful.port, { needsProjectTrust: true }),
  ]);
  const chat = createChat({
    dataDir: tempDir('ogden-agents-data-'),
    entities: core.entities,
    sessionEvents: core.sessionEvents,
    agents,
    events: core.events,
    installSettings: core.installSettings,
    projectTrusted: () => options.trusted === true,
  });
  const workspace = chat.openWorkspace(tempDir('ogden-agents-repo-'));
  return { core, chat, workspace, first, second, careful };
}

/** A handoff as the dialog sends it: the brief previewed (as given), then handed over with that preview's token. */
async function previewedHandOff(chat: ReturnType<typeof createChat>, workspaceId: string, sessionId: string, request: { agentId: string; brief: string; message: string }) {
  const { previewToken } = await chat.handoffPreview(workspaceId as never, sessionId as never, request.agentId, request.brief);
  return chat.handOff(workspaceId as never, sessionId as never, { ...request, previewToken });
}

const streamOf = (core: Core, sessionId: SessionId): CoreEvent[] => core.events.readAfter(0).filter((event) => event.streamId === sessionId);
const typesOf = (core: Core, sessionId: SessionId) => streamOf(core, sessionId).map((event) => event.type);

async function limitedChat(setup: ReturnType<typeof setUp>) {
  const { chat, workspace } = setup;
  const session = await chat.createChatSession(workspace.id, { agentId: 'first-agent' });
  chat.sendMessage(workspace.id, session.id, 'Build the booking form');
  await chat.settled();
  chat.sendMessage(workspace.id, session.id, 'limit');
  await chat.settled();
  return session;
}

describe('a usage limit', () => {
  it("puts the chat in error with the code usage_limit and the agent's reason", async () => {
    const setup = setUp();
    const session = await limitedChat(setup);
    const error = streamOf(setup.core, session.id).findLast((event) => event.type === 'session.state_changed');
    expect(error?.type === 'session.state_changed' && error.payload).toMatchObject({ state: 'error', errorCode: 'usage_limit', reason: 'First Agent has reached its usage limit.' });
  });
});

describe('continuing a chat with another agent', () => {
  it("previews a masked brief within the target's budget, its provider and the mode it would have; nothing changes", async () => {
    const setup = setUp();
    const { core, chat, workspace } = setup;
    const session = await limitedChat(setup);
    chat.sendMessage(workspace.id, session.id, `my key is sk-ant-api03-${'k'.repeat(40)}`);
    await chat.settled();
    const before = core.events.lastSeq();
    const preview = await chat.handoffPreview(workspace.id, session.id, 'second-agent');
    expect(preview.agent).toEqual({ agentId: 'second-agent', displayName: 'Second Agent', provider: 'Second Provider' });
    expect(preview.maxChars).toBe(5_000);
    expect(preview.brief.length).toBeLessThanOrEqual(5_000);
    expect(preview.brief.startsWith(HANDOFF_HEADER)).toBe(true);
    expect(preview.brief).toContain('Original goal: Build the booking form');
    expect(preview.brief).toContain(`Project folder: ${workspace.realPath}`);
    expect(preview.brief).not.toContain('k'.repeat(40));
    expect(preview).toMatchObject({ permissionMode: 'ask', resumes: false });
    expect(core.events.lastSeq()).toBe(before);
    expect(chat.getSession(workspace.id, session.id).agentId).toBe('first-agent');
  });

  it('switches the agent in place, records it once, and sends the brief before the message', async () => {
    const setup = setUp();
    const { core, chat, workspace, second } = setup;
    const session = await limitedChat(setup);
    const { brief } = await chat.handoffPreview(workspace.id, session.id, 'second-agent');
    const edited = `${brief}\nNote from the user: keep it short.`;
    const result = await previewedHandOff(chat, workspace.id, session.id, { agentId: 'second-agent', brief: edited, message: 'Please continue' });
    await chat.settled();
    expect(result.session.agentId).toBe('second-agent');
    expect(chat.getSession(workspace.id, session.id).agentId).toBe('second-agent');
    const changes = streamOf(core, session.id).filter((event) => event.type === 'session.agent_changed');
    expect(changes).toHaveLength(1);
    expect(changes[0]?.type === 'session.agent_changed' && changes[0].payload).toEqual({ sessionId: session.id, agentId: 'second-agent', previous: 'first-agent', brief: edited, resumes: false });
    expect(second.prompts).toHaveLength(1);
    expect(second.prompts[0]).toContain('Note from the user: keep it short.');
    expect(second.prompts[0]!.endsWith('[Ogden Agents] New message:\nPlease continue')).toBe(true);
    // The earlier history stays, and the user's message is stored as typed.
    const messages = core.entities.listCompletedMessages(session.id);
    expect(messages.map((message) => message.content)).toContain('Build the booking form');
    expect(messages.at(-1)).toMatchObject({ role: 'agent', content: 'Second Agent heard Please continue' });
    expect(messages.at(-2)).toMatchObject({ role: 'user', content: 'Please continue' });
    // Sent once: the next message goes without the brief.
    chat.sendMessage(workspace.id, session.id, 'And then?');
    await chat.settled();
    expect(second.prompts[1]).toBe('And then?');
  });

  it('carries the mode the target declares, else moves the chat to Ask with cause handoff and says why', async () => {
    const setup = setUp();
    const { core, chat, workspace } = setup;
    const session = await limitedChat(setup);
    chat.setPermissionMode(workspace.id, session.id, 'auto');
    const preview = await chat.handoffPreview(workspace.id, session.id, 'second-agent');
    expect(preview).toMatchObject({ permissionMode: 'ask', modeNote: "Second Agent doesn't offer Auto here, so this chat will be in Ask." });
    await previewedHandOff(chat, workspace.id, session.id, { agentId: 'second-agent', brief: preview.brief, message: 'Go on' });
    await chat.settled();
    expect(chat.getSession(workspace.id, session.id).permissionMode).toBe('ask');
    const modeChange = streamOf(core, session.id).findLast((event) => event.type === 'session.permission_mode_changed');
    expect(modeChange?.type === 'session.permission_mode_changed' && modeChange.payload).toMatchObject({ mode: 'ask', previous: 'auto', cause: 'handoff' });
  });

  it('refuses, appending nothing: the terminal drives, the agent works, its own agent, an unknown one, an untrusted project, a brief over budget', async () => {
    const setup = setUp();
    const { core, chat, workspace } = setup;
    const session = await limitedChat(setup);
    const before = core.events.lastSeq();
    await expect(chat.handOff(workspace.id, session.id, { agentId: 'first-agent', brief: '', message: 'x', previewToken: 'unseen' })).rejects.toThrow(InvalidOperationError);
    await expect(chat.handOff(workspace.id, session.id, { agentId: 'missing-agent', brief: '', message: 'x', previewToken: 'unseen' })).rejects.toThrow(UnknownAgentError);
    await expect(chat.handOff(workspace.id, session.id, { agentId: 'careful-agent', brief: '', message: 'x', previewToken: 'unseen' })).rejects.toThrow(AgentNotReadyError);
    await expect(chat.handOff(workspace.id, session.id, { agentId: 'second-agent', brief: 'b'.repeat(5_001), message: 'x', previewToken: 'unseen' })).rejects.toThrow(/at most 5000 characters/);
    await expect(chat.handOff(workspace.id, session.id, { agentId: 'second-agent', brief: 'ok', message: '  ', previewToken: 'unseen' })).rejects.toThrow(InvalidOperationError);
    // The terminal drives (as a crashed server left it): refused with the reason.
    core.entities.setSessionDriver(session.id, 'terminal');
    const driverSeq = core.events.lastSeq();
    await expect(chat.handOff(workspace.id, session.id, { agentId: 'second-agent', brief: '', message: 'x', previewToken: 'unseen' })).rejects.toThrow(DriverIsTerminalError);
    await expect(chat.handoffPreview(workspace.id, session.id, 'second-agent')).rejects.toThrow(/Switch back to the chat/);
    core.entities.setSessionDriver(session.id, 'ui');
    expect(core.events.readAfter(before).filter((event) => event.seq !== driverSeq && event.type !== 'session.driver_changed')).toEqual([]);
    expect(chat.getSession(workspace.id, session.id).agentId).toBe('first-agent');
  });

  it('refuses a handoff no preview covers: no token, a used one, another brief, agent or chat, a changed mode, an expired one', async () => {
    const setup = setUp();
    const { core, chat, workspace } = setup;
    const session = await limitedChat(setup);
    const other = await chat.createChatSession(workspace.id, { agentId: 'first-agent' });
    const before = core.events.lastSeq();
    const go = (previewToken: string, brief = 'B', sessionId = session.id) => chat.handOff(workspace.id, sessionId, { agentId: 'second-agent', brief, message: 'm', previewToken });
    await expect(go('never-issued')).rejects.toThrow(HandoffNotPreviewedError);
    // Edited after the preview: the edit needs its own.
    const shown = await chat.handoffPreview(workspace.id, session.id, 'second-agent', 'B');
    await expect(go(shown.previewToken, 'B, edited')).rejects.toThrow(HandoffNotPreviewedError);
    // Single use, even after a mismatch.
    await expect(go(shown.previewToken)).rejects.toThrow(HandoffNotPreviewedError);
    // Another chat's preview.
    const elsewhere = await chat.handoffPreview(workspace.id, other.id, 'second-agent', 'B');
    await expect(go(elsewhere.previewToken)).rejects.toThrow(HandoffNotPreviewedError);
    // The mode changed since the preview said what it would be.
    const beforeMode = await chat.handoffPreview(workspace.id, session.id, 'second-agent', 'B');
    chat.setPermissionMode(workspace.id, session.id, 'auto');
    await expect(go(beforeMode.previewToken)).rejects.toThrow(HandoffNotPreviewedError);
    expect(core.events.readAfter(before).filter((event) => event.type !== 'session.permission_mode_changed')).toEqual([]);
    expect(chat.getSession(workspace.id, session.id).agentId).toBe('first-agent');
    // A masked brief matches its own preview: what was shown is what is sent.
    const masked = await chat.handoffPreview(workspace.id, session.id, 'second-agent', `key ghp_${'k'.repeat(36)}`);
    expect(masked.brief).toBe('key [redacted]');
    await chat.handOff(workspace.id, session.id, { agentId: 'second-agent', brief: `key ghp_${'k'.repeat(36)}`, message: 'go', previewToken: masked.previewToken });
    await chat.settled();
    expect(setup.second.prompts.at(-1)).toContain('key [redacted]');
  });

  it('a preview token expires', async () => {
    const core = openTestCore();
    const first = recordingAgent('First Agent');
    const second = recordingAgent('Second Agent');
    const chat = createChat({
      dataDir: tempDir('ogden-agents-data-'),
      entities: core.entities,
      sessionEvents: core.sessionEvents,
      agents: createAgentRegistry([registered('first-agent', first.port), registered('second-agent', second.port)]),
      handoffPreviewTtlMs: 1,
    });
    const workspace = chat.openWorkspace(tempDir('ogden-agents-repo-'));
    const session = await chat.createChatSession(workspace.id);
    const { previewToken } = await chat.handoffPreview(workspace.id, session.id, 'second-agent', 'B');
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(chat.handOff(workspace.id, session.id, { agentId: 'second-agent', brief: 'B', message: 'm', previewToken })).rejects.toThrow(HandoffNotPreviewedError);
  });

  it('masks secrets in the first message too, as it goes to another provider', async () => {
    const setup = setUp();
    const { chat, workspace, second } = setup;
    const session = await limitedChat(setup);
    await previewedHandOff(chat, workspace.id, session.id, { agentId: 'second-agent', brief: '', message: `use ghp_${'z'.repeat(36)}` });
    await chat.settled();
    expect(second.prompts.at(-1)).toBe('use [redacted]');
  });

  it('refuses while the agent works', async () => {
    const setup = setUp();
    const { chat, workspace } = setup;
    const session = await chat.createChatSession(workspace.id, { agentId: 'first-agent' });
    chat.sendMessage(workspace.id, session.id, 'hello');
    await expect(chat.handOff(workspace.id, session.id, { agentId: 'second-agent', brief: '', message: 'x', previewToken: 'unseen' })).rejects.toThrow(SessionNotIdleError);
    await chat.settled();
  });

  it('lets a trusted project hand the chat to an agent that needs trust', async () => {
    const setup = setUp({ trusted: true });
    const { chat, workspace } = setup;
    const session = await limitedChat(setup);
    await previewedHandOff(chat, workspace.id, session.id, { agentId: 'careful-agent', brief: 'brief', message: 'go' });
    await chat.settled();
    expect(setup.careful.prompts[0]).toContain('brief');
  });

  it("switching back reopens the first agent's own session and tells it only what happened since", async () => {
    const setup = setUp();
    const { chat, workspace, first, second } = setup;
    const session = await limitedChat(setup);
    const firstSessionId = first.opened[0]!.agentSessionId;
    await previewedHandOff(chat, workspace.id, session.id, { agentId: 'second-agent', brief: (await chat.handoffPreview(workspace.id, session.id, 'second-agent')).brief, message: 'Second, go on' });
    await chat.settled();
    expect(second.opened).toEqual([{ via: 'start', agentSessionId: 'Second Agent-1' }]);
    const back = await chat.handoffPreview(workspace.id, session.id, 'first-agent');
    expect(back.resumes).toBe(true);
    expect(back.brief).toContain('you are back in this chat');
    expect(back.brief).toContain('Second Agent: Second Agent heard Second, go on');
    expect(back.brief).not.toContain('User: Build the booking form');
    await previewedHandOff(chat, workspace.id, session.id, { agentId: 'first-agent', brief: back.brief, message: 'First again' });
    await chat.settled();
    expect(first.opened.at(-1)).toEqual({ via: 'reopen', agentSessionId: firstSessionId });
    expect(first.prompts.at(-1)).toContain('Second Agent heard Second, go on');
    // And to the second again: it reopens its own session too.
    await previewedHandOff(chat, workspace.id, session.id, { agentId: 'second-agent', brief: '', message: 'Second again' });
    await chat.settled();
    expect(second.opened.at(-1)).toEqual({ via: 'reopen', agentSessionId: 'Second Agent-1' });
    expect(second.prompts.at(-1)).toBe('Second again');
  });

  it('keeps the brief for the next message when the first prompt failed, or the server restarted before it', async () => {
    const core = openTestCore();
    const setup = setUp({}, core);
    const { chat, workspace, second } = setup;
    const session = await limitedChat(setup);
    // The new agent runs out too: the brief waits for the next message.
    await previewedHandOff(chat, workspace.id, session.id, { agentId: 'second-agent', brief: 'THE BRIEF', message: 'limit' });
    await chat.settled();
    expect(second.prompts.at(-1)).toContain('THE BRIEF');
    await chat.close();
    // A new server run on the same data: the next message still carries it.
    const again = setUp({}, core);
    again.chat.sendMessage(workspace.id, session.id, 'Try once more');
    await again.chat.settled();
    expect(again.second.prompts.at(-1)).toBe('THE BRIEF\n[Ogden Agents] New message:\nTry once more');
    again.chat.sendMessage(workspace.id, session.id, 'Plain');
    await again.chat.settled();
    expect(again.second.prompts.at(-1)).toBe('Plain');
    expect(typesOf(core, session.id).filter((type) => type === 'session.agent_changed')).toHaveLength(1);
  });

  it('reads a chat stored before handoffs as before: its agent, no agent_changed', async () => {
    const setup = setUp();
    const { core, chat, workspace, first } = setup;
    const old = core.entities.createSession({ workspaceId: workspace.id, kind: 'chat' });
    chat.sendMessage(workspace.id, old.id, 'hi');
    await chat.settled();
    expect(chat.getSession(workspace.id, old.id).agentId).toBe('first-agent');
    expect(first.prompts).toEqual(['hi']);
    expect(typesOf(core, old.id)).not.toContain('session.agent_changed');
  });
});
