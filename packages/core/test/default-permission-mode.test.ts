/**
 * Default permission mode: each project has a mode its new chats start in
 * (Ask, Auto or Skip all), set in its settings, and new projects copy the
 * app-wide default. Skip all as a default needs Developer mode and the
 * user's confirmation, server-side; turning Developer mode off drops every
 * Skip all default to Ask with a notice. A chat whose agent doesn't offer the
 * default starts in Ask with a note. No real agent runs: in-memory ports.
 */
import type { CoreEvent, PermissionMode, SessionId, WorkspaceId } from '@ogden-agents/shared';
import { DEFAULT_MODE_NOTICE_TEXT, SessionCreatedEvent } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { startingMode } from '../src/chat/workspaces.js';
import {
  ConfirmationRequiredError,
  createAddProject,
  createAgentRegistry,
  createChat,
  createNewProjectDefaults,
  DeveloperModeRequiredError,
  type AgentPort,
  type AgentSession,
  type Core,
} from '../src/index.js';
import { openTestCore, registered, tempDir } from './helpers.js';

/** An agent that declares `declares` and never runs a prompt (no test here sends one). */
function quietAgent(name: string, declares: readonly PermissionMode[]): AgentPort {
  const open = (agentSessionId: string): AgentSession => ({
    agentSessionId,
    permissionModes: declares,
    prompt: async () => ({ stopReason: 'end_turn' }),
    async cancel() {},
    async close() {},
    onEvent: () => () => {},
    async setPermissionMode() {},
  });
  return {
    displayName: name,
    permissionModes: declares,
    skillInvocation: (skill) => `/${skill}`,
    listAuthMethods: async () => [],
    startSession: async () => open(`${name}-1`),
    reopenSession: async (input) => ({ session: open(input.agentSessionId), restored: 'resumed' }),
  };
}

function setUp(core: Core = openTestCore()) {
  const agents = createAgentRegistry(
    [registered('first-agent', quietAgent('First Agent', ['ask', 'auto', 'skip_all'])), registered('second-agent', quietAgent('Second Agent', ['ask', 'skip_all']))],
    { legacyAgentId: 'first-agent' },
  );
  const chat = createChat({
    dataDir: tempDir('ogden-agents-data-'),
    entities: core.entities,
    sessionEvents: core.sessionEvents,
    agents,
    agentEnv: () => ({}),
    events: core.events,
    installSettings: core.installSettings,
    permissions: core.permissions,
  });
  const workspace = chat.openWorkspace(tempDir('ogden-agents-repo-'));
  return { core, chat, workspace };
}

const settingsEvents = (core: Core, workspaceId: WorkspaceId) =>
  core.events.readAfter(0).filter((event): event is Extract<CoreEvent, { type: 'workspace.settings_changed' }> => event.type === 'workspace.settings_changed' && event.streamId === workspaceId);

/** The `session.created` of a session, parsed as the UI reads it. */
const createdOf = (core: Core, sessionId: SessionId) => SessionCreatedEvent.parse(core.events.readAfter(0).find((event) => event.type === 'session.created' && event.streamId === sessionId));

