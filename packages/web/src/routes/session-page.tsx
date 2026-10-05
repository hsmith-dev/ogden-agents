import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { ArrowClockwise, ArrowDown, ChatCircle, House, Stop } from '@phosphor-icons/react';
import type { PermissionMode } from '@ogden-agents/shared';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAgents } from '@/agents/agent-setup-api';
import { useAppearance } from '@/appearance/appearance-provider';
import { agentNameOf, cancelSession, ChatApiError, UNKNOWN_AGENT_NAME, fetchSession, sendMessage, setPermissionMode, setSessionModel, switchDriver } from '@/chat/chat-api';
import { ChatHeaderRename, useChatName, useChatRename } from '@/chat/chat-name';
import { agentDefaultLabel, ModelPicker, modelLabel, useSessionModel } from '@/chat/model-picker';
import { useChatAgents } from '@/chat/use-chat-agents';
import { Composer } from '@/chat/composer';
import { chatDraftKey } from '@/chat/drafts';
import { ReadOnlyConversation } from '@/chat/read-only';
import { SignInAgain } from '@/chat/sign-in-again';
import { ToolCalls } from '@/chat/tool-call-row';
import { sessionView, type TranscriptCheckIn, type TranscriptItem } from '@/chat/transcript';
import { EarlierHistory, Message, ResumedMarker } from '@/chat/transcript-parts';
import { useCaughtUp, useEarlierHistory, useSessionEvents } from '@/events/event-stream';
import { PermissionCard, permissionAnnouncement } from '@/permissions/permission-card';
import { DocumentCard } from '@/planning/document-card';
import { StartModeNote, useStartModeNote } from '@/permissions/default-permission-mode';
import { PermissionModePicker, SkipAllBanner, usePermissionMode } from '@/permissions/permission-mode-picker';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { DriverToggle } from '@/terminal/driver-toggle';
import { ReadOnlyBanner } from '@/terminal/read-only-banner';
import { TerminalPanel } from '@/terminal/terminal-panel';
import { conversationProps, TerminalPane } from '@/terminal/terminal-pane';
import { focusComposer, useSessionDriver } from '@/terminal/use-session-driver';
import { Button } from '@/ui/button';
import { Notice } from '@/ui/notice';
import { EmptyState, PageBody, PageFooter } from '@/ui/page';
import { Skeleton } from '@/ui/skeleton';
import { StateGlyph } from '@/ui/state-glyph';
import { Text } from '@/ui/typography';
import { fetchWorkspace, workspaceName } from '@/workspaces/workspace-api';

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
        : item.type === 'document'
          ? `document-${item.path}`
          : item.permission.requestId;

/** What the composer says while the terminal drives (DESIGN.md Composer). */
const TERMINAL_DRIVING_REASON = 'The terminal is driving this session';

/** What the quiet-agent status line says (user decision, story 2.10). */
const checkInWords = (checkIn: TranscriptCheckIn, agentName: string) =>
  checkIn.waitingOn === undefined ? `${agentName} has been quiet for 10 minutes` : `${agentName} is waiting on ${checkIn.waitingOn}`;

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
 * `session.driver_changed`, and `?driver=terminal` mirrors it. Story 4.7: a
 * planning session's `session.document_written` shows as a document card
 * (one per path) with Open and the next suggested step, which opens the new
 * planning session it starts. Permission modes: the header's picker sets
 * the chat's mode (Skip all only in Developer mode, after its red warning),
 * the view follows only `session.permission_mode_changed`, and a chat in
 * Skip all shows the red banner above the conversation or the terminal.
 */
