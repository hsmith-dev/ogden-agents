/**
 * The remote-machine registry (CAP-24, epic 18 story 18.1): install-level,
 * not scoped to a workspace, exactly like an agent's own sign-in (AD-2).
 * A record holds only what addresses the machine and what Settings shows
 * — host, port, username, a display label, and the host-key/public-key
 * fields story 18.2 fills in. No credential: the private key and
 * passphrase live in `SecretStorePort` under `remote-machine-ssh/<id>`
 * from story 18.2 on, never in this table, an event or a log line (AD-16).
 *
 * Core owns this table directly, the same way it owns `localEndpoints`:
 * this repo's adapters never touch Ogden's own database (every `*-port.ts`
 * boundary is an external system — git, the OS keychain, a child process —
 * not Ogden's own SQLite). The architecture's `RemoteHostPort` note groups
 * the registry with the SSH connection itself (connect, confirm-and-pin a
 * host key, spawn a process, push/pull a worktree); this story reads that
 * as one *subsystem*, not one TypeScript interface, and keeps the
 * registry here while `RemoteHostPort` (added from story 18.2) is reserved
 * for the actual SSH operations, which do need an adapter boundary.
 */
import {
  AddRemoteMachineRequest,
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
import { NotFoundError, ValidationError } from './errors.js';
import type { EventLog } from './event-log.js';
import { newId } from './ids.js';
import type { SecretStorePort } from './secret-store-port.js';

export interface RemoteMachines {
  /** Every added machine, oldest first. Never includes a credential. */
  list(): RemoteMachine[];
  /** One machine. `NotFoundError` for no such id. */
  get(id: RemoteMachineId): RemoteMachine;
  /** Adds a machine (`AddRemoteMachineRequest`). No credential is accepted or generated here (story 18.2). `ValidationError` for bad input or once {@link MAX_REMOTE_MACHINES} is reached. */
  add(request: unknown): RemoteMachine;
  /** Changes the display label only (`RenameRemoteMachineRequest`). */
  rename(id: RemoteMachineId, request: unknown): RemoteMachine;
  /** Removes the machine record and, if one was ever stored, its SSH credential (a no-op today: story 18.1 stores none). */
  remove(id: RemoteMachineId): Promise<void>;
}

export interface RemoteMachinesOptions {
  db: Database;
  events: EventLog;
  secrets: SecretStorePort;
  now?: () => Date;
}

/** The keychain name a machine's SSH credential is stored under, once story 18.2 stores one (AD-26). */
export const remoteMachineSshSecretName = (id: string): string => `remote-machine-ssh/${id}`;

type Change = (typeof REMOTE_MACHINE_CHANGES)[number];

export function createRemoteMachines({ db, events, secrets, now = () => new Date() }: RemoteMachinesOptions): RemoteMachines {
  const { orm } = db;

  const refuse = (error: { issues: Array<{ path: PropertyKey[]; message: string }> }, fallback: string): never => {
    const issue = error.issues[0];
    throw new ValidationError(issue?.message ?? fallback, error.issues.map((each) => ({ path: each.path, message: each.message })));
  };

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
      // No credential is ever stored by this story, but removing one unconditionally is the safe default once 18.2 starts storing one.
      await secrets.delete(remoteMachineSshSecretName(id)).catch(() => {});
    },
  };
}
