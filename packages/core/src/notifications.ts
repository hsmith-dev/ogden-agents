/**
 * Notifications for builds (story 11.4; AD-1, AD-16): the install's webhooks
 * and what is sent to them. A webhook is a URL the user added, kept through
 * `SecretStorePort` (it usually carries a token: nothing here ever logs it,
 * answers it, puts it in an event or in a payload); the database keeps only
 * its id, its host as it may be shown (masked) and the events it gets.
 *
 * What is sent: a blocked run (`blocked`) and a run ready for review
 * (`ready_for_review`), from the run's own events, and only for a workspace
 * with Unattended builds on (E11-R1). The payload names the project, the
 * ticket's ref and title, the event and one plain sentence; never code, a
 * diff, a path or a secret. Sending never throws and never blocks a run: each
 * result is reported to `onSent` (codes only) and goes nowhere else.
 * Settings are install-level, so none of this is piece-guarded.
 */
import {
  AddWebhookRequest,
  blockedSentence,
  MAX_WEBHOOKS,
  NotificationSettings,
  UpdateNotificationSettingsRequest,
  UpdateWebhookRequest,
  WEBHOOK_TEST_TEXT,
  WebhookId as WebhookIdSchema,
  WebhookTarget as WebhookTargetSchema,
  runPhase,
  type NotificationEvent,
  type Run,
  type WebhookPayload,
  type WebhookTarget,
  type WebhookTestResult,
  type WorkspaceId,
} from '@ogden-agents/shared';
import { eq } from 'drizzle-orm';
import type { BmadFeatures } from './bmad-pieces.js';
import type { Database } from './db/database.js';
import { notificationSettings, notificationWebhooks } from './db/schema.js';
import type { Entities } from './entities.js';
import { NotFoundError, ValidationError } from './errors.js';
import type { EventLog } from './event-log.js';
import { newId } from './ids.js';
import type { NotifierPort } from './notifier-port.js';
import type { SecretStorePort } from './secret-store-port.js';

const ROW_ID = 1;

/** The name a webhook's secret is kept under. */
const secretName = (id: string) => `webhook:${id}`;

const SECOND_LEVELS: ReadonlySet<string> = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'or', 'ne', 'go']);

/**
 * A host as it may be listed back: some providers put the token in the host
 * name, so only the registrable domain shows ("hooks.slack.com" shows as
 * "slack.com"; "abc123.example.co.uk" as "example.co.uk"); this computer and
 * an address say what they are, not which.
 */
export function maskedHost(hostname: string): string {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '::1' || /^127\./.test(host)) return 'this computer';
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) return 'an IP address';
  const labels = host.split('.').filter((label) => label !== '');
  if (labels.length <= 2) return labels.join('.') || 'a web address';
  const [second, tld] = [labels.at(-2)!, labels.at(-1)!];
  // A well known second level under a country code (co.uk, com.au) is part of the suffix; any other short label may be a token.
  const keep = tld.length === 2 && SECOND_LEVELS.has(second) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

export interface SentRecord {
  webhookId: string;
  event: WebhookPayload['event'];
  ok: boolean;
  status: number | null;
  failure: WebhookTestResult['failure'];
}

export interface Notifications {
  /** The settings, without any URL. */
  settings(): NotificationSettings;
  /** Browser notifications on or off (`UpdateNotificationSettingsRequest`). */
  setBrowserNotifications(request: unknown): NotificationSettings;
  /** Adds a webhook (`AddWebhookRequest`): its URL goes to the keychain first; `SecretsUnavailableError` and nothing stored without one. */
  addWebhook(request: unknown): Promise<NotificationSettings>;
  /** Changes the events a webhook gets (`UpdateWebhookRequest`). `NotFoundError` for an unknown one. */
  updateWebhook(id: unknown, request: unknown): NotificationSettings;
  /** Removes a webhook and its saved URL. `NotFoundError` for an unknown one. */
  removeWebhook(id: unknown): Promise<void>;
  /** Sends a test payload to one webhook and answers what came back. Never throws for the send itself. */
  testWebhook(id: unknown): Promise<WebhookTestResult>;
  /** Resolves once every send started so far is done (tests, shutdown). */
  settled(): Promise<void>;
  close(): void;
}

