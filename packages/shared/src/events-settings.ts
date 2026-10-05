/**
 * Install-level settings events (permission modes; moved out of `events.ts`
 * by story 4.13 to keep it under 600 lines), re-exported from `events.ts`.
 */
import { z } from 'zod';
import { AgentId, SETTINGS_STREAM } from './events-common.js';
import { ModelId } from './entities.js';
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

export const SettingsAgentDefaultModelChangedInput = z.object({
  type: z.literal('settings.agent_default_model_changed'),
  ...onSettingsStream,
  payload: z.object({ agentId: AgentId, model: ModelId.nullable(), previous: ModelId.nullable() }),
});
/**
 * The model new chats with an agent start on, install-wide (story 11;
 * Settings → Agents), was set or cleared (`null`: the agent's own choice).
 * A project's own default for the agent wins over it.
 */
export const SettingsAgentDefaultModelChangedEvent = SettingsAgentDefaultModelChangedInput.extend(assigned);
export type SettingsAgentDefaultModelChangedEvent = z.infer<typeof SettingsAgentDefaultModelChangedEvent>;
