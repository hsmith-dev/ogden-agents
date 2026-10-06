/**
 * The orchestration route (epic 15, story 15.2): the one read of a project's
 * orchestration settings, behind core's Orchestration guard (AD-22 style): 409
 * `feature_off` while the piece is off, 404 `not_found` for an unknown or
 * malformed project, both before anything is read. It runs none of the
 * project's scripts, so it needs no script trust. The Orchestrate page, plan,
 * approval and dispatch routes come with entries 3 to 9, registered through
 * {@link orchestrationRoutes} too. The piece, mode and roster change through
 * the workspace settings route. {@link orchestrationRouteKeys} lists what was
 * registered, for the architecture tests.
 */
import {
  AgentNotReadyError,
  BadOrderError,
  RunNotOpenError,
  StepNotChangeableError,
  InvalidOperationError,
  ManagerFailedError,
  SessionBusyError,
  SessionNotIdleError,
  ManagerUnavailableError,
  NotFoundError,
  OrchestrationOffError,
  StepNotApprovedError,
  StepNotProposedError,
  ValidationError,
  type Orchestration,
  type OrchestrationFeature,
  type Permissions,
} from '@ogden-agents/core';
import {
  API_BASE,
  API_ROUTES,
  BMAD_PROJECT_NOT_FOUND_MESSAGE,
  DEFAULT_ORCHESTRATION_MODE,
  ORCHESTRATION_NO_MANAGER_MESSAGE,
  ORCHESTRATION_OFF_MESSAGE,
  OrchestrationRunResponse,
  OrchestrationRunsResponse,
  OrchestrationSettingsResponse,
  RUN_LIMITS,
  StartOrchestrationRunRequest,
  TeamRoster,
  type WorkspaceId,
} from '@ogden-agents/shared';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { apiError, notImplemented } from './errors.js';
import type { Logger } from './log.js';
import { ids, readBody } from './request-input.js';

/** Whether this install ships Orchestration. Yes since the tracer (15.3): a project can turn the piece on (off by default; with it off nothing is served). */
export const SHIPPED_ORCHESTRATION = true;

/** A goal is a sentence or two; the cap leaves room for JSON escaping. */
const MAX_GOAL_BODY_BYTES = 8 * 1024;
/** An edited instruction (up to 4000 characters) or a new order of at most twenty step ids, with room for JSON escaping. */
const MAX_REVIEW_BODY_BYTES = 32 * 1024;

export type OrchestrationHandler = (c: Context, scope: { workspaceId: WorkspaceId }) => Response | Promise<Response>;

/** Every route registered through {@link orchestrationRoutes} on an app, as `METHOD path`. */
const registered = new WeakMap<Hono, Set<string>>();
const WORKSPACE_SCOPE = `${API_BASE}/workspaces/:wsId/`;

/**
 * The one way to register a route that serves Orchestration: core's guard
 * runs first, read at each request, before the handler or the body. The path
 * must lie inside a workspace.
 */
export function orchestrationRoutes(app: Hono, { orchestration, log }: { orchestration: OrchestrationFeature; log: Logger }) {
  const keys = registered.get(app) ?? new Set<string>();
  registered.set(app, keys);
  const register = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE') => (path: string, handler: OrchestrationHandler) => {
    if (!path.startsWith(WORKSPACE_SCOPE)) throw new Error(`an orchestration route must be inside a workspace (${WORKSPACE_SCOPE}…): ${method} ${path}`);
    app.on(method, path, async (c) => {
      const scope = ids(c);
      if (scope === undefined) return apiError(c, 404, 'not_found', BMAD_PROJECT_NOT_FOUND_MESSAGE);
      try {
        orchestration.requireOrchestration(scope.workspaceId);
      } catch (error) {
        if (error instanceof OrchestrationOffError) {
          log.info('Orchestration is off; route refused', { workspaceId: scope.workspaceId });
          return apiError(c, 409, 'feature_off', ORCHESTRATION_OFF_MESSAGE);
        }
        if (error instanceof NotFoundError) return apiError(c, 404, 'not_found', BMAD_PROJECT_NOT_FOUND_MESSAGE);
        throw error;
      }
      try {
        return await handler(c, { workspaceId: scope.workspaceId });
      } catch (error) {
        if (error instanceof NotFoundError) return apiError(c, 404, 'not_found', BMAD_PROJECT_NOT_FOUND_MESSAGE);
        throw error;
      }
    });
    keys.add(`${method} ${path}`);
  };
  return { get: register('GET'), post: register('POST'), patch: register('PATCH'), put: register('PUT'), delete: register('DELETE') };
}