export interface NotificationsDeps {
  db: Database;
  events: Pick<EventLog, 'subscribe' | 'lastSeq'>;
  entities: Pick<Entities, 'getRun' | 'getWorkspace'>;
  bmad: Pick<BmadFeatures, 'requireBmadFeature'>;
  secrets: SecretStorePort;
  notifier: NotifierPort;
  /** The ticket's title for the payload; any failure sends an empty title. Default: none. */
  titleOf?: (workspaceId: WorkspaceId, ref: string) => Promise<string>;
  now?: () => Date;
  /** Told each send's result (codes and status only, never the URL). */
  onSent?: (record: SentRecord) => void;
  onError?: (step: string, error: unknown) => void;
}

function workspaceNameOf(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  return trimmed.split(/[\\/]/).at(-1) || trimmed || path;
}

/** What the server adds to core's own parts: the keychain, the sender and the logging. */
export type NotificationsPorts = Omit<NotificationsDeps, 'db' | 'events' | 'entities' | 'bmad'>;

export function createNotifications(deps: NotificationsDeps): Notifications {
  const { db, secrets, notifier, entities } = deps;
  const { orm } = db;
  const now = deps.now ?? (() => new Date());
  const pending = new Set<Promise<void>>();
  const report = (step: string, error: unknown) => {
    try {
      deps.onError?.(step, error);
    } catch {
      // Logging never stops a notification.
    }
  };

  const targets = (): WebhookTarget[] =>
    orm
      .select()
      .from(notificationWebhooks)
      .all()
      .flatMap((row) => {
        try {
          const events = JSON.parse(row.events) as unknown;
          const parsed = WebhookTargetSchema.safeParse({ id: row.id, host: row.host, events, createdAt: row.createdAt });
          return parsed.success ? [parsed.data] : [];
        } catch {
          return [];
        }
      });
  const read = (): NotificationSettings => {
    const row = orm.select().from(notificationSettings).where(eq(notificationSettings.id, ROW_ID)).get();
    return NotificationSettings.parse({ webhooks: targets(), browserNotifications: row?.browserNotifications ?? false });
  };
  const validId = (id: unknown) => {
    const parsed = WebhookIdSchema.safeParse(id);
    if (!parsed.success) throw new NotFoundError('webhook', String(id).slice(0, 40));
    return parsed.data;
  };
  const find = (id: unknown): WebhookTarget => {
    const valid = validId(id);
    const found = targets().find((target) => target.id === valid);
    if (found === undefined) throw new NotFoundError('webhook', valid);
    return found;
  };
  const refuse = (error: { issues: Array<{ path: PropertyKey[]; message: string }> }): never => {
    const issue = error.issues[0];
    throw new ValidationError(issue?.message ?? 'That is not a valid request.', error.issues.map((each) => ({ path: each.path, message: each.message })));
  };

  const payloadFor = async (run: Run, event: 'blocked' | 'ready_for_review'): Promise<WebhookPayload | undefined> => {
    const workspace = entities.getWorkspace(run.workspaceId);
    if (workspace === undefined) return undefined;
    let title = '';
    try {
      title = ((await deps.titleOf?.(run.workspaceId, run.ticketRef)) ?? '').slice(0, 300);
    } catch (error) {
      report('title', error);
    }
    const sentence = event === 'blocked' && run.blockedCode !== null ? ` ${blockedSentence(run.blockedCode)}` : '';
    const text = event === 'blocked' ? `Build ${run.ticketRef} is blocked.${sentence}` : `Build ${run.ticketRef} is ready for review.`;
    return {
      version: 1,
      event,
      workspace: { id: run.workspaceId, name: workspaceNameOf(workspace.realPath ?? workspace.path).slice(0, 200) || 'Project' },
      ticket: { ref: run.ticketRef, title },
      run: { id: run.id, phase: runPhase(run), blockedCode: run.blockedCode },
      text: text.slice(0, 500),
      sentAt: now().toISOString(),
    };
  };

  const sendOne = async (target: WebhookTarget, payload: WebhookPayload): Promise<WebhookTestResult | undefined> => {
    let url: string | undefined;
    try {
      url = await secrets.get(secretName(target.id));
    } catch (error) {
      report('webhook secret', error);
      return undefined;
    }
    if (url === undefined) return undefined;
    const result = await notifier.send(url, payload);
    try {
      deps.onSent?.({ webhookId: target.id, event: payload.event, ok: result.ok, status: result.status, failure: result.failure });
    } catch {
      // Logging never stops a notification.
    }
    return result;
  };

  const notify = async (run: Run, event: 'blocked' | 'ready_for_review'): Promise<void> => {
    try {
      deps.bmad.requireBmadFeature(run.workspaceId, 'builds');
    } catch {
      // Builds are off for this project: nothing is sent (E11-R1).
      return;
    }
    const subscribed = targets().filter((target) => target.events.includes(event));
    if (subscribed.length === 0) return;
    const payload = await payloadFor(run, event);
    if (payload === undefined) return;
    await Promise.all(subscribed.map((target) => sendOne(target, payload).catch((error: unknown) => report('send', error))));
  };

  const unsubscribe = deps.events.subscribe(deps.events.lastSeq(), (event) => {
    if (event.type !== 'run.outcome_changed') return;
    const { runId, outcome, previous, blockedCode } = event.payload;
    // A run that quit with the server was not stopped by a problem, and a repeated write says nothing new.
    if (outcome === previous || (outcome !== 'blocked' && outcome !== 'verified') || blockedCode === 'interrupted') return;
    const run = entities.getRun(runId);
    if (run === undefined || run.outcome !== outcome) return;
    const work: Promise<void> = notify(run, outcome === 'blocked' ? 'blocked' : 'ready_for_review')
      .catch((error: unknown) => report('notify', error))
      .finally(() => pending.delete(work));
    pending.add(work);
  });

  let adding: Promise<void> = Promise.resolve();
  const addOne = async (request: unknown): Promise<NotificationSettings> => {
    const parsed = AddWebhookRequest.safeParse(request);
    if (!parsed.success) return refuse(parsed.error);
    if (targets().length >= MAX_WEBHOOKS) throw new ValidationError(`You can add at most ${MAX_WEBHOOKS} webhooks.`, [{ path: ['url'], message: `You can add at most ${MAX_WEBHOOKS} webhooks.` }]);
    const id = newId('hook');
    // The keychain first: with none, nothing is stored and the user is told why (AD-16).
    await secrets.set(secretName(id), parsed.data.url);
    try {
      orm
        .insert(notificationWebhooks)
        .values({ id, host: maskedHost(new URL(parsed.data.url).hostname), events: JSON.stringify([...new Set(parsed.data.events)]), createdAt: now().toISOString() })
        .run();
    } catch (error) {
      await secrets.delete(secretName(id)).catch(() => undefined);
      throw error;
    }
    return read();
  };

  return {
    settings: read,

    setBrowserNotifications(request) {
      const parsed = UpdateNotificationSettingsRequest.safeParse(request);
      if (!parsed.success) return refuse(parsed.error);
      orm
        .insert(notificationSettings)
        .values({ id: ROW_ID, browserNotifications: parsed.data.browserNotifications })
        .onConflictDoUpdate({ target: notificationSettings.id, set: { browserNotifications: parsed.data.browserNotifications } })
        .run();
      return read();
    },

    addWebhook(request) {
      // One add at a time, so two at once cannot both pass the cap (story 11.5).
      const run = adding.then(() => addOne(request));
      adding = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },

    updateWebhook(id, request) {
      const target = find(id);
      const parsed = UpdateWebhookRequest.safeParse(request);
      if (!parsed.success) return refuse(parsed.error);
      orm.update(notificationWebhooks).set({ events: JSON.stringify([...new Set(parsed.data.events)]) }).where(eq(notificationWebhooks.id, target.id)).run();
      return read();
    },

    async removeWebhook(id) {
      const target = find(id);
      orm.delete(notificationWebhooks).where(eq(notificationWebhooks.id, target.id)).run();
      // A keychain that can't be reached leaves its entry behind; the webhook is already gone.
      await secrets.delete(secretName(target.id)).catch((error: unknown) => report('webhook secret delete', error));
    },

    async testWebhook(id) {
      const target = find(id);
      const url = await secrets.get(secretName(target.id));
      const payload: WebhookPayload = { version: 1, event: 'test', workspace: null, ticket: null, run: null, text: WEBHOOK_TEST_TEXT, sentAt: now().toISOString() };
      if (url === undefined) return { ok: false, status: null, failure: 'refused', message: "The saved address couldn't be found in your keychain. Remove this webhook and add it again." };
      const result = await notifier.send(url, payload);
      try {
        deps.onSent?.({ webhookId: target.id, event: 'test', ok: result.ok, status: result.status, failure: result.failure });
      } catch {
        // Logging never stops a test.
      }
      return result;
    },

    async settled() {
      while (pending.size > 0) await Promise.all([...pending]);
    },

    close() {
      unsubscribe();
    },
  };
}

export type { NotificationEvent };
