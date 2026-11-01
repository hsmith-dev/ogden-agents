/**
 * Open in editor, the client half (AD-39, E8-R9; story 8.10; EXPERIENCE.md
 * Open in editor): the editors the server found, and one file of the
 * project (or of the chat's worktree) handed to the default one at its
 * line. The page only ever sends the workspace-relative path and a line:
 * the server locates the file and picks the program from its own list.
 * With no editor found (or a server without the launcher) every button is
 * disabled with {@link EDITOR_NONE_FOUND_TEXT} as its visible reason. There
 * is no toast component: the button shows its own word for a moment, and a
 * `role=status` beside it says the same.
 */
import {
  API_ROUTES,
  apiPath,
  EDITOR_LOAD_FAILED_TEXT,
  EDITOR_NONE_FOUND_TEXT,
  EDITOR_OPEN_FAILED_LABEL,
  EDITOR_OPEN_FAILED_TEXT,
  editorOpenedText,
  EditorsResponse,
  OPEN_IN_EDITOR_LABEL,
  OpenInEditorResponse,
  WorkspaceRelativePath,
  type ChangedFile,
} from '@ogden-agents/shared';
import { ArrowSquareOut } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useId, useState, type MouseEvent, type ReactNode } from 'react';
import { call, postJson, type Auth } from '@/api/http';
import { tabAuth } from '@/auth/tab-token';
import { Button } from '@/ui/button';
import type { DiffFileData } from '@/ui/diff-viewer';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/tooltip';

/** How long "Opened in VS Code" or "Couldn't open" shows before the label comes back. */
export const EDITOR_FEEDBACK_MS = 2_500;

export const EDITORS_QUERY_KEY = ['editors'] as const;

/** `GET /api/v1/editors`. */
export async function fetchEditors(auth: Auth = tabAuth): Promise<EditorsResponse> {
  return EditorsResponse.parse(await call(auth, API_ROUTES.editors, {}, EDITOR_LOAD_FAILED_TEXT));
}

/** What to open: a workspace-relative path at its line, in a chat's worktree for `session`. */
export interface EditorTarget {
  path: string;
  line?: number | undefined;
  column?: number | undefined;
}

/** `POST /api/v1/workspaces/:wsId/files/open-in-editor`. */
export async function openInEditor(wsId: string, target: EditorTarget, session: string | undefined, auth: Auth = tabAuth): Promise<OpenInEditorResponse> {
  const body = {
    path: target.path,
    ...(target.line === undefined ? {} : { line: target.line }),
    ...(target.column === undefined ? {} : { column: target.column }),
    ...(session === undefined ? {} : { session }),
  };
  return OpenInEditorResponse.parse(await call(auth, apiPath(API_ROUTES.workspaceFileOpenInEditor, { wsId }), postJson(body), EDITOR_OPEN_FAILED_TEXT));
}

/**
 * The editors found. `available` is false while loading, with none found,
 * or when the server can't say (a 501 without the launcher, or an error):
 * then `reason` is the one sentence every surface shows.
 */
export function useEditors() {
  const query = useQuery({ queryKey: EDITORS_QUERY_KEY, queryFn: () => fetchEditors(), retry: false, staleTime: 30_000 });
  const data = query.data;
  const available = data !== undefined && data.defaultEditorId !== null;
  const reason = query.isPending || available ? undefined : EDITOR_NONE_FOUND_TEXT;
  return { query, data, available, reason };
}

export type EditorFeedback = { kind: 'opened' | 'failed'; text: string } | undefined;

