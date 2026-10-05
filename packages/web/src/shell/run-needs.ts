import type { Run, Workspace } from '@ogden-agents/shared';
import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useEventInvalidation } from '@/events/use-event-invalidation';
import { fetchRuns } from '@/planning/builds-api';

/**
 * Every project's runs, for Needs you (story 11.4): blocked runs and runs
 * ready for review reach the sidebar from any project, with the tab title's
 * count. A project with Unattended builds off answers 409 and has none (no
 * notification for it, E11-R1). Shares the Runs tab's query and is read
 * again whenever a `run.*` event of that project arrives (AD-7's pattern).
 */
export function useRunsByWorkspace(workspaces: readonly Workspace[]): ReadonlyMap<string, readonly Run[]> {
  useEventInvalidation((event) => (event.type.startsWith('run.') && event.workspaceId !== null ? [['runs', event.workspaceId]] : []));
  const results = useQueries({
    queries: workspaces.map((workspace) => ({
      queryKey: ['runs', workspace.id],
      queryFn: () => fetchRuns(workspace.id),
      retry: false,
      // A project with builds off refuses every time: not asked again on each focus.
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    })),
  });
  // Each result's data changes identity only when it is fetched again.
  const signature = results.map((result) => result.dataUpdatedAt).join(',');
  return useMemo(() => new Map(workspaces.map((workspace, index) => [workspace.id, results[index]?.data?.runs ?? []] as const)), [workspaces, signature]); // eslint-disable-line react-hooks/exhaustive-deps
}
