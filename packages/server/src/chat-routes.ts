/**
 * The chat routes (story 2.2): create a workspace from a repo path, create a
 * chat session, read it, and send it a message; story 2.5 adds the workspace
 * and session lists; story 2.10 queues a message sent while the agent
 * answers (409 only when the queue is full) and adds Stop (`cancel`). All live under `/api/v1`
 * (`API_ROUTES`), behind the gate: a tab token on every request, and a
 * matching `Origin` on these state-changing POSTs (AD-15). Routes call the
 * core chat use-case and never write themselves (AD-11). Story 3.1 adds the
 * driver switch; story 3.2 gives its refusals their own codes and adds the
 * session's `terminal` to `GET` session. Permission modes add the chat's
 * mode (`PUT`, core enforces who may choose which) and `permissionModes` on
 * `GET` session.
 */
import {
  ConfirmationRequiredError,
  CoreError,
  createAddProject,
  DeveloperModeRequiredError,
  DriverIsTerminalError,
  ModeUnavailableError,
  FeatureUnavailableError,
  InvalidOperationError,
  NotFoundError,
  QueueFullError,
  SessionBusyError,
  SessionNotBusyError,
  SessionNotIdleError,
  TerminalUnavailableError,
  AgentNotReadyError,
  UnknownAgentError,
  ValidationError,
  type AddProject,
  type Chat,
} from '@ogden-agents/core';
import {
  API_ROUTES,
  ChatAgentsResponse,
  CreateSessionRequest,
  CreateWorkspaceRequest,
  FEATURE_UNAVAILABLE_MESSAGE,
  SendMessageRequest,
  SendMessageResponse,
  SessionResponse,
  SessionsResponse,
  SetDriverRequest,
  SetPermissionModeRequest,
  type SessionTerminal,
  WorkspaceResponse,
  WorkspacesResponse,
} from '@ogden-agents/shared';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { apiError } from './errors.js';
import type { Logger } from './log.js';
import { ids, readBody } from './request-input.js';
import type { TerminalAvailabilityCheck } from './terminal-availability.js';

/** Largest request body these routes read (a message is at most 100,000 characters). */
const MAX_BODY_BYTES = 1024 * 1024;

const NOT_FOUND = 'There is no such project or chat.';

/** The terminal's reason when checking it failed (story 3.2): plain words, never the error itself. */
export const TERMINAL_CHECK_FAILED = "Ogden Agents couldn't check whether the terminal can start here.";

export interface ChatRouteOptions {
  /** Whether a session's terminal can work (story 3.2; 3.7 fills it in). Without it, `GET` session has no `terminal`. */
  terminalAvailability?: TerminalAvailabilityCheck | undefined;
  /**
   * Adding a project with its first BMad pieces (story 10.4): the given ones
   * or the app-wide default. Without it a new project starts Simple and
   * given pieces are refused as unavailable.
   */
  addProject?: AddProject | undefined;
}

