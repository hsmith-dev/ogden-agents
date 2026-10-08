/**
 * A workspace's linked Jira board (epic 18, stories 3-4; CAP-26, AD-29): the
 * "Link a Jira board" use-case. The token alone is the secret
 * (`jiraCredentialName`, AD-16's `SecretStorePort`); the site URL, email,
 * resolved base URL, and project key are ordinary workspace settings in the
 * `jira_links` row (never the keychain). Jira's own REST shapes stay inside
 * the `tickets-jira` adapter (AD-27, AD-12): this module calls out to
 * {@link JiraLinkPort}, a vendor-neutral "test this credential" port, never
 * Jira's API directly.
 *
 * Whole-value redaction (AD-16, AD-29, the architecture security review's
 * finding 1): nothing here ever puts the token, email, or site URL into a
 * thrown error's own fields in a way a generic error logger could echo
 * verbatim — every rejection is one of the fixed, parameter-free error
 * classes below.
 */
import { eq } from 'drizzle-orm';
import { jiraCredentialName, JIRA_UNAUTHORIZED_MESSAGE, JIRA_UNREACHABLE_MESSAGE, JIRA_ALREADY_LINKED_MESSAGE, LinkJiraBoardRequest, type JiraLinkSettings, type WorkspaceId } from '@ogden-agents/shared';
import type { Database } from './db/database.js';
import { jiraLinks } from './db/schema.js';
import { CoreError, SecretsUnavailableError, ValidationError } from './errors.js';
import type { EventLog } from './event-log.js';
import { JiraUrlRejectedError, type JiraHostLookup } from './jira-url-guard.js';
import { checkJiraSiteUrl } from './jira-url-guard.js';
import type { SecretStorePort } from './secret-store-port.js';

/** The pre-save test call and base-URL resolution (AD-29): implemented by the `tickets-jira` adapter, never called directly from here. */
export interface JiraLinkPort {
  /**
   * Resolves whether `siteUrl`'s token is a classic or scoped one and makes
   * the one read-only test call (`GET /rest/api/3/myself` or the Data
   * Center equivalent). Resolves with the base URL every later call uses.
   * Rejects with {@link JiraUnauthorizedError} or {@link JiraUnreachableError}.
   */
  testConnection(params: { siteUrl: string; email: string; token: string; projectKey: string }): Promise<{ baseUrl: string }>;
}

/** Jira refused the email/token at the pre-save test call (401/403). */
export class JiraUnauthorizedError extends CoreError {
  override readonly name = 'JiraUnauthorizedError';
  constructor() {
    super('jira_unauthorized', JIRA_UNAUTHORIZED_MESSAGE);
  }
}

/** The test call could not complete at all (network, timeout, an unexpected response shape). */
export class JiraUnreachableError extends CoreError {
  override readonly name = 'JiraUnreachableError';
  constructor() {
    super('jira_unreachable', JIRA_UNREACHABLE_MESSAGE);
  }
}

/** The workspace already has a linked board; unlink it first (AD-29: one credential per board). */
export class JiraAlreadyLinkedError extends CoreError {
  override readonly name = 'JiraAlreadyLinkedError';
  constructor() {
    super('jira_already_linked', JIRA_ALREADY_LINKED_MESSAGE);
  }
}

export interface JiraLinksOptions {
  db: Database;
  events: EventLog;
  secrets: SecretStorePort;
  jira: JiraLinkPort;
  /** Resolves a hostname's addresses for {@link checkJiraSiteUrl}. Default: the OS resolver (`dns/promises`, `{ all: true }`). Tests inject a fake so nothing reaches the network. */
  lookup?: JiraHostLookup;
  now?: () => Date;
}

