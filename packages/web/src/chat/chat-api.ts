import {
  API_ROUTES,
  apiPath,
  PermissionRulesResponse,
  SendMessageResponse,
  SessionResponse,
  WorkspaceResponse,
  type BmadPiece,
  type PermissionDecisionRequest,
  type PermissionMode,
  type PermissionRule,
  type Session,
  type SessionDriver,
  type Workspace,
} from '@ogden-agents/shared';
import { call, callNoContent, ChatApiError, postJson } from '@/api/http';
import { tabAuth, type TabAuth } from '@/auth/tab-token';

/**
 * The chat REST calls (story 2.2), sent with this tab's token. Replies and
 * session state never come back here: they arrive through the event log.
 */

/** The only agent in this epic; the UI names it by its product name (EXPERIENCE.md Voice). */
export const AGENT_NAME = 'Claude Code';

/** That agent's id in the agent setup API (`/api/v1/agents/:agentId`), for Sign in again (9.4). */
export const AGENT_ID = 'claude-code';

// The shared fetch-error helper, re-exported for this module's importers.
export { call, ChatApiError, postJson };

/**
 * `POST /api/v1/workspaces`: the workspace for the folder at `path`. A new
 * one starts with `bmadPieces` when given (Welcome's answer, story 10.4),
 * otherwise with the app-wide default, which the server applies.
 */
export async function openWorkspace(path: string, auth: Pick<TabAuth, 'fetch'> = tabAuth, bmadPieces?: readonly BmadPiece[]): Promise<Workspace> {
  const json = await call(auth, API_ROUTES.workspaces, postJson(bmadPieces === undefined ? { path } : { path, bmadPieces }), "Ogden Agents couldn't open that folder");
  return WorkspaceResponse.parse(json).workspace;
}

/** `POST /api/v1/workspaces/:wsId/sessions`: a new chat in the workspace. */
export async function createChatSession(wsId: string, auth: Pick<TabAuth, 'fetch'> = tabAuth): Promise<Session> {
  const json = await call(auth, apiPath(API_ROUTES.workspaceSessions, { wsId }), postJson({ kind: 'chat' }), "Ogden Agents couldn't start a chat");
  return SessionResponse.parse(json).session;
}

/**
 * `GET /api/v1/workspaces/:wsId/sessions/:sesId`: the session, and whether
 * its terminal can work here (`terminal`, story 3.2; absent from older servers).
 */
export async function fetchSession(wsId: string, sesId: string, auth: Pick<TabAuth, 'fetch'> = tabAuth): Promise<SessionResponse> {
  const json = await call(auth, apiPath(API_ROUTES.workspaceSession, { wsId, sesId }), {}, "Ogden Agents couldn't load this chat");
  return SessionResponse.parse(json);
}

/** `POST /api/v1/workspaces/:wsId/sessions/:sesId/messages`. */
export async function sendMessage(wsId: string, sesId: string, text: string, auth: Pick<TabAuth, 'fetch'> = tabAuth): Promise<string> {
  const json = await call(auth, apiPath(API_ROUTES.sessionMessages, { wsId, sesId }), postJson({ text }), "Your message couldn't be sent");
  return SendMessageResponse.parse(json).messageId;
}

/**
 * `POST /api/v1/workspaces/:wsId/sessions/:sesId/driver` (story 3.1): hands
 * the chat to the agent's own terminal or back. 409 with a plain reason when
 * it can't switch now.
 */
export async function switchDriver(wsId: string, sesId: string, driver: SessionDriver, auth: Pick<TabAuth, 'fetch'> = tabAuth): Promise<Session> {
  const json = await call(auth, apiPath(API_ROUTES.sessionDriver, { wsId, sesId }), postJson({ driver }), "Ogden Agents couldn't switch this chat");
  return SessionResponse.parse(json).session;
}

/**
 * `PUT /api/v1/workspaces/:wsId/sessions/:sesId/permission-mode`: the chat's
 * permission mode (permission modes). `confirm` says the user confirmed Skip
 * all's warning; the server refuses Skip all without it, and without Developer mode.
 */
export async function setPermissionMode(wsId: string, sesId: string, mode: PermissionMode, confirm = false, auth: Pick<TabAuth, 'fetch'> = tabAuth): Promise<SessionResponse> {
  const json = await call(
    auth,
    apiPath(API_ROUTES.sessionPermissionMode, { wsId, sesId }),
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(confirm ? { mode, confirm: true } : { mode }) },
    "Ogden Agents couldn't change this chat's permission mode",
  );
  return SessionResponse.parse(json);
}

// ---------------------------------------------------------------------------
// Permission cards (story 2.6).
// ---------------------------------------------------------------------------

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

/** `POST /api/v1/workspaces/:wsId/sessions/:sesId/cancel`: Stop (story 2.10). 409 when nothing is running any more. */
export async function cancelSession(wsId: string, sesId: string, auth: Pick<TabAuth, 'fetch'> = tabAuth): Promise<void> {
  await callNoContent(auth, apiPath(API_ROUTES.sessionCancel, { wsId, sesId }), { method: 'POST' }, "Ogden Agents couldn't stop the agent");
}

/** `DELETE /api/v1/workspaces/:wsId/permission-rules/:ruleId`: undoes an always-allow rule. */
export async function removePermissionRule(wsId: string, ruleId: string, auth: Pick<TabAuth, 'fetch'> = tabAuth): Promise<void> {
  await callNoContent(auth, apiPath(API_ROUTES.permissionRule, { wsId, ruleId }), { method: 'DELETE' }, "The rule couldn't be undone");
}
