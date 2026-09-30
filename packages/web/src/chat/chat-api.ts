import {
  API_ROUTES,
  apiPath,
  PermissionRulesResponse,
  SendMessageResponse,
  SessionResponse,
  WorkspaceResponse,
  type PermissionDecisionRequest,
  type PermissionRule,
  type Session,
  type Workspace,
} from '@ogden-agents/shared';
import { tabAuth, type TabAuth } from '@/auth/tab-token';

/**
 * The chat REST calls (story 2.2), sent with this tab's token. Replies and
 * session state never come back here: they arrive through the event log.
 */

/** The only agent in this epic; the UI names it by its product name (EXPERIENCE.md Voice). */
export const AGENT_NAME = 'Claude Code';

const UNREACHABLE = "Couldn't reach Ogden Agents. Check that it is still running, then try again.";

/** A refused request, with the server's plain message and its HTTP status. */
export class ChatApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ChatApiError';
  }
}

export async function call(auth: Pick<TabAuth, 'fetch'>, path: string, init: RequestInit, fallback: string): Promise<unknown> {
  let response: Response;
  try {
    response = await auth.fetch(path, init);
  } catch {
    throw new ChatApiError(UNREACHABLE, 0);
  }
  if (response.ok) return response.json();
  let message = `${fallback} (error ${response.status}).`;
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    if (typeof body.error?.message === 'string') message = body.error.message;
  } catch {
    // Not JSON: keep the fallback.
  }
  throw new ChatApiError(message, response.status);
}

export const postJson = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/** `POST /api/v1/workspaces`: the workspace for the folder at `path`. */
export async function openWorkspace(path: string, auth: Pick<TabAuth, 'fetch'> = tabAuth): Promise<Workspace> {
  const json = await call(auth, API_ROUTES.workspaces, postJson({ path }), "Ogden Agents couldn't open that folder");
  return WorkspaceResponse.parse(json).workspace;
}

/** `POST /api/v1/workspaces/:wsId/sessions`: a new chat in the workspace. */
export async function createChatSession(wsId: string, auth: Pick<TabAuth, 'fetch'> = tabAuth): Promise<Session> {
  const json = await call(auth, apiPath(API_ROUTES.workspaceSessions, { wsId }), postJson({ kind: 'chat' }), "Ogden Agents couldn't start a chat");
  return SessionResponse.parse(json).session;
}

/** `GET /api/v1/workspaces/:wsId/sessions/:sesId`. */
export async function fetchSession(wsId: string, sesId: string, auth: Pick<TabAuth, 'fetch'> = tabAuth): Promise<Session> {
  const json = await call(auth, apiPath(API_ROUTES.workspaceSession, { wsId, sesId }), {}, "Ogden Agents couldn't load this chat");
  return SessionResponse.parse(json).session;
}

/** `POST /api/v1/workspaces/:wsId/sessions/:sesId/messages`. */
export async function sendMessage(wsId: string, sesId: string, text: string, auth: Pick<TabAuth, 'fetch'> = tabAuth): Promise<string> {
  const json = await call(auth, apiPath(API_ROUTES.sessionMessages, { wsId, sesId }), postJson({ text }), "Your message couldn't be sent");
  return SendMessageResponse.parse(json).messageId;
}

// ---------------------------------------------------------------------------
// Permission cards (story 2.6).
// ---------------------------------------------------------------------------

/** A call answered 204 No Content, or a refusal with the server's plain message. */
async function callNoContent(auth: Pick<TabAuth, 'fetch'>, path: string, init: RequestInit, fallback: string): Promise<void> {
  let response: Response;
  try {
    response = await auth.fetch(path, init);
  } catch {
    throw new ChatApiError(UNREACHABLE, 0);
  }
  if (response.ok) return;
  let message = `${fallback} (error ${response.status}).`;
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    if (typeof body.error?.message === 'string') message = body.error.message;
  } catch {
    // Not JSON: keep the fallback.
  }
  throw new ChatApiError(message, response.status);
}

/** `POST /api/v1/workspaces/:wsId/sessions/:sesId/permissions/:requestId`: the user's answer on a card. */
export async function decidePermission(
  wsId: string,
  sesId: string,
  requestId: string,
  body: PermissionDecisionRequest,
  auth: Pick<TabAuth, 'fetch'> = tabAuth,
): Promise<void> {
  await callNoContent(auth, apiPath(API_ROUTES.sessionPermission, { wsId, sesId, requestId }), postJson(body), "Your answer couldn't be sent");
}

/** `GET /api/v1/workspaces/:wsId/permission-rules`: the project's always-allow rules. */
export async function fetchPermissionRules(wsId: string, auth: Pick<TabAuth, 'fetch'> = tabAuth): Promise<PermissionRule[]> {
  const json = await call(auth, apiPath(API_ROUTES.permissionRules, { wsId }), {}, "Ogden Agents couldn't load this project's rules");
  return PermissionRulesResponse.parse(json).rules;
}

/** `DELETE /api/v1/workspaces/:wsId/permission-rules/:ruleId`: undoes an always-allow rule. */
export async function removePermissionRule(wsId: string, ruleId: string, auth: Pick<TabAuth, 'fetch'> = tabAuth): Promise<void> {
  await callNoContent(auth, apiPath(API_ROUTES.permissionRule, { wsId, ruleId }), { method: 'DELETE' }, "The rule couldn't be undone");
}
