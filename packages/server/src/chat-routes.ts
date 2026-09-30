/**
 * The chat routes (story 2.2): create a workspace from a repo path, create a
 * chat session, read it, and send it a message; story 2.5 adds the workspace
 * and session lists; story 2.10 queues a message sent while the agent
 * answers (409 only when the queue is full) and adds Stop (`cancel`). All live under `/api/v1`
 * (`API_ROUTES`), behind the gate: a tab token on every request, and a
 * matching `Origin` on these state-changing POSTs (AD-15). Routes call the
 * core chat use-case and never write themselves (AD-11).
 */
import {
  CoreError,
  DriverSwitchRefusedError,
  InvalidOperationError,
  NotFoundError,
  QueueFullError,
  SessionBusyError,
  SessionNotBusyError,
  ValidationError,
  type Chat,
} from '@ogden-agents/core';
import {
  API_ROUTES,
  CreateSessionRequest,
  CreateWorkspaceRequest,
  SendMessageRequest,
  SendMessageResponse,
  SessionId,
  SessionResponse,
  SessionsResponse,
  SetDriverRequest,
  WorkspaceId,
  WorkspaceResponse,
  WorkspacesResponse,
} from '@ogden-agents/shared';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { apiError } from './errors.js';
import type { Logger } from './log.js';

/** Largest request body these routes read (a message is at most 100,000 characters). */
const MAX_BODY_BYTES = 1024 * 1024;

const NOT_FOUND = 'There is no such project or chat.';

/** The part of a shared Zod schema these routes use. */
interface Schema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: ReadonlyArray<{ message: string }> } };
}

/** Parses the JSON body against `schema`, or answers 400 when it doesn't fit. */
export async function readBody<T>(c: Context, schema: Schema<T>, { optional = false } = {}): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
  let json: unknown;
  try {
    const text = await c.req.text();
    json = text.trim() === '' && optional ? {} : JSON.parse(text);
  } catch {
    return { ok: false, response: apiError(c, 400, 'invalid_request', 'The request body must be JSON.') };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, response: apiError(c, 400, 'invalid_request', parsed.error.issues[0]?.message ?? 'The request is not valid.') };
  }
  return { ok: true, value: parsed.data };
}

/** The route's `:wsId` and `:sesId`, if they are well-formed ids; otherwise nothing matches them. */
export function ids(c: Context): { workspaceId: WorkspaceId; sessionId?: SessionId } | undefined {
  const workspace = WorkspaceId.safeParse(c.req.param('wsId'));
  if (!workspace.success) return undefined;
  const raw = c.req.param('sesId');
  if (raw === undefined) return { workspaceId: workspace.data };
  const session = SessionId.safeParse(raw);
  return session.success ? { workspaceId: workspace.data, sessionId: session.data } : undefined;
}

