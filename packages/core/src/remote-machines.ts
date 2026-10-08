/**
 * The remote-machine registry (CAP-24, epic 19 stories 19.1-19.2):
 * install-level, not scoped to a workspace, exactly like an agent's own
 * sign-in (AD-2). A record holds only what addresses the machine and what
 * Settings shows — host, port, username, a display label, and the
 * host-key/public-key fields this story fills in. No credential ever
 * lives on this record: the private key lives only in `SecretStorePort`
 * under `remote-machine-ssh/<id>` (AD-16's pattern), never in this table,
 * an event or a log line.
 *
 * Core owns this table directly, the same way it owns `localEndpoints`:
 * this repo's adapters never touch Ogden's own database (every `*-port.ts`
 * boundary is an external system — git, the OS keychain, a child process —
 * not Ogden's own SQLite). `RemoteHostPort` (story 19.2) is the adapter
 * boundary for the actual SSH-touching operations this class calls through
 * (generating a keypair, reading a host's key) but never performs itself.
 *
 * Host-key trust (AD-26): the first confirm pins the fingerprint the user
 * was shown, generates and stores a fresh keypair, and marks the machine
 * usable. A later confirm attempt on an already-pinned machine, or
 * {@link RemoteMachines.verifyPinnedHostKey} before any real connection
 * (stories 19.4/19.5), is refused outright if the live fingerprint no
 * longer matches what was pinned — never silently re-pinned.
 */
import {
  AddRemoteMachineRequest,
  ConfirmHostKeyRequest,
  MAX_REMOTE_MACHINES,
  REMOTE_MACHINE_CHANGES,
  RemoteMachine as RemoteMachineSchema,
  RenameRemoteMachineRequest,
  SETTINGS_STREAM,
  type RemoteMachine,
  type RemoteMachineId,
} from '@ogden-agents/shared';
import { eq } from 'drizzle-orm';
import type { Database } from './db/database.js';
import { remoteMachines } from './db/schema.js';
import { ConfirmationRequiredError, NotFoundError, SecretsUnavailableError, ValidationError } from './errors.js';
import type { EventLog } from './event-log.js';
import { newId } from './ids.js';
import { RemoteHostError, type RemoteHostPort } from './remote-host-port.js';
import type { SecretStorePort } from './secret-store-port.js';

export interface RemoteMachines {
  /** Every added machine, oldest first. Never includes a credential. */
  list(): RemoteMachine[];
  /** One machine. `NotFoundError` for no such id. */
  get(id: RemoteMachineId): RemoteMachine;
  /** Adds a machine (`AddRemoteMachineRequest`). No credential is accepted or generated here: a machine cannot be used until {@link confirmHostKey}. `ValidationError` for bad input or once {@link MAX_REMOTE_MACHINES} is reached. */
  add(request: unknown): RemoteMachine;
  /** Changes the display label only (`RenameRemoteMachineRequest`). */
  rename(id: RemoteMachineId, request: unknown): RemoteMachine;
  /** Removes the machine record and its stored SSH credential, if any. */
  remove(id: RemoteMachineId): Promise<void>;
  /** Connects far enough to read the machine's live host-key fingerprint, for the UI to show before the user confirms. Never pins anything; never throws for a legitimate "can't reach it" (`RemoteHostError`), which the caller shows in plain words. */
  checkHostKey(id: RemoteMachineId): Promise<{ fingerprint: string }>;
  /**
   * Confirms the host key shown to the user (`ConfirmHostKeyRequest`;
   * `ConfirmationRequiredError` unless `confirm` is `true`). Re-reads the
   * live fingerprint and refuses (`RemoteHostError`, `host_key_changed`)
   * if it no longer matches what was shown. First confirm: generates and
   * stores a fresh keypair and pins the fingerprint. Already pinned and
   * unchanged: a no-op that returns the machine as it is. Already pinned
   * and changed: refused outright (`host_key_changed`), never re-pinned.
   */
  confirmHostKey(id: RemoteMachineId, request: unknown): Promise<RemoteMachine>;
  /** Refuses (`RemoteHostError`) unless the machine is confirmed and its live host key still matches the pinned one; stories 19.4/19.5 call this before any real connection. Never pins or changes anything. */
  verifyPinnedHostKey(id: RemoteMachineId): Promise<void>;
}

export interface RemoteMachinesOptions {
  db: Database;
  events: EventLog;
  secrets: SecretStorePort;
  hosts: RemoteHostPort;
  now?: () => Date;
}

/** The keychain name a machine's SSH credential is stored under (AD-26). */
export const remoteMachineSshSecretName = (id: string): string => `remote-machine-ssh/${id}`;

type Change = (typeof REMOTE_MACHINE_CHANGES)[number];

