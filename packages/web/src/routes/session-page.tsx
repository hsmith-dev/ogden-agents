import { useQuery } from '@tanstack/react-query';
import type { SessionDriver } from '@ogden-agents/shared';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { ArrowClockwise, ArrowDown, ChatCircle, House, Stop } from '@phosphor-icons/react';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAppearance } from '@/appearance/appearance-provider';
import { AGENT_NAME, cancelSession, ChatApiError, fetchSession, sendMessage, switchDriver } from '@/chat/chat-api';
import { Composer } from '@/chat/composer';
import { ReadOnlyConversation } from '@/chat/read-only';
import { SignInAgain } from '@/chat/sign-in-again';
import { ToolCalls } from '@/chat/tool-call-row';
import { sessionView, type TranscriptCheckIn, type TranscriptItem, type TranscriptMessage } from '@/chat/transcript';
import { useCaughtUp, useEarlierHistory, useSessionEvents } from '@/events/event-stream';
import { PermissionCard, permissionAnnouncement } from '@/permissions/permission-card';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { DriverToggle, NOT_IDLE_REASON } from '@/terminal/driver-toggle';
import { ReadOnlyBanner } from '@/terminal/read-only-banner';
import { TerminalPanel } from '@/terminal/terminal-panel';
import { conversationProps, TerminalPane } from '@/terminal/terminal-pane';
import { useDriverSwitch } from '@/terminal/use-driver-switch';
import { useDriverShortcut } from '@/terminal/use-driver-shortcut';
import type { SessionSearch } from '@/router';
import { Button } from '@/ui/button';
import { Notice } from '@/ui/notice';
import { Separator } from '@/ui/separator';
import { AgentMessage, UserMessage } from '@/ui/message';
import { EmptyState, PageBody, PageFooter } from '@/ui/page';
import { Skeleton } from '@/ui/skeleton';
import { StateGlyph } from '@/ui/state-glyph';
import { Text } from '@/ui/typography';
import { fetchWorkspace, workspaceName } from '@/workspaces/workspace-api';

/** The marker at the break where a reopened chat continues (EXPERIENCE.md). */
const RESUMED_FROM_HISTORY = 'Resumed from history';

/** How close to the bottom (px) still counts as at the bottom, for auto-scroll. */
const AT_BOTTOM_PX = 48;

/** An item's identity, as its React key: the Jump to latest count finds where the reader left off by it. */
const itemKey = (item: TranscriptItem, index: number): string =>
  item.type === 'message'
    ? item.message.messageId
    : item.type === 'tools'
      ? `tools-${item.calls[0]?.toolCallId ?? index}`
      : item.type === 'resumed'
        ? `resumed-${item.at}-${index}`
        : item.permission.requestId;

/** Puts the cursor back in the composer (after a permission decision; EXPERIENCE.md Accessibility Floor). */
const focusComposer = () => document.querySelector<HTMLTextAreaElement>('[data-testid="composer"] textarea')?.focus();

/** What the composer says while the terminal drives (DESIGN.md Composer). */
const TERMINAL_DRIVING_REASON = 'The terminal is driving this session';

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
 * stops), and the error notice with Try again. Story 2.10 part B: the fold
 * runs over this session's own stream, older history loads with Show earlier
 * at the top (a chat older than the workspace window loads its latest page on
 * opening), and while the reader is scrolled up new items do not move the
 * view but count on "Jump to latest". Story 3.6: in Developer mode the
 * header's Chat | Terminal toggle (and `⌘.` / `Ctrl+.`) hands the chat to the
 * agent's own terminal and back; the view follows only
 * `session.driver_changed`, and `?driver=terminal` mirrors it.
 */
