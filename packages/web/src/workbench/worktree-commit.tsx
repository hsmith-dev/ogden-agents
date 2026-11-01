/**
 * Commit these changes (story 8.4): for a chat working in a worktree of its
 * own, its changes committed on its own branch, never pushed. Moved out of
 * `workbench-changes.tsx` by the epic 8 sweep (8.12).
 */
import { COMMIT_MESSAGE_LABEL, COMMIT_WORKTREE_LABEL, committedText, MAX_COMMIT_MESSAGE_CHARS, WORKTREE_NEVER_PUSHED_TEXT, agentMidTurnText } from '@ogden-agents/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { fetchSession } from '@/chat/chat-api';
import { Button } from '@/ui/button';
import { Field } from '@/ui/field';
import { Notice } from '@/ui/notice';
import { Textarea } from '@/ui/textarea';
import { Text } from '@/ui/typography';
import { isBusy } from '@/workspaces/workspace-api';
import { useCommitWorktree } from './changes-api';
import { chatWorktree, sessionKey } from './chat-folder';

/** Commit these changes, for a chat working in its own worktree: on its own branch, never pushed. */
export function WorktreeCommit({ wsId, session: sesId }: { wsId: string; session: string }) {
  const session = useQuery({
    queryKey: sessionKey(wsId, sesId),
    queryFn: () => fetchSession(wsId, sesId),
    retry: false,
    // While its agent works, the state is read again so Commit comes back once it is done.
    refetchInterval: (query) => (query.state.data !== undefined && isBusy(query.state.data.session) ? 2000 : false),
  });
  const commit = useCommitWorktree(wsId, sesId);
  const [message, setMessage] = useState('');
  const found = session.data?.session;
  if (found === undefined || chatWorktree(found) === null) return null;
  const busy = isBusy(found);
  const empty = message.trim() === '';
  return (
    <form
      className="flex min-w-0 flex-col gap-2"
      data-testid="worktree-commit"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || empty || commit.isPending) return;
        commit.mutate(message.trim(), { onSuccess: () => setMessage('') });
      }}
    >
      <Field id="worktree-commit-message" label={COMMIT_MESSAGE_LABEL} description={WORKTREE_NEVER_PUSHED_TEXT}>
        <Textarea
          id="worktree-commit-message"
          aria-describedby="worktree-commit-message-description"
          value={message}
          maxLength={MAX_COMMIT_MESSAGE_CHARS}
          onChange={(event) => setMessage(event.target.value)}
          data-testid="worktree-commit-message"
        />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" aria-disabled={busy || empty || commit.isPending || undefined} data-testid="worktree-commit-button">
          {COMMIT_WORKTREE_LABEL}
        </Button>
        {busy ? (
          <Text variant="caption" data-testid="worktree-commit-busy">
            {agentMidTurnText('The agent')}
          </Text>
        ) : null}
        {commit.isSuccess ? (
          <Text variant="caption" role="status" data-testid="worktree-committed">
            {committedText(commit.data.files)}
          </Text>
        ) : null}
      </div>
      {commit.isError ? (
        <Notice variant="blocked" data-testid="worktree-commit-error">
          {commit.error.message}
        </Notice>
      ) : null}
    </form>
  );
}