describe("a project's default permission mode", () => {
  it('reads as Ask until the user chooses one, and each choice is one event', () => {
    const { core, workspace } = setUp();
    expect(core.permissions.getSettings(workspace.id).defaultPermissionMode ?? 'ask').toBe('ask');
    const saved = core.permissions.updateSettings(workspace.id, { defaultPermissionMode: 'auto' });
    expect(saved.defaultPermissionMode).toBe('auto');
    expect(settingsEvents(core, workspace.id).at(-1)?.payload).toMatchObject({ defaultPermissionMode: 'auto', previousDefaultPermissionMode: 'ask', defaultPermissionModeCause: 'user' });
    const count = settingsEvents(core, workspace.id).length;
    core.permissions.updateSettings(workspace.id, { defaultPermissionMode: 'auto' });
    expect(settingsEvents(core, workspace.id)).toHaveLength(count);
  });

  it('refuses Skip all without Developer mode or without the confirmation, writing nothing', () => {
    const { core, workspace } = setUp();
    const before = core.events.readAfter(0).length;
    expect(() => core.permissions.updateSettings(workspace.id, { defaultPermissionMode: 'skip_all', confirm: true })).toThrow(DeveloperModeRequiredError);
    core.installSettings.setDeveloperMode(true);
    const afterOn = core.events.readAfter(0).length;
    expect(afterOn).toBe(before + 1);
    expect(() => core.permissions.updateSettings(workspace.id, { defaultPermissionMode: 'skip_all' })).toThrow(ConfirmationRequiredError);
    expect(() => core.permissions.updateSettings(workspace.id, { defaultPermissionMode: 'skip_all', confirm: 'yes' })).toThrow(ConfirmationRequiredError);
    expect(core.events.readAfter(0)).toHaveLength(afterOn);
    expect(core.permissions.getSettings(workspace.id).defaultPermissionMode).toBeUndefined();
  });

  it("records the user's confirmation of Skip all for the project as an event", () => {
    const { core, workspace } = setUp();
    core.installSettings.setDeveloperMode(true);
    expect(core.permissions.updateSettings(workspace.id, { defaultPermissionMode: 'skip_all', confirm: true }).defaultPermissionMode).toBe('skip_all');
    expect(settingsEvents(core, workspace.id).at(-1)?.payload).toMatchObject({ defaultPermissionMode: 'skip_all', skipAllConfirmed: true, defaultPermissionModeCause: 'user' });
  });
});

describe('a new chat starts in its project default', () => {
  it('starts in Auto with a note when its agent offers Auto, and so does a planning session', async () => {
    const { core, chat, workspace } = setUp();
    core.permissions.updateSettings(workspace.id, { defaultPermissionMode: 'auto' });
    const session = await chat.createChatSession(workspace.id, { agentId: 'first-agent' });
    expect(session.permissionMode).toBe('auto');
    expect(core.entities.getSession(session.id)?.permissionMode).toBe('auto');
    expect(createdOf(core, session.id).payload).toMatchObject({ session: { permissionMode: 'auto' }, permissionModeNote: "This chat started in Auto, this project's default." });
    expect((await chat.createChatSession(workspace.id, { kind: 'planning' })).permissionMode).toBe('auto');
  });

  it("starts in Ask with a note naming the agent when it doesn't offer the default", async () => {
    const { core, chat, workspace } = setUp();
    core.permissions.updateSettings(workspace.id, { defaultPermissionMode: 'auto' });
    const session = await chat.createChatSession(workspace.id, { agentId: 'second-agent' });
    expect(session.permissionMode).toBe('ask');
    expect(createdOf(core, session.id).payload.permissionModeNote).toBe("Second Agent doesn't offer Auto, so this chat started in Ask instead of this project's default.");
  });

  it('starts in Ask with no note in a project with no default, as before', async () => {
    const { core, chat, workspace } = setUp();
    const session = await chat.createChatSession(workspace.id);
    expect(session.permissionMode).toBe('ask');
    expect(createdOf(core, session.id).payload.permissionModeNote).toBeUndefined();
  });

  it('starts in Skip all from a confirmed default; Developer mode off drops the default and the chats to Ask', async () => {
    const { core, chat, workspace } = setUp();
    const other = chat.openWorkspace(tempDir('ogden-agents-repo-'));
    core.installSettings.setDeveloperMode(true);
    core.permissions.updateSettings(workspace.id, { defaultPermissionMode: 'skip_all', confirm: true });
    core.permissions.updateSettings(other.id, { defaultPermissionMode: 'auto' });
    const skipping = await chat.createChatSession(workspace.id, { agentId: 'second-agent' });
    expect(skipping.permissionMode).toBe('skip_all');

    const change = core.installSettings.setDeveloperMode(false);
    expect(change.defaultsDropped).toBe(1);
    expect(core.entities.getSession(skipping.id)?.permissionMode).toBe('ask');
    expect(core.permissions.getSettings(workspace.id)).toMatchObject({ defaultPermissionMode: 'ask', defaultPermissionModeNotice: 'developer_mode_off' });
    expect(core.permissions.getSettings(other.id)).toMatchObject({ defaultPermissionMode: 'auto' });
    expect(settingsEvents(core, workspace.id).at(-1)?.payload).toMatchObject({ defaultPermissionMode: 'ask', previousDefaultPermissionMode: 'skip_all', defaultPermissionModeCause: 'developer_mode_off' });

    // A chat created now never starts in Skip all; the user's next choice clears the notice.
    expect((await chat.createChatSession(workspace.id)).permissionMode).toBe('ask');
    expect(core.permissions.updateSettings(workspace.id, { defaultPermissionMode: 'ask' }).defaultPermissionModeNotice).toBeUndefined();
  });

  it('a server restart sets existing chats back to Ask, and a chat created after it starts in the default', async () => {
    const { core, chat, workspace } = setUp();
    core.permissions.updateSettings(workspace.id, { defaultPermissionMode: 'auto' });
    const before = await chat.createChatSession(workspace.id);
    expect(core.entities.resetPermissionModes().map((session) => session.id)).toEqual([before.id]);
    expect(core.entities.getSession(before.id)?.permissionMode).toBe('ask');
    expect((await chat.createChatSession(workspace.id)).permissionMode).toBe('auto');
  });
});