export function registerChatRoutes(app: Hono, chat: Chat, log: Logger): void {
  const limit = bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => apiError(c, 413, 'invalid_request', 'That message is too long.'),
  });

  /** Core's refusals as API errors; anything else is left for `onError` (500). */
  const refusal = (c: Context, error: unknown): Response => {
    if (error instanceof NotFoundError) return apiError(c, 404, 'not_found', NOT_FOUND);
    if (error instanceof QueueFullError) {
      return apiError(c, 409, 'session_busy', 'Too many messages are waiting. Send this one when the agent has caught up.');
    }
    if (error instanceof SessionNotBusyError) return apiError(c, 409, 'session_not_busy', 'The agent is not working on anything to stop.');
    // The plain reason says why (story 3.1); entry 2 gives the refusals their own codes.
    if (error instanceof DriverSwitchRefusedError) return apiError(c, 409, 'session_busy', error.message);
    if (error instanceof SessionBusyError) {
      return apiError(c, 409, 'session_busy', 'The agent is still answering. Send your message when it is done.');
    }
    if (error instanceof InvalidOperationError || error instanceof ValidationError) {
      return apiError(c, 400, 'invalid_request', error.message);
    }
    if (error instanceof CoreError) log.warn('chat request refused', { code: error.code, reason: error.message });
    throw error;
  };

  app.post(API_ROUTES.workspaces, limit, async (c) => {
    const body = await readBody(c, CreateWorkspaceRequest);
    if (!body.ok) return body.response;
    try {
      const workspace = chat.openWorkspace(body.value.path);
      return c.json(WorkspaceResponse.parse({ workspace }), 201);
    } catch (error) {
      return refusal(c, error);
    }
  });

  app.post(API_ROUTES.workspaceSessions, limit, async (c) => {
    const scope = ids(c);
    if (scope === undefined) return apiError(c, 404, 'not_found', NOT_FOUND);
    const body = await readBody(c, CreateSessionRequest, { optional: true });
    if (!body.ok) return body.response;
    try {
      const session = chat.createChatSession(scope.workspaceId);
      log.info('chat session created', { workspaceId: scope.workspaceId, sessionId: session.id });
      return c.json(SessionResponse.parse({ session }), 201);
    } catch (error) {
      return refusal(c, error);
    }
  });

  app.get(API_ROUTES.workspaceSession, (c) => {
    const scope = ids(c);
    if (scope?.sessionId === undefined) return apiError(c, 404, 'not_found', NOT_FOUND);
    try {
      return c.json(SessionResponse.parse({ session: chat.getSession(scope.workspaceId, scope.sessionId) }));
    } catch (error) {
      return refusal(c, error);
    }
  });

  app.get(API_ROUTES.workspaces, (c) => c.json(WorkspacesResponse.parse({ workspaces: chat.listWorkspaces() })));

  app.get(API_ROUTES.workspaceSessions, (c) => {
    const scope = ids(c);
    if (scope === undefined) return apiError(c, 404, 'not_found', NOT_FOUND);
    try {
      return c.json(SessionsResponse.parse({ sessions: chat.listSessions(scope.workspaceId) }));
    } catch (error) {
      return refusal(c, error);
    }
  });

  // Stop (2.10): never asks for confirmation; the session ends `idle`.
  app.post(API_ROUTES.sessionCancel, (c) => {
    const scope = ids(c);
    if (scope?.sessionId === undefined) return apiError(c, 404, 'not_found', NOT_FOUND);
    try {
      chat.cancel(scope.workspaceId, scope.sessionId);
      log.info('session stopped', { workspaceId: scope.workspaceId, sessionId: scope.sessionId });
      return c.body(null, 204);
    } catch (error) {
      return refusal(c, error);
    }
  });

  // Chat or terminal (story 3.1, AD-6): core decides whether the switch can happen.
  app.post(API_ROUTES.sessionDriver, limit, async (c) => {
    const scope = ids(c);
    if (scope?.sessionId === undefined) return apiError(c, 404, 'not_found', NOT_FOUND);
    const body = await readBody(c, SetDriverRequest);
    if (!body.ok) return body.response;
    try {
      const session = await chat.switchDriver(scope.workspaceId, scope.sessionId, body.value.driver);
      log.info('session driver switched', { workspaceId: scope.workspaceId, sessionId: scope.sessionId, driver: session.driver });
      return c.json(SessionResponse.parse({ session }));
    } catch (error) {
      return refusal(c, error);
    }
  });

  app.post(API_ROUTES.sessionMessages, limit, async (c) => {
    const scope = ids(c);
    if (scope?.sessionId === undefined) return apiError(c, 404, 'not_found', NOT_FOUND);
    const body = await readBody(c, SendMessageRequest);
    if (!body.ok) return body.response;
    try {
      // The message itself is the user's content: never logged.
      const result = chat.sendMessage(scope.workspaceId, scope.sessionId, body.value.text);
      return c.json(SendMessageResponse.parse(result), 202);
    } catch (error) {
      return refusal(c, error);
    }
  });
}
