/**
 * Document cards (CAP-6, E4-R6; story 4.7): when a `planning` session's write
 * tool call completes, each diff path that lies in the project's output
 * folder (from `BmadCatalogPort.setupStatus`) and ends in `.md` is a BMad
 * Method document the session wrote, and `session.document_written` is
 * appended for it with the next suggested step of the skill that started
 * the session (the catalog's `next`, so only an installed skill).
 *
 * The session's skill is the catalog skill whose
 * `AgentPort.skillInvocation(name)` the session's first user message equals
 * or starts with plus a space (the longest such match), read from the stored
 * messages, so it survives a restart. Only while Planning is on (core's
 * guard, checked before and after the reads); a refusal or failure appends
 * nothing and is told to `onError`, for the log. The checks here are
 * lexical: core reads no file (the document route's read is the adapter's,
 * confined to the real folders).
 */
import { relative, isAbsolute, posix, win32 } from 'node:path';
import { RepoRelativePath, type CatalogNext, type Catalog, type Session, type SessionId, type WorkspaceId } from '@ogden-agents/shared';
import type { AgentPort } from './agent-port.js';
import type { BmadCatalogPort } from './bmad-catalog-port.js';
import type { BmadFeatures } from './bmad-pieces.js';
import type { Entities } from './entities.js';
import type { SessionEvents } from './session-events.js';

/** The file ending a document must have. */
export const DOCUMENT_EXTENSION = '.md';

/** The longest document path taken, in characters: the path reaches the card and the next session's prompt. */
export const MAX_DOCUMENT_PATH_LENGTH = 512;

/** The most documents one tool call can add cards for. */
export const MAX_DOCUMENTS_PER_CALL = 20;

/** Control characters (newlines included) and format characters (bidi overrides, zero-width): never in a document path. */
const UNSAFE_PATH_CHARACTERS = /[\p{Cc}\p{Cf}]/u;

/**
 * `path` as a document path when it is a valid repo-relative path
 * (`RepoRelativePath`), at most {@link MAX_DOCUMENT_PATH_LENGTH} characters
 * with no control or format character, with no empty or `.` segment, ending
 * in {@link DOCUMENT_EXTENSION}; `undefined` otherwise. The path is the
 * agent's: it goes into the event, the card and the next step's idea.
 */
export function documentPath(path: unknown): string | undefined {
  if (typeof path !== 'string' || path.length > MAX_DOCUMENT_PATH_LENGTH || UNSAFE_PATH_CHARACTERS.test(path)) return undefined;
  if (!RepoRelativePath.safeParse(path).success) return undefined;
  const segments = path.split('/');
  if (segments.some((segment) => segment === '' || segment === '.')) return undefined;
  const name = segments.at(-1)!;
  if (!name.endsWith(DOCUMENT_EXTENSION) || name.length === DOCUMENT_EXTENSION.length) return undefined;
  return path;
}

/** The output folder's segments (`_bmad-output` → `['_bmad-output']`), `.` and empty ones dropped; `undefined` when it is not a repo-relative path. */
function folderSegments(outputFolder: string): string[] | undefined {
  if (!RepoRelativePath.safeParse(outputFolder).success) return undefined;
  return outputFolder.split('/').filter((segment) => segment !== '' && segment !== '.');
}

/** Whether the document path `path` lies inside `outputFolder` (both repo-relative), lexically. */
export function insideOutputFolder(path: string, outputFolder: string): boolean {
  const folder = folderSegments(outputFolder);
  if (folder === undefined) return false;
  const segments = path.split('/');
  return segments.length > folder.length && folder.every((segment, index) => segments[index] === segment);
}

/**
 * A tool call's diff path relative to the repo, `/`-separated: an absolute
 * path relative to the first of `roots` (the workspace's real path, then the
 * path it was opened with) it lies inside; a relative path as it is, taken
 * relative to the repo. `undefined` when it is outside every root.
 */
export function repoRelativeOf(path: string, roots: readonly string[]): string | undefined {
  if (typeof path !== 'string' || path === '') return undefined;
  const absolute = isAbsolute(path) || posix.isAbsolute(path) || win32.isAbsolute(path);
  if (!absolute) return path.replaceAll('\\', '/');
  for (const root of roots) {
    if (root === '') continue;
    const rel = relative(root, path);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) continue;
    return rel.replaceAll('\\', '/');
  }
  return undefined;
}

/**
 * The skill a planning session was started on: the catalog skill whose
 * invocation the first user message equals or starts with plus a space, the
 * longest such invocation; `undefined` when none matches.
 */
export function sessionSkill(firstMessage: string | undefined, skills: Catalog['skills'], agent: Pick<AgentPort, 'skillInvocation'>): Catalog['skills'][number] | undefined {
  if (firstMessage === undefined) return undefined;
  let found: { skill: Catalog['skills'][number]; length: number } | undefined;
  for (const skill of skills) {
    const invocation = agent.skillInvocation(skill.name);
    if (firstMessage !== invocation && !firstMessage.startsWith(`${invocation} `)) continue;
    // The longest match: the invocation that covers most of the message.
    if (found === undefined || invocation.length > found.length) found = { skill, length: invocation.length };
  }
  return found?.skill;
}