/** Every route registered on `app` through {@link orchestrationRoutes}, sorted. */
export function orchestrationRouteKeys(app: Hono): string[] {
  return [...(registered.get(app) ?? [])].sort();
}

export interface OrchestrationRoutesOptions {
  orchestration: OrchestrationFeature;
  /** The project's settings; without it the route answers 501 once the guard passes. */
  permissions?: Pick<Permissions, 'getSettings'> | undefined;
  /** The runs use-case (15.3); without it the run routes answer 501 once the guard passes. */
  runs?: Orchestration | undefined;
  log: Logger;
}

export function registerOrchestrationRoutes(app: Hono, { orchestration, permissions, runs, log }: OrchestrationRoutesOptions): void {
  const routes = orchestrationRoutes(app, { orchestration, log });
  const limit = bodyLimit({ maxSize: MAX_GOAL_BODY_BYTES, onError: (c) => apiError(c, 413, 'invalid_request', 'That goal is too long.') });
  const reviewLimit = bodyLimit({ maxSize: MAX_REVIEW_BODY_BYTES, onError: (c) => apiError(c, 413, 'invalid_request', 'That is too long.') });
  /** The JSON body as it came: core's use-case holds it to its own rules and answers in its own plain words. */
  const readJson = async (c: Context): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> => {
    try {
      return { ok: true, value: JSON.parse(await c.req.text()) as unknown };
    } catch {
      return { ok: false, response: apiError(c, 400, 'invalid_request', 'The request body must be JSON.') };
    }
  };
  /** Core's refusals as API errors; anything else is left for `onError` (500). */
  const refusal = (c: Context, error: unknown): Response => {
    if (error instanceof ManagerUnavailableError) return apiError(c, 409, 'manager_unavailable', error.message);
    if (error instanceof ManagerFailedError) return apiError(c, 409, 'manager_failed', error.message);
    if (error instanceof StepNotApprovedError) return apiError(c, 409, 'step_not_approved', error.message);
    if (error instanceof StepNotProposedError) return apiError(c, 409, 'step_not_proposed', error.message);
    if (error instanceof StepNotChangeableError) return apiError(c, 409, 'step_not_changeable', error.message);
    if (error instanceof BadOrderError) return apiError(c, 409, 'bad_order', error.message);
    if (error instanceof RunNotOpenError) return apiError(c, 409, 'run_not_open', error.message);
    // The worker chat could not take the instruction (stopping, busy): nothing more was done, and the plain reason is core's.
    if (error instanceof InvalidOperationError || error instanceof SessionBusyError || error instanceof SessionNotIdleError) return apiError(c, 409, 'session_busy', error.message);
    if (error instanceof ValidationError) return apiError(c, 400, 'invalid_request', error.message);
    if (error instanceof AgentNotReadyError) return apiError(c, 409, error.code, error.message, { agentId: error.agentId, action: error.action });
    if (error instanceof NotFoundError) return apiError(c, 404, 'not_found', BMAD_PROJECT_NOT_FOUND_MESSAGE);
    throw error;
  };
  const run = (c: Context, work: (use: Orchestration) => Promise<Response>): Promise<Response> | Response => {
    if (runs === undefined) return notImplemented(c);
    return work(runs).catch((error: unknown) => refusal(c, error));
  };
  routes.get(API_ROUTES.workspaceOrchestration, (c, { workspaceId }) => {
    if (permissions === undefined) return notImplemented(c);
    const settings = permissions.getSettings(workspaceId);
    const manager = runs?.managerStatus(workspaceId) ?? { state: 'not_chosen' as const, message: ORCHESTRATION_NO_MANAGER_MESSAGE };
    return c.json(
      OrchestrationSettingsResponse.parse({
        settings: {
          mode: settings.orchestrationMode ?? DEFAULT_ORCHESTRATION_MODE,
          limits: RUN_LIMITS,
          roster: settings.orchestrationRoster ?? TeamRoster.parse({}),
          managerReady: manager.state === 'ready',
          manager,
        },
      }),
    );
  });

  routes.get(API_ROUTES.workspaceOrchestrationRuns, (c, { workspaceId }) => run(c, async (use) => c.json(OrchestrationRunsResponse.parse({ runs: await use.listRuns(workspaceId) }))));

  routes.post(API_ROUTES.workspaceOrchestrationRuns, async (c, { workspaceId }) => {
    // The guard has run; the size is checked before the body is read.
    let answer: Response | undefined;
    const tooLong = await limit(c, async () => {
      const body = await readBody(c, StartOrchestrationRunRequest);
      if (!body.ok) {
        answer = body.response;
        return;
      }
      answer = await run(c, async (use) => {
        const started = await use.startRun(workspaceId, body.value);
        // The goal is the user's own words: never logged.
        log.info('orchestration run started', { workspaceId, runId: started.run.id, steps: started.steps.length });
        return c.json(OrchestrationRunResponse.parse({ run: started }), 201);
      });
    });
    return tooLong ?? answer!;
  });

  routes.get(API_ROUTES.workspaceOrchestrationRun, (c, { workspaceId }) => run(c, async (use) => c.json(OrchestrationRunResponse.parse({ run: await use.getRun(workspaceId, c.req.param('runId') ?? '') }))));

  routes.post(API_ROUTES.workspaceOrchestrationStepApprove, async (c, { workspaceId }) => {
    // An optional body names the text the user read; any other field (an approver, say) is ignored: the approver is always the user.
    let seen: string | undefined;
    try {
      const body = JSON.parse(await c.req.text()) as { instruction?: unknown };
      if (typeof body.instruction === 'string') seen = body.instruction;
    } catch {
      // No body, or not JSON: approve without a text check.
    }
    return run(c, async (use) => c.json(OrchestrationRunResponse.parse({ run: await use.approveStep(workspaceId, c.req.param('runId') ?? '', c.req.param('stepId') ?? '', seen) })));
  });

  routes.post(API_ROUTES.workspaceOrchestrationStepDispatch, (c, { workspaceId }) =>
    run(c, async (use) => {
      const view = await use.dispatchStep(workspaceId, c.req.param('runId') ?? '', c.req.param('stepId') ?? '');
      log.info('orchestration instruction sent', { workspaceId, runId: c.req.param('runId'), stepId: c.req.param('stepId') });
      return c.json(OrchestrationRunResponse.parse({ run: view }));
    }),
  );

  // The plan review (15.6). Each is the user's own action: these routes sit behind the tab's token like every route, and nothing the
  // manager's code can reach calls them (an architecture test). No body names an approver: the approver is always the user.
  routes.post(API_ROUTES.workspaceOrchestrationStepEdit, async (c, { workspaceId }) => {
    let answer: Response | undefined;
    const tooLong = await reviewLimit(c, async () => {
      const body = await readJson(c);
      if (!body.ok) {
        answer = body.response;
        return;
      }
      answer = await run(c, async (use) => c.json(OrchestrationRunResponse.parse({ run: await use.editStep(workspaceId, c.req.param('runId') ?? '', c.req.param('stepId') ?? '', body.value) })));
    });
    return tooLong ?? answer!;
  });

  routes.post(API_ROUTES.workspaceOrchestrationStepSkip, (c, { workspaceId }) =>
    run(c, async (use) => c.json(OrchestrationRunResponse.parse({ run: await use.skipStep(workspaceId, c.req.param('runId') ?? '', c.req.param('stepId') ?? '') }))),
  );

  routes.post(API_ROUTES.workspaceOrchestrationReorder, async (c, { workspaceId }) => {
    let answer: Response | undefined;
    const tooLong = await reviewLimit(c, async () => {
      const body = await readJson(c);
      if (!body.ok) {
        answer = body.response;
        return;
      }
      answer = await run(c, async (use) => c.json(OrchestrationRunResponse.parse({ run: await use.reorderSteps(workspaceId, c.req.param('runId') ?? '', body.value) })));
    });
    return tooLong ?? answer!;
  });

  routes.post(API_ROUTES.workspaceOrchestrationStop, (c, { workspaceId }) =>
    run(c, async (use) => {
      const view = await use.stopRun(workspaceId, c.req.param('runId') ?? '');
      log.info('orchestration run stopped by the user', { workspaceId, runId: c.req.param('runId') });
      return c.json(OrchestrationRunResponse.parse({ run: view }));
    }),
  );
}
