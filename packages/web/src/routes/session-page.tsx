import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { ArrowClockwise, House, Stop } from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppearance } from '@/appearance/appearance-provider';
import { AGENT_NAME, cancelSession, ChatApiError, fetchSession, sendMessage } from '@/chat/chat-api';
import { Composer } from '@/chat/composer';
import { ToolCalls } from '@/chat/tool-call-row';
import { sessionView, type TranscriptCheckIn, type TranscriptMessage } from '@/chat/transcript';
import { useEventStream } from '@/events/event-stream';
import { PermissionCard, permissionAnnouncement } from '@/permissions/permission-card';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { Button } from '@/ui/button';
import { Notice } from '@/ui/notice';
import { Separator } from '@/ui/separator';
import { AgentMessage, UserMessage } from '@/ui/message';
import { EmptyState, PageBody, PageFooter } from '@/ui/page';
import { Skeleton } from '@/ui/skeleton';
import { StateGlyph } from '@/ui/state-glyph';
import { Text } from '@/ui/typography';

/** The marker at the break where a reopened chat continues (EXPERIENCE.md). */
const RESUMED_FROM_HISTORY = 'Resumed from history';

/** The last segment of a folder path, on any OS. */
const folderName = (path: string) => path.split(/[\\/]/).filter((part) => part !== '').at(-1) ?? path;

/** Puts the cursor back in the composer (after a permission decision; EXPERIENCE.md Accessibility Floor). */
const focusComposer = () => document.querySelector<HTMLTextAreaElement>('[data-testid="composer"] textarea')?.focus();

/** What the quiet-agent status line says (user decision, story 2.10). */
const checkInWords = (checkIn: TranscriptCheckIn) =>
  checkIn.waitingOn === undefined ? `${AGENT_NAME} has been quiet for 10 minutes` : `${AGENT_NAME} is waiting on ${checkIn.waitingOn}`;

/**
 * `/w/:wsId/s/:sesId`: one chat (story 2.2). The transcript and the
 * session's state come only from the event log (AD-5); the REST read only
 * tells a chat that exists from one that doesn't. Permission cards (story
 * 2.6) sit inline where the agent asked; while one waits off-screen, a bar
 * above the composer leads back to it. Story 2.10: tool-call rows, messages
 * sent while the agent works shown "Queued" (or "Not sent", their text put
 * back in the composer), the quiet-agent status line, Stop beside the
 * composer while the agent works or waits (no confirmation; `Esc` never
 * stops), and the error notice with Try again.
 */
