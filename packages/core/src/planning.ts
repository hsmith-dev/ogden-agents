/**
 * Guided planning (CAP-6; story 4.1, the tracer): the catalog of a project's
 * installed BMad Method skills, and starting a planning session on one. A
 * planning session is a chat session of kind `planning` (AD-8) whose first
 * message is the agent adapter's invocation of the skill
 * (`AgentPort.skillInvocation`); from then on it is an ordinary chat.
 *
 * Both use-cases serve the `planning` piece and call core's guard first
 * (AD-22), so a project with Planning off is never scanned. The repo is the
 * workspace's stored real path, never request input; a skill must be named
 * as {@link SKILL_NAME_PATTERN} allows and be in the catalog. Core names no
 * skill (AD-12).
 */
import { SKILL_NAME_PATTERN, type CatalogSkill, type Session, type WorkspaceId } from '@ogden-agents/shared';
import type { AgentPort } from './agent-port.js';
import type { BmadCatalogPort } from './bmad-catalog-port.js';
import type { BmadFeatures } from './bmad-features.js';
import type { Chat } from './chat/types.js';
import type { Entities } from './entities.js';
import { NotFoundError, ValidationError } from './errors.js';

export interface PlanningUseCases {
  /**
   * The project's installed skills. `FeatureOffError` with Planning off
   * (nothing is scanned), `NotFoundError` for an unknown workspace.
   */
  catalog(workspaceId: WorkspaceId): Promise<CatalogSkill[]>;
  /**
   * Starts a planning session on `skill`: a new `planning` session whose
   * first message invokes it. `FeatureOffError` with Planning off,
   * `ValidationError` for a malformed name, `NotFoundError` for a skill not
   * in the catalog or an unknown workspace; nothing is created then.
   */
  start(workspaceId: WorkspaceId, skill: string): Promise<Session>;
}

export interface PlanningDeps {
  bmad: Pick<BmadFeatures, 'requireBmadFeature'>;
  entities: Pick<Entities, 'getWorkspace'>;
  catalog: Pick<BmadCatalogPort, 'skills'>;
  chat: Pick<Chat, 'createChatSession' | 'sendMessage'>;
  agent: Pick<AgentPort, 'skillInvocation'>;
}

/** The workspace's stored real path; {@link NotFoundError} for an unknown workspace. */
export function workspaceRepoPath(entities: Pick<Entities, 'getWorkspace'>, workspaceId: WorkspaceId): string {
  const workspace = entities.getWorkspace(workspaceId);
  // `toWorkspace` always sets `realPath`; the shared type keeps it optional only for old events.
  if (workspace?.realPath === undefined) throw new NotFoundError('workspace', workspaceId);
  return workspace.realPath;
}

export function createPlanning({ bmad, entities, catalog, chat, agent }: PlanningDeps): PlanningUseCases {
  const skillsOf = (workspaceId: WorkspaceId) => catalog.skills(workspaceRepoPath(entities, workspaceId));
  return {
    async catalog(workspaceId) {
      bmad.requireBmadFeature(workspaceId, 'planning');
      return skillsOf(workspaceId);
    },

    async start(workspaceId, skill) {
      bmad.requireBmadFeature(workspaceId, 'planning');
      if (typeof skill !== 'string' || !SKILL_NAME_PATTERN.test(skill)) {
        throw new ValidationError('That is not the name of a skill.', [{ path: ['skill'], message: 'That is not the name of a skill.' }]);
      }
      const skills = await skillsOf(workspaceId);
      if (!skills.some((entry) => entry.name === skill)) throw new NotFoundError('skill', skill);
      // Checked again after the (async) scan: a piece turned off meanwhile starts nothing.
      bmad.requireBmadFeature(workspaceId, 'planning');
      const session = chat.createChatSession(workspaceId, 'planning');
      chat.sendMessage(workspaceId, session.id, agent.skillInvocation(skill));
      return session;
    },
  };
}
