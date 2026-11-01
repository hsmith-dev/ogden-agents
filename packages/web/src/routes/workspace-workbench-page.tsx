import { WORKBENCH_CHANGES_LABEL, WORKBENCH_FILES_LABEL, WORKBENCH_PAGE_TITLE, WORKBENCH_PROBLEMS_LABEL, WORKBENCH_SEARCH_LABEL } from '@ogden-agents/shared';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import type { WorkbenchSearch } from '@/router';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { PageBody } from '@/ui/page';
import { TabNav, TabNavItem } from '@/ui/tab-nav';
import { WorkbenchChanges } from '@/workbench/workbench-changes';
import { WorkbenchFiles } from '@/workbench/workbench-files';
import { WorkbenchSearch as WorkbenchSearchPanel, type WorkbenchSearchState } from '@/workbench/workbench-search';
import { WorkbenchProblems } from '@/workbench/workbench-problems';

const EXACT = { exact: true, includeSearch: true } as const;

/**
 * `/w/:wsId/workbench`: the project's Workbench (AD-36, AD-37). Files: the
 * project's tree and one file read-only, the selected file in `?path=` (a
 * `file:line` link's line in `?line=`, a worktree chat's folder by
 * `?session=`). Changes (`?panel=changes`, story 8.4): the view in `?view=`,
 * for the chat in `?session=` on the turn in `?turn=`; a chat's Review
 * changes opens it on This turn. Search (`?panel=search`, story 8.8, `g s`):
 * the query in `?q=` with `?mode=`, `?matchCase=`, `?regex=`; typing
 * replaces the history entry, and a result opens Files at its line.
 * Problems (`?panel=problems`, 8.9): the project's test and lint commands,
 * their runs and failures, each a link back to Files at its line.
 */
export function WorkspaceWorkbenchPage() {
  const { wsId } = useParams({ strict: false }) as { wsId: string };
  const search = useSearch({ strict: false }) as WorkbenchSearch;
  const navigate = useNavigate();
  const changes = search.panel === 'changes';
  const searching = search.panel === 'search';
  const problems = search.panel === 'problems';
  const kept = search.session === undefined ? {} : { session: search.session };
  // The Files tab keeps the file and the chat's worktree; choosing another file drops the line.
  const keptFiles: WorkbenchSearch = { ...(search.path === undefined ? {} : { path: search.path }), ...kept };
  const keptChanges: WorkbenchSearch = { panel: 'changes', ...kept };
  const keptSearch: WorkbenchSearch = { panel: 'search', ...kept };
  /** The Search panel's address: only what differs from the defaults. */
  const searchAddress = ({ q, mode, matchCase, regex }: WorkbenchSearchState): WorkbenchSearch => ({
    ...keptSearch,
    ...(q === '' ? {} : { q }),
    ...(mode === 'names' ? { mode } : {}),
    ...(matchCase ? { matchCase } : {}),
    ...(regex ? { regex } : {}),
  });
  return (
    <>
      <WorkspaceHeader title={WORKBENCH_PAGE_TITLE} wsId={wsId} tab="workbench" />
      <PageBody data-testid="workspace-workbench-page">
        <TabNav label="Workbench panels" data-testid="workbench-panels">
          <TabNavItem current={!changes && !searching && !problems} asChild>
            {/* Both panels are one route: `current` decides, never the router's partial match of the search. */}
            <Link to="/w/$wsId/workbench" params={{ wsId }} search={keptFiles} activeOptions={EXACT} data-testid="workbench-panel-files">
              {WORKBENCH_FILES_LABEL}
            </Link>
          </TabNavItem>
          <TabNavItem current={searching} asChild>
            <Link to="/w/$wsId/workbench" params={{ wsId }} search={keptSearch} activeOptions={EXACT} data-testid="workbench-panel-search">
              {WORKBENCH_SEARCH_LABEL}
            </Link>
          </TabNavItem>
          <TabNavItem current={changes} asChild>
            <Link to="/w/$wsId/workbench" params={{ wsId }} search={keptChanges} activeOptions={EXACT} data-testid="workbench-panel-changes">
              {WORKBENCH_CHANGES_LABEL}
            </Link>
          </TabNavItem>
          <TabNavItem current={problems} asChild>
            <Link to="/w/$wsId/workbench" params={{ wsId }} search={{ panel: 'problems' }} activeOptions={EXACT} data-testid="workbench-panel-problems">
              {WORKBENCH_PROBLEMS_LABEL}
            </Link>
          </TabNavItem>
        </TabNav>
        {problems ? (
          <WorkbenchProblems wsId={wsId} />
        ) : searching ? (
          <WorkbenchSearchPanel
            wsId={wsId}
            session={search.session}
            q={search.q ?? ''}
            mode={search.mode ?? 'text'}
            matchCase={search.matchCase === true}
            regex={search.regex === true}
            onChange={(next) => void navigate({ to: '/w/$wsId/workbench', params: { wsId }, search: searchAddress(next), replace: true })}
          />
        ) : changes ? (
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
          <WorkbenchFiles
            wsId={wsId}
            path={search.path}
            line={search.line}
            session={search.session}
            onSelect={(path) => void navigate({ to: '/w/$wsId/workbench', params: { wsId }, search: { path, ...kept } })}
          />
        )}
      </PageBody>
    </>
  );
}
