/**
 * The Workbench routes' shared answers (epic 8: files, search, changes,
 * hunks, Problems and Open in editor): no caching, and core's refusals in
 * the API's error shape. Moved out of `workspace-files-routes.ts` by the
 * epic 8 sweep (8.12) so neither route file imports the other.
 */
import {
  AgentMidTurnError,
  CommandChangedError,
  CoreError,
  EditorUnavailableError,
  HunkOutdatedError,
  InvalidOperationError,
  NotImplementedError,
  NotFoundError,
  PathProtectedError,
  ScriptsNotTrustedError,
  ValidationError,
  VcsError,
} from '@ogden-agents/core';
import {
  AGENT_MID_TURN_MESSAGE,
  COMMAND_CHANGED_MESSAGE,
  PROBLEMS_UNTRUSTED_TEXT,
  EDITOR_NONE_FOUND_TEXT,
  EDITOR_UNAVAILABLE_MESSAGE,
  GIT_POINTER_UNUSUAL_MESSAGE,
  HUNK_CHANGED_SINCE_TEXT,
  HUNK_OUTDATED_MESSAGES,
  WORKSPACE_PATH_HARD_LINK_MESSAGE,
  WORKSPACE_PATH_NOT_FOUND_MESSAGE,
  WORKSPACE_PATH_PROTECTED_MESSAGE,
} from '@ogden-agents/shared';
import type { Context } from 'hono';
import { apiError } from './errors.js';
import type { Logger } from './log.js';

/** Neither a browser nor a proxy keeps a file's content, a diff or output. */
export const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * The Workbench's refusals in the API's error shape (8.1's mapping, and
 * epic 8 entry 2's 409s). Each message is one of the fixed shared ones,
 * never an error's own text, which could name a path. Anything else is
 * logged by code only and answers 500.
 */
export function workbenchRefusal(log: Logger, what: string): (c: Context, error: unknown) => Response {
  return (c, error) => {
    if (error instanceof ValidationError) return apiError(c, 400, 'invalid_request', error.message);
    if (error instanceof PathProtectedError) return apiError(c, 403, 'path_protected', error.message === WORKSPACE_PATH_HARD_LINK_MESSAGE ? WORKSPACE_PATH_HARD_LINK_MESSAGE : WORKSPACE_PATH_PROTECTED_MESSAGE);
    if (error instanceof NotFoundError) return apiError(c, 404, 'not_found', WORKSPACE_PATH_NOT_FOUND_MESSAGE);
    if (error instanceof AgentMidTurnError) return apiError(c, 409, 'agent_mid_turn', AGENT_MID_TURN_MESSAGE);
    // The view's own sentence (This turn's, the other views', an undo's), one of the fixed ones.
    if (error instanceof HunkOutdatedError) return apiError(c, 409, 'hunk_outdated', HUNK_OUTDATED_MESSAGES.includes(error.message) ? error.message : HUNK_CHANGED_SINCE_TEXT);
    // Core's own plain message (never a path).
    if (error instanceof InvalidOperationError) return apiError(c, 409, 'invalid_operation', error.message);
    // The project's `.git` file points somewhere unusual (AD-37): the fixed sentence, never the path.
    if (error instanceof VcsError && error.message === GIT_POINTER_UNUSUAL_MESSAGE) return apiError(c, 409, 'invalid_operation', GIT_POINTER_UNUSUAL_MESSAGE);
    // A lane the port doesn't have (hunk actions and undo on a port without them): core's own plain message.
    if (error instanceof NotImplementedError) return apiError(c, 501, 'not_implemented', error.message);
    // Problems (AD-38; 8.9): an untrusted project ran nothing; a script that changed since it was confirmed ran nothing.
    if (error instanceof ScriptsNotTrustedError) return apiError(c, 409, 'scripts_not_trusted', PROBLEMS_UNTRUSTED_TEXT);
    if (error instanceof CommandChangedError) return apiError(c, 409, 'command_changed', COMMAND_CHANGED_MESSAGE);
    if (error instanceof EditorUnavailableError) return apiError(c, 409, 'editor_unavailable', error.message === EDITOR_NONE_FOUND_TEXT ? EDITOR_NONE_FOUND_TEXT : EDITOR_UNAVAILABLE_MESSAGE);
    // Never the path or the reason's text, which could name it.
    log.error(`a ${what} request failed`, { code: error instanceof CoreError ? error.code : 'unexpected' });
    return apiError(c, 500, 'internal_error', "Ogden Agents couldn't do that. Try again.");
  };
}
