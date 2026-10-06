import {
  API_ROUTES,
  apiPath,
  NotificationSettingsResponse,
  WebhookTestResult,
  type NotificationEvent,
} from '@ogden-agents/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { call, callNoContent, postJson, type Auth } from '@/api/http';
import { tabAuth } from '@/auth/tab-token';

/** Settings: Notifications, the webhooks (story 11.4). A webhook's URL is sent once, when it is added, and never read back. */
export const WEBHOOKS_QUERY_KEY = ['notification-settings'] as const;

export const WEBHOOKS_LOAD_FAILED = "The webhooks couldn't be loaded.";
export const WEBHOOK_ADD_FAILED = "The webhook couldn't be added. Try again.";
export const WEBHOOK_SAVE_FAILED = "The change couldn't be saved. Try again.";
export const WEBHOOK_REMOVE_FAILED = "The webhook couldn't be removed. Try again.";
export const WEBHOOK_TEST_FAILED = "The test couldn't be sent. Try again.";

export async function fetchNotificationSettings(auth: Auth = tabAuth) {
  return NotificationSettingsResponse.parse(await call(auth, API_ROUTES.notificationSettings, {}, WEBHOOKS_LOAD_FAILED)).settings;
}

export async function addWebhook(url: string, events: readonly NotificationEvent[], auth: Auth = tabAuth) {
  return NotificationSettingsResponse.parse(await call(auth, API_ROUTES.notificationWebhooks, postJson({ url, events }), WEBHOOK_ADD_FAILED)).settings;
}

export async function updateWebhookEvents(webhookId: string, events: readonly NotificationEvent[], auth: Auth = tabAuth) {
  return NotificationSettingsResponse.parse(await call(auth, apiPath(API_ROUTES.notificationWebhook, { webhookId }), { ...postJson({ events }), method: 'PATCH' }, WEBHOOK_SAVE_FAILED)).settings;
}

export async function removeWebhook(webhookId: string, auth: Auth = tabAuth): Promise<void> {
  await callNoContent(auth, apiPath(API_ROUTES.notificationWebhook, { webhookId }), { method: 'DELETE' }, WEBHOOK_REMOVE_FAILED);
}

export async function testWebhook(webhookId: string, auth: Auth = tabAuth) {
  return WebhookTestResult.parse(await call(auth, apiPath(API_ROUTES.notificationWebhookTest, { webhookId }), { method: 'POST' }, WEBHOOK_TEST_FAILED));
}

export function useNotificationSettingsQuery() {
  return useQuery({ queryKey: WEBHOOKS_QUERY_KEY, queryFn: () => fetchNotificationSettings(), retry: false });
}

/** Writes a settings answer into the cache. */
export function useSetNotificationSettings() {
  const queryClient = useQueryClient();
  return (settings: Awaited<ReturnType<typeof fetchNotificationSettings>>) => queryClient.setQueryData(WEBHOOKS_QUERY_KEY, settings);
}
