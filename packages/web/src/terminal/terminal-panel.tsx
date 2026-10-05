import { TERMINAL_CLOSE } from '@ogden-agents/shared';
import type { Terminal } from '@xterm/xterm';
import { useEffect, useRef, useState } from 'react';
import { tokenNumber } from '@/ui/tokens';
import { cn } from '@/ui/utils';
import { Text } from '@/ui/typography';
import { connectTerminal, type TerminalConnection } from './terminal-socket';
import { loadXterm, enableUnicode11 } from './xterm-setup';

/** What the panel says under the terminal, if anything. */
type PanelStatus = 'loading' | 'connected' | 'reconnecting' | 'ended' | 'disconnected' | 'tooMany' | 'failed';

const statusWords = (agentName: string): Partial<Record<PanelStatus, string>> => ({
  loading: 'Opening the terminal',
  reconnecting: 'Reconnecting to the terminal',
  ended: `${agentName} left the terminal.`,
  disconnected: 'The terminal is not connected. Reload to reconnect.',
  tooMany: 'Too many open terminal views. Close one, then reload.',
  failed: "The terminal couldn't open. Reload to try again.",
});

/**
 * The waits before each try to reconnect after an abnormal close (story 3.5,
 * user decision): 1, 2, then 4 s, five tries in all, then "Reload to reconnect".
 */
export const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 4_000, 4_000] as const;

/**
 * Closes that end the connection without the terminal ending, so it is
 * worth trying again: the network dropped (1006), the server went away
 * (1001), or this viewer fell behind a flood of output (1013, story 3.1
 * review F2; 3.5 review F1 gives it the same waits and limit).
 */
const RETRY_CLOSES: ReadonlySet<number> = new Set([1001, 1006, TERMINAL_CLOSE.slowViewer]);

/** How long a connection must stay up before its tries start again from the first (3.5 review F1). */
export const STABLE_CONNECTION_MS = 10_000;

/** The server's close for a viewer over its session's limit of 8 (3.5 review F2): `shared`'s, under this name for its callers (story 3.9). */
export const TOO_MANY_VIEWERS = TERMINAL_CLOSE.tooManyViewers;

export interface TerminalPanelProps {
  sesId: string;
  /** The chat's agent by its product name (epic 6). */
  agentName: string;
  /** xterm's screen-reader mode (Settings → Appearance, "Terminal screen-reader mode"; off by default). */
  screenReaderMode: boolean;
  className?: string;
}

/**
 * The session's terminal while it drives the chat (stories 3.1, 3.6; DESIGN.md
 * Terminal panel): dark in both themes, `rounded.lg`, a hairline signal top
 * edge, xterm in Geist Mono at the `mono` size (in both densities) with the
 * panel's inner padding, loaded only when shown.
 * The socket's first frame is `attach` with the size; a `size` frame (another
 * viewer resized) resizes xterm to match. Keyboard focus goes into xterm when
 * the panel opens. Nothing typed or printed is kept or logged here.
 * After an abnormal close (1006, 1001) or falling behind (1013) it
 * reconnects by itself, waiting {@link RECONNECT_DELAYS_MS}, and the server
 * replays the recent output (story 3.5); after the last try it says to
 * reload. A close that says the terminal ended, or that it has too many
 * viewers, keeps what was shown and says why.
 */