describe('unattended builds', () => {
  it("don't use the project's default: a build session starts in Ask", () => {
    const { core, workspace } = setUp();
    core.installSettings.setDeveloperMode(true);
    core.permissions.updateSettings(workspace.id, { defaultPermissionMode: 'skip_all', confirm: true });
    expect(core.entities.createSession({ workspaceId: workspace.id, kind: 'build' }).permissionMode).toBe('ask');
  });
});

describe('the starting mode', () => {
  const base = { agentName: 'First Agent', declared: ['ask', 'auto', 'skip_all'] as const, listed: undefined, developerMode: true };
  it("falls back to Ask when the agent's sessions on this computer left the mode out", () => {
    expect(startingMode({ ...base, projectDefault: 'auto', listed: ['ask'] })).toEqual({
      mode: 'ask',
      note: "First Agent on this computer doesn't offer Auto, so this chat started in Ask instead of this project's default.",
    });
  });
  it('never starts in Skip all without Developer mode', () => {
    expect(startingMode({ ...base, projectDefault: 'skip_all', developerMode: false }).mode).toBe('ask');
    expect(startingMode({ ...base, projectDefault: 'skip_all' }).mode).toBe('skip_all');
  });
  it('treats an agent that declares no modes as Ask only', () => {
    expect(startingMode({ ...base, projectDefault: 'auto', declared: undefined }).mode).toBe('ask');
  });
});

