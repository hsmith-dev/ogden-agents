import { useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useEventStream } from '@/events/event-stream';
import { diffForAnnouncements, type Announcements, type SidebarModel } from './sidebar-model';
import { useSidebarData } from './sidebar-data';

/** The browser tab's title with nothing waiting (index.html's `<title>`). */
export const APP_TITLE = 'Ogden Agents';

/** At most one polite announcement this often (EXPERIENCE.md Accessibility Floor). */
export const POLITE_INTERVAL_MS = 5000;

/** The tab title: the Needs you count first, when there is one ("(2) Ogden Agents"). */
export const tabTitle = (waiting: number): string => (waiting > 0 ? `(${waiting}) ${APP_TITLE}` : APP_TITLE);

/** The session open at this path (`/w/:wsId/s/:sesId`), if any. */
export function openSession(pathname: string): string | undefined {
  return /^\/w\/[^/]+\/s\/([^/]+)\/?$/.exec(pathname)?.[1];
}

/** A message for a live region; `n` changes with every message, so the same words twice are said twice. */
export interface LiveMessage {
  text: string;
  n: number;
}

/** The region's next message: a new `n` even when the words are the same as last time. */
export const nextMessage = (previous: LiveMessage, text: string): LiveMessage => ({ text, n: previous.n + 1 });

/**
 * A visually hidden live region. Its child is keyed by the message's `n`, so
 * each message is a fresh node the screen reader announces, even when its
 * words repeat.
 */
export function LiveRegion({ politeness, message, ...props }: { politeness: 'polite' | 'assertive'; message: LiveMessage; 'data-testid'?: string }) {
  return (
    <div aria-live={politeness} aria-atomic className="sr-only" {...props}>
      <span key={message.n}>{message.text}</span>
    </div>
  );
}

export interface Announcer {
  /** Queues the polite messages and says the new requests, except those in the session on screen (its page speaks for it). */
  announce(changes: Announcements, openSesId: string | undefined): void;
  dispose(): void;
}

/**
 * The announcement rules, apart from React so they are tested with fake
 * timers. Polite messages wait {@link POLITE_INTERVAL_MS} and go out together,
 * the latest per session, so a burst is one announcement and there is at
 * most one every interval. Each request is said once, assertively. Nothing
 * is said about the open session: its page shows its state and announces
 * its own card.
 */
export function createAnnouncer(say: { polite(text: string): void; assertive(text: string): void }, intervalMs = POLITE_INTERVAL_MS): Announcer {
  const queued = new Map<string, string>();
  const said = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    timer = undefined;
    if (queued.size === 0) return;
    say.polite([...queued.values()].join('. '));
    queued.clear();
  };
  return {
    announce({ polite, assertive }, openSesId) {
      for (const { sesId, text } of polite) {
        if (sesId === openSesId) continue;
        // Re-inserting keeps the order the sessions last changed in.
        queued.delete(sesId);
        queued.set(sesId, text);
      }
      if (queued.size > 0 && timer === undefined) timer = setTimeout(flush, intervalMs);
      const loud: string[] = [];
      for (const { id, sesId, text } of assertive) {
        if (said.has(id)) continue;
        said.add(id);
        if (sesId !== openSesId) loud.push(text);
      }
      if (loud.length > 0) say.assertive(loud.join('. '));
    },
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}

/**
 * The shell's screen reader voice for the sidebar and the tab title
 * (story 2.11), mounted once: one polite region for state changes, one
 * assertive region for new permission requests, and `document.title`
 * counting Needs you. The backlog replayed on opening a tab is never
 * announced: announcements start after the first `caught_up`.
 */
export function LiveAnnouncer() {
  const { model, runsSettled } = useSidebarData();
  const { caughtUp: streamCaughtUp } = useEventStream();
  const caughtUp = streamCaughtUp && runsSettled;
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [polite, setPolite] = useState<LiveMessage>({ text: '', n: 0 });
  const [assertive, setAssertive] = useState<LiveMessage>({ text: '', n: 0 });
  const announcer = useRef<Announcer | undefined>(undefined);
  const previous = useRef<SidebarModel | undefined>(undefined);
  const started = useRef(false);
  const openSesId = useRef<string | undefined>(undefined);
  openSesId.current = openSession(pathname);

  useEffect(() => {
    const current = createAnnouncer({
      polite: (text) => setPolite((previous) => nextMessage(previous, text)),
      assertive: (text) => setAssertive((previous) => nextMessage(previous, text)),
    });
    announcer.current = current;
    return () => current.dispose();
  }, []);

  useEffect(() => {
    // The render that first caught up only records what the backlog built.
    if (started.current && previous.current !== undefined) announcer.current?.announce(diffForAnnouncements(previous.current, model), openSesId.current);
    if (caughtUp) started.current = true;
    previous.current = model;
  }, [model, caughtUp]);

  const waiting = model.needsYou.length;
  useEffect(() => {
    document.title = tabTitle(waiting);
  }, [waiting]);
  useEffect(
    () => () => {
      document.title = APP_TITLE;
    },
    [],
  );

  return (
    <>
      <LiveRegion politeness="polite" message={polite} data-testid="sidebar-announcement" />
      <LiveRegion politeness="assertive" message={assertive} data-testid="needs-you-announcement" />
    </>
  );
}
