import type { QueryClient, QueryKey } from '@tanstack/react-query';

/**
 * Keeps a saved setting as the query's value. A read still on its way (the
 * page's first read, held up behind other requests, or a refetch an event set
 * off) answers with the value from before the save; landing after it, it
 * would turn the form back (4.13 New projects, 6.7 Developer mode: both seen
 * on Windows runners). An event's refetch joins such a read rather than
 * sending a new one while the query has no data yet. So reads in flight are
 * cancelled first and the save's answer is the one kept; anything fetched
 * after this reads the saved value. Every settings form's save goes through
 * this (story 6.9).
 */
export async function keepSaved<T>(queryClient: QueryClient, queryKey: QueryKey, saved: T): Promise<void> {
  await queryClient.cancelQueries({ queryKey, exact: true });
  queryClient.setQueryData(queryKey, saved);
}
