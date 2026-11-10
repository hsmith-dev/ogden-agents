/**
 * Tracker accounts (CAP-35, epic 27; AD-11, AD-16): install-level rows of
 * kind, label and scope, and each account's token in `SecretStorePort`
 * only. Adding tests the token first, stores it, then the row (a failed
 * row removes the token again); removing deletes the row, then the token.
 * Reading issues fetches them through `TrackerPort` with the token read
 * at each call. Nothing here needs the project to be a git repository.
 */
import {
  AddTrackerAccountRequest,
  IssueKey,
  IssuesQuery,
  MAX_TRACKER_ACCOUNTS,
  SETTINGS_STREAM,
  TRACKER_SECRETS_UNAVAILABLE_MESSAGE,
  TRACKER_TOKEN_MISSING_MESSAGE,
  TrackerAccount as TrackerAccountSchema,
  trackerTokenName,
  type Issue,
  type TrackerAccount,
  type TrackerAccountId,
} from '@ogden-agents/shared';
import { eq } from 'drizzle-orm';
import type { Database } from './db/database.js';
import { trackerAccounts } from './db/schema.js';
import { NotFoundError, refuseInvalid, SecretsUnavailableError, secretsUnavailable, ValidationError } from './errors.js';
import type { EventLog } from './event-log.js';
import { newId } from './ids.js';
import { buildIssueContext, type IssueContext } from './issue-context.js';
import type { SecretStorePort } from './secret-store-port.js';
import type { TrackerCall, TrackerPort } from './tracker-port.js';

export interface TrackerAccounts {
  /** Every account, oldest first. Never a token. */
  list(): TrackerAccount[];
  /** Tests the token, keeps it in the keychain, and adds the account (`AddTrackerAccountRequest`). */
  add(request: unknown): Promise<TrackerAccount>;
  /** Removes the account and its token. `NotFoundError` for no such account. */
  remove(id: TrackerAccountId): Promise<void>;
  /** Recent open issues, or those matching `q` (`IssuesQuery`). */
  issues(id: TrackerAccountId, query: unknown): Promise<Issue[]>;
  /** The issue fetched again, its context block and the chat's name (E27-R3, E27-R4). */
  issueContext(id: TrackerAccountId, key: unknown): Promise<IssueContext & { issue: Issue }>;
}

export interface TrackerAccountsOptions {
  db: Database;
  events: EventLog;
  secrets: SecretStorePort;
  trackers: TrackerPort;
  now?: () => Date;
}

export function createTrackerAccounts({ db, events, secrets, trackers, now = () => new Date() }: TrackerAccountsOptions): TrackerAccounts {
  const { orm } = db;
  const all = (): TrackerAccount[] =>
    orm
      .select()
      .from(trackerAccounts)
      .all()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .flatMap((row) => {
        // A damaged row is left out rather than failing the whole list.
        const parsed = TrackerAccountSchema.safeParse(row);
        return parsed.success ? [parsed.data] : [];
      });
  const rowOf = (id: TrackerAccountId): TrackerAccount => {
    const found = all().find((each) => each.id === id);
    if (found === undefined) throw new NotFoundError('tracker account', id);
    return found;
  };
  const tooMany = () => new ValidationError(`You can keep up to ${MAX_TRACKER_ACCOUNTS} tracker accounts. Remove one first.`, []);
  /** The account's call, its token read from the keychain now. */
  const callOf = async (account: TrackerAccount): Promise<TrackerCall> => {
    let token: string | undefined;
    try {
      token = await secrets.get(trackerTokenName(account.id));
    } catch (error) {
      throw secretsUnavailable(error);
    }
    if (token === undefined) throw new SecretsUnavailableError(TRACKER_TOKEN_MISSING_MESSAGE);
    return { kind: account.kind, token, scope: account.scope };
  };

  return {
    list: all,

    async add(request) {
      const parsed = AddTrackerAccountRequest.safeParse(request);
      if (!parsed.success) return refuseInvalid(parsed.error, 'That account can not be added.');
      const input = parsed.data;
      const scope = input.scope === undefined || input.scope === '' ? null : input.scope;
      if (all().length >= MAX_TRACKER_ACCOUNTS) throw tooMany();
      // The token must read issues before anything is kept (TrackerError otherwise).
      await trackers[input.kind].verify({ kind: input.kind, token: input.token, scope });
      const id = newId('trk');
      try {
        await secrets.set(trackerTokenName(id), input.token);
      } catch (error) {
        // The tracker's own sentence (the default speaks of agent sign-in); the cause is kept for the log.
        const cause = secretsUnavailable(error).cause;
        throw new SecretsUnavailableError(TRACKER_SECRETS_UNAVAILABLE_MESSAGE, typeof cause === 'string' ? { cause } : {});
      }
      try {
        return events.transaction(() => {
          if (all().length >= MAX_TRACKER_ACCOUNTS) throw tooMany();
          orm.insert(trackerAccounts).values({ id, kind: input.kind, label: input.label, scope, createdAt: now().toISOString() }).run();
          events.append({ type: 'settings.tracker_accounts_changed', workspaceId: null, streamId: SETTINGS_STREAM, payload: { accountId: id, change: 'added' } });
          return rowOf(id);
        });
      } catch (error) {
        await secrets.delete(trackerTokenName(id)).catch(() => {});
        throw error;
      }
    },

    async remove(id) {
      rowOf(id);
      events.transaction(() => {
        orm.delete(trackerAccounts).where(eq(trackerAccounts.id, id)).run();
        events.append({ type: 'settings.tracker_accounts_changed', workspaceId: null, streamId: SETTINGS_STREAM, payload: { accountId: id, change: 'removed' } });
      });
      await secrets.delete(trackerTokenName(id)).catch(() => {});
    },

    async issues(id, query) {
      const parsed = IssuesQuery.safeParse(query ?? {});
      if (!parsed.success) return refuseInvalid(parsed.error, 'That search can not be used.');
      const account = rowOf(id);
      const q = parsed.data.q;
      return trackers[account.kind].issues(await callOf(account), q === undefined || q === '' ? undefined : q);
    },

    async issueContext(id, key) {
      const parsed = IssueKey.safeParse(key);
      if (!parsed.success) return refuseInvalid(parsed.error, 'That is not an issue.');
      const account = rowOf(id);
      const issue = await trackers[account.kind].issue(await callOf(account), parsed.data);
      return { issue, ...buildIssueContext(issue) };
    },
  };
}
