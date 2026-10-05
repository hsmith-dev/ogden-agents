/**
 * The "a newer version is available" notice (story 13.7, E13-R7, and story
 * 13.14 for GitHub Releases): what the server reports about newer versions, and the switch for the check.
 */
import { z } from 'zod';
import { DesktopUpdateView, UpdateChannel } from './desktop-update.js';

/** How this install was started, so the notice shows the right command. `github` is an install made by the GitHub Releases helper. */
export const InstallMethod = z.enum(['npx', 'global', 'github', 'other']);
export type InstallMethod = z.infer<typeof InstallMethod>;

/** Where a newer version can be found: the GitHub Releases of this project, or npm's dist-tags. */
export const UpdateSourceName = z.enum(['github-releases', 'npm']);
export type UpdateSourceName = z.infer<typeof UpdateSourceName>;

/** What Check now found. */
export const UpdateCheckOutcome = z.enum(['newer', 'current', 'failed', 'offline']);
export type UpdateCheckOutcome = z.infer<typeof UpdateCheckOutcome>;

/** `GET /api/v1/updates` and `PUT`: the running version, its channel, the last check and any newer version. */
export const UpdateNoticeResponse = z.object({
  current: z.string(),
  channel: z.enum(['stable', 'preview']),
  installMethod: InstallMethod,
  /** Whether the check runs when Ogden starts. */
  enabled: z.boolean(),
  /** `OGDEN_AGENTS_OFFLINE` is set: Ogden makes no update check. */
  offline: z.boolean(),
  /** The sources the check asks: GitHub Releases always, and npm too unless this install came from GitHub Releases. */
  sources: z.array(UpdateSourceName),
  /** ISO 8601 UTC of the last check that reached a source, or `null`. */
  lastCheckedAt: z.string().nullable(),
  available: z.object({ version: z.string(), tag: z.enum(['latest', 'next']), source: UpdateSourceName }).nullable(),
  /** `desktop` when the server runs inside the desktop app (`OGDEN_AGENTS_SHELL=desktop`, set only by the app), else `null`. */
  shell: z.literal('desktop').nullable(),
  /** The desktop app's chosen update channel; `null` outside the app. */
  appChannel: UpdateChannel.nullable(),
  /** The desktop app's downloaded update, reported by its shell; `null` when none (and always in npm installs). */
  app: DesktopUpdateView.nullable(),
});
export type UpdateNoticeResponse = z.infer<typeof UpdateNoticeResponse>;

/** `PUT /api/v1/updates`. */
export const SetUpdateCheckRequest = z.object({ enabled: z.boolean() });
export type SetUpdateCheckRequest = z.infer<typeof SetUpdateCheckRequest>;

/** `POST /api/v1/updates/check`: the notice after the check, and how it went. */
export const UpdateCheckResponse = z.object({ outcome: UpdateCheckOutcome, notice: UpdateNoticeResponse });
export type UpdateCheckResponse = z.infer<typeof UpdateCheckResponse>;