export interface JiraLinks {
  /** The workspace's linked board, or `null`. */
  get(workspaceId: WorkspaceId): JiraLinkSettings | null;
  /**
   * Links a board (`LinkJiraBoardRequest`): checks the site URL (https
   * only, no redirect, no loopback/link-local/private-range target —
   * {@link checkJiraSiteUrl}), then makes the one read-only test call
   * through {@link JiraLinkPort.testConnection}; only on success does the
   * token go into the keychain (`jiraCredentialName`) and the row into
   * `jira_links`, token first, so a row is never saved over a key that
   * failed to save. Rejects {@link ValidationError} for a malformed
   * request, {@link JiraUrlRejectedError} for a refused site URL,
   * {@link JiraUnauthorizedError}/{@link JiraUnreachableError} for a failed
   * test call, {@link JiraAlreadyLinkedError} when the workspace already
   * has a board linked, and {@link SecretsUnavailableError} when the
   * keychain refuses the token. Every refusal saves nothing.
   */
  link(workspaceId: WorkspaceId, request: unknown): Promise<JiraLinkSettings>;
  /** Deletes the keychain credential immediately and the settings row; the workspace's already-synced tickets are untouched (they stay plain local files). A workspace with no link does nothing. */
  unlink(workspaceId: WorkspaceId): Promise<void>;
}

function rowToSettings(row: typeof jiraLinks.$inferSelect): JiraLinkSettings {
  return { siteUrl: row.siteUrl, email: row.email, baseUrl: row.baseUrl, projectKey: row.projectKey, lastSyncedAt: row.lastSyncedAt, lastSyncError: row.lastSyncError };
}

export function createJiraLinks({ db, events, secrets, jira, lookup, now = () => new Date() }: JiraLinksOptions): JiraLinks {
  const { orm } = db;
  const rowOf = (workspaceId: WorkspaceId) => orm.select().from(jiraLinks).where(eq(jiraLinks.workspaceId, workspaceId)).get();
  const note = (workspaceId: WorkspaceId, change: 'linked' | 'unlinked' | 'sync_succeeded' | 'sync_failed') =>
    events.append({ type: 'workspace.jira_link_changed', workspaceId, streamId: workspaceId, payload: { change } });

  return {
    get(workspaceId) {
      const row = rowOf(workspaceId);
      return row === undefined ? null : rowToSettings(row);
    },

    async link(workspaceId, request) {
      const parsed = LinkJiraBoardRequest.safeParse(request);
      if (!parsed.success) throw new ValidationError('That is not a usable Jira link.', parsed.error.issues.map((each) => ({ path: each.path, message: each.message })));
      if (rowOf(workspaceId) !== undefined) throw new JiraAlreadyLinkedError();
      const { siteUrl, email, token, projectKey } = parsed.data;

      // The guard: https only, no redirect, every resolved address public. Rejects with JiraUrlRejectedError.
      await checkJiraSiteUrl(siteUrl, lookup ?? defaultLookup);

      let baseUrl: string;
      try {
        ({ baseUrl } = await jira.testConnection({ siteUrl, email, token, projectKey }));
      } catch (error) {
        if (error instanceof JiraUnauthorizedError || error instanceof JiraUnreachableError) throw error;
        throw new JiraUnreachableError();
      }

      // The token first (local-endpoints.ts's pattern): a row is never saved over a key that failed to save.
      try {
        await secrets.set(jiraCredentialName(workspaceId), token);
      } catch (error) {
        throw error instanceof SecretsUnavailableError ? error : new SecretsUnavailableError(undefined, { cause: 'unexpected' });
      }
      try {
        return events.transaction(() => {
          orm.insert(jiraLinks).values({ workspaceId, siteUrl, email, baseUrl, projectKey, lastSyncedAt: null, lastSyncError: null, createdAt: now().toISOString() }).run();
          note(workspaceId, 'linked');
          return rowToSettings(rowOf(workspaceId)!);
        });
      } catch (error) {
        await secrets.delete(jiraCredentialName(workspaceId)).catch(() => {});
        throw error;
      }
    },

    async unlink(workspaceId) {
      if (rowOf(workspaceId) === undefined) return;
      // The keychain entry is removed immediately (AD-29), whatever happens to the row.
      await secrets.delete(jiraCredentialName(workspaceId)).catch((error: unknown) => {
        throw error instanceof SecretsUnavailableError ? error : new SecretsUnavailableError(undefined, { cause: 'unexpected' });
      });
      events.transaction(() => {
        orm.delete(jiraLinks).where(eq(jiraLinks.workspaceId, workspaceId)).run();
        note(workspaceId, 'unlinked');
      });
    },
  };
}

const defaultLookup: JiraHostLookup = async (host) => {
  const dns = await import('node:dns/promises');
  return (await dns.lookup(host, { all: true })).map((entry) => ({ address: entry.address, family: entry.family === 6 ? 6 : 4 }));
};
