/**
 * Where BMad Method's skills go in a project with Planning on (epic 6 entry
 * 8, E6-R7, AD-12, AD-22): the skills folder of every agent the project
 * uses, so setup places the skills where each of those agents looks. An
 * agent is in use when it is the project's default agent (its own, when
 * still registered, else the install's: what a new chat gets) or the agent
 * of any of its sessions (one stored before agents could be chosen is the
 * registry's legacy agent) (user, 2026-10-02). Only registered agents count.
 *
 * Core names no agent and no folder: each folder is its descriptor's
 * `skillsFolder`, which the registry already checked is a plain repo-relative
 * path. A project with Planning off is refused before anything is read, so
 * a Simple project never gets a skill folder (AD-22).
 *
 * BMad setup (epic 4's `bmad-catalog` setup, entry 4.3) asks this when it
 * copies the pinned skills; that wiring lands when epic 6 is rebased onto
 * epic 4.
 */
import type { AgentId, WorkspaceId } from '@ogden-agents/shared';
import { effectiveDefaultAgent, type AgentRegistry } from './agent-port.js';
import type { BmadFeatures } from './bmad-pieces.js';
import type { Entities } from './entities.js';

export interface BmadSkillFoldersOptions {
  /** Core's guard (AD-22). */
  bmad: Pick<BmadFeatures, 'requireBmadFeature'>;
  entities: Pick<Entities, 'listSessions'>;
  /** The project's own default agent, if it has one (workspace settings, entry 6). */
  projectDefaultAgent: (workspaceId: WorkspaceId) => AgentId | undefined;
  /** The agents chats can be started with. */
  agents: Pick<AgentRegistry, 'agentIds' | 'get' | 'describe' | 'defaultAgentId' | 'legacyAgentId'>;
}

export interface BmadSkillFolders {
  /**
   * The repo-relative skills folder of each agent `workspaceId` uses, each
   * once, in the registry's order. `feature_off` when Planning is off,
   * `not_found` for an unknown project; never writes or reads a file.
   */
  skillFolders(workspaceId: WorkspaceId): string[];
  /** The registered agents `workspaceId` uses, in the registry's order (after the same guard). */
  agentsInUse(workspaceId: WorkspaceId): AgentId[];
}

export function createBmadSkillFolders(options: BmadSkillFoldersOptions): BmadSkillFolders {
  const { bmad, entities, projectDefaultAgent, agents } = options;
  const agentsInUse = (workspaceId: WorkspaceId): AgentId[] => {
    bmad.requireBmadFeature(workspaceId, 'planning');
    const registered = (agentId: AgentId | undefined): agentId is AgentId => agentId !== undefined && agents.get(agentId) !== undefined;
    const used = new Set<AgentId>([effectiveDefaultAgent(agents, projectDefaultAgent(workspaceId))]);
    for (const session of entities.listSessions(workspaceId)) {
      const agentId = session.agentId ?? agents.legacyAgentId;
      if (registered(agentId)) used.add(agentId);
    }
    return agents.agentIds.filter((agentId) => used.has(agentId));
  };
  return {
    agentsInUse,
    skillFolders(workspaceId) {
      const folders = agentsInUse(workspaceId).flatMap((agentId) => {
        const folder = agents.describe(agentId)?.skillsFolder;
        return folder === undefined ? [] : [folder];
      });
      return [...new Set(folders)];
    },
  };
}