export function createRemoteMachines({ db, events, secrets, hosts, now = () => new Date() }: RemoteMachinesOptions): RemoteMachines {
  const { orm } = db;

  const refuse = (error: { issues: Array<{ path: PropertyKey[]; message: string }> }, fallback: string): never => {
    const issue = error.issues[0];
    throw new ValidationError(issue?.message ?? fallback, error.issues.map((each) => ({ path: each.path, message: each.message })));
  };

  const unavailable = (error: unknown): SecretsUnavailableError => (error instanceof SecretsUnavailableError ? error : new SecretsUnavailableError(undefined, { cause: 'unexpected' }));

  const usable = (row: unknown): RemoteMachine | undefined => {
    const parsed = RemoteMachineSchema.safeParse(row);
    return parsed.success ? parsed.data : undefined;
  };

  const all = (): RemoteMachine[] =>
    orm
      .select()
      .from(remoteMachines)
      .all()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .flatMap((row) => {
        // A damaged row is left out rather than failing the whole list.
        const parsed = usable(row);
        return parsed === undefined ? [] : [parsed];
      });

  const rowOf = (id: RemoteMachineId): RemoteMachine => {
    const row = orm.select().from(remoteMachines).where(eq(remoteMachines.id, id)).get();
    const parsed = row === undefined ? undefined : usable(row);
    if (parsed === undefined) throw new NotFoundError('remote machine', id);
    return parsed;
  };

  const note = (id: RemoteMachineId, change: Change) =>
    events.append({ type: 'settings.remote_machines_changed', workspaceId: null, streamId: SETTINGS_STREAM, payload: { machineId: id, change } });

  return {
    list: all,
    get: rowOf,

    add(request) {
      const parsed = AddRemoteMachineRequest.safeParse(request);
      if (!parsed.success) return refuse(parsed.error, 'That machine can not be added.');
      const input = parsed.data;
      if (all().length >= MAX_REMOTE_MACHINES) throw new ValidationError(`You can keep up to ${MAX_REMOTE_MACHINES} machines. Remove one first.`, []);
      const id = newId('mach');
      return events.transaction(() => {
        if (all().length >= MAX_REMOTE_MACHINES) throw new ValidationError(`You can keep up to ${MAX_REMOTE_MACHINES} machines. Remove one first.`, []);
        orm
          .insert(remoteMachines)
          .values({
            id,
            host: input.host,
            port: input.port ?? 22,
            username: input.username,
            label: input.label,
            hostKeyFingerprint: null,
            publicKey: null,
            hostKeyConfirmed: false,
            createdAt: now().toISOString(),
          })
          .run();
        note(id, 'added');
        return rowOf(id);
      });
    },

    rename(id, request) {
      const parsed = RenameRemoteMachineRequest.safeParse(request);
      if (!parsed.success) return refuse(parsed.error, 'Choose a name for the machine.');
      rowOf(id); // NotFoundError before the write when there is no such machine.
      return events.transaction(() => {
        orm.update(remoteMachines).set({ label: parsed.data.label }).where(eq(remoteMachines.id, id)).run();
        note(id, 'renamed');
        return rowOf(id);
      });
    },

    async remove(id) {
      rowOf(id); // NotFoundError before the write when there is no such machine.
      events.transaction(() => {
        orm.delete(remoteMachines).where(eq(remoteMachines.id, id)).run();
        note(id, 'removed');
      });
      await secrets.delete(remoteMachineSshSecretName(id)).catch(() => {});
    },

    async checkHostKey(id) {
      const machine = rowOf(id);
      return hosts.checkHostKey({ host: machine.host, port: machine.port, username: machine.username });
    },

    async confirmHostKey(id, request) {
      const parsed = ConfirmHostKeyRequest.safeParse(request);
      if (!parsed.success) return refuse(parsed.error, 'That host key can not be confirmed.');
      if (parsed.data.confirm !== true) throw new ConfirmationRequiredError('Confirm the host key fingerprint to use this machine.');
      const before = rowOf(id);
      const live = await hosts.checkHostKey({ host: before.host, port: before.port, username: before.username });

      if (before.hostKeyFingerprint !== null) {
        // Already pinned: a changed live fingerprint is refused outright, never silently re-pinned (AD-26).
        if (live.fingerprint !== before.hostKeyFingerprint) {
          throw new RemoteHostError(`${before.host}'s host key has changed since it was confirmed. Remove and re-add the machine only if you trust this is expected.`, { host: before.host }, 'host_key_changed');
        }
        return before;
      }

      // First confirm: the fingerprint shown to the user must still be the live one right now.
      if (live.fingerprint !== parsed.data.fingerprint) {
        throw new RemoteHostError(`${before.host}'s host key has changed since it was shown. Check the fingerprint again before confirming.`, { host: before.host }, 'host_key_changed');
      }
      const keypair = hosts.generateKeypair({ comment: `ogden-agents:${id}` });
      try {
        await secrets.set(remoteMachineSshSecretName(id), keypair.privateKey);
      } catch (error) {
        throw unavailable(error);
      }
      try {
        return events.transaction(() => {
          orm
            .update(remoteMachines)
            .set({ hostKeyFingerprint: live.fingerprint, publicKey: keypair.publicKeyLine, hostKeyConfirmed: true })
            .where(eq(remoteMachines.id, id))
            .run();
          note(id, 'host_key_confirmed');
          return rowOf(id);
        });
      } catch (error) {
        await secrets.delete(remoteMachineSshSecretName(id)).catch(() => {});
        throw error;
      }
    },

    async verifyPinnedHostKey(id) {
      const machine = rowOf(id);
      if (!machine.hostKeyConfirmed || machine.hostKeyFingerprint === null) {
        throw new RemoteHostError(`Confirm ${machine.host}'s host key before using it.`, { host: machine.host }, 'host_key_not_confirmed');
      }
      const live = await hosts.checkHostKey({ host: machine.host, port: machine.port, username: machine.username });
      if (live.fingerprint !== machine.hostKeyFingerprint) {
        throw new RemoteHostError(`${machine.host}'s host key has changed since it was confirmed. Remove and re-add the machine only if you trust this is expected.`, { host: machine.host }, 'host_key_changed');
      }
    },
  };
}
