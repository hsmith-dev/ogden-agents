/**
 * Epic 12, 12.3 (epic contracts): what core adds, naming no agent, for agents
 * that need more than epic 6 gave them: an agent's own config folders in the
 * protected paths, a permission mode fixed when a chat starts, the project
 * trust that also binds the files an agent runs, and the agent list that says
 * which project trusts which agent. No real agent runs: in-memory ports.
 */
import { mkdirSync } from 'node:fs';
import Sqlite from 'better-sqlite3';
import { join } from 'node:path';
import { PERMISSION_MODES, projectNotTrustedReason, type CoreEvent, type PermissionMode, type SessionId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import {
  agentConfigFolders,
  agentDescriptorProblems,
  agentProjectFiles,
  AgentNotReadyError,
  commandNamesProtectedPath,
  createAgentRegistry,
  createChat,
  isProtectedSegment,
  ModeUnavailableError,
  PROTECTED_PATHS,
  protectedPathsWith,
  touchesProtectedPath,
  type AgentEvent,
  type AgentPermissionRequest,
  type AgentPort,
  type AgentSession,
  type StartAgentSession,
} from '../src/index.js';
import { DATABASE_FILE } from '../src/db/database.js';
import { openTestCore, registered, tempDir, testDescriptor } from './helpers.js';

const AGENT = 'fixed-agent';

describe('descriptor fields (12.3)', () => {
  const port = (displayName = 'Some Agent'): Pick<AgentPort, 'displayName' | 'permissionModes'> => ({ displayName, permissionModes: ['ask', 'auto', 'skip_all'] });

  it('takes config folders, project files and a fixed mode', () => {
    const descriptor = testDescriptor('some-agent', port(), {
      needsProjectTrust: true,
      projectFiles: ['.claude/settings.json', '.mcp.json'],
      modeFixedAtStart: true,
      configFolders: ['.some', '.other'],
    });
    expect(agentDescriptorProblems(descriptor)).toEqual([]);
    expect(agentConfigFolders([descriptor, testDescriptor('b', port(), { configFolders: ['.some', '.third'] })])).toEqual(['.some', '.other', '.third']);
  });

  it.each([
    ['a config folder that is a path', { configFolders: ['.a/b'] }, /config folder/],
    ['an absolute config folder', { configFolders: ['/etc'] }, /config folder/],
    ['a parent config folder', { configFolders: ['..'] }, /config folder/],
    ['project files without project trust', { projectFiles: ['.mcp.json'] }, /does not need project trust/],
    ['a project file outside the repo', { needsProjectTrust: true, projectFiles: ['../x'] }, /project file/],
    ['a Windows project file', { needsProjectTrust: true, projectFiles: ['C:\\x'] }, /project file/],
  ])('refuses %s', (_name, overrides, problem) => {
    expect(agentDescriptorProblems(testDescriptor('some-agent', port(), overrides)).join(';')).toMatch(problem);
  });

  it('lists the project files only of agents that need project trust, each once, sorted', () => {
    const a = testDescriptor('a', port(), { needsProjectTrust: true, projectFiles: ['.mcp.json', '.claude/settings.json'] });
    const b = testDescriptor('b', port(), { needsProjectTrust: true, projectFiles: ['.mcp.json'] });
    const c = testDescriptor('c', port());
    expect(agentProjectFiles([a, b, c])).toEqual(['.claude/settings.json', '.mcp.json']);
  });

  it('the registry refuses a port and a descriptor that disagree on a mode fixed at start', () => {
    const agent: AgentPort = { ...fixedPort(false), modeFixedAtStart: true };
    expect(() => createAgentRegistry([registered(AGENT, agent)])).toThrow(/disagree on whether its mode is fixed/);
    expect(() => createAgentRegistry([registered(AGENT, fixedPort(false), { modeFixedAtStart: true })])).toThrow(/disagree/);
    expect(() => createAgentRegistry([registered(AGENT, { ...fixedPort(false), modeFixedAtStart: true }, { modeFixedAtStart: true })])).not.toThrow();
  });
});

describe('an agent’s own config folders join the protected paths', () => {
  it('protectedPathsWith adds each folder once, ignoring case, and keeps core’s', () => {
    expect(protectedPathsWith()).toBe(PROTECTED_PATHS);
    const widened = protectedPathsWith(['.cfg', '.CFG', '.Git']);
    expect(widened.folders).toEqual([...PROTECTED_PATHS.folders, '.cfg']);
    expect(widened.files).toEqual(PROTECTED_PATHS.files);
  });

  it('the checks take them: a segment, a command, and a path in the project', () => {
    expect(isProtectedSegment('.cfg')).toBe(false);
    expect(isProtectedSegment('.CFG', ['.cfg'])).toBe(true);
    expect(commandNamesProtectedPath('echo x > .cfg/settings.json')).toBe(false);
    expect(commandNamesProtectedPath('echo x > .cfg/settings.json', ['.cfg'])).toBe(true);
    const core = openTestCore();
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    const repo = workspace.realPath ?? workspace.path;
    mkdirSync(join(repo, '.cfg'));
    expect(touchesProtectedPath(workspace, ['.cfg/a.json'])).toBe(false);
    expect(touchesProtectedPath(workspace, ['.cfg/a.json'], ['.cfg'])).toBe(true);
  });

  it('a write to one always shows a card once core is given the folders, and not before', async () => {
    for (const [folders, protectedPath] of [[[] as string[], undefined], [['.cfg'], true]] as const) {
      const core = openTestCore(tempDir(), undefined, { agentConfigFolders: () => folders });
      const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
      const session = core.entities.createSession({ workspaceId: workspace.id, kind: 'chat' });
      core.entities.setSessionState(session.id, 'working');
      core.permissions.updateSettings(workspace.id, { cautionLevel: 'ask_risky_only' });
      const request: AgentPermissionRequest = { toolCallId: 't1', title: 'edit .cfg/a.json', kind: 'edit', paths: ['.cfg/a.json'] };
      void core.permissions.request(session.id, request).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const requested = core.events.readAfter(0).find((event) => event.streamId === session.id && event.type === 'permission.requested');
      expect(requested?.type === 'permission.requested' && requested.payload.toolCall.protectedPath).toBe(protectedPath);
    }
  });
});

// ---------------------------------------------------------------------------
// A chat with an agent whose mode is fixed at start, and one that needs the project trusted.
// ---------------------------------------------------------------------------

interface FixedAgentOptions {
  /** The mode each session reports it started in (the 1-based count of starts may pick); default: the mode core gave at start. */
  startsIn?: PermissionMode | ((start: number) => PermissionMode | undefined) | undefined;
  /** Whether sessions keep the protected paths guarded. Default: when core gave them. */
  guards?: boolean;
}

function fixedPort(fixed = true, options: FixedAgentOptions = {}) {
  const starts: StartAgentSession[] = [];
  const reopens: Array<StartAgentSession & { agentSessionId: string }> = [];
  const closed: string[] = [];
  let opened = 0;
  /** Every start and reopen, counted. */
  let openings = 0;
  const open = (input: StartAgentSession, agentSessionId: string): AgentSession => {
    const listeners = new Set<(event: AgentEvent) => void>();
    const emit = (event: AgentEvent) => listeners.forEach((listener) => listener(event));
    const picked = typeof options.startsIn === 'function' ? options.startsIn(++openings) : options.startsIn;
    const mode = picked ?? input.permissionMode ?? 'ask';
    return {
      agentSessionId,
      protectsPaths: options.guards ?? input.protectedPaths !== undefined,
      permissionModes: PERMISSION_MODES,
      ...(fixed ? { fixedPermissionMode: mode } : {}),
      async setPermissionMode() {
        throw new Error('a fixed-mode session is never told a mode');
      },
      onEvent(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async prompt(text) {
        emit({ type: 'state', state: 'working' });
        emit({ type: 'message_chunk', text: text === 'mode' ? `mode=${mode}` : 'Hello' });
        emit({ type: 'state', state: 'idle' });
        return { stopReason: 'end_turn' };
      },
      async cancel() {},
      async close() {
        closed.push(agentSessionId);
      },
    };
  };
  const port: AgentPort = {
    displayName: 'Fixed Agent',
    permissionModes: PERMISSION_MODES,
    ...(fixed ? { modeFixedAtStart: true } : {}),
    skillInvocation: (skill) => `/${skill}`,
    listAuthMethods: async () => [],
    startSession: async (input) => (starts.push(input), open(input, `agent-${++opened}`)),
    reopenSession: async (input) => (reopens.push(input), { session: open(input, input.agentSessionId), restored: 'resumed' }),
  };
  return Object.assign(port, { starts, reopens, closed });
}

function setUp(
  options: FixedAgentOptions & { fixed?: boolean; trust?: { current: boolean }; needsTrust?: boolean; configFolders?: string[] } = {},
) {
  const agent = fixedPort(options.fixed ?? true, options);
  const core = openTestCore();
  const trust = options.trust ?? { current: true };
  const registry = createAgentRegistry([
    registered(AGENT, agent, {
      ...(options.fixed === false ? {} : { modeFixedAtStart: true }),
      ...(options.needsTrust === true ? { needsProjectTrust: true, projectFiles: ['.mcp.json'] } : {}),
      ...(options.configFolders === undefined ? {} : { configFolders: options.configFolders }),
    }),
  ]);
  const internal: unknown[] = [];
  const chat = createChat({
    dataDir: tempDir('ogden-agents-data-'),
    entities: core.entities,
    sessionEvents: core.sessionEvents,
    agents: registry,
    permissions: core.permissions,
    events: core.events,
    installSettings: core.installSettings,
    projectTrusted: () => trust.current,
    onInternalError: (_sessionId, error) => internal.push(error),
  });
  const workspace = chat.openWorkspace(tempDir('ogden-agents-repo-'));
  return { core, chat, agent, workspace, trust, internal };
}

const streamOf = (core: ReturnType<typeof openTestCore>, sessionId: SessionId): CoreEvent[] => core.events.readAfter(0).filter((event) => event.streamId === sessionId);
const replies = (core: ReturnType<typeof openTestCore>, sessionId: SessionId) =>
  streamOf(core, sessionId).flatMap((event) => (event.type === 'session.message_completed' && event.payload.role === 'agent' ? [event.payload.content] : []));

describe('a mode fixed at chat start (12.3)', () => {
  it('every start is given the chat’s mode, and a chat in Ask starts in Ask', async () => {
    const { core, chat, agent, workspace } = setUp();
    const session = await chat.createChatSession(workspace.id, { agentId: AGENT });
    chat.sendMessage(workspace.id, session.id, 'mode');
    await chat.settled();
    expect(agent.starts.map((input) => input.permissionMode)).toEqual(['ask']);
    expect(replies(core, session.id)).toEqual(['mode=ask']);
  });

  it('before the first start the mode can be chosen, and the agent starts in it', async () => {
    const { core, chat, agent, workspace } = setUp();
    core.installSettings.setDeveloperMode(true);
    const session = await chat.createChatSession(workspace.id, { agentId: AGENT });
    expect(chat.permissionModeOptions(workspace.id, session.id).every((option) => option.available && option.fixed === undefined)).toBe(true);
    chat.setPermissionMode(workspace.id, session.id, 'skip_all', { confirm: true });
    chat.sendMessage(workspace.id, session.id, 'mode');
    await chat.settled();
    expect(agent.starts.map((input) => input.permissionMode)).toEqual(['skip_all']);
    expect(replies(core, session.id)).toEqual(['mode=skip_all']);
  });

  it('once the chat has an agent session a change is refused with a plain reason, and the options say it is fixed', async () => {
    const { core, chat, workspace } = setUp();
    core.installSettings.setDeveloperMode(true);
    const session = await chat.createChatSession(workspace.id, { agentId: AGENT });
    chat.setPermissionMode(workspace.id, session.id, 'auto');
    chat.sendMessage(workspace.id, session.id, 'mode');
    await chat.settled();
    expect(() => chat.setPermissionMode(workspace.id, session.id, 'ask')).toThrow(ModeUnavailableError);
    expect(() => chat.setPermissionMode(workspace.id, session.id, 'ask')).toThrow(
      'Fixed Agent sets its permission mode when a chat starts, so this chat stays in Auto. Start a new chat to use Ask.',
    );
    expect(() => chat.setPermissionMode(workspace.id, session.id, 'skip_all', { confirm: true })).toThrow(ModeUnavailableError);
    expect(core.entities.getSession(session.id)?.permissionMode).toBe('auto');
    expect(chat.permissionModeOptions(workspace.id, session.id)).toEqual([
      { mode: 'ask', available: false, reason: expect.stringContaining('stays in Auto') },
      { mode: 'auto', available: true, fixed: true },
      { mode: 'skip_all', available: false, reason: expect.stringContaining('stays in Auto') },
    ]);
  });

  it('a chat with a stored session stays fixed after a restart, and its reopen gets the stored mode', async () => {
    const { core, chat, agent, workspace } = setUp();
    const session = await chat.createChatSession(workspace.id, { agentId: AGENT });
    chat.sendMessage(workspace.id, session.id, 'hi');
    await chat.settled();
    // A second chat object on the same data: no live agent, a stored agent session.
    const again = createChat({
      dataDir: tempDir('ogden-agents-data-'),
      entities: core.entities,
      sessionEvents: core.sessionEvents,
      agents: createAgentRegistry([registered(AGENT, agent, { modeFixedAtStart: true })]),
      permissions: core.permissions,
      events: core.events,
      installSettings: core.installSettings,
    });
    expect(again.permissionModeOptions(workspace.id, session.id).find((option) => option.mode === 'ask')).toEqual({ mode: 'ask', available: true, fixed: true });
    again.sendMessage(workspace.id, session.id, 'mode');
    await again.settled();
    expect(agent.reopens.map((input) => input.permissionMode)).toEqual(['ask']);
  });

  it('an agent that is not fixed is changed as before: no refusal, no fixed flag', async () => {
    const { chat, workspace } = setUp({ fixed: false });
    const session = await chat.createChatSession(workspace.id, { agentId: AGENT });
    chat.sendMessage(workspace.id, session.id, 'hi');
    await chat.settled();
    expect(chat.permissionModeOptions(workspace.id, session.id).some((option) => option.fixed === true)).toBe(false);
  });

  describe('the mode a session reports is checked against the chat’s', () => {
    it('a session started stricter than the chat runs, and restarts at the next idle point in the chat’s mode', async () => {
      const { core, chat, agent, workspace } = setUp({ startsIn: (start) => (start === 1 ? 'ask' : undefined), guards: true });
      core.installSettings.setDeveloperMode(true);
      const session = await chat.createChatSession(workspace.id, { agentId: AGENT });
      chat.setPermissionMode(workspace.id, session.id, 'skip_all', { confirm: true });
      chat.sendMessage(workspace.id, session.id, 'mode');
      await chat.settled();
      // The first session runs in Ask (stricter) and is stopped at the next idle point; the next start is in Skip all, and the prompt goes there.
      expect(agent.closed).toEqual(['agent-1']);
      expect(agent.starts.map((input) => input.permissionMode)).toEqual(['skip_all']);
      expect(agent.reopens.map((input) => input.permissionMode)).toEqual(['skip_all']);
      expect(replies(core, session.id)).toEqual(['mode=skip_all']);
    });

    it('a session that started in a looser mode than the chat’s is stopped, never kept', async () => {
      const { core, chat, agent, workspace } = setUp({ startsIn: 'skip_all' });
      const session = await chat.createChatSession(workspace.id, { agentId: AGENT });
      chat.sendMessage(workspace.id, session.id, 'mode');
      await chat.settled();
      expect(agent.closed).toEqual(['agent-1']);
      expect(replies(core, session.id)).toEqual([]);
      expect(core.entities.getSession(session.id)?.state).toBe('error');
    });

    it('Auto whose protected paths were not guarded never runs: the chat goes back to Ask and the session is stopped', async () => {
      const { core, chat, agent, workspace } = setUp({ guards: false });
      const session = await chat.createChatSession(workspace.id, { agentId: AGENT });
      chat.setPermissionMode(workspace.id, session.id, 'auto');
      chat.sendMessage(workspace.id, session.id, 'mode');
      await chat.settled();
      expect(agent.closed).toEqual(['agent-1']);
      expect(replies(core, session.id)).toEqual([]);
      expect(core.entities.getSession(session.id)?.permissionMode).toBe('ask');
    });

    it('Auto is started with the protected paths, and a session that guards them runs', async () => {
      const { core, chat, agent, workspace } = setUp({ configFolders: ['.fixed'] });
      const session = await chat.createChatSession(workspace.id, { agentId: AGENT });
      chat.setPermissionMode(workspace.id, session.id, 'auto');
      chat.sendMessage(workspace.id, session.id, 'mode');
      await chat.settled();
      expect(replies(core, session.id)).toEqual(['mode=auto']);
      // The agent's own config folder is guarded with core's (descriptor configFolders).
      expect(agent.starts[0]?.protectedPaths?.folders).toEqual([...PROTECTED_PATHS.folders, '.fixed']);
      expect(agent.closed).toEqual([]);
    });
  });
});

describe('the project trust for an agent that runs the project’s own files (12.3)', () => {
  it('the agent list read for a project says project_not_trusted with the trust action; read for none it does not', async () => {
    const { chat, workspace, trust } = setUp({ needsTrust: true, trust: { current: false } });
    expect((await chat.chatAgents()).agents[0]?.unavailable).toBeUndefined();
    const listed = (await chat.chatAgents(workspace.id)).agents[0];
    expect(listed?.needsProjectTrust).toBe(true);
    expect(listed?.unavailable).toEqual({ code: 'project_not_trusted', reason: projectNotTrustedReason('Fixed Agent'), action: 'trust_project' });
    trust.current = true;
    expect((await chat.chatAgents(workspace.id)).agents[0]?.unavailable).toBeUndefined();
  });

  it('a new chat is refused until the project is trusted', async () => {
    const { chat, workspace, trust } = setUp({ needsTrust: true, trust: { current: false } });
    await expect(chat.createChatSession(workspace.id, { agentId: AGENT })).rejects.toMatchObject({ code: 'project_not_trusted', action: 'trust_project' });
    await expect(chat.createChatSession(workspace.id, { agentId: AGENT })).rejects.toBeInstanceOf(AgentNotReadyError);
    trust.current = true;
    await expect(chat.createChatSession(workspace.id, { agentId: AGENT })).resolves.toMatchObject({ agentId: AGENT });
  });

  it('every start asks again: trust withdrawn after the chat was made refuses the next start, and trusting again starts it', async () => {
    const { core, chat, agent, workspace, trust } = setUp({ needsTrust: true });
    const session = await chat.createChatSession(workspace.id, { agentId: AGENT });
    trust.current = false;
    chat.sendMessage(workspace.id, session.id, 'hi');
    await chat.settled();
    expect(agent.starts).toEqual([]);
    expect(core.entities.getSession(session.id)?.state).toBe('error');
    const failure = streamOf(core, session.id).find((event) => event.type === 'session.state_changed' && event.payload.state === 'error');
    expect(JSON.stringify(failure)).toContain(projectNotTrustedReason('Fixed Agent'));
    trust.current = true;
    chat.sendMessage(workspace.id, session.id, 'hi again');
    await chat.settled();
    expect(agent.starts).toHaveLength(1);
  });

  it('a reopen asks again too: a chat with a stored agent session, its process gone, is refused when trust was withdrawn', async () => {
    const { core, chat, agent, workspace, trust } = setUp({ needsTrust: true });
    const session = await chat.createChatSession(workspace.id, { agentId: AGENT });
    chat.sendMessage(workspace.id, session.id, 'hi');
    await chat.settled();
    expect(agent.starts).toHaveLength(1);
    // A second chat object on the same data, as after a restart: no live agent, a stored agent session to reopen.
    const again = createChat({
      dataDir: tempDir('ogden-agents-data-'),
      entities: core.entities,
      sessionEvents: core.sessionEvents,
      agents: createAgentRegistry([registered(AGENT, agent, { modeFixedAtStart: true, needsProjectTrust: true, projectFiles: ['.mcp.json'] })]),
      permissions: core.permissions,
      events: core.events,
      installSettings: core.installSettings,
      projectTrusted: () => trust.current,
    });
    trust.current = false;
    again.sendMessage(workspace.id, session.id, 'again');
    await again.settled();
    expect(agent.reopens).toEqual([]);
    expect(agent.starts).toHaveLength(1);
    expect(JSON.stringify(streamOf(core, session.id))).toContain(projectNotTrustedReason('Fixed Agent'));
    trust.current = true;
    again.sendMessage(workspace.id, session.id, 'once more');
    await again.settled();
    expect(agent.reopens).toHaveLength(1);
  });

  it('an agent that does not need trust is never asked', async () => {
    const { chat, agent, workspace } = setUp({ trust: { current: false } });
    const session = await chat.createChatSession(workspace.id, { agentId: AGENT });
    chat.sendMessage(workspace.id, session.id, 'hi');
    await chat.settled();
    expect(agent.starts).toHaveLength(1);
  });
});

describe('the trust is bound to the agent files too (12.3)', () => {
  /** A fingerprint over the named files' contents, as the adapter does (here: `name=content` lines). */
  function trustCore(files: () => string[], contents: Map<string, string>) {
    return openTestCore(tempDir(), undefined, {
      bmadCatalog: undefined,
      agentProjectFiles: files,
      projectFilesFingerprint: async (_repo, names) => (names.some((name) => contents.get(name) === 'unreadable') ? undefined : names.map((name) => `${name}=${contents.get(name) ?? 'absent'}`).join('|') || 'none'),
    });
  }

  it('trusted agents start only while the agent files are as allowed; a change asks again, trusting allows them as they are', async () => {
    const contents = new Map([['.mcp.json', '{}']]);
    const core = trustCore(() => ['.mcp.json'], contents);
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    expect(await core.bmadScriptTrust.trustedForAgents(workspace.id)).toBe(false);
    const before = core.events.lastSeq();
    await core.bmadScriptTrust.trustScripts(workspace.id);
    await core.bmadScriptTrust.trustScripts(workspace.id);
    expect(core.events.readAfter(before).map((event) => event.type)).toEqual(['workspace.bmad_scripts_trusted']);
    expect(await core.bmadScriptTrust.trustedForAgents(workspace.id)).toBe(true);
    contents.set('.mcp.json', '{"mcpServers":{"x":{}}}');
    expect(await core.bmadScriptTrust.trustedForAgents(workspace.id)).toBe(false);
    // The Board's own check is not affected by the agent files.
    expect(await core.bmadScriptTrust.scriptsUnchanged(workspace.id)).toBe(true);
    await core.bmadScriptTrust.trustScripts(workspace.id);
    expect(core.events.readAfter(before).map((event) => event.type)).toEqual(['workspace.bmad_scripts_trusted', 'workspace.bmad_scripts_trusted']);
    expect(await core.bmadScriptTrust.trustedForAgents(workspace.id)).toBe(true);
  });

  it('a file that appears, or can no longer be read, counts as changed; an unreadable fingerprint never trusts', async () => {
    const contents = new Map<string, string>();
    const core = trustCore(() => ['.mcp.json'], contents);
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    await core.bmadScriptTrust.trustScripts(workspace.id);
    expect(await core.bmadScriptTrust.trustedForAgents(workspace.id)).toBe(true);
    contents.set('.mcp.json', 'now there');
    expect(await core.bmadScriptTrust.trustedForAgents(workspace.id)).toBe(false);
    contents.set('.mcp.json', 'unreadable');
    expect(await core.bmadScriptTrust.trustedForAgents(workspace.id)).toBe(false);
  });

  it('a project trusted before the agent files were bound is asked again for agents, once, and the Board is not', async () => {
    const dataDir = tempDir();
    const first = openTestCore(dataDir);
    const workspace = first.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    await first.bmadScriptTrust.trustScripts(workspace.id);
    first.close();
    // The old row: trusted, scripts fingerprint stored, no agent-files fingerprint (as before the column).
    const sqlite = new Sqlite(join(dataDir, DATABASE_FILE));
    sqlite.prepare('UPDATE workspaces SET agent_files_fingerprint = NULL').run();
    sqlite.close();
    const reopened = openTestCore(dataDir, undefined, { agentProjectFiles: () => [], projectFilesFingerprint: async () => 'none' });
    expect(reopened.bmadScriptTrust.scriptsTrusted(workspace.id)).toBe(true);
    expect(await reopened.bmadScriptTrust.scriptsUnchanged(workspace.id)).toBe(true);
    expect(await reopened.bmadScriptTrust.trustedForAgents(workspace.id)).toBe(false);
    await reopened.bmadScriptTrust.trustScripts(workspace.id);
    expect(await reopened.bmadScriptTrust.trustedForAgents(workspace.id)).toBe(true);
  });

});

