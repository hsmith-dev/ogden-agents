/**
 * The Local model's endpoints (epic 14 story 14.3; E14-R2, E14-R6): the
 * OpenAI-compatible servers the user set up in Settings, Agents. Each is a
 * base URL with an optional key. Stored in SQLite without its key; the key
 * lives in the keychain as `agent-endpoint-key/<id>` through `SecretStorePort`
 * and is only ever read to hand to the one process or call that uses it
 * (AD-16): never in a row, an event, a log line or an answer.
 *
 * The confirmation rule: this computer (`localhost`, `127.x.x.x`, `::1`)
 * needs none. Any other host needs the user's confirmation, recorded per
 * endpoint and bound to the host (name and port): a changed address asks
 * again, and until it is given {@link LocalEndpoints.target} refuses, so no
 * chat, test or listing can reach a host nobody confirmed. Every change
 * appends `settings.local_endpoints_changed` (an id and what changed, never
 * an address or a key) in the same transaction.
 */
import {
  AddLocalEndpointRequest,
  ConfirmRemoteRequest,
  endpointKeyName,
  LOCAL_ENDPOINT_CHANGES,
  LocalEndpoint as LocalEndpointSchema,
  MAX_LOCAL_ENDPOINTS,
  readEndpointAddress,
  SetDefaultEndpointRequest,
  SetEndpointKeyRequest,
  SETTINGS_STREAM,
  UpdateLocalEndpointRequest,
  type LocalEndpoint,
  type LocalEndpointId,
  type LocalEndpointView,
} from '@ogden-agents/shared';
import { eq } from 'drizzle-orm';
import type { Database } from './db/database.js';
import { localEndpoints, localEndpointSettings } from './db/schema.js';
import { CoreError, NotFoundError, SecretsUnavailableError, ValidationError } from './errors.js';
import type { EventLog } from './event-log.js';
import { newId } from './ids.js';
import type { SecretStorePort } from './secret-store-port.js';

type Change = (typeof LOCAL_ENDPOINT_CHANGES)[number];

/** A host that is not this computer was not confirmed (or its address changed since): 409 `endpoint_confirmation_required`. */
export class EndpointConfirmationRequiredError extends CoreError {
  override readonly name = 'EndpointConfirmationRequiredError';
  constructor(readonly host: string) {
    super('endpoint_confirmation_required', `Confirm that your messages and project text may be sent to ${host} before using it.`);
  }
}

/** What a call or a chat needs of an endpoint, once it is allowed to be used. Holds the key: in memory only. */
export interface LocalEndpointTarget {
  endpointId: LocalEndpointId;
  baseUrl: string;
  key?: string | undefined;
  /** The model its chats start on, when one is chosen. */
  model?: string | undefined;
}

export interface LocalEndpoints {
  list(): LocalEndpointView[];
  defaultEndpointId(): LocalEndpointId | null;
  get(id: LocalEndpointId): LocalEndpointView;
  /** Adds one (`AddLocalEndpointRequest`). `ValidationError` for an unusable address, `EndpointConfirmationRequiredError` for another host without its `confirmHost`, `SecretsUnavailableError` when a key can't be kept. */
  add(request: unknown): Promise<LocalEndpointView>;
  /** Changes one (`UpdateLocalEndpointRequest`); a changed host drops the confirmation. */
  update(id: LocalEndpointId, request: unknown): Promise<LocalEndpointView>;
  /** Removes it and its key. */
  remove(id: LocalEndpointId): Promise<void>;
  setKey(id: LocalEndpointId, request: unknown): Promise<LocalEndpointView>;
  removeKey(id: LocalEndpointId): Promise<LocalEndpointView>;
  /** Records the user's confirmation for `host`, which must be the endpoint's current host. */
  confirm(id: LocalEndpointId, request: unknown): LocalEndpointView;
  setDefault(request: unknown): LocalEndpointId | null;
  /**
   * Where to call for `id` (default: the default endpoint, else the first). Reads the key from the keychain.
   * Rejects `EndpointConfirmationRequiredError` for an unconfirmed host, `NotFoundError` for no such endpoint, and
   * `SecretsUnavailableError` when a saved key can't be read. `undefined` when no endpoint is set up and none was named.
   */
  target(id?: LocalEndpointId): Promise<LocalEndpointTarget | undefined>;
}

