import { z } from 'zod';
import { BlockedCode, RunPhase } from './build-runs.js';
import { RunId, WebhookId, WorkspaceId } from './ids.js';
import { TICKET_REF_PATTERN } from './planning-board.js';
import { IsoUtcTimestamp } from './time.js';

/**
 * The settings builds and notifications keep (story 5.3 freezes them; 5.8
 * stores the run limits and the project's limit, 11.2 the project's test
 * command, 11.4 the notification settings), and the webhook payload. No UI
 * text here holds an em or en dash.
 */

// ---- Run limits (E5-R2, E5-R7; user decision 2026-10-01) ----

/** The defaults: 2 runs at a time per project, 3 per install, 45 minutes per run. */
export const RUN_LIMIT_DEFAULTS = { maxConcurrentRunsPerWorkspace: 2, maxConcurrentRunsPerInstall: 3, maxRunMinutes: 45 } as const;

/** The bounds a limit may be set within. */
export const RUN_LIMIT_BOUNDS = {
  maxConcurrentRunsPerWorkspace: { min: 1, max: 10 },
  maxConcurrentRunsPerInstall: { min: 1, max: 20 },
  maxRunMinutes: { min: 5, max: 480 },
} as const;

const bounded = (bounds: { min: number; max: number }, what: string) =>
  z
    .number()
    .int(`${what} is a whole number.`)
    .min(bounds.min, `${what} is at least ${bounds.min}.`)
    .max(bounds.max, `${what} is at most ${bounds.max}.`);

const perInstall = bounded(RUN_LIMIT_BOUNDS.maxConcurrentRunsPerInstall, 'Builds at a time');
const runMinutes = bounded(RUN_LIMIT_BOUNDS.maxRunMinutes, 'The time limit');
const perWorkspace = bounded(RUN_LIMIT_BOUNDS.maxConcurrentRunsPerWorkspace, 'Builds at a time in this project');

/** The install's limits (Settings): `GET` and `PATCH /api/v1/settings/run-limits`. */
export const RunLimitSettings = z.object({
  maxConcurrentRunsPerInstall: perInstall.default(RUN_LIMIT_DEFAULTS.maxConcurrentRunsPerInstall),
  maxRunMinutes: runMinutes.default(RUN_LIMIT_DEFAULTS.maxRunMinutes),
});
export type RunLimitSettings = z.infer<typeof RunLimitSettings>;
export const RunLimitSettingsResponse = z.object({ settings: RunLimitSettings });
export type RunLimitSettingsResponse = z.infer<typeof RunLimitSettingsResponse>;
export const UpdateRunLimitSettingsRequest = z
  .object({ maxConcurrentRunsPerInstall: perInstall.optional(), maxRunMinutes: runMinutes.optional() })
  .strict()
  .refine((request) => request.maxConcurrentRunsPerInstall !== undefined || request.maxRunMinutes !== undefined, 'Choose a setting to change.');
export type UpdateRunLimitSettingsRequest = z.infer<typeof UpdateRunLimitSettingsRequest>;

/** The most characters a project's test command may have. */
export const MAX_TEST_COMMAND_LENGTH = 500;
const testCommand = z
  .string()
  .trim()
  .min(1, 'Type a test command, or clear it to use the detected one.')
  .max(MAX_TEST_COMMAND_LENGTH, `A test command can be at most ${MAX_TEST_COMMAND_LENGTH} characters.`)
  .refine((text) => !/[\r\n\0]/.test(text), 'A test command is one line.');

/**
 * A project's build settings (Workspace settings; served behind the
 * `builds` piece): its limit (5.8) and the test command the verification
 * re-run uses instead of the detected one, `null` to detect it (11.2).
 * `GET` and `PATCH /api/v1/workspaces/:wsId/build-settings`.
 */
export const WorkspaceBuildSettings = z.object({
  maxConcurrentRuns: perWorkspace.default(RUN_LIMIT_DEFAULTS.maxConcurrentRunsPerWorkspace),
  testCommand: testCommand.nullable().default(null),
});
export type WorkspaceBuildSettings = z.infer<typeof WorkspaceBuildSettings>;
export const WorkspaceBuildSettingsResponse = z.object({ settings: WorkspaceBuildSettings });
export type WorkspaceBuildSettingsResponse = z.infer<typeof WorkspaceBuildSettingsResponse>;
export const UpdateWorkspaceBuildSettingsRequest = z
  .object({ maxConcurrentRuns: perWorkspace.optional(), testCommand: testCommand.nullable().optional() })
  .strict()
  .refine((request) => request.maxConcurrentRuns !== undefined || request.testCommand !== undefined, 'Choose a setting to change.');
export type UpdateWorkspaceBuildSettingsRequest = z.infer<typeof UpdateWorkspaceBuildSettingsRequest>;

// ---- Notifications (E11-R5; app-wide, never piece-guarded) ----

/** The events a webhook can be sent (EXPERIENCE.md Notifications settings). */
export const NOTIFICATION_EVENTS = ['blocked', 'ready_for_review'] as const;
export const NotificationEvent = z.enum(NOTIFICATION_EVENTS);
export type NotificationEvent = z.infer<typeof NotificationEvent>;
export const NOTIFICATION_EVENT_LABELS: Readonly<Record<NotificationEvent, string>> = { blocked: 'Blocked', ready_for_review: 'Ready for review' };

/** The most webhooks an install keeps, and the longest URL. */
export const MAX_WEBHOOKS = 10;
export const MAX_WEBHOOK_URL_LENGTH = 2048;

