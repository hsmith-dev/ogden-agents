/**
 * The "a newer version is available" notice (story 13.7, E13-R7): what the
 * server reports about npm's newer versions, and the switch for the check.
 */
import { z } from 'zod';

/** How this install was started, so the notice shows the right command. */
export const InstallMethod = z.enum(['npx', 'global', 'other']);
export type InstallMethod = z.infer<typeof InstallMethod>;

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
  /** ISO 8601 UTC of the last check that reached npm, or `null`. */
  lastCheckedAt: z.string().nullable(),
  available: z.object({ version: z.string(), tag: z.enum(['latest', 'next']) }).nullable(),
});
export type UpdateNoticeResponse = z.infer<typeof UpdateNoticeResponse>;

/** `PUT /api/v1/updates`. */
export const SetUpdateCheckRequest = z.object({ enabled: z.boolean() });
export type SetUpdateCheckRequest = z.infer<typeof SetUpdateCheckRequest>;

/** `POST /api/v1/updates/check`: the notice after the check, and how it went. */
export const UpdateCheckResponse = z.object({ outcome: UpdateCheckOutcome, notice: UpdateNoticeResponse });
export type UpdateCheckResponse = z.infer<typeof UpdateCheckResponse>;
