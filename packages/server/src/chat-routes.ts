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
 * `GET` session. Handoff adds the preview and the switch to another agent.
 */
import {
  AnswerFirstError,
  BUILD_SESSION_READ_ONLY_MESSAGE,
  BuildSessionReadOnlyError,
  ConfirmationRequiredError,
  CoreError,
  createAddProject,
  DeveloperModeRequiredError,
  DriverIsTerminalError,
  ModeUnavailableError,
  ModelUnavailableError,
  FeatureUnavailableError,
  HandoffNotPreviewedError,
  InvalidOperationError,
  MessageNotQueuedError,
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
  type AgentModels,
  type Chat,
} from '@ogden-agents/core';
import {
  API_ROUTES,
  ChatAgentsResponse,
  HandoffBriefPreviewRequest,
  HandoffPreviewQuery,
  HandoffPreviewResponse,
  HandoffRequest,
  HandoffResponse,
  CreateSessionRequest,
  CreateWorkspaceRequest,
  FEATURE_UNAVAILABLE_MESSAGE,
  CHAT_NAME_TOO_LONG,
  RenameSessionRequest,
  SendMessageRequest,
  SendMessageResponse,
  SessionResponse,
  SessionsResponse,
  SetDriverRequest,
  SetAgentDefaultModelRequest,
  SetPermissionModeRequest,
  SetSessionModelRequest,
  UpdateQueuedMessageRequest,
  MessageId,
  type SessionId,
  type SessionTerminal,
  WorkspaceId,
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
/** A rename's body bound (backlog story 12). */
const MAX_RENAME_BODY_BYTES = 16 * 1024;

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
  /**
   * Each agent's install-wide default model (story 11; Settings → Agents),
   * and whether an agent is registered. Without it, `PUT` default model is 404.
   */
  agentDefaults?: { models: Pick<AgentModels, 'setDefaultModel'>; isAgentRegistered: (agentId: string) => boolean } | undefined;
}