export function registerChatRoutes(app: Hono, chat: Chat, log: Logger, { terminalAvailability, addProject }: ChatRouteOptions = {}): void {
  const projects = addProject ?? createAddProject({ chat });
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
    // A switch refused (story 3.2): core's plain reason, and for the terminal the `SessionTerminal` that says why.
    if (error instanceof SessionNotIdleError) return apiError(c, 409, 'session_not_idle', error.message);
    if (error instanceof TerminalUnavailableError) return apiError(c, 409, 'terminal_unavailable', error.message, { terminal: error.terminal });
    if (error instanceof DriverIsTerminalError) return apiError(c, 409, 'driver_is_terminal', error.message);
    // Permission modes: core's refusals, each with its plain reason; nothing changed.
    if (error instanceof DeveloperModeRequiredError) return apiError(c, 403, 'developer_mode_required', error.message);
    if (error instanceof ConfirmationRequiredError) return apiError(c, 400, 'confirmation_required', error.message);
    if (error instanceof ModeUnavailableError) return apiError(c, 409, 'mode_unavailable', error.message);
    if (error instanceof FeatureUnavailableError) return apiError(c, 409, 'feature_unavailable', FEATURE_UNAVAILABLE_MESSAGE);
    if (error instanceof SessionBusyError) {
      return apiError(c, 409, 'session_busy', 'The agent is still answering. Send your message when it is done.');
    }
    if (error instanceof UnknownAgentError) return apiError(c, 400, 'agent_unknown', error.message);
    // The agent can't start a chat now (6.3): its plain reason, and what fixes it.
    if (error instanceof AgentNotReadyError) return apiError(c, 409, error.code, error.message, { agentId: error.agentId, action: error.action });
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
      const workspace = projects.addProject(body.value.path, body.value.bmadPieces);
      return c.json(WorkspaceResponse.parse({ workspace }), 201);
    } catch (error) {
      return refusal(c, error);
    }
  });

  // The agents a chat can be started with (epic 6): agent-neutral data the picker reads.
  app.get(API_ROUTES.chatAgents, async (c) => c.json(ChatAgentsResponse.parse(await chat.chatAgents())));

  app.post(API_ROUTES.workspaceSessions, limit, async (c) => {
    const scope = ids(c);
    if (scope === undefined) return apiError(c, 404, 'not_found', NOT_FOUND);
    const body = await readBody(c, CreateSessionRequest, { optional: true });
    if (!body.ok) return body.response;
    try {
      // The agent picked (epic 6), or the default one; an id this install doesn't have is refused by core.
      const session = await chat.createChatSession(scope.workspaceId, { agentId: body.value?.agentId });
      log.info('chat session created', { workspaceId: scope.workspaceId, sessionId: session.id, agentId: session.agentId });
      return c.json(SessionResponse.parse({ session }), 201);
    } catch (error) {
      return refusal(c, error);
    }
  });

  app.get(API_ROUTES.workspaceSession, async (c) => {
    const scope = ids(c);
    if (scope?.sessionId === undefined) return apiError(c, 404, 'not_found', NOT_FOUND);
    let session;
    try {
      session = chat.getSession(scope.workspaceId, scope.sessionId);
    } catch (error) {
      return refusal(c, error);
    }
    const permissionModes = chat.permissionModeOptions(scope.workspaceId, scope.sessionId);
    if (terminalAvailability === undefined) return c.json(SessionResponse.parse({ session, permissionModes }));
    let terminal: SessionTerminal;
    try {
      terminal = await terminalAvailability(session);
    } catch (error) {
      // A code only: the error's message could name a path.
      log.error('terminal availability check failed', {
        sessionId: session.id,
        code: (error as NodeJS.ErrnoException | undefined)?.code ?? (error instanceof CoreError ? error.code : 'unexpected'),
      });
      terminal = { available: false, code: 'pty_unavailable', reason: TERMINAL_CHECK_FAILED };
    }
    return c.json(SessionResponse.parse({ session, terminal, permissionModes }));
  });

  // The chat's permission mode: core decides (Developer mode, confirmation, what the agent offers, who drives).
  app.put(API_ROUTES.sessionPermissionMode, limit, async (c) => {
    const scope = ids(c);
    if (scope?.sessionId === undefined) return apiError(c, 404, 'not_found', NOT_FOUND);
    const body = await readBody(c, SetPermissionModeRequest);
    if (!body.ok) return body.response;
    try {
      const before = chat.getSession(scope.workspaceId, scope.sessionId).permissionMode;
      const session = chat.setPermissionMode(scope.workspaceId, scope.sessionId, body.value.mode, { confirm: body.value.confirm });
      if (session.permissionMode !== before) log.info('chat permission mode changed', { workspaceId: scope.workspaceId, sessionId: scope.sessionId, mode: session.permissionMode, previous: before });
      return c.json(SessionResponse.parse({ session, permissionModes: chat.permissionModeOptions(scope.workspaceId, scope.sessionId) }));
    } catch (error) {
      if (error instanceof CoreError) log.info('chat permission mode refused', { workspaceId: scope.workspaceId, sessionId: scope.sessionId, mode: body.value.mode, code: error.code });
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