/** The WHATWG URL parser, present in Node and every browser (shared builds with neither lib's types). */
interface ParsedUrl {
  protocol: string;
  hostname: string;
  username: string;
  password: string;
}
const parseUrl = (text: string): ParsedUrl => new (globalThis as unknown as { URL: new (input: string) => ParsedUrl }).URL(text);

/** A webhook URL as the user types it: `https:` (or `http:` to this computer only). Kept through `SecretStorePort` (AD-16). */
export const WebhookUrl = z
  .string()
  .trim()
  .max(MAX_WEBHOOK_URL_LENGTH, 'That address is too long.')
  .refine((text) => {
    try {
      const url = parseUrl(text);
      if (url.username !== '' || url.password !== '') return false;
      if (url.protocol === 'https:') return true;
      return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    } catch {
      return false;
    }
  }, 'Use a web address that starts with https://.');

const webhookEvents = z.array(NotificationEvent).min(1, 'Choose at least one event.').max(NOTIFICATION_EVENTS.length);

/** A webhook as it is listed back: never its URL (a secret), only its host (story 11.4's assumption). */
export const WebhookTarget = z.object({
  id: WebhookId,
  host: z.string().min(1),
  events: webhookEvents,
  createdAt: IsoUtcTimestamp,
});
export type WebhookTarget = z.infer<typeof WebhookTarget>;

/** `GET` and `PATCH /api/v1/settings/notifications`. */
export const NotificationSettings = z.object({
  webhooks: z.array(WebhookTarget).max(MAX_WEBHOOKS).default([]),
  /** Opt-in browser notifications while a tab is open. */
  browserNotifications: z.boolean().default(false),
});
export type NotificationSettings = z.infer<typeof NotificationSettings>;
export const NotificationSettingsResponse = z.object({ settings: NotificationSettings });
export type NotificationSettingsResponse = z.infer<typeof NotificationSettingsResponse>;
export const UpdateNotificationSettingsRequest = z.object({ browserNotifications: z.boolean() }).strict();
export type UpdateNotificationSettingsRequest = z.infer<typeof UpdateNotificationSettingsRequest>;

/** `POST /api/v1/settings/notifications/webhooks` → 201 `NotificationSettingsResponse`. */
export const AddWebhookRequest = z.object({ url: WebhookUrl, events: webhookEvents }).strict();
export type AddWebhookRequest = z.infer<typeof AddWebhookRequest>;
/** `PATCH /api/v1/settings/notifications/webhooks/:webhookId`: its events. */
export const UpdateWebhookRequest = z.object({ events: webhookEvents }).strict();
export type UpdateWebhookRequest = z.infer<typeof UpdateWebhookRequest>;

/** What sending to a webhook did (Send test, and each send's record). `status` is the HTTP status, `null` when none came back. */
export const WEBHOOK_FAILURES = ['timeout', 'network', 'http', 'refused'] as const;
export const WebhookTestResult = z.object({
  ok: z.boolean(),
  status: z.number().int().min(100).max(599).nullable(),
  failure: z.enum(WEBHOOK_FAILURES).nullable(),
  /** Plain words for the inline result (EXPERIENCE.md Webhook test failed). */
  message: z.string().min(1),
});
export type WebhookTestResult = z.infer<typeof WebhookTestResult>;

/** How long a webhook send may take before it counts as failed. */
export const WEBHOOK_TIMEOUT_MS = 5000;

/**
 * What a webhook is sent (11.4): the workspace's name, the ticket's ref and
 * title, and the event. Never code, a diff, a path or a secret.
 */
export const WEBHOOK_PAYLOAD_EVENTS = ['blocked', 'ready_for_review', 'test'] as const;
export const WebhookPayload = z
  .object({
    version: z.literal(1),
    event: z.enum(WEBHOOK_PAYLOAD_EVENTS),
    workspace: z.object({ id: WorkspaceId, name: z.string().min(1).max(200) }).nullable(),
    ticket: z.object({ ref: z.string().regex(TICKET_REF_PATTERN), title: z.string().max(300) }).nullable(),
    run: z.object({ id: RunId, phase: RunPhase, blockedCode: BlockedCode.nullable() }).nullable(),
    /** One plain sentence ("Build the thing is ready for review."). */
    text: z.string().min(1).max(500),
    sentAt: IsoUtcTimestamp,
  })
  .strict();
export type WebhookPayload = z.infer<typeof WebhookPayload>;

// ---- Plain sentences ----

export const WEBHOOK_TEST_SENT = 'Webhook test sent';
export const WEBHOOK_TEST_TEXT = 'This is a test from Ogden Agents.';
export const WEBHOOK_TIMEOUT_MESSAGE = "The webhook didn't answer in time.";
export const WEBHOOK_NETWORK_MESSAGE = "Ogden Agents couldn't reach the webhook.";
export const WEBHOOK_REFUSED_MESSAGE = "Ogden Agents won't send to that address.";
export const WEBHOOK_SECRETS_UNAVAILABLE_MESSAGE = "Ogden Agents can't keep a webhook address safely here: this computer has no usable keychain, so nothing was saved.";
export const WEBHOOK_KEYCHAIN_NO_READ_MESSAGE = "Ogden Agents couldn't read the saved address from your keychain, so nothing was sent.";
export const webhookHttpMessage = (status: number) => `The webhook answered with HTTP ${status}.`;
export const WEBHOOK_URL_HIDDEN = 'The address is kept in your keychain and not shown.';
export const RUN_LIMITS_LABEL = 'Builds at a time';
export const RUN_TIME_LIMIT_LABEL = 'Time limit per build (minutes)';
export const TEST_COMMAND_LABEL = 'Test command';
export const TEST_COMMAND_HINT = 'Leave empty to use the one Ogden Agents finds.';
