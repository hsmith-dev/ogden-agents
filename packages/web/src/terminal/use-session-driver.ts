import type { CoreEvent, SessionDriver, SessionResponse, SessionState } from '@ogden-agents/shared';
import type { QueryObserverResult } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChatApiError, switchDriver } from '@/chat/chat-api';
import type { SessionSearch } from '@/router';
import { NOT_IDLE_REASON } from './driver-toggle';
import { useDriverShortcut } from './use-driver-shortcut';
import { useDriverSwitch } from './use-driver-switch';

/** Puts the cursor back in the composer. */
export const focusComposer = () => document.querySelector<HTMLTextAreaElement>('[data-testid="composer"] textarea')?.focus();

export interface SessionDriverOptions {
  wsId: string;
  sesId: string;
  /** The session's own stream: the view follows only its `session.driver_changed`. */
  events: readonly CoreEvent[];
  /** The session as read (`GET` session), with its `terminal`. */
  session: { data: SessionResponse | undefined; refetch: () => Promise<QueryObserverResult<SessionResponse>> };
  /** The session's state now (`undefined` while it loads). */
  state: SessionState | undefined;
  /** How many messages wait their turn (the agent is not idle while any do). */
  queued: number;
  /** Developer mode: the toggle and its shortcut are on only then. */
  developerMode: boolean;
  /** A switch that failed (or a blocked shortcut), in words; `undefined` clears it. */
  setActionError: (message: string | undefined) => void;
}

/**
 * The session page's driver wiring (story 3.6, moved out of `session-page.tsx`
 * in story 3.9): who drives (the latest `session.driver_changed`, else the
 * session as read), why the Terminal segment can't be used, one switch at a
 * time with its shortcut, the cursor back in the composer on returning to the
 * chat, `?driver=terminal` mirroring who drives, and the read-only peek.
 */
export function useSessionDriver({ wsId, sesId, events, session, state, queued, developerMode, setActionError }: SessionDriverOptions) {
  const search = useSearch({ strict: false }) as SessionSearch;
  const navigate = useNavigate();
  /** The driver this tab asked for last, so switching back to chat puts the cursor in the composer. */
  const requested = useRef<SessionDriver | undefined>(undefined);
  const [peekOpen, setPeekOpen] = useState(false);
  const peekId = useId();
  /** Who drives the chat (story 3.1): the latest `session.driver_changed`, else the session as read. */
  const driverChange = useMemo(() => events.findLast((event) => event.type === 'session.driver_changed'), [events]);
  const driver: SessionDriver = (driverChange?.type === 'session.driver_changed' ? driverChange.payload.driver : undefined) ?? session.data?.session.driver ?? 'ui';
  const driverKnown = driverChange !== undefined || session.data !== undefined;
  const terminal = session.data?.terminal;

  /**
   * Why the Terminal segment can't be used now: the terminal can't work here (verbatim), or the agent
   * is not idle; `null` while the session is still loading (disabled, nothing to say; 3.6 review F5).
   */
  const terminalBlockedReason =
    terminal?.available === false
      ? terminal.reason
      : state === undefined
        ? null
        : state !== 'idle' || queued > 0
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
  useDriverShortcut(developerMode && driverKnown, () => switchTo(driver === 'terminal' ? 'ui' : 'terminal'));

  return {
    driver,
    terminalDrives: driver === 'terminal',
    terminalBlockedReason,
    switchingTo,
    switchTo,
    peekOpen,
    togglePeek: () => setPeekOpen((open) => !open),
    peekId,
  };
}