export function registerChatRoutes(app: Hono, chat: Chat, log: Logger, { terminalAvailability, addProject, agentDefaults }: ChatRouteOptions = {}): void {
  const projects = addProject ?? createAddProject({ chat });
  // A rename is a few hundred bytes at most (a 2000 character name, JSON escaped, fits well inside).
  const renameLimit = bodyLimit({ maxSize: MAX_RENAME_BODY_BYTES, onError: (c) => apiError(c, 413, 'invalid_request', CHAT_NAME_TOO_LONG) });
  const limit = bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => apiError(c, 413, 'invalid_request', 'That message is too long.'),
  });

  /** Whether the session is an unattended build's (story 5.2): it runs on its own, so nobody sends it messages, a mode or a driver. */
  const isBuildSession = (workspaceId: WorkspaceId, sessionId: SessionId): boolean => chat.getSession(workspaceId, sessionId).kind === 'build';
  const readOnlyBuild = (c: Context): Response => apiError(c, 409, 'session_busy', BUILD_SESSION_READ_ONLY_MESSAGE);

  /** Core's refusals as API errors; anything else is left for `onError` (500). */
  const refusal = (c: Context, error: unknown): Response => {
    if (error instanceof NotFoundError) return apiError(c, 404, 'not_found', NOT_FOUND);
    if (error instanceof BuildSessionReadOnlyError) return readOnlyBuild(c);
    if (error instanceof QueueFullError) {
      return apiError(c, 409, 'session_busy', 'Too many messages are waiting. Send this one when the agent has caught up.');
    }
    if (error instanceof SessionNotBusyError) return apiError(c, 409, 'session_not_busy', 'The agent is not working on anything to stop.');
    // Send now or wait: core's plain reasons; nothing was sent or changed.
    if (error instanceof AnswerFirstError) return apiError(c, 409, 'answer_first', error.message);
    if (error instanceof MessageNotQueuedError) return apiError(c, 409, 'message_not_queued', error.message);
    // A switch refused (story 3.2): core's plain reason, and for the terminal the `SessionTerminal` that says why.
    if (error instanceof SessionNotIdleError) return apiError(c, 409, 'session_not_idle', error.message);
    if (error instanceof TerminalUnavailableError) return apiError(c, 409, 'terminal_unavailable', error.message, { terminal: error.terminal });
    if (error instanceof DriverIsTerminalError) return apiError(c, 409, 'driver_is_terminal', error.message);
    // Permission modes: core's refusals, each with its plain reason; nothing changed.
    if (error instanceof DeveloperModeRequiredError) return apiError(c, 403, 'developer_mode_required', error.message);
    if (error instanceof ConfirmationRequiredError) return apiError(c, 400, 'confirmation_required', error.message);
    if (error instanceof ModeUnavailableError) return apiError(c, 409, 'mode_unavailable', error.message);
    if (error instanceof ModelUnavailableError) return apiError(c, 409, 'model_unavailable', error.message);
    // A handoff no preview covers (server-enforced disclosure): nothing changed.
    if (error instanceof HandoffNotPreviewedError) return apiError(c, 409, 'handoff_not_previewed', error.message);
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
  app.get(API_ROUTES.chatAgents, async (c) => {
    // `?workspaceId=` makes an agent that needs project trust say so while the project isn't trusted for it (epic 12, 12.3).
    const workspaceId = c.req.query('workspaceId');
    const parsed = workspaceId === undefined ? undefined : WorkspaceId.safeParse(workspaceId);
    return c.json(ChatAgentsResponse.parse(await chat.chatAgents(parsed?.success === true ? parsed.data : undefined)));
  });

  app.post(API_ROUTES.workspaceSessions, limit, async (c) => {
    const scope = ids(c);
    if (scope === undefined) return apiError(c, 404, 'not_found', NOT_FOUND);
    const body = await readBody(c, CreateSessionRequest, { optional: true });
    if (!body.ok) return body.response;
    try {
      // The agent picked (epic 6), or the default one; an id this install doesn't have is refused by core.
      // Its model (story 11): the one given (an agent handoff's), else the project's or install's default for the agent.
      // Its remote target (CAP-24, epic 19 story 19.7): the machine picked, or `null`/omitted for a local chat.
      const session = await chat.createChatSession(scope.workspaceId, { agentId: body.value?.agentId, model: body.value?.model, machineId: body.value?.machineId });
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
    const models = chat.modelOptions(scope.workspaceId, scope.sessionId);
    if (terminalAvailability === undefined) return c.json(SessionResponse.parse({ session, permissionModes, models }));
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
    return c.json(SessionResponse.parse({ session, terminal, permissionModes, models }));
  });

  // The chat's model (story 11): core decides (a model the agent lists, who drives); it applies to the next message.
  app.put(API_ROUTES.sessionModel, limit, async (c) => {
    const scope = ids(c);
    if (scope?.sessionId === undefined) return apiError(c, 404, 'not_found', NOT_FOUND);
    const body = await readBody(c, SetSessionModelRequest);
    if (!body.ok) return body.response;
    try {
      const before = chat.getSession(scope.workspaceId, scope.sessionId).model ?? null;
      const session = chat.setModel(scope.workspaceId, scope.sessionId, body.value.model);
      // The model id is the agent's own name for a model, never a secret.
      if ((session.model ?? null) !== before) log.info('chat model changed', { workspaceId: scope.workspaceId, sessionId: scope.sessionId, model: session.model ?? null, previous: before });
      return c.json(SessionResponse.parse({ session, models: chat.modelOptions(scope.workspaceId, scope.sessionId) }));
    } catch (error) {
      if (error instanceof CoreError) log.info('chat model refused', { workspaceId: scope.workspaceId, sessionId: scope.sessionId, code: error.code });
      return refusal(c, error);
    }
  });

  // An agent's install-wide default model (story 11; Settings → Agents): new chats only.
  app.put(API_ROUTES.chatAgentDefaultModel, limit, async (c) => {
    const agentId = c.req.param('agentId');
    if (agentDefaults === undefined || agentId === undefined || !agentDefaults.isAgentRegistered(agentId)) return apiError(c, 404, 'agent_unknown', "This agent isn't available in Ogden Agents on this computer.");
    const body = await readBody(c, SetAgentDefaultModelRequest);
    if (!body.ok) return body.response;
    try {
      const { changed, model } = agentDefaults.models.setDefaultModel(agentId, body.value.model);
      if (changed) log.info('agent default model changed', { agentId, model });
      return c.json(ChatAgentsResponse.parse(await chat.chatAgents()));
    } catch (error) {
      return refusal(c, error);
    }
  });

  // The chat's permission mode: core decides (Developer mode, confirmation, what the agent offers, who drives).
  app.put(API_ROUTES.sessionPermissionMode, limit, async (c) => {
    const scope = ids(c);
    if (scope?.sessionId === undefined) return apiError(c, 404, 'not_found', NOT_FOUND);
    const body = await readBody(c, SetPermissionModeRequest);
    if (!body.ok) return body.response;
    try {
      if (isBuildSession(scope.workspaceId, scope.sessionId)) return readOnlyBuild(c);
      const before = chat.getSession(scope.workspaceId, scope.sessionId).permissionMode;
      const session = chat.setPermissionMode(scope.workspaceId, scope.sessionId, body.value.mode, { confirm: body.value.confirm });
      if (session.permissionMode !== before) log.info('chat permission mode changed', { workspaceId: scope.workspaceId, sessionId: scope.sessionId, mode: session.permissionMode, previous: before });
      return c.json(SessionResponse.parse({ session, permissionModes: chat.permissionModeOptions(scope.workspaceId, scope.sessionId) }));
    } catch (error) {
      if (error instanceof CoreError) log.info('chat permission mode refused', { workspaceId: scope.workspaceId, sessionId: scope.sessionId, mode: body.value.mode, code: error.code });
      return refusal(c, error);
    }
  });

  // The chat's name (backlog story 12): core normalizes it and refuses one too long; never sent to the agent.
  app.put(API_ROUTES.sessionTitle, renameLimit, async (c) => {
    const scope = ids(c);
    if (scope?.sessionId === undefined) return apiError(c, 404, 'not_found', NOT_FOUND);
    const body = await readBody(c, RenameSessionRequest);
    if (!body.ok) return body.response;
    try {
      const session = chat.renameSession(scope.workspaceId, scope.sessionId, body.value.title);
      // Never the name itself: it is the user's words.
      log.info('chat renamed', { workspaceId: scope.workspaceId, sessionId: scope.sessionId, named: session.title !== null });
      return c.json(SessionResponse.parse({ session }));
    } catch (error) {
      return refusal(c, error);
    }
  });

  // Handoff (user decision 2026-10-04): what continuing the chat with another agent would send; nothing changes.
  app.get(API_ROUTES.sessionHandoff, async (c) => {
    const scope = ids(c);
    if (scope?.sessionId === undefined) return apiError(c, 404, 'not_found', NOT_FOUND);
    const query = HandoffPreviewQuery.safeParse({ agentId: c.req.query('agentId') });
    if (!query.success) return apiError(c, 400, 'invalid_request', 'Pick the agent to continue with.');
    try {
      return c.json(HandoffPreviewResponse.parse(await chat.handoffPreview(scope.workspaceId, scope.sessionId, query.data.agentId)));
    } catch (error) {
      return refusal(c, error);
    }
  });

  // The preview again for the brief as the user edited it, with a token for exactly it; nothing changes.
  app.post(API_ROUTES.sessionHandoffPreview, limit, async (c) => {
    const scope = ids(c);
    if (scope?.sessionId === undefined) return apiError(c, 404, 'not_found', NOT_FOUND);
    const body = await readBody(c, HandoffBriefPreviewRequest);
    if (!body.ok) return body.response;
    try {
      // The brief is the user's content: never logged.
      return c.json(HandoffPreviewResponse.parse(await chat.handoffPreview(scope.workspaceId, scope.sessionId, body.value.agentId, body.value.brief)));
    } catch (error) {
      return refusal(c, error);
    }
  });

  // The chat continues with another agent: core checks who drives, the state, the agent, the brief's size and its preview.
  app.post(API_ROUTES.sessionHandoff, limit, async (c) => {
    const scope = ids(c);
    if (scope?.sessionId === undefined) return apiError(c, 404, 'not_found', NOT_FOUND);
    const body = await readBody(c, HandoffRequest);
    if (!body.ok) return body.response;
    try {
      const before = chat.getSession(scope.workspaceId, scope.sessionId).agentId;
      // The brief and the message are the user's content: never logged.
      const result = await chat.handOff(scope.workspaceId, scope.sessionId, body.value);
      log.info('chat continued with another agent', { workspaceId: scope.workspaceId, sessionId: scope.sessionId, agentId: result.session.agentId, previous: before });
      return c.json(HandoffResponse.parse(result), 202);
    } catch (error) {
      if (error instanceof CoreError) log.info('chat handoff refused', { workspaceId: scope.workspaceId, sessionId: scope.sessionId, agentId: body.value.agentId, code: error.code });
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
      if (isBuildSession(scope.workspaceId, scope.sessionId)) return readOnlyBuild(c);
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
      if (isBuildSession(scope.workspaceId, scope.sessionId)) return readOnlyBuild(c);
      // The message itself is the user's content: never logged.
      const result = chat.sendMessage(scope.workspaceId, scope.sessionId, body.value.text, { delivery: body.value.delivery });
      return c.json(SendMessageResponse.parse(result), 202);
    } catch (error) {
      return refusal(c, error);
    }
  });

  // Send now or wait: the messages waiting to be sent, one at a time. Their text is the user's: never logged.
  const queuedScope = (c: Context) => {
    const scope = ids(c);
    const messageId = MessageId.safeParse(c.req.param('messageId'));
    return scope?.sessionId === undefined || !messageId.success ? undefined : { workspaceId: scope.workspaceId, sessionId: scope.sessionId, messageId: messageId.data };
  };
  app.patch(API_ROUTES.sessionQueuedMessage, limit, async (c) => {
    const scope = queuedScope(c);
    if (scope === undefined) return apiError(c, 404, 'not_found', NOT_FOUND);
    const body = await readBody(c, UpdateQueuedMessageRequest);
    if (!body.ok) return body.response;
    try {
      chat.updateQueuedMessage(scope.workspaceId, scope.sessionId, scope.messageId, body.value);
      return c.body(null, 204);
    } catch (error) {
      return refusal(c, error);
    }
  });
  app.delete(API_ROUTES.sessionQueuedMessage, (c) => {
    const scope = queuedScope(c);
    if (scope === undefined) return apiError(c, 404, 'not_found', NOT_FOUND);
    try {
      chat.removeQueuedMessage(scope.workspaceId, scope.sessionId, scope.messageId);
      return c.body(null, 204);
    } catch (error) {
      return refusal(c, error);
    }
  });
  app.post(API_ROUTES.sessionQueuedMessageSendNow, (c) => {
    const scope = queuedScope(c);
    if (scope === undefined) return apiError(c, 404, 'not_found', NOT_FOUND);
    try {
      chat.sendQueuedMessageNow(scope.workspaceId, scope.sessionId, scope.messageId);
      return c.body(null, 204);
    } catch (error) {
      return refusal(c, error);
    }
  });
}
