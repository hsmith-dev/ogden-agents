/**
 * The server's notification wiring (story 11.4; split from `start.ts`, story
 * 11.5): webhooks whose addresses live in the keychain, sent through
 * `notify-webhook` (a test passes its own notifier through `StartOptions`).
 */
import { createWebhookNotifier } from '@ogden-agents/adapters';
import { CoreError, workspaceRepoPath, type Core, type Notifications, type SecretStorePort, type TicketStorePort } from '@ogden-agents/core';
import type { Logger } from './log.js';
import type { StartOptions } from './start-types.js';

export function createNotificationsWiring({
  options,
  core,
  log,
  secrets,
  ticketStore,
}: {
  options: StartOptions;
  core: Core;
  log: Logger;
  secrets: SecretStorePort;
  ticketStore: TicketStorePort;
}): Notifications {
  return core.createNotifications({
    secrets,
    notifier: options.notifier ?? createWebhookNotifier(),
    // The ticket's title for a payload, from the project's own files; any failure sends none.
    titleOf: async (workspaceId, ref) => {
      const scripts = await core.bmadScriptTrust.requireScriptsUnchanged(workspaceId);
      return (await ticketStore.find(workspaceRepoPath(core.entities, workspaceId), ref, { scripts })).title;
    },
    // Codes and the status only: never the URL or the answer (AD-16).
    onSent: (record) => log.info('webhook sent', { webhookId: record.webhookId, event: record.event, ok: record.ok, status: record.status, failure: record.failure }),
    onError: (step, error) => log.warn('a notification step failed', { step, code: error instanceof CoreError ? error.code : 'unexpected' }),
  });
}