describe('the app-wide default for new projects', () => {
  function store(core: Core) {
    const dataDir = tempDir('ogden-agents-data-');
    return createNewProjectDefaults({ dataDir, bmad: { isAvailable: () => false }, developerMode: core.installSettings.developerMode });
  }

  it('refuses Skip all without Developer mode or the confirmation; Auto needs neither', () => {
    const core = openTestCore();
    const defaults = store(core);
    expect(() => defaults.set({ defaultPermissionMode: 'skip_all', confirm: true })).toThrow(DeveloperModeRequiredError);
    core.installSettings.setDeveloperMode(true);
    expect(() => defaults.set({ defaultPermissionMode: 'skip_all' })).toThrow(ConfirmationRequiredError);
    expect(defaults.get().defaultPermissionMode).toBeUndefined();
    expect(defaults.set({ defaultPermissionMode: 'auto' }).defaultPermissionMode).toBe('auto');
    // A save that leaves the mode out keeps it.
    expect(defaults.set({ bmadPieces: [] }).defaultPermissionMode).toBe('auto');
  });

  it('copies Auto to a new project; Skip all reaches it as Ask waiting for confirmation', async () => {
    const { core, chat } = setUp();
    const defaults = store(core);
    const add = createAddProject({ chat, defaults });
    defaults.set({ defaultPermissionMode: 'auto' });
    expect(core.permissions.getSettings(add.addProject(tempDir('ogden-agents-repo-')).id).defaultPermissionMode).toBe('auto');

    core.installSettings.setDeveloperMode(true);
    defaults.set({ defaultPermissionMode: 'skip_all', confirm: true });
    const project = add.addProject(tempDir('ogden-agents-repo-'));
    expect(core.permissions.getSettings(project.id)).toMatchObject({ defaultPermissionMode: 'ask', defaultPermissionModeNotice: 'skip_all_unconfirmed' });
    const waiting = await chat.createChatSession(project.id);
    expect(waiting.permissionMode).toBe('ask');
    expect(createdOf(core, waiting.id).payload.permissionModeNote).toBe(DEFAULT_MODE_NOTICE_TEXT.skip_all_unconfirmed);

    // Confirmed once for this project: its new chats start in Skip all.
    expect(core.permissions.updateSettings(project.id, { defaultPermissionMode: 'skip_all', confirm: true })).toMatchObject({ defaultPermissionMode: 'skip_all' });
    expect(core.permissions.getSettings(project.id).defaultPermissionModeNotice).toBeUndefined();
    expect((await chat.createChatSession(project.id)).permissionMode).toBe('skip_all');
  });

  it('reads Skip all as Ask while Developer mode is off, and is set back to Ask when it is turned off', () => {
    const core = openTestCore();
    const defaults = store(core);
    core.installSettings.setDeveloperMode(true);
    defaults.set({ defaultPermissionMode: 'skip_all', confirm: true });
    expect(defaults.get().defaultPermissionMode).toBe('skip_all');
    core.installSettings.setDeveloperMode(false);
    expect(defaults.get().defaultPermissionMode).toBeUndefined();
    expect(defaults.dropSkipAll()).toBe(true);
    core.installSettings.setDeveloperMode(true);
    expect(defaults.get().defaultPermissionMode).toBe('ask');
    expect(defaults.dropSkipAll()).toBe(false);
  });

  it('refuses Skip all every time it is asked for, even when the file still holds it', () => {
    const core = openTestCore();
    const defaults = store(core);
    core.installSettings.setDeveloperMode(true);
    defaults.set({ defaultPermissionMode: 'skip_all', confirm: true });
    core.installSettings.setDeveloperMode(false);
    // The file still says Skip all (its rewrite is the route's, after core's transaction).
    expect(() => defaults.set({ defaultPermissionMode: 'skip_all' })).toThrow(DeveloperModeRequiredError);
    core.installSettings.setDeveloperMode(true);
    expect(() => defaults.set({ defaultPermissionMode: 'skip_all' })).toThrow(ConfirmationRequiredError);
  });

  it('a project waiting for Skip all stops waiting when Developer mode is turned off', () => {
    const { core, chat } = setUp();
    const defaults = store(core);
    core.installSettings.setDeveloperMode(true);
    defaults.set({ defaultPermissionMode: 'skip_all', confirm: true });
    const project = createAddProject({ chat, defaults }).addProject(tempDir('ogden-agents-repo-'));
    expect(core.permissions.getSettings(project.id).defaultPermissionModeNotice).toBe('skip_all_unconfirmed');
    core.installSettings.setDeveloperMode(false);
    expect(core.permissions.getSettings(project.id).defaultPermissionModeNotice).toBeUndefined();
    expect(settingsEvents(core, project.id).at(-1)?.payload).toMatchObject({ defaultPermissionModeCause: 'developer_mode_off' });
  });
});
