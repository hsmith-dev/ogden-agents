import { z } from 'zod';

/**
 * Wire contract for the events WebSocket (`/ws`).
 *
 * Every message the server sends is a `ServerMessage`; every message a client
 * sends must parse as a `ClientMessage`. Anything else is rejected.
 *
 * Note: the full event envelope from AD-5 (`id`, `seq`, `workspaceId`, ...)
 * arrives with the persistent event log in story 1.3.
 */

/** ISO 8601 UTC timestamp, e.g. `2026-09-29T18:00:00.000Z`. */
export const IsoUtcTimestamp = z.iso.datetime();

/** Emitted once by core when the server has bound its port. */
export const ServerStartedEvent = z.object({
  type: z.literal('server.started'),
  at: IsoUtcTimestamp,
  version: z.string().min(1),
});
export type ServerStartedEvent = z.infer<typeof ServerStartedEvent>;

/** Reply to a client `ping`; lets a client confirm the connection is alive. */
export const PongMessage = z.object({
  type: z.literal('pong'),
  at: IsoUtcTimestamp,
});
export type PongMessage = z.infer<typeof PongMessage>;

/** Domain events core can emit (grows with later stories). */
export const CoreEvent = z.discriminatedUnion('type', [ServerStartedEvent]);
export type CoreEvent = z.infer<typeof CoreEvent>;

/** Every message the server may send over `/ws`. */
export const ServerMessage = z.discriminatedUnion('type', [ServerStartedEvent, PongMessage]);
export type ServerMessage = z.infer<typeof ServerMessage>;

/** A client asking the server to answer with `pong`. */
export const PingMessage = z.object({
  type: z.literal('ping'),
});
export type PingMessage = z.infer<typeof PingMessage>;

/** Every message a client may send over `/ws`. */
export const ClientMessage = z.discriminatedUnion('type', [PingMessage]);
export type ClientMessage = z.infer<typeof ClientMessage>;
