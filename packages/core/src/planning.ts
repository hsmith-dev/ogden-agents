/**
 * Guided planning (CAP-6; story 4.1, the tracer; story 4.2 freezes the
 * rest): the catalog of a project's installed BMad Method modules, skills
 * and agents, and starting a planning session on a skill, with the user's
 * idea when given ("Start from an idea"). A planning session is a chat
 * session of kind `planning` (AD-8) whose first message is the agent
 * adapter's invocation of the skill (`AgentPort.skillInvocation`); from then
 * on it is an ordinary chat.
 *
 * Both use-cases serve the `planning` piece and call core's guard first
 * (AD-22), so a project with Planning off is never scanned. Planning runs
 * none of the project's own scripts (the catalog only reads files), so it
 * needs no script trust. The repo is the workspace's stored real path,
 * never request input; a skill must be named as {@link SKILL_NAME_PATTERN}
 * allows and be in the catalog. Core names no skill (AD-12).
 */
import {
  DOCUMENT_INVALID_PATH_MESSAGE,
  PlanningIdea,
  SKILL_NAME_PATTERN,
  type BmadPiece,
  type Catalog,
  type PlanningDocument,
  type Session,
  type WorkspaceId,
} from '@ogden-agents/shared';
import type { AgentPort } from './agent-port.js';
import type { BmadCatalogPort } from './bmad-catalog-port.js';
import type { BmadFeatures } from './bmad-pieces.js';
import type { BmadModulesSeen } from './bmad-modules-seen.js';
import type { Chat } from './chat/types.js';
import type { Entities } from './entities.js';
import { FeatureOffError, NotFoundError, ValidationError } from './errors.js';
import { DOCUMENT_PIECES, documentPath, insideOutputFolder } from './planning-documents.js';

/** The pieces that read the catalog: Planning, and Retrospectives for the look-back's epic-scoped action (epic 7). */
const CATALOG_PIECES: readonly BmadPiece[] = ['planning', 'retrospectives'];

/** The catalog a Retrospectives-only project gets: its epic-scoped actions, no entry action, agents or other skills. */
function epicActionsOnly(catalog: Catalog): Catalog {
  return { ...catalog, skills: catalog.skills.filter((skill) => skill.scope === 'epic'), agents: [], entryAction: null };
}

export interface PlanningUseCases {
  /**
   * The project's catalog. `FeatureOffError` with Planning and Retrospectives
   * both off (nothing is scanned); with only Retrospectives on, only the
   * epic-scoped actions, `NotFoundError` for an unknown workspace.
   */
  catalog(workspaceId: WorkspaceId): Promise<Catalog>;
  /**
   * Starts a planning session on `skill`: a new `planning` session whose
   * first message invokes it, with `idea` when given (trimmed, 1 to
   * `MAX_IDEA_LENGTH` characters). `FeatureOffError` with Planning off,
   * `ValidationError` for a malformed name or idea, `NotFoundError` for a
   * skill not in the catalog or an unknown workspace; nothing is created then.
   */
  start(workspaceId: WorkspaceId, skill: string, idea?: string): Promise<Session>;
  /**
   * A Markdown document a planning session wrote (story 4.7), read-only
   * through the catalog port, confined to the project's output folder.
   * `FeatureOffError` with Planning and Retrospectives both off, `ValidationError` for a path that
   * isn't a repo-relative `.md` path inside the output folder (or a project
   * with no output folder), `NotFoundError` when the file is missing or its
   * real path leaves the folder, or for an unknown workspace.
   */
  document(workspaceId: WorkspaceId, path: unknown): Promise<PlanningDocument>;
}

export interface PlanningDeps {
  bmad: Pick<BmadFeatures, 'requireBmadFeature' | 'requireAnyBmadFeature'>;
  entities: Pick<Entities, 'getWorkspace'>;
  catalog: Pick<BmadCatalogPort, 'catalog' | 'setupStatus' | 'readDocument'>;
  chat: Pick<Chat, 'createChatSession' | 'sendMessage'>;
  /** The agent whose syntax a planning session's first message uses when {@link agentOf} names none. */
  agent: Pick<AgentPort, 'skillInvocation'>;
  /**
   * The agent a session runs (epic 6 entry 8: a planning session starts with
   * the project's default agent, which may be Antigravity), so its first
   * message is in that agent's own syntax (AD-12). `undefined`: {@link agent}.
   */
  agentOf?: ((session: Session) => Pick<AgentPort, 'skillInvocation'> | undefined) | undefined;
  /** Fills the catalog's `installedAt` from when each module first appeared (story 4.4). Without it the port's catalog is answered as it is. */
  modulesSeen?: Pick<BmadModulesSeen, 'stamp'>;
}

