import { COPY_IGNORED_FILES_TEXT, COPY_IGNORED_FILES_UNREAD_TEXT, ignoredFilesMoreText } from '@ogden-agents/shared';
import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { fetchCopyIgnoredFiles } from './chat-api';

/** Read each time a confirmation opens: the copy changes under the user. */
export function useCopyIgnoredFiles(wsId: string, sesId: string, enabled: boolean) {
  return useQuery({ queryKey: ['copy-ignored-files', wsId, sesId], queryFn: () => fetchCopyIgnoredFiles(wsId, sesId), enabled, retry: false, staleTime: 0, gcTime: 0 });
}

/**
 * The ignored files a worktree chat's copy loses when it goes (user
 * decision 2026-11-01: Move to this folder, Delete chat), so the user can
 * copy anything first: the first names (rebuildable folders like
 * node_modules left out by the server) and "and N more"; a plain line when
 * they couldn't be listed; nothing when there are none.
 */
export function CopyIgnoredFiles({ wsId, sesId, enabled }: { wsId: string; sesId: string; enabled: boolean }) {
  const ignored = useCopyIgnoredFiles(wsId, sesId, enabled);
  // Its own id: a trial's Keep with Delete lists several copies at once (27.8).
  const lineId = useId();
  if (!enabled || ignored.isPending) return null;
  if (ignored.isError || !ignored.data.listed) {
    return (
      <p className="m-0 text-label text-muted-foreground" data-testid="copy-ignored-files-unread">
        {COPY_IGNORED_FILES_UNREAD_TEXT}
      </p>
    );
  }
  const { files, more } = ignored.data;
  if (files.length === 0 && more === 0) return null;
  return (
    <div className="flex flex-col gap-1" data-testid="copy-ignored-files">
      <p className="m-0 text-label text-muted-foreground" id={lineId}>
        {COPY_IGNORED_FILES_TEXT}
      </p>
      <ul aria-labelledby={lineId} className="m-0 max-h-48 list-none overflow-y-auto p-0 font-mono text-mono-compact">
        {files.map((name) => (
          <li key={name} className="truncate" data-testid="copy-ignored-file" title={name}>
            {name}
          </li>
        ))}
      </ul>
      {more > 0 ? (
        <p className="m-0 text-label text-muted-foreground" data-testid="copy-ignored-files-more">
          {ignoredFilesMoreText(more)}
        </p>
      ) : null}
    </div>
  );
}
