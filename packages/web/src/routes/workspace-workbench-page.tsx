import { WORKBENCH_CHANGES_LABEL, WORKBENCH_FILES_LABEL, WORKBENCH_PAGE_TITLE } from '@ogden-agents/shared';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import type { WorkbenchSearch } from '@/router';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { PageBody } from '@/ui/page';
import { TabNav, TabNavItem } from '@/ui/tab-nav';
import { WorkbenchChanges } from '@/workbench/workbench-changes';
import { WorkbenchFiles } from '@/workbench/workbench-files';

const EXACT = { exact: true, includeSearch: true } as const;

/**
 * `/w/:wsId/workbench`: the project's Workbench (AD-36, AD-37). Files: the
 * project's tree and one file read-only, the selected file in `?path=`.
 * Changes (`?panel=changes`, story 8.4): the view in `?view=`, for the chat
 * in `?session=` on the turn in `?turn=`; a chat's Review changes opens it
 * on This turn.
 */
export function WorkspaceWorkbenchPage() {
  const { wsId } = useParams({ strict: false }) as { wsId: string };
  const search = useSearch({ strict: false }) as WorkbenchSearch;
  const navigate = useNavigate();
  const changes = search.panel === 'changes';
  const keptFiles = search.path === undefined ? {} : { path: search.path };
  const keptChanges: WorkbenchSearch = { panel: 'changes', ...(search.session === undefined ? {} : { session: search.session }) };
  return (
    <>
      <WorkspaceHeader title={WORKBENCH_PAGE_TITLE} wsId={wsId} tab="workbench" />
      <PageBody data-testid="workspace-workbench-page">
        <TabNav label="Workbench panels" data-testid="workbench-panels">
          <TabNavItem current={!changes} asChild>
            {/* Both panels are one route: `current` decides, never the router's partial match of the search. */}
            <Link to="/w/$wsId/workbench" params={{ wsId }} search={keptFiles} activeOptions={EXACT} data-testid="workbench-panel-files">
              {WORKBENCH_FILES_LABEL}
            </Link>
          </TabNavItem>
          <TabNavItem current={changes} asChild>
            <Link to="/w/$wsId/workbench" params={{ wsId }} search={keptChanges} activeOptions={EXACT} data-testid="workbench-panel-changes">
              {WORKBENCH_CHANGES_LABEL}
            </Link>
          </TabNavItem>
        </TabNav>
        {changes ? (
          <WorkbenchChanges
            wsId={wsId}
            view={search.view}
            session={search.session}
            turn={search.turn}
            onNavigate={(next) =>
              void navigate({ to: '/w/$wsId/workbench', params: { wsId }, search: { ...keptChanges, view: next.view, ...(next.turn === undefined ? {} : { turn: next.turn }) } })
            }
          />
        ) : (
          <WorkbenchFiles wsId={wsId} path={search.path} onSelect={(path) => void navigate({ to: '/w/$wsId/workbench', params: { wsId }, search: { path } })} />
        )}
      </PageBody>
    </>
  );
}
