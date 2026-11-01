import { WORKBENCH_FILES_LABEL, WORKBENCH_PAGE_TITLE } from '@ogden-agents/shared';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import type { WorkbenchSearch } from '@/router';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { PageBody } from '@/ui/page';
import { TabNav, TabNavItem } from '@/ui/tab-nav';
import { WorkbenchFiles } from '@/workbench/workbench-files';

/**
 * `/w/:wsId/workbench`: the project's Workbench (AD-36). Its one panel so
 * far is Files: the project's tree and one file read-only, the selected file
 * in `?path=` (a `file:line` link's line in `?line=`, a worktree chat's
 * folder by `?session=`).
 */
export function WorkspaceWorkbenchPage() {
  const { wsId } = useParams({ strict: false }) as { wsId: string };
  const search = useSearch({ strict: false }) as WorkbenchSearch;
  const navigate = useNavigate();
  // The panel tab keeps the file and the chat's worktree; choosing another file drops the line.
  const kept = { ...(search.path === undefined ? {} : { path: search.path }), ...(search.session === undefined ? {} : { session: search.session }) };
  return (
    <>
      <WorkspaceHeader title={WORKBENCH_PAGE_TITLE} wsId={wsId} tab="workbench" />
      <PageBody data-testid="workspace-workbench-page">
        <TabNav label="Workbench panels" data-testid="workbench-panels">
          <TabNavItem current asChild>
            <Link to="/w/$wsId/workbench" params={{ wsId }} search={kept} data-testid="workbench-panel-files">
              {WORKBENCH_FILES_LABEL}
            </Link>
          </TabNavItem>
        </TabNav>
        <WorkbenchFiles
          wsId={wsId}
          path={search.path}
          line={search.line}
          session={search.session}
          onSelect={(path) => void navigate({ to: '/w/$wsId/workbench', params: { wsId }, search: { path, ...(search.session === undefined ? {} : { session: search.session }) } })}
        />
      </PageBody>
    </>
  );
}