/** Opens targets of `wsId` (and `session`), with the last answer's words for a moment. */
export function useOpenInEditor(wsId: string, session: string | undefined) {
  const [feedback, setFeedback] = useState<EditorFeedback>(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (feedback === undefined) return;
    const timer = setTimeout(() => setFeedback(undefined), EDITOR_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [feedback]);
  const open = useCallback(
    (target: EditorTarget) => {
      setBusy(true);
      setFeedback(undefined);
      return openInEditor(wsId, target, session).then(
        (opened) => {
          setBusy(false);
          setFeedback({ kind: 'opened', text: editorOpenedText(opened.editorName) });
        },
        (failure: unknown) => {
          setBusy(false);
          setFeedback({ kind: 'failed', text: failure instanceof Error && failure.message !== '' ? failure.message : EDITOR_OPEN_FAILED_TEXT });
        },
      );
    },
    [wsId, session],
  );
  /** Says why nothing was opened (no editor found), as a failed open would. */
  const refuse = useCallback((text: string) => setFeedback({ kind: 'failed', text }), []);
  return { open, refuse, feedback, busy };
}

/** The visually hidden live region that says what happened. */
function Status({ feedback, testId }: { feedback: EditorFeedback; testId: string }) {
  return (
    <span role="status" className="sr-only" data-testid={testId}>
      {feedback?.text ?? ''}
    </span>
  );
}

/**
 * Open in editor for one file: `Opened in VS Code` (or `Couldn't open`, its
 * reason announced) for a moment after a click. Disabled, with its reason
 * as a tooltip and its description, when no editor is found.
 */
export function OpenInEditorButton({ wsId, session, target, testId = 'open-in-editor' }: { wsId: string; session: string | undefined; target: EditorTarget; testId?: string }) {
  const editors = useEditors();
  const { open, feedback, busy } = useOpenInEditor(wsId, session);
  const reasonId = useId();
  const disabled = !editors.available || busy;
  const words = feedback === undefined ? OPEN_IN_EDITOR_LABEL : feedback.kind === 'opened' ? feedback.text : EDITOR_OPEN_FAILED_LABEL;
  const button = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-disabled={disabled || undefined}
      aria-describedby={editors.reason === undefined ? undefined : reasonId}
      data-testid={testId}
      data-state={feedback?.kind}
      onClick={() => {
        if (disabled) return;
        void open(target);
      }}
    >
      <ArrowSquareOut aria-hidden />
      {/* Its name is the words shown, then which file (beside other files' buttons in a diff). */}
      <span>{words}</span>
      <span className="sr-only">{`: ${target.path}`}</span>
    </Button>
  );
  return (
    <>
      {editors.reason === undefined ? (
        button
      ) : (
        // Its own provider: the button sits in surfaces (a test's, a chat row's) that may have none.
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent data-testid={`${testId}-reason-tooltip`}>{editors.reason}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {editors.reason === undefined ? null : (
        <span id={reasonId} className="sr-only" data-testid={`${testId}-reason`}>
          {editors.reason}
        </span>
      )}
      <Status feedback={feedback} testId={`${testId}-status`} />
    </>
  );
}

/**
 * A path link's `Cmd`/`Ctrl`+click: it never follows the link. When an
 * editor is found it opens `target` there; when none is (`reason`), it says
 * so through `refuse`. While the editors are still loading, the link
 * behaves as a link.
 */
export function openInEditorClick(
  event: MouseEvent,
  editors: { available: boolean; reason: string | undefined },
  target: EditorTarget,
  open: (target: EditorTarget) => unknown,
  refuse: (text: string) => void,
): void {
  if (event.button !== 0 || !(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
  if (!editors.available && editors.reason === undefined) return;
  event.preventDefault();
  if (editors.available) void open(target);
  else refuse(editors.reason!);
}

export { Status as EditorStatus };

/** Whether `path` is absolute (POSIX, or a Windows drive path). */
const isAbsolutePath = (path: string): boolean => path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);

/**
 * `path` as the viewer and the server take it: a workspace-relative path
 * as it is, or an absolute one (an agent's edit names its file so) that sits
 * under one of `roots` (the chat's folder) made relative to it, separator by
 * separator and with no `.` or `..` segment. `undefined` otherwise: no
 * button. The server checks the path again.
 */
export function editorPathOf(path: string, roots: readonly string[] = []): string | undefined {
  if (!isAbsolutePath(path)) return WorkspaceRelativePath.safeParse(path).success ? path : undefined;
  for (const root of roots) {
    if (!isAbsolutePath(root)) continue;
    const windows = /^[A-Za-z]:/.test(root);
    const trimmed = root.replace(windows ? /[\\/]+$/ : /\/+$/, '');
    const separators = windows ? ['\\', '/'] : ['/'];
    const sep = separators.find((one) => path.startsWith(`${trimmed}${one}`));
    if (sep === undefined) continue;
    const segments = path.slice(trimmed.length + 1).split(windows ? /[\\/]/ : '/');
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return undefined;
    const relative = segments.join('/');
    return WorkspaceRelativePath.safeParse(relative).success ? relative : undefined;
  }
  return undefined;
}

/**
 * A diff viewer's `fileActions` with Open in editor after `inner`'s (a
 * view's own file actions): for a file that is still there (not deleted)
 * whose path is workspace-relative, or absolute under one of `roots` (a
 * chat's folder), at its first hunk's new line.
 */
export function withOpenInEditor(wsId: string, session: string | undefined, data: readonly DiffFileData[], inner?: (file: ChangedFile) => ReactNode, roots: readonly string[] = []): (file: ChangedFile) => ReactNode {
  const firstLine = new Map(data.map((entry) => [entry.file.path, entry.hunks[0]?.newStart]));
  return (file) => {
    const own = inner?.(file);
    const path = file.change === 'deleted' ? undefined : editorPathOf(file.path, roots);
    if (path === undefined) return own;
    const line = firstLine.get(file.path);
    return (
      <>
        {own}
        <OpenInEditorButton wsId={wsId} session={session} target={{ path, line: line !== undefined && line >= 1 ? line : undefined }} testId="diff-open-in-editor" />
      </>
    );
  };
}
