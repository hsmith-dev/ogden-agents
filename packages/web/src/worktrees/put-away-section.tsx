import { PUT_AWAY_COPIES_DESCRIPTION, PUT_AWAY_COPIES_EMPTY_TEXT, PUT_AWAY_COPIES_TITLE, putAwayFilesText, restoreWorktreeLabel, WORKTREE_RESTORE_LABEL, type PutAwayWorktree } from '@ogden-agents/shared';
import { useState } from 'react';
import { Button } from '@/ui/button';
import { Notice } from '@/ui/notice';
import { PageSection } from '@/ui/page';
import { Text } from '@/ui/typography';
import { useRestoreWorktree, usePutAwayWorktrees } from './worktree-retention';

/** The day a copy was put away, as "31 Oct 2026". */
const putAwayOn = (at: string) => new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** The list of a project's put-away copies, newest first, each with its branch, its saved files and Restore. */
function PutAwayCopiesView({
  worktrees,
  onRestore,
  restoring,
  error,
  restored,
}: {
  worktrees: readonly PutAwayWorktree[] | undefined;
  onRestore: (worktree: PutAwayWorktree) => void;
  restoring: string | undefined;
  error: string | undefined;
  /** Where the last Restore here put the copy, in its own sentence. */
  restored?: string | undefined;
}) {
  return (
    <PageSection title={PUT_AWAY_COPIES_TITLE} data-testid="put-away-section">
      <Text>{PUT_AWAY_COPIES_DESCRIPTION}</Text>
      {worktrees === undefined ? null : worktrees.length === 0 ? (
        <Text variant="caption" data-testid="put-away-empty">
          {PUT_AWAY_COPIES_EMPTY_TEXT}
        </Text>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="put-away-list">
          {worktrees.map((worktree) => (
            <li key={worktree.id} className="flex min-h-(--control-height) items-center justify-between gap-3" data-testid="put-away-row">
              <span className="flex min-w-0 flex-col">
                <Text as="span" variant="label" className="break-all font-mono">
                  {worktree.branch}
                </Text>
                <Text as="span" variant="caption">
                  {putAwayFilesText(worktree.files)}, put away <time dateTime={worktree.putAwayAt}>{putAwayOn(worktree.putAwayAt)}</time>
                </Text>
              </span>
              <Button
                variant="outline"
                size="sm"
                data-testid="put-away-restore"
                aria-label={restoreWorktreeLabel(worktree.branch)}
                aria-disabled={restoring === worktree.sessionId || undefined}
                onClick={restoring === worktree.sessionId ? undefined : () => onRestore(worktree)}
              >
                {restoring === worktree.sessionId ? 'Restoring...' : WORKTREE_RESTORE_LABEL}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {restored !== undefined ? (
        <Text variant="caption" role="status" data-testid="put-away-restored">
          {restored}
        </Text>
      ) : null}
      {error === undefined ? null : (
        <Notice variant="blocked" role="alert" data-testid="put-away-error">
          {error}
        </Notice>
      )}
    </PageSection>
  );
}

/** Workspace settings' Put-away copies (epic 27, 27.6): the project's list, Restore each. Shown only once a copy was put away. */
export function PutAwayCopiesSection({ wsId }: { wsId: string }) {
  const list = usePutAwayWorktrees(wsId);
  const restore = useRestoreWorktree(wsId);
  const [restoring, setRestoring] = useState<string | undefined>(undefined);
  const [restored, setRestored] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  // Nothing put away, nothing restored here: the section stays out of the way.
  if ((list.data === undefined || list.data.length === 0) && restored === undefined && error === undefined && !list.isError) return null;
  const onRestore = (worktree: PutAwayWorktree) => {
    setRestoring(worktree.sessionId);
    setRestored(undefined);
    setError(undefined);
    restore(worktree.sessionId).then(
      (text) => {
        setRestoring(undefined);
        setRestored(text);
      },
      (failure: unknown) => {
        setRestoring(undefined);
        setError(failure instanceof Error ? failure.message : "Restore couldn't finish. Try again.");
      },
    );
  };
  return <PutAwayCopiesView worktrees={list.data} onRestore={onRestore} restoring={restoring} restored={restored} error={error ?? (list.error instanceof Error ? list.error.message : undefined)} />;
}
