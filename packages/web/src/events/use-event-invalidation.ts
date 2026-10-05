import type { CoreEvent } from '@ogden-agents/shared';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useEventStream } from './event-stream';

/**
 * Invalidates REST queries from the event log (AD-7), for each event that
 * arrived since the last one this hook saw: `keysFor` maps an event to the
 * query keys it makes stale (none for an event it doesn't care about), and
 * each key is invalidated once per batch. What is already in the stream when
 * the hook mounts is already in the queries' first fetch, so it is skipped.
 */
export function useEventInvalidation(keysFor: (event: CoreEvent) => readonly QueryKey[]): void {
  const { events } = useEventStream();
  const queryClient = useQueryClient();
  const seen = useRef(events.at(-1)?.seq ?? 0);
  // The latest mapping, so a caller's inline function doesn't re-run the effect.
  const latest = useRef(keysFor);
  latest.current = keysFor;
  useEffect(() => {
    const stale = new Map<string, QueryKey>();
    for (const event of events) {
      if (event.seq <= seen.current) continue;
      for (const key of latest.current(event)) stale.set(JSON.stringify(key), key);
    }
    seen.current = Math.max(seen.current, events.at(-1)?.seq ?? 0);
    for (const key of stale.values()) void queryClient.invalidateQueries({ queryKey: key });
  }, [events, queryClient]);
}