export function SessionPage() {
  const { wsId, sesId } = useParams({ strict: false }) as { wsId: string; sesId: string };
  const { events, caughtUp } = useEventStream();
  const { appearance } = useAppearance();
  const view = useMemo(() => sessionView(events, sesId), [events, sesId]);
  const session = useQuery({ queryKey: ['session', wsId, sesId], queryFn: () => fetchSession(wsId, sesId), retry: false });
  const end = useRef<HTMLDivElement>(null);
  const lastText = view.messages.at(-1)?.text.length ?? 0;
  const projectName = useMemo(() => {
    for (const event of events) if (event.type === 'workspace.created' && event.payload.workspace.id === wsId) return folderName(event.payload.workspace.realPath ?? event.payload.workspace.path);
    return 'this project';
  }, [events, wsId]);
  const waitingFor = view.pendingPermissions[0];
  const [announcement, setAnnouncement] = useState('');
  const announced = useRef(new Set<string>());
  const [cardOffscreen, setCardOffscreen] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  /** Messages this page saw queued: only those go back into the composer when they are not sent. */
  const seenQueued = useRef(new Set<string>());
  const restored = useRef(new Set<string>());
  const [restore, setRestore] = useState<{ key: string; text: string } | undefined>(undefined);

  useEffect(() => {
    for (const message of view.queued) seenQueued.current.add(message.messageId);
    const back = view.notSent.filter((message) => seenQueued.current.has(message.messageId) && !restored.current.has(message.messageId));
    if (back.length === 0) return;
    for (const message of back) restored.current.add(message.messageId);
    setRestore({ key: back.map((message) => message.messageId).join(','), text: back.map((message) => message.text).join('\n\n') });
  }, [view.queued, view.notSent]);

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [view.items.length, lastText]);

  // A new card announces once, assertively, and never takes focus.
  useEffect(() => {
    if (waitingFor === undefined || announced.current.has(waitingFor.requestId)) return;
    announced.current.add(waitingFor.requestId);
    setAnnouncement(`${AGENT_NAME} is waiting for you: ${permissionAnnouncement(waitingFor)}`);
  }, [waitingFor]);

  // Whether the waiting card is out of view, for the "waiting for you" bar.
  useEffect(() => {
    setCardOffscreen(false);
    if (waitingFor === undefined || typeof IntersectionObserver === 'undefined') return;
    const card = document.getElementById(`permission-${waitingFor.requestId}`);
    if (card === null) return;
    const observer = new IntersectionObserver(([entry]) => setCardOffscreen(entry !== undefined && !entry.isIntersecting));
    observer.observe(card);
    return () => observer.disconnect();
  }, [waitingFor]);

  const showCard = useCallback(() => {
    if (waitingFor === undefined) return;
    const card = document.getElementById(`permission-${waitingFor.requestId}`);
    card?.scrollIntoView?.({ block: 'center' });
    card?.focus({ preventScroll: true });
  }, [waitingFor]);

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
  const busy = state === 'working' || state === 'waiting';

  const stop = () => {
    if (stopping) return;
    setStopping(true);
    setActionError(undefined);
    cancelSession(wsId, sesId).then(
      () => setStopping(false),
      (failure: unknown) => {
        setStopping(false);
        // 409: it had already ended; nothing to say.
        if (failure instanceof ChatApiError && failure.status === 409) return;
        setActionError(failure instanceof Error ? failure.message : "Ogden Agents couldn't stop the agent. Try again.");
      },
    );
  };

  const tryAgain = () => {
    if (view.lastUserText === undefined) return;
    setActionError(undefined);
    sendMessage(wsId, sesId, view.lastUserText).catch((failure: unknown) =>
      setActionError(failure instanceof Error ? failure.message : "Your message couldn't be sent. Try again."),
    );
  };

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
          ) : view.items.length === 0 ? (
            <Text variant="caption">Ask {AGENT_NAME} about this project.</Text>
          ) : (
            view.items.map((item, index) =>
              item.type === 'message' ? (
                <Message key={item.message.messageId} message={item.message} />
              ) : item.type === 'tools' ? (
                <ToolCalls key={`tools-${item.calls[0]?.toolCallId ?? index}`} calls={item.calls} density={appearance.density} />
              ) : item.type === 'resumed' ? (
                <ResumedMarker key={`resumed-${item.at}-${index}`} />
              ) : (
                <PermissionCard
                  key={item.permission.requestId}
                  permission={item.permission}
                  wsId={wsId}
                  sesId={sesId}
                  projectName={projectName}
                  onDecided={focusComposer}
                />
              ),
            )
          )}
          {view.queued.map((message) => (
            <Message key={message.messageId} message={message} />
          ))}
          {state === 'working' && view.checkIn !== undefined ? (
            <Notice
              data-testid="check-in"
              data-waiting-on={view.checkIn.waitingOn}
              role="status"
              action={
                view.checkIn.waitingOn === undefined ? (
                  <Button variant="outline" onClick={stop} aria-disabled={stopping} data-testid="check-in-stop">
                    <Stop aria-hidden />
                    Stop
                  </Button>
                ) : null
              }
            >
              <StateGlyph state="working" label={checkInWords(view.checkIn)} />
            </Notice>
          ) : null}
          {state === 'error' ? (
            <Notice
              variant="blocked"
              data-testid="session-error"
              data-error-code={view.errorCode}
              action={
                view.lastUserText === undefined ? null : (
                  <Button variant="outline" onClick={tryAgain} data-testid="try-again">
                    <ArrowClockwise aria-hidden />
                    Try again
                  </Button>
                )
              }
            >
              {view.errorReason ?? `${AGENT_NAME} stopped with an error. Try again.`}
            </Notice>
          ) : null}
          {actionError === undefined ? null : (
            <Text variant="caption" role="alert" data-testid="session-action-error">
              {actionError}
            </Text>
          )}
          <div ref={end} />
        </section>
        <div aria-live="assertive" aria-atomic="true" className="sr-only" data-testid="permission-announcement">
          {announcement}
        </div>
      </PageBody>
      <PageFooter>
        {waitingFor !== undefined && cardOffscreen ? (
          <div className="pb-2">
            <Button variant="outline" className="w-full justify-start" data-testid="waiting-bar" onClick={showCard}>
              <StateGlyph state="waiting" label={`${AGENT_NAME} is waiting for you`} />
            </Button>
          </div>
        ) : null}
        <Composer
          label={`Message ${AGENT_NAME}`}
          blockedReason={state === 'waiting' ? `${AGENT_NAME} is waiting for your answer above.` : undefined}
          hint={state === 'working' ? `${AGENT_NAME} is working. A message you send now waits its turn.` : undefined}
          restore={restore}
          action={
            busy ? (
              <Button type="button" variant="outline" onClick={stop} aria-disabled={stopping} data-testid="stop">
                <Stop aria-hidden />
                Stop
              </Button>
            ) : null
          }
          onSend={async (text) => {
            await sendMessage(wsId, sesId, text);
          }}
        />
      </PageFooter>
    </>
  );
}

/**
 * Where a chat was reopened after its agent's process was gone (story 2.7):
 * the same words for every way it came back (EXPERIENCE.md, session `idle`).
 */
function ResumedMarker() {
  return (
    <div role="separator" aria-label={RESUMED_FROM_HISTORY} data-testid="resumed-marker" className="flex items-center gap-3">
      <Separator className="flex-1" />
      <Text as="span" variant="caption" className="shrink-0">
        {RESUMED_FROM_HISTORY}
      </Text>
      <Separator className="flex-1" />
    </div>
  );
}

/** What a message sent while the agent worked says under it (EXPERIENCE.md Composer). */
const QUEUE_WORDS = { queued: 'Queued', not_sent: 'Not sent' } as const;

/**
 * One message: the user's in a muted block on the right, the agent's as body
 * text under its name (DESIGN.md Message). A queued or unsent one says so under it.
 */
function Message({ message }: { message: TranscriptMessage }) {
  if (message.role === 'user' && message.status !== undefined) {
    return (
      <div className="flex max-w-[85%] flex-col items-end gap-1 self-end" data-testid="message-queued" data-status={message.status}>
        <UserMessage className="max-w-full">{message.text}</UserMessage>
        <Text variant="caption" data-testid="message-queue-status">
          {QUEUE_WORDS[message.status]}
        </Text>
      </div>
    );
  }
  if (message.role === 'user') return <UserMessage data-testid="message-user">{message.text}</UserMessage>;
  return (
    <AgentMessage name={AGENT_NAME} data-testid="message-agent" data-streaming={message.streaming} aria-busy={message.streaming}>
      {message.text}
    </AgentMessage>
  );
}
