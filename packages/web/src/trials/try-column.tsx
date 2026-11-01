import {
  TRIAL_KEEP_LABEL,
  TRIAL_KEPT_TEXT,
  TRIAL_LEFT_TEXT,
  TRIAL_NOT_KEPT_TEXT,
  TRIAL_OPEN_CHAT_LABEL,
  TRIAL_REMOVED_TEXT,
  TRIAL_REVIEW_CHANGES_LABEL,
  trialChangesText,
  WORKTREE_RESTORE_LABEL,
  type PutAwayWorktree,
  type Session,
  type Trial,
  type TrialChat,
} from '@ogden-agents/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { StateGlyph } from '@/ui/state-glyph';
import { Text } from '@/ui/typography';
import { fetchChanges } from '@/workbench/changes-api';
import { useRestoreWorktree } from '@/worktrees/worktree-retention';

/**
 * One agent's column on the Try page (27.8): its name, state glyph and
 * word, "+N -M" (8.4's Changes: Branch, Staged and Unstaged summed) while its copy is there,
 * Open chat, Review changes and Keep this one; once kept, "Kept" or "Not
 * kept" (Restore while its copy is put away), "Not kept. Deleted." or the
 * copy that couldn't go safely.
 */
export function TryColumn({
  wsId,
  trial,
  chat,
  agentName,
  session,
  sessionsLoaded,
  putAway,
  onKeep,
}: {
  wsId: string;
  trial: Trial;
  chat: TrialChat;
  agentName: string;
  session: Session | undefined;
  sessionsLoaded: boolean;
  putAway: PutAwayWorktree | undefined;
  onKeep: () => void;
}) {
  const gone = sessionsLoaded && session === undefined;
  const hasCopy = session !== undefined && putAway === undefined;
  // The copy's real work while it is there: Branch (committed) plus Staged and Unstaged, read again each time the chat's state changes (a turn ends).
  const changes = useQuery({
    queryKey: ['workspace-changes', wsId, 'try', chat.sessionId, session?.state ?? ''],
    queryFn: async () => {
      const views = await Promise.all((['branch', 'staged', 'unstaged'] as const).map((view) => fetchChanges(wsId, { view, session: chat.sessionId })));
      return views.flatMap((view) => view.files).reduce((sum, file) => ({ additions: sum.additions + file.additions, deletions: sum.deletions + file.deletions }), { additions: 0, deletions: 0 });
    },
    enabled: hasCopy,
    retry: false,
  });
  const restore = useRestoreWorktree(wsId);
  const [restoring, setRestoring] = useState<'idle' | 'restoring' | { text: string }>('idle');
  const undecided = trial.keptSessionId === null;
  const kept = trial.keptSessionId === chat.sessionId;
  const totals = hasCopy ? changes.data : undefined;
  const outcome = kept
    ? TRIAL_KEPT_TEXT
    : undecided
      ? gone
        ? TRIAL_REMOVED_TEXT
        : undefined
      : chat.result === 'removed' || gone
        ? TRIAL_REMOVED_TEXT
        : chat.result === 'left'
          ? TRIAL_LEFT_TEXT
          : TRIAL_NOT_KEPT_TEXT;
  const onRestore = () => {
    if (restoring === 'restoring') return;
    setRestoring('restoring');
    restore(chat.sessionId).then(
      (text) => setRestoring({ text }),
      (error: unknown) => setRestoring({ text: error instanceof Error ? error.message : String(error) }),
    );
  };
  return (
    <li
      className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-(--panel-padding)"
      data-testid="try-column"
      data-session={chat.sessionId}
      data-agent={chat.agentId}
      data-result={kept ? 'kept' : undecided ? 'open' : gone ? 'removed' : chat.result}
      aria-label={agentName}
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <Text as="h2" variant="heading" className="min-w-0 truncate">
          {agentName}
        </Text>
        {session === undefined ? null : <StateGlyph state={session.state} data-testid="try-column-state" />}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {outcome === undefined ? null : (
          <Badge variant={kept ? 'default' : 'outline'} data-testid="try-column-outcome">
            {outcome}
          </Badge>
        )}
        {totals === undefined ? null : (
          <Text as="span" variant="mono-compact" data-testid="try-column-changes">
            {trialChangesText(totals.additions, totals.deletions)}
          </Text>
        )}
      </div>
      {typeof restoring === 'object' ? (
        <Text variant="caption" role="status" data-testid="try-column-restored">
          {restoring.text}
        </Text>
      ) : null}
      {session === undefined ? null : (
        <div className="mt-auto flex min-w-0 flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/w/$wsId/s/$sesId" params={{ wsId, sesId: chat.sessionId }} data-testid="try-open-chat" aria-label={`${TRIAL_OPEN_CHAT_LABEL}: ${agentName}`}>
              {TRIAL_OPEN_CHAT_LABEL}
            </Link>
          </Button>
          {hasCopy ? (
            <Button asChild variant="outline" size="sm">
              <Link
                to="/w/$wsId/workbench"
                params={{ wsId }}
                search={{ panel: 'changes', session: chat.sessionId }}
                data-testid="try-review-changes"
                aria-label={`${TRIAL_REVIEW_CHANGES_LABEL}: ${agentName}`}
              >
                {TRIAL_REVIEW_CHANGES_LABEL}
              </Link>
            </Button>
          ) : null}
          {undecided && putAway === undefined ? (
            <Button size="sm" onClick={onKeep} data-testid="try-keep" aria-label={`${TRIAL_KEEP_LABEL}: ${agentName}`}>
              {TRIAL_KEEP_LABEL}
            </Button>
          ) : null}
          {putAway !== undefined && !kept ? (
            <Button size="sm" variant="outline" onClick={onRestore} aria-disabled={restoring === 'restoring' || undefined} data-testid="try-restore" aria-label={`${WORKTREE_RESTORE_LABEL}: ${agentName}`}>
              {restoring === 'restoring' ? 'Restoring...' : WORKTREE_RESTORE_LABEL}
            </Button>
          ) : null}
        </div>
      )}
    </li>
  );
}
