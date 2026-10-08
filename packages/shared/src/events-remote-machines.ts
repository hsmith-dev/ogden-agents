/**
 * Remote machine registry events (CAP-24, epic 19 story 19.1), re-exported
 * from `events.ts`. A machine's host, username, label, fingerprint or
 * public key is never in an event (AD-16's pattern for any credential-
 * adjacent record): the page that follows one reads the machine list
 * again.
 */
import { z } from 'zod';
import { SETTINGS_STREAM } from './events-common.js';
import { assigned } from './events-envelope.js';
import { RemoteMachineId } from './ids.js';

/** What changed about a remote machine. */
export const REMOTE_MACHINE_CHANGES = ['added', 'renamed', 'removed', 'host_key_confirmed'] as const;

export const SettingsRemoteMachinesChangedInput = z.object({
  type: z.literal('settings.remote_machines_changed'),
  workspaceId: z.null(),
  streamId: z.literal(SETTINGS_STREAM),
  payload: z.object({
    machineId: RemoteMachineId,
    change: z.enum(REMOTE_MACHINE_CHANGES),
  }),
});
/** A remote machine was added, renamed or removed (every tab reads the list again). */
export const SettingsRemoteMachinesChangedEvent = SettingsRemoteMachinesChangedInput.extend(assigned);
export type SettingsRemoteMachinesChangedEvent = z.infer<typeof SettingsRemoteMachinesChangedEvent>;
