import { WORKTREE_PUT_AWAY_TEXT, WORKTREE_RESTORE_LABEL, WORKTREE_RESTORE_RETRY_LABEL } from '@ogden-agents/shared';
import { useState } from 'react';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { useRestoreWorktree } from './worktree-retention';

/**
 * A chat whose copy retention put away (epic 27, 27.6): one line and
 * Restore. A Restore that couldn't finish says why in the server's own
 * sentence (the saved changes are kept) and offers Try again. Once restored
 * the list no longer names the chat, so the notice goes and the composer
 * takes messages again.
 */
export function PutAwayNotice({ wsId, sesId, onRestored }: { wsId: string; sesId: string; onRestored?: () => void }) {
  const restore = useRestoreWorktree(wsId);
  const [state, setState] = useState<'idle' | 'restoring' | { error: string }>('idle');
  const failed = typeof state === 'object';
  const run = () => {
    if (state === 'restoring') return;
    setState('restoring');
    restore(sesId).then(
      () => {
        setState('idle');
        onRestored?.();
      },
      (error: unknown) => setState({ error: error instanceof Error ? error.message : String(error) }),
    );
  };
  return (
    <Banner
      data-testid="worktree-put-away"
      action={
        <Button type="button" variant="link" size="sm" onClick={run} aria-disabled={state === 'restoring' || undefined} data-testid="worktree-restore">
          {failed ? WORKTREE_RESTORE_RETRY_LABEL : WORKTREE_RESTORE_LABEL}
        </Button>
      }
    >
      {failed ? <span data-testid="worktree-restore-error">{state.error}</span> : state === 'restoring' ? `${WORKTREE_PUT_AWAY_TEXT} Restoring...` : WORKTREE_PUT_AWAY_TEXT}
    </Banner>
  );
}
