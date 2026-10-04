/**
 * Where BMad's skills go (epic 6 entry 8, E6-R7): the skills folder of each
 * agent a project with Planning on uses, from the descriptors; nothing for a
 * project with Planning off.
 */
import type { AgentId, WorkspaceId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { createAgentRegistry, createBmadSkillFolders, FeatureOffError, NotFoundError, type AgentPort, type Core } from '../src/index.js';
import { openTestCore, registered, tempDir } from './helpers.js';

const UNKNOWN = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3' as WorkspaceId;

/** A port that is never started: only its name and modes are read. */
const port = (displayName: string): AgentPort => ({
  displayName,
  startSession: () => Promise.reject(new Error('not started in this test')),
  reopenSession: () => Promise.reject(new Error('not started in this test')),
  listAuthMethods: () => Promise.resolve([]),
});

/** The install default first (its folder `.claude/skills`), a second agent (`.agents/skills`), and a third sharing the first's folder. */
const agents = createAgentRegistry([
  registered('first-agent', port('First'), { skillsFolder: '.claude/skills' }),
  registered('second-agent', port('Second'), { skillsFolder: '.agents/skills' }),
  registered('third-agent', port('Third'), { skillsFolder: '.claude/skills' }),
]);

function setUp(planning = true) {
  const core: Core = openTestCore(tempDir(), undefined, { availableBmadPieces: ['planning'] });
  const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
  if (planning) core.permissions.updateSettings(workspace.id, { bmadPieces: ['planning'] });
  const folders = createBmadSkillFolders({
    bmad: core.bmad,
    entities: core.entities,
    projectDefaultAgent: (workspaceId) => core.permissions.getSettings(workspaceId).defaultAgentId,
    agents,
  });
  const chatWith = (agentId?: string) => core.entities.createSession({ workspaceId: workspace.id, kind: 'chat', ...(agentId === undefined ? {} : { agentId: agentId as AgentId }) });
  const setDefault = (agentId: string) => core.permissions.updateSettings(workspace.id, { defaultAgentId: agentId });
  return { core, wsId: workspace.id, folders, chatWith, setDefault };
}

describe('BMad skill folders (epic 6 entry 8)', () => {
  it('refuses a project with Planning off (feature_off) and an unknown project (not_found), reading nothing', () => {
    const { wsId, folders, chatWith } = setUp(false);
    chatWith('second-agent');
    expect(() => folders.skillFolders(wsId)).toThrow(FeatureOffError);
    expect(() => folders.agentsInUse(wsId)).toThrow(FeatureOffError);
    expect(() => folders.skillFolders(UNKNOWN)).toThrow(NotFoundError);
  });

  it("is the install default's folder alone in a project with no chats and no default of its own", () => {
    const { wsId, folders } = setUp();
    expect(folders.agentsInUse(wsId)).toEqual(['first-agent']);
    expect(folders.skillFolders(wsId)).toEqual(['.claude/skills']);
  });

  it("adds the folder of an agent one of its chats was started with, in the registry's order", () => {
    const { wsId, folders, chatWith } = setUp();
    chatWith('second-agent');
    expect(folders.agentsInUse(wsId)).toEqual(['first-agent', 'second-agent']);
    expect(folders.skillFolders(wsId)).toEqual(['.claude/skills', '.agents/skills']);
  });

  it("is the project's own default agent's folder when it has no chats, without the install default's", () => {
    const { wsId, folders, setDefault } = setUp();
    setDefault('second-agent');
    expect(folders.agentsInUse(wsId)).toEqual(['second-agent']);
    expect(folders.skillFolders(wsId)).toEqual(['.agents/skills']);
  });

  it('names a folder two agents share once', () => {
    const { wsId, folders, chatWith } = setUp();
    chatWith('third-agent');
    expect(folders.agentsInUse(wsId)).toEqual(['first-agent', 'third-agent']);
    expect(folders.skillFolders(wsId)).toEqual(['.claude/skills']);
  });

  it('ignores an agent that is not registered (a stored default or a chat), and reads a chat stored before agents as the legacy agent', () => {
    const stale = setUp();
    // A stored default no longer registered: the install's default is what a new chat gets.
    stale.setDefault('gone-agent');
    stale.chatWith('gone-agent');
    expect(stale.folders.agentsInUse(stale.wsId)).toEqual(['first-agent']);
    expect(stale.folders.skillFolders(stale.wsId)).toEqual(['.claude/skills']);

    const legacy = setUp();
    legacy.setDefault('second-agent');
    // No `agentId`: stored before agents could be chosen; the legacy agent is the first registered.
    legacy.chatWith();
    expect(legacy.folders.agentsInUse(legacy.wsId)).toEqual(['first-agent', 'second-agent']);
    expect(legacy.folders.skillFolders(legacy.wsId)).toEqual(['.claude/skills', '.agents/skills']);
  });

  it('follows Planning being turned off again', () => {
    const { core, wsId, folders } = setUp();
    expect(folders.skillFolders(wsId)).toEqual(['.claude/skills']);
    core.permissions.updateSettings(wsId, { bmadPieces: [] });
    expect(() => folders.skillFolders(wsId)).toThrow(FeatureOffError);
  });
});
