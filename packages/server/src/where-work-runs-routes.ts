/**
 * Where work runs (CAP-35; epic 27 entry 2's contract): a chat's Location
 * and its hand-off, a put-away worktree's Restore and the project's list of
 * them, the install's worktree retention setting, and trials. Behind the
 * gate (AD-15) like every `/api/v1/*` route, on no paired-device allowlist
 * (AD-34), and not a BMad piece. Each answers 501 `not_implemented` until
 * its lane wires its use-case (27.4, 27.6, 27.8). A worktree's port has no
 * route: `SessionLocation.port` carries it. `GET`s answer with
 * `Cache-Control: no-store`; nothing here logs a path. No git and no child
 * process here: every git operation is `VcsChatWorktreePort`'s.
 */
import { HandOffConflictError, NotFoundError, RestoreFailedError, WorktreePutAwayError, type ChatLocations, type Trials, type WorktreeRetention } from '@ogden-agents/core';
import {
  API_ROUTES,
  chatOfWorktreeBranch,
  HANDOFF_CONFLICT_MESSAGE,
  HandOffResponse,
  PutAwayWorktreesResponse,
  RESTORE_FAILED_MESSAGE,
  RESTORE_PATH_TAKEN_TEXT,
  restoreBranchMissingText,
  restoreBranchMovedText,
  RestoreWorktreeResponse,
  SessionLocationResponse,
  TrialResponse,
  WorktreeRetentionSetting,
} from '@ogden-agents/shared';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { apiError, notImplemented } from './errors.js';
import type { Logger } from './log.js';
import { NO_STORE, workbenchRefusal } from './workspace-files-routes.js';

/** A failed Restore's sentence: the branch's own when core named the chat's branch (never a path), else the fixed one for its reason. */
function restoreFailedText(error: RestoreFailedError): string {
  if (error.reason === 'path_taken') return RESTORE_PATH_TAKEN_TEXT;
  const branch = error.branch;
  if (branch === undefined || chatOfWorktreeBranch(branch) === undefined) return RESTORE_FAILED_MESSAGE;
  return error.reason === 'branch_missing' ? restoreBranchMissingText(branch) : restoreBranchMovedText(branch);
}

/** The largest body any of these routes takes (`CreateTrialRequest`: a 20,000-character task and four agent ids). */
const MAX_BODY_BYTES = 128 * 1024;

export interface WhereWorkRunsRoutesOptions {
  chatLocations?: ChatLocations | undefined;
  worktreeRetention?: WorktreeRetention | undefined;
  trials?: Trials | undefined;
  log: Logger;
}

