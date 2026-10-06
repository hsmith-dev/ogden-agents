/**
 * Install-level settings events (permission modes; moved out of `events.ts`
 * by story 4.13 to keep it under 600 lines), re-exported from `events.ts`.
 */
import { z } from 'zod';
import { AgentId, SETTINGS_STREAM, WhileWorking } from './events-common.js';
import { ModelId } from './entities.js';
import { assigned } from './events-envelope.js';
import { TeamRoster } from './team.js';

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

export const SettingsWhileWorkingChangedInput = z.object({
  type: z.literal('settings.while_working_changed'),
  ...onSettingsStream,
  payload: z.object({ whileWorking: WhileWorking, previous: WhileWorking }),
});
/**
 * The app-wide choice of what a message sent while the agent works does
 * (send now or wait) changed. A project's own choice wins over it.
 */
export const SettingsWhileWorkingChangedEvent = SettingsWhileWorkingChangedInput.extend(assigned);
export type SettingsWhileWorkingChangedEvent = z.infer<typeof SettingsWhileWorkingChangedEvent>;

export const SettingsTeamRosterDefaultChangedInput = z.object({
  type: z.literal('settings.team_roster_default_changed'),
  ...onSettingsStream,
  payload: z.object({ orchestrationRoster: TeamRoster, previousOrchestrationRoster: TeamRoster }),
});
/**
 * The roster new projects start with (epic 15, 15.5; install-level, beside the
 * default for new projects) changed. A project that exists keeps its own.
 */
export const SettingsTeamRosterDefaultChangedEvent = SettingsTeamRosterDefaultChangedInput.extend(assigned);
export type SettingsTeamRosterDefaultChangedEvent = z.infer<typeof SettingsTeamRosterDefaultChangedEvent>;

export const SettingsUpdateNoticeChangedInput = z.object({
  type: z.literal('settings.update_notice_changed'),
  ...onSettingsStream,
  payload: z.object({ available: z.string().nullable(), enabled: z.boolean() }),
});
/**
 * The update notice changed (story 13.7): a check finished, or its switch was
 * turned on or off. `available` is the newer version offered, if any. Every
 * tab follows it by reading the notice again.
 */
export const SettingsUpdateNoticeChangedEvent = SettingsUpdateNoticeChangedInput.extend(assigned);
export type SettingsUpdateNoticeChangedEvent = z.infer<typeof SettingsUpdateNoticeChangedEvent>;

export const AppUpdateAvailableInput = z.object({
  type: z.literal('app.update_available'),
  ...onSettingsStream,
  payload: z.object({ version: z.string(), channel: z.enum(['stable', 'next']), downloaded: z.boolean() }),
});
/**
 * The desktop app's shell reported an update (story 13.3, E13-R6): found, and
 * downloaded and verified once `downloaded` is true. Every tab follows it by
 * reading the update notice again.
 */
export const AppUpdateAvailableEvent = AppUpdateAvailableInput.extend(assigned);
export type AppUpdateAvailableEvent = z.infer<typeof AppUpdateAvailableEvent>;

export const AppUpdateRequestedInput = z.object({
  type: z.literal('app.update_requested'),
  ...onSettingsStream,
  payload: z.object({ version: z.string(), whenIdle: z.boolean() }),
});
/**
 * The user asked the desktop app to restart and install the update. `whenIdle`
 * is true when it waits for running work to finish.
 */
export const AppUpdateRequestedEvent = AppUpdateRequestedInput.extend(assigned);
export type AppUpdateRequestedEvent = z.infer<typeof AppUpdateRequestedEvent>;