/** The workspace's stored real path; {@link NotFoundError} for an unknown workspace. */
export function workspaceRepoPath(entities: Pick<Entities, 'getWorkspace'>, workspaceId: WorkspaceId): string {
  const workspace = entities.getWorkspace(workspaceId);
  // `toWorkspace` always sets `realPath`; the shared type keeps it optional only for old events.
  if (workspace?.realPath === undefined) throw new NotFoundError('workspace', workspaceId);
  return workspace.realPath;
}

export function createPlanning({ bmad, entities, catalog, chat, agent, agentOf, modulesSeen }: PlanningDeps): PlanningUseCases {
  /** Whether Planning is on now (the catalog is also read for Retrospectives alone). */
  const planningOn = (workspaceId: WorkspaceId): boolean => {
    try {
      bmad.requireBmadFeature(workspaceId, 'planning');
      return true;
    } catch (error) {
      if (error instanceof FeatureOffError) return false;
      throw error;
    }
  };
  // Rebuilt from the repo on every read (story 4.4): a module copied in shows without a restart.
  const catalogOf = async (workspaceId: WorkspaceId): Promise<Catalog> => {
    const read = await catalog.catalog(workspaceRepoPath(entities, workspaceId));
    if (modulesSeen === undefined) return read;
    // Checked again after the (async) scan: a piece turned off meanwhile records nothing.
    bmad.requireAnyBmadFeature(workspaceId, CATALOG_PIECES);
    return modulesSeen.stamp(workspaceId, read);
  };
  return {
    async catalog(workspaceId) {
      // Planning, or Retrospectives (epic 7): with only Retrospectives on, only the epic-scoped actions are given.
      bmad.requireAnyBmadFeature(workspaceId, CATALOG_PIECES);
      const read = await catalogOf(workspaceId);
      return planningOn(workspaceId) ? read : epicActionsOnly(read);
    },

    async start(workspaceId, skill, idea) {
      bmad.requireBmadFeature(workspaceId, 'planning');
      if (typeof skill !== 'string' || !SKILL_NAME_PATTERN.test(skill)) {
        throw new ValidationError('That is not the name of a skill.', [{ path: ['skill'], message: 'That is not the name of a skill.' }]);
      }
      let checkedIdea: string | undefined;
      if (idea !== undefined) {
        const parsed = PlanningIdea.safeParse(idea);
        if (!parsed.success) {
          const message = parsed.error.issues[0]?.message ?? 'Write your idea first.';
          throw new ValidationError(message, [{ path: ['idea'], message }]);
        }
        checkedIdea = parsed.data;
      }
      const { skills } = await catalogOf(workspaceId);
      const entry = skills.find((candidate) => candidate.name === skill);
      if (entry === undefined) throw new NotFoundError('skill', skill);
      // Checked again after the (async) scan: a piece turned off meanwhile starts nothing.
      bmad.requireBmadFeature(workspaceId, 'planning');
      // The chat is named after the action as the Plan page shows it (backlog story 12: its label, else its description), not its skill invocation.
      const session = await chat.createChatSession(workspaceId, { kind: 'planning', autoTitle: entry.label ?? entry.description ?? entry.name });
      chat.sendMessage(workspaceId, session.id, (agentOf?.(session) ?? agent).skillInvocation(skill, checkedIdea));
      return session;
    },

    async document(workspaceId, path) {
      // Planning, or Retrospectives (story 7.1): a look-back's retrospective opens from its document card too.
      bmad.requireAnyBmadFeature(workspaceId, DOCUMENT_PIECES);
      const refuse = () => new ValidationError(DOCUMENT_INVALID_PATH_MESSAGE, [{ path: ['path'], message: DOCUMENT_INVALID_PATH_MESSAGE }]);
      const checked = documentPath(path);
      if (checked === undefined) throw refuse();
      const repoPath = workspaceRepoPath(entities, workspaceId);
      const { outputFolder } = await catalog.setupStatus(repoPath);
      if (outputFolder === null || !insideOutputFolder(checked, outputFolder)) throw refuse();
      // Checked again after the (async) read of the status: a piece turned off meanwhile reads nothing.
      bmad.requireAnyBmadFeature(workspaceId, DOCUMENT_PIECES);
      const read = await catalog.readDocument(repoPath, outputFolder, checked);
      if (read === null) throw new NotFoundError('document', checked);
      return { path: checked, content: read.content, truncated: read.truncated };
    },
  };
}
