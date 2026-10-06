/**
 * The Local model's endpoint events (epic 14, story 14.3), re-exported from
 * `events.ts`. An endpoint's key, address and host are never in an event
 * (AD-16): the page that follows one reads the endpoint list again.
 */
import { z } from 'zod';
import { SETTINGS_STREAM } from './events-common.js';
import { assigned } from './events-envelope.js';
import { LocalEndpointId } from './ids.js';

/** What changed about the endpoints. */
export const LOCAL_ENDPOINT_CHANGES = ['added', 'changed', 'removed', 'key_saved', 'key_removed', 'confirmed', 'default_changed'] as const;

export const SettingsLocalEndpointsChangedInput = z.object({
  type: z.literal('settings.local_endpoints_changed'),
  workspaceId: z.null(),
  streamId: z.literal(SETTINGS_STREAM),
  payload: z.object({
    /** The endpoint it happened to; `null` when none (the default cleared). */
    endpointId: LocalEndpointId.nullable(),
    change: z.enum(LOCAL_ENDPOINT_CHANGES),
  }),
});
/** An endpoint was added, changed, removed, given or lost its key, confirmed, or made the default (every tab reads the list again). */
export const SettingsLocalEndpointsChangedEvent = SettingsLocalEndpointsChangedInput.extend(assigned);
export type SettingsLocalEndpointsChangedEvent = z.infer<typeof SettingsLocalEndpointsChangedEvent>;