export function TerminalPanel({ sesId, agentName, screenReaderMode, className }: TerminalPanelProps) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | undefined>(undefined);
  const [status, setStatus] = useState<PanelStatus>('loading');
  // Read when xterm is created; later changes go through the effect below.
  const screenReader = useRef(screenReaderMode);
  screenReader.current = screenReaderMode;

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      const { Terminal, FitAddon, Unicode11Addon } = await loadXterm();
      const element = host.current;
      if (disposed || element === null) return;
      const style = getComputedStyle(element);
      const term = new Terminal({
        // Reduced motion (DESIGN.md Motion): a steady cursor.
        cursorBlink: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches !== true,
        fontFamily: style.fontFamily,
        // The `mono` type size of Comfortable density, also in Compact (DESIGN.md Terminal panel).
        fontSize: tokenNumber('--type-mono-size', 13),
        screenReaderMode: screenReader.current,
        // The Unicode 11 addon needs xterm's proposed API.
        allowProposedApi: true,
        theme: { background: style.backgroundColor, foreground: style.color, cursor: style.color },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      // Emoji are two cells wide (spike 16.1 finding 5).
      enableUnicode11(term, Unicode11Addon);
      term.open(element);
      fit.fit();
      terminal.current = term;
      let connection: TerminalConnection | undefined;
      let ended = false;
      /** True while xterm takes a size the server sent: that resize is not this viewer's to send back. */
      let following = false;
      /**
       * Reconnect tries in a row (story 3.5). They start again from the first
       * only once a connection has stayed up {@link STABLE_CONNECTION_MS} or
       * sent live output after the recent output (3.5 review F1), so a
       * socket that attaches and drops at once still runs out of tries.
       */
      let tries = 0;
      let retry: ReturnType<typeof setTimeout> | undefined;
      let stable: ReturnType<typeof setTimeout> | undefined;
      /** Whether the next bytes replace what xterm shows (the server's recent output after a reconnect). */
      let replay = false;
      /** Whether any connection has opened: a later 4404 means the terminal ended while away. */
      let opened = false;
      const connect = () => {
        /** Binary frames on this connection: the first is the recent output, any later one is live. */
        let frames = 0;
        connection = connectTerminal(sesId, {
          size: () => ({ cols: term.cols, rows: term.rows }),
          onOpen: () => {
            opened = true;
            clearTimeout(stable);
            stable = setTimeout(() => (tries = 0), STABLE_CONNECTION_MS);
            setStatus('connected');
          },
          onBytes: (bytes) => {
            // The recent output replaces what was shown, never adds to it (3.5 review F4: only once it arrives).
            if (replay) term.reset();
            replay = false;
            if (++frames > 1) tries = 0;
            term.write(bytes);
          },
          onSize: (cols, rows) => {
            if (cols === term.cols && rows === term.rows) return;
            following = true;
            try {
              term.resize(cols, rows);
            } finally {
              following = false;
            }
          },
          onExit: () => {
            ended = true;
            setStatus('ended');
          },
          onClose: (code) => {
            clearTimeout(stable);
            stable = undefined;
            if (ended || disposed) return;
            // Dropped, or fell behind (stories 3.1, 3.5): try again, waiting longer each time.
            const delay = RETRY_CLOSES.has(code) ? RECONNECT_DELAYS_MS[tries] : undefined;
            if (delay !== undefined) {
              tries++;
              replay = true;
              setStatus('reconnecting');
              retry = setTimeout(() => {
                retry = undefined;
                if (disposed || ended) return;
                connect();
                // Signed out meanwhile: nothing to reconnect with.
                if (connection === undefined) setStatus('disconnected');
              }, delay);
              return;
            }
            // What was shown stays (3.5 review F4), with why it stopped.
            if (code === TOO_MANY_VIEWERS) setStatus('tooMany');
            else if (code === TERMINAL_CLOSE.notTerminal && opened) setStatus('ended');
            else setStatus((current) => (current === 'ended' ? current : 'disconnected'));
          },
        });
      };
      connect();
      if (connection === undefined) {
        term.dispose();
        terminal.current = undefined;
        setStatus('failed');
        return;
      }
      const typing = term.onData((data) => connection?.type(data));
      const resizing = term.onResize(({ cols, rows }) => {
        if (!following) connection?.resize(cols, rows);
      });
      const observer = new ResizeObserver(() => fit.fit());
      observer.observe(element);
      term.focus();
      cleanup = () => {
        clearTimeout(retry);
        clearTimeout(stable);
        observer.disconnect();
        typing.dispose();
        resizing.dispose();
        connection?.close();
        term.dispose();
        terminal.current = undefined;
      };
    })().catch(() => {
      if (!disposed) setStatus('failed');
    });
    return () => {
      disposed = true;
      cleanup();
    };
  }, [sesId]);

  useEffect(() => {
    if (terminal.current !== undefined) terminal.current.options.screenReaderMode = screenReaderMode;
  }, [screenReaderMode]);

  const words = statusWords(agentName)[status];
  return (
    <section
      aria-label={`${agentName} terminal`}
      data-testid="terminal-panel"
      className={cn('flex min-h-0 min-w-0 flex-1 flex-col gap-2 rounded-lg border-t border-signal bg-terminal p-3', className)}
    >
      <div ref={host} data-testid="terminal" data-status={status} className="min-h-0 flex-1 bg-terminal font-mono text-terminal-foreground" />
      {words === undefined ? null : (
        <Text variant="caption" role="status" data-testid="terminal-status" className="text-terminal-foreground">
          {words}
        </Text>
      )}
    </section>
  );
}
