/**
 * The desktop app's update, as the server holds it (story 13.3, E13-R6; AD-20).
 * The Tauri shell checks, downloads and verifies an update itself, then reports
 * it to the server over the launcher calls; the web UI reads it from the server
 * and never talks to Tauri. The user's "Restart to update" goes back the same
 * way: to the server, which tells the shell only when nothing is busy.
 */
import { z } from 'zod';

/** Where the app looks for updates; matches npm's `latest` (stable) and `next` dist-tags. */
export const UpdateChannel = z.enum(['stable', 'next']);
export type UpdateChannel = z.infer<typeof UpdateChannel>;

/** Release notes are shown as plain text; a long body is cut at this many characters. */
export const MAX_UPDATE_NOTES = 4000;

/** `POST /launcher/app-update`: what the shell found, downloaded and verified. */
export const DesktopUpdateReport = z.object({
  version: z.string().min(1).max(64),
  notes: z.string().max(MAX_UPDATE_NOTES),
  channel: UpdateChannel,
  /** The update is downloaded and its signature and checksum checked: Restart can install it. */
  downloaded: z.boolean(),
  /**
   * Why the update could not be used (a failed download, signature, checksum or install), in plain
   * words. The running version keeps working. Absent when nothing went wrong.
   */
  failed: z.string().max(300).optional(),
});
export type DesktopUpdateReport = z.infer<typeof DesktopUpdateReport>;

/** What the UI is told: the update, whether Restart may go now, and whether the user already asked. */
export const DesktopUpdateView = z.object({
  update: DesktopUpdateReport,
  /** Restart is blocked while an agent turn or a build is running (the busy rule). */
  blocked: z.boolean(),
  /** How many sessions (and, once epic 5 registers them, builds) are working. */
  busy: z.number().int().min(0),
  /** The user asked to restart; it happens as soon as nothing is busy. */
  restartRequested: z.boolean(),
});
export type DesktopUpdateView = z.infer<typeof DesktopUpdateView>;

/** `PUT /api/v1/updates/app/channel`. */
export const SetUpdateChannelRequest = z.object({ channel: UpdateChannel });
export type SetUpdateChannelRequest = z.infer<typeof SetUpdateChannelRequest>;

/** `GET /launcher/update-channel` and `PUT /api/v1/updates/app/channel`. */
export const UpdateChannelResponse = z.object({ channel: UpdateChannel });
export type UpdateChannelResponse = z.infer<typeof UpdateChannelResponse>;

/** `POST /api/v1/updates/app/restart`: ask to restart now, or as soon as nothing is busy. */
export const RestartForUpdateRequest = z.object({ whenIdle: z.boolean().optional() });
export type RestartForUpdateRequest = z.infer<typeof RestartForUpdateRequest>;

/** `POST /api/v1/updates/app/restart` reply. `requested` is true once the shell will be told. */
export const RestartForUpdateResponse = z.object({ requested: z.boolean(), blocked: z.boolean(), busy: z.number().int().min(0) });
export type RestartForUpdateResponse = z.infer<typeof RestartForUpdateResponse>;

/** `GET /launcher/app-update`: the shell polls this. `restart` is true only when the user asked and nothing is busy. */
export const AppUpdateRequestResponse = z.object({ restart: z.boolean() });
export type AppUpdateRequestResponse = z.infer<typeof AppUpdateRequestResponse>;
