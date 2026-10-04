/**
 * Install-level settings events (permission modes; moved out of `events.ts`
 * by story 4.13 to keep it under 600 lines), re-exported from `events.ts`.
 */
import { z } from 'zod';
import { SETTINGS_STREAM } from './events-common.js';
import { assigned } from './events-envelope.js';

const onSettingsStream = { workspaceId: z.null(), streamId: z.literal(SETTINGS_STREAM) };

export const SettingsDeveloperModeChangedInput = z.object({
  type: z.literal('settings.developer_mode_changed'),
  ...onSettingsStream,
  payload: z.object({ developerMode: z.boolean(), previous: z.boolean() }),
});
/**
 * Developer mode was turned on or off (install-level; every tab follows it).
 * Turning it off drops every Skip-all chat to Ask in the same transaction.
 */
export const SettingsDeveloperModeChangedEvent = SettingsDeveloperModeChangedInput.extend(assigned);
export type SettingsDeveloperModeChangedEvent = z.infer<typeof SettingsDeveloperModeChangedEvent>;
