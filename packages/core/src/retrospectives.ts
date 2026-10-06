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
  LESSONS_CHECKOUT_BUSY_MESSAGE,
  LESSONS_NO_GIT_MESSAGE,
  VCS_NOT_TOP_LEVEL_MESSAGE,
  LESSONS_NO_AGENTS_FILE_MESSAGE,
  NOTHING_TO_SAVE_MESSAGE,
  RepoRelativePath,
  SKILL_NAME_PATTERN,
  type SaveLessonsResponse,
  type Session,
  type WorkspaceId,
} from '@ogden-agents/shared';
import type { AgentPort } from './agent-port.js';
import type { BmadCatalogPort } from './bmad-catalog-port.js';
import type { BmadFeatures } from './bmad-pieces.js';
import type { BoardUseCases } from './board.js';
import type { Chat } from './chat/types.js';
import type { Entities } from './entities.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AGENTS_FILE } from './build-names.js';
import { BuildRefusedError, LessonsRefusedError, NotFoundError, ReducedModeError, ValidationError } from './errors.js';
import { serializedByRepo } from './repo-serialization.js';
import type { VcsPort } from './vcs-port.js';
import { summaryLine, type BuildSummaries } from './build-summaries.js';
import type { LookBackOffers } from './look-back-offers.js';
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
  /**
   * The epics whose finished-epic offer was dismissed (story 7.2). `FeatureOffError`
   * with Retrospectives off, `NotFoundError` for an unknown workspace.
   */
  dismissedOffers(workspaceId: WorkspaceId): string[];
  /** Not now for `epic`'s offer (story 7.2): as {@link LookBackOffers.dismiss}. */
  dismissOffer(workspaceId: WorkspaceId, epic: string): void;
  /**
   * Starts a planning session on one of the retrospective's next steps, with
   * the epic's retrospective file as its argument (story 7.5; frozen by 7.2).
   * `skill` must be one of the look-back action's next steps in the catalog,
   * else `NotFoundError` (`skill`); `NotFoundError` (`epic`) for an epic the
   * board doesn't have or one with no retrospective yet; `FeatureOffError`,
   * `ValidationError` and the board's refusals as {@link lookBack}.
   */
  startStep(workspaceId: WorkspaceId, epic: string, skill: string): Promise<Session>;
  /**
   * **Save the lessons for later builds** (story 7.5; frozen by 7.2): commits
   * exactly `AGENTS.md` and the epic's retrospective file, locally, never
   * pushed. `LessonsRefusedError` (`nothing_to_save`, `checkout_busy`,
   * `agents_file_missing`) with nothing committed; `BuildRefusedError`
   * (`vcs_unavailable`) for a project that is not a git repository on a branch
   * with a commit; `NotFoundError` for an epic with no retrospective.
   */
  saveLessons(workspaceId: WorkspaceId, epic: string): Promise<SaveLessonsResponse>;
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
  /** Ogden's own run records, for the short summaries the look-back is given (story 7.4). Without it none is given. */
  summaries?: Pick<BuildSummaries, 'forTickets'> | undefined;
  /** The finished-epic offer's Not now (story 7.2). */
  offers: Pick<LookBackOffers, 'dismissed' | 'dismiss'>;
  /** Git, for Save the lessons (story 7.5): one local commit of exactly two paths, never a push. Without it saving answers `vcs_unavailable`. */
  vcs?: Pick<VcsPort, 'head' | 'topLevel' | 'operationInProgress' | 'status' | 'commitPaths'> | undefined;
}

/** One part of the output folder: plain name characters, a leading underscore allowed (`_bmad-output`), never a space, control character or leading dash. */
const OUTPUT_SEGMENT_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** The epic's folder, repo-relative: `<output folder>/<initiative folder>/<epic>`, or `undefined` when any part isn't one safe name. */
export function epicFolderOf(outputFolder: string | null, initiative: string | null, epic: string): string | undefined {
  if (outputFolder === null || initiative === null || !EPIC_SLUG_PATTERN.test(initiative) || !EPIC_SLUG_PATTERN.test(epic)) return undefined;
  const base = outputFolder.split('/').filter((segment) => segment !== '' && segment !== '.');
  // The output folder is the repo's own setting and goes into the first message: each part is one plain name too.
  if (!base.every((segment) => OUTPUT_SEGMENT_PATTERN.test(segment))) return undefined;
  const path = [...base, initiative, epic].join('/');
  if (!RepoRelativePath.safeParse(path).success || !insideOutputFolder(path, outputFolder)) return undefined;
  return path;
}

/** `epic` as a plain epic folder name, or {@link ValidationError}. */
function checkedEpic(epic: unknown): asserts epic is string {
  if (typeof epic !== 'string' || !EPIC_SLUG_PATTERN.test(epic)) {
    throw new ValidationError('That is not the name of an epic.', [{ path: ['epic'], message: 'That is not the name of an epic.' }]);
  }
}

