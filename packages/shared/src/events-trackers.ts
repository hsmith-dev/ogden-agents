/**
 * Tracker account events (CAP-35, epic 27), re-exported from `events.ts`.
 * Never a token, label or scope: the page that follows one reads the list again.
 */
import { z } from 'zod';
import { SETTINGS_STREAM } from './events-common.js';
import { assigned } from './events-envelope.js';
import { TrackerAccountId } from './ids.js';

export const TRACKER_ACCOUNT_CHANGES = ['added', 'removed'] as const;

export const SettingsTrackerAccountsChangedInput = z.object({
  type: z.literal('settings.tracker_accounts_changed'),
  workspaceId: z.null(),
  streamId: z.literal(SETTINGS_STREAM),
  payload: z.object({ accountId: TrackerAccountId, change: z.enum(TRACKER_ACCOUNT_CHANGES) }),
});
/** A tracker account was added or removed (every tab reads the list again). */
export const SettingsTrackerAccountsChangedEvent = SettingsTrackerAccountsChangedInput.extend(assigned);
export type SettingsTrackerAccountsChangedEvent = z.infer<typeof SettingsTrackerAccountsChangedEvent>;
