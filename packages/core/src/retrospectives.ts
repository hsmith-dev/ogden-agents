/**
 * Retrospectives (CAP-13, epic 7; story 7.1 is the tracer): looking back on
 * an epic from the board. A look-back is a chat session of kind `planning`
 * (AD-8) whose first message is the agent adapter's invocation of the
 * project's retrospective skill (`AgentPort.skillInvocation`) on the epic's
 * folder; from then on it is an ordinary chat in which BMad Method's own
 * skill reads the epic's evidence and writes `epic-<slug>-retrospective.md`
 * beside it. Ogden Agents writes none of it (E7-R4) and never starts a
 * look-back by itself.
 *
 * The use-case serves the `retrospectives` piece and calls core's guard
 * first (AD-22), so a project with Retrospectives off is never read. It
 * reads the board (`BoardUseCases.tickets`: Board is on, the project's
 * scripts are trusted and unchanged, BMad Method is set up) to learn the
 * epic's folder, never from request input beyond the epic's name. Core
 * names no skill (AD-12): the skill's name is the wiring's.
 */
import {
  EPIC_SLUG_PATTERN,
  LOOK_BACK_LABEL,
  RepoRelativePath,
  type Session,
  type WorkspaceId,
} from '@ogden-agents/shared';
import type { AgentPort } from './agent-port.js';
import type { BmadCatalogPort } from './bmad-catalog-port.js';
import type { BmadFeatures } from './bmad-pieces.js';
import type { BoardUseCases } from './board.js';
import type { Chat } from './chat/types.js';
import type { Entities } from './entities.js';
import { NotFoundError, ValidationError } from './errors.js';
import { insideOutputFolder } from './planning-documents.js';
import { workspaceRepoPath } from './planning.js';

export interface RetrospectiveUseCases {
  /**
   * Starts a look-back on the epic whose folder name is `epic`: a new
   * `planning` session whose first message invokes the retrospective skill
   * on the epic's folder (repo-relative). `FeatureOffError` with
   * Retrospectives off, `ValidationError` for a malformed name,
   * `NotFoundError` for an epic the board doesn't have, a project whose
   * BMad Method lacks the skill, or an unknown workspace; the board's own
   * refusals (`ScriptsNotTrustedError`, `TicketsUnavailableError`, …) pass
   * through. Nothing is created in each case.
   */
  lookBack(workspaceId: WorkspaceId, epic: string): Promise<Session>;
}

export interface RetrospectiveDeps {
  bmad: Pick<BmadFeatures, 'requireBmadFeature'>;
  entities: Pick<Entities, 'getWorkspace'>;
  /** The board's tree: where the epics and the initiative's folder come from. */
  board: Pick<BoardUseCases, 'tickets'>;
  catalog: Pick<BmadCatalogPort, 'catalog' | 'setupStatus'>;
  chat: Pick<Chat, 'createChatSession' | 'sendMessage'>;
  /** The agent whose syntax a look-back's first message uses when {@link agentOf} names none. */
  agent: Pick<AgentPort, 'skillInvocation'>;
  /** The agent a session runs (epic 6 entry 8), so its first message is in that agent's own syntax (AD-12). */
  agentOf?: ((session: Session) => Pick<AgentPort, 'skillInvocation'> | undefined) | undefined;
  /** The retrospective skill's name (the bmad-catalog adapter's data, never core's: AD-12). */
  skill: string;
}

/** The epic's folder, repo-relative: `<output folder>/<initiative folder>/<epic>`, or `undefined` when any part isn't one safe name. */
function epicFolder(outputFolder: string | null, initiative: string | null, epic: string): string | undefined {
  if (outputFolder === null || initiative === null || !EPIC_SLUG_PATTERN.test(initiative) || !EPIC_SLUG_PATTERN.test(epic)) return undefined;
  const base = outputFolder.split('/').filter((segment) => segment !== '' && segment !== '.');
  const path = [...base, initiative, epic].join('/');
  if (!RepoRelativePath.safeParse(path).success || !insideOutputFolder(path, outputFolder)) return undefined;
  return path;
}

export function createRetrospectives({ bmad, entities, board, catalog, chat, agent, agentOf, skill }: RetrospectiveDeps): RetrospectiveUseCases {
  return {
    async lookBack(workspaceId, epic) {
      bmad.requireBmadFeature(workspaceId, 'retrospectives');
      if (typeof epic !== 'string' || !EPIC_SLUG_PATTERN.test(epic)) {
        throw new ValidationError('That is not the name of an epic.', [{ path: ['epic'], message: 'That is not the name of an epic.' }]);
      }
      // The board's guards run here (Board, the script trust, the pinned BMad Method, `_bmad/`): the tree names the epics.
      const tree = await board.tickets(workspaceId);
      if (!tree.epics.some((each) => each.slug === epic)) throw new NotFoundError('epic', epic);
      const repoPath = workspaceRepoPath(entities, workspaceId);
      const { outputFolder } = await catalog.setupStatus(repoPath);
      const folder = epicFolder(outputFolder, tree.folder, epic);
      if (folder === undefined) throw new NotFoundError('epic', epic);
      const { skills } = await catalog.catalog(repoPath);
      if (!skills.some((candidate) => candidate.name === skill)) throw new NotFoundError('skill', skill);
      // Checked again after the (async) reads: a Retrospectives turned off meanwhile starts nothing.
      bmad.requireBmadFeature(workspaceId, 'retrospectives');
      const session = await chat.createChatSession(workspaceId, { kind: 'planning', autoTitle: `${LOOK_BACK_LABEL}, ${epic}` });
      chat.sendMessage(workspaceId, session.id, (agentOf?.(session) ?? agent).skillInvocation(skill, folder));
      return session;
    },
  };
}