export function SessionPage() {
  const { wsId, sesId } = useParams({ strict: false }) as { wsId: string; sesId: string };
  const events = useSessionEvents(wsId, sesId);
  // The workspace's own stream carries the always-allow rules undone since (the cards' Undo).
  const workspaceEvents = useSessionEvents(wsId, wsId);
  const caughtUp = useCaughtUp();
  const history = useEarlierHistory(wsId, sesId);
  const { appearance } = useAppearance();
  const rulesRemoved = useMemo(
    () => new Set(workspaceEvents.flatMap((event) => (event.type === 'workspace.permission_rule_removed' ? [event.payload.ruleId] : []))),
    [workspaceEvents],
  );
  const view = useMemo(() => sessionView(events, sesId, rulesRemoved), [events, sesId, rulesRemoved]);
  const session = useQuery({ queryKey: ['session', wsId, sesId], queryFn: () => fetchSession(wsId, sesId), retry: false });
  const search = useSearch({ strict: false }) as SessionSearch;
  const navigate = useNavigate();
  const workspace = useQuery({ queryKey: ['workspace', wsId], queryFn: () => fetchWorkspace(wsId), retry: false });
  const end = useRef<HTMLDivElement>(null);
  const lastText = view.messages.at(-1)?.text.length ?? 0;
  const projectName = workspace.data === undefined ? 'this project' : workspaceName(workspace.data);
  const waitingFor = view.pendingPermissions[0];
  const [announcement, setAnnouncement] = useState('');
  const announced = useRef(new Set<string>());
  const [cardOffscreen, setCardOffscreen] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  /** The driver this tab asked for last, so switching back to chat puts the cursor in the composer. */
  const requested = useRef<SessionDriver | undefined>(undefined);
  const [peekOpen, setPeekOpen] = useState(false);
  const peekId = useId();
  /** Who drives the chat (story 3.1): the latest `session.driver_changed`, else the session as read. */
  const driverChange = useMemo(() => events.findLast((event) => event.type === 'session.driver_changed'), [events]);
  const driver = (driverChange?.type === 'session.driver_changed' ? driverChange.payload.driver : undefined) ?? session.data?.session.driver ?? 'ui';
  const driverKnown = driverChange !== undefined || session.data !== undefined;
  const terminal = session.data?.terminal;
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

  // A chat whose events are all older than the workspace window: load its latest page once.
  const autoLoaded = useRef<string | undefined>(undefined);
  const { hasEarlier, loadEarlier } = history;
  useEffect(() => {
    if (!caughtUp || view.known || !hasEarlier || autoLoaded.current === sesId) return;
    autoLoaded.current = sesId;
    loadEarlier();
  }, [caughtUp, view.known, hasEarlier, sesId, loadEarlier]);

  // Auto-scroll only while the reader is at the bottom; otherwise count what arrives.
  const keys = useMemo(() => [...view.items.map(itemKey), ...view.queued.map((message) => message.messageId)], [view.items, view.queued]);
  const lastKey = keys.at(-1);
  const atBottom = useRef(true);
  const [scrolledUp, setScrolledUp] = useState(false);
  /** The last item the reader saw at the bottom, before scrolling up. */
  const [seenKey, setSeenKey] = useState<string | undefined>(undefined);
  const lastKeyRef = useRef(lastKey);
  lastKeyRef.current = lastKey;
  const scroller = useCallback(() => end.current?.closest<HTMLElement>('[data-slot="page-body"]') ?? null, []);
  useEffect(() => {
    const container = scroller();
    if (container === null) return;
    const onScroll = () => {
      const bottom = container.scrollHeight - container.scrollTop - container.clientHeight <= AT_BOTTOM_PX;
      if (bottom === atBottom.current) return;
      atBottom.current = bottom;
      setScrolledUp(!bottom);
      setSeenKey(bottom ? undefined : lastKeyRef.current);
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [scroller]);
  useEffect(() => {
    if (atBottom.current) end.current?.scrollIntoView?.({ block: 'end' });
  }, [lastKey, lastText]);
  const seenAt = seenKey === undefined ? -1 : keys.lastIndexOf(seenKey);
  const unseen = scrolledUp && seenAt !== -1 ? keys.length - 1 - seenAt : 0;
  const jumpToLatest = () => {
    atBottom.current = true;
    setScrolledUp(false);
    setSeenKey(undefined);
    end.current?.scrollIntoView?.({ block: 'end' });
    focusComposer();
  };

  // Show earlier keeps what the reader sees in place: the older items go in above it.
  const anchor = useRef<{ height: number; top: number } | undefined>(undefined);
  const showEarlier = () => {
    const container = scroller();
    anchor.current = container === null ? undefined : { height: container.scrollHeight, top: container.scrollTop };
    loadEarlier();
  };
  const firstKey = keys[0];
  useLayoutEffect(() => {
    const container = scroller();
    if (anchor.current === undefined || container === null) return;
    container.scrollTop = container.scrollHeight - anchor.current.height + anchor.current.top;
    anchor.current = undefined;
  }, [firstKey, scroller]);
  // A load that settled without new items above (an error, or an empty page) leaves nothing to
  // hold in place: forget the anchor, so a later change at the top does not jump the view (review F3).
  // Declared after the effect above, so a page that did add items is placed first.
  useLayoutEffect(() => {
    if (!history.loading) anchor.current = undefined;
  }, [history.loading]);

  // A new card announces once, assertively, and never takes focus.
  useEffect(() => {
    if (waitingFor === undefined || announced.current.has(waitingFor.requestId)) return;
    announced.current.add(waitingFor.requestId);
    setAnnouncement(`${AGENT_NAME} is waiting for you: ${permissionAnnouncement(waitingFor)}`);
  }, [waitingFor]);

  // Whether the waiting card is out of view, for the "waiting for you" bar. Not while the terminal
  // drives: the conversation is read-only then, and nothing in it takes focus (3.6 review F2).
  const terminalDrives = driver === 'terminal';
  useEffect(() => {
    setCardOffscreen(false);
    if (terminalDrives || waitingFor === undefined || typeof IntersectionObserver === 'undefined') return;
    const card = document.getElementById(`permission-${waitingFor.requestId}`);
    if (card === null) return;
    const observer = new IntersectionObserver(([entry]) => setCardOffscreen(entry !== undefined && !entry.isIntersecting));
    observer.observe(card);
    return () => observer.disconnect();
  }, [waitingFor, terminalDrives]);

  const showCard = useCallback(() => {
    if (terminalDrives || waitingFor === undefined) return;
    const card = document.getElementById(`permission-${waitingFor.requestId}`);
    card?.scrollIntoView?.({ block: 'center' });
    card?.focus({ preventScroll: true });
  }, [waitingFor, terminalDrives]);

  const state = view.state ?? session.data?.session.state;
  /**
   * Why the Terminal segment can't be used now: the terminal can't work here (verbatim), or the agent
   * is not idle; `null` while the session is still loading (disabled, nothing to say; 3.6 review F5).
   */
  const terminalBlockedReason =
    terminal?.available === false
      ? terminal.reason
      : state === undefined
        ? null
        : state !== 'idle' || view.queued.length > 0
          ? NOT_IDLE_REASON
          : undefined;

  // The view flipped (or the session changed driver by itself): the switch is over, and availability may have changed.
  const { refetch: refetchSession } = session;
  const driverSeq = driverChange?.seq;
  useEffect(() => setPeekOpen(false), [driver]);
  useEffect(() => {
    if (driverSeq !== undefined) void refetchSession();
  }, [driverSeq, refetchSession]);
  // Turning idle can make the terminal available (a first reply gives the chat an agent session).
  const previousState = useRef(state);
  useEffect(() => {
    const was = previousState.current;
    previousState.current = state;
    if (state === 'idle' && was !== undefined && was !== 'idle') void refetchSession();
  }, [state, refetchSession]);

  // Back in the chat: the cursor goes to the composer when this tab asked, or when focus fell with the terminal.
  const previousDriver = useRef(driver);
  useEffect(() => {
    const was = previousDriver.current;
    previousDriver.current = driver;
    if (was === 'terminal' && driver === 'ui') {
      const active = document.activeElement;
      if (requested.current === 'ui' || active === null || active === document.body) focusComposer();
    }
    if (was !== driver) requested.current = undefined;
  }, [driver]);

  // `?driver=terminal` mirrors who drives (replace, no history entry); opening that URL never switches.
  useEffect(() => {
    if (!driverKnown) return;
    const wanted = driver === 'terminal' ? 'terminal' : undefined;
    if (search.driver === wanted) return;
    void navigate({ to: '/w/$wsId/s/$sesId', params: { wsId, sesId }, search: wanted === undefined ? {} : { driver: wanted }, replace: true });
  }, [driverKnown, driver, search.driver, navigate, wsId, sesId]);

  // The chat's own terminal and back (stories 3.1, 3.6): one request, then wait for `session.driver_changed`
  // (or, after a while, check with the server; 3.6 review F1).
  const { switchingTo, start: startSwitch } = useDriverSwitch({
    driver,
    send: (next) => switchDriver(wsId, sesId, next),
    confirm: () => refetchSession().then((result) => result.data?.session.driver),
    onError: (message, failure) => {
      requested.current = undefined;
      setActionError(message);
      // 409: the server's view differs (busy, unavailable, already switched): read the session again.
      if (failure instanceof ChatApiError && failure.status === 409) void refetchSession();
    },
  });
  const switchTo = (next: SessionDriver) => {
    if (switchingTo !== undefined || next === driver) return;
    if (next === 'terminal' && terminalBlockedReason !== undefined) {
      // Only the shortcut gets here (the toggle refuses first): say why, if there is anything to say.
      if (terminalBlockedReason !== null) setActionError(terminalBlockedReason);
      return;
    }
    requested.current = next;
    setActionError(undefined);
    startSwitch(next);
  };
  useDriverShortcut(appearance.developerMode && driverKnown, () => switchTo(driver === 'terminal' ? 'ui' : 'terminal'));

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

  const streaming = view.messages.some((message) => message.streaming);
  // Until the backlog arrives, or while an older chat's first page loads.
  const firstPagePending = history.loading || (history.hasEarlier && history.error === undefined && autoLoaded.current !== sesId);
  const loading = !view.known && (!caughtUp || (firstPagePending && view.items.length === 0));
  const busy = state === 'working' || state === 'waiting';
  /** The latest user message that was sent: an error after a new one (a resend) is a new error. */
  const lastSentUserId = view.messages.findLast((message) => message.role === 'user' && message.status === undefined)?.messageId;

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
        {appearance.developerMode ? (
          <DriverToggle
            driver={driver}
            switching={switchingTo}
            terminalBlockedReason={terminalBlockedReason}
            onSwitch={switchTo}
            className={state === undefined ? 'ml-auto' : undefined}
          />
        ) : null}
      </WorkspaceHeader>
      {driver === 'terminal' ? (
        <ReadOnlyBanner
          onSwitchToChat={() => switchTo('ui')}
          switching={switchingTo !== undefined}
          peekOpen={peekOpen}
          onTogglePeek={() => setPeekOpen((open) => !open)}
          peekId={peekId}
        />
      ) : null}
      {/* While the terminal drives it takes the main pane; at `xl` the read-only conversation can open beside it. */}
      <TerminalPane driving={driver === 'terminal'}>
        {driver === 'terminal' ? <TerminalPanel sesId={sesId} screenReaderMode={appearance.terminalScreenReader} /> : null}
        <PageBody
          id={peekId}
          {...conversationProps(driver === 'terminal', peekOpen)}
        >
          {/* While the terminal drives: readable, nothing in it sends (3.6 review F2). */}
          <ReadOnlyConversation.Provider value={terminalDrives}>
            <section aria-label="Conversation" aria-busy={streaming} data-testid="transcript" className="flex w-full max-w-(--space-chat-column) flex-col gap-4 self-center">
              {!loading && (history.hasEarlier || history.error !== undefined) ? (
                <EarlierHistory loading={history.loading} error={history.error} onShow={showEarlier} />
              ) : null}
              {loading ? (
                <>
                  <Skeleton />
                  <Skeleton />
                  <span role="status" className="sr-only">
                    Loading the conversation
                  </span>
                </>
              ) : view.items.length === 0 && !history.hasEarlier ? (
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
                    view.checkIn.waitingOn === undefined && !terminalDrives ? (
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
              {state === 'error' && view.errorCode === 'auth_required' && !terminalDrives ? (
                // Keyed per error (the message it failed on), so each one starts unarmed (9.4).
                <SignInAgain
                  key={`${sesId}:${lastSentUserId ?? ''}`}
                  reason={view.errorReason}
                  canTryAgain={view.lastUserText !== undefined}
                  onTryAgain={tryAgain}
                />
              ) : state === 'error' ? (
                <Notice
                  variant="blocked"
                  data-testid="session-error"
                  data-error-code={view.errorCode}
                  action={
                    view.lastUserText === undefined || terminalDrives ? null : (
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
          </ReadOnlyConversation.Provider>
        </PageBody>
      </TerminalPane>
      <PageFooter>
        {driver === 'terminal' && actionError !== undefined ? (
          <Text variant="caption" role="alert" data-testid="terminal-switch-error" className="pb-2">
            {actionError}
          </Text>
        ) : null}
        {unseen > 0 ? (
          <div className="flex justify-center pb-2">
            <Button variant="outline" data-testid="jump-to-latest" data-count={unseen} onClick={jumpToLatest}>
              <ArrowDown aria-hidden />
              Jump to latest ({unseen})
            </Button>
          </div>
        ) : null}
        {waitingFor !== undefined && cardOffscreen && !terminalDrives ? (
          <div className="pb-2">
            <Button variant="outline" className="w-full justify-start" data-testid="waiting-bar" onClick={showCard}>
              <StateGlyph state="waiting" label={`${AGENT_NAME} is waiting for you`} />
            </Button>
          </div>
        ) : null}
        <Composer
          label={`Message ${AGENT_NAME}`}
          blockedReason={
            driver === 'terminal'
              ? TERMINAL_DRIVING_REASON
              : state === 'waiting'
                ? `${AGENT_NAME} is waiting for your answer above.`
                : undefined
          }
          hint={state === 'working' ? `${AGENT_NAME} is working. A message you send now waits its turn.` : undefined}
          restore={restore}
          action={
            busy ? (
              <Button type="button" variant="outline" onClick={stop} aria-disabled={stopping} data-testid="stop">
                <Stop aria-hidden />
                Stop
              </Button>
            ) : driver === 'terminal' ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => switchTo('ui')}
                aria-disabled={switchingTo !== undefined || undefined}
                data-testid="composer-switch-to-chat"
              >
                <ChatCircle aria-hidden />
                Switch to Chat
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
 * "Show earlier" at the top of the transcript (EXPERIENCE.md: no infinite
 * scroll): one page per press, in place, with no reload. A page that fails or
 * times out says so inline, with Try again.
 */
function EarlierHistory({ loading, error, onShow }: { loading: boolean; error: string | undefined; onShow: () => void }) {
  if (error !== undefined && !loading) {
    return (
      <div data-testid="earlier-history-error" className="flex items-center justify-center gap-2" title={error}>
        <Text as="span" variant="caption" role="alert">
          Couldn't load.
        </Text>
        <Button variant="outline" onClick={onShow} data-testid="earlier-history-retry">
          <ArrowClockwise aria-hidden />
          Try again
        </Button>
      </div>
    );
  }
  return (
    <div className="flex justify-center">
      <Button variant="ghost" onClick={onShow} aria-disabled={loading} aria-busy={loading} data-testid="show-earlier">
        {loading ? 'Loading earlier messages' : 'Show earlier'}
      </Button>
    </div>
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
  if (message.role === 'user' && message.origin === 'terminal') {
    // Typed in the agent's own terminal and brought back on switching (story 3.6; DESIGN.md Caption).
    return (
      <div className="flex max-w-[85%] flex-col items-end gap-1 self-end" data-testid="message-from-terminal">
        <UserMessage className="max-w-full" data-testid="message-user">
          {message.text}
        </UserMessage>
        <Text variant="caption" data-testid="message-origin">
          from terminal
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
