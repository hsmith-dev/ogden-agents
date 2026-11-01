import { TRIAL_NOT_FOUND_TEXT, TRIAL_PAGE_TITLE, type TrialChat } from '@ogden-agents/shared';
import { useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { isApiError } from '@/api/http';
import { agentNameOf } from '@/chat/chat-api';
import { useChatAgents } from '@/chat/use-chat-agents';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { KeepDialog, type KeepOther } from '@/trials/keep-dialog';
import { TryColumn } from '@/trials/try-column';
import { useTrial } from '@/trials/trials-api';
import { EmptyState, PageBody } from '@/ui/page';
import { Text } from '@/ui/typography';
import { cn } from '@/ui/utils';
import { usePutAwayWorktrees } from '@/worktrees/worktree-retention';
import { useSessions } from '@/workspaces/workspace-api';

/** The grid's columns at `md` and up, by how many agents ran (below `md` they stack). */
const COLUMNS: Record<number, string> = { 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-2 lg:grid-cols-4' };

/**
 * `/w/:wsId/try/:tryId` (epic 27, 27.8; EXPERIENCE.md Try page): one column
 * per agent with its state glyph and word, "+N -M" (8.4's Changes: Branch, Staged and
 * Unstaged summed), Open chat, Review changes (the Changes panel for that chat)
 * and Keep this one. Once kept, the others read "Not kept", with Restore
 * while their copy is put away. Below `md` the columns stack. Nothing is
 * merged.
 */
export function TryPage() {
  const { wsId, tryId } = useParams({ strict: false }) as { wsId: string; tryId: string };
  const trial = useTrial(wsId, tryId);
  const { sessions } = useSessions(wsId);
  const agents = useChatAgents(wsId);
  const putAway = usePutAwayWorktrees(wsId);
  const [keeping, setKeeping] = useState<TrialChat | undefined>(undefined);

  if (trial.isError) {
    return (
      <>
        <WorkspaceHeader title={TRIAL_PAGE_TITLE} wsId={wsId} />
        <PageBody data-testid="try-page">
          <EmptyState data-testid="try-not-found" title={isApiError(trial.error, 'not_found') ? TRIAL_NOT_FOUND_TEXT : trial.error.message} />
        </PageBody>
      </>
    );
  }

  const data = trial.data;
  const byId = new Map((sessions ?? []).map((session) => [session.id, session]));
  const putAwayById = new Map((putAway.data ?? []).map((record) => [record.sessionId, record]));
  const nameOf = (chat: TrialChat) => agentNameOf(agents.data, chat.agentId);
  const others = (kept: TrialChat): KeepOther[] =>
    (data?.chats ?? [])
      .filter((chat) => chat.sessionId !== kept.sessionId && byId.has(chat.sessionId))
      .map((chat) => ({ sessionId: chat.sessionId, agentName: nameOf(chat), hasCopy: !putAwayById.has(chat.sessionId), savedFiles: putAwayById.get(chat.sessionId)?.files ?? 0 }));

  return (
    <>
      <WorkspaceHeader title={TRIAL_PAGE_TITLE} wsId={wsId} />
      <PageBody data-testid="try-page">
        {data === undefined ? null : (
          <div className="flex min-w-0 flex-col gap-4">
            <Text variant="body" className="line-clamp-3 break-words whitespace-pre-wrap" data-testid="try-task-text">
              {data.text}
            </Text>
            <ul className={cn('m-0 grid min-w-0 list-none grid-cols-1 gap-3 p-0', COLUMNS[data.chats.length])} data-testid="try-columns">
              {data.chats.map((chat) => (
                <TryColumn
                  key={chat.sessionId}
                  wsId={wsId}
                  trial={data}
                  chat={chat}
                  agentName={nameOf(chat)}
                  session={byId.get(chat.sessionId)}
                  sessionsLoaded={sessions !== undefined}
                  putAway={putAwayById.get(chat.sessionId)}
                  onKeep={() => setKeeping(chat)}
                />
              ))}
            </ul>
          </div>
        )}
        {data === undefined || keeping === undefined ? null : (
          <KeepDialog
            open
            onOpenChange={(open) => {
              if (!open) setKeeping(undefined);
            }}
            wsId={wsId}
            trial={data}
            sessionId={keeping.sessionId}
            agentName={nameOf(keeping)}
            others={others(keeping)}
            putAwayLoaded={!putAway.isPending}
            onKept={() => {
              setKeeping(undefined);
              void trial.refetch();
            }}
          />
        )}
      </PageBody>
    </>
  );
}
