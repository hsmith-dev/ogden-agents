import {
  fileSizeWords,
  WORKSPACE_FILE_BINARY_TEXT,
  WORKSPACE_FILE_EMPTY_TEXT,
  WORKSPACE_FILE_HARD_LINK_TEXT,
  WORKSPACE_FILE_MASKED_TEXT,
  WORKSPACE_FILE_NONE_SELECTED_TEXT,
  WORKSPACE_FILE_PROTECTED_TEXT,
  WORKSPACE_FILE_SHOW_RENDERED_LABEL,
  WORKSPACE_FILE_SHOW_SOURCE_LABEL,
  WORKSPACE_PATH_HARD_LINK_MESSAGE,
  workspaceFileTooLargeText,
  type WorkspaceFileEntry,
} from '@ogden-agents/shared';
import { useState } from 'react';
import { isApiError } from '@/api/http';
import { Markdown } from '@/ui/markdown';
import { Skeleton } from '@/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group';
import { Text } from '@/ui/typography';
import { CodeView, ViewerHeader, ViewerState } from './code-view';
import { OpenInEditorButton } from './open-in-editor';
import { FileTree } from './file-tree';
import { useMarkdownFileLinks } from './path-links';
import { ancestorsOf, parentOf, useWorkspaceFile, useWorkspaceFolder } from './workbench-api';

/** A file the viewer renders as Markdown (with Show source). */
export const isMarkdownPath = (path: string): boolean => /\.(?:md|markdown)$/i.test(path);

export interface WorkbenchFilesProps {
  wsId: string;
  path: string | undefined;
  /** A `file:line` link's line (8.7): scrolled to and highlighted. */
  line?: number | undefined;
  /** A worktree chat's id: the tree and the file are of its worktree (8.2's root). */
  session?: string | undefined;
  onSelect: (path: string) => void;
}

/**
 * The Workbench's Files panel (AD-36): the project's tree beside (below, on
 * a phone) the selected file, read-only. The selection is the page's
 * `?path=` (and `?line=`, `?session=`), so a link or a reload opens the same file.
 */
export function WorkbenchFiles({ wsId, path, line, session, onSelect }: WorkbenchFilesProps) {
  return (
    <div className="flex min-w-0 flex-col gap-4 md:flex-row md:items-start" data-testid="workbench-files">
      <div className="min-w-0 md:w-72 md:shrink-0">
        <FileTree key={session ?? ''} wsId={wsId} session={session} selected={path} onSelect={(entry: WorkspaceFileEntry) => onSelect(entry.path)} initiallyOpen={path === undefined ? [] : ancestorsOf(path)} />
      </div>
      <div className="min-w-0 flex-1">
        {path === undefined ? (
          <ViewerState path={undefined} testId="file-none">
            {WORKSPACE_FILE_NONE_SELECTED_TEXT}
          </ViewerState>
        ) : (
          <FileViewer key={`${session ?? ''}\u0000${path}`} wsId={wsId} path={path} line={line} session={session} />
        )}
      </div>
    </div>
  );
}

/**
 * One file. Its row comes from its folder's listing (the tree's own query),
 * so a protected row is known before anything else is asked: its content is
 * never requested. A folder's path shows the "pick a file" line.
 */
function FileViewer({ wsId, path, line, session }: { wsId: string; path: string; line: number | undefined; session: string | undefined }) {
  const parent = useWorkspaceFolder(wsId, parentOf(path), { reuse: true, session });
  const entry = parent.data?.entries.find((each) => each.path === path);
  const refused = entry?.protected === true || (parent.isError && isApiError(parent.error, 'path_protected'));
  const folder = entry?.kind === 'folder';
  const file = useWorkspaceFile(wsId, path, parent.isSuccess && !refused && !folder, session);

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
  // A file Ogden showed (or can't show here: binary, too large, empty) can open in the user's editor, at the link's line.
  const editor = <OpenInEditorButton wsId={wsId} session={session} target={{ path, line }} />;
  if (shown.kind === 'binary') {
    return (
      <ViewerState path={path} testId="file-binary" detail={fileSizeWords(shown.size)} actions={editor}>
        {WORKSPACE_FILE_BINARY_TEXT}
      </ViewerState>
    );
  }
  if (shown.kind === 'too_large') return <ViewerState path={path} testId="file-too-large" actions={editor}>{workspaceFileTooLargeText(shown.size, shown.limit)}</ViewerState>;
  if (shown.content === '') return <ViewerState path={path} testId="file-empty" actions={editor}>{WORKSPACE_FILE_EMPTY_TEXT}</ViewerState>;
  const notice = shown.masked ? (
    <Text variant="caption" data-testid="file-masked">
      {WORKSPACE_FILE_MASKED_TEXT}
    </Text>
  ) : undefined;
  // A masked file is never rendered: its lines show what was hidden.
  if (isMarkdownPath(path) && !shown.masked) return <MarkdownFile wsId={wsId} path={path} text={shown.content} line={line} session={session} />;
  return <CodeView path={path} text={shown.content} line={line} notice={notice} actions={editor} />;
}

/**
 * A markdown file: rendered through the chat's one safe renderer (its
 * relative links to confirmed files of the project lead to the viewer), with
 * Show source for its numbered lines. A `?line=` link opens the source at that line.
 */
function MarkdownFile({ wsId, path, text, line, session }: { wsId: string; path: string; text: string; line: number | undefined; session: string | undefined }) {
  const [mode, setMode] = useState<'rendered' | 'source'>(line === undefined ? 'rendered' : 'source');
  // A new `?line=` on the same file (back and forward, a `#L5` link) shows the source at it.
  const [shownLine, setShownLine] = useState(line);
  if (line !== shownLine) {
    setShownLine(line);
    if (line !== undefined) setMode('source');
  }
  const links = useMarkdownFileLinks(wsId, path, text, session);
  const toggle = (
    <ToggleGroup type="single" value={mode} onValueChange={(next) => (next === 'rendered' || next === 'source' ? setMode(next) : undefined)} aria-label="Markdown view" data-testid="markdown-mode">
      <ToggleGroupItem value="rendered" data-testid="markdown-mode-rendered">
        {WORKSPACE_FILE_SHOW_RENDERED_LABEL}
      </ToggleGroupItem>
      <ToggleGroupItem value="source" data-testid="markdown-mode-source">
        {WORKSPACE_FILE_SHOW_SOURCE_LABEL}
      </ToggleGroupItem>
    </ToggleGroup>
  );
  const actions = (
    <>
      {toggle}
      <OpenInEditorButton wsId={wsId} session={session} target={{ path, line }} />
    </>
  );
  if (mode === 'source') return <CodeView path={path} text={text} line={line} actions={actions} />;
  return (
    <section aria-label={path} data-testid="markdown-view" className="flex min-w-0 flex-col rounded-md border border-border bg-card">
      <ViewerHeader path={path} actions={actions} />
      <Markdown source={text} variant="file" links={links} className="p-3" data-testid="markdown-rendered" />
    </section>
  );
}
