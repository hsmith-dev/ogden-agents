import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { House } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef } from 'react';
import { AGENT_NAME, ChatApiError, fetchSession, sendMessage } from '@/chat/chat-api';
import { Composer } from '@/chat/composer';
import { sessionView, type TranscriptMessage } from '@/chat/transcript';
import { useEventStream } from '@/events/event-stream';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { Button } from '@/ui/button';
import { Notice } from '@/ui/notice';
import { AgentMessage, UserMessage } from '@/ui/message';
import { EmptyState, PageBody, PageFooter } from '@/ui/page';
import { Skeleton } from '@/ui/skeleton';
import { StateGlyph } from '@/ui/state-glyph';
import { Text } from '@/ui/typography';

/**
 * `/w/:wsId/s/:sesId`: one chat (story 2.2), the minimal shell of the full
 * session view (story 2.10). The transcript and the session's state come
 * only from the event log (AD-5); the REST read only tells a chat that
 * exists from one that doesn't.
 */
export function SessionPage() {
  const { wsId, sesId } = useParams({ strict: false }) as { wsId: string; sesId: string };
  const { events, caughtUp } = useEventStream();
  const view = useMemo(() => sessionView(events, sesId), [events, sesId]);
  const session = useQuery({ queryKey: ['session', wsId, sesId], queryFn: () => fetchSession(wsId, sesId), retry: false });
  const end = useRef<HTMLDivElement>(null);
  const lastText = view.messages.at(-1)?.text.length ?? 0;

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [view.messages.length, lastText]);

  if (session.error instanceof ChatApiError && session.error.status === 404) {
    return (
      <>
        <WorkspaceHeader title="Chat" />
        <PageBody>
          <EmptyState
            data-testid="session-not-found"
            title="There is no such chat."
            description="It may belong to another project, or its history was deleted."
            actions={
              <Button asChild variant="outline">
                <Link to="/">
                  <House aria-hidden />
                  Go to projects
                </Link>
              </Button>
            }
          />
        </PageBody>
      </>
    );
  }

  const state = view.state ?? session.data?.state;
  const streaming = view.messages.some((message) => message.streaming);
  const loading = !view.known && !caughtUp;

  return (
    <>
      <WorkspaceHeader title="Chat">
        {state === undefined ? null : <StateGlyph state={state} data-testid="session-state" className="ml-auto" />}
      </WorkspaceHeader>
      <PageBody>
        <section aria-label="Conversation" aria-busy={streaming} data-testid="transcript" className="flex w-full max-w-(--space-chat-column) flex-col gap-4 self-center">
          {loading ? (
            <>
              <Skeleton />
              <Skeleton />
              <span role="status" className="sr-only">
                Loading the conversation
              </span>
            </>
          ) : view.messages.length === 0 ? (
            <Text variant="caption">Ask {AGENT_NAME} about this project.</Text>
          ) : (
            view.messages.map((message) => <Message key={message.messageId} message={message} />)
          )}
          {state === 'error' ? (
            <Notice variant="blocked" data-testid="session-error">
              {view.errorReason ?? `${AGENT_NAME} stopped with an error. Try again.`}
            </Notice>
          ) : null}
          <div ref={end} />
        </section>
      </PageBody>
      <PageFooter>
        <Composer
          label={`Message ${AGENT_NAME}`}
          blockedReason={state === 'working' ? `${AGENT_NAME} is working. You can send your next message when it's done.` : undefined}
          onSend={async (text) => {
            await sendMessage(wsId, sesId, text);
          }}
        />
      </PageFooter>
    </>
  );
}

/** One message: the user's in a muted block on the right, the agent's as body text under its name (DESIGN.md Message). */
function Message({ message }: { message: TranscriptMessage }) {
  if (message.role === 'user') return <UserMessage data-testid="message-user">{message.text}</UserMessage>;
  return (
    <AgentMessage name={AGENT_NAME} data-testid="message-agent" data-streaming={message.streaming} aria-busy={message.streaming}>
      {message.text}
    </AgentMessage>
  );
}