/** Why a completed write appended nothing (for the log). */
export type PlanningDocumentsStep = 'feature_off' | 'no_output_folder' | 'failed';

export interface PlanningDocumentsDeps {
  bmad: Pick<BmadFeatures, 'requireBmadFeature'>;
  entities: Pick<Entities, 'getWorkspace' | 'getSession' | 'listCompletedMessages'>;
  catalog: Pick<BmadCatalogPort, 'catalog' | 'setupStatus'>;
  agent: Pick<AgentPort, 'skillInvocation'>;
  /** The agent a session runs (epic 6 entry 8), whose syntax its first message is in; `undefined`: {@link agent}. */
  agentOf?: ((session: Session) => Pick<AgentPort, 'skillInvocation'> | undefined) | undefined;
  sessionEvents: Pick<SessionEvents, 'appendSessionEvent'>;
  /** Told why a write appended nothing (Planning off, no output folder, a failure), for the log. Never a path. */
  onError?: (sessionId: SessionId, step: PlanningDocumentsStep, error?: unknown) => void;
}

export interface PlanningDocuments {
  /**
   * A tool call of `sessionId` turned `completed` (`ChatOptions.onToolCallCompleted`):
   * appends `session.document_written` for each of its diff paths that is a
   * document in the output folder, after the reads it needs (fire and forget).
   */
  toolCallCompleted(sessionId: SessionId, toolCallId: string, diffs: ReadonlyArray<{ path: string }> | undefined): void;
  /** Resolves once every detection under way has ended (tests, shutdown). */
  settled(): Promise<void>;
}

export function createPlanningDocuments({ bmad, entities, catalog, agent, agentOf, sessionEvents, onError }: PlanningDocumentsDeps): PlanningDocuments {
  const running = new Set<Promise<void>>();
  const tell = (sessionId: SessionId, step: PlanningDocumentsStep, error?: unknown) => {
    try {
      onError?.(sessionId, step, error);
    } catch {
      // Logging never changes the outcome.
    }
  };
  /** The guard, as a step: `false` (told) when Planning is off or unavailable. */
  const planningOn = (sessionId: SessionId, workspaceId: WorkspaceId): boolean => {
    try {
      bmad.requireBmadFeature(workspaceId, 'planning');
      return true;
    } catch (error) {
      tell(sessionId, 'feature_off', error);
      return false;
    }
  };

  const detect = async (sessionId: SessionId, toolCallId: string, paths: readonly string[]): Promise<void> => {
    const session = entities.getSession(sessionId);
    if (session === undefined || session.kind !== 'planning') return;
    const workspace = entities.getWorkspace(session.workspaceId);
    if (workspace?.realPath === undefined) return;
    // Lexical first: a write outside the repo, or no Markdown file, needs no read at all.
    const roots = [workspace.realPath, workspace.path];
    const candidates = [...new Set(paths.flatMap((path) => documentPath(repoRelativeOf(path, roots)) ?? []))];
    if (candidates.length === 0) return;
    if (!planningOn(sessionId, workspace.id)) return;
    const status = await catalog.setupStatus(workspace.realPath);
    if (status.outputFolder === null) {
      tell(sessionId, 'no_output_folder');
      return;
    }
    // At most MAX_DOCUMENTS_PER_CALL cards for one call, however many files it names.
    const documents = candidates.filter((path) => insideOutputFolder(path, status.outputFolder!)).slice(0, MAX_DOCUMENTS_PER_CALL);
    if (documents.length === 0) return;
    const { skills } = await catalog.catalog(workspace.realPath);
    const first = entities.listCompletedMessages(sessionId).find((message) => message.role === 'user')?.content;
    const named: CatalogNext | null = sessionSkill(first, skills, agentOf?.(session) ?? agent)?.next ?? null;
    // Only a next step whose skill is installed (the catalog already drops others; checked again here).
    const next = named !== null && skills.some((skill) => skill.name === named.skill) ? { skill: named.skill, label: named.label } : null;
    // Checked again after the (async) reads: a Planning turned off meanwhile appends nothing.
    if (!planningOn(sessionId, workspace.id)) return;
    for (const path of documents) {
      sessionEvents.appendSessionEvent(sessionId, {
        type: 'session.document_written',
        payload: { path, toolCallId: toolCallId === '' ? null : toolCallId, next },
      });
    }
  };

  return {
    toolCallCompleted(sessionId, toolCallId, diffs) {
      const paths = (diffs ?? []).map((diff) => diff.path).filter((path): path is string => typeof path === 'string');
      if (paths.length === 0) return;
      const done: Promise<void> = detect(sessionId, toolCallId, paths)
        .catch((error: unknown) => tell(sessionId, 'failed', error))
        .finally(() => running.delete(done));
      running.add(done);
    },

    async settled() {
      while (running.size > 0) await Promise.all([...running]);
    },
  };
}
