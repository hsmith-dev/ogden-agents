import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useRouterState } from '@tanstack/react-router';
import { ArrowClockwise, ArrowDown, ArrowsLeftRight, ChatCircle, House, Stop } from '@phosphor-icons/react';
import type { PermissionMode } from '@ogden-agents/shared';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useAgents } from '@/agents/agent-setup-api';
import { useAppearance } from '@/appearance/appearance-provider';
import { agentNameOf, cancelSession, CHAT_AGENTS_QUERY_KEY, ChatApiError, UNKNOWN_AGENT_NAME, fetchSession, sendMessage, setPermissionMode, setSessionModel, switchDriver } from '@/chat/chat-api';
import { ChatHeaderRename, useChatName, useChatRename } from '@/chat/chat-name';
import { agentDefaultLabel, ModelPicker, modelLabel, useSessionModel } from '@/chat/model-picker';
import { useChatAgents } from '@/chat/use-chat-agents';
import { Composer } from '@/chat/composer';
import { chatDraftKey } from '@/chat/drafts';
import { HandoffDialog } from '@/chat/handoff-dialog';
import { onBeforeChatDetailChange, setChatDetail, useChatDetail } from '@/chat/detail-level';
import { NewChatButton } from '@/chat/new-chat-button';
import { CONTINUE_WITH_ANOTHER_AGENT, SessionMenu } from '@/chat/session-menu';
import { LocationChip, SessionAgentChip } from '@/chat/setup-row';
import { ReadOnlyConversation } from '@/chat/read-only';
import { SignInAgain } from '@/chat/sign-in-again';
import { ToolCalls } from '@/chat/tool-call-row';
import { sessionView, type TranscriptCheckIn, type TranscriptItem } from '@/chat/transcript';
import { AgentChangedMarker, EarlierHistory, InterruptedNote, Message, ResumedMarker, TurnChangesRow } from '@/chat/transcript-parts';
import { QueuedMessages } from '@/chat/queued-messages';
import { otherWayShortcutLabel, useWhileWorking } from '@/chat/send-mode';
import { useCaughtUp, useEarlierHistory, useSessionEvents } from '@/events/event-stream';
import { PermissionCard, permissionAnnouncement } from '@/permissions/permission-card';
import { BuildRunHeader } from '@/planning/build-run-header';
import { BuildRunPanel } from '@/planning/build-run-panel';
import { useSessionRun } from '@/planning/builds-api';
import { DocumentCard } from '@/planning/document-card';
import { StartModeNote, useStartModeNote } from '@/permissions/default-permission-mode';
import { PermissionModePicker, SkipAllBanner, usePermissionMode } from '@/permissions/permission-mode-picker';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { DriverToggle } from '@/terminal/driver-toggle';
import { ReadOnlyBanner } from '@/terminal/read-only-banner';
import { TerminalPanel } from '@/terminal/terminal-panel';
import { conversationProps, TerminalPane } from '@/terminal/terminal-pane';
import { focusComposer, useSessionDriver } from '@/terminal/use-session-driver';
import { needsYouOpenCount, subscribeNeedsYouOpened } from '@/shell/needs-you-target';
import { Banner } from '@/ui/banner';
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
          : item.type === 'agent_changed'
            ? `agent-${item.at}-${index}`
          : item.type === 'interrupted'
            ? `interrupted-${item.messageId}`
          : item.type === 'turn_changes'
            ? `turn-changes-${item.turnId}`
            : item.permission.requestId;

/** What the composer says while the terminal drives (DESIGN.md Composer). */
const TERMINAL_DRIVING_REASON = 'The terminal is driving this session';

/** What a chat whose agent was removed says (story 21.4; the server's `agent_removed` message is the first sentence). */
export const AGENT_REMOVED_WORDS = 'This agent was removed.';
const AGENT_REMOVED_DETAIL = 'You can read this chat, but not continue it.';

