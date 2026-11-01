/**
 * The Workbench's other routes (AD-36 to AD-39; epic 8 entry 2's contract):
 * the four change views, one file's diff, hunk actions and a revert's
 * undo (8.5), a chat's turns, a worktree chat's commit, project commands
 * and their runs, and the editor launcher. Behind the gate (AD-15) like every `/api/v1/*` route, on no
 * paired-device allowlist (AD-34), and not a BMad piece. Each answers 501
 * `not_implemented` until its lane wires its use-case (8.3 to 8.5, 8.9,
 * 8.10, epic 27). Diffs, output and paths are only in `GET` responses with
 * `Cache-Control: no-store`; nothing here logs a path or a diff. No git and
 * no child process here: every git operation is `VcsWorkingTreePort`'s.
 */
import type { EditorLaunch, ProjectCommands, WorkspaceChanges } from '@ogden-agents/core';
import {
  API_ROUTES,
  ChangesResponse,
  CommitWorktreeResponse,
  EditorsResponse,
  FileDiffResponse,
  HunkActionResponse,
  OpenInEditorResponse,
  ProjectCommandRunDetail,
  ProjectCommandRunResponse,
  ProjectCommandsResponse,
  TurnsResponse,
} from '@ogden-agents/shared';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { apiError, notImplemented } from './errors.js';
import type { Logger } from './log.js';
import { NO_STORE, workbenchRefusal } from './workbench-refusal.js';

/** The largest body any of these routes takes (`SetProjectCommandsRequest`: 20 commands of 2000 characters, twice). */
const MAX_BODY_BYTES = 256 * 1024;

export interface WorkbenchRoutesOptions {
  workspaceChanges?: WorkspaceChanges | undefined;
  projectCommands?: ProjectCommands | undefined;
  editorLaunch?: EditorLaunch | undefined;
  log: Logger;
}

/** The query's values, only those given, as the use-case's schema reads them. */
const given = (c: Context, names: readonly string[]): Record<string, string> => {
  const query = c.req.query();
  return Object.fromEntries(names.flatMap((name) => (query[name] === undefined ? [] : [[name, query[name]]])));
};