export function createRetrospectives({ bmad, entities, board, catalog, chat, agent, agentOf, summaries, offers, vcs }: RetrospectiveDeps): RetrospectiveUseCases {
  /** The epic's row and retrospective from the board's tree (its guards run), and the repo; `NotFoundError` for an epic the board lacks or one with no retrospective yet. */
  const retrospectiveOf = async (workspaceId: WorkspaceId, epic: string) => {
    const tree = await board.tickets(workspaceId);
    const row = tree.epics.find((each) => each.slug === epic);
    if (row === undefined) throw new NotFoundError('epic', epic);
    const retrospective = row.retrospective;
    // The epic is on the board but has no retrospective yet; its file name must be one plain name too (it reaches an agent's message and a commit).
    if (retrospective === null || !retrospective.path.split('/').every((segment) => OUTPUT_SEGMENT_PATTERN.test(segment))) throw new NotFoundError('retrospective', epic);
    return { tree, retrospective, repoPath: workspaceRepoPath(entities, workspaceId) };
  };

  return {
    async lookBack(workspaceId, epic) {
      bmad.requireBmadFeature(workspaceId, 'retrospectives');
      checkedEpic(epic);
      // The board's guards run here (Board, the script trust, the pinned BMad Method, `_bmad/`): the tree names the epics.
      const tree = await board.tickets(workspaceId);
      if (!tree.epics.some((each) => each.slug === epic)) throw new NotFoundError('epic', epic);
      const repoPath = workspaceRepoPath(entities, workspaceId);
      const { outputFolder } = await catalog.setupStatus(repoPath);
      const folder = epicFolderOf(outputFolder, tree.folder, epic);
      if (folder === undefined) throw new NotFoundError('epic', epic);
      // The look-back is the catalog's epic-scoped action (AD-12: core names no skill); a project without one is in reduced mode.
      const { skills } = await catalog.catalog(repoPath);
      const action = skills.find((candidate) => candidate.scope === 'epic');
      if (action === undefined) throw new ReducedModeError('look_back');
      const refs = new Set(tree.tickets.filter((ticket) => ticket.epic === epic).map((ticket) => ticket.ref));
      const facts = summaries === undefined ? [] : summaries.forTickets(workspaceId, refs);
      // Checked again after the (async) reads: a Retrospectives turned off meanwhile starts nothing.
      bmad.requireBmadFeature(workspaceId, 'retrospectives');
      const session = await chat.createChatSession(workspaceId, { kind: 'planning', autoTitle: `${LOOK_BACK_LABEL}, ${epic}` });
      // The epic's folder, then (only when runs exist) their short summaries; the first line is what names the skill and the epic.
      const argument = facts.length === 0 ? folder : `${folder}\n\nOgden Agents' build records for this epic (short facts, oldest first):\n${facts.map(summaryLine).join('\n')}`;
      chat.sendMessage(workspaceId, session.id, (agentOf?.(session) ?? agent).skillInvocation(action.name, argument));
      return session;
    },

    dismissedOffers: (workspaceId) => offers.dismissed(workspaceId),
    dismissOffer: (workspaceId, epic) => offers.dismiss(workspaceId, epic),

    async startStep(workspaceId, epic, stepSkill) {
      bmad.requireBmadFeature(workspaceId, 'retrospectives');
      checkedEpic(epic);
      if (typeof stepSkill !== 'string' || !SKILL_NAME_PATTERN.test(stepSkill)) {
        throw new ValidationError('That is not the name of a skill.', [{ path: ['skill'], message: 'That is not the name of a skill.' }]);
      }
      const { retrospective, repoPath } = await retrospectiveOf(workspaceId, epic);
      // Only a next step the catalog's look-back action names (AD-12: core names no skill).
      const { skills } = await catalog.catalog(repoPath);
      const action = skills.find((candidate) => candidate.scope === 'epic');
      const step = action?.nexts.find((next) => next.skill === stepSkill);
      if (step === undefined || !skills.some((candidate) => candidate.name === stepSkill)) throw new NotFoundError('skill', stepSkill);
      // Checked again after the (async) reads: a Retrospectives turned off meanwhile starts nothing.
      bmad.requireBmadFeature(workspaceId, 'retrospectives');
      const session = await chat.createChatSession(workspaceId, { kind: 'planning', autoTitle: step.label });
      chat.sendMessage(workspaceId, session.id, (agentOf?.(session) ?? agent).skillInvocation(stepSkill, retrospective.path));
      return session;
    },

    async saveLessons(workspaceId, epic) {
      bmad.requireBmadFeature(workspaceId, 'retrospectives');
      checkedEpic(epic);
      const { retrospective, repoPath } = await retrospectiveOf(workspaceId, epic);
      if (vcs === undefined) throw new BuildRefusedError('vcs_unavailable', LESSONS_NO_GIT_MESSAGE);
      // One commit at a time per repo, with approve's and the plan files' (the checkout moves).
      return serializedByRepo(repoPath, async () => {
        bmad.requireBmadFeature(workspaceId, 'retrospectives');
        if ((await vcs.head(repoPath)) === undefined) throw new BuildRefusedError('vcs_unavailable', LESSONS_NO_GIT_MESSAGE);
        // The project must be the top folder of its repository: git reports and takes paths from there (as builds require).
        if ((await vcs.topLevel(repoPath)) !== repoPath) throw new BuildRefusedError('vcs_unavailable', VCS_NOT_TOP_LEVEL_MESSAGE);
        if (await vcs.operationInProgress(repoPath)) throw new LessonsRefusedError('checkout_busy', LESSONS_CHECKOUT_BUSY_MESSAGE);
        const changed = new Set(await vcs.status(repoPath));
        // The lessons live in the root AGENTS.md: without one on disk there is nothing for a later build to follow (a deleted one is not a lesson).
        if (!existsSync(join(repoPath, AGENTS_FILE))) throw new LessonsRefusedError('agents_file_missing', LESSONS_NO_AGENTS_FILE_MESSAGE);
        // Exactly these two paths, only those with a change, and nothing else the user has changed.
        const paths = [AGENTS_FILE, retrospective.path].filter((path) => changed.has(path) && existsSync(join(repoPath, path)));
        if (paths.length === 0) throw new LessonsRefusedError('nothing_to_save', NOTHING_TO_SAVE_MESSAGE);
        const revision = await vcs.commitPaths(repoPath, paths, `Lessons from the retrospective of ${epic}\n\nSaved in Ogden Agents so later builds follow them.`);
        return { paths, revision };
      });
    },
  };
}
