import { TERMINAL_CLOSE } from '@ogden-agents/shared';
import type { Terminal } from '@xterm/xterm';
import { useEffect, useRef, useState } from 'react';
import { AGENT_NAME } from '@/chat/chat-api';
import { tokenNumber } from '@/ui/tokens';
import { cn } from '@/ui/utils';
import { Text } from '@/ui/typography';
import { connectTerminal, type TerminalConnection } from './terminal-socket';

/** What the panel says under the terminal, if anything. */
type PanelStatus = 'loading' | 'connected' | 'reconnecting' | 'ended' | 'disconnected' | 'failed';

const STATUS_WORDS: Partial<Record<PanelStatus, string>> = {
  loading: 'Opening the terminal',
  reconnecting: 'Reconnecting to the terminal',
  ended: `${AGENT_NAME} left the terminal.`,
  disconnected: 'The terminal is not connected. Reload to reconnect.',
  failed: "The terminal couldn't open. Reload to try again.",
};

/**
 * The waits before each try to reconnect after an abnormal close (story 3.5,
 * user decision): 1, 2, then 4 s, five tries in all, then "Reload to reconnect".
 */
export const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 4_000, 4_000] as const;

/** Closes that end the connection without the terminal ending: the network dropped (1006) or the server went away (1001). */
const ABNORMAL_CLOSES: ReadonlySet<number> = new Set([1001, 1006]);

export interface TerminalPanelProps {
  sesId: string;
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
 * After an abnormal close (1006, 1001) it reconnects by itself, waiting
 * {@link RECONNECT_DELAYS_MS}, and the server replays the recent output
 * (story 3.5); after the last try it says to reload.
 */
export function TerminalPanel({ sesId, screenReaderMode, className }: TerminalPanelProps) {
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
      const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit'), import('@xterm/xterm/css/xterm.css')]);
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
        theme: { background: style.backgroundColor, foreground: style.color, cursor: style.color },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(element);
      fit.fit();
      terminal.current = term;
      let connection: TerminalConnection | undefined;
      let ended = false;
      /** True while xterm takes a size the server sent: that resize is not this viewer's to send back. */
      let following = false;
      /**
       * Reconnect tries since the server last sent something (story 3.5): a
       * socket that opens and drops before the recent output arrives counts
       * as a failed try.
       */
      let tries = 0;
      let retry: ReturnType<typeof setTimeout> | undefined;
      /** Whether the next open replaces what xterm shows with the server's recent output. */
      let replay = false;
      const connect = () => {
        connection = connectTerminal(sesId, {
          size: () => ({ cols: term.cols, rows: term.rows }),
          onOpen: () => {
            // The recent output comes next: it replaces what was shown, never adds to it.
            if (replay) term.reset();
            replay = false;
            setStatus('connected');
          },
          onBytes: (bytes) => {
            tries = 0;
            term.write(bytes);
          },
          onSize: (cols, rows) => {
            tries = 0;
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
            if (ended || disposed) return;
            // Fell behind a flood of output (story 3.1 review F2): start again from the recent output.
            if (code === TERMINAL_CLOSE.slowViewer) {
              replay = true;
              connect();
              return;
            }
            // The network dropped or the server went away (story 3.5): try again, waiting longer each time.
            const delay = ABNORMAL_CLOSES.has(code) ? RECONNECT_DELAYS_MS[tries] : undefined;
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
            setStatus((current) => (current === 'ended' ? current : 'disconnected'));
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

  const words = STATUS_WORDS[status];
  return (
    <section
      aria-label={`${AGENT_NAME} terminal`}
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