export function registerWorkbenchRoutes(app: Hono, { workspaceChanges, projectCommands, editorLaunch, log }: WorkbenchRoutesOptions): void {
  const refusal = workbenchRefusal(log, 'workbench');
  const limit = bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => apiError(c, 413, 'invalid_request', 'That request is too large.') });
  const readJson = async (c: Context): Promise<{ body: unknown } | { response: Response }> => {
    try {
      const text = await c.req.text();
      return { body: text.trim() === '' ? {} : (JSON.parse(text) as unknown) };
    } catch {
      return { response: apiError(c, 400, 'invalid_request', 'The request body must be JSON.') };
    }
  };

  // Changes (AD-37): 8.3 to 8.5, and epic 27's worktree commit.
  if (workspaceChanges === undefined) {
    app.get(API_ROUTES.workspaceChanges, notImplemented);
    app.get(API_ROUTES.workspaceChangesFile, notImplemented);
    app.post(API_ROUTES.workspaceChangesHunks, notImplemented);
    app.post(API_ROUTES.workspaceChangesHunksUndo, notImplemented);
    app.get(API_ROUTES.sessionTurns, notImplemented);
    app.post(API_ROUTES.sessionWorktreeCommit, notImplemented);
  } else {
    app.get(API_ROUTES.workspaceChanges, async (c) => {
      try {
        return c.json(ChangesResponse.parse(await workspaceChanges.changes(c.req.param('wsId'), given(c, ['view', 'session', 'turn']))), 200, NO_STORE);
      } catch (error) {
        return refusal(c, error);
      }
    });
    app.get(API_ROUTES.workspaceChangesFile, async (c) => {
      try {
        return c.json(FileDiffResponse.parse(await workspaceChanges.fileDiff(c.req.param('wsId'), given(c, ['view', 'path', 'session', 'turn']))), 200, NO_STORE);
      } catch (error) {
        return refusal(c, error);
      }
    });
    app.post(API_ROUTES.workspaceChangesHunks, limit, async (c) => {
      const read = await readJson(c);
      if ('response' in read) return read.response;
      try {
        return c.json(HunkActionResponse.parse(await workspaceChanges.hunk(c.req.param('wsId'), read.body)), 200, NO_STORE);
      } catch (error) {
        return refusal(c, error);
      }
    });
    // 501 while the port has no undo (core's NotImplementedError).
    app.post(API_ROUTES.workspaceChangesHunksUndo, limit, async (c) => {
      const read = await readJson(c);
      if ('response' in read) return read.response;
      try {
        return c.json(HunkActionResponse.parse(await workspaceChanges.undo(c.req.param('wsId'), read.body)), 200, NO_STORE);
      } catch (error) {
        return refusal(c, error);
      }
    });
    app.get(API_ROUTES.sessionTurns, async (c) => {
      try {
        return c.json(TurnsResponse.parse(await workspaceChanges.turns(c.req.param('wsId'), c.req.param('sesId'))), 200, NO_STORE);
      } catch (error) {
        return refusal(c, error);
      }
    });
    app.post(API_ROUTES.sessionWorktreeCommit, limit, async (c) => {
      const read = await readJson(c);
      if ('response' in read) return read.response;
      try {
        return c.json(CommitWorktreeResponse.parse(await workspaceChanges.commit(c.req.param('wsId'), c.req.param('sesId'), read.body)), 200, NO_STORE);
      } catch (error) {
        return refusal(c, error);
      }
    });
  }

  // Project commands and Problems (AD-38): 8.9.
  if (projectCommands === undefined) {
    app.get(API_ROUTES.workspaceProjectCommands, notImplemented);
    app.put(API_ROUTES.workspaceProjectCommands, notImplemented);
    app.post(API_ROUTES.workspaceProjectCommandRuns, notImplemented);
    app.get(API_ROUTES.workspaceProjectCommandRun, notImplemented);
    app.post(API_ROUTES.workspaceProjectCommandRunStop, notImplemented);
  } else {
    app.get(API_ROUTES.workspaceProjectCommands, async (c) => {
      try {
        return c.json(ProjectCommandsResponse.parse(await projectCommands.list(c.req.param('wsId'))), 200, NO_STORE);
      } catch (error) {
        return refusal(c, error);
      }
    });
    app.put(API_ROUTES.workspaceProjectCommands, limit, async (c) => {
      const read = await readJson(c);
      if ('response' in read) return read.response;
      try {
        return c.json(ProjectCommandsResponse.parse(await projectCommands.set(c.req.param('wsId'), read.body)), 200, NO_STORE);
      } catch (error) {
        return refusal(c, error);
      }
    });
    app.post(API_ROUTES.workspaceProjectCommandRuns, async (c) => {
      try {
        return c.json(ProjectCommandRunResponse.parse(await projectCommands.run(c.req.param('wsId'), c.req.param('commandId'))), 202, NO_STORE);
      } catch (error) {
        return refusal(c, error);
      }
    });
    app.get(API_ROUTES.workspaceProjectCommandRun, async (c) => {
      try {
        return c.json(ProjectCommandRunDetail.parse(await projectCommands.get(c.req.param('wsId'), c.req.param('runId'))), 200, NO_STORE);
      } catch (error) {
        return refusal(c, error);
      }
    });
    app.post(API_ROUTES.workspaceProjectCommandRunStop, async (c) => {
      try {
        return c.json(ProjectCommandRunResponse.parse(await projectCommands.stop(c.req.param('wsId'), c.req.param('runId'))), 200, NO_STORE);
      } catch (error) {
        return refusal(c, error);
      }
    });
  }

  // The editor launcher (AD-39): 8.10.
  if (editorLaunch === undefined) {
    app.get(API_ROUTES.editors, notImplemented);
    app.put(API_ROUTES.editors, notImplemented);
    app.post(API_ROUTES.workspaceFileOpenInEditor, notImplemented);
  } else {
    app.get(API_ROUTES.editors, async (c) => {
      try {
        return c.json(EditorsResponse.parse(await editorLaunch.editors()), 200, NO_STORE);
      } catch (error) {
        return refusal(c, error);
      }
    });
    // The editor files open in (Settings, Projects, Editor): one found now, or `null`.
    app.put(API_ROUTES.editors, limit, async (c) => {
      const read = await readJson(c);
      if ('response' in read) return read.response;
      try {
        return c.json(EditorsResponse.parse(await editorLaunch.setChoice(read.body)), 200, NO_STORE);
      } catch (error) {
        return refusal(c, error);
      }
    });
    app.post(API_ROUTES.workspaceFileOpenInEditor, limit, async (c) => {
      const read = await readJson(c);
      if ('response' in read) return read.response;
      try {
        return c.json(OpenInEditorResponse.parse(await editorLaunch.open(c.req.param('wsId'), read.body)), 200, NO_STORE);
      } catch (error) {
        return refusal(c, error);
      }
    });
  }
}
