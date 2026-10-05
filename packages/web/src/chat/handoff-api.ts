import { API_ROUTES, apiPath, HandoffPreviewResponse, HandoffResponse, type HandoffRequest } from '@ogden-agents/shared';
import { call, postJson } from '@/api/http';
import { tabAuth, type TabAuth } from '@/auth/tab-token';

/**
 * Handoff's REST calls (user decision 2026-10-04): what continuing a chat with
 * another agent would send, and the switch itself. The divider and the new
 * agent's reply arrive through the event log.
 */

/** `GET …/handoff?agentId=`: the brief, who receives it, and the chat's mode afterwards. Nothing changes. */
export async function fetchHandoffPreview(wsId: string, sesId: string, agentId: string, auth: Pick<TabAuth, 'fetch'> = tabAuth): Promise<HandoffPreviewResponse> {
  const path = `${apiPath(API_ROUTES.sessionHandoff, { wsId, sesId })}?${new URLSearchParams({ agentId }).toString()}`;
  return HandoffPreviewResponse.parse(await call(auth, path, {}, "Ogden Agents couldn't prepare the handoff"));
}

/** `POST …/handoff/preview`: the preview for the brief as the user edited it, with a token for exactly it. Nothing changes. */
export async function previewEditedBrief(wsId: string, sesId: string, agentId: string, brief: string, auth: Pick<TabAuth, 'fetch'> = tabAuth): Promise<HandoffPreviewResponse> {
  return HandoffPreviewResponse.parse(await call(auth, apiPath(API_ROUTES.sessionHandoffPreview, { wsId, sesId }), postJson({ agentId, brief }), "Ogden Agents couldn't prepare the handoff"));
}

/** `POST …/handoff`: the chat continues with `agentId`, which is sent `brief` and then `message`. */
export async function handOff(wsId: string, sesId: string, request: HandoffRequest, auth: Pick<TabAuth, 'fetch'> = tabAuth): Promise<HandoffResponse> {
  return HandoffResponse.parse(await call(auth, apiPath(API_ROUTES.sessionHandoff, { wsId, sesId }), postJson(request), "Ogden Agents couldn't continue this chat with that agent"));
}
