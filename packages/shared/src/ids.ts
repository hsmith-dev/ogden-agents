import { z } from 'zod';

/**
 * OgdenMad-owned identifiers (AD-9): a type prefix, an underscore and a
 * 26-character Crockford base32 ULID, e.g. `ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3`.
 * Agent session IDs and CLI resume IDs are never keys; they live in a
 * session's `adapterRefs`.
 */
export const ID_PREFIXES = {
  workspace: 'ws',
  session: 'ses',
  run: 'run',
  event: 'evt',
} as const;
export type IdPrefix = (typeof ID_PREFIXES)[keyof typeof ID_PREFIXES];

const ULID_BODY = '[0-9A-HJKMNP-TV-Z]{26}';

function prefixedUlid<P extends IdPrefix>(prefix: P) {
  return z
    .string()
    .regex(new RegExp(`^${prefix}_${ULID_BODY}$`), `expected a ${prefix}_<ULID> id`) as unknown as z.ZodType<
    `${P}_${string}`,
    string
  >;
}

export const WorkspaceId = prefixedUlid('ws');
export type WorkspaceId = z.infer<typeof WorkspaceId>;

export const SessionId = prefixedUlid('ses');
export type SessionId = z.infer<typeof SessionId>;

export const RunId = prefixedUlid('run');
export type RunId = z.infer<typeof RunId>;

export const EventId = prefixedUlid('evt');
export type EventId = z.infer<typeof EventId>;
