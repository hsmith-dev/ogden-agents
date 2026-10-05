import { API_ROUTES, apiPath, ChatSettingsResponse, DEFAULT_WHILE_WORKING, type WhileWorking } from '@ogden-agents/shared';
import { useQuery } from '@tanstack/react-query';
import { callNoContent } from '@/api/http';
import { tabAuth, type TabAuth } from '@/auth/tab-token';
import { call, postJson } from '@/chat/chat-api';
import { useEventInvalidation } from '@/events/use-event-invalidation';
import { useWorkspaceSettings } from '@/workspaces/workspace-settings-api';

/**
 * Send now or wait (2026-10-04): what a message sent while the agent works
 * does, app-wide and per project, and the calls on the messages that wait.
 * The event log only invalidates the queries (AD-7), so a change in any tab
 * shows up in every other.
 */

type Auth = Pick<TabAuth, 'fetch'>;

/** The choices in the user's words (no dashes in user text). */
export const WHILE_WORKING_OPTIONS: Record<WhileWorking, { label: string; description: string }> = {
  wait: { label: 'Wait until it finishes', description: 'Your message goes after the agent finishes what it is doing.' },
  now: {
    label: 'Send right away',
    description: 'Your message goes now. Agents that can take it mid task get it at once; others stop their current step first.',
  },
};

/** What the composer's menu calls each way of sending. */
export const SEND_WORDS: Record<WhileWorking, string> = { now: 'Send now', wait: 'Send after it finishes' };

/** `GET /api/v1/settings/chat`: the app-wide choice. */
export async function fetchChatSettings(auth: Auth = tabAuth): Promise<WhileWorking> {
  const json = await call(auth, API_ROUTES.chatSettings, {}, "Ogden Agents couldn't load the chat settings");
  return ChatSettingsResponse.parse(json).whileWorking;
}

/** `PUT /api/v1/settings/chat`. */
export async function saveChatSettings(whileWorking: WhileWorking, auth: Auth = tabAuth): Promise<WhileWorking> {
  const json = await call(
    auth,
    API_ROUTES.chatSettings,
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ whileWorking }) },
    "That setting couldn't be saved",
  );
  return ChatSettingsResponse.parse(json).whileWorking;
}

/** The app-wide choice, kept current from the event stream. */
export function useChatSettings() {
  useEventInvalidation((event) => (event.type === 'settings.while_working_changed' ? [['chat-settings']] : []));
  return useQuery({ queryKey: ['chat-settings'], queryFn: () => fetchChatSettings(), retry: false });
}

/** What a message sent while the agent works does in this project: its own choice, else the app's, else Wait. */
export function useWhileWorking(wsId: string): WhileWorking {
  const app = useChatSettings();
  const project = useWorkspaceSettings(wsId);
  return project.data?.whileWorking ?? app.data ?? DEFAULT_WHILE_WORKING;
}

/** The other way of sending, for one message. */
export const otherWay = (whileWorking: WhileWorking): WhileWorking => (whileWorking === 'now' ? 'wait' : 'now');

/** The shortcut that sends the other way, as this computer writes it. */
export const otherWayShortcutLabel = (platform: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): string =>
  /Mac|iPhone|iPad/.test(platform) ? '⌘ Enter' : 'Ctrl+Enter';

const queuedPath = (wsId: string, sesId: string, messageId: string) => apiPath(API_ROUTES.sessionQueuedMessage, { wsId, sesId, messageId });

/** `PATCH …/queue/:messageId`: a waiting message's new text, or its new place (0 goes next). */
export async function updateQueuedMessage(wsId: string, sesId: string, messageId: string, change: { content?: string; position?: number }, auth: Auth = tabAuth): Promise<void> {
  await callNoContent(
    auth,
    queuedPath(wsId, sesId, messageId),
    { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(change) },
    "That message couldn't be changed",
  );
}

/** `DELETE …/queue/:messageId`. */
export async function removeQueuedMessage(wsId: string, sesId: string, messageId: string, auth: Auth = tabAuth): Promise<void> {
  await callNoContent(auth, queuedPath(wsId, sesId, messageId), { method: 'DELETE' }, "That message couldn't be removed");
}

/** `POST …/queue/:messageId/send-now`. */
export async function sendQueuedMessageNow(wsId: string, sesId: string, messageId: string, auth: Auth = tabAuth): Promise<void> {
  await callNoContent(auth, apiPath(API_ROUTES.sessionQueuedMessageSendNow, { wsId, sesId, messageId }), postJson({}), "That message couldn't be sent now");
}