/** What the composer says while the agent works (send now or wait): what `Enter` does, and the other way. */
const workingHint = (agentName: string, whileWorking: 'wait' | 'now') =>
  whileWorking === 'now'
    ? `${agentName} is working. While it works, your message goes right away. To send it after it finishes, press ${otherWayShortcutLabel()} or use the menu beside Send.`
    : `${agentName} is working. While it works, your message waits its turn. To send it right away, press ${otherWayShortcutLabel()} or use the menu beside Send.`;

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
 * planning session it starts. Permission modes: the setup row's Mode chip (moved from the header, 27.1) sets
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
  // A handoff (`session.agent_changed`) changes it live.
  const agentId = view.agentId ?? (session.data === undefined ? undefined : (session.data.session.agentId ?? chatAgents.data?.defaultAgentId));
  const agentName = agentId === undefined ? UNKNOWN_AGENT_NAME : agentNameOf(chatAgents.data, agentId);
  // Story 21.4: the chat's agent is no longer registered (a custom agent the user removed). The chat
  // stays readable but closed: no composer, no controls that start work, an inert transcript.
  const agentRemoved = agentId !== undefined && chatAgents.data !== undefined && !chatAgents.data.agents.some((agent) => agent.agentId === agentId);
  const queryClient = useQueryClient();
  const [handoffOpen, setHandoffOpen] = useState(false);
  // Continue with another agent stays open for a chat whose agent was removed: the server hands it over.
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
  // Send now or wait: the project's choice, else the app's.
  const whileWorking = useWhileWorking(wsId);

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

  // The chat's detail level (epic 26 story 4): switching keeps the item in view where it was.
  // A switch changes only what a tools item holds, never how many items there are, so the
  // transcript's child index finds the same item after it.
  const detail = useChatDetail(sesId, appearance.developerMode);
  const transcriptRef = useRef<HTMLElement>(null);
  const detailAnchor = useRef<{ index: number; offset: number } | undefined>(undefined);
  const detailNow = useRef(detail);
  detailNow.current = detail;
  useEffect(
    () =>
      onBeforeChatDetailChange((changed, next) => {
        detailAnchor.current = undefined;
        const container = scroller();
        const section = transcriptRef.current;
        // The same level again changes nothing, so no layout effect would clear an anchor kept now.
        if (changed !== sesId || next === detailNow.current || container === null || section === null) return;
        const box = container.getBoundingClientRect();
        const children = [...section.children];
        const startsInView = (child: Element) => {
          const { top } = child.getBoundingClientRect();
          return top >= box.top && top < box.bottom;
        };
        // The item that starts in view nearest its middle and is not tool calls (those change size, and
        // tool calls between the top and the item would push it), else the first that starts in view, else
        // the one the view starts inside.
        const middle = box.top + box.height / 2;
        let index = -1;
        children.forEach((child, at) => {
          if (!startsInView(child) || child.getAttribute('data-testid') === 'tool-calls') return;
          const distance = Math.abs(child.getBoundingClientRect().top - middle);
          if (index === -1 || distance < Math.abs(children[index]!.getBoundingClientRect().top - middle)) index = at;
        });
        if (index === -1) index = children.findIndex(startsInView);
        if (index === -1) index = children.findIndex((child) => child.getBoundingClientRect().bottom > box.top);
        if (index === -1) return;
        detailAnchor.current = { index, offset: children[index]!.getBoundingClientRect().top - box.top };
      }),
    [sesId, scroller],
  );
  useLayoutEffect(() => {
    const kept = detailAnchor.current;
    detailAnchor.current = undefined;
    const container = scroller();
    const child = transcriptRef.current?.children[kept?.index ?? -1];
    if (kept === undefined || container === null || child === undefined) return;
    container.scrollTop += child.getBoundingClientRect().top - container.getBoundingClientRect().top - kept.offset;
  }, [detail, scroller]);

  // A new card announces once, assertively, and never takes focus.
  useEffect(() => {
    if (waitingFor === undefined || announced.current.has(waitingFor.requestId)) return;
    announced.current.add(waitingFor.requestId);
    setAnnouncement(`${agentName} is waiting for you: ${permissionAnnouncement(waitingFor)}`);
  }, [waitingFor]);

  // A step stopped so a message sent right away goes (send now or wait): said once, as it happens.
  const lastInterrupted = view.items.findLast((item) => item.type === 'interrupted');
  const interruptedKey = lastInterrupted?.type === 'interrupted' ? lastInterrupted.messageId : undefined;
  const seenInterrupted = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!caughtUp) {
      seenInterrupted.current = interruptedKey;
      return;
    }
    if (interruptedKey === undefined || seenInterrupted.current === interruptedKey) return;
    seenInterrupted.current = interruptedKey;
    setAnnouncement('Stopped the current step to send your message.');
  }, [interruptedKey, caughtUp]);

  const state = view.state ?? session.data?.session.state;
  // An unattended build's session (story 5.2): read-only, no composer, its run's ticket and outcome in the header.
  const isBuild = session.data?.session.kind === 'build';
  const buildRun = useSessionRun(wsId, sesId, isBuild);
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
  // And when the chat continues with another agent (handoff): its modes are the new agent's.
  const agentChangedSeq = useMemo(() => events.findLast((event) => event.type === 'session.agent_changed')?.seq, [events]);
  const agentWorking = state === 'working';
  useEffect(() => {
    if (agentWorking || resumedSeq !== undefined || agentChangedSeq !== undefined) void refetchSession();
  }, [agentWorking, resumedSeq, agentChangedSeq, refetchSession]);

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

  // A Needs you row (epic 26) names its permission card in the hash: scroll to and focus it once per
  // navigation, as soon as that card is pending. A card already answered leaves a plain session open;
  // not while the terminal drives (nothing in the read-only conversation takes focus).
  // Story 26.10: while the router is on its way to another page (the new-chat draft's code still loading),
  // this chat stays on screen with its own params; its composer takes nothing, so text typed or sent then
  // waits for the next page's composer instead of reaching this chat.
  const leaving = useRouterState({ select: (router) => router.location.pathname.replace(/\/+$/, '') !== `/w/${wsId}/s/${sesId}` });
  const linked = useRouterState({ select: (router) => ({ hash: router.location.hash, key: router.location.state.__TSR_key ?? router.location.state.key ?? router.location.href }), structuralSharing: true });
  // Each open counts, the same row again too: the router pushes no new entry for the URL already shown.
  const opens = useSyncExternalStore(subscribeNeedsYouOpened, needsYouOpenCount, needsYouOpenCount);
  const focusedLink = useRef<string | undefined>(undefined);
  useEffect(() => {
    const openKey = `${linked.key}|${opens}`;
    if (terminalDrives || !linked.hash.startsWith('permission-') || focusedLink.current === openKey) return;
    const requestId = linked.hash.slice('permission-'.length);
    if (!view.pendingPermissions.some((permission) => permission.requestId === requestId)) return;
    const card = document.getElementById(linked.hash);
    if (card === null) return;
    focusedLink.current = openKey;
    card.scrollIntoView?.({ block: 'center' });
    card.focus({ preventScroll: true });
  }, [linked, opens, view.pendingPermissions, terminalDrives]);

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

  // Handoff: offered while the chat is idle or in error and the chat drives it.
  const handoffBlocked = terminalDrives
    ? 'Switch back to the chat first: the terminal is driving it.'
    : switchingTo !== undefined
      ? 'This chat is switching to or from the terminal.'
      : state === 'waiting'
        ? `${agentName} is waiting for your answer. Answer it or stop it first.`
        : state === 'working'
          ? `${agentName} is working. Stop it first.`
          : state === 'done'
            ? 'This chat is finished.'
            : undefined;
  const nameOf = (id: string | undefined) => (id === undefined ? agentName : agentNameOf(chatAgents.data, id));

  /** A send refused with `agent_removed` (story 21.4): read the agent list again, so the page closes the chat. */
  const noteAgentRemoved = (failure: unknown) => {
    if (failure instanceof ChatApiError && failure.code === 'agent_removed') void queryClient.invalidateQueries({ queryKey: CHAT_AGENTS_QUERY_KEY });
  };

  const tryAgain = () => {
    if (view.lastUserText === undefined) return;
    setActionError(undefined);
    sendMessage(wsId, sesId, view.lastUserText).catch((failure: unknown) => {
      setActionError(failure instanceof Error ? failure.message : "Your message couldn't be sent. Try again.");
      noteAgentRemoved(failure);
    });
  };

  // Chat | Terminal in the header (Developer mode, a chat whose agent is still registered).
  const driverShown = appearance.developerMode && !isBuild && !agentRemoved;

  return (
    <>
      <WorkspaceHeader
        // A build session shows its name too (26.6): "Build 1.2: <ticket title>", or "Build" before it loads.
        title={isBuild && shownName === '' ? 'Build' : chatTitle}
        wsId={wsId}
        compactOnPhone={appearance.developerMode}
        titleHidden={!isBuild && rename.editing}
        titleAction={session.data === undefined || isBuild ? undefined : <ChatHeaderRename rename={rename} name={chatTitle} />}
      >
        {/* The chat's agent (E6-R1), named in the header while the install has more than one. */}
        {isBuild ? <BuildRunHeader wsId={wsId} run={buildRun.data} /> : null}
        {severalAgents && session.data !== undefined && !isBuild ? (
          <Text as="span" variant="caption" data-testid="session-agent">
            {agentName}
          </Text>
        ) : null}
        {/* The model the chat runs on (story 11), beside its agent. */}
        {session.data !== undefined && !isBuild ? (
          <Text as="span" variant="caption" data-testid="session-model" data-model={model ?? ''} aria-label={`Model: ${modelWords}`} className="min-w-0 truncate max-sm:sr-only">
            {modelWords}
          </Text>
        ) : null}
        {state === undefined ? null : <StateGlyph state={state} data-testid="session-state" className="ml-auto" />}
        {driverShown ? (
          <DriverToggle
            // Before the state is known, the first of the right-hand controls takes the space.
            className={state === undefined ? 'ml-auto' : undefined}
            agentName={agentName}
            driver={driver}
            switching={switchingTo}
            terminalBlockedReason={terminalBlockedReason}
            onSwitch={switchTo}
          />
        ) : null}
        {/* New chat in one step (epic 26, E26-R2): the project's new-chat draft. */}
        {state === undefined && !driverShown ? (
          <span className="ml-auto">
            <NewChatButton wsId={wsId} />
          </span>
        ) : (
          <NewChatButton wsId={wsId} />
        )}
        {session.data !== undefined ? (
          <SessionMenu
            detail={detail}
            onDetail={(next) => setChatDetail(sesId, next)}
            blockedReason={handoffBlocked}
            onContinue={severalAgents ? () => setHandoffOpen(true) : undefined}
          />
        ) : null}
      </WorkspaceHeader>
      <HandoffDialog
        open={handoffOpen}
        onOpenChange={setHandoffOpen}
        wsId={wsId}
        sesId={sesId}
        currentAgentId={agentId}
        currentAgentName={agentName}
        agents={chatAgents.data?.agents ?? []}
        onHandedOff={() => {
          void refetchSession();
          focusComposer();
        }}
      />
      {/* A chat that skips its permission checks says so in red, above the conversation or the terminal, at any scroll position. */}
      {permissionMode === 'skip_all' && !agentRemoved ? <SkipAllBanner agentName={agentName} changing={modeChanging} onBackToAsk={() => changeMode('ask', false, terminalDrives)} /> : null}
      {isBuild ? <BuildRunPanel wsId={wsId} run={buildRun.data} /> : null}
      <StartModeNote key={sesId} note={startModeNote} />
      {agentRemoved ? (
        <Banner data-testid="agent-removed-banner">
          {AGENT_REMOVED_WORDS} {AGENT_REMOVED_DETAIL}
        </Banner>
      ) : null}
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
          {/* And while the chat's agent is removed (story 21.4). */}
          <ReadOnlyConversation.Provider value={terminalDrives || agentRemoved}>
            <section ref={transcriptRef} aria-label="Conversation" aria-busy={streaming} data-testid="transcript" className="flex w-full max-w-(--space-chat-column) flex-col gap-4 self-center">
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
                    <Message key={item.message.messageId} message={item.message} agentName={nameOf(item.message.agentId)} wsId={wsId} sesId={sesId} />
                  ) : item.type === 'tools' ? (
                    <ToolCalls key={`tools-${item.calls[0]?.toolCallId ?? index}`} calls={item.calls} detail={detail} />
                  ) : item.type === 'resumed' ? (
                    <ResumedMarker key={`resumed-${item.at}-${index}`} />
                  ) : item.type === 'agent_changed' ? (
                    <AgentChangedMarker key={`agent-${item.at}-${index}`} agentName={nameOf(item.agentId)} />
                  ) : item.type === 'interrupted' ? (
                    <InterruptedNote key={`interrupted-${item.messageId}`} cancelledRequest={item.cancelledRequest} />
                  ) : item.type === 'turn_changes' ? (
                    <TurnChangesRow key={`turn-changes-${item.turnId}`} wsId={wsId} sesId={sesId} turnId={item.turnId} files={item.files} additions={item.additions} deletions={item.deletions} />
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
              <QueuedMessages
                wsId={wsId}
                sesId={sesId}
                messages={view.queued}
                readOnly={terminalDrives || agentRemoved}
                sendNowBlockedReason={state === 'waiting' ? 'Answer the request above first, then send your message.' : undefined}
                onError={setActionError}
              />
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
                    view.checkIn.waitingOn === undefined && !terminalDrives && !agentRemoved ? (
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
              {state === 'error' && view.errorCode === 'auth_required' && !terminalDrives && !agentRemoved && signsInHere && agentId !== undefined ? (
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
                    terminalDrives || isBuild || agentRemoved ? null : (
                      <span className="flex flex-wrap gap-2">
                        {/* Out of usage (handoff): the chat can go on with another agent while this one cools down. */}
                        {view.errorCode === 'usage_limit' && severalAgents ? (
                          <Button variant="outline" onClick={() => setHandoffOpen(true)} data-testid="error-continue-with-another">
                            <ArrowsLeftRight aria-hidden />
                            {CONTINUE_WITH_ANOTHER_AGENT}
                          </Button>
                        ) : null}
                        {view.lastUserText === undefined ? null : (
                          <Button variant="outline" onClick={tryAgain} data-testid="try-again">
                            <ArrowClockwise aria-hidden />
                            Try again
                          </Button>
                        )}
                      </span>
                    )
                  }
                >
                  {view.errorReason ?? `${agentName} stopped with an error. Try again.`}
                </Notice>
              ) : null}
              {refusal !== undefined && model === null && !terminalDrives && !agentRemoved && dismissedRefusal !== refusal.reason ? (
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
        {waitingFor !== undefined && cardOffscreen && !terminalDrives && !agentRemoved ? (
          <div className="pb-2">
            <Button variant="outline" className="w-full justify-start" data-testid="waiting-bar" onClick={showCard}>
              <StateGlyph state="waiting" label={`${agentName} is waiting for you`} />
            </Button>
          </div>
        ) : null}
        {isBuild || agentRemoved ? null : (
          <Composer
            label={`Message ${agentName}`}
            blockedReason={
              driver === 'terminal'
                ? TERMINAL_DRIVING_REASON
                : state === 'waiting'
                  ? `${agentName} is waiting for your answer above.`
                  : undefined
            }
            hint={state === 'working' ? workingHint(agentName, whileWorking) : undefined}
            whileWorking={whileWorking}
            working={state === 'working'}
            restore={restore}
            draftKey={chatDraftKey(wsId, sesId)}
            disabled={leaving}
            footer={
              // The setup row (epic 27, 27.1): the chat's agent, model, mode and place; the place is fixed once it started.
              <>
                {/* As the draft's Agent chip and the header's name: only while the install has several agents. */}
                {severalAgents ? <SessionAgentChip agentId={agentId} agentName={agentName} blockedReason={handoffBlocked} onContinue={() => setHandoffOpen(true)} /> : null}
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
                <PermissionModePicker
                  agentName={agentName}
                  mode={permissionMode}
                  options={session.data?.permissionModes}
                  developerMode={appearance.developerMode}
                  terminalDrives={terminalDrives}
                  changing={modeChanging}
                  onChoose={(mode, confirmed) => changeMode(mode, confirmed)}
                />
                {/* A remote chat's place is its machine (27.5 adds it to this chip). */}
                {session.data === undefined || (session.data.session.machineId ?? null) !== null ? null : (
                  <LocationChip value={(session.data.session.worktreePath ?? null) === null ? 'this_folder' : 'worktree'} />
                )}
              </>
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
            onSend={async (text, delivery) => {
              try {
                await sendMessage(wsId, sesId, text, undefined, delivery);
              } catch (failure) {
                // 409 `agent_removed` (story 21.4): its words stay on the page once the composer closes.
                if (failure instanceof ChatApiError && failure.code === 'agent_removed') setActionError(failure.message);
                noteAgentRemoved(failure);
                throw failure;
              }
            }}
          />
        )}
      </PageFooter>
    </>
  );
}
