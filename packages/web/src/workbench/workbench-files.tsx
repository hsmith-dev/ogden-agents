import {
  WORKSPACE_FILE_BINARY_TEXT,
  WORKSPACE_FILE_EMPTY_TEXT,
  WORKSPACE_FILE_HARD_LINK_TEXT,
  WORKSPACE_FILE_MASKED_TEXT,
  WORKSPACE_FILE_NONE_SELECTED_TEXT,
  WORKSPACE_FILE_PROTECTED_TEXT,
  WORKSPACE_FILE_TOO_LARGE_TEXT,
  WORKSPACE_PATH_HARD_LINK_MESSAGE,
  type WorkspaceFileEntry,
} from '@ogden-agents/shared';
import { isApiError } from '@/api/http';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/typography';
import { CodeView, ViewerHeader, ViewerState } from './code-view';
import { FileTree } from './file-tree';
import { ancestorsOf, parentOf, useWorkspaceFile, useWorkspaceFolder } from './workbench-api';

/**
 * The Workbench's Files panel (AD-36): the project's tree beside (below, on
 * a phone) the selected file, read-only. The selection is the page's
 * `?path=`, so a link or a reload opens the same file.
 */
export function WorkbenchFiles({ wsId, path, onSelect }: { wsId: string; path: string | undefined; onSelect: (path: string) => void }) {
  return (
    <div className="flex min-w-0 flex-col gap-4 md:flex-row md:items-start" data-testid="workbench-files">
      <div className="min-w-0 md:w-72 md:shrink-0">
        <FileTree wsId={wsId} selected={path} onSelect={(entry: WorkspaceFileEntry) => onSelect(entry.path)} initiallyOpen={path === undefined ? [] : ancestorsOf(path)} />
      </div>
      <div className="min-w-0 flex-1">{path === undefined ? <ViewerState path={undefined} testId="file-none">{WORKSPACE_FILE_NONE_SELECTED_TEXT}</ViewerState> : <FileViewer key={path} wsId={wsId} path={path} />}</div>
    </div>
  );
}

/**
 * One file. Its row comes from its folder's listing (the tree's own query),
 * so a protected row is known before anything else is asked: its content is
 * never requested. A folder's path shows the "pick a file" line.
 */
function FileViewer({ wsId, path }: { wsId: string; path: string }) {
  const parent = useWorkspaceFolder(wsId, parentOf(path), { reuse: true });
  const entry = parent.data?.entries.find((each) => each.path === path);
  const refused = entry?.protected === true || (parent.isError && isApiError(parent.error, 'path_protected'));
  const folder = entry?.kind === 'folder';
  const file = useWorkspaceFile(wsId, path, parent.isSuccess && !refused && !folder);

  if (refused) return <ViewerState path={path} testId="file-protected">{entry?.protectedReason === 'hard_link' ? WORKSPACE_FILE_HARD_LINK_TEXT : WORKSPACE_FILE_PROTECTED_TEXT}</ViewerState>;
  if (folder) return <ViewerState path={path} testId="file-none">{WORKSPACE_FILE_NONE_SELECTED_TEXT}</ViewerState>;
  if (parent.isError) return <ViewerState path={path} testId="file-error">{parent.error.message}</ViewerState>;
  if (file.isError) {
    return (
      <ViewerState path={path} testId={isApiError(file.error, 'path_protected') ? 'file-protected' : 'file-error'}>
        {isApiError(file.error, 'path_protected') ? (file.error.message === WORKSPACE_PATH_HARD_LINK_MESSAGE ? WORKSPACE_FILE_HARD_LINK_TEXT : WORKSPACE_FILE_PROTECTED_TEXT) : file.error.message}
      </ViewerState>
    );
  }
  if (!file.isSuccess) {
    return (
      <section aria-label={path} className="flex min-w-0 flex-col gap-2" data-testid="file-loading">
        <ViewerHeader path={path} />
        <span role="status" className="sr-only">
          Loading the file
        </span>
        <Skeleton />
        <Skeleton />
      </section>
    );
  }
  const shown = file.data;
  if (shown.kind === 'binary') return <ViewerState path={path} testId="file-binary">{WORKSPACE_FILE_BINARY_TEXT}</ViewerState>;
  if (shown.kind === 'too_large') return <ViewerState path={path} testId="file-too-large">{WORKSPACE_FILE_TOO_LARGE_TEXT}</ViewerState>;
  if (shown.content === '') return <ViewerState path={path} testId="file-empty">{WORKSPACE_FILE_EMPTY_TEXT}</ViewerState>;
  return (
    <CodeView
      path={path}
      text={shown.content}
      notice={
        shown.masked ? (
          <Text variant="caption" data-testid="file-masked">
            {WORKSPACE_FILE_MASKED_TEXT}
          </Text>
        ) : undefined
      }
    />
  );
}
