/**
 * TEMPORARY in-memory event bus.
 *
 * Story 1.3 replaces this with the persistent, sequence-numbered event log
 * (AD-5): SQLite-backed, `{ id, seq, workspaceId, streamId, type, at, payload }`
 * envelopes, and "subscribe after seq N" catch-up. Until then this only proves
 * the core-to-server path: nothing is persisted and only the latest event is
 * replayed to new subscribers.
 */
import type { CoreEvent } from '@ogdenmad/shared';

export type EventListener = (event: CoreEvent) => void;

export interface EventBus {
  /** Deliver an event to every current subscriber and remember it as the latest. */
  emit(event: CoreEvent): void;
  /**
   * Receive every future event. If an event was already emitted, the latest one
   * is delivered immediately, so late subscribers still see current state.
   * Returns an unsubscribe function.
   */
  subscribe(listener: EventListener): () => void;
}

export function createEventBus(): EventBus {
  const listeners = new Set<EventListener>();
  let latest: CoreEvent | undefined;

  return {
    emit(event) {
      latest = event;
      for (const listener of [...listeners]) listener(event);
    },
    subscribe(listener) {
      listeners.add(listener);
      if (latest !== undefined) listener(latest);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