export function SessionPage() {
  const { wsId, sesId } = useParams({ strict: false }) as { wsId: string; sesId: string };
  const events = useSessionEvents(wsId, sesId);
  const navigate = useNavigate();
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
  // The chat's own agent, by its product name (epic 6, E6-R1).
  const chatAgents = useChatAgents();
  // Until the session has loaded its agent isn't known: no agent's name is guessed (review: a second agent's chat named Claude Code).
  const agentName = session.data === undefined ? UNKNOWN_AGENT_NAME : agentNameOf(chatAgents.data, session.data.session.agentId);
  const agentId = session.data === undefined ? undefined : (session.data.session.agentId ?? chatAgents.data?.defaultAgentId);
  const severalAgents = (chatAgents.data?.agents.length ?? 0) > 1;
  // Sign in again (9.4) signs in to the chat's own agent, when it has a setup (entry 6); otherwise the plain error notice.
  const setups = useAgents();
  const signsInHere = agentId !== undefined && setups.data?.some((setup) => setup.agentId === agentId) === true;
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
    setAnnouncement(`${agentName} is waiting for you: ${permissionAnnouncement(waitingFor)}`);
  }, [waitingFor]);

  const state = view.state ?? session.data?.session.state;
  // Who drives, and switching (stories 3.1, 3.6; the wiring is the hook's, story 3.9).
  const { driver, terminalDrives, terminalBlockedReason, switchingTo, switchTo, peekOpen, togglePeek, peekId } = useSessionDriver({
    wsId,
    sesId,
    events,
    session,
    state,
    queued: view.queued.length,
    developerMode: appearance.developerMode,
    agentName,
    setActionError,
  });

  // The chat's name (backlog story 12): the view follows `session.renamed`; Rename beside it in the header.
  const { name: shownName, title: userTitle } = useChatName(events, session.data?.session);
  const chatTitle = shownName === '' ? 'Chat' : shownName;
  const rename = useChatRename({ wsId, sesId, name: chatTitle, title: userTitle, className: 'max-w-80' });

  // The chat's permission mode (permission modes): one change at a time; the view follows the event.
  const permissionMode = usePermissionMode(events, session.data?.session.permissionMode);
  // The note about the mode the chat started in (default permission mode), until dismissed.
  const startModeNote = useStartModeNote(events);
  const [modeChanging, setModeChanging] = useState(false);
  /** A change on its way (a ref, so a second click in the same render is ignored too). */
  const modeInFlight = useRef(false);
  const { refetch: refetchSession } = session;
  const changeMode = useCallback(
    (mode: PermissionMode, confirmed: boolean, fromTerminal = false) => {
      if (modeInFlight.current) return;
      modeInFlight.current = true;
      setModeChanging(true);
      setActionError(undefined);
      // From the terminal, back to the chat first: the server changes no mode while the terminal drives.
      const back = fromTerminal ? switchDriver(wsId, sesId, 'ui').then(() => undefined) : Promise.resolve();
      back
        .then(() => setPermissionMode(wsId, sesId, mode, confirmed))
        .then(
          () => {
            modeInFlight.current = false;
            setModeChanging(false);
            void refetchSession();
          },
          (failure: unknown) => {
            modeInFlight.current = false;
            setModeChanging(false);
            setActionError(failure instanceof Error ? failure.message : "Ogden Agents couldn't change this chat's permission mode. Try again.");
            // 409 or 403: the server's view differs (unavailable, the terminal drives, Developer mode is off).
            void refetchSession();
          },
        );
    },
    [wsId, sesId, refetchSession],
  );

  // The chat's model (story 11): one change at a time; the view follows the event, and it applies to the next message.
  const { model, refusal } = useSessionModel(events, session.data?.session.model);
  const sessionModels = session.data?.models;
  const [modelChanging, setModelChanging] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  /** The refusal the user put away (its reason), so its notice doesn't follow every later message. */
  const [dismissedRefusal, setDismissedRefusal] = useState<string | undefined>(undefined);
  const modelInFlight = useRef(false);
  const changeModel = useCallback(
    (next: string | null) => {
      if (modelInFlight.current) return;
      modelInFlight.current = true;
      setModelChanging(true);
      setActionError(undefined);
      setSessionModel(wsId, sesId, next).then(
        () => {
          modelInFlight.current = false;
          setModelChanging(false);
          void refetchSession();
        },
        (failure: unknown) => {
          modelInFlight.current = false;
          setModelChanging(false);
          setActionError(failure instanceof Error ? failure.message : "Ogden Agents couldn't change this chat's model. Try again.");
          void refetchSession();
        },
      );
    },
    [wsId, sesId, refetchSession],
  );
  const modelWords = model === null ? agentDefaultLabel(agentName) : modelLabel(sessionModels?.available, model);

  // The modes the picker offers depend on the agent session: read the session again when its agent
  // starts or reopens (working, or `session.resumed`); turning idle after it is read again by the driver hook.
  const resumedSeq = useMemo(() => events.findLast((event) => event.type === 'session.resumed')?.seq, [events]);
  const agentWorking = state === 'working';
  useEffect(() => {
    if (agentWorking || resumedSeq !== undefined) void refetchSession();
  }, [agentWorking, resumedSeq, refetchSession]);

  // Whether the waiting card is out of view, for the "waiting for you" bar. Not while the terminal
  // drives: the conversation is read-only then, and nothing in it takes focus (3.6 review F2).
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

  if (session.error instanceof ChatApiError && session.error.status === 404) {
    return (
      <>
        <WorkspaceHeader title="Chat" wsId={wsId} />
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
      <WorkspaceHeader
        title={chatTitle}
        wsId={wsId}
        compactOnPhone={appearance.developerMode}
        titleHidden={rename.editing}
        titleAction={session.data === undefined ? undefined : <ChatHeaderRename rename={rename} name={chatTitle} />}
      >
        {/* The chat's agent (E6-R1), named in the header while the install has more than one. */}
        {severalAgents && session.data !== undefined ? (
          <Text as="span" variant="caption" data-testid="session-agent">
            {agentName}
          </Text>
        ) : null}
        {/* The model the chat runs on (story 11), beside its agent. */}
        {session.data !== undefined ? (
          <Text as="span" variant="caption" data-testid="session-model" data-model={model ?? ''} aria-label={`Model: ${modelWords}`} className="min-w-0 truncate max-sm:sr-only">
            {modelWords}
          </Text>
        ) : null}
        {state === undefined ? null : <StateGlyph state={state} data-testid="session-state" className="ml-auto" />}
        <span className={state === undefined ? 'ml-auto' : undefined}>
          <PermissionModePicker
            agentName={agentName}
            mode={permissionMode}
            options={session.data?.permissionModes}
            developerMode={appearance.developerMode}
            terminalDrives={terminalDrives}
            changing={modeChanging}
            onChoose={(mode, confirmed) => changeMode(mode, confirmed)}
          />
        </span>
        {appearance.developerMode ? (
          <DriverToggle
            agentName={agentName}
            driver={driver}
            switching={switchingTo}
            terminalBlockedReason={terminalBlockedReason}
            onSwitch={switchTo}
          />
        ) : null}
      </WorkspaceHeader>
      {/* A chat that skips its permission checks says so in red, above the conversation or the terminal, at any scroll position. */}
      {permissionMode === 'skip_all' ? <SkipAllBanner agentName={agentName} changing={modeChanging} onBackToAsk={() => changeMode('ask', false, terminalDrives)} /> : null}
      <StartModeNote key={sesId} note={startModeNote} />
      {driver === 'terminal' ? (
        <ReadOnlyBanner
          onSwitchToChat={() => switchTo('ui')}
          switching={switchingTo !== undefined}
          peekOpen={peekOpen}
          onTogglePeek={togglePeek}
          peekId={peekId}
        />
      ) : null}
      {/* While the terminal drives it takes the main pane; at `xl` the read-only conversation can open beside it. */}
      <TerminalPane driving={driver === 'terminal'}>
        {driver === 'terminal' ? <TerminalPanel sesId={sesId} agentName={agentName} screenReaderMode={appearance.terminalScreenReader} /> : null}
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
                <Text variant="caption">Ask {agentName} about this project.</Text>
              ) : (
                view.items.map((item, index) =>
                  item.type === 'message' ? (
                    <Message key={item.message.messageId} message={item.message} agentName={agentName} />
                  ) : item.type === 'tools' ? (
                    <ToolCalls key={`tools-${item.calls[0]?.toolCallId ?? index}`} calls={item.calls} density={appearance.density} />
                  ) : item.type === 'resumed' ? (
                    <ResumedMarker key={`resumed-${item.at}-${index}`} />
                  ) : item.type === 'document' ? (
                    <DocumentCard
                      key={`document-${item.path}`}
                      wsId={wsId}
                      path={item.path}
                      next={item.next}
                      onStarted={(started) => void navigate({ to: '/w/$wsId/s/$sesId', params: { wsId, sesId: started.id } })}
                    />
                  ) : (
                    <PermissionCard
                      key={item.permission.requestId}
                      permission={item.permission}
                      wsId={wsId}
                      sesId={sesId}
                      projectName={projectName}
                      agentName={agentName}
                      onDecided={focusComposer}
                    />
                  ),
                )
              )}
              {view.queued.map((message) => (
                <Message key={message.messageId} message={message} agentName={agentName} />
              ))}
              {state === 'working' && view.starting ? (
                // A slow agent start (epic 6 entry 5: Antigravity takes about 17 s on Windows) reads as starting, not stuck.
                <Notice data-testid="agent-starting" role="status">
                  <StateGlyph state="working" label={`Starting ${agentName}...`} />
                </Notice>
              ) : null}
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
                  <StateGlyph state="working" label={checkInWords(view.checkIn, agentName)} />
                </Notice>
              ) : null}
              {state === 'error' && view.errorCode === 'auth_required' && !terminalDrives && signsInHere && agentId !== undefined ? (
                // Keyed per error (the message it failed on), so each one starts unarmed (9.4).
                <SignInAgain
                  key={`${sesId}:${lastSentUserId ?? ''}`}
                  agentId={agentId}
                  agentName={agentName}
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
                  {view.errorReason ?? `${agentName} stopped with an error. Try again.`}
                </Notice>
              ) : null}
              {refusal !== undefined && model === null && !terminalDrives && dismissedRefusal !== refusal.reason ? (
                // The agent couldn't run the chosen model (story 11): its own words, and a way to pick another.
                <Notice
                  data-testid="model-refused"
                  role="status"
                  action={
                    <span className="flex gap-2">
                      <Button variant="outline" onClick={() => setModelMenuOpen(true)} data-testid="model-refused-choose">
                        Choose another model
                      </Button>
                      <Button variant="ghost" onClick={() => setDismissedRefusal(refusal.reason)} data-testid="model-refused-dismiss">
                        Keep the default
                      </Button>
                    </span>
                  }
                >
                  {refusal.reason}
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
              <StateGlyph state="waiting" label={`${agentName} is waiting for you`} />
            </Button>
          </div>
        ) : null}
        <Composer
          label={`Message ${agentName}`}
          blockedReason={
            driver === 'terminal'
              ? TERMINAL_DRIVING_REASON
              : state === 'waiting'
                ? `${agentName} is waiting for your answer above.`
                : undefined
          }
          hint={state === 'working' ? `${agentName} is working. A message you send now waits its turn.` : undefined}
          restore={restore}
          draftKey={chatDraftKey(wsId, sesId)}
          footer={
            <ModelPicker
              agentName={agentName}
              model={model}
              models={sessionModels === undefined ? undefined : sessionModels.available}
              current={sessionModels?.current}
              terminalDrives={terminalDrives}
              changing={modelChanging}
              open={modelMenuOpen}
              onOpenChange={setModelMenuOpen}
              onChoose={changeModel}
            />
          }
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