export function registerWhereWorkRunsRoutes(app: Hono, { chatLocations, worktreeRetention, trials, log }: WhereWorkRunsRoutesOptions): void {
  const workbench = workbenchRefusal(log, 'where work runs');
  const refusal = (c: Context, error: unknown): Response => {
    // An unknown project, session or trial: core's own message, not the Files panel's sentence.
    if (error instanceof NotFoundError) return apiError(c, 404, 'not_found', error.message);
    if (error instanceof HandOffConflictError) return apiError(c, 409, 'handoff_conflict', HANDOFF_CONFLICT_MESSAGE, { files: error.files });
    if (error instanceof RestoreFailedError) return apiError(c, 409, 'restore_failed', restoreFailedText(error), { reason: error.reason });
    if (error instanceof WorktreePutAwayError) return apiError(c, 409, 'worktree_put_away', error.message);
    return workbench(c, error);
  };
  const limit = bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => apiError(c, 413, 'invalid_request', 'That request is too large.') });
  const readJson = async (c: Context): Promise<{ body: unknown } | { response: Response }> => {
    try {
      const text = await c.req.text();
      return { body: text.trim() === '' ? {} : (JSON.parse(text) as unknown) };
    } catch {
      return { response: apiError(c, 400, 'invalid_request', 'The request body must be JSON.') };
    }
  };

  // A chat's Location and its hand-off (27.3 to 27.5).
  if (chatLocations === undefined) {
    app.get(API_ROUTES.sessionLocation, notImplemented);
    app.post(API_ROUTES.sessionLocation, notImplemented);
  } else {
    app.get(API_ROUTES.sessionLocation, async (c) => {
      try {
        return c.json(SessionLocationResponse.parse(await chatLocations.location(c.req.param('wsId'), c.req.param('sesId'))), 200, NO_STORE);
      } catch (error) {
        return refusal(c, error);
      }
    });
    app.post(API_ROUTES.sessionLocation, limit, async (c) => {
      const read = await readJson(c);
      if ('response' in read) return read.response;
      try {
        return c.json(HandOffResponse.parse(await chatLocations.handOff(c.req.param('wsId'), c.req.param('sesId'), read.body)), 200, NO_STORE);
      } catch (error) {
        return refusal(c, error);
      }
    });
  }

  // Retention and Restore (27.6).
  if (worktreeRetention === undefined) {
    app.post(API_ROUTES.sessionWorktreeRestore, notImplemented);
    app.get(API_ROUTES.workspacePutAwayWorktrees, notImplemented);
    app.get(API_ROUTES.worktreeRetention, notImplemented);
    app.put(API_ROUTES.worktreeRetention, notImplemented);
  } else {
    app.post(API_ROUTES.sessionWorktreeRestore, async (c) => {
      try {
        return c.json(RestoreWorktreeResponse.parse(await worktreeRetention.restore(c.req.param('wsId'), c.req.param('sesId'))), 200, NO_STORE);
      } catch (error) {
        return refusal(c, error);
      }
    });
    app.get(API_ROUTES.workspacePutAwayWorktrees, async (c) => {
      try {
        return c.json(PutAwayWorktreesResponse.parse(await worktreeRetention.listPutAway(c.req.param('wsId'))), 200, NO_STORE);
      } catch (error) {
        return refusal(c, error);
      }
    });
    app.get(API_ROUTES.worktreeRetention, async (c) => {
      try {
        return c.json(WorktreeRetentionSetting.parse(await worktreeRetention.setting()), 200, NO_STORE);
      } catch (error) {
        return refusal(c, error);
      }
    });
    app.put(API_ROUTES.worktreeRetention, limit, async (c) => {
      const read = await readJson(c);
      if ('response' in read) return read.response;
      try {
        return c.json(WorktreeRetentionSetting.parse(await worktreeRetention.setSetting(read.body)), 200, NO_STORE);
      } catch (error) {
        return refusal(c, error);
      }
    });
  }

  // Trials (27.8).
  if (trials === undefined) {
    app.post(API_ROUTES.workspaceTrials, notImplemented);
    app.get(API_ROUTES.workspaceTrial, notImplemented);
    app.post(API_ROUTES.workspaceTrialKeep, notImplemented);
  } else {
    app.post(API_ROUTES.workspaceTrials, limit, async (c) => {
      const read = await readJson(c);
      if ('response' in read) return read.response;
      try {
        return c.json(TrialResponse.parse(await trials.start(c.req.param('wsId'), read.body)), 201, NO_STORE);
      } catch (error) {
        return refusal(c, error);
      }
    });
    app.get(API_ROUTES.workspaceTrial, async (c) => {
      try {
        return c.json(TrialResponse.parse(await trials.get(c.req.param('wsId'), c.req.param('tryId'))), 200, NO_STORE);
      } catch (error) {
        return refusal(c, error);
      }
    });
    app.post(API_ROUTES.workspaceTrialKeep, limit, async (c) => {
      const read = await readJson(c);
      if ('response' in read) return read.response;
      try {
        return c.json(TrialResponse.parse(await trials.keep(c.req.param('wsId'), c.req.param('tryId'), read.body)), 200, NO_STORE);
      } catch (error) {
        return refusal(c, error);
      }
    });
  }
}