export interface LocalEndpointsOptions {
  db: Database;
  events: EventLog;
  secrets: SecretStorePort;
  now?: () => Date;
}

const ROW_ID = 1;

export function createLocalEndpoints({ db, events, secrets, now = () => new Date() }: LocalEndpointsOptions): LocalEndpoints {
  const { orm } = db;
  const refuse = (error: { issues: Array<{ path: PropertyKey[]; message: string }> }, fallback: string): never => {
    const issue = error.issues[0];
    throw new ValidationError(issue?.message ?? fallback, error.issues.map((each) => ({ path: each.path, message: each.message })));
  };
  const unavailable = (error: unknown): SecretsUnavailableError => (error instanceof SecretsUnavailableError ? error : new SecretsUnavailableError(undefined, { cause: 'unexpected' }));

  const rowOf = (id: LocalEndpointId): LocalEndpoint => {
    const row = orm.select().from(localEndpoints).where(eq(localEndpoints.id, id)).get();
    // A damaged row (a bad name or address) counts as not there, as it does in the list.
    const parsed = row === undefined ? undefined : usable(row);
    if (parsed === undefined) throw new NotFoundError('endpoint', id);
    return parsed;
  };
  const usable = (row: unknown): LocalEndpoint | undefined => {
    const parsed = LocalEndpointSchema.safeParse(row);
    return parsed.success && readEndpointAddress(parsed.data.baseUrl).ok ? parsed.data : undefined;
  };
  const all = (): LocalEndpoint[] =>
    orm
      .select()
      .from(localEndpoints)
      .all()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .flatMap((row) => {
        // A damaged row is left out rather than failing the whole list.
        const parsed = usable(row);
        return parsed === undefined ? [] : [parsed];
      });
  const defaultId = (): LocalEndpointId | null => {
    const stored = orm.select().from(localEndpointSettings).where(eq(localEndpointSettings.id, ROW_ID)).get()?.defaultEndpointId ?? null;
    return stored !== null && all().some((endpoint) => endpoint.id === stored) ? (stored as LocalEndpointId) : null;
  };

  const viewOf = (endpoint: LocalEndpoint): LocalEndpointView => {
    const read = readEndpointAddress(endpoint.baseUrl);
    // A stored address that no longer reads (damaged) is treated as another host nobody confirmed.
    const host = read.ok ? read.host : 'an unknown host';
    const loopback = read.ok && read.loopback;
    return {
      ...endpoint,
      host,
      loopback,
      needsConfirmation: !loopback && endpoint.remoteConfirmedFor !== host,
      insecureRemote: read.ok && read.insecureRemote,
      keySaved: endpoint.auth === 'key',
    };
  };

  const note = (id: LocalEndpointId | null, change: Change) => events.append({ type: 'settings.local_endpoints_changed', workspaceId: null, streamId: SETTINGS_STREAM, payload: { endpointId: id, change } });

  const checkConfirmHost = (address: Extract<ReturnType<typeof readEndpointAddress>, { ok: true }>, confirmHost: string | undefined): string | null => {
    if (address.loopback) return null;
    if (confirmHost === undefined || confirmHost.toLowerCase() !== address.host) throw new EndpointConfirmationRequiredError(address.host);
    return address.host;
  };

  return {
    list: () => all().map(viewOf),
    defaultEndpointId: defaultId,
    get: (id) => viewOf(rowOf(id)),

    async add(request) {
      const parsed = AddLocalEndpointRequest.safeParse(request);
      if (!parsed.success) return refuse(parsed.error, 'That server can not be added.');
      const input = parsed.data;
      if (all().length >= MAX_LOCAL_ENDPOINTS) throw new ValidationError(`You can keep up to ${MAX_LOCAL_ENDPOINTS} servers. Remove one first.`, []);
      const address = readEndpointAddress(input.baseUrl);
      if (!address.ok) throw new ValidationError(address.reason, []);
      const confirmed = checkConfirmHost(address, input.confirmHost);
      const id = newId('lep');
      // The key first: where the keychain can't hold it, nothing is added (a plain refusal, AD-16).
      if (input.key !== undefined) {
        try {
          await secrets.set(endpointKeyName(id), input.key);
        } catch (error) {
          throw unavailable(error);
        }
      }
      try {
        return events.transaction(() => {
          if (all().length >= MAX_LOCAL_ENDPOINTS) throw new ValidationError(`You can keep up to ${MAX_LOCAL_ENDPOINTS} servers. Remove one first.`, []);
          orm
            .insert(localEndpoints)
            .values({ id, label: input.label, preset: input.preset ?? null, baseUrl: address.url, auth: input.key === undefined ? 'none' : 'key', model: input.model ?? null, remoteConfirmedFor: confirmed, createdAt: now().toISOString() })
            .run();
          note(id, 'added');
          return viewOf(rowOf(id));
        });
      } catch (error) {
        if (input.key !== undefined) await secrets.delete(endpointKeyName(id)).catch(() => {});
        throw error;
      }
    },

    async update(id, request) {
      const parsed = UpdateLocalEndpointRequest.safeParse(request);
      if (!parsed.success) return refuse(parsed.error, 'Choose something to change.');
      const input = parsed.data;
      const before = rowOf(id);
      const keyDropped = { value: false };
      const view = events.transaction(() => {
        let baseUrl = before.baseUrl;
        let confirmed = before.remoteConfirmedFor;
        if (input.baseUrl !== undefined) {
          const address = readEndpointAddress(input.baseUrl);
          if (!address.ok) throw new ValidationError(address.reason, []);
          baseUrl = address.url;
          // The confirmation belongs to the host it was given for: a changed host asks again, unless confirmed now.
          const host = address.host;
          confirmed = address.loopback ? null : input.confirmHost?.toLowerCase() === host ? host : before.remoteConfirmedFor === host ? host : null;
        } else if (input.confirmHost !== undefined) {
          const address = readEndpointAddress(before.baseUrl);
          if (!address.ok || address.loopback) throw new ValidationError('This server runs on this computer, so there is nothing to confirm.', []);
          if (input.confirmHost.toLowerCase() !== address.host) throw new EndpointConfirmationRequiredError(address.host);
          confirmed = address.host;
        }
        orm
          .update(localEndpoints)
          .set({ label: input.label ?? before.label, baseUrl, model: input.model === undefined ? before.model : input.model, remoteConfirmedFor: confirmed })
          .where(eq(localEndpoints.id, id))
          .run();
        // A key belongs to the server it was given for: a changed address (scheme, host or port) drops it,
        // so it is never sent to somewhere else. The user enters it again for the new address.
        const was = readEndpointAddress(before.baseUrl);
        const now = readEndpointAddress(baseUrl);
        if (before.auth === 'key' && was.ok && now.ok && was.host !== now.host) {
          orm.update(localEndpoints).set({ auth: 'none' }).where(eq(localEndpoints.id, id)).run();
          keyDropped.value = true;
        }
        note(id, 'changed');
        return viewOf(rowOf(id));
      });
      if (keyDropped.value) await secrets.delete(endpointKeyName(id)).catch(() => {});
      return view;
    },

    async remove(id) {
      const before = rowOf(id);
      events.transaction(() => {
        orm.delete(localEndpoints).where(eq(localEndpoints.id, id)).run();
        if (orm.select().from(localEndpointSettings).where(eq(localEndpointSettings.id, ROW_ID)).get()?.defaultEndpointId === id) {
          orm.update(localEndpointSettings).set({ defaultEndpointId: null }).where(eq(localEndpointSettings.id, ROW_ID)).run();
        }
        note(id, 'removed');
      });
      void before;
      // The row is gone either way; a keychain that can't be reached leaves its entry, which nothing reads again.
      // Tried whatever `auth` said, so a key left by a failed save is cleaned up too.
      await secrets.delete(endpointKeyName(id)).catch(() => {});
    },

    async setKey(id, request) {
      const parsed = SetEndpointKeyRequest.safeParse(request);
      if (!parsed.success) return refuse(parsed.error, 'Enter the key.');
      const before = rowOf(id);
      try {
        await secrets.set(endpointKeyName(id), parsed.data.key);
      } catch (error) {
        throw unavailable(error);
      }
      try {
        return events.transaction(() => {
          orm.update(localEndpoints).set({ auth: 'key' }).where(eq(localEndpoints.id, id)).run();
          note(id, 'key_saved');
          return viewOf(rowOf(id));
        });
      } catch (error) {
        // Not recorded, so the key must not stay either.
        if (before.auth !== 'key') await secrets.delete(endpointKeyName(id)).catch(() => {});
        throw error;
      }
    },

    async removeKey(id) {
      rowOf(id);
      try {
        await secrets.delete(endpointKeyName(id));
      } catch (error) {
        throw unavailable(error);
      }
      return events.transaction(() => {
        orm.update(localEndpoints).set({ auth: 'none' }).where(eq(localEndpoints.id, id)).run();
        note(id, 'key_removed');
        return viewOf(rowOf(id));
      });
    },

    confirm(id, request) {
      const parsed = ConfirmRemoteRequest.safeParse(request);
      if (!parsed.success) return refuse(parsed.error, 'Confirm the host.');
      const endpoint = rowOf(id);
      const address = readEndpointAddress(endpoint.baseUrl);
      if (!address.ok || address.loopback) throw new ValidationError('This server runs on this computer, so there is nothing to confirm.', []);
      // Bound to the host the user was shown: if the address changed meanwhile, it does not count.
      if (parsed.data.host.toLowerCase() !== address.host) throw new EndpointConfirmationRequiredError(address.host);
      return events.transaction(() => {
        orm.update(localEndpoints).set({ remoteConfirmedFor: address.host }).where(eq(localEndpoints.id, id)).run();
        note(id, 'confirmed');
        return viewOf(rowOf(id));
      });
    },

    setDefault(request) {
      const parsed = SetDefaultEndpointRequest.safeParse(request);
      if (!parsed.success) return refuse(parsed.error, 'Choose a server.');
      const next = parsed.data.endpointId;
      if (next !== null) rowOf(next);
      events.transaction(() => {
        orm.insert(localEndpointSettings).values({ id: ROW_ID, defaultEndpointId: next }).onConflictDoUpdate({ target: localEndpointSettings.id, set: { defaultEndpointId: next } }).run();
        note(next, 'default_changed');
      });
      return next;
    },

    async target(id) {
      const endpoint = id === undefined ? (all().find((each) => each.id === defaultId()) ?? all()[0]) : rowOf(id);
      if (endpoint === undefined) return undefined;
      const view = viewOf(endpoint);
      if (view.needsConfirmation) throw new EndpointConfirmationRequiredError(view.host);
      let key: string | undefined;
      if (endpoint.auth === 'key') {
        try {
          key = await secrets.get(endpointKeyName(endpoint.id));
        } catch (error) {
          throw unavailable(error);
        }
        if (key === undefined) throw new SecretsUnavailableError('The key for this server is no longer in your keychain. Enter it again in Settings, Agents.');
      }
      return { endpointId: endpoint.id, baseUrl: endpoint.baseUrl, ...(key === undefined ? {} : { key }), ...(endpoint.model === null ? {} : { model: endpoint.model }) };
    },
  };
}

