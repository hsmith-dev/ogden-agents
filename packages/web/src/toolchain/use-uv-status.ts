import type { ToolchainStatus } from '@ogden-agents/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useEventStream } from '@/events/event-stream';
import { fetchUvStatus } from './toolchain-api';

export const UV_STATUS_KEY = ['toolchain', 'uv'] as const;

/** The seq of the newest `toolchain.*` event received, or 0. */
function lastToolchainSeq(events: readonly { seq: number; type: string }[]): number {
  for (let i = events.length - 1; i >= 0; i--) if (events[i]!.type.startsWith('toolchain.')) return events[i]!.seq;
  return 0;
}

/**
 * uv's status, read over REST and refetched whenever a `toolchain.*` event
 * arrives through the event log (progress, completion or failure), so the
 * page follows an install as it runs.
 */
export function useUvStatus() {
  const queryClient = useQueryClient();
  const { events } = useEventStream();
  const seq = lastToolchainSeq(events);
  useEffect(() => {
    if (seq > 0) void queryClient.invalidateQueries({ queryKey: UV_STATUS_KEY });
  }, [seq, queryClient]);
  return useQuery<ToolchainStatus>({ queryKey: UV_STATUS_KEY, queryFn: () => fetchUvStatus(), retry: 1 });
}
