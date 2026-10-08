import { z } from 'zod';
import { RemoteMachineId } from './ids.js';

/**
 * Remote machines the user gives Ogden Agents SSH access to (CAP-24, epic
 * 18 story 18.1). Install-level, not scoped to a workspace, exactly like an
 * agent's own sign-in (AD-2): a machine is the user's own physical computer,
 * usable from any workspace.
 *
 * Story 18.1 stores only what addresses the machine and what Settings
 * shows: host, port, username and a display label. `hostKeyFingerprint`,
 * `publicKey` and `hostKeyConfirmed` are reserved here (per the
 * architecture's `RemoteHostPort` note) for story 18.2 to fill in; until
 * then they stay `null`/`false` and the machine cannot be used for a chat
 * or a build. No credential field exists on this record at all: the
 * private key and passphrase, once story 18.2 generates and stores them,
 * live only in `SecretStorePort` under `remote-machine-ssh/<machineId>`
 * (AD-16's pattern), never here, never in an event, never in a log line.
 */

/** The longest a machine's display label may be. */
export const MAX_MACHINE_LABEL = 60;
/** The longest a host (hostname or IP literal) may be. */
export const MAX_MACHINE_HOST = 255;
/** The longest an SSH username may be. */
export const MAX_MACHINE_USERNAME = 64;
/** The most remote machines one install keeps. */
export const MAX_REMOTE_MACHINES = 20;

/** A display label, trimmed. */
const Label = z
  .string()
  .trim()
  .min(1, 'Give the machine a name.')
  .max(MAX_MACHINE_LABEL, `Use ${MAX_MACHINE_LABEL} characters or fewer.`);

/** A host as typed: a hostname or IP literal, never a URL (SSH has no scheme). */
const Host = z
  .string()
  .trim()
  .min(1, 'Enter the machine’s host name or IP address.')
  .max(MAX_MACHINE_HOST, 'That host is too long.')
  // No scheme, no path, no whitespace inside: this is an address, not a URL.
  .refine((value) => !/[\s/\\]/.test(value), 'Enter only the host name or IP address, with no slashes or spaces.');

/** The SSH port; 22 is the default but any valid TCP port is accepted. */
const Port = z.number().int('Enter a whole number for the port.').min(1, 'The port must be between 1 and 65535.').max(65535, 'The port must be between 1 and 65535.');

/** An SSH username, trimmed. */
const Username = z
  .string()
  .trim()
  .min(1, 'Enter the username to connect as.')
  .max(MAX_MACHINE_USERNAME, 'That username is too long.')
  .refine((value) => !/\s/.test(value), 'A username has no spaces.');

/** One remote machine as stored. Never a credential (see the file comment). */
export const RemoteMachine = z.object({
  id: RemoteMachineId,
  host: z.string().min(1).max(MAX_MACHINE_HOST),
  port: Port,
  username: z.string().min(1).max(MAX_MACHINE_USERNAME),
  label: Label,
  /** The host key fingerprint shown and pinned at confirm time (story 18.2); `null` until then. */
  hostKeyFingerprint: z.string().min(1).nullable(),
  /** The public half of the keypair Ogden generates and owns for this machine (story 18.2); `null` until then. */
  publicKey: z.string().min(1).nullable(),
  /** Whether the user has confirmed the host key; the machine cannot be used for a chat or build until this is `true`. */
  hostKeyConfirmed: z.boolean(),
  createdAt: z.string().min(1),
});
export type RemoteMachine = z.infer<typeof RemoteMachine>;

/** Adds a machine. No credential is accepted here; story 18.2 adds the keypair/host-key flow. */
export const AddRemoteMachineRequest = z
  .object({
    host: Host,
    port: Port.optional(),
    username: Username,
    label: Label,
  })
  .strict();
export type AddRemoteMachineRequest = z.infer<typeof AddRemoteMachineRequest>;

/** Changes a machine's display label only; its host/port/username are fixed once added (removing and re-adding starts a fresh host-key trust decision). */
export const RenameRemoteMachineRequest = z.object({ label: Label }).strict();
export type RenameRemoteMachineRequest = z.infer<typeof RenameRemoteMachineRequest>;
